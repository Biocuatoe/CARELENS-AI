/**
 * Admin dashboard API: device registry, per-day activity report, audit history, voice recordings, voice-playback commands and
 * scheduled reminders. Admin identity here is a real `clm_` session row (the same table the Google sign-in fills); Google itself
 * is covered by admin-auth.test.ts. Everything is synthetic: device traffic goes through the real device routes with
 * source_mode "simulated", which the report labels as such.
 *
 * This proves the Worker logic in the Workers test runtime. It does not prove a deployed Worker, real Google sign-in, or any
 * physical ESP32 behaviour.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  TestClock,
  captureFixture,
  dbAll,
  dbFirst,
  deviceClock,
  freshDb,
  harness,
  heartbeat,
  imuEvent,
  ok,
  problemCode,
  provision,
  sendImu,
  uploadCapture,
  type Harness,
  type World,
} from "./helpers";
import { LAME_16K_MONO, insertLegacyWav, mp3, mp3DurationMs, mp3Frame, wav } from "./audio";
import { MP3_CONTRACT } from "../src/media";
import { sha256Hex } from "../src/util";

const OWNER = "owner.ops@example.invalid";
const ADMIN_ENV = { ADMIN_BOOTSTRAP_EMAILS: OWNER };

let h: Harness;
let w: World;
let clock: TestClock;
let admin: string;
let adminId: string;
let testNumber = 0;

/** A signed-in admin without the Google round trip: the admin row and the session row the exchange would have written. */
async function adminSession(role: "owner" | "admin", email: string, expiresAt = "2030-01-01T00:00:00.000Z"): Promise<{ token: string; adminId: string }> {
  const token = `clm_test-session-${role}-${email.length}-${++testNumber}`;
  const id = `adm_test_${testNumber}`;
  const at = "2026-10-19T02:00:00.000Z";
  await h.env.DB.batch([
    h.env.DB.prepare(`INSERT INTO admins (admin_id, email, role, status, created_at) VALUES (?1, ?2, ?3, 'active', ?4)`).bind(id, email, role, at),
    h.env.DB.prepare(`INSERT INTO admin_sessions (token_id, admin_id, token_sha256, created_at, expires_at, auth_at) VALUES (?1, ?2, ?3, ?4, ?5, ?4)`).bind(`ats_${testNumber}`, id, await sha256Hex(token), at, expiresAt),
  ]);
  return { token, adminId: id };
}

const api = (path: string) => `/api/admin/v1${path}`;
const get = (path: string, token: string | null = admin) => h.call("GET", api(path), { token });
const post = (path: string, json: unknown, token: string | null = admin) => h.call("POST", api(path), { token, json });

async function uploadVoice(bytes: Uint8Array = LAME_16K_MONO, title = "Lời nhắc thử", token: string | null = admin, deviceId = w.deviceId, contentType = "audio/mpeg") {
  return h.call("POST", api(`/devices/${deviceId}/voice-messages?title=${encodeURIComponent(title)}`), { token, body: bytes, headers: { "content-type": contentType } });
}

/** The device's heartbeat as firmware ≥ 0.2.0 sends it (ADR-025), or as older firmware does (`codecs` null). */
async function reportCodecs(codecs: string[] | null) {
  const hb = heartbeat(h, w.deviceId) as { status: Record<string, unknown> };
  if (codecs) hb.status.audio_codecs = codecs;
  await ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: hb }));
}

/** A recording this device can play: an MP3, after the device reported MP3 playback. */
async function voiceId(): Promise<string> {
  await reportCodecs(["pcm_s16le", "mp3"]);
  const r = await ok<{ voice_message: { voice_message_id: string } }>(await uploadVoice(), 201);
  return r.voice_message.voice_message_id;
}

const voiceCommandBody = (voice: string, key = "key-0001-aaaa", extra: Record<string, unknown> = {}) => ({ voice_message_id: voice, idempotency_key: key, expires_in_seconds: 300, confirm: true, ...extra });

type Command = { command_id: string; status: string; played_confirmed_by_device: boolean; created_by: string };

async function deviceNext() {
  const res = await h.call("GET", "/api/device/v1/commands/next", { token: w.deviceToken });
  return res.status === 204 ? null : ((await res.json()) as { command: { command_id: string } | null });
}
const deviceStatus = (commandId: string, status: string, reason: string | null = null) =>
  h.call("POST", `/api/device/v1/commands/${commandId}/status`, {
    token: w.deviceToken,
    json: { schema_version: "command-status.v2", device_id: w.deviceId, clock: deviceClock(h), status, reason_code: reason, detail: null },
  });

beforeEach(async () => {
  await freshDb();
  clock = new TestClock(); // 2026-10-19T03:00:00Z = 10:00 on 2026-10-19 in Asia/Ho_Chi_Minh
  h = harness(clock, ADMIN_ENV);
  const call = h.call.bind(h);
  const ip = `198.51.100.${(testNumber % 200) + 1}`;
  h.call = (method, path, opts = {}) => call(method, path, { ip, ...opts });
  w = await provision(h);
  const session = await adminSession("owner", OWNER);
  admin = session.token;
  adminId = session.adminId;
});

const ROUTES: Array<[string, string]> = [
  ["GET", "/capabilities"],
  ["GET", "/devices"],
  ["GET", "/devices/esp32-x"],
  ["GET", "/devices/esp32-x/activity?date=2026-10-19"],
  ["GET", "/devices/esp32-x/voice-messages"],
  ["POST", "/devices/esp32-x/voice-messages?title=t"],
  ["GET", "/voice-messages/vm_x/audio"],
  ["POST", "/devices/esp32-x/voice-commands"],
  ["GET", "/devices/esp32-x/commands"],
  ["GET", "/commands/cmd_x"],
  ["POST", "/commands/cmd_x/cancel"],
  ["GET", "/devices/esp32-x/reminders"],
  ["POST", "/devices/esp32-x/reminders"],
  ["POST", "/reminders/rem_x/pause"],
  ["POST", "/reminders/rem_x/resume"],
  ["POST", "/reminders/rem_x/cancel"],
  ["GET", "/audit"],
];

