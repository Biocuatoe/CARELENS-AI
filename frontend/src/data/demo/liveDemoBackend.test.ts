/**
 * Live Demo ↔ care-monitoring backend: base URL resolution, server sign-in, single-use stream tickets,
 * merging of real state_update frames, honest failure reporting, and alert actions confirmed by the server.
 * fetch and EventSource are replaced by in-test fakes that record what the browser would send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../errors";
import { DemoAdapter, resolveApiBase } from "./demoAdapter";

const API = "https://care-monitoring.example.workers.dev";
const NOW = Date.parse("2026-10-19T03:00:00Z");

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  send(state: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type: "state_update", state }) } as MessageEvent);
  }
  fail() {
    this.onerror?.();
  }
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
let routes: Record<string, (body: unknown) => { status: number; body?: unknown }> = {};

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body });
  const handler = routes[`${method} ${url.replace(API, "")}`];
  if (!handler) return Promise.reject(new TypeError("network down"));
  const out = handler(body);
  return Promise.resolve(new Response(out.body === undefined ? null : JSON.stringify(out.body), { status: out.status }));
}

const LOGIN_OK = {
  token: "clc_session_token_value",
  expires_at: "2026-10-19T15:00:00.000Z",
  user: { user_id: "usr_1", display_name: "Giám khảo" },
  recipients: [{ recipient_id: "rcp-real-1", role: "viewer", permissions: ["data.read"] }],
};

function adapter(apiBase: string | null = API) {
  return new DemoAdapter({ now: () => NOW, latencyMs: [0, 0], apiBase });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

type Json = Record<string, unknown>;
function state(over: Json = {}): Json & { events: Json[]; alerts: Json[] } {
  return {
    schema_version: "care-monitoring-legacy-3",
    hubs: {
      d_hub_liveshowcase: { id: "d_hub_liveshowcase", recipient_id: "r_liveshowcase", online: true, last_seen_at: "2026-10-19T02:59:50.000Z", last_seen_ms: NOW - 10_000, signal: "connected", latest_data: null, battery: null },
    },
    events: [
      {
        id: "fdc_1",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        category: "fall_like",
        type: "suspected_fall",
        severity: "warning",
        care_level: null,
        summary: "Nghi ngã lúc 09:59. Cảnh báo tạm thời, cần người chăm sóc xác minh ngay.",
        description: "",
        observed_at: "2026-10-19T02:59:56.500Z",
        received_at: "2026-10-19T03:00:00.000Z",
        source_mode: "device",
        schema_version: "fusion-rules.v2",
        source_record_id: "fdc_1",
        alert_triggered: true,
        alert_id: "alr_1",
        product: "carelens",
      },
    ],
    alerts: [
      {
        id: "alr_1",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        severity: "warning",
        category: "fall_like",
        summary: "Nghi ngã lúc 09:59.",
        status: "open",
        version: 1,
        policy_version: "fusion-rules.v2",
        source_mode: "device",
        triggered_at: "2026-10-19T03:00:00.000Z",
        acknowledged_at: null,
        acknowledged_by: null,
        review_outcome: null,
        review_note: null,
        resolved_at: null,
        resolved_by: null,
        product: "carelens",
      },
    ],
    notes: [],
    reset_at: null,
    alert_actions: [],
    seq: 4,
    updated_at: "2026-10-19T03:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  calls = [];
  routes = {
    "POST /api/app/v1/session": () => ({ status: 201, body: LOGIN_OK }),
    "DELETE /api/app/v1/session": () => ({ status: 204 }),
    "POST /api/app/v1/stream-tickets": () => ({ status: 201, body: { ticket: `cls_ticket_${calls.length}` } }),
  };
  FakeEventSource.instances = [];
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("backend base URL", () => {
  it("never falls back to localhost in a production build", () => {
    expect(resolveApiBase(undefined, null)).toBeNull();
    expect(resolveApiBase("  ", null)).toBeNull();
    expect(resolveApiBase(`${API}/`, null)).toBe(API);
    expect(resolveApiBase(undefined, "http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  });

  it("refuses to sign in when the build has no backend configured", async () => {
    const err = await adapter(null).login({ username: "a@example.invalid", password: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("auth_unavailable");
    // What is wrong, what to fix in the build, and who to ask.
    expect((err as ApiError).message).toContain("chưa kết nối máy chủ xác thực");
    expect((err as ApiError).message).toContain("VITE_API_BASE_URL");
    expect(calls).toHaveLength(0);
  });
});

describe("server sign-in", () => {
  it("signs in against the backend, keeps the token in memory only and mirrors the read-only role", async () => {
    const a = adapter();
    const session = await a.login({ username: " giamkhao@example.invalid ", password: "abcde-fghjk-mnpqr-stvwx" });
    expect(calls[0]).toMatchObject({ url: `${API}/api/app/v1/session`, method: "POST", body: { username: "giamkhao@example.invalid", password: "abcde-fghjk-mnpqr-stvwx" } });
    expect(session.user).toMatchObject({ id: "u_liveshowcase", displayName: "Giám khảo" });
    expect(session.expiresAt).toBe(LOGIN_OK.expires_at);
    expect(a.hasBackendSession()).toBe(true);
    expect(JSON.stringify({ ...localStorage })).not.toContain("clc_");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("clc_");
    // Viewer: reading is allowed, acting on alerts and local-only writes are not.
    await expect(a.listEvents("r_liveshowcase", { range: "24h", severity: "all", category: "all" })).resolves.toBeTruthy();
    await expect(a.addNote("r_liveshowcase", "ghi chú thử")).rejects.toMatchObject({ status: 403 });
    await expect(a.emitCareEvent("r_liveshowcase")).rejects.toMatchObject({ status: 403 });
  });

  it("reports wrong credentials, throttling and an unreachable server distinctly", async () => {
    routes["POST /api/app/v1/session"] = () => ({ status: 401, body: { code: "invalid_credential" } });
    await expect(adapter().login({ username: "a@example.invalid", password: "x" })).rejects.toMatchObject({ status: 401, message: "Tài khoản hoặc mật khẩu không đúng." });
    routes["POST /api/app/v1/session"] = () => ({ status: 429 });
    await expect(adapter().login({ username: "a@example.invalid", password: "x" })).rejects.toMatchObject({ code: "rate_limited" });
    delete routes["POST /api/app/v1/session"];
    await expect(adapter().login({ username: "a@example.invalid", password: "x" })).rejects.toMatchObject({ code: "api_unavailable" });
  });

  it("tells a refused origin (CORS) from a server that is down, and a rejected request from a server error", async () => {
    // The session call fails in the browser's eyes, but /health answers (opaque no-cors response): the server is up.
    delete routes["POST /api/app/v1/session"];
    routes["GET /health"] = () => ({ status: 200, body: { status: "ok" } });
    await expect(adapter().login({ username: "DAYONE", password: "x" })).rejects.toMatchObject({ code: "origin_blocked" });
    expect(calls.some((c) => c.url === `${API}/health`)).toBe(true);
    delete routes["GET /health"];
    await expect(adapter().login({ username: "DAYONE", password: "x" })).rejects.toMatchObject({ code: "api_unavailable" });
    routes["POST /api/app/v1/session"] = () => ({ status: 422 });
    await expect(adapter().login({ username: "DAYONE", password: "x" })).rejects.toMatchObject({ status: 422, code: "validation" });
    routes["POST /api/app/v1/session"] = () => ({ status: 500 });
    await expect(adapter().login({ username: "DAYONE", password: "x" })).rejects.toMatchObject({ code: "auth_unavailable", message: expect.stringContaining("mã 500") });
  });

  it("Google sign-in: asks the server whether it is configured, and trades the single-use code for a session like a password sign-in", async () => {
    routes["GET /api/app/v1/auth/google/config"] = () => ({ status: 200, body: { enabled: false } });
    await expect(adapter().getGoogleSignIn()).resolves.toEqual({ enabled: false, startUrl: `${API}/api/app/v1/auth/google/start`, passwordSignIn: true });
    routes["GET /api/app/v1/auth/google/config"] = () => ({ status: 200, body: { enabled: true } });
    await expect(adapter().getGoogleSignIn()).resolves.toMatchObject({ enabled: true, passwordSignIn: true });
    // A Google-only server says so explicitly; only then is the password form hidden.
    routes["GET /api/app/v1/auth/google/config"] = () => ({ status: 200, body: { enabled: true, access: "open_viewer", password_sign_in: false } });
    await expect(adapter().getGoogleSignIn()).resolves.toMatchObject({ enabled: true, passwordSignIn: false });
    routes["GET /api/app/v1/auth/google/config"] = () => ({ status: 500 });
    await expect(adapter().getGoogleSignIn()).rejects.toMatchObject({ code: "auth_unavailable" });

    routes["POST /api/app/v1/session/exchange"] = () => ({ status: 201, body: LOGIN_OK });
    const a = adapter();
    const session = await a.completeGoogleSignIn("clx_code_from_redirect");
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: `${API}/api/app/v1/session/exchange`, body: { code: "clx_code_from_redirect" } });
    expect(calls.at(-1)?.headers.authorization).toBeUndefined();
    expect(session.user.displayName).toBe("Giám khảo");
    expect(a.hasBackendSession()).toBe(true);
    // The credential is never shown as an address the person did not type.
    expect(session.user.email).toBe("");
  });

  it("Google sign-in: a used, expired or forged code and a throttled network are refused without creating a session", async () => {
    routes["POST /api/app/v1/session/exchange"] = () => ({ status: 401 });
    const a = adapter();
    await expect(a.completeGoogleSignIn("clx_used")).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    expect(a.hasBackendSession()).toBe(false);
    routes["POST /api/app/v1/session/exchange"] = () => ({ status: 429 });
    await expect(adapter().completeGoogleSignIn("clx_x")).rejects.toMatchObject({ code: "rate_limited" });
    routes["POST /api/app/v1/session/exchange"] = () => ({ status: 201, body: { ...LOGIN_OK, recipients: [] } });
    await expect(adapter().completeGoogleSignIn("clx_x")).rejects.toMatchObject({ status: 403 });
  });

  it("refuses an account without any readable recipient and ends that server session", async () => {
    routes["POST /api/app/v1/session"] = () => ({ status: 201, body: { ...LOGIN_OK, recipients: [] } });
    await expect(adapter().login({ username: "a@example.invalid", password: "x" })).rejects.toMatchObject({ status: 403 });
    await flush();
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/api/app/v1/session"))).toBe(true);
  });

  it("logs out on the server too", async () => {
    const a = adapter();
    await a.login({ username: "a@example.invalid", password: "x" });
    await a.logout();
    const del = calls.find((c) => c.method === "DELETE");
    expect(del?.headers.authorization).toBe("Bearer clc_session_token_value");
    expect(a.hasBackendSession()).toBe(false);
  });
});

describe("Live Demo stream", () => {
  async function signedIn(role: "viewer" | "caregiver" = "viewer") {
    routes["POST /api/app/v1/session"] = () => ({ status: 201, body: { ...LOGIN_OK, recipients: [{ recipient_id: "rcp-real-1", role, permissions: role === "caregiver" ? ["data.read", "alerts.act"] : ["data.read"] }] } });
    const a = adapter();
    await a.login({ username: "a@example.invalid", password: "x" });
    return a;
  }

  it("opens the stream with a fresh single-use ticket and never puts the session token in the URL", async () => {
    const a = await signedIn();
    const onClose = vi.fn();
    a.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose });
    await flush();
    const ticketCall = calls.find((c) => c.url.endsWith("/api/app/v1/stream-tickets"));
    expect(ticketCall).toMatchObject({ method: "POST", body: { recipient_id: "rcp-real-1" }, headers: { authorization: "Bearer clc_session_token_value" } });
    const es = FakeEventSource.instances[0]!;
    expect(es.url.startsWith(`${API}/api/demo/stream?ticket=cls_ticket_`)).toBe(true);
    expect(es.url).not.toContain("clc_");
    es.open();
    es.send(state());
    // The server ends streams after SSE_MAX_LIFETIME_SECONDS: the consumed ticket is dropped and the stream
    // reopens at once with a new ticket and the last seen seq, without reporting an error.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_000);
    es.fail();
    expect(es.closed).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    clock.mockRestore();
    expect(FakeEventSource.instances).toHaveLength(2);
    const next = FakeEventSource.instances[1]!;
    expect(next.url).toMatch(/\?ticket=cls_ticket_\d+&last_seq=4$/);
    expect(next.url).not.toBe(es.url);
    expect(onClose).not.toHaveBeenCalled();
    // The new stream starts with the full state again: records are updated in place, not duplicated.
    next.open();
    next.send(state());
    const events = await a.listEvents("r_liveshowcase", { range: "24h", severity: "all", category: "all" });
    expect(events.items.filter((e) => e.id === "fdc_1")).toHaveLength(1);
    const alerts = await a.listAlerts("r_liveshowcase", { product: "all", status: "all", range: "24h", assignee: "all" });
    expect(alerts.items.filter((x) => x.id === "alr_1")).toHaveLength(1);
  });

  it("reports a stream that drops right after opening and mints no ticket until the back-off has passed", async () => {
    const a = await signedIn();
    const tickets = () => calls.filter((c) => c.url.endsWith("/api/app/v1/stream-tickets")).length;
    const onClose = vi.fn();
    a.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose });
    await flush();
    const es = FakeEventSource.instances[0]!;
    es.open();
    es.fail(); // e.g. a proxy that cuts event streams
    expect(es.closed).toBe(true);
    expect(onClose).toHaveBeenCalledWith("error");
    const t0 = Date.now();
    // The stream hook resubscribes after 5 s; inside the back-off window nothing is requested.
    const clock = vi.spyOn(Date, "now").mockReturnValue(t0 + 4_000);
    const early = vi.fn();
    a.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose: early });
    await flush();
    expect(early).toHaveBeenCalledWith("error");
    expect([tickets(), FakeEventSource.instances.length]).toEqual([1, 1]);
    // After 5 s a fresh ticket is minted; a second failure doubles the wait to 10 s.
    clock.mockReturnValue(t0 + 5_001);
    a.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose: vi.fn() });
    await flush();
    expect(tickets()).toBe(2);
    FakeEventSource.instances[1]!.fail(); // never opened
    clock.mockReturnValue(t0 + 5_001 + 9_000);
    a.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose: vi.fn() });
    await flush();
    expect(tickets()).toBe(2);
    clock.mockReturnValue(t0 + 5_001 + 10_001);
    a.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose: vi.fn() });
    await flush();
    expect(tickets()).toBe(3);
    clock.mockRestore();
  });

  it("merges real records with their provenance and updates them in place instead of duplicating", async () => {
    const a = await signedIn();
    a.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose: vi.fn() });
    await flush();
    const es = FakeEventSource.instances[0]!;
    es.open();
    es.send(state());
    const events = await a.listEvents("r_liveshowcase", { range: "24h", severity: "all", category: "all" });
    const fall = events.items.find((e) => e.id === "fdc_1");
    expect(fall).toMatchObject({ alertId: "alr_1", sourceMode: "device", ruleVersion: "fusion-rules.v2" });
    const alerts = await a.listAlerts("r_liveshowcase", { product: "all", status: "all", range: "24h", assignee: "all" });
    expect(alerts.items.find((x) => x.id === "alr_1")).toMatchObject({ sourceMode: "device", version: 1, status: "open", ruleVersion: "fusion-rules.v2" });
    // Another caregiver acknowledged on the server; the decision was verified.
    const later = state();
    later.alerts[0] = { ...later.alerts[0]!, status: "acknowledged", version: 2, acknowledged_by: "Người thân", acknowledged_at: "2026-10-19T03:01:00.000Z" };
    later.events[0] = { ...later.events[0]!, type: "verified", summary: `${String(later.events[0]!.summary)} Người chăm sóc đã xác minh.` };
    es.send(later);
    const again = await a.listAlerts("r_liveshowcase", { product: "all", status: "all", range: "24h", assignee: "all" });
    expect(again.items.filter((x) => x.id === "alr_1")).toHaveLength(1);
    expect(again.items.find((x) => x.id === "alr_1")).toMatchObject({ status: "acknowledged", version: 2, assigneeName: "Người thân" });
    const ev = await a.listEvents("r_liveshowcase", { range: "24h", severity: "all", category: "all" });
    expect(ev.items.filter((e) => e.id === "fdc_1")).toHaveLength(1);
    expect(ev.items.find((e) => e.id === "fdc_1")?.summary).toContain("đã xác minh");
  });

  it("reports an unreachable backend instead of showing stale data as live", async () => {
    const a = await signedIn();
    const onClose = vi.fn();
    a.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose });
    await flush();
    FakeEventSource.instances[0]!.fail(); // never opened
    expect(onClose).toHaveBeenCalledWith("error");
    // Ticket endpoint down (a fresh sign-in, so no back-off from the failure above applies).
    delete routes["POST /api/app/v1/stream-tickets"];
    const b = await signedIn();
    const onClose2 = vi.fn();
    b.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose: onClose2 });
    await flush();
    expect(onClose2).toHaveBeenCalledWith("error");
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("ends the session when the server no longer accepts it", async () => {
    const a = await signedIn();
    routes["POST /api/app/v1/stream-tickets"] = () => ({ status: 401 });
    const onClose = vi.fn();
    a.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose });
    await flush();
    expect(onClose).toHaveBeenCalledWith("session_expired");
    expect(a.hasBackendSession()).toBe(false);
  });

  it("without a configured backend the Live Demo reports the stream as unavailable", async () => {
    const a = adapter(null);
    await a.enterDemo("u_liveshowcase");
    const onClose = vi.fn();
    a.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose });
    await flush();
    expect(onClose).toHaveBeenCalledWith("error");
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("sends alert actions to the server and shows only what the server confirmed", async () => {
    const a = await signedIn("caregiver");
    a.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose: vi.fn() });
    await flush();
    FakeEventSource.instances[0]!.send(state());
    routes["POST /api/app/v1/recipients/rcp-real-1/alerts/alr_1/actions"] = () => ({
      status: 200,
      body: { alert: { status: "acknowledged", version: 2, review_outcome: null, review_note: null, resolved_at: null } },
    });
    const detail = await a.actOnAlert("r_liveshowcase", "alr_1", { type: "acknowledge", expectedVersion: 1 });
    const call = calls.find((c) => c.url.endsWith("/alerts/alr_1/actions"));
    expect(call?.body).toEqual({ action: "acknowledge", expected_version: 1, review_outcome: null, note: null });
    expect(detail.alert).toMatchObject({ status: "acknowledged", version: 2 });
    routes["POST /api/app/v1/recipients/rcp-real-1/alerts/alr_1/actions"] = () => ({ status: 409, body: { code: "alert_state_conflict" } });
    await expect(a.actOnAlert("r_liveshowcase", "alr_1", { type: "start", expectedVersion: 2 })).rejects.toMatchObject({ status: 409, code: "conflict" });
    routes["POST /api/app/v1/recipients/rcp-real-1/alerts/alr_1/actions"] = () => ({ status: 503 });
    await expect(a.actOnAlert("r_liveshowcase", "alr_1", { type: "start", expectedVersion: 2 })).rejects.toMatchObject({ code: "api_unavailable" });
    const unchanged = await a.listAlerts("r_liveshowcase", { product: "all", status: "all", range: "24h", assignee: "all" });
    expect(unchanged.items.find((x) => x.id === "alr_1")).toMatchObject({ status: "acknowledged", version: 2 });
  });

  it("a viewer cannot act on server alerts and no request is sent", async () => {
    const a = await signedIn("viewer");
    a.subscribe("r_liveshowcase", { onHint: vi.fn(), onClose: vi.fn() });
    await flush();
    FakeEventSource.instances[0]!.send(state());
    const before = calls.length;
    await expect(a.actOnAlert("r_liveshowcase", "alr_1", { type: "acknowledge", expectedVersion: 1 })).rejects.toMatchObject({ status: 403 });
    expect(calls).toHaveLength(before);
  });
});
