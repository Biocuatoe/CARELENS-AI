"""SSE broadcaster. Maintains a set of async generators and yields to each."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import AsyncGenerator

from demo_control.state import current_seq, full_state

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Broadcaster
# ---------------------------------------------------------------------------

_broadcasters: set[asyncio.Queue] = set()
_lock = asyncio.Lock()


async def _broadcast(message: dict) -> None:
    """Push a message to all connected clients."""
    async with _lock:
        queues = list(_broadcasters)
    log.info("[SSE] broadcast to %d clients, msg_type=%s", len(queues), message.get("type"))
    for q in queues:
        await q.put(json.dumps(message, default=str))


async def connect() -> AsyncGenerator[dict, None]:
    """
    Yield the full current state on connect (snapshot), then yield diffs
    whenever new state is pushed via ``push_state_update``.

    ``last_seq`` query param from the client is ignored here; the snapshot is
    always sent so reconnecting clients get a full picture.
    """
    queue: asyncio.Queue = asyncio.Queue()
    async with _lock:
        _broadcasters.add(queue)
    log.info("[SSE] client connected, total_clients=%d", len(_broadcasters))
    try:
        # Snapshot on connect
        yield full_state()
        while True:
            msg = await queue.get()
            log.info("[SSE] yielded update to client")
            yield msg
    finally:
        async with _lock:
            _broadcasters.discard(queue)
        log.info("[SSE] client disconnected, total_clients=%d", len(_broadcasters))


async def push_state_update() -> int:
    """
    Call after any state mutation to broadcast a state_update to all clients.

    Returns the new sequence number.
    """
    state = full_state()
    seq = state["seq"]
    log.info("[SSE] push_state_update called, seq=%s", seq)
    await _broadcast({
        "type": "state_update",
        "state": state,
    })
    log.info("[SSE] push_state_update broadcast complete, seq=%s", seq)
    return seq
