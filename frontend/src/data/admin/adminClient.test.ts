import { describe, expect, it, vi } from "vitest";
import { AdminApiError, AdminClient, isAdminAuthFailure, parseOpsStatus, parseProfile } from "./adminClient";

/** Synthetic values only: no real token, e-mail or account. */
const BASE = "https://api.test";
const TOKEN = "clm_synthetic-test-token-not-real";
const PROFILE = { auth_method: "session", admin_id: "adm_test", email: "owner@example.invalid", role: "owner", session: { expires_at: "2026-10-19T05:00:00.000Z", authenticated_at: "2026-10-19T03:00:00.000Z" } };

interface Seen {
  url: string;
  init: RequestInit;
}

function fake(reply: (url: string, init: RequestInit) => Response | Promise<Response> | Error) {
  const seen: Seen[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ url, init });
    const r = await reply(url, init);
    if (r instanceof Error) throw r;
    return r;
  });
  return { client: new AdminClient(BASE, impl as unknown as typeof fetch), seen, impl };
}

const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const problem = (status: number, code: string) => json(status, { type: `urn:carelens:problem:${code}`, status, code, detail: "internal detail that must not reach the user", request_id: "r" });

describe("AdminClient", () => {
  it("builds the admin Google start URL from the build's API base and nothing else", () => {
    expect(new AdminClient(BASE).startUrl).toBe("https://api.test/api/app/v1/auth/google/start?mode=admin");
    expect(new AdminClient(null).startUrl).toBeNull();
  });

  it("exchanges a code at the admin endpoint without sending any Authorization header or cookie", async () => {
    const { client, seen } = fake(() => json(201, { token: TOKEN, token_type: "Bearer", expires_at: "2026-10-19T05:00:00.000Z", storage: "memory_only", admin: { admin_id: "adm_test", role: "owner" } }));
    await expect(client.exchangeCode("cax_synthetic-code")).resolves.toEqual({ token: TOKEN, expiresAt: "2026-10-19T05:00:00.000Z", adminId: "adm_test", role: "owner" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://api.test/api/admin/v1/session/exchange");
    expect(seen[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ code: "cax_synthetic-code" });
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(seen[0]!.init.credentials).toBe("omit");
    expect(seen[0]!.init.cache).toBe("no-store");
  });

  it("never treats a reply that is not a real session as one", async () => {
    for (const body of [{}, { token: "clc_a-viewer-token", token_type: "Bearer", expires_at: "x", admin: { admin_id: "a", role: "owner" } }, { token: TOKEN, token_type: "Bearer", expires_at: "x", admin: { admin_id: "a", role: "root" } }, { token: TOKEN, token_type: "Bearer", expires_at: "x" }]) {
      const { client } = fake(() => json(201, body));
      await expect(client.exchangeCode("cax_synthetic-code")).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("maps exchange failures to one explicit message each, never repeating server text", async () => {
    const cases: Array<[Response, string, number]> = [
      [problem(401, "invalid_credential"), "unauthenticated", 401],
      [problem(429, "too_many_attempts"), "rate_limited", 429],
      [problem(503, "admin_signin_not_configured"), "not_configured", 503],
      [problem(503, "misconfigured"), "misconfigured", 503],
      [problem(422, "validation"), "bad_request", 422],
      [problem(500, "internal_error"), "unavailable", 503],
    ];
    for (const [response, code, status] of cases) {
      const { client } = fake(() => response.clone());
      const error = await client.exchangeCode("cax_synthetic-code").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AdminApiError);
      expect(error).toMatchObject({ code, status });
      expect((error as Error).message).not.toContain("internal detail");
    }
    const { client } = fake(() => problem(401, "invalid_credential"));
    expect(((await client.exchangeCode("cax_synthetic-code").catch((e: unknown) => e)) as Error).message).toMatch(/hết hạn hoặc đã được dùng/);
  });

  it("sends the session as a Bearer header only, never in the URL or body", async () => {
    const { client, seen } = fake(() => json(200, PROFILE));
    await client.me(TOKEN);
    expect(seen[0]!.url).toBe("https://api.test/api/admin/v1/me");
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]!.url).not.toContain("clm_");
    expect(seen[0]!.init.body).toBeUndefined();
    expect(seen[0]!.init.credentials).toBe("omit");
  });

  it("reads the identity and role from the server, and refuses anything that is not a session profile", async () => {
    expect(parseProfile(PROFILE)).toEqual({ adminId: "adm_test", email: "owner@example.invalid", role: "owner", expiresAt: "2026-10-19T05:00:00.000Z", authenticatedAt: "2026-10-19T03:00:00.000Z" });
    expect(parseProfile({ ...PROFILE, role: "admin" }).role).toBe("admin");
    expect(() => parseProfile({ auth_method: "static_token", admin_id: null, role: null })).toThrow(AdminApiError);
    expect(() => parseProfile({ ...PROFILE, role: "superuser" })).toThrow(AdminApiError);
    expect(() => parseProfile({ ...PROFILE, session: null })).toThrow(AdminApiError);
    expect(() => parseProfile(null)).toThrow(AdminApiError);
  });

  it("maps 401 and 403 from /me to auth failures and everything else to a retryable error", async () => {
    const auth = await fake(() => problem(401, "invalid_credential")).client.me(TOKEN).catch((e: unknown) => e);
    expect(isAdminAuthFailure(auth)).toBe(true);
    const forbidden = await fake(() => problem(403, "forbidden")).client.me(TOKEN).catch((e: unknown) => e);
    expect(isAdminAuthFailure(forbidden)).toBe(true);
    expect(forbidden).toMatchObject({ code: "forbidden" });
    const server = await fake(() => problem(502, "bad_gateway")).client.me(TOKEN).catch((e: unknown) => e);
    expect(isAdminAuthFailure(server)).toBe(false);
    expect(server).toMatchObject({ code: "unavailable" });
  });

  it("tells an unreachable server from one that refuses this page's origin", async () => {
    const down = fake(() => new TypeError("Failed to fetch"));
    expect(await down.client.me(TOKEN).catch((e: unknown) => e)).toMatchObject({ code: "unavailable" });
    // The CORS-refused API still answers the opaque /health probe, so the failure is attributed to the origin.
    let calls = 0;
    const cors = fake((url) => (url.endsWith("/health") ? new Response(null) : (calls++, new TypeError("Failed to fetch"))));
    expect(await cors.client.me(TOKEN).catch((e: unknown) => e)).toMatchObject({ code: "origin_blocked" });
    expect(calls).toBe(1);
  });

  it("gives up on a request that gets no answer within its time limit and says the outcome is unknown", async () => {
    const hang = vi.fn((_input: RequestInfo | URL, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const client = new AdminClient(BASE, hang as unknown as typeof fetch, { request: 30, upload: 60 });
    const error = await client.me(TOKEN).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdminApiError);
    expect((error as AdminApiError).code).toBe("timeout");
    expect((error as AdminApiError).message).toMatch(/Chưa biết thao tác đã được thực hiện hay chưa/);
    expect(hang).toHaveBeenCalledTimes(1); // no /health probe: a timeout is not a refused origin
  });

  it("refuses to call anywhere when the build has no API base", async () => {
    const error = await new AdminClient(null).me(TOKEN).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "no_backend" });
  });

  it("reports whether admin sign-in can work from the public readiness report, including a 503 body", async () => {
    const ready = (caps: Record<string, string>, status = 200) => fake(() => json(status, { status: status === 200 ? "ready" : "not_ready", capabilities: caps }));
    expect(await ready({ google_signin: "configured", admin_signin: "configured" }).client.signInAvailability()).toEqual({ state: "available" });
    expect(await ready({ google_signin: "configured", admin_signin: "configured" }, 503).client.signInAvailability()).toEqual({ state: "available" });
    expect(await ready({ google_signin: "configured", admin_signin: "not_configured" }).client.signInAvailability()).toEqual({ state: "unavailable", reason: "admin_off" });
    expect(await ready({ google_signin: "configured", admin_signin: "misconfigured" }).client.signInAvailability()).toEqual({ state: "unavailable", reason: "misconfigured" });
    expect(await ready({ google_signin: "not_configured", admin_signin: "configured" }).client.signInAvailability()).toEqual({ state: "unavailable", reason: "google_off" });
    // A server from before Phase B does not know the field: say so instead of showing a button that cannot work.
    expect(await ready({ google_signin: "configured" }).client.signInAvailability()).toEqual({ state: "unavailable", reason: "old_server" });
    await expect(fake(() => new Response("<html>proxy error</html>", { status: 502 })).client.signInAvailability()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("logs out with DELETE and a Bearer header, and reports whether the server confirmed", async () => {
    const ok = fake(() => new Response(null, { status: 204 }));
    expect(await ok.client.logout(TOKEN)).toBe(true);
    expect(ok.seen[0]!.init.method).toBe("DELETE");
    expect(ok.seen[0]!.url).toBe("https://api.test/api/admin/v1/session");
    expect((ok.seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(await fake(() => problem(401, "invalid_credential")).client.logout(TOKEN)).toBe(true); // already ended
    expect(await fake(() => problem(500, "internal_error")).client.logout(TOKEN)).toBe(false);
    expect(await fake(() => new TypeError("Failed to fetch")).client.logout(TOKEN)).toBe(false);
  });

  it("shows only what /status reported and drops what it did not, without inventing values", () => {
    const status = parseOpsStatus({
      server_time: "2026-10-19T03:00:00.000Z",
      storage: { d1_size_bytes: 2_500_000, imu_ingest: "accepting" },
      queue: [{ kind: "vision", waiting: 2, oldest_age_seconds: 30 }],
      failures_24h: [{ kind: "vision", status: "failed", error_code: "x", n: 2 }, { n: 1 }],
      last_successful_inference: [{ kind: "vision", last_completed_at: null }],
      fusion: { policy_version: "fusion-rules.v2", suspected_fall_possible: false },
      agents: [{ agent_id: "agt_1", label: "PC", status: "active", last_seen_at: null, connected: false, reported: null }, { label: "no id" }],
      devices: [
        { device_id: "esp32-test", recipient_id: "rcp-test", status: "active", firmware_version: null, last_seen_at: "2026-10-19T02:59:00.000Z", last_contact_age_seconds: 60, connected: true, heartbeat_status: { camera: "ok", imu: "error", speaker: "disabled", wifi_rssi_dbm: -60, last_error: null } },
        { device_id: "esp32-new", status: "active" },
        { recipient_id: "no id" },
      ],
      jobs: "ignored",
    });
    expect(status.storage).toEqual({ d1SizeBytes: 2_500_000, imuIngest: "accepting" });
    expect(status.failures24h).toBe(3);
    expect(status.agents).toEqual([{ agentId: "agt_1", label: "PC", status: "active", lastSeenAt: null, connected: false, hasReport: false, reported: [] }]);
    expect(status.devices.map((d) => d.deviceId)).toEqual(["esp32-test", "esp32-new"]);
    expect(status.devices[0]!.health).toEqual({ camera: "ok", imu: "error", speaker: "disabled", wifiRssiDbm: -60, lastError: null });
    expect(status.devices[1]).toMatchObject({ health: null, connected: false, lastSeenAt: null, firmwareVersion: null, lastContactAgeSeconds: null });
    expect(() => parseOpsStatus({ devices: [] })).toThrow(AdminApiError);
    expect(parseOpsStatus({ server_time: "2026-10-19T03:00:00.000Z" })).toMatchObject({ devices: [], agents: [], queue: [], failures24h: 0 });
  });
});
