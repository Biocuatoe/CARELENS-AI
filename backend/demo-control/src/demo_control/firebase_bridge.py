"""
Firebase Realtime Database bridge for EcoPatch telemetry.

Listens for sensor data from the EcoPatch device's gateway and pushes
real-time BPM/SpO₂ updates to the SSE stream for the liveshowcase persona.

This module ONLY targets `d_core_liveshowcase` (r_liveshowcase recipient).
It NEVER touches static persona fixtures (r_an, r_binh).

Credentials: requires firebase-admin with a service account.
Set FIREBASE_DATABASE_URL, FIREBASE_DATABASE_PATH, and either:
  - GOOGLE_APPLICATION_CREDENTIALS (path to service-account JSON), or
  - Ensure the Firebase Realtime Database allows unauthenticated reads (test DBs only).

No Firebase SDK is used client-side. All Firebase I/O is server-side only.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_bridge: "FirebaseBridge | None" = None
_is_initialized = False
_init_error: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_firebase_enabled() -> bool:
    """Return True when Firebase env vars are configured."""
    url = os.environ.get("FIREBASE_DATABASE_URL", "").strip()
    return bool(url)


def _clamp(value: Any, lo: float, hi: float, default: float) -> float:
    """Clamp a numeric value to [lo, hi] or return default."""
    try:
        v = float(value)
        return max(lo, min(hi, v))
    except (TypeError, ValueError):
        return default


def _quality_from_perfusion(perfusion: Any) -> str:
    """Derive signal quality from perfusion index if available."""
    try:
        p = float(perfusion)
        if p >= 2.0:
            return "good"
        elif p >= 0.5:
            return "fair"
        else:
            return "poor"
    except (TypeError, ValueError):
        return "fair"


# ---------------------------------------------------------------------------
# FirebaseBridge
# ---------------------------------------------------------------------------

class FirebaseBridge:
    """
    Listens to Firebase Realtime Database for EcoPatch telemetry and
    pushes updates to the existing SSE broadcaster.

    Only writes to `d_core_liveshowcase` (r_liveshowcase recipient).
    Safely ignores all errors so FastAPI continues running.
    """

    def __init__(
        self,
        on_state_update: Callable[[], Coroutine[Any, Any, None]],
    ) -> None:
        self._on_state_update = on_state_update
        self._database_url: str = (
            os.environ.get("FIREBASE_DATABASE_URL", "").strip()
        )
        self._db_path: str = (
            os.environ.get("FIREBASE_DATABASE_PATH", "sensor").strip().strip("/")
        )
        self._shutdown_event = threading.Event()
        self._thread_shutdown = threading.Event()
        self._task: threading.Thread | None = None
        self._db_client: Any = None  # firebase_admin.db.Client
        self._main_loop: asyncio.AbstractEventLoop | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Initialise the Firebase listener. Returns immediately on error."""
        log.info(
            "[FirebaseBridge] Starting with URL=%s, path=%s",
            self._database_url,
            self._db_path,
        )
        try:
            import firebase_admin
            from firebase_admin import credentials, db as fb_db
        except ImportError:
            log.warning(
                "[FirebaseBridge] firebase-admin not installed. "
                "Run: pip install firebase-admin"
            )
            return

        # Only use GOOGLE_APPLICATION_CREDENTIALS if set; otherwise assume test DB
        cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        if cred_path and os.path.isfile(cred_path):
            try:
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred)
                log.info(
                    "[FirebaseBridge] Firebase app initialized with service account"
                )
            except Exception as exc:
                log.warning(
                    "[FirebaseBridge] Failed to initialize with service account %s: %s",
                    cred_path,
                    exc,
                )
                return
        else:
            # Try to use the default credentials / test DB (no auth)
            try:
                firebase_admin.initialize_app(
                    options={"databaseURL": self._database_url}
                )
                log.info(
                    "[FirebaseBridge] Firebase app initialized (no credentials — test DB assumed)"
                )
            except ValueError:
                # App already initialized (e.g. during test re-runs)
                pass

        try:
            self._db_client = fb_db
            self._shutdown_event.clear()
            self._thread_shutdown.clear()
            # Capture the main event loop (where the lifespan coroutine runs) so the
            # daemon thread can schedule work on it via run_coroutine_threadsafe().
            self._main_loop = asyncio.get_running_loop()
            self._task = threading.Thread(
                target=self._run_sync,
                args=(self._main_loop,),
                name="firebase-bridge",
                daemon=True,
            )
            self._task.start()
            log.info("[FirebaseBridge] Listener started successfully")
        except Exception as exc:
            log.warning("[FirebaseBridge] Failed to start listener: %s", exc)

    async def stop(self) -> None:
        """Gracefully shut down the listener."""
        log.info("[FirebaseBridge] Stopping...")
        self._shutdown_event.set()
        # Wait for the keepalive thread to acknowledge shutdown.
        if self._task is not None:
            self._task.join(timeout=5.0)
            self._task = None
        log.info("[FirebaseBridge] Stopped")

    # ------------------------------------------------------------------
    # Thread entry point (runs on daemon thread)
    # ------------------------------------------------------------------

    def _run_sync(self, _loop: asyncio.AbstractEventLoop) -> None:
        """
        Thread entry point. Schedules async work on the main event loop.

        Args:
            _loop: The main event loop (where uvicorn/FastAPI runs). Passed in
                from start() so we avoid get_running_loop() in a non-async thread.
        """
        def on_value(context: Any) -> None:
            """
            Called by Firebase RTDB whenever data at the path changes.
            Runs on the firebase-admin HTTP thread pool.
            """
            try:
                data = context.data
                if data is None:
                    return
                payload = dict(data)
                # Schedule the async handler on the main event loop.
                asyncio.run_coroutine_threadsafe(
                    self._handle_update(payload), _loop
                )
            except Exception as exc:
                log.warning("[FirebaseBridge] on_value error: %s", exc)

        log.info("[FirebaseBridge] Entering listener loop")
        try:
            ref = self._db_client.reference(
                f"/{self._db_path}", url=self._database_url
            )
            ref.listen(on_value)
            log.info("[FirebaseBridge] RTDB listener registered, starting keepalive loop")

            # Keep the RTDB long-poll connection alive indefinitely.
            # firebase-admin's listen() uses HTTP long-polling internally; without
            # periodic activity the connection times out and on_value callbacks stop.
            while not self._shutdown_event.is_set():
                self._shutdown_event.wait(25.0)
                if not self._shutdown_event.is_set():
                    # Schedule a non-blocking REST ping on the main event loop.
                    # Must use run_coroutine_threadsafe (not run_until_complete) so we
                    # don't block the daemon thread if the coroutine hangs.
                    try:
                        _fut = asyncio.run_coroutine_threadsafe(
                            self._keepalive_ping(), _loop
                        )
                        # Detach the future so exceptions are logged, not silently discarded.
                        _fut.add_done_callback(
                            lambda f: (
                                log.debug(
                                    "[FirebaseBridge] Keepalive ping done: %s", f.exception()
                                )
                                if f.exception()
                                else None
                            )
                        )
                    except RuntimeError as exc:
                        # Event loop is closed — stop the thread gracefully.
                        log.warning(
                            "[FirebaseBridge] Cannot schedule keepalive (loop closed): %s",
                            exc,
                        )
                        break
        except Exception as exc:
            log.warning("[FirebaseBridge] Listener error: %s", exc)
        finally:
            self._thread_shutdown.set()
            log.info("[FirebaseBridge] Exiting listener loop")

    # ------------------------------------------------------------------
    # Async helpers
    # ------------------------------------------------------------------

    async def _keepalive_ping(self) -> None:
        """Non-blocking REST ping to keep the RTDB long-poll connection alive."""
        try:
            self._db_client.reference(
                f"/{self._db_path}", url=self._database_url
            ).get()
        except Exception as exc:
            log.debug("[FirebaseBridge] Keepalive ping error: %s", exc)

    async def _handle_update(self, payload: dict) -> None:
        """
        Process a raw Firebase payload and push a state update via SSE.

        Expected payload shape (flexible — missing/null fields are safe):
        {
          "bpm": 72,           # int | float | null
          "spo2": 98,         # int | float | null
          "finger": true,     # bool | null  — finger detected
          "perfusion": 3.5,  # float | null — Pi index for quality
          "sampleRate": 100,  # int | null   — ADC sample rate Hz
          "seq": 42,          # int | null   — device sequence
          "status": "ok",     # str | null
          "timestamp": 1234567890,  # unix seconds | null
        }
        """
        try:
            # ---- Normalize payload fields ----
            bpm_raw = payload.get("bpm")
            spo2_raw = payload.get("spo2")
            finger_detected = bool(payload.get("finger"))
            perfusion = payload.get("perfusion")
            seq = payload.get("seq")
            status = payload.get("status")
            ts_raw = payload.get("timestamp")

            # Derive observed_at — prefer unix timestamp, else now
            if ts_raw is not None:
                try:
                    ts_val = float(ts_raw)
                    observed_at = datetime.fromtimestamp(
                        ts_val, tz=timezone.utc
                    ).isoformat()
                except (TypeError, ValueError):
                    observed_at = datetime.now(timezone.utc).isoformat()
            else:
                observed_at = datetime.now(timezone.utc).isoformat()

            quality = _quality_from_perfusion(perfusion)
            bpm: float | None = (
                _clamp(bpm_raw, 30, 250, None) if bpm_raw is not None else None
            )
            spo2: float | None = (
                _clamp(spo2_raw, 50, 100, None) if spo2_raw is not None else None
            )

            # Log first non-null values as INFO (once per boot)
            if not hasattr(self, "_logged_first"):
                self._logged_first = True
                log.info(
                    "[FirebaseBridge] Received first payload: bpm=%s spo2=%s finger=%s",
                    bpm,
                    spo2,
                    finger_detected,
                )

            # ---- Update state ----
            from demo_control.state import update_device_telemetry

            # Call the state updater (only affects d_core_liveshowcase)
            update_device_telemetry(
                device_id="d_core_liveshowcase",
                bpm=bpm,
                spo2=spo2,
                quality=quality,
                observed_at=observed_at,
                seq=int(seq) if seq is not None else None,
                finger_detected=finger_detected,
                status=status,
            )

            # ---- Broadcast via existing SSE ----
            await self._on_state_update()
            log.debug(
                "[FirebaseBridge] State updated and broadcast: bpm=%s spo2=%s",
                bpm,
                spo2,
            )

        except Exception as exc:
            # NEVER crash FastAPI — log and continue
            log.warning(
                "[FirebaseBridge] Error processing Firebase payload: %s", exc
            )


# ---------------------------------------------------------------------------
# Module-level wiring helpers (called from app.py lifespan)
# ---------------------------------------------------------------------------

async def start_firebase_bridge(
    on_state_update: Callable[[], Coroutine[Any, Any, None]],
) -> None:
    """
    Initialise and start the Firebase listener.
    Safe to call when Firebase is not configured (no-op with warning).
    """
    global _bridge, _is_initialized, _init_error

    if not _is_initialized:
        _is_initialized = True
        if not _is_firebase_enabled():
            _init_error = (
                "FIREBASE_DATABASE_URL not set — Firebase bridge not started"
            )
            log.info("[FirebaseBridge] %s", _init_error)
            return

        _bridge = FirebaseBridge(on_state_update=on_state_update)
        await _bridge.start()


async def stop_firebase_bridge() -> None:
    """Stop the Firebase listener if it was started."""
    global _bridge
    if _bridge is not None:
        await _bridge.stop()
        _bridge = None
