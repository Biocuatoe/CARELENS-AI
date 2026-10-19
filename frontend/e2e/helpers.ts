import { expect, type Page, type Route } from "@playwright/test";

/** The build under test is made with VITE_API_BASE_URL = this origin (see playwright.config.ts). No real backend is contacted. */
export const BACKEND = process.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";
export const LIVE_DEMO_HOME = /\/people\/r_liveshowcase\/overview$/;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
};

export interface BackendMock {
  /** Every request the page sent to the mocked backend, as "METHOD /path". */
  requests: string[];
  /** Authorization headers seen on authenticated calls. */
  authorization: string[];
  /** Full URLs of event stream requests. */
  streamUrls: string[];
  /** Bodies of POST /api/app/v1/session. */
  /** Codes posted to POST /api/app/v1/session/exchange. */
  exchangeCodes: string[];
  loginBodies: Array<{ username?: string; email?: string; password?: string }>;
}

export interface BackendOptions {
  /** Server-side role of the shared account. Default: viewer (the judge account). */
  role?: "viewer" | "caregiver";
  login?: "ok" | "unavailable" | "throttled" | "origin_blocked";
  /** Stream ticket answer. 401 simulates a revoked or expired session. */
  ticket?: 201 | 401;
  /** Whether the server reports Google sign-in as configured. Default: false. */
  googleEnabled?: boolean;
  /** `password_sign_in` in the Google config answer; undefined = omitted, as older servers do (form shown). */
  passwordSignIn?: boolean;
  /** Body of one state_update frame served on the event stream; null = the stream carries nothing. */
  stream?: unknown;
}

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * Fakes the care-monitoring backend at the network layer so the real login form, session handling and stream ticket
 * code run end to end in the browser. The credential value is a test constant, never a real one.
 */