describe("authorization of the dashboard API", () => {
  it("answers 401 to no credential and to every other kind of credential, on every route", async () => {
    const others: Array<[string, string | null]> = [
      ["no token", null],
      ["caregiver", w.caregiverToken],
      ["viewer", w.viewerToken],
      ["device", w.deviceToken],
      ["agent", w.agentToken],
      ["a made-up admin session", "clm_this-session-does-not-exist"],
    ];
    let n = 0;
    for (const [method, path] of ROUTES) {
      for (const [who, token] of others) {
        // A new client address per request: failed authentications are rate limited per address, which is not under test here.
        const res = await h.call(method, api(path), { token, ip: `192.0.2.${++n % 250}`, json: method === "POST" ? {} : undefined });
        expect(res.status, `${method} ${path} as ${who}`).toBe(401);
        await res.arrayBuffer();
      }
    }
  });

  it("refuses an expired or revoked admin session, and an owner who left the bootstrap list", async () => {
    const expired = await adminSession("admin", "expired@example.invalid", "2026-10-19T02:30:00.000Z");
    expect((await get("/devices", expired.token)).status).toBe(401);
    const revoked = await adminSession("admin", "revoked@example.invalid");
    await h.env.DB.prepare(`UPDATE admin_sessions SET revoked_at = ?1 WHERE admin_id = ?2`).bind("2026-10-19T02:59:00.000Z", revoked.adminId).run();
    expect((await get("/devices", revoked.token)).status).toBe(401);
    expect((await h.call("GET", api("/devices"), { token: admin, envOverrides: { ADMIN_BOOTSTRAP_EMAILS: "someone.else@example.invalid" } })).status).toBe(401);
    expect((await get("/devices")).status).toBe(200);
  });

  it("accepts a plain admin role for reads and writes the same way (no role string comes from the request)", async () => {
    const plain = await adminSession("admin", "plain.admin@example.invalid");
    expect((await get("/devices", plain.token)).status).toBe(200);
    expect((await uploadVoice(LAME_16K_MONO, "x", plain.token)).status).toBe(201);
  });
});

describe("capabilities", () => {
  it("states plainly that text-to-speech does not exist and that device playback is unverified", async () => {
    const c = await ok<{ tts: { available: boolean }; audio: Record<string, any>; device_playback: string; reminders: { timezone: string } }>(await get("/capabilities"));
    expect(c.tts.available).toBe(false);
    // ADR-025: the upload format is MP3 and says so; the legacy WAV format is listed as playback-only.
    expect(c.audio).toMatchObject({ content_type: "audio/mpeg", codec: "mp3", sample_rates_hz: [...MP3_CONTRACT.sampleRates], max_bytes: 2_000_000, max_duration_ms: 60_000 });
    expect(c.audio.legacy_wav).toMatchObject({ upload: "refused", playback: "supported", sample_rates_hz: [16000] });
    expect(c.device_playback).toBe("not_verified_with_hardware");
    expect(c.reminders.timezone).toBe("Asia/Ho_Chi_Minh");
  });
});

describe("device registry", () => {
  it("lists registered devices with credential state only, never credential material", async () => {
    const res = await get("/devices");
    const text = await res.clone().text();
    expect(text).not.toContain(w.deviceToken);
    expect(text).not.toMatch(/token_sha256|"cld_|cla_|clc_/);
    const list = JSON.parse(text) as { items: Array<Record<string, any>> };
    const d = list.items.find((x) => x.device_id === w.deviceId)!;
    expect(d).toMatchObject({ status: "active", credential: { state: "active", version: 1 }, connected: false, last_seen_at: null, heartbeat: null, last_capture: null, last_event: null, has_simulated_records_7d: false });
    expect(d.commands).toEqual({ active: {}, last_24h: {} });
  });

  it("returns an empty list (not an error) when no device is registered, and 404 for an unknown device", async () => {
    // A fresh database is the honest way to get "none registered".
    await freshDb();
    const s = await adminSession("owner", OWNER);
    const empty = await ok<{ items: unknown[] }>(await get("/devices", s.token));
    expect(empty.items).toEqual([]);
    const missing = await get("/devices/esp32-unknown", s.token);
    expect(missing.status).toBe(404);
    expect(await problemCode(missing)).toBe("not_found");
  });

  it("reflects what the device really sent: heartbeat, capture, event, last contact, simulated labelling", async () => {
    await ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: heartbeat(h, w.deviceId) }));
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-ops-1", capturedAt: "2026-10-19T02:59:00.000Z" });
    await uploadCapture(h, w.deviceToken, fx);
    await ok(await h.call("POST", "/api/device/v1/imu-events", { token: w.deviceToken, json: imuEvent(h, { deviceId: w.deviceId, triggerId: "trg-ops-1", triggeredAt: "2026-10-19T02:59:30.000Z" }) }), 201);
    const detail = await ok<{ device: Record<string, any>; last_boot: Record<string, any> | null }>(await get(`/devices/${w.deviceId}`));
    expect(detail.device).toMatchObject({
      firmware_version: "test-fw",
      connected: true,
      heartbeat: { status: { camera: "ok", imu: "ok", speaker: "ok", wifi_rssi_dbm: -60 } },
      last_capture: { status: "uploaded", source_mode: "simulated" },
      last_event: { event_type: "imu_trigger", source_mode: "simulated" },
      has_simulated_records_7d: true,
    });
    expect(detail.last_boot).toMatchObject({ boot_id: "boot-test-0001" });
    // A device that stopped talking is "not connected", never shown healthy.
    clock.advance(3600);
    expect((await ok<{ device: Record<string, any> }>(await get(`/devices/${w.deviceId}`))).device.connected).toBe(false);
  });

  it("counts open and recently finished commands per device", async () => {
    const vm = await voiceId();
    await ok(await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm)), 201);
    const d = (await ok<{ device: Record<string, any> }>(await get(`/devices/${w.deviceId}`))).device;
    expect(d.commands.active).toEqual({ queued: 1 });
  });
});

