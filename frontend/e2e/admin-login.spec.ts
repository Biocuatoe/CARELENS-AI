import { expect, test, type Page, type Route } from "@playwright/test";
import { BACKEND } from "./helpers";

/**
 * Admin login in a real browser against the production build. The Worker is faked at the network layer: nothing here reaches
 * Google or a real backend, and all values are synthetic. What it shows: the new routes work behind the SPA rewrite, the
 * one-time code leaves the address bar, and no admin token reaches web storage. The server-side checks are covered by the
 * Worker's own tests (backend/care-monitoring/worker/test/admin-auth.test.ts).
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
};
const TOKEN = "clm_synthetic-e2e-admin-session";
const CODE = "cax_synthetic-e2e-one-time-code";

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

interface Seen {
  requests: string[];
  exchangeAuth: Array<string | undefined>;
  authorization: string[];
}

async function mockAdminBackend(page: Page): Promise<Seen> {
  const seen: Seen = { requests: [], exchangeAuth: [], authorization: [] };
  await page.route(`${BACKEND}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    seen.requests.push(`${request.method()} ${path}`);
    const auth = request.headers().authorization;
    if (path === "/ready") return json(route, 200, { status: "ready", capabilities: { google_signin: "configured", admin_signin: "configured" } });
    if (path === "/api/admin/v1/session/exchange") {
      seen.exchangeAuth.push(auth);
      return json(route, 201, { token: TOKEN, token_type: "Bearer", expires_at: "2099-01-01T00:00:00.000Z", storage: "memory_only", admin: { admin_id: "adm_e2e", role: "owner" } });
    }
    if (auth) seen.authorization.push(auth);
    if (path === "/api/admin/v1/me") {
      return json(route, 200, {
        auth_method: "session",
        admin_id: "adm_e2e",
        email: "owner@example.invalid",
        role: "owner",
        session: { expires_at: "2099-01-01T00:00:00.000Z", authenticated_at: new Date().toISOString() },
      });
    }
    if (path === "/api/admin/v1/status") {
      return json(route, 200, { server_time: new Date().toISOString(), storage: { d1_size_bytes: null, imu_ingest: "accepting" }, queue: [], failures_24h: [], last_successful_inference: [], fusion: { policy_version: "fusion-rules.v2", suspected_fall_possible: false }, agents: [], devices: [] });
    }
    if (path === "/api/admin/v1/session" && request.method() === "DELETE") return route.fulfill({ status: 204, headers: CORS });
    return json(route, 404, { code: "not_found" });
  });
  return seen;
}

test("/admin sends a visitor to the admin login (the SPA rewrite and lazy chunk work in the production build)", async ({ page }) => {
  const seen = await mockAdminBackend(page);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Đăng nhập quản trị" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Đăng nhập quản trị bằng Google" })).toBeEnabled();
  expect(seen.requests.filter((r) => r.includes("/api/admin/"))).toEqual([]);
  // Direct load of the login route works too.
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { level: 1, name: "Đăng nhập quản trị" })).toBeVisible();
});

test("the callback fragment is exchanged once, removed from the address bar, and the session never reaches web storage", async ({ page }) => {
  const seen = await mockAdminBackend(page);
  await page.goto(`/admin/login#admin_code=${CODE}`);
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan quản trị" })).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
  expect(page.url()).not.toContain("cax_");
  expect(seen.requests.filter((r) => r === "POST /api/admin/v1/session/exchange")).toHaveLength(1);
  expect(seen.exchangeAuth).toEqual([undefined]);
  expect(seen.authorization.every((a) => a === `Bearer ${TOKEN}`)).toBe(true);
  await expect(page.getByText("owner@example.invalid")).toBeVisible();
  await expect(page.getByText("Chủ sở hữu")).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage, cookie: document.cookie }));
  expect(stored).not.toMatch(/clm_|cax_/);
  // A reload drops the in-memory session: the admin area is closed again until the next Google sign-in.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Đăng nhập quản trị" })).toBeVisible();
});

test("logout calls the admin endpoint and closes the admin area", async ({ page }) => {
  const seen = await mockAdminBackend(page);
  await page.goto(`/admin/login#admin_code=${CODE}`);
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan quản trị" })).toBeVisible();
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Đăng nhập quản trị" })).toBeVisible();
  expect(seen.requests).toContain("DELETE /api/admin/v1/session");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("a cancelled Google sign-in shows its message and leaves a clean address bar", async ({ page }) => {
  const seen = await mockAdminBackend(page);
  await page.goto("/admin/login#error=google_denied");
  await expect(page.getByText("Bạn đã hủy đăng nhập bằng Google.")).toBeVisible();
  expect(page.url()).not.toContain("#");
  expect(seen.requests.filter((r) => r.includes("/api/admin/"))).toEqual([]);
});
