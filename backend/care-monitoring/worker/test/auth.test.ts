/** Authentication, credential separation and per-recipient authorization (four tests per scoped route). */
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_TOKEN, freshDb, harness, heartbeat, mp3Heartbeat, ok, problemCode, provision, type Harness, type World } from "./helpers";
import { LAME_16K_MONO } from "./audio";

let h: Harness;
let w: World;
const heartbeatBody = () => heartbeat(h, w.deviceId);

beforeEach(async () => {
  await freshDb();
  h = harness();
  w = await provision(h);
});

describe("authentication", () => {
  it("rejects missing and unknown tokens with 401 problem+json", async () => {
    for (const path of ["/api/device/v1/commands/next", "/api/app/v1/me"]) {
      const res = await h.call("GET", path);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(await problemCode(res)).toBe("invalid_credential");
    }
    expect((await h.call("GET", "/api/app/v1/me", { token: "clc_not-a-real-token" })).status).toBe(401);
  });

  it("keeps device, agent, caregiver and admin credentials apart", async () => {
    expect((await h.call("POST", "/api/agent/v1/jobs/claim", { token: w.deviceToken, json: { kinds: ["vision"], lease_seconds: 60, defer_if_vision_pending: false } })).status).toBe(401);
    expect((await h.call("GET", "/api/device/v1/commands/next", { token: w.agentToken })).status).toBe(401);
    expect((await h.call("GET", "/api/app/v1/me", { token: w.deviceToken })).status).toBe(401);
    expect((await h.call("GET", "/api/admin/v1/recipients", { token: w.caregiverToken })).status).toBe(401);
    expect((await h.call("GET", "/api/admin/v1/recipients", { token: w.deviceToken })).status).toBe(401);
    expect((await h.call("GET", "/api/admin/v1/recipients", { token: ADMIN_TOKEN })).status).toBe(200);
  });

  it("answers 503 for admin routes when no admin digest is configured", async () => {
    const res = await h.call("GET", "/api/admin/v1/recipients", { token: ADMIN_TOKEN, envOverrides: { ADMIN_TOKEN_SHA256: "" } });
    expect(res.status).toBe(503);
    expect(await problemCode(res)).toBe("admin_not_configured");
  });

  it("stops accepting a revoked device and a rotated device token", async () => {
    const rotated = await ok<{ token: string }>(await h.call("POST", `/api/admin/v1/devices/${w.deviceId}/rotate-token`, { token: ADMIN_TOKEN }));
    expect((await h.call("GET", "/api/device/v1/commands/next", { token: w.deviceToken })).status).toBe(401);
    expect((await h.call("GET", "/api/device/v1/commands/next", { token: rotated.token })).status).toBe(204);
    await ok(await h.call("POST", `/api/admin/v1/devices/${w.deviceId}/revoke`, { token: ADMIN_TOKEN }));
    expect((await h.call("GET", "/api/device/v1/commands/next", { token: rotated.token })).status).toBe(401);
  });

  it("rejects a device payload that names another device", async () => {
    const res = await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: { ...heartbeatBody(), device_id: "someone-else" } });
    expect(res.status).toBe(403);
    expect(await problemCode(res)).toBe("device_mismatch");
  });

  it("never returns a stored credential", async () => {
    const list = await (await h.call("GET", "/api/admin/v1/recipients", { token: ADMIN_TOKEN })).text();
    expect(list).not.toContain("token");
    const status = await (await h.call("GET", "/api/admin/v1/status", { token: ADMIN_TOKEN })).text();
    expect(status).not.toMatch(/cl[dac]_/);
  });
});

