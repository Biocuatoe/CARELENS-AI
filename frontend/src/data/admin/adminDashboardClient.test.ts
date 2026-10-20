import { describe, expect, it, vi } from "vitest";
import { AdminApiError, AdminClient } from "./adminClient";
import { parseActivity, parseCapabilities, parseCommand, parseDeviceList, parseReminder } from "./adminModels";
import { xhrUploader } from "./xhrUpload";

const BASE = "https://api.test";
const TOKEN = "clm_synthetic-test-token-not-real";
const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const problem = (status: number, code: string) => json(status, { type: `urn:carelens:problem:${code}`, status, code, detail: "server detail that must not reach the user", request_id: "r" });

function fake(reply: (url: string, init: RequestInit) => Response) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    seen.push({ url: String(input), init });
    return reply(String(input), init);
  });
  return { client: new AdminClient(BASE, impl as unknown as typeof fetch), seen };
}
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

describe("dashboard requests", () => {
  it("sends every dashboard call with the Bearer session only: never in the URL, never with cookies", async () => {
    const { client, seen } = fake(() => json(200, { items: [], next_cursor: null, timezone: "Asia/Ho_Chi_Minh" }));
    await client.devices(TOKEN).catch(() => undefined);
    await client.commands(TOKEN, "esp32-1").catch(() => undefined);
    await client.reminders(TOKEN, "esp32-1").catch(() => undefined);
    await client.audit(TOKEN, { actionPrefix: "command." }).catch(() => undefined);
    await client.voiceMessages(TOKEN, "esp32-1").catch(() => undefined);
    expect(seen.map((s) => s.url)).toEqual([
      `${BASE}/api/admin/v1/devices`,
      `${BASE}/api/admin/v1/devices/esp32-1/commands?limit=20`,
      `${BASE}/api/admin/v1/devices/esp32-1/reminders`,
      `${BASE}/api/admin/v1/audit?limit=30&action_prefix=command.`,
      `${BASE}/api/admin/v1/devices/esp32-1/voice-messages`,
    ]);
    for (const s of seen) {
      expect(headersOf(s.init).authorization).toBe(`Bearer ${TOKEN}`);
      expect(s.url).not.toContain("clm_");
      expect(s.init.credentials).toBe("omit");
      expect(s.init.cache).toBe("no-store");
    }
  });

  it("encodes ids and dates into the path instead of splicing them in", async () => {
    const { client, seen } = fake(() => json(200, {}));
    await client.activity(TOKEN, "esp32/../x", "2026-10-19").catch(() => undefined);
    expect(seen[0]!.url).toBe(`${BASE}/api/admin/v1/devices/esp32%2F..%2Fx/activity?date=2026-10-19`);
  });

  it("always sends confirm: true with a voice command, and the idempotency key it was given", async () => {
    const { client, seen } = fake(() => json(201, { command: { command_id: "cmd_1", status: "queued", played_confirmed_by_device: false }, created: true }));
    const out = await client.createVoiceCommand(TOKEN, "esp32-1", { voiceMessageId: "vm_1", idempotencyKey: "key-abc-12345", expiresInSeconds: 300 });
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ voice_message_id: "vm_1", idempotency_key: "key-abc-12345", expires_in_seconds: 300, confirm: true });
    expect(seen[0]!.init.method).toBe("POST");
    expect(out.command).toMatchObject({ commandId: "cmd_1", status: "queued", playedConfirmedByDevice: false });
  });

  it("sends a reminder with the schedule as typed and no time zone of the browser's", async () => {
    const { client, seen } = fake(() => json(201, { reminder: { reminder_id: "rem_1", state: "scheduled", schedule_kind: "once" }, created: true }));
    await client.createReminder(TOKEN, "esp32-1", { idempotencyKey: "rem-key-0001", kind: "water", label: "Uống nước", voiceMessageId: null, deadlineMinutes: 15, schedule: { type: "once", local_date: "2026-10-20", local_time: "08:30" } });
    const body = JSON.parse(String(seen[0]!.init.body));
    expect(body).toEqual({ idempotency_key: "rem-key-0001", kind: "water", label: "Uống nước", voice_message_id: null, deadline_minutes: 15, schedule: { type: "once", local_date: "2026-10-20", local_time: "08:30" }, confirm: true });
  });

  it("uploads an MP3 as the raw audio/mpeg body, unchanged, with the title only in the query", async () => {
    const { client, seen } = fake(() => json(201, { voice_message: { voice_message_id: "vm_9", title: "Lời nhắc", audio: { content_type: "audio/mpeg", duration_ms: 1080, sample_rate_hz: 16000, channels: 1, byte_size: 3 } } }));
    const mp3 = new Blob([new Uint8Array([0xff, 0xf3, 0x44])], { type: "audio/mpeg" });
    const out = await client.uploadVoice(TOKEN, "esp32-1", "Lời nhắc & thử", mp3);
    expect(seen[0]!.url).toBe(`${BASE}/api/admin/v1/devices/esp32-1/voice-messages?title=${encodeURIComponent("Lời nhắc & thử")}`);
    expect(headersOf(seen[0]!.init)["content-type"]).toBe("audio/mpeg");
    expect(seen[0]!.init.body).toBe(mp3); // the same Blob: nothing converted or re-encoded
    expect(out).toMatchObject({ voiceMessageId: "vm_9", contentType: "audio/mpeg", durationMs: 1080, channels: 1 });
  });

  it("with an uploader, reports byte progress and maps a timeout or a lost connection like the fetch path", async () => {
    const mp3 = new Blob([new Uint8Array(1000)], { type: "audio/mpeg" });
    const progress: Array<[number, number]> = [];
    const seenReqs: Array<{ url: string; headers: Record<string, string>; body: Blob }> = [];
    const ok = new AdminClient(BASE, vi.fn() as unknown as typeof fetch, undefined, async (req) => {
      seenReqs.push(req);
      req.onProgress?.(500, 1000);
      req.onProgress?.(1000, 1000);
      return { kind: "response", status: 201, text: JSON.stringify({ voice_message: { voice_message_id: "vm_x", title: "t", audio: { content_type: "audio/mpeg", byte_size: 1000 } } }) };
    });
    const out = await ok.uploadVoice(TOKEN, "esp32-1", "t", mp3, (s, t) => progress.push([s, t]));
    expect(progress).toEqual([[500, 1000], [1000, 1000]]);
    expect(seenReqs[0]).toMatchObject({ url: `${BASE}/api/admin/v1/devices/esp32-1/voice-messages?title=t`, headers: { "content-type": "audio/mpeg", authorization: `Bearer ${TOKEN}` } });
    expect(seenReqs[0]!.body).toBe(mp3);
    expect(out.byteSize).toBe(1000);
    const timedOut = new AdminClient(BASE, vi.fn() as unknown as typeof fetch, undefined, async () => ({ kind: "timeout" }));
    await expect(timedOut.uploadVoice(TOKEN, "esp32-1", "t", mp3)).rejects.toMatchObject({ code: "timeout" });
    const refused = new AdminClient(BASE, vi.fn() as unknown as typeof fetch, undefined, async () => ({ kind: "response", status: 415, text: JSON.stringify({ code: "mp3_required", request_id: "r" }) }));
    await expect(refused.uploadVoice(TOKEN, "esp32-1", "t", mp3)).rejects.toBeInstanceOf(AdminApiError);
    const lost = new AdminClient(BASE, vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch, undefined, async () => ({ kind: "network" }));
    await expect(lost.uploadVoice(TOKEN, "esp32-1", "t", mp3)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("xhrUploader sends no cookies, a time limit and the headers, and turns XHR events into outcomes", async () => {
    class FakeXhr {
      static last: FakeXhr;
      opened: unknown[] = [];
      headers: Record<string, string> = {};
      withCredentials = true;
      timeout = 0;
      status = 0;
      responseText = "";
      upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      sent: unknown = null;
      constructor() {
        FakeXhr.last = this;
      }
      open(...args: unknown[]) {
        this.opened = args;
      }
      setRequestHeader(k: string, v: string) {
        this.headers[k] = v;
      }
      send(body: unknown) {
        this.sent = body;
      }
    }
    const upload = xhrUploader(() => new FakeXhr() as unknown as XMLHttpRequest);
    const body = new Blob([new Uint8Array(10)]);
    const seen: Array<[number, number]> = [];
    const pending = upload({ url: `${BASE}/x`, headers: { "content-type": "audio/mpeg" }, body, timeoutMs: 1234, onProgress: (s, t) => seen.push([s, t]) });
    const x = FakeXhr.last;
    expect([x.opened[0], x.opened[1], x.withCredentials, x.timeout, x.headers["content-type"], x.sent]).toEqual(["POST", `${BASE}/x`, false, 1234, "audio/mpeg", body]);
    x.upload.onprogress?.({ loaded: 4, total: 10, lengthComputable: true } as ProgressEvent);
    x.status = 201;
    x.responseText = "{}";
    x.onload?.();
    expect(await pending).toEqual({ kind: "response", status: 201, text: "{}" });
    expect(seen).toEqual([[4, 10]]);
    const t = upload({ url: "u", headers: {}, body, timeoutMs: 1 });
    FakeXhr.last.ontimeout?.();
    expect(await t).toEqual({ kind: "timeout" });
    const n = upload({ url: "u", headers: {}, body, timeoutMs: 1 });
    FakeXhr.last.onerror?.();
    expect(await n).toEqual({ kind: "network" });
  });

  it("fetches a recording as a blob for local playback", async () => {
    const { client, seen } = fake(() => new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { "content-type": "audio/wav" } }));
    const blob = await client.voiceAudio(TOKEN, "vm_1");
    expect(blob.size).toBe(4);
    expect(seen[0]!.url).toBe(`${BASE}/api/admin/v1/voice-messages/vm_1/audio`);
    await expect(fake(() => problem(404, "not_found")).client.voiceAudio(TOKEN, "vm_1")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("dashboard errors", () => {
  it("maps known server codes to fixed Vietnamese text and never shows the server's wording", async () => {
    const cases: Array<[Response, string, string, RegExp]> = [
      [problem(422, "schedule_in_past"), "bad_request", "schedule_in_past", /đã qua hoặc quá gần/],
      [problem(422, "audio_not_playable"), "bad_request", "audio_not_playable", /tốc độ lấy mẫu/],
      [problem(409, "idempotency_key_reused"), "conflict", "idempotency_key_reused", /trùng khóa/],
      [problem(409, "schedule_finished"), "conflict", "schedule_finished", /không còn lần nào/],
      [problem(413, "payload_too_large"), "bad_request", "payload_too_large", /quá lớn/],
      [problem(404, "not_found"), "not_found", "not_found", /chưa có API này/],
      [problem(429, "rate_limited"), "rate_limited", "", /quá nhiều/],
      [problem(401, "invalid_credential"), "unauthenticated", "", /hết hạn/],
    ];
    for (const [response, code, problemCode, text] of cases) {
      const error = await fake(() => response.clone()).client.createReminder(TOKEN, "d", { idempotencyKey: "k-0000001", kind: "water", label: "x", voiceMessageId: null, deadlineMinutes: 5, schedule: { type: "once", local_date: "2026-10-20", local_time: "08:00" } }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AdminApiError);
      expect(error).toMatchObject({ code });
      if (problemCode) expect((error as AdminApiError).problem).toBe(problemCode);
      expect((error as Error).message).toMatch(text);
      expect((error as Error).message).not.toContain("server detail");
    }
  });

  it("treats a 200 with the wrong shape as an invalid response, never as an empty list", async () => {
    for (const body of [null, {}, { items: "nope" }, []]) {
      const error = await fake(() => json(200, body)).client.devices(TOKEN).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "invalid_response" });
    }
    expect(await fake(() => json(200, { items: [] })).client.devices(TOKEN)).toMatchObject({ items: [] });
  });
});

describe("parsers", () => {
  it("keeps what the server reported and drops rows without an identifier", () => {
    const list = parseDeviceList({
      items: [
        { device_id: "esp32-1", label: "Một", status: "active", credential: { state: "active", version: 2, token_sha256: "must-not-matter" }, connected: true, commands: { active: { queued: 2, bad: "x" }, last_24h: {} }, has_simulated_records_7d: true, heartbeat: { at: "2026-10-19T03:00:00.000Z", status: { camera: "ok", wifi_rssi_dbm: -50 } } },
        { label: "no id" },
        "junk",
      ],
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ deviceId: "esp32-1", credential: { state: "active", version: 2 }, hasSimulatedRecords: true, commands: { active: { queued: 2 } }, heartbeat: { camera: "ok", imu: null, wifiRssiDbm: -50 } });
    expect(JSON.stringify(list)).not.toContain("must-not-matter");
  });

  it("never shows a device healthy or connected by default", () => {
    const [d] = parseDeviceList({ items: [{ device_id: "esp32-2" }] }).items;
    expect(d).toMatchObject({ connected: false, heartbeat: null, lastCapture: null, lastEvent: null, hasSimulatedRecords: false, status: "unknown", credential: { state: "unknown", version: null } });
  });

  it("reads 'played' only from a completed command that the server also flags", () => {
    const c = (status: string, flag: boolean) => parseCommand({ command_id: "c", status, played_confirmed_by_device: flag })!;
    expect(c("completed", true).playedConfirmedByDevice).toBe(true);
    expect(c("completed", false).playedConfirmedByDevice).toBe(false);
    expect(c("started", true).playedConfirmedByDevice).toBe(false);
    expect(c("teleported", true)).toMatchObject({ status: "unknown", playedConfirmedByDevice: false });
    expect(parseCommand({ status: "completed" })).toBeNull();
  });

  it("parses a report, keeping per-source coverage and the mark of simulated data", () => {
    const r = parseActivity({
      device: { device_id: "esp32-1", label: "Một" },
      date: "2026-10-19",
      timezone: "Asia/Ho_Chi_Minh",
      period: { start: "2026-10-18T17:00:00.000Z", end: "2026-10-19T17:00:00.000Z" },
      in_future: false,
      sources: { events: { status: "ok", count: 1 }, imu: { status: "retention_expired", count: 0, note: "n" }, bad: "x" },
      entries: [{ at: "2026-10-19T03:00:00.000Z", source: "events", kind: "imu_trigger", source_mode: "simulated", detail: { a: 1 } }, { at: "x" }, 5],
    });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ sourceMode: "simulated", refId: null, status: null });
    expect(Object.keys(r.sources)).toEqual(["events", "imu"]);
    expect(r.sources.imu).toMatchObject({ status: "retention_expired", note: "n" });
    expect(() => parseActivity({ device: {}, date: "x" })).toThrow(AdminApiError);
  });

  it("switches nothing on by default: text-to-speech is available only on an explicit true", () => {
    const caps = (tts: unknown) => parseCapabilities({ tts, audio: { sample_rates_hz: [16000], max_bytes: 5 } });
    expect(caps({ available: true }).tts.available).toBe(true);
    expect(caps({}).tts.available).toBe(false);
    expect(caps({ available: "yes" }).tts.available).toBe(false);
    expect(() => parseCapabilities({})).toThrow(AdminApiError);
  });

  it("reads a reminder's state and last delivery as reported, with unknown values marked unknown", () => {
    const r = parseReminder({ reminder_id: "rem_1", state: "weird", schedule_kind: "sometimes", last_dispatch: { command_id: "c", status: "completed", played_confirmed_by_device: true }, times_local: ["10:00", 5] })!;
    expect(r).toMatchObject({ state: "unknown", scheduleKind: "unknown", timesLocal: ["10:00"], lastDispatch: { status: "completed", playedConfirmedByDevice: true } });
    expect(parseReminder({ reminder_id: "r", last_dispatch: { command_id: "c", status: "queued", played_confirmed_by_device: true } })!.lastDispatch!.playedConfirmedByDevice).toBe(false);
  });
});
