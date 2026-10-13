/**
 * SSE (Server-Sent Events) router for the demo bridge.
 *
 * Web clients connect to GET /api/demo/stream to receive state_update events
 * whenever the bot mutates state via Telegram commands.
 *
 * Each event is formatted as:
 *   event: state_update\n
 *   data: {...}\n\n
 */

import http from 'node:http';
import { StateStore } from './stateStore.js';

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

interface ReconnectParams {
  last_seq?: number;
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

/** Encode a value as an SSE field. */
function sseField(name: string, value: string): string {
  // SSE field lines must not contain control characters; escape newlines in data
  const escaped = value.replace(/\n/g, '\\n');
  return `${name}: ${escaped}\n`;
}

/** Build a multi-line SSE comment block (kept alive, seq check). */
function sseComment(seq: number): string {
  return `: seq=${seq}\n`;
}

// -------------------------------------------------------------------------------------------------
// Router factory
// -------------------------------------------------------------------------------------------------

/**
 * Creates an SSE router that reads state from `stateStore`.
 * Returns a handler function compatible with `http.createServer().on('request', handler)`.
 */
export function createSseRouter(stateStore: StateStore) {
  return function handleSseRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // Only handle GET /api/demo/stream
    if (url.pathname !== '/api/demo/stream' || req.method !== 'GET') {
      res.writeHead(404);
      res.end();
      return;
    }

    // Parse Last-Event-ID for reconnect (sent as query param `last_seq` by the frontend)
    const lastSeqParam = url.searchParams.get('last_seq');
    const lastSeq = lastSeqParam ? parseInt(lastSeqParam, 10) : null;

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
      // Use Last-Event-ID in reconnect (EventSource standard header)
      'Last-Event-ID': lastSeq !== null ? String(lastSeq) : '',
    });

    // Flush headers immediately
    res.flushHeaders();

    // Send initial seq comment so EventSource can set Last-Event-ID on reconnect
    const current = stateStore.snapshot();
    res.write(sseComment(current.seq));

    // If client provided last_seq, send only state updates after that seq.
    // Otherwise send a full state_update immediately.
    if (lastSeq !== null) {
      if (current.seq > lastSeq) {
        const payload = stateStore.buildPayload();
        res.write(sseField('event', 'state_update') + sseField('data', payload) + '\n');
      }
    } else {
      const payload = stateStore.buildPayload();
      res.write(sseField('event', 'state_update') + sseField('data', payload) + '\n');
    }

    res.flush?.();

    // Keep-alive ping every 25 seconds (SSE recommendation)
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
        res.flush?.();
      } catch {
        clearInterval(pingInterval);
      }
    }, 25_000);

    // Register client with state store; cleanup on disconnect
    const removeClient = stateStore.addClient((payload) => {
      try {
        res.write(sseField('event', 'state_update') + sseField('data', payload) + '\n');
        res.flush?.();
      } catch {
        // Response already closed
        removeClient();
      }
    });

    req.on('close', () => {
      clearInterval(pingInterval);
      removeClient();
    });
  };
}