describe("per-recipient authorization", () => {
  const R = () => `/api/app/v1/recipients/${w.recipientId}`;
  const reads = () => [`${R()}/events`, `${R()}/alerts`, `${R()}/fusion-decisions`, `${R()}/devices`, `${R()}/daily-reports`, `${R()}/reminders`, `${R()}/voice-messages`, `${R()}/devices/${w.deviceId}/commands`];

  it("grants read access to caregivers and viewers of the recipient", async () => {
    for (const path of reads()) {
      expect((await h.call("GET", path, { token: w.caregiverToken })).status, path).toBe(200);
      expect((await h.call("GET", path, { token: w.viewerToken })).status, path).toBe(200);
    }
  });

  it("answers 404 to a caregiver of another recipient (no existence leak)", async () => {
    for (const path of reads()) {
      const res = await h.call("GET", path, { token: w.outsiderToken });
      expect(res.status, path).toBe(404);
    }
  });

  it("answers 404 after the grant is revoked", async () => {
    await ok(await h.call("POST", `/api/admin/v1/grants/${w.grantId}/revoke`, { token: ADMIN_TOKEN }));
    for (const path of reads()) expect((await h.call("GET", path, { token: w.caregiverToken })).status, path).toBe(404);
  });

  it("answers 403 to a viewer attempting a write", async () => {
    const writes: Array<[string, string, unknown]> = [
      ["POST", `${R()}/reminders`, { device_id: w.deviceId, kind: "water", label: "x", voice_message_id: null, times_local: ["08:00"], days_of_week: [1], timezone: "Asia/Ho_Chi_Minh", start_date: "2026-10-01", end_date: null, deadline_minutes: 15 }],
      ["POST", `${R()}/alerts/alr_x/actions`, { action: "acknowledge", expected_version: 1, review_outcome: null, note: null }],
      ["POST", `${R()}/fusion-decisions/fdc_x/review`, { verification: "verified", note: "x" }],
      ["POST", `${R()}/devices/${w.deviceId}/commands`, { command_type: "play_voice_message", voice_message_id: "vm_x", idempotency_key: "key-000001", expires_in_seconds: 60 }],
    ];
    for (const [method, path, body] of writes) {
      const res = await h.call(method, path, { token: w.viewerToken, json: body });
      expect(res.status, path).toBe(403);
      expect(await problemCode(res)).toBe("permission_denied");
    }
  });

  it("applies all four authorization cases to every recipient-scoped write route", async () => {
    const audio = { body: LAME_16K_MONO, headers: { "content-type": "audio/mpeg" } };
    await ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: mp3Heartbeat(h, w.deviceId) }));
    const reminder = { device_id: w.deviceId, kind: "water", label: "Uống nước (thử)", voice_message_id: null, times_local: ["08:00"], days_of_week: [1], timezone: "Asia/Ho_Chi_Minh", start_date: "2026-10-01", end_date: null, deadline_minutes: 15 };
    // Real entities owned by recipient A, created by the authorized caregiver.
    const vm = await ok<{ voice_message: { voice_message_id: string } }>(await h.call("POST", `${R()}/voice-messages?title=t`, { token: w.caregiverToken, ...audio }), 201);
    const vmId = vm.voice_message.voice_message_id;
    const rem = await ok<{ reminder: { reminder_id: string } }>(await h.call("POST", `${R()}/reminders`, { token: w.caregiverToken, json: reminder }), 201);
    const cmd = await ok<{ command: { command_id: string } }>(
      await h.call("POST", `${R()}/devices/${w.deviceId}/commands`, { token: w.caregiverToken, json: { command_type: "play_voice_message", voice_message_id: vmId, idempotency_key: "authz-000001", expires_in_seconds: 60 } }),
      201,
    );
    type Call = { method: string; path: string; json?: unknown; body?: Uint8Array; headers?: Record<string, string> };
    const routes: Call[] = [
      { method: "POST", path: `${R()}/reminders`, json: reminder },
      { method: "PATCH", path: `${R()}/reminders/${rem.reminder.reminder_id}`, json: { expected_version: 1, label: "Uống nước" } },
      { method: "POST", path: `${R()}/voice-messages?title=t2`, ...audio },
      { method: "PUT", path: `${R()}/voice-messages/${vmId}/audio`, ...audio },
      { method: "POST", path: `${R()}/devices/${w.deviceId}/commands`, json: { command_type: "play_voice_message", voice_message_id: vmId, idempotency_key: "authz-000002", expires_in_seconds: 60 } },
      { method: "POST", path: `${R()}/commands/${cmd.command.command_id}/cancel` },
      { method: "POST", path: `${R()}/alerts/alr_x/actions`, json: { action: "acknowledge", expected_version: 1, review_outcome: null, note: null } },
      { method: "POST", path: `${R()}/fusion-decisions/fdc_x/review`, json: { verification: "verified", note: "x" } },
      { method: "DELETE", path: `${R()}/reminders/${rem.reminder.reminder_id}` },
      { method: "DELETE", path: `${R()}/voice-messages/${vmId}` },
    ];
    const send = (c: Call, token: string) => h.call(c.method, c.path, { token, json: c.json, body: c.body, headers: c.headers });
    for (const c of routes) {
      expect((await send(c, w.viewerToken)).status, `viewer ${c.method} ${c.path}`).toBe(403);
      expect((await send(c, w.outsiderToken)).status, `outsider ${c.method} ${c.path}`).toBe(404);
    }
    for (const c of routes) {
      const status = (await send(c, w.caregiverToken)).status;
      // The two placeholder ids pass authorization and then do not exist (404 from the entity lookup).
      if (c.path.includes("alr_x") || c.path.includes("fdc_x")) expect(status, c.path).toBe(404);
      else expect(status, `caregiver ${c.method} ${c.path}`).toBeLessThan(400);
    }
    await ok(await h.call("POST", `/api/admin/v1/grants/${w.grantId}/revoke`, { token: ADMIN_TOKEN }));
    for (const c of routes) expect((await send(c, w.caregiverToken)).status, `revoked ${c.method} ${c.path}`).toBe(404);
    expect((await h.call("GET", `${R()}/voice-messages/${vmId}/audio`, { token: w.outsiderToken })).status).toBe(404);
  });

  it("applies the authorization cases to the raw IMU, command timeline and stream-ticket routes", async () => {
    await ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: mp3Heartbeat(h, w.deviceId) }));
    const vm = await ok<{ voice_message: { voice_message_id: string } }>(await h.call("POST", `${R()}/voice-messages?title=t`, { token: w.caregiverToken, body: LAME_16K_MONO, headers: { "content-type": "audio/mpeg" } }), 201);
    const cmd = await ok<{ command: { command_id: string } }>(
      await h.call("POST", `${R()}/devices/${w.deviceId}/commands`, { token: w.caregiverToken, json: { command_type: "play_voice_message", voice_message_id: vm.voice_message.voice_message_id, idempotency_key: "authz-000003", expires_in_seconds: 60 } }),
      201,
    );
    const imu = `${R()}/imu-samples?device_id=${w.deviceId}&from=2026-10-19T02:55:00.000Z&to=2026-10-19T03:00:00.000Z`;
    const timeline = `${R()}/commands/${cmd.command.command_id}`;
    const ticket = (token: string) => h.call("POST", "/api/app/v1/stream-tickets", { token, json: { recipient_id: w.recipientId } });
    for (const token of [w.caregiverToken, w.viewerToken]) {
      expect((await h.call("GET", imu, { token })).status).toBe(200);
      expect((await h.call("GET", timeline, { token })).status).toBe(200);
      expect((await ticket(token)).status).toBe(201);
    }
    expect((await h.call("GET", imu, { token: w.outsiderToken })).status).toBe(404);
    expect((await h.call("GET", timeline, { token: w.outsiderToken })).status).toBe(404);
    expect((await ticket(w.outsiderToken)).status).toBe(404);
    expect((await h.call("GET", `/api/app/v1/recipients/${w.otherRecipientId}/commands/${cmd.command.command_id}`, { token: w.outsiderToken })).status).toBe(404); // scoped in SQL
    await ok(await h.call("POST", `/api/admin/v1/grants/${w.grantId}/revoke`, { token: ADMIN_TOKEN }));
    expect((await h.call("GET", imu, { token: w.caregiverToken })).status).toBe(404);
    expect((await h.call("GET", timeline, { token: w.caregiverToken })).status).toBe(404);
    expect((await ticket(w.caregiverToken)).status).toBe(404);
    // Every role holds data.read, so "missing permission" cannot occur on these read routes; write routes cover 403 above.
  });

  it("revoked caregiver token stops working", async () => {
    const me = await ok<{ user: { user_id: string } }>(await h.call("GET", "/api/app/v1/me", { token: w.caregiverToken }));
    const tokens = await h.env.DB.prepare(`SELECT token_id FROM caregiver_tokens WHERE user_id = ?1`).bind(me.user.user_id).all<{ token_id: string }>();
    await ok(await h.call("POST", `/api/admin/v1/caregiver-tokens/${tokens.results[0]?.token_id}/revoke`, { token: ADMIN_TOKEN }));
    expect((await h.call("GET", "/api/app/v1/me", { token: w.caregiverToken })).status).toBe(401);
  });
});

describe("request hygiene", () => {
  it("rejects oversized JSON and wrong content types", async () => {
    const big = { ...heartbeatBody(), firmware_version: "x".repeat(70_000) };
    expect((await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: big })).status).toBe(413);
    const res = await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, body: "{}", headers: { "content-type": "text/plain" } });
    expect(res.status).toBe(415);
  });
  it("rejects unknown fields (strict contracts)", async () => {
    const res = await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: { ...heartbeatBody(), firmware_version: null, uptime_s: 1, recipient_id: "x" } });
    expect(res.status).toBe(422);
  });
  it("applies CORS only to configured origins", async () => {
    const allowed = await h.call("GET", "/health", { headers: { origin: "http://localhost:5173" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const other = await h.call("GET", "/health", { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
