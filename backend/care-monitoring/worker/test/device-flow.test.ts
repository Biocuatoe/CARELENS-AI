/**
 * The ESP32-S3 data-flow contract, walked end to end in the Workers test runtime with a SIMULATED device: every request below goes
 * through the real device API v2 routes with the documented payloads (docs/DEVICE_API.md) and `source_mode: "simulated"`, which a
 * production deployment rejects (ACCEPT_SIMULATED_SOURCES=false). The firmware is not flashed, so this proves the Worker's side of
 * the contract only: nothing here observes a physical camera, IMU, TLS stack or speaker.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TestClock, captureFixture, claim, complete, dbAll, deviceClock, freshDb, harness, heartbeat, imuEvent, manifestNow, mediaObjects, mp3Heartbeat, ok, problemCode, provision, sendImu, uploadCapture, visionResult, type Harness, type World } from "./helpers";
import { LAME_16K_MONO } from "./audio";
import { sha256Hex } from "../src/util";

const OWNER = "owner.flow@example.invalid";

let h: Harness;
let w: World;
let clock: TestClock;
let admin: string;

beforeEach(async () => {
  await freshDb();
  clock = new TestClock(); // 2026-10-19T03:00:00Z
  h = harness(clock, { ADMIN_BOOTSTRAP_EMAILS: OWNER });
  w = await provision(h);
  const token = "clm_flow-test-session-0001";
  await h.env.DB.batch([
    h.env.DB.prepare(`INSERT INTO admins (admin_id, email, role, status, created_at) VALUES ('adm_flow', ?1, 'owner', 'active', '2026-10-19T02:00:00.000Z')`).bind(OWNER),
    h.env.DB.prepare(`INSERT INTO admin_sessions (token_id, admin_id, token_sha256, created_at, expires_at, auth_at) VALUES ('ats_flow', 'adm_flow', ?1, '2026-10-19T02:00:00.000Z', '2030-01-01T00:00:00.000Z', '2026-10-19T02:00:00.000Z')`).bind(await sha256Hex(token)),
  ]);
  admin = token;
});

describe("ESP32 data flow (simulated device)", () => {
  it("heartbeat → IMU → capture → agent inference → admin report → admin command → device acknowledgement → dashboard", async () => {
    const id = w.deviceId;
    const dev = (path: string, json?: unknown, method = "POST") => h.call(method, `/api/device/v1${path}`, { token: w.deviceToken, json });

    // 4. authenticated heartbeat with the device's boot clock
    const hb = await ok<{ pending_commands: number; clock: { boot_id: string } }>(await dev("/heartbeat", heartbeat(h, id)));
    expect(hb).toMatchObject({ pending_commands: 0, clock: { boot_id: "boot-test-0001" } });

    // 5. firmware trigger + raw IMU on the same device clock
    await ok(await dev("/imu-events", imuEvent(h, { deviceId: id, triggerId: "trg-flow-1", triggeredAt: "2026-10-19T02:59:30.000Z" })), 201);
    await sendImu(h, w.deviceToken, id, { from: "2026-10-19T02:59:20.000Z", until: "2026-10-19T02:59:40.000Z" });

    // 6. capture metadata and chunks; 7. media is private and temporary
    const fx = await captureFixture({ deviceId: id, captureId: "cap-flow-1", capturedAt: "2026-10-19T02:59:00.000Z" });
    await uploadCapture(h, w.deviceToken, fx);
    expect(await mediaObjects()).toHaveLength(3);

    // 8. the local agent claims the job, reads the media with its lease, completes it
    const job = await claim(h, w.agentToken);
    expect(job).toMatchObject({ kind: "vision" });
    const done = await ok<{ media_deleted: boolean }>(await complete(h, w.agentToken, job!, visionResult({ captureId: "cap-flow-1", frameCount: 24 })));
    expect(done.media_deleted).toBe(true);
    expect(await mediaObjects()).toHaveLength(0); // retention: the frames are gone as soon as inference finishes

    // 9. inference outcomes are persisted and the admin report shows them, labelled simulated, without any alert from a single source
    const report = await ok<{ entries: Array<Record<string, any>> }>(await h.call("GET", `/api/admin/v1/devices/${id}/activity?date=2026-10-19`, { token: admin }));
    const kinds = report.entries.map((e) => e.kind);
    for (const k of ["boot", "heartbeat_latest", "imu_trigger", "imu_hour_summary", "capture", "fall_check", "drink_check", "vision_job"]) expect(kinds, k).toContain(k);
    expect(report.entries.find((e) => e.kind === "capture")).toMatchObject({ source_mode: "simulated", status: "processed", detail: { media_deleted: true } });
    expect(report.entries.filter((e) => e.source === "events").every((e) => e.source_mode === "simulated")).toBe(true);
    expect(report.entries.find((e) => e.kind === "fall_check")!.detail).toMatchObject({ classification: "uncalibrated_output", verification_status: "unverified" });
    expect(kinds).not.toContain("alert");
    expect(await dbAll(`SELECT 1 FROM alerts`)).toEqual([]); // no approved rule exists: an IMU trigger is never a verdict by itself
    expect(JSON.stringify(report)).not.toMatch(/data:image|base64|media\/|r2_key/);

    // 10. admin uploads an MP3 and creates an authorized command through the admin API (the firmware reported MP3 playback)
    await ok(await dev("/heartbeat", mp3Heartbeat(h, id)));
    const upload = await ok<{ voice_message: { voice_message_id: string } }>(
      await h.call("POST", `/api/admin/v1/devices/${id}/voice-messages?title=${encodeURIComponent("Thử")}`, { token: admin, body: LAME_16K_MONO, headers: { "content-type": "audio/mpeg" } }),
      201,
    );
    const created = await ok<{ command: { command_id: string; status: string } }>(
      await h.call("POST", `/api/admin/v1/devices/${id}/voice-commands`, {
        token: admin,
        json: { voice_message_id: upload.voice_message.voice_message_id, idempotency_key: "flow-key-0001", expires_in_seconds: 300, confirm: true },
      }),
      201,
    );
    expect(created.command.status).toBe("queued");

    // 11. the device polls (the heartbeat announced it), downloads audio through its authenticated route, acknowledges each stage
    const beat = await ok<{ pending_commands: number }>(await dev("/heartbeat", heartbeat(h, id)));
    expect(beat.pending_commands).toBe(1);
    const next = await ok<{ command: { command_id: string; action: { kind: string; audio: { path: string; sha256: string; byte_size: number } } } }>(await dev("/commands/next", undefined, "GET"));
    expect(next.command).toMatchObject({ command_id: created.command.command_id, action: { kind: "voice" } });
    const audio = await h.call("GET", next.command.action.audio.path, { token: w.deviceToken });
    expect([audio.status, audio.headers.get("content-type")]).toEqual([200, "audio/mpeg"]);
    const downloaded = new Uint8Array(await audio.arrayBuffer());
    expect(await sha256Hex(downloaded)).toBe(next.command.action.audio.sha256);
    expect(await sha256Hex(downloaded)).toBe(await sha256Hex(LAME_16K_MONO)); // the uploaded MP3 itself reaches the device
    // The admin session and another device's credential cannot fetch this audio or acknowledge this command.
    expect((await h.call("GET", next.command.action.audio.path, { token: admin })).status).toBe(401);
    expect((await h.call("GET", next.command.action.audio.path, { token: w.otherDeviceToken })).status).toBe(404);
    const ack = (status: string, token = w.deviceToken, deviceId = id) =>
      h.call("POST", `/api/device/v1/commands/${created.command.command_id}/status`, { token, json: { schema_version: "command-status.v2", device_id: deviceId, clock: deviceClock(h), status, reason_code: null, detail: null } });
    expect((await ack("accepted", w.otherDeviceToken, id)).status).toBe(403); // device_id must match the credential
    await ok(await ack("accepted"));
    await ok(await ack("started"));

    // 12. the dashboard shows exactly what the device reported, and "played" only after completed
    const view = async () => (await ok<{ command: { status: string; played_confirmed_by_device: boolean } }>(await h.call("GET", `/api/admin/v1/commands/${created.command.command_id}`, { token: admin }))).command;
    expect(await view()).toMatchObject({ status: "started", played_confirmed_by_device: false });
    await ok(await ack("completed"));
    expect(await view()).toMatchObject({ status: "completed", played_confirmed_by_device: true });
    const registry = await ok<{ items: Array<{ device_id: string; commands: { last_24h: Record<string, number> }; last_capture: { status: string }; has_simulated_records_7d: boolean }> }>(
      await h.call("GET", "/api/admin/v1/devices", { token: admin }),
    );
    const row = registry.items.find((d) => d.device_id === id)!;
    expect(row).toMatchObject({ last_capture: { status: "processed" }, has_simulated_records_7d: true });
    expect(row.commands.last_24h).toEqual({ completed: 1 });
  });

  it("production source rules still apply: a deployment that rejects simulated sources refuses the simulated device", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-prod-1", capturedAt: "2026-10-19T02:59:00.000Z" });
    const res = await h.call("POST", "/api/device/v1/captures", { token: w.deviceToken, json: manifestNow(h, fx), envOverrides: { ACCEPT_SIMULATED_SOURCES: "false" } });
    expect(res.status).toBe(403);
    expect(await problemCode(res)).toBe("simulated_source_rejected");
    const report = await ok<{ entries: unknown[] }>(await h.call("GET", `/api/admin/v1/devices/${w.deviceId}/activity?date=2026-10-19`, { token: admin }));
    expect(report.entries.filter((e) => (e as { source: string }).source === "captures")).toEqual([]);
  });

  it("credentials do not cross: a device cannot use admin routes, an admin session cannot use device routes", async () => {
    expect((await h.call("GET", "/api/admin/v1/devices", { token: w.deviceToken })).status).toBe(401);
    expect((await h.call("POST", "/api/device/v1/heartbeat", { token: admin, json: heartbeat(h, w.deviceId) })).status).toBe(401);
    expect((await h.call("GET", "/api/device/v1/commands/next", { token: admin })).status).toBe(401);
    expect((await h.call("POST", "/api/agent/v1/jobs/claim", { token: admin, json: {} })).status).toBe(401);
  });

  it("a device that stops talking is reported as not connected, and its stale queued command expires instead of replaying", async () => {
    const id = w.deviceId;
    await ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: mp3Heartbeat(h, id) }));
    const up = await ok<{ voice_message: { voice_message_id: string } }>(
      await h.call("POST", `/api/admin/v1/devices/${id}/voice-messages?title=t`, { token: admin, body: LAME_16K_MONO, headers: { "content-type": "audio/mpeg" } }),
      201,
    );
    await ok(await h.call("POST", `/api/admin/v1/devices/${id}/voice-commands`, { token: admin, json: { voice_message_id: up.voice_message.voice_message_id, idempotency_key: "flow-key-0002", expires_in_seconds: 60, confirm: true } }), 201);
    clock.advance(600); // the device is offline for ten minutes
    await h.cron("* * * * *");
    const device = await ok<{ device: { connected: boolean; commands: { active: Record<string, number>; last_24h: Record<string, number> } } }>(await h.call("GET", `/api/admin/v1/devices/${id}`, { token: admin }));
    expect(device.device.connected).toBe(false);
    expect(device.device.commands).toEqual({ active: {}, last_24h: { expired: 1 } });
    expect((await h.call("GET", "/api/device/v1/commands/next", { token: w.deviceToken })).status).toBe(204);
  });
});
