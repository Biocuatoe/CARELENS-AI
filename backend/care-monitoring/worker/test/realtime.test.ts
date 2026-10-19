/** SSE: the /api/demo/* contract of the frontend's Live Demo (ticket and dev-allowlist access), live push,
 * web sign-in, and the authenticated hint stream. */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_TOKEN,
  TEST_TRIAL_POLICY,
  captureFixture,
  claim,
  complete,
  freshDb,
  harness,
  heartbeat,
  imuEvent,
  ok,
  problemCode,
  provision,
  sendImu,
  uploadCapture,
  visionResult,
  type Harness,
  type World,
} from "./helpers";

/* Field lists of the frontend's DemoStateFromBackend / EventFromBackend / AlertFromBackend /
 * HubStateFromBackend interfaces (frontend/src/data/demo/demoAdapter.ts, read-only). */
const STATE_KEYS = ["schema_version", "hubs", "events", "alerts", "notes", "reset_at", "alert_actions", "seq", "updated_at"];
const EVENT_KEYS = ["id", "device_id", "recipient_id", "category", "severity", "care_level", "summary", "description", "observed_at", "received_at", "source_mode", "schema_version", "source_record_id", "alert_triggered", "alert_id", "product"];
const ALERT_KEYS = ["id", "device_id", "recipient_id", "severity", "category", "summary", "status", "version", "policy_version", "source_mode", "triggered_at", "acknowledged_at", "acknowledged_by", "review_outcome", "review_note", "resolved_at", "resolved_by", "product"];
const HUB_KEYS = ["id", "recipient_id", "online", "last_seen_at", "last_seen_ms", "signal", "latest_data", "battery"];

let h: Harness;
let w: World;

