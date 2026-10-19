/** Device commands: lifecycle acknowledgements, priority, expiry, cancellation; reminders; voice audio delivery. */
import { beforeEach, describe, expect, it } from "vitest";
import {
  TEST_TRIAL_POLICY,
  captureFixture,
  claim,
  complete,
  dbAll,
  dbFirst,
  deviceClock,
  freshDb,
  harness,
  imuEvent,
  ok,
  problemCode,
  provision,
  sendImu,
  sha256,
  uploadCapture,
  visionResult,
  type Harness,
  type World,
} from "./helpers";

let h: Harness;
let w: World;
const R = () => `/api/app/v1/recipients/${w.recipientId}`;

function wav(seconds = 1, rate = 16000): Uint8Array {
  const data = rate * seconds * 2;
  const buf = new Uint8Array(44 + data);
  const v = new DataView(buf.buffer);
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  s(8, "WAVE");
  s(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  s(36, "data");
  v.setUint32(40, data, true);
  for (let i = 44; i < buf.length; i += 2) v.setInt16(i, Math.round(Math.sin(i / 20) * 1000), true); // synthetic tone, no voice
  return buf;
}

async function uploadVoice(token = w.caregiverToken, body: Uint8Array = wav()) {
  return h.call("POST", `${R()}/voice-messages?title=${encodeURIComponent("Lời nhắc thử")}`, { token, body, headers: { "content-type": "audio/wav" } });
}

type DeviceCommand = { command_id: string; command_type: string; preempts_lower_priority: boolean; expires_in_ms: number; action: Record<string, any> };
async function next(token = w.deviceToken): Promise<{ command: DeviceCommand | null; cancel_command_ids: string[] } | null> {
  const res = await h.call("GET", "/api/device/v1/commands/next", { token });
  return res.status === 204 ? null : ((await res.json()) as { command: DeviceCommand | null; cancel_command_ids: string[] });
}

async function status(commandId: string, s: string, reason: string | null = null) {
  return h.call("POST", `/api/device/v1/commands/${commandId}/status`, {
    token: w.deviceToken,
    json: { schema_version: "command-status.v2", device_id: w.deviceId, clock: deviceClock(h), status: s, reason_code: reason, detail: null },
  });
}

async function voiceCommand(key: string, expires = 120) {
  const vm = await ok<{ voice_message: { voice_message_id: string } }>(await uploadVoice(), 201);
  return ok<{ command: { command_id: string; status: string; played_confirmed_by_device: boolean } }>(
    await h.call("POST", `${R()}/devices/${w.deviceId}/commands`, {
      token: w.caregiverToken,
      json: { command_type: "play_voice_message", voice_message_id: vm.voice_message.voice_message_id, idempotency_key: key, expires_in_seconds: expires },
    }),
    201,
  );
}

beforeEach(async () => {
  await freshDb();
  h = harness(undefined, { FUSION_POLICY_JSON: TEST_TRIAL_POLICY });
  h.clock.set("2026-10-19T01:00:00.000Z"); // 08:00 local
  w = await provision(h);
});

describe("voice messages", () => {
  it("stores validated WAV audio privately with versions; viewers may listen but not upload", async () => {
    expect((await uploadVoice(w.viewerToken)).status).toBe(403);
    expect((await uploadVoice(w.outsiderToken)).status).toBe(404);
    expect(await problemCode(await uploadVoice(w.caregiverToken, new TextEncoder().encode("not audio")))).toBe("invalid_audio");
    // The device profile plays 16 kHz only (DEVICE_AUDIO_SAMPLE_RATES default): 8 kHz is refused, not accepted silently.
    expect(await problemCode(await uploadVoice(w.caregiverToken, wav(1, 8000)))).toBe("invalid_audio");
    const created = await ok<{ voice_message: { voice_message_id: string; audio: { duration_ms: number; version: number; sha256: string } } }>(await uploadVoice(), 201);
    expect(created.voice_message.audio).toMatchObject({ duration_ms: 1000, version: 1, sha256: await sha256(wav()) });
    const id = created.voice_message.voice_message_id;
    const listen = await h.call("GET", `${R()}/voice-messages/${id}/audio`, { token: w.viewerToken });
    expect([listen.status, listen.headers.get("content-type"), listen.headers.get("cache-control")]).toEqual([200, "audio/wav", "private, no-store"]);
    expect((await listen.arrayBuffer()).byteLength).toBe(44 + 32000);
    expect((await h.call("GET", `/api/app/v1/recipients/${w.otherRecipientId}/voice-messages/${id}/audio`, { token: w.outsiderToken })).status).toBe(404);
    const replaced = await ok<{ voice_message: { current_version: number } }>(
      await h.call("PUT", `${R()}/voice-messages/${id}/audio`, { token: w.caregiverToken, body: wav(2), headers: { "content-type": "audio/wav" } }),
    );
    expect(replaced.voice_message.current_version).toBe(2);
    const keys = (await h.env.AUDIO.list()).objects.map((o) => o.key).sort();
    expect(keys).toEqual([`voice/${w.recipientId}/${id}/v1.wav`, `voice/${w.recipientId}/${id}/v2.wav`]);
  });

  it("delivers audio only for the active command, with integrity metadata and byte ranges", async () => {
    const vm = await ok<{ voice_message: { voice_message_id: string } }>(await uploadVoice(), 201);
    const create = (key: string) =>
      h.call("POST", `${R()}/devices/${w.deviceId}/commands`, {
        token: w.caregiverToken,
        json: { command_type: "play_voice_message", voice_message_id: vm.voice_message.voice_message_id, idempotency_key: key, expires_in_seconds: 300 },
      });
    const created = await ok<{ command: { command_id: string }; created: boolean }>(await create("play-0001"), 201);
    expect((await ok<{ created: boolean }>(await create("play-0001"), 200)).created).toBe(false); // idempotent
    const id = created.command.command_id;
    const audioPath = `/api/device/v1/commands/${id}/audio`;
    expect((await h.call("GET", audioPath, { token: w.deviceToken })).status).toBe(404); // queued, not delivered
    const delivered = (await next())!.command!;
    expect(delivered.action).toMatchObject({ kind: "voice", audio: { path: audioPath, content_type: "audio/wav", codec: "pcm_s16le", sample_rate_hz: 16000, byte_size: 32044 } });
    expect(delivered.expires_in_ms).toBe(300_000);
    const full = await h.call("GET", audioPath, { token: w.deviceToken });
    const bytes = new Uint8Array(await full.arrayBuffer());
    expect(await sha256(bytes)).toBe(delivered.action.audio.sha256); // the device can verify what it plays
    const part = await h.call("GET", audioPath, { token: w.deviceToken, headers: { range: "bytes=0-1023" } });
    expect([part.status, part.headers.get("content-range"), (await part.arrayBuffer()).byteLength]).toEqual([206, "bytes 0-1023/32044", 1024]);
    expect((await h.call("GET", audioPath, { token: w.deviceToken, headers: { range: "bytes=99999-" } })).status).toBe(416);
    expect((await h.call("GET", audioPath, { token: w.otherDeviceToken })).status).toBe(404);
    await ok(await status(id, "accepted"));
    await ok(await status(id, "started"));
    await ok(await status(id, "completed"));
    expect((await h.call("GET", audioPath, { token: w.deviceToken })).status).toBe(404);
    const timeline = await ok<{ command: { played_confirmed_by_device: boolean }; timeline: Array<{ status: string; actor_type: string }> }>(
      await h.call("GET", `${R()}/commands/${id}`, { token: w.viewerToken }),
    );
    expect(timeline.command.played_confirmed_by_device).toBe(true);
    expect(timeline.timeline.map((t) => `${t.status}:${t.actor_type}`)).toEqual(["queued:system", "delivered:system", "accepted:device", "started:device", "completed:device"]);
  });
});

describe("command state machine", () => {
  it("records playback only from device reports and rejects invalid transitions", async () => {
    const { command } = await voiceCommand("sm-000001");
    expect(command.played_confirmed_by_device).toBe(false);
    expect((await status(command.command_id, "completed")).status).toBe(409); // still queued
    await next();
    await ok(await status(command.command_id, "accepted"));
    expect((await ok<{ duplicate: boolean }>(await status(command.command_id, "accepted"))).duplicate).toBe(true); // retried ack
    await ok(await status(command.command_id, "started"));
    expect((await status(command.command_id, "accepted")).status).toBe(409);
    expect(await problemCode(await status(command.command_id, "failed"))).toBe("reason_required");
    expect(await problemCode(await status(command.command_id, "cancelled"))).toBe("invalid_transition"); // nobody asked to cancel
    await ok(await status(command.command_id, "completed"));
    const row = await dbFirst<{ status: string; accepted_at: string; started_at: string; finished_at: string }>(`SELECT status, accepted_at, started_at, finished_at FROM device_commands`);
    expect(row?.status).toBe("completed");
    expect([row?.accepted_at, row?.started_at, row?.finished_at].every(Boolean)).toBe(true);
  });

  it("stores device rejections with their reason code (e.g. a corrupted download)", async () => {
    const { command } = await voiceCommand("sm-000006");
    await next();
    await ok(await status(command.command_id, "rejected", "audio_integrity_failed"));
    expect(await dbFirst(`SELECT status, status_reason FROM device_commands`)).toEqual({ status: "rejected", status_reason: "audio_integrity_failed" });
  });

  it("re-delivers an unacknowledged command with the same id, then fails it after the attempt limit", async () => {
    const { command } = await voiceCommand("sm-000002");
    for (let i = 0; i < 3; i++) {
      expect((await next())?.command?.command_id).toBe(command.command_id);
      h.clock.advance(31);
    }
    expect(await next()).toBeNull();
    expect(await dbFirst(`SELECT status, status_reason FROM device_commands WHERE command_id = ?1`, command.command_id)).toEqual({ status: "failed", status_reason: "no_acknowledgement" });
  });

  it("expires commands of an offline device instead of replaying them later, and refuses late starts", async () => {
    const { command } = await voiceCommand("sm-000003");
    h.clock.advance(121);
    expect(await next()).toBeNull();
    expect((await dbFirst<{ status: string }>(`SELECT status FROM device_commands WHERE command_id = ?1`, command.command_id))?.status).toBe("expired");
    const late = await voiceCommand("sm-000007", 60);
    await next();
    h.clock.advance(61);
    const res = await status(late.command.command_id, "accepted");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { stop_playback: boolean }).stop_playback).toBe(true);
  });

  it("delivers an emergency buzzer while a lower-priority command is playing", async () => {
    const { command } = await voiceCommand("sm-000004");
    await next();
    await ok(await status(command.command_id, "started"));
    expect(await next()).toBeNull(); // nothing of equal or lower priority while playing
    await sendImu(h, w.deviceToken, w.deviceId, { from: "2026-10-19T00:59:50.000Z", until: "2026-10-19T01:00:00.000Z", impacts: ["2026-10-19T00:59:57.000Z"] });
    await ok(await h.call("POST", "/api/device/v1/imu-events", { token: w.deviceToken, json: imuEvent(h, { deviceId: w.deviceId, triggerId: "trg-e", triggeredAt: "2026-10-19T00:59:56.500Z" }) }), 201);
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-e", mode: "triggered", triggerId: "trg-e", capturedAt: "2026-10-19T00:59:55.000Z" });
    await uploadCapture(h, w.deviceToken, fx);
    const job = await claim(h, w.agentToken, ["vision"]);
    await ok(await complete(h, w.agentToken, job!, visionResult({ captureId: "cap-e", frameCount: 40, scores: [1, 1, 1] })));
    const emergency = (await next())!.command!;
    expect(emergency.command_type).toBe("emergency_buzzer");
    expect(emergency.preempts_lower_priority).toBe(true);
    expect(emergency.action).toMatchObject({ kind: "buzzer", pattern: "repeat_beep", duration_ms: 30000 });
    // The device stops the voice message and says why.
    await ok(await status(command.command_id, "failed", "preempted_by_higher_priority"));
  });

  it("cancels queued commands at once and commands on the device only after it confirms; never the emergency buzzer", async () => {
    const queued = await voiceCommand("sm-000005");
    expect((await h.call("POST", `${R()}/commands/${queued.command.command_id}/cancel`, { token: w.caregiverToken })).status).toBe(200);
    expect(await next()).toBeNull();
    expect((await h.call("POST", `${R()}/commands/${queued.command.command_id}/cancel`, { token: w.caregiverToken })).status).toBe(409);
    expect((await h.call("POST", `${R()}/commands/${queued.command.command_id}/cancel`, { token: w.viewerToken })).status).toBe(403);

    const onDevice = await voiceCommand("sm-000008");
    await next();
    await ok(await status(onDevice.command.command_id, "started"));
    const req = await h.call("POST", `${R()}/commands/${onDevice.command.command_id}/cancel`, { token: w.caregiverToken });
    expect(req.status).toBe(202);
    expect((await dbFirst<{ status: string }>(`SELECT status FROM device_commands WHERE command_id = ?1`, onDevice.command.command_id))?.status).toBe("started");
    expect((await next())?.cancel_command_ids).toEqual([onDevice.command.command_id]);
    await ok(await status(onDevice.command.command_id, "cancelled", "cancel_requested"));
    expect((await dbFirst<{ status: string }>(`SELECT status FROM device_commands WHERE command_id = ?1`, onDevice.command.command_id))?.status).toBe("cancelled");
  });
});

