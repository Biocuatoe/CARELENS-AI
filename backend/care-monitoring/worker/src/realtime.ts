/**
 * Real-time delivery.
 *
 * One RealtimeHub Durable Object per channel ("recipient:<id>" or "agents"). Subscribers are Worker
 * invocations that hold a client's SSE response and connect to the hub over a hibernatable WebSocket, so
 * the hub sleeps (no duration billing) between changes. On a change the writer calls publish(); the hub
 * sends ready-made SSE frames to its sockets. The Worker forwards frames verbatim, sends a keepalive
 * comment every 15 s and ends the stream after SSE_MAX_LIFETIME_SECONDS (bounding CPU per invocation);
 * clients reconnect and receive a fresh first frame. No polling loop runs anywhere.
 */
import { DurableObject } from "cloudflare:workers";
import { loadConfig, type Env } from "./env";
import { buildLegacyState } from "./legacy";

type View = "legacy" | "hints" | "agent";

interface Attachment {
  view: View;
  recipientId: string | null;
  /** Legacy view only: preferred real device shown as the frontend's hub (the subscriber's config). */
  legacyDeviceId: string | null;
}

export function sseFrame(id: number | null, data: unknown): string {
  return `${id === null ? "" : `id: ${id}\n`}data: ${JSON.stringify(data)}\n\n`;
}

export class RealtimeHub extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("websocket required", { status: 426 });
    const url = new URL(request.url);
    const view = (url.searchParams.get("view") ?? "hints") as View;
    if (!["legacy", "hints", "agent"].includes(view)) return new Response("unknown view", { status: 400 });
    const tags: string[] = [view];
    const user = url.searchParams.get("user");
    if (user) tags.push(`user:${user}`);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment({
      view,
      recipientId: url.searchParams.get("recipient"),
      legacyDeviceId: url.searchParams.get("legacy_device") || null,
    } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Broadcast one change. `hint` goes to hint/agent subscribers; legacy subscribers get a full
   * state_update built once from D1 for all of them. */
  async publish(message: { recipientId: string | null; type: string; entityId: string | null; agent?: Record<string, unknown> }): Promise<number> {
    let sent = 0;
    const seqRow = message.recipientId
      ? await this.env.DB.prepare(`SELECT seq FROM recipient_streams WHERE recipient_id = ?1`).bind(message.recipientId).first<{ seq: number }>()
      : null;
    const seq = seqRow?.seq ?? 0;
    for (const ws of this.ctx.getWebSockets("hints")) {
      sent += trySend(ws, sseFrame(seq, { seq, type: message.type, entity_id: message.entityId }));
    }
    if (message.agent) for (const ws of this.ctx.getWebSockets("agent")) sent += trySend(ws, sseFrame(null, message.agent));
    const legacy = this.ctx.getWebSockets("legacy");
    if (legacy.length > 0 && message.recipientId) {
      const config = loadConfig(this.env);
      const frames = new Map<string, string>();
      for (const ws of legacy) {
        const att = ws.deserializeAttachment() as Attachment | null;
        const device = att?.legacyDeviceId ?? null;
        const key = device ?? "";
        let frame = frames.get(key);
        if (frame === undefined) {
          const state = await buildLegacyState(this.env, config, { recipientId: message.recipientId, preferredDeviceId: device }, new Date());
          frame = sseFrame(state.seq as number, { type: "state_update", state });
          frames.set(key, frame);
        }
        sent += trySend(ws, frame);
      }
    }
    return sent;
  }

  /** Close the streams of a user whose grant or token was revoked. */
  async closeUser(userId: string): Promise<number> {
    const sockets = this.ctx.getWebSockets(`user:${userId}`);
    for (const ws of sockets) {
      try {
        ws.close(4403, "access revoked");
      } catch {
        /* already closed */
      }
    }
    return sockets.length;
  }

  async subscriberCount(): Promise<number> {
    return this.ctx.getWebSockets().length;
  }

  override async webSocketMessage(): Promise<void> {
    /* subscribers never send data */
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      /* already closed */
    }
  }
}

function trySend(ws: WebSocket, frame: string): number {
  try {
    ws.send(frame);
    return 1;
  } catch {
    return 0;
  }
}

function hub(env: Env, channel: string): DurableObjectStub<RealtimeHub> {
  return env.REALTIME.get(env.REALTIME.idFromName(channel));
}

export async function notifyRecipient(env: Env, recipientId: string, type: string, entityId: string | null): Promise<void> {
  try {
    await hub(env, `recipient:${recipientId}`).publish({ recipientId, type, entityId });
  } catch (err) {
    // Delivery is best effort: the change is already committed and clients refetch on reconnect.
    console.error(JSON.stringify({ msg: "realtime_publish_failed", channel: "recipient", error: err instanceof Error ? err.message.slice(0, 120) : "unknown" }));
  }
}

export async function notifyAgents(env: Env, agent: Record<string, unknown>): Promise<void> {
  try {
    await hub(env, "agents").publish({ recipientId: null, type: "job_available", entityId: null, agent });
  } catch (err) {
    console.error(JSON.stringify({ msg: "realtime_publish_failed", channel: "agents", error: err instanceof Error ? err.message.slice(0, 120) : "unknown" }));
  }
}

export async function closeUserStreams(env: Env, recipientIds: string[], userId: string): Promise<void> {
  await Promise.all(recipientIds.map((id) => hub(env, `recipient:${id}`).closeUser(userId).catch(() => 0)));
}

const KEEPALIVE_MS = 15_000;
const encoder = new TextEncoder();

/** SSE response. When `channel` is set the stream subscribes to that hub; otherwise it only carries the
 * initial frames and keepalives until its lifetime ends. */
export async function sseResponse(
  env: Env,
  opts: { channel: string | null; params: Record<string, string>; initialFrames: string[]; lifetimeSeconds: number; headers: Record<string, string> },
): Promise<Response> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let socket: WebSocket | null = null;
  let closed = false;
  const timers: Array<ReturnType<typeof setTimeout>> = [];

  const close = () => {
    if (closed) return;
    closed = true;
    for (const t of timers) clearTimeout(t);
    try {
      socket?.close(1000, "stream ended");
    } catch {
      /* ignore */
    }
    writer.close().catch(() => undefined);
  };
  const write = (text: string) => {
    if (closed) return;
    writer.write(encoder.encode(text)).catch(close);
  };

  if (opts.channel) {
    const query = new URLSearchParams(opts.params).toString();
    const resp = await hub(env, opts.channel).fetch(`https://realtime.internal/connect?${query}`, { headers: { upgrade: "websocket" } });
    socket = resp.webSocket;
    if (!socket) throw new Error("realtime hub did not accept the subscription");
    socket.accept();
    socket.addEventListener("message", (e) => write(typeof e.data === "string" ? e.data : ""));
    socket.addEventListener("close", close);
    socket.addEventListener("error", close);
  }
  for (const frame of opts.initialFrames) write(frame);
  const keepalive = () => {
    if (closed) return;
    write(": keepalive\n\n");
    timers.push(setTimeout(keepalive, KEEPALIVE_MS));
  };
  timers.push(setTimeout(keepalive, KEEPALIVE_MS));
  timers.push(setTimeout(close, opts.lifetimeSeconds * 1000));

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      ...opts.headers,
    },
  });
}