async function readFrames(
  res: Response,
  count: number,
  timeoutMs = 3000,
  until: ((frame: { id: string | null; data: any }) => boolean) | null = null,
): Promise<Array<{ id: string | null; data: any }>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: Array<{ id: string | null; data: any }> = [];
  const deadline = Date.now() + timeoutMs;
  try {
    while (until ? !frames.some(until) : frames.length < count) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out with ${frames.length}/${count} frames`);
      const chunk = await Promise.race([reader.read(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), remaining))]);
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (raw.startsWith(":")) continue;
        const lines = Object.fromEntries(raw.split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 2)]));
        frames.push({ id: lines.id ?? null, data: JSON.parse(lines.data as string) });
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return frames;
}

describe("legacy stream", () => {
  beforeEach(async () => {
    await freshDb();
    h = harness(undefined, { FUSION_POLICY_JSON: TEST_TRIAL_POLICY });
    h.clock.set("2026-10-19T03:00:00.000Z");
    w = await provision(h);
  });

  it("starts with a JSON state_update in the frontend's shape and exposes nothing by default", async () => {
    const res = await h.call("GET", "/api/demo/stream?last_seq=3", { headers: { origin: "http://localhost:5173" } });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const [first] = await readFrames(res, 1);
    expect(first?.data.type).toBe("state_update");
    for (const k of STATE_KEYS) expect(first?.data.state, k).toHaveProperty(k);
    expect(first?.data.state.events).toEqual([]);
    expect(first?.data.state.hubs).toEqual({});
    expect(first?.data.state.care_monitoring.data_exposed).toBe(false);
  });

  it("exposes the configured recipient only to allow-listed client IPs", async () => {
    const env = { LEGACY_STREAM_RECIPIENT_ID: w.recipientId, LEGACY_STREAM_DEVICE_ID: w.deviceId };
    await ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: heartbeat(h, w.deviceId) }));
    const outside = await ok<{ care_monitoring: { data_exposed: boolean }; hubs: object }>(await h.call("GET", "/api/demo/state", { envOverrides: env, ip: "198.51.100.7" }));
    expect(outside.care_monitoring.data_exposed).toBe(false);
    expect(outside.hubs).toEqual({});
    const inside = await ok<{ hubs: Record<string, Record<string, unknown>> }>(await h.call("GET", "/api/demo/state", { envOverrides: env, ip: "127.0.0.1" }));
    const hub = inside.hubs.d_hub_liveshowcase!;
    for (const k of HUB_KEYS) expect(hub, k).toHaveProperty(k);
    expect([hub.online, hub.signal, hub.recipient_id, hub.latest_data, hub.battery]).toEqual([true, "connected", "r_liveshowcase", null, null]);
    h.clock.advance(181);
    const later = await ok<{ hubs: Record<string, { online: boolean }> }>(await h.call("GET", "/api/demo/state", { envOverrides: env, ip: "127.0.0.1" }));
    expect(later.hubs.d_hub_liveshowcase?.online).toBe(false);
  });

  it("pushes a new state_update with the alert as soon as it is stored", async () => {
    const env = { LEGACY_STREAM_RECIPIENT_ID: w.recipientId, LEGACY_STREAM_DEVICE_ID: w.deviceId };
    const stream = await h.call("GET", "/api/demo/stream", { envOverrides: env, ip: "127.0.0.1" });
    const reading = readFrames(stream, 2, 8000, (f) => f.data.state.alerts.length > 0);
    await sendImu(h, w.deviceToken, w.deviceId, { from: "2026-10-19T02:59:50.000Z", until: "2026-10-19T03:00:00.000Z", impacts: ["2026-10-19T02:59:57.000Z"] });
    await ok(await h.call("POST", "/api/device/v1/imu-events", { token: w.deviceToken, json: imuEvent(h, { deviceId: w.deviceId, triggerId: "trg-s", triggeredAt: "2026-10-19T02:59:56.500Z" }) }), 201);
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-s", mode: "triggered", triggerId: "trg-s", capturedAt: "2026-10-19T02:59:55.000Z" });
    await uploadCapture(h, w.deviceToken, fx);
    const job = await claim(h, w.agentToken, ["vision"]);
    await ok(await complete(h, w.agentToken, job!, visionResult({ captureId: "cap-s", frameCount: 40, scores: [1, 1, 1] })));
    const frames = await reading;
    const latest = frames[frames.length - 1]!.data.state;
    expect(latest.alerts).toHaveLength(1);
    for (const k of ALERT_KEYS) expect(latest.alerts[0], k).toHaveProperty(k);
    expect(latest.alerts[0]).toMatchObject({ recipient_id: "r_liveshowcase", category: "fall_like", device_id: "d_hub_liveshowcase", status: "open" });
    const fallEvent = latest.events.find((e: { category: string }) => e.category === "fall_like");
    for (const k of EVENT_KEYS) expect(fallEvent, k).toHaveProperty(k);
    expect(fallEvent).toMatchObject({ type: "suspected_fall", alert_triggered: true, alert_id: latest.alerts[0].id, care_level: null, source_mode: "simulated" });
    expect(latest.alerts[0]).toMatchObject({ version: 1, source_mode: "simulated", policy_version: "fusion-rules.test" });
    // The emergency buzzer appears as a device command that has not been played yet.
    const buzzer = latest.events.find((e: { type: string }) => e.type === "device_command_queued");
    expect(buzzer?.summary).toContain("Chưa phát");
    const statusLine = latest.events.find((e: { type: string }) => e.type === "system_status");
    expect(statusLine?.summary).toContain("AI cục bộ");
    expect(Number(frames[frames.length - 1]!.id)).toBeGreaterThan(Number(frames[0]!.id));
  });

  it("removed demo commands answer 410 and change nothing", async () => {
    const res = await h.call("POST", "/api/demo/command", { json: { cmd: "carelens_event_fall" } });
    expect(res.status).toBe(410);
    expect(await problemCode(res)).toBe("demo_command_removed");
  });
});

describe("web sign-in and stream tickets (judge workflow)", () => {
  beforeEach(async () => {
    await freshDb();
    h = harness();
    h.clock.set("2026-10-19T03:00:00.000Z");
    w = await provision(h);
  });

  async function issueLogin(userToken: string, email: string) {
    const me = await ok<{ user: { user_id: string } }>(await h.call("GET", "/api/app/v1/me", { token: userToken }));
    return ok<{ password: string }>(await h.call("POST", `/api/admin/v1/caregivers/${me.user.user_id}/login`, { token: ADMIN_TOKEN, json: { login_email: email } }), 201);
  }

  it("signs a viewer in with an owner-issued credential and opens the Live Demo stream with a single-use ticket", async () => {
    const { password } = await issueLogin(w.viewerToken, "giamkhao@example.invalid");
    expect(password).toMatch(/^[0-9a-z]{5}(-[0-9a-z]{5}){3}$/);
    expect(await problemCode(await h.call("POST", "/api/app/v1/session", { json: { email: "giamkhao@example.invalid", password: "wrong-wrong" } }))).toBe("invalid_credential");
    const login = await ok<{ token: string; storage: string; recipients: Array<{ recipient_id: string; role: string; permissions: string[] }> }>(
      await h.call("POST", "/api/app/v1/session", { json: { email: "GiamKhao@Example.invalid", password: password.toUpperCase() } }),
      201,
    );
    expect(login.storage).toBe("memory_only");
    expect(login.recipients).toEqual([expect.objectContaining({ recipient_id: w.recipientId, role: "viewer", permissions: ["data.read"] })]);
    // Read-only: a viewer session cannot act on alerts or mint tickets for recipients it cannot read.
    expect((await h.call("POST", `/api/app/v1/recipients/${w.recipientId}/alerts/alr_x/actions`, { token: login.token, json: { action: "acknowledge", expected_version: 1, review_outcome: null, note: null } })).status).toBe(403);
    expect((await h.call("POST", "/api/app/v1/stream-tickets", { token: login.token, json: { recipient_id: w.otherRecipientId } })).status).toBe(404);

    await ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: heartbeat(h, w.deviceId) }));
    const { ticket } = await ok<{ ticket: string }>(await h.call("POST", "/api/app/v1/stream-tickets", { token: login.token, json: { recipient_id: w.recipientId } }), 201);
    const res = await h.call("GET", `/api/demo/stream?ticket=${ticket}&last_seq=0`, { ip: "198.51.100.7" });
    const [first] = await readFrames(res, 1);
    expect(first?.data.state.care_monitoring.data_exposed).toBe(true);
    expect(first?.data.state.hubs.d_hub_liveshowcase).toMatchObject({ online: true, recipient_id: "r_liveshowcase" });
    // Single use, short lived.
    expect((await h.call("GET", `/api/demo/stream?ticket=${ticket}`)).status).toBe(401);
    const { ticket: t2 } = await ok<{ ticket: string }>(await h.call("POST", "/api/app/v1/stream-tickets", { token: login.token, json: { recipient_id: w.recipientId } }), 201);
    h.clock.advance(61);
    expect((await h.call("GET", `/api/demo/stream?ticket=${t2}`)).status).toBe(401);
    // Logout revokes the session and its unused tickets.
    const { ticket: t3 } = await ok<{ ticket: string }>(await h.call("POST", "/api/app/v1/stream-tickets", { token: login.token, json: { recipient_id: w.recipientId } }), 201);
    expect((await h.call("DELETE", "/api/app/v1/session", { token: login.token })).status).toBe(204);
    expect((await h.call("GET", `/api/demo/stream?ticket=${t3}`)).status).toBe(401);
    expect((await h.call("GET", "/api/app/v1/me", { token: login.token })).status).toBe(401);
  });

  it("expires sessions, rotates credentials and stops tickets when the grant is revoked", async () => {
    const { password } = await issueLogin(w.caregiverToken, "nguoithan@example.invalid");
    const login = await ok<{ token: string }>(await h.call("POST", "/api/app/v1/session", { json: { email: "nguoithan@example.invalid", password } }), 201);
    const { ticket } = await ok<{ ticket: string }>(await h.call("POST", "/api/app/v1/stream-tickets", { token: login.token, json: { recipient_id: w.recipientId } }), 201);
    await ok(await h.call("POST", `/api/admin/v1/grants/${w.grantId}/revoke`, { token: ADMIN_TOKEN }));
    expect((await h.call("GET", `/api/demo/stream?ticket=${ticket}`)).status).toBe(401);
    // Rotating the credential revokes earlier sessions.
    await issueLogin(w.caregiverToken, "nguoithan@example.invalid");
    expect((await h.call("GET", "/api/app/v1/me", { token: login.token })).status).toBe(401);
    expect((await h.call("POST", "/api/app/v1/session", { json: { email: "nguoithan@example.invalid", password } })).status).toBe(401);
    // Sessions end after SESSION_TTL_HOURS.
    const { password: p2 } = await issueLogin(w.viewerToken, "xem@example.invalid");
    const s2 = await ok<{ token: string }>(await h.call("POST", "/api/app/v1/session", { json: { email: "xem@example.invalid", password: p2 } }), 201);
    h.clock.advance(12 * 3600 + 1);
    expect((await h.call("GET", "/api/app/v1/me", { token: s2.token })).status).toBe(401);
  });

  it("lets one shared judge account sign in from several browsers at once, each with its own session and tickets", async () => {
    const email = "bangiamkhao@example.invalid";
    const { password } = await issueLogin(w.viewerToken, email);
    const signIn = async (ip: string) =>
      (await ok<{ token: string; recipients: Array<{ role: string; permissions: string[] }> }>(await h.call("POST", "/api/app/v1/session", { json: { email, password }, ip }), 201));
    const [a, b, c] = [await signIn("198.51.100.1"), await signIn("198.51.100.2"), await signIn("198.51.100.3")];
    expect(new Set([a.token, b.token, c.token]).size).toBe(3);
    for (const s of [a, b, c]) {
      expect(s.recipients).toEqual([expect.objectContaining({ role: "viewer", permissions: ["data.read"] })]);
      expect((await h.call("GET", "/api/app/v1/me", { token: s.token })).status).toBe(200);
    }
    const sessions = await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM caregiver_tokens WHERE kind = 'session' AND revoked_at IS NULL`).first<{ n: number }>();
    expect(sessions?.n).toBe(3);

    // Each browser mints its own ticket; both streams open side by side.
    const mint = async (token: string) => (await ok<{ ticket: string }>(await h.call("POST", "/api/app/v1/stream-tickets", { token, json: { recipient_id: w.recipientId } }), 201)).ticket;
    const [ta, tb] = [await mint(a.token), await mint(b.token)];
    expect(ta).not.toBe(tb);
    const [sa, sb] = [await h.call("GET", `/api/demo/stream?ticket=${ta}`), await h.call("GET", `/api/demo/stream?ticket=${tb}`)];
    expect([sa.status, sb.status]).toEqual([200, 200]);
    expect((await readFrames(sa, 1))[0]?.data.state.care_monitoring.data_exposed).toBe(true);
    expect((await readFrames(sb, 1))[0]?.data.state.care_monitoring.data_exposed).toBe(true);

    // A ticket presented twice at the same moment opens exactly one stream.
    const tc = await mint(c.token);
    const race = await Promise.all([h.call("GET", `/api/demo/stream?ticket=${tc}`), h.call("GET", `/api/demo/stream?ticket=${tc}`)]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 401]);
    for (const r of race) if (r.status === 200) await readFrames(r, 1);
    expect((await h.call("GET", `/api/demo/stream?ticket=cls_${"x".repeat(40)}`)).status).toBe(401);

    // Read-only at the API, whatever the browser shows: every write answers 403, other APIs 401.
    const R = `/api/app/v1/recipients/${w.recipientId}`;
    const writes: Array<[string, string, unknown]> = [
      ["POST", `${R}/alerts/alr_x/actions`, { action: "acknowledge", expected_version: 1, review_outcome: null, note: null }],
      ["POST", `${R}/fusion-decisions/fdc_x/review`, { verification: "verified", note: "x" }],
      ["POST", `${R}/devices/${w.deviceId}/commands`, { command_type: "play_voice_message", voice_message_id: "vm_x", idempotency_key: "judge-000001", expires_in_seconds: 60 }],
      ["POST", `${R}/reminders`, { device_id: w.deviceId, kind: "water", label: "x", voice_message_id: null, times_local: ["08:00"], days_of_week: [1], timezone: "Asia/Ho_Chi_Minh", start_date: "2026-10-01", end_date: null, deadline_minutes: 15 }],
    ];
    for (const [method, path, json] of writes) {
      const res = await h.call(method, path, { token: a.token, json });
      expect(res.status, path).toBe(403);
      expect(await problemCode(res)).toBe("permission_denied");
    }
    expect((await h.call("GET", "/api/admin/v1/status", { token: a.token })).status).toBe(401);
    expect((await h.call("GET", "/api/device/v1/commands/next", { token: a.token })).status).toBe(401);
    expect((await h.call("POST", "/api/agent/v1/jobs/claim", { token: a.token, json: { kinds: ["vision"], lease_seconds: 60, defer_if_vision_pending: false } })).status).toBe(401);

    // One judge logging out ends only that browser's session.
    expect((await h.call("DELETE", "/api/app/v1/session", { token: a.token })).status).toBe(204);
    expect((await h.call("GET", "/api/app/v1/me", { token: a.token })).status).toBe(401);
    expect((await h.call("GET", "/api/app/v1/me", { token: b.token })).status).toBe(200);
    expect(await mint(c.token)).toMatch(/^cls_/);

    // After the demo the owner re-issues (rotates) the credential: every judge session ends, the old password stops.
    const rotated = await issueLogin(w.viewerToken, email);
    for (const s of [b, c]) expect((await h.call("GET", "/api/app/v1/me", { token: s.token })).status).toBe(401);
    expect((await h.call("POST", "/api/app/v1/session", { json: { email, password } })).status).toBe(401);
    expect((await h.call("POST", "/api/app/v1/session", { json: { email, password: rotated.password } })).status).toBe(201);
  });

  it("signs in a plain user name with an owner-chosen password stored only as a salted PBKDF2 hash", async () => {
    const chosen = "Day-One-test-only";
    const me = await ok<{ user: { user_id: string } }>(await h.call("GET", "/api/app/v1/me", { token: w.viewerToken }));
    const issued = await ok<Record<string, unknown>>(
      await h.call("POST", `/api/admin/v1/caregivers/${me.user.user_id}/login`, { token: ADMIN_TOKEN, json: { login_id: "DAYONE-TEST", password: chosen } }),
      201,
    );
    expect(issued.login_id).toBe("dayone-test");
    expect(JSON.stringify(issued)).not.toContain(chosen);

    const row = await h.env.DB.prepare(`SELECT login_email, login_secret_sha256 FROM caregivers WHERE user_id = ?1`).bind(me.user.user_id).first<{ login_email: string; login_secret_sha256: string }>();
    expect(row?.login_email).toBe("dayone-test");
    expect(row?.login_secret_sha256).toMatch(/^pbkdf2-sha256\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(row?.login_secret_sha256).not.toContain(chosen);
    expect(row?.login_secret_sha256.toLowerCase()).not.toContain(chosen.toLowerCase());

    // The account identifier is case-insensitive; the chosen password is exact; wrong credentials are refused.
    expect(await problemCode(await h.call("POST", "/api/app/v1/session", { json: { username: "DAYONE-TEST", password: "wrong-password" } }))).toBe("invalid_credential");
    expect(await problemCode(await h.call("POST", "/api/app/v1/session", { json: { username: "DAYONE-TEST", password: chosen.toLowerCase() } }))).toBe("invalid_credential");
    expect(await problemCode(await h.call("POST", "/api/app/v1/session", { json: { username: "nobody-here", password: chosen } }))).toBe("invalid_credential");
    const login = await ok<{ token: string; recipients: Array<{ role: string }> }>(await h.call("POST", "/api/app/v1/session", { json: { username: "DayOne-Test", password: chosen } }), 201);
    expect(login.recipients).toEqual([expect.objectContaining({ role: "viewer" })]);
    expect((await h.call("GET", "/api/app/v1/me", { token: login.token })).status).toBe(200);
    // The earlier field name keeps working.
    expect((await h.call("POST", "/api/app/v1/session", { json: { email: "dayone-test", password: chosen } })).status).toBe(201);
  });

  it("rejects malformed account identifiers and short chosen passwords without touching the account", async () => {
    const me = await ok<{ user: { user_id: string } }>(await h.call("GET", "/api/app/v1/me", { token: w.viewerToken }));
    const issue = (json: unknown) => h.call("POST", `/api/admin/v1/caregivers/${me.user.user_id}/login`, { token: ADMIN_TOKEN, json });
    expect((await issue({ login_id: "has space", password: "long-enough" })).status).toBe(422);
    expect((await issue({ login_id: "ok-id", password: "abc" })).status).toBe(422);
    expect((await issue({ password: "long-enough" })).status).toBe(422);
    expect((await h.call("POST", "/api/app/v1/session", { json: { password: "x" } })).status).toBe(422);
    expect((await h.call("POST", "/api/app/v1/session", { json: { username: "a b", password: "x" } })).status).toBe(422);
  });

  it("keeps one shared chosen-password account usable from several browsers and ends all sessions when rotated", async () => {
    const chosen = "Day-One-test-only";
    const me = await ok<{ user: { user_id: string } }>(await h.call("GET", "/api/app/v1/me", { token: w.viewerToken }));
    const issue = (password: string) => h.call("POST", `/api/admin/v1/caregivers/${me.user.user_id}/login`, { token: ADMIN_TOKEN, json: { login_id: "dayone-test", password } });
    expect((await issue(chosen)).status).toBe(201);
    const signIn = async (ip: string) => ok<{ token: string }>(await h.call("POST", "/api/app/v1/session", { json: { username: "dayone-test", password: chosen }, ip }), 201);
    const [a, b] = [await signIn("198.51.100.21"), await signIn("198.51.100.22")];
    expect(a.token).not.toBe(b.token);
    expect((await h.call("DELETE", "/api/app/v1/session", { token: a.token })).status).toBe(204);
    expect((await h.call("GET", "/api/app/v1/me", { token: b.token })).status).toBe(200);
    expect((await issue("Another-test-only")).status).toBe(201);
    expect((await h.call("GET", "/api/app/v1/me", { token: b.token })).status).toBe(401);
    expect((await h.call("POST", "/api/app/v1/session", { json: { username: "dayone-test", password: chosen } })).status).toBe(401);
  });

  it("counts every sign-in attempt per network before checking the password", async () => {
    const { password } = await issueLogin(w.viewerToken, "giamkhao@example.invalid");
    const used = new Map<string, number>();
    const limiter = {
      async limit({ key }: { key: string }) {
        used.set(key, (used.get(key) ?? 0) + 1);
        return { success: (used.get(key) ?? 0) <= 2 };
      },
    };
    const env = { AUTH_FAILURE_LIMITER: limiter as unknown as RateLimit };
    const attempt = (pw: string, ip = "198.51.100.9") => h.call("POST", "/api/app/v1/session", { json: { email: "giamkhao@example.invalid", password: pw }, ip, envOverrides: env });
    expect((await attempt(password)).status).toBe(201);
    expect(await problemCode(await attempt("aaaaa-bbbbb-ccccc-ddddd"))).toBe("invalid_credential");
    // Budget spent: even the right password is refused, without revealing whether it was right.
    const throttled = await attempt(password);
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).toBe("60");
    expect(await problemCode(throttled)).toBe("too_many_attempts");
    // Another network is unaffected.
    expect((await attempt(password, "198.51.100.10")).status).toBe(201);
    expect(used.get("login:198.51.100.9")).toBe(3);
    // The failed attempt also counted against the general failed-authentication budget.
    expect(used.get("auth:198.51.100.9")).toBe(1);
  });

  it("never exposes data without a ticket outside the development allowlist", async () => {
    const res = await h.call("GET", "/api/demo/stream", { ip: "198.51.100.7", envOverrides: { LEGACY_STREAM_RECIPIENT_ID: w.recipientId, LEGACY_STREAM_ALLOWED_IPS: "127.0.0.1/32" } });
    const [first] = await readFrames(res, 1);
    expect(first?.data.state.care_monitoring.data_exposed).toBe(false);
    expect((await h.call("GET", "/api/demo/stream?ticket=not-a-ticket")).status).toBe(401);
  });
});

