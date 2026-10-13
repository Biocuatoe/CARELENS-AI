import { useEffect, useRef, useState } from "react";
import type { BackendDeviceState, Measurement } from "./contracts";
import { useAdapter } from "./index";

/** Maximum history points per metric — rolling window cap. */
const MAX_HISTORY = 100;
/** Maximum entries in the dedup set. Purged FIFO when exceeded so the set
 * never grows without bound even with long-lived sessions. */
const DEDUP_MAX = MAX_HISTORY * 4;

function isValidValue(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Convert one BackendLatestData point (heart_rate | spo2) into a Measurement.
 * Returns null if the value is invalid (null/undefined/NaN/0) — the chart must
 * not fabricate data points from a missing or zero reading (AGENTS.md §6).
 */
function toMeasurement(
  deviceId: string,
  ld: BackendDeviceState["latest_data"],
): Measurement | null {
  if (!ld) return null;
  if (ld.kind !== "heart_rate" && ld.kind !== "spo2") return null;
  if (!isValidValue(ld.value)) return null;
  if (!ld.observed_at) return null;
  const observedMs = new Date(ld.observed_at).getTime();
  if (!Number.isFinite(observedMs)) return null;
  return {
    id: `live_${deviceId}_${ld.kind}_${observedMs}_${ld.value}`,
    sourceRecordId: `sse-live-${deviceId}-${ld.kind}-${observedMs}-${ld.value}`,
    deviceId,
    metric: ld.kind,
    value: ld.value,
    unit: ld.unit ?? (ld.kind === "heart_rate" ? "bpm" : "%"),
    quality: ld.quality ?? "fair",
    observedAt: ld.observed_at,
    receivedAt: new Date().toISOString(),
    sourceMode: "simulated",
  };
}

function appendCapped(buf: Measurement[], m: Measurement): Measurement[] {
  const next = buf.concat(m);
  if (next.length > MAX_HISTORY) return next.slice(next.length - MAX_HISTORY);
  return next;
}

/**
 * Live rolling history of heart_rate and spo2 telemetry for a recipient.
 *
 * Reads `adapter.getBackendDevices(recipientId)` directly and accumulates
 * samples into per-metric ring buffers capped at MAX_HISTORY. Dedup is by
 * (deviceId, kind, observedAt); the value is intentionally NOT part of the
 * dedup key because a steady sensor that emits bpm=72 every second must
 * produce a new chart point for every distinct timestamp, otherwise the
 * chart would degenerate to a single dot.
 *
 * The effect runs on every render. Re-renders happen because (a) the host
 * page re-renders for any state change (range toggles, SSE hint-triggered
 * invalidations, etc.) — at which point the effect re-reads the adapter
 * state and accumulates any new points, or (b) the hook itself calls
 * `setHrItems`/`setSpo2Items` inside the effect when new points arrive,
 * which schedules another re-render and effect run.
 *
 * The dedup Set inside buffersRef ensures each unique sample is appended
 * at most once, so re-running the effect is safe and cheap.
 *
 * No backend code is changed; no new EventSource is created; no interval
 * polling is introduced. The hook only consumes the existing live state.
 */
export function useBackendDeviceHistory(recipientId: string): {
  hrItems: Measurement[];
  spo2Items: Measurement[];
  isLiveshowcase: boolean;
} {
  const adapter = useAdapter();
  const isLiveshowcase = recipientId === "r_liveshowcase";

  // Rolling buffers and dedup state — mutated only inside the accumulation effect.
  const buffersRef = useRef({
    hr: [] as Measurement[],
    spo2: [] as Measurement[],
    seen: new Set<string>(),
  });

  const [hrItems, setHrItems] = useState<Measurement[]>([]);
  const [spo2Items, setSpo2Items] = useState<Measurement[]>([]);

  // Reset buffers when the recipient context changes.
  const lastRecipientRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastRecipientRef.current !== recipientId) {
      lastRecipientRef.current = recipientId;
      buffersRef.current = { hr: [], spo2: [], seen: new Set() };
      setHrItems([]);
      setSpo2Items([]);
    }
  }, [recipientId]);

  // Accumulation effect. Reads the latest adapter state, appends any new
  // live points to the ref buffers, and pushes the updated arrays into
  // React state. The effect re-runs on every render (no deps array) — the
  // dedup Set ensures correctness.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isLiveshowcase) return;
    const snapshot = adapter.getBackendDevices(recipientId);
    if (!snapshot || Object.keys(snapshot).length === 0) return;
    const b = buffersRef.current;
    let changed = false;
    for (const device of Object.values(snapshot)) {
      if (!device.id) continue;
      const ld = device.latest_data;
      if (!ld) continue;
      if (ld.kind !== "heart_rate" && ld.kind !== "spo2") continue;
      const m = toMeasurement(device.id, ld);
      if (!m) continue;
      const dedupKey = `${m.deviceId}|${m.metric}|${m.observedAt}`;
      if (b.seen.has(dedupKey)) continue;
      b.seen.add(dedupKey);
      if (b.seen.size > DEDUP_MAX) {
        const first = b.seen.values().next().value;
        if (first !== undefined) b.seen.delete(first);
      }
      if (m.metric === "heart_rate") {
        b.hr = appendCapped(b.hr, m);
      } else {
        b.spo2 = appendCapped(b.spo2, m);
      }
      changed = true;
    }
    if (changed) {
      setHrItems([...b.hr]);
      setSpo2Items([...b.spo2]);
    }
  });

  return { hrItems, spo2Items, isLiveshowcase };
}