export async function mockBackend(page: Page, options: BackendOptions = {}): Promise<BackendMock> {
  const mock: BackendMock = { requests: [], authorization: [], streamUrls: [], loginBodies: [], exchangeCodes: [] };
  const { role = "viewer", login = "ok", ticket = 201, stream = null, googleEnabled = false, passwordSignIn } = options;

  await page.route(`${BACKEND}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    // A server that is down answers nothing at all (not even /health), which is what tells it apart from a refused origin.
    if (login === "unavailable") return route.abort("failed");
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    mock.requests.push(`${request.method()} ${path}`);
    const auth = request.headers().authorization;
    if (auth) mock.authorization.push(auth);

    if (path === "/api/app/v1/session" && request.method() === "POST") {
      // The browser reports a CORS refusal exactly like a dead server (the fetch rejects) while /health still answers.
      if (login === "origin_blocked") return route.abort("failed");
      if (login === "throttled") return json(route, 429, { code: "rate_limited" });
      const body = request.postDataJSON() as { username?: string; email?: string; password?: string };
      mock.loginBodies.push(body);
      if (typeof body.username !== "string" || body.password !== "test-only-password") return json(route, 401, { code: "unauthenticated" });
      return json(route, 201, {
        token: "clc_e2e_session_token",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        user: { user_id: "usr_e2e", display_name: "Ban giám khảo" },
        recipients: [{ recipient_id: "rcp-e2e", role, permissions: role === "caregiver" ? ["data.read", "alerts.act"] : ["data.read"] }],
      });
    }
    if (path === "/health") return json(route, 200, { status: "ok" });
    if (path === "/api/app/v1/auth/google/config") {
      return json(route, 200, { enabled: googleEnabled, ...(passwordSignIn === undefined ? {} : { password_sign_in: passwordSignIn }) });
    }
    if (path === "/api/app/v1/auth/google/start") return route.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: "<!doctype html><title>google-start</title><p>start</p>" });
    if (path === "/api/app/v1/session/exchange" && request.method() === "POST") {
      const body = request.postDataJSON() as { code?: string };
      mock.exchangeCodes.push(body.code ?? "");
      if (body.code !== "clx_e2e_valid_code") return json(route, 401, { code: "unauthenticated" });
      return json(route, 201, {
        token: "clc_e2e_google_session_token",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        user: { user_id: "usr_e2e", display_name: "Ban giám khảo" },
        recipients: [{ recipient_id: "rcp-e2e", role, permissions: role === "caregiver" ? ["data.read", "alerts.act"] : ["data.read"] }],
      });
    }
    if (path === "/api/app/v1/session" && request.method() === "DELETE") return json(route, 204);
    if (path === "/api/app/v1/stream-tickets") return ticket === 201 ? json(route, 201, { ticket: "cls_e2e_ticket" }) : json(route, 401, { code: "unauthenticated" });
    if (path === "/api/demo/stream") {
      mock.streamUrls.push(request.url());
      if (stream === null) return route.abort("failed");
      return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "text/event-stream" }, body: "data: " + JSON.stringify({ type: "state_update", state: stream }) + "\n\n" });
    }
    return json(route, 404, { code: "not_found" });
  });
  return mock;
}

/** One state_update frame as the backend sends it: an online hub and one provisional fall alert. */
export function liveState(): unknown {
  const now = Date.now();
  const iso = (ms: number) => new Date(now - ms).toISOString();
  return {
    schema_version: "care-monitoring-legacy-3",
    hubs: {
      d_hub_liveshowcase: {
        id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: iso(10_000),
        last_seen_ms: now - 10_000,
        signal: "connected",
        latest_data: null,
        battery: null,
      },
    },
    events: [
      {
        id: "fdc_e2e_1",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        category: "fall_like",
        type: "suspected_fall",
        severity: "warning",
        care_level: null,
        summary: "Nghi ngã. Cảnh báo tạm thời, cần người chăm sóc xác minh ngay.",
        description: "Bằng chứng hình ảnh và chuyển động khớp nhau.",
        observed_at: iso(60_000),
        received_at: iso(55_000),
        source_mode: "device",
        schema_version: "care-monitoring-legacy-3",
        source_record_id: "fdc_e2e_1",
        alert_triggered: true,
        product: "carelens",
        alert_id: "alt_e2e_1",
      },
    ],
    alerts: [
      {
        id: "alt_e2e_1",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        severity: "warning",
        category: "fall_like",
        summary: "Nghi ngã. Cảnh báo tạm thời, cần người chăm sóc xác minh ngay.",
        status: "open",
        triggered_at: iso(55_000),
        acknowledged_at: null,
        acknowledged_by: null,
        review_outcome: null,
        review_note: null,
        resolved_at: null,
        resolved_by: null,
        product: "carelens",
        version: 1,
        policy_version: "fusion-rules.v2",
        source_mode: "device",
      },
    ],
    notes: [],
    reset_at: null,
    alert_actions: [],
    seq: 1,
    updated_at: iso(1_000),
  };
}

/** Fills and submits the real login form. */
export async function submitLogin(page: Page, password = "test-only-password") {
  await page.getByRole("textbox", { name: /^Tài khoản/ }).fill("DAYONE");
  await page.getByLabel(/^Mật khẩu/).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
}

/** Signs in through the real form. The session lives in memory, so later navigation must go through links in the app. */
export async function signInLiveDemo(page: Page) {
  await page.goto("/login");
  await submitLogin(page);
  await expect(page).toHaveURL(LIVE_DEMO_HOME);
}

/** Khớp tên link điều hướng, cho phép phần bổ sung cho trình đọc màn hình như "(3 cảnh báo đang mở)". */
function navName(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`^${escaped}(\s*\(|$)`);
}

export async function navTo(page: Page, label: string) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width >= 1024) {
    await page.locator("aside").first().getByRole("link", { name: navName(label) }).click();
  } else if (width >= 768) {
    await page.locator("aside").nth(1).getByRole("link", { name: navName(label) }).click();
  } else {
    await page.getByRole("button", { name: "Mở menu" }).click();
    await page.locator("header").getByRole("link", { name: navName(label) }).click();
  }
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "trang không được tràn ngang").toBeLessThanOrEqual(0);
}