describe("daily activity report", () => {
  const LOCAL_DAY = "2026-10-19"; // [2026-10-18T17:00:00.000Z, 2026-10-19T17:00:00.000Z) in UTC+7
  const presence = (hour: string, firstSeen: string) =>
    h.env.DB.prepare(`INSERT INTO device_presence (device_id, hour_utc, first_seen_at, last_seen_at, request_count) VALUES (?1, ?2, ?3, ?3, 1)`).bind(w.deviceId, hour, firstSeen);
  const report = async (date = LOCAL_DAY, deviceId = w.deviceId, token: string | null = admin) =>
    ok<{ period: { start: string; end: string }; sources: Record<string, any>; entries: Array<Record<string, any>>; timezone: string; in_future: boolean }>(await get(`/devices/${deviceId}/activity?date=${date}`, token));

  it("uses the half-open UTC interval of the local day: start included, end excluded, at millisecond resolution", async () => {
    await h.env.DB.batch([
      presence("2026-10-18T16", "2026-10-18T16:59:59.999Z"), // 23:59:59.999 on the 18th (local)
      presence("2026-10-18T17", "2026-10-18T17:00:00.000Z"), // 00:00:00.000 on the 19th
      presence("2026-10-19T16", "2026-10-19T16:59:59.999Z"), // 23:59:59.999 on the 19th
      presence("2026-10-19T17", "2026-10-19T17:00:00.000Z"), // 00:00:00.000 on the 20th
    ]);
    const r = await report();
    expect(r.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(r.period).toMatchObject({ start: "2026-10-18T17:00:00.000Z", end: "2026-10-19T17:00:00.000Z" });
    expect(r.entries.filter((e) => e.source === "presence").map((e) => e.at)).toEqual(["2026-10-18T17:00:00.000Z", "2026-10-19T16:59:59.999Z"]);
    // Each record lands on exactly one day.
    const prev = await report("2026-10-18");
    const next = await report("2026-10-20");
    expect(prev.entries.filter((e) => e.source === "presence").map((e) => e.at)).toEqual(["2026-10-18T16:59:59.999Z"]);
    expect(next.entries.filter((e) => e.source === "presence").map((e) => e.at)).toEqual(["2026-10-19T17:00:00.000Z"]);
  });

  it("merges real device, agent-job and admin records chronologically and keeps simulated data labelled", async () => {
    await ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: heartbeat(h, w.deviceId) }));
    await uploadCapture(h, w.deviceToken, await captureFixture({ deviceId: w.deviceId, captureId: "cap-ops-2", capturedAt: "2026-10-19T02:58:00.000Z" }));
    await ok(await h.call("POST", "/api/device/v1/imu-events", { token: w.deviceToken, json: imuEvent(h, { deviceId: w.deviceId, triggerId: "trg-ops-2", triggeredAt: "2026-10-19T02:59:00.000Z" }) }), 201);
    await sendImu(h, w.deviceToken, w.deviceId, { from: "2026-10-19T02:59:10.000Z", until: "2026-10-19T02:59:12.000Z" });
    const vm = await voiceId();
    const cmd = await ok<{ command: Command }>(await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm)), 201);
    const r = await report();

    const at = r.entries.map((e) => e.at);
    expect(at).toEqual([...at].sort());
    const kinds = new Set(r.entries.map((e) => e.kind));
    for (const k of ["boot", "heartbeat_latest", "capture", "imu_trigger", "imu_hour_summary", "command", "command_event", "vision_job", "voice.upload", "command.create"]) expect(kinds, k).toContain(k);
    expect(r.entries.find((e) => e.kind === "capture")).toMatchObject({ source_mode: "simulated", status: "uploaded", detail: { media_deleted: false } });
    expect(r.entries.find((e) => e.kind === "imu_trigger")).toMatchObject({ source_mode: "simulated" });
    const commandEntry = r.entries.find((e) => e.kind === "command")!;
    expect(commandEntry).toMatchObject({ ref_id: cmd.command.command_id, status: "queued", detail: { created_by_kind: "admin", played_confirmed_by_device: false } });
    // The admin's own actions appear, attributed to the admin, with ids and enums only.
    const created = r.entries.find((e) => e.kind === "command.create")!;
    expect(created.detail).toMatchObject({ actor_type: "admin", actor_id: adminId });
    expect(JSON.stringify(r)).not.toMatch(/clm_|cld_|clc_|cla_|sha256|r2_key|media\/|data:image|base64/);
  });

  it("separates 'no records' from 'not kept' and 'not stored': an empty day still reports every source", async () => {
    const r = await report("2026-10-19");
    expect(r.entries.filter((e) => e.source !== "admin_actions")).toEqual([]);
    expect(r.sources.events).toMatchObject({ status: "ok", count: 0 });
    expect(r.sources.heartbeat.status).toBe("partial");
    expect(r.sources.agent_connectivity.status).toBe("not_stored");
    expect(r.sources.device_connectivity_changes.status).toBe("not_stored");
    expect(r.sources.imu.status).toBe("ok");
  });

  it("marks raw IMU as past retention for old days instead of showing an empty, healthy-looking day", async () => {
    const old = await report("2026-10-10");
    expect(old.sources.imu).toMatchObject({ status: "retention_expired" });
    expect(old.sources.imu.note).toMatch(/72/);
    clock.set("2026-10-19T17:30:00.000Z"); // 72 h of retention reach back to 2026-10-16T17:30Z, before the 18th began
    expect((await report("2026-10-18")).sources.imu.status).toBe("ok");
    clock.set("2026-10-21T10:00:00.000Z"); // retention window starts 2026-10-18T10:00Z, inside the 18th/19th local days
    expect((await report("2026-10-18")).sources.imu.status).toBe("partial");
  });

  it("flags a source that hit the per-source row cap as truncated rather than complete", async () => {
    const statements = [];
    for (let i = 0; i < 301; i++) {
      const hour = `2026-10-19T${String(i).padStart(3, "0")}`;
      statements.push(presence(hour, `2026-10-19T0${Math.floor(i / 100)}:${String(Math.floor((i % 100) / 2)).padStart(2, "0")}:${String((i % 2) * 30).padStart(2, "0")}.000Z`));
    }
    await h.env.DB.batch(statements);
    const r = await report();
    expect(r.sources.presence).toMatchObject({ status: "truncated", count: 300 });
    expect(r.entries.filter((e) => e.source === "presence")).toHaveLength(300);
  });

  it("answers errors as errors: bad date 400, unknown device 404, wrong credential 401; a future day is empty but marked", async () => {
    for (const bad of ["", "2026-13-01", "2026-02-30", "19-10-2026", "2026-10-19T00:00:00Z"]) {
      const res = await get(`/devices/${w.deviceId}/activity?date=${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(400);
      expect(await problemCode(res)).toBe("invalid_date");
    }
    expect((await get(`/devices/esp32-unknown/activity?date=${LOCAL_DAY}`)).status).toBe(404);
    expect((await get(`/devices/${w.deviceId}/activity?date=${LOCAL_DAY}`, w.caregiverToken)).status).toBe(401);
    const future = await report("2026-12-01");
    expect(future).toMatchObject({ in_future: true, entries: [] });
  });

  it("does not leak another device's records into this device's day", async () => {
    const otherDeviceId = w.deviceId.replace("-a", "-b");
    await ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.otherDeviceToken, json: heartbeat(h, otherDeviceId) }));
    await uploadCapture(h, w.otherDeviceToken, await captureFixture({ deviceId: otherDeviceId, captureId: "cap-other", capturedAt: "2026-10-19T02:58:00.000Z" }));
    const r = await report();
    expect(r.entries.filter((e) => ["capture", "heartbeat_latest", "boot"].includes(e.kind))).toEqual([]);
  });
});

describe("voice recordings", () => {
  it("stores an admin upload privately, attributes it to the admin, and serves it only to admins", async () => {
    const res = await uploadVoice(mp3({ seconds: 2 }), "Chào buổi sáng");
    const body = await ok<{ voice_message: { voice_message_id: string; title: string; audio: { sample_rate_hz: number; duration_ms: number } } }>(res, 201);
    expect(body.voice_message.audio).toMatchObject({ content_type: "audio/mpeg", sample_rate_hz: 16000, duration_ms: mp3DurationMs({ seconds: 2 }) });
    const row = await dbFirst<{ created_by: string; recipient_id: string }>(`SELECT created_by, recipient_id FROM audio_assets WHERE asset_id = ?1`, body.voice_message.voice_message_id);
    expect(row).toEqual({ created_by: `admin:${adminId}`, recipient_id: w.recipientId });
    const preview = await get(`/voice-messages/${body.voice_message.voice_message_id}/audio`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("audio/mpeg");
    expect(preview.headers.get("cache-control")).toMatch(/no-store/);
    expect((await preview.arrayBuffer()).byteLength).toBe(mp3({ seconds: 2 }).length);
    expect((await get(`/voice-messages/${body.voice_message.voice_message_id}/audio`, w.caregiverToken)).status).toBe(401);
    // The caregiver of the same recipient also sees it through the existing viewer API (it is the recipient's recording).
    const list = await ok<{ items: Array<{ voice_message_id: string }> }>(await h.call("GET", `/api/app/v1/recipients/${w.recipientId}/voice-messages`, { token: w.caregiverToken }));
    expect(list.items.map((i) => i.voice_message_id)).toContain(body.voice_message.voice_message_id);
    expect(await dbAll(`SELECT action, actor_type, actor_id FROM audit_log WHERE action = 'voice.upload'`)).toEqual([{ action: "voice.upload", actor_type: "admin", actor_id: adminId }]);
  });

  it("accepts every MP3 sample rate and layout of the contract, unchanged", async () => {
    for (const rate of MP3_CONTRACT.sampleRates) {
      for (const channels of [1, 2] as const) {
        const bytes = mp3({ seconds: 1, rate, channels });
        const body = await ok<{ voice_message: { audio: Record<string, unknown> } }>(await uploadVoice(bytes, `${rate}-${channels}`), 201);
        expect(body.voice_message.audio, `${rate} Hz ${channels} ch`).toMatchObject({ sample_rate_hz: rate, channels, byte_size: bytes.length, duration_ms: mp3DurationMs({ seconds: 1, rate }) });
      }
    }
  });

  it("rejects what is not a playable MP3: WAV, other layers, spliced or truncated streams, wrong length, too large, other types", async () => {
    const layer2 = new Uint8Array([...mp3Frame(44100, 2, 128, 2).bytes, ...mp3Frame(44100, 2, 128, 2).bytes]);
    const spliced = new Uint8Array([...mp3({ rate: 16000 }), ...mp3({ rate: 44100, channels: 2 })]);
    const cases: Array<[string, Uint8Array, string, number]> = [
      ["WAV upload", wav(), "audio/wav", 415],
      ["WAV bytes labelled MP3", wav(), "audio/mpeg", 422],
      ["Layer II", layer2, "audio/mpeg", 422],
      ["rate changes mid-stream", spliced, "audio/mpeg", 422],
      ["truncated last frame", LAME_16K_MONO.subarray(0, LAME_16K_MONO.length - 50), "audio/mpeg", 422],
      ["too short", mp3({ seconds: 0.3 }), "audio/mpeg", 422],
      ["too long", mp3({ seconds: 61 }), "audio/mpeg", 422],
      ["not audio", new TextEncoder().encode("ID3 not audio at all, just text of enough length to look like something"), "audio/mpeg", 422],
      ["octet-stream", LAME_16K_MONO, "application/octet-stream", 415],
      ["too large", new Uint8Array(2_100_000), "audio/mpeg", 413],
    ];
    for (const [name, bytes, type, status] of cases) {
      const res = await h.call("POST", api(`/devices/${w.deviceId}/voice-messages?title=t`), { token: admin, body: bytes, headers: { "content-type": type } });
      expect(res.status, name).toBe(status);
      await res.arrayBuffer();
    }
    expect(await dbAll(`SELECT 1 FROM audio_assets`)).toEqual([]);
    expect((await h.env.AUDIO.list()).objects).toEqual([]); // nothing stored for a refused upload
    expect((await h.call("POST", api(`/devices/${w.deviceId}/voice-messages`), { token: admin, body: LAME_16K_MONO, headers: { "content-type": "audio/mpeg" } })).status).toBe(400);
  });

  it("targets only an active device of the registry", async () => {
    expect((await uploadVoice(LAME_16K_MONO, "x", admin, "esp32-unknown")).status).toBe(404);
    await ok(await h.call("POST", api(`/devices/${w.deviceId}/revoke`), { token: admin }));
    expect((await uploadVoice()).status).toBe(404);
    expect((await get(`/devices/${w.deviceId}/voice-messages`)).status).toBe(200); // history of a revoked device stays readable
  });
});

describe("voice-playback commands", () => {
  it("requires the explicit confirmation flag and exact fields, and creates nothing otherwise", async () => {
    const vm = await voiceId();
    for (const bad of [voiceCommandBody(vm, "key-0001-aaaa", { confirm: false }), { ...voiceCommandBody(vm), confirm: undefined }, voiceCommandBody(vm, "short"), voiceCommandBody(vm, "key-0001-aaaa", { expires_in_seconds: 5 }), voiceCommandBody(vm, "key-0001-aaaa", { expires_in_seconds: 99999 }), voiceCommandBody(vm, "key-0001-aaaa", { extra: 1 }), voiceCommandBody(vm, "key-0001-aaaa", { command_type: "emergency_buzzer" })]) {
      const res = await post(`/devices/${w.deviceId}/voice-commands`, bad);
      expect(res.status, JSON.stringify(bad)).toBe(422);
      await res.arrayBuffer();
    }
    expect(await dbAll(`SELECT 1 FROM device_commands`)).toEqual([]);
  });

  it("creates one queued command per idempotency key; a double click or retry returns the same command", async () => {
    const vm = await voiceId();
    const first = await ok<{ command: Command; created: boolean }>(await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm)), 201);
    expect(first).toMatchObject({ created: true, command: { status: "queued", played_confirmed_by_device: false, created_by: `admin:${adminId}` } });
    const again = await ok<{ command: Command; created: boolean }>(await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm)), 200);
    expect(again).toMatchObject({ created: false, command: { command_id: first.command.command_id } });
    expect(await dbAll(`SELECT 1 FROM device_commands`)).toHaveLength(1);
    // Same key, different content: refused, not silently replayed.
    const other = await voiceId();
    const clash = await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(other));
    expect(clash.status).toBe(409);
    expect(await problemCode(clash)).toBe("idempotency_key_reused");
    // Another admin using the same key text gets their own command: keys are scoped per actor.
    const second = await adminSession("admin", "second.admin@example.invalid");
    const theirs = await ok<{ created: boolean }>(await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm), second.token), 201);
    expect(theirs.created).toBe(true);
  });

  it("refuses a recording of another recipient, an unknown one, one the device cannot play, an unknown or revoked device", async () => {
    const vm = await voiceId();
    const foreign = await ok<{ voice_message: { voice_message_id: string } }>(await h.call("POST", `/api/app/v1/recipients/${w.otherRecipientId}/voice-messages?title=x`, { token: w.outsiderToken, body: LAME_16K_MONO, headers: { "content-type": "audio/mpeg" } }), 201);
    expect((await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(foreign.voice_message.voice_message_id))).status).toBe(422);
    expect((await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody("vm_does_not_exist"))).status).toBe(422);
    expect((await post(`/devices/esp32-unknown/voice-commands`, voiceCommandBody(vm))).status).toBe(404);
    // A legacy WAV at a rate outside the device profile, and an MP3 for firmware that never reported MP3 playback.
    const legacy = await insertLegacyWav(w.recipientId);
    const strict = await h.call("POST", api(`/devices/${w.deviceId}/voice-commands`), { token: admin, json: voiceCommandBody(legacy.assetId, "key-rate-0001"), envOverrides: { DEVICE_AUDIO_SAMPLE_RATES: "24000" } });
    expect([strict.status, await problemCode(strict)]).toEqual([422, "audio_not_playable"]);
    await reportCodecs(null);
    const oldFirmware = await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm, "key-old-fw-0001"));
    expect([oldFirmware.status, await problemCode(oldFirmware)]).toEqual([422, "audio_not_playable"]);
    await reportCodecs(["pcm_s16le", "mp3"]);
    await ok(await h.call("POST", api(`/devices/${w.deviceId}/revoke`), { token: admin }));
    expect((await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm, "key-after-revoke"))).status).toBe(404);
  });

  it("shows 'played' only after the device itself reports completed, through the whole acknowledgement lifecycle", async () => {
    const vm = await voiceId();
    const { command } = await ok<{ command: Command }>(await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm)), 201);
    const status = async () => (await ok<{ command: Command; timeline: Array<{ status: string; actor_type: string }> }>(await get(`/commands/${command.command_id}`)));

    expect((await status()).command).toMatchObject({ status: "queued", played_confirmed_by_device: false });
    const delivered = await deviceNext();
    expect(delivered?.command?.command_id).toBe(command.command_id);
    expect((await status()).command).toMatchObject({ status: "delivered", played_confirmed_by_device: false });
    await ok(await deviceStatus(command.command_id, "accepted"));
    expect((await status()).command).toMatchObject({ status: "accepted", played_confirmed_by_device: false });
    await ok(await deviceStatus(command.command_id, "started"));
    expect((await status()).command).toMatchObject({ status: "started", played_confirmed_by_device: false });
    await ok(await deviceStatus(command.command_id, "completed"));
    const done = await status();
    expect(done.command).toMatchObject({ status: "completed", played_confirmed_by_device: true });
    expect(done.timeline.map((e) => e.status)).toEqual(["queued", "delivered", "accepted", "started", "completed"]);
    expect(done.timeline.filter((e) => e.actor_type === "device").map((e) => e.status)).toEqual(["accepted", "started", "completed"]);
    const listed = await ok<{ items: Command[] }>(await get(`/devices/${w.deviceId}/commands`));
    expect(listed.items[0]).toMatchObject({ command_id: command.command_id, status: "completed" });
  });

  it("maps a device failure, a rejection and an expiry to their own states and never to 'played'", async () => {
    const vm = await voiceId();
    const failed = await ok<{ command: Command }>(await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm, "key-fail-0001")), 201);
    await deviceNext();
    await ok(await deviceStatus(failed.command.command_id, "accepted"));
    await ok(await deviceStatus(failed.command.command_id, "failed", "playback_error"));
    const rejected = await ok<{ command: Command }>(await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm, "key-reject-001")), 201);
    await deviceNext();
    await ok(await deviceStatus(rejected.command.command_id, "rejected", "audio_format_unsupported"));
    const expiring = await ok<{ command: Command }>(await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm, "key-expire-001", { expires_in_seconds: 30 })), 201);
    clock.advance(31);
    await h.cron("* * * * *");
    const view = async (id: string) => (await ok<{ command: Command & { status_reason: string | null } }>(await get(`/commands/${id}`))).command;
    expect(await view(failed.command.command_id)).toMatchObject({ status: "failed", status_reason: "playback_error", played_confirmed_by_device: false });
    expect(await view(rejected.command.command_id)).toMatchObject({ status: "rejected", status_reason: "audio_format_unsupported", played_confirmed_by_device: false });
    expect(await view(expiring.command.command_id)).toMatchObject({ status: "expired", played_confirmed_by_device: false });
    // An expired command is not handed to a device that reconnects later.
    expect(await deviceNext()).toBeNull();
  });

  it("cancels a queued command at once and asks the device to stop one it already holds", async () => {
    const vm = await voiceId();
    const queued = await ok<{ command: Command }>(await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm, "key-cancel-001")), 201);
    const c1 = await ok<{ command: Command }>(await post(`/commands/${queued.command.command_id}/cancel`, {}), 200);
    expect(c1.command.status).toBe("cancelled");
    expect(await deviceNext()).toBeNull();

    const live = await ok<{ command: Command }>(await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm, "key-cancel-002")), 201);
    await deviceNext();
    const c2 = await ok<{ command: Command; cancel_pending_device_confirmation: boolean }>(await post(`/commands/${live.command.command_id}/cancel`, {}), 202);
    expect(c2.cancel_pending_device_confirmation).toBe(true);
    expect(c2.command.status).toBe("delivered"); // the truth until the device confirms
    expect((await post(`/commands/cmd_unknown/cancel`, {})).status).toBe(404);
    const audit = await dbAll<{ action: string; actor_type: string; actor_id: string }>(`SELECT action, actor_type, actor_id FROM audit_log WHERE action IN ('command.create','command.cancel') ORDER BY at, rowid`);
    expect(audit.every((a) => a.actor_type === "admin" && a.actor_id === adminId)).toBe(true);
    expect(audit.map((a) => a.action)).toEqual(["command.create", "command.cancel", "command.create", "command.cancel"]);
  });

  it("throttles an admin's changes per minute and writes nothing past the limit", async () => {
    const vm = await voiceId();
    let blockedAt = -1;
    for (let i = 0; i < 30 && blockedAt < 0; i++) {
      const res = await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm, `key-throttle-${String(i).padStart(3, "0")}`));
      if (res.status === 429) {
        blockedAt = i;
        expect(res.headers.get("retry-after")).toBeTruthy();
      } else expect(res.status).toBe(201);
      await res.arrayBuffer();
    }
    expect(blockedAt).toBeGreaterThanOrEqual(15);
    expect(blockedAt).toBeLessThanOrEqual(20);
    expect(await dbAll(`SELECT 1 FROM device_commands`)).toHaveLength(blockedAt);
    clock.advance(61);
    expect((await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm, "key-throttle-after"))).status).toBe(201);
  });
});

describe("scheduled reminders", () => {
  const once = (over: Record<string, unknown> = {}, schedule: Record<string, unknown> = {}) => ({
    idempotency_key: "rem-key-0001",
    kind: "water",
    label: "Uống nước",
    voice_message_id: null,
    deadline_minutes: 15,
    schedule: { type: "once", local_date: "2026-10-19", local_time: "10:05", ...schedule }, // 03:05Z, five minutes after the test clock
    confirm: true,
    ...over,
  });
  type Rem = { reminder_id: string; state: string; schedule_kind: string; next_occurrence_at: string | null; window_open: boolean; paused_at: string | null; status: string; timezone: string; last_dispatch: null | { status: string; played_confirmed_by_device: boolean; command_id: string } };
  const create = (body: unknown = once()) => post(`/devices/${w.deviceId}/reminders`, body);
  const list = async () => (await ok<{ items: Rem[] }>(await get(`/devices/${w.deviceId}/reminders`))).items;
  const commands = () => dbAll<{ command_id: string; status: string; source_type: string; not_before: string; expires_at: string }>(`SELECT command_id, status, source_type, not_before, expires_at FROM device_commands WHERE command_type = 'reminder' ORDER BY not_before`);

  it("stores a one-time reminder in Asia/Ho_Chi_Minh and reports the next occurrence in UTC", async () => {
    const r = await ok<{ reminder: Rem; created: boolean }>(await create(), 201);
    expect(r.created).toBe(true);
    expect(r.reminder).toMatchObject({ state: "scheduled", schedule_kind: "once", next_occurrence_at: "2026-10-19T03:05:00.000Z", window_open: false, timezone: "Asia/Ho_Chi_Minh", last_dispatch: null });
    const row = await dbFirst<{ created_by: string; start_date: string; end_date: string; days_of_week_json: string; times_local_json: string }>(`SELECT * FROM reminder_schedules`);
    expect(row).toMatchObject({ created_by: `admin:${adminId}`, start_date: "2026-10-19", end_date: "2026-10-19", times_local_json: '["10:05"]' });
    expect(JSON.parse(row!.days_of_week_json)).toEqual([1]); // 2026-10-19 is a Monday
  });

  it("rejects the past, the distant future, malformed times and missing confirmation, storing nothing", async () => {
    const cases: Array<[string, unknown, number, string?]> = [
      ["past time today", once({}, { local_time: "09:59" }), 422, "schedule_in_past"],
      ["now (less than 30 s ahead)", once({}, { local_time: "10:00" }), 422, "schedule_in_past"],
      ["yesterday", once({}, { local_date: "2026-10-18" }), 422, "schedule_in_past"],
      ["more than a year ahead", once({}, { local_date: "2027-11-01" }), 422, "schedule_too_far"],
      ["not a calendar date", once({}, { local_date: "2026-02-30" }), 422, "invalid_date"],
      ["bad time", once({}, { local_time: "25:61" }), 422],
      ["no confirmation", once({ confirm: false }), 422],
      ["unknown field", once({ timezone: "UTC" }), 422],
      ["deadline too long", once({ deadline_minutes: 241 }), 422],
      ["weekly: start in the past", once({}, { type: "weekly", days_of_week: [1], times_local: ["10:30"], start_date: "2026-10-18", end_date: null, local_date: undefined, local_time: undefined }), 422, "schedule_in_past"],
      ["weekly: end before start", once({}, { type: "weekly", days_of_week: [1], times_local: ["10:30"], start_date: "2026-10-20", end_date: "2026-10-19", local_date: undefined, local_time: undefined }), 422, "invalid_date_range"],
      ["weekly: no day left before the end date", once({}, { type: "weekly", days_of_week: [2], times_local: ["10:30"], start_date: "2026-10-19", end_date: "2026-10-19", local_date: undefined, local_time: undefined }), 422, "no_future_occurrence"],
      ["voice of nobody", once({ voice_message_id: "vm_missing" }), 422, "voice_message_not_found"],
    ];
    for (const [name, body, status, code] of cases) {
      const res = await create(body);
      expect(res.status, name).toBe(status);
      if (code) expect(await problemCode(res), name).toBe(code);
      else await res.arrayBuffer();
    }
    expect((await post(`/devices/esp32-unknown/reminders`, once())).status).toBe(404);
    expect(await dbAll(`SELECT 1 FROM reminder_schedules`)).toEqual([]);
  });

  it("is idempotent: a retry returns the same reminder, a different body under the same key is refused", async () => {
    const first = await ok<{ reminder: Rem }>(await create(), 201);
    const again = await ok<{ reminder: Rem; created: boolean }>(await create(), 200);
    expect(again).toMatchObject({ created: false, reminder: { reminder_id: first.reminder.reminder_id } });
    const clash = await create(once({ label: "Uống thuốc" }));
    expect(clash.status).toBe(409);
    expect(await problemCode(clash)).toBe("idempotency_key_reused");
    expect(await dbAll(`SELECT 1 FROM reminder_schedules`)).toHaveLength(1);
    expect(await dbAll(`SELECT 1 FROM audit_log WHERE action = 'reminder.create'`)).toHaveLength(1);
  });

  it("dispatches exactly one command at the scheduled minute, however many times the scheduler runs", async () => {
    await ok(await create(), 201);
    await h.cron("* * * * *");
    expect(await commands()).toEqual([]); // not due yet: no timer in the browser, and nothing early
    clock.set("2026-10-19T03:05:00.000Z");
    await h.cron("* * * * *");
    await h.cron("* * * * *");
    clock.advance(30);
    await h.cron("* * * * *");
    const cmds = await commands();
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ source_type: "reminder", status: "queued", not_before: "2026-10-19T03:05:00.000Z", expires_at: "2026-10-19T03:20:00.000Z" });
    const [r] = await list();
    expect(r).toMatchObject({ state: "scheduled", window_open: true, last_dispatch: { status: "queued", played_confirmed_by_device: false } });
  });

  it("reports playback only from the device's own acknowledgement, and finishes a one-time reminder afterwards", async () => {
    await ok(await create(), 201);
    clock.set("2026-10-19T03:05:00.000Z");
    await h.cron("* * * * *");
    const next = await deviceNext();
    await ok(await deviceStatus(next!.command!.command_id, "accepted"));
    await ok(await deviceStatus(next!.command!.command_id, "started"));
    expect((await list())[0]!.last_dispatch).toMatchObject({ status: "started", played_confirmed_by_device: false });
    await ok(await deviceStatus(next!.command!.command_id, "completed"));
    expect((await list())[0]!.last_dispatch).toMatchObject({ status: "completed", played_confirmed_by_device: true });
    clock.set("2026-10-19T03:21:00.000Z");
    expect((await list())[0]).toMatchObject({ state: "finished", next_occurrence_at: null });
  });

  it("never replays a stale reminder to a device that was offline past the deadline", async () => {
    await ok(await create(), 201);
    clock.set("2026-10-19T03:05:00.000Z");
    await h.cron("* * * * *"); // queued, but the device never polls
    clock.set("2026-10-19T03:21:00.000Z"); // window ended at 03:20
    await h.cron("* * * * *");
    expect(await commands()).toMatchObject([{ status: "expired" }]);
    expect(await deviceNext()).toBeNull();
    clock.advance(3600);
    await h.cron("* * * * *");
    expect(await commands()).toHaveLength(1);
    expect((await list())[0]).toMatchObject({ state: "finished", last_dispatch: { status: "expired", played_confirmed_by_device: false } });
  });

  it("pauses without cancelling (nothing is queued while paused) and resumes only while something is left", async () => {
    const { reminder } = await ok<{ reminder: Rem }>(await create(), 201);
    const paused = await ok<{ reminder: Rem; duplicate: boolean }>(await post(`/reminders/${reminder.reminder_id}/pause`, {}));
    expect(paused).toMatchObject({ duplicate: false, reminder: { state: "paused", status: "active" } });
    expect(paused.reminder.paused_at).toBeTruthy();
    expect((await ok<{ duplicate: boolean }>(await post(`/reminders/${reminder.reminder_id}/pause`, {}))).duplicate).toBe(true);
    clock.set("2026-10-19T03:05:00.000Z");
    await h.cron("* * * * *");
    expect(await commands()).toEqual([]);
    // Resumed inside the delivery window: it is dispatched once, not before.
    clock.set("2026-10-19T03:06:00.000Z");
    const resumed = await ok<{ reminder: Rem }>(await post(`/reminders/${reminder.reminder_id}/resume`, {}));
    expect(resumed.reminder).toMatchObject({ state: "scheduled", paused_at: null });
    await h.cron("* * * * *");
    await h.cron("* * * * *");
    expect(await commands()).toHaveLength(1);
  });

  it("will not resume a paused one-time reminder whose window has passed", async () => {
    const { reminder } = await ok<{ reminder: Rem }>(await create(), 201);
    await ok(await post(`/reminders/${reminder.reminder_id}/pause`, {}));
    clock.set("2026-10-19T04:00:00.000Z");
    const res = await post(`/reminders/${reminder.reminder_id}/resume`, {});
    expect(res.status).toBe(409);
    expect(await problemCode(res)).toBe("schedule_finished");
    expect((await list())[0]!.state).toBe("paused");
  });

  it("cancels: no future dispatch, queued commands cancelled, repeated cancel is harmless, a cancelled one cannot be revived", async () => {
    const { reminder } = await ok<{ reminder: Rem }>(await create(), 201);
    clock.set("2026-10-19T03:05:00.000Z");
    await h.cron("* * * * *");
    expect(await commands()).toMatchObject([{ status: "queued" }]);
    const cancelled = await ok<{ reminder: Rem; duplicate: boolean }>(await post(`/reminders/${reminder.reminder_id}/cancel`, {}));
    expect(cancelled).toMatchObject({ duplicate: false, reminder: { state: "cancelled", status: "cancelled" } });
    expect(await commands()).toMatchObject([{ status: "cancelled" }]);
    expect((await ok<{ duplicate: boolean }>(await post(`/reminders/${reminder.reminder_id}/cancel`, {}))).duplicate).toBe(true);
    const revive = await post(`/reminders/${reminder.reminder_id}/resume`, {});
    expect(revive.status).toBe(409);
    expect(await problemCode(revive)).toBe("reminder_cancelled");
    expect((await post(`/reminders/rem_missing/pause`, {})).status).toBe(404);
    clock.advance(60);
    await h.cron("* * * * *");
    expect(await commands()).toHaveLength(1);
    const actions = await dbAll<{ action: string }>(`SELECT action FROM audit_log WHERE action LIKE 'reminder.%' ORDER BY at, rowid`);
    expect(actions.map((a) => a.action)).toEqual(["reminder.create", "reminder.cancel"]);
  });

  it("supports a weekly schedule: first occurrence, skipped days, end date, one command per day", async () => {
    const weekly = once({ idempotency_key: "rem-key-weekly" }, { type: "weekly", days_of_week: [1, 2], times_local: ["10:05", "20:00"], start_date: "2026-10-19", end_date: "2026-10-20", local_date: undefined, local_time: undefined });
    const { reminder } = await ok<{ reminder: Rem }>(await create(weekly), 201);
    expect(reminder).toMatchObject({ schedule_kind: "recurring", next_occurrence_at: "2026-10-19T03:05:00.000Z" });
    for (const t of ["2026-10-19T03:05:00.000Z", "2026-10-19T13:00:00.000Z", "2026-10-20T03:05:00.000Z", "2026-10-20T13:00:00.000Z", "2026-10-21T03:05:00.000Z"]) {
      clock.set(t);
      await h.cron("* * * * *");
      await h.cron("* * * * *");
    }
    expect((await commands()).map((c) => c.not_before)).toEqual(["2026-10-19T03:05:00.000Z", "2026-10-19T13:00:00.000Z", "2026-10-20T03:05:00.000Z", "2026-10-20T13:00:00.000Z"]);
    expect((await list())[0]).toMatchObject({ state: "finished", next_occurrence_at: null });
  });

  it("carries a recording through the reminder to the device, and refuses a recording the device cannot play", async () => {
    const vm = await voiceId();
    await ok(await create(once({ voice_message_id: vm })), 201);
    clock.set("2026-10-19T03:05:00.000Z");
    await h.cron("* * * * *");
    const next = await h.call("GET", "/api/device/v1/commands/next", { token: w.deviceToken });
    const body = (await next.json()) as { command: { command_type: string; action: { kind: string; audio: { voice_message_id: string; sample_rate_hz: number; path: string } } } };
    expect(body.command).toMatchObject({ command_type: "reminder", action: { kind: "reminder", audio: { voice_message_id: vm, sample_rate_hz: 16000 } } });
    expect(body.command.action.audio.path).toMatch(/^\/api\/device\/v1\/commands\/cmd_[a-f0-9]+\/audio$/); // authenticated retrieval, no public URL
    expect(body.command.action.audio).toMatchObject({ content_type: "audio/mpeg", codec: "mp3" });
    await reportCodecs(null); // firmware without MP3: a reminder with this recording is refused up front
    const strict = await h.call("POST", api(`/devices/${w.deviceId}/reminders`), { token: admin, json: once({ idempotency_key: "rem-key-rate-01", voice_message_id: vm }, { local_time: "10:30" }) });
    expect(strict.status).toBe(422);
    expect(await problemCode(strict)).toBe("audio_not_playable");
  });

  it("leaves the caregiver reminder API and the existing view contract intact", async () => {
    const body = { device_id: w.deviceId, kind: "water", label: "Uống nước", voice_message_id: null, times_local: ["10:30"], days_of_week: [1, 2, 3, 4, 5, 6, 7], timezone: "Asia/Ho_Chi_Minh", start_date: "2026-10-19", end_date: null, deadline_minutes: 15 };
    const created = await ok<{ reminder: Record<string, unknown> }>(await h.call("POST", `/api/app/v1/recipients/${w.recipientId}/reminders`, { token: w.caregiverToken, json: body }), 201);
    expect(created.reminder).toMatchObject({ status: "active", paused_at: null, version: 1 });
    // An admin can see and pause a caregiver's reminder too; the caregiver view then shows it as paused.
    const id = created.reminder.reminder_id as string;
    await ok(await post(`/reminders/${id}/pause`, {}));
    const seen = await ok<{ items: Array<{ paused_at: string | null }> }>(await h.call("GET", `/api/app/v1/recipients/${w.recipientId}/reminders`, { token: w.caregiverToken }));
    expect(seen.items[0]!.paused_at).toBeTruthy();
  });
});

describe("audit history", () => {
  it("lists admin changes newest first with cursor paging and an action filter, without secrets", async () => {
    const vm = await voiceId();
    await ok(await post(`/devices/${w.deviceId}/voice-commands`, voiceCommandBody(vm)), 201);
    clock.advance(1);
    await ok(await post(`/devices/${w.deviceId}/reminders`, { idempotency_key: "rem-key-audit", kind: "water", label: "Uống nước", voice_message_id: null, deadline_minutes: 15, schedule: { type: "once", local_date: "2026-10-19", local_time: "10:30" }, confirm: true }), 201);
    const all = await ok<{ items: Array<{ action: string; actor_type: string; actor_id: string; detail: unknown; at: string }>; next_cursor: string | null }>(await get("/audit?limit=100"));
    const actions = all.items.map((i) => i.action);
    expect(actions.indexOf("reminder.create")).toBeLessThan(actions.indexOf("command.create"));
    expect(all.items.every((i, n, a) => n === 0 || a[n - 1]!.at >= i.at)).toBe(true);
    expect(JSON.stringify(all)).not.toMatch(/clm_|cld_|clc_|cla_|Uống nước/);
    const page1 = await ok<{ items: Array<{ audit_id: string }>; next_cursor: string | null }>(await get("/audit?limit=2"));
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).toBeTruthy();
    const page2 = await ok<{ items: Array<{ audit_id: string }> }>(await get(`/audit?limit=100&cursor=${encodeURIComponent(page1.next_cursor!)}`));
    expect(page2.items.map((i) => i.audit_id)).not.toContain(page1.items[0]!.audit_id);
    expect(page2.items.length + 2).toBe(all.items.length);
    const only = await ok<{ items: Array<{ action: string }> }>(await get("/audit?action_prefix=reminder."));
    expect(only.items.map((i) => i.action)).toEqual(["reminder.create"]);
    expect((await get("/audit?action_prefix=%25%3B")).status).toBe(400);
    expect((await get("/audit?cursor=!!!")).status).toBe(400);
    expect((await get("/audit?limit=0")).status).toBe(400);
  });
});