describe("authenticated hint stream", () => {
  beforeEach(async () => {
    await freshDb();
    h = harness();
    w = await provision(h);
  });

  it("requires a grant, carries hints only, and closes when the grant is revoked", async () => {
    expect((await h.call("GET", `/api/app/v1/recipients/${w.recipientId}/stream`, { token: w.outsiderToken })).status).toBe(404);
    const res = await h.call("GET", `/api/app/v1/recipients/${w.recipientId}/stream`, { token: w.caregiverToken });
    const reading = readFrames(res, 2, 5000);
    await ok(await h.call("POST", "/api/device/v1/imu-events", { token: w.deviceToken, json: imuEvent(h, { deviceId: w.deviceId, triggerId: "trg-h", triggeredAt: new Date(h.clock.t - 1000).toISOString() }) }), 201);
    const frames = await reading;
    expect(frames[0]?.data.type).toBe("stream.opened");
    expect(Object.keys(frames[1]!.data).sort()).toEqual(["entity_id", "seq", "type"]);
    expect(frames[1]?.data.type).toBe("event.created");

    const second = await h.call("GET", `/api/app/v1/recipients/${w.recipientId}/stream`, { token: w.caregiverToken });
    const reader = second.body!.getReader();
    await reader.read(); // first frame
    await ok(await h.call("POST", `/api/admin/v1/grants/${w.grantId}/revoke`, { token: ADMIN_TOKEN }));
    const end = await Promise.race([reader.read(), new Promise<{ done: boolean }>((r) => setTimeout(() => r({ done: false }), 3000))]);
    expect(end.done).toBe(true);
  });

  it("agent hint stream announces queued vision work", async () => {
    const res = await h.call("GET", "/api/agent/v1/events", { token: w.agentToken });
    const reading = readFrames(res, 2, 5000);
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-hint", capturedAt: new Date(h.clock.t - 5000).toISOString() });
    await uploadCapture(h, w.deviceToken, fx);
    const frames = await reading;
    expect(frames[1]?.data).toEqual({ type: "job_available", kind: "vision", priority: 50 });
  });
});