describe("reminders", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    device_id: w.deviceId,
    kind: "medication",
    label: "Thuốc buổi sáng (nội dung do người chăm sóc nhập)",
    voice_message_id: null,
    times_local: ["08:05"],
    days_of_week: [1, 2, 3, 4, 5, 6, 7],
    timezone: "Asia/Ho_Chi_Minh",
    start_date: "2026-10-01",
    end_date: null,
    deadline_minutes: 15,
    ...over,
  });

  it("validates schedules and references", async () => {
    const cases: Array<[Record<string, unknown>, number]> = [
      [body({ times_local: ["25:00"] }), 422],
      [body({ timezone: "Mars/Base" }), 422],
      [body({ end_date: "2026-09-01" }), 422],
      [body({ voice_message_id: "vm_missing" }), 422],
      [body({ device_id: "esp32-elsewhere" }), 422],
      [body({ times_local: ["08:00", "08:00"] }), 422],
    ];
    for (const [b, code] of cases) expect((await h.call("POST", `${R()}/reminders`, { token: w.caregiverToken, json: b })).status).toBe(code);
  });

  it("queues one command per due occurrence (idempotent across cron runs) and expires it at the deadline", async () => {
    const created = await ok<{ reminder: { reminder_id: string; version: number } }>(await h.call("POST", `${R()}/reminders`, { token: w.caregiverToken, json: body() }), 201);
    await h.cron("* * * * *"); // 08:00 local: not due yet
    expect(await dbAll(`SELECT * FROM device_commands`)).toHaveLength(0);
    h.clock.set("2026-10-19T01:05:30.000Z");
    await h.cron("* * * * *");
    await h.cron("* * * * *");
    const cmds = await dbAll<{ command_type: string; not_before: string; expires_at: string; payload_json: string }>(`SELECT command_type, not_before, expires_at, payload_json FROM device_commands`);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ command_type: "reminder", not_before: "2026-10-19T01:05:00.000Z", expires_at: "2026-10-19T01:20:00.000Z" });
    expect(JSON.parse(cmds[0]!.payload_json)).toMatchObject({ kind: "medication", voice: null, fallback: "default_tone" });
    h.clock.set("2026-10-19T01:21:00.000Z"); // device was offline the whole window
    expect(await next()).toBeNull();
    expect((await dbFirst<{ status: string }>(`SELECT status FROM device_commands`))?.status).toBe("expired");
    const stale = await h.call("PATCH", `${R()}/reminders/${created.reminder.reminder_id}`, { token: w.caregiverToken, json: { expected_version: 9, label: "x" } });
    expect(stale.status).toBe(409);
    await ok(await h.call("PATCH", `${R()}/reminders/${created.reminder.reminder_id}`, { token: w.caregiverToken, json: { expected_version: 1, times_local: ["09:00"] } }));
    await ok(await h.call("DELETE", `${R()}/reminders/${created.reminder.reminder_id}`, { token: w.caregiverToken }));
    h.clock.set("2026-10-19T02:01:00.000Z");
    await h.cron("* * * * *");
    expect(await dbAll(`SELECT * FROM device_commands WHERE status = 'queued'`)).toHaveLength(0);
  });

  it("supersedes a stale occurrence that the device never accepted, so a returning device plays only the latest", async () => {
    await ok(await h.call("POST", `${R()}/reminders`, { token: w.caregiverToken, json: body({ times_local: ["08:05", "08:10"], deadline_minutes: 30 }) }), 201);
    h.clock.set("2026-10-19T01:05:30.000Z");
    await h.cron("* * * * *");
    h.clock.set("2026-10-19T01:10:30.000Z");
    await h.cron("* * * * *");
    const rows = await dbAll<{ command_id: string; status: string; superseded_by: string | null; not_before: string }>(`SELECT command_id, status, superseded_by, not_before FROM device_commands ORDER BY not_before`);
    expect(rows.map((r) => r.status)).toEqual(["superseded", "queued"]);
    expect(rows[0]?.superseded_by).toBe(rows[1]?.command_id);
    expect((await next())?.command?.command_id).toBe(rows[1]?.command_id);
  });

  it("deleting a voice message removes its audio, cancels queued commands and asks the device to stop delivered ones", async () => {
    const vm = await ok<{ voice_message: { voice_message_id: string } }>(await uploadVoice(), 201);
    const id = vm.voice_message.voice_message_id;
    await ok(await h.call("POST", `${R()}/reminders`, { token: w.caregiverToken, json: body({ voice_message_id: id }) }), 201);
    h.clock.set("2026-10-19T01:05:30.000Z");
    await h.cron("* * * * *");
    const delivered = (await next())!.command!;
    expect(delivered.action).toMatchObject({ kind: "reminder", audio: { voice_message_id: id, sample_rate_hz: 16000 } });
    await ok(await h.call("DELETE", `${R()}/voice-messages/${id}`, { token: w.caregiverToken }));
    expect((await h.call("GET", `/api/device/v1/commands/${delivered.command_id}/audio`, { token: w.deviceToken })).status).toBe(410);
    expect((await next())?.cancel_command_ids).toEqual([delivered.command_id]);
    expect((await h.env.AUDIO.list()).objects).toHaveLength(0);
    expect((await dbFirst<{ voice_message_id: string | null }>(`SELECT voice_message_id FROM reminder_schedules`))?.voice_message_id).toBeNull();
  });
});
