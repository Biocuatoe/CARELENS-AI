import { expect, test, type Page } from "@playwright/test";

/**
 * Opt-in, NO MOCKS: the real login form and the Live Demo against a running care-monitoring Worker with its real D1.
 * Skipped unless E2E_LIVE_BACKEND_URL, E2E_LIVE_EMAIL (the account identifier, e.g. a user name) and E2E_LIVE_PASSWORD
 * are set. The frontend under test must have been built with, or run against, VITE_API_BASE_URL = E2E_LIVE_BACKEND_URL
 * (the Vite dev server falls back to http://127.0.0.1:8787 by itself; set E2E_BASE_URL to test it instead of the preview).
 * Orchestrators: docs/DEV_LOCAL.md (local dev stack) and integrations/carelens/local-agent/tests/integration/test_e2e_browser_live_demo.py.
 */
const backend = process.env.E2E_LIVE_BACKEND_URL;
const account = process.env.E2E_LIVE_EMAIL;
const password = process.env.E2E_LIVE_PASSWORD;
const expectTexts = (process.env.E2E_LIVE_EXPECT_TEXT ?? "").split("|").filter(Boolean);

test.skip(!backend || !account || !password, "needs a running local care-monitoring backend (see docs/DEV_LOCAL.md)");

/** Client-side navigation keeps the in-memory session (a full page load would sign the user out by design). */
async function navigate(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

async function fillAndSubmit(page: Page, pw: string) {
  await page.getByRole("textbox", { name: /^Tài khoản/ }).fill(account!);
  await page.getByLabel(/^Mật khẩu/).fill(pw);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
}

test("the real backend rejects a wrong password and an unknown account without a connection error", async ({ page }) => {
  await page.goto("/login");
  await fillAndSubmit(page, `${password}-wrong`);
  await expect(page.getByRole("alert")).toContainText("Tài khoản hoặc mật khẩu không đúng.");
  await expect(page.getByRole("alert")).not.toContainText("Không kết nối");
  await page.getByRole("textbox", { name: /^Tài khoản/ }).fill("no-such-account-xyz");
  await page.getByLabel(/^Mật khẩu/).fill(password!);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Tài khoản hoặc mật khẩu không đúng.");
  await expect(page).toHaveURL(/\/login$/);
});

test("signs in through the login form, loads protected data from the API, and logout ends only that session", async ({ page, request }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  let token = "";
  page.on("response", async (r) => {
    if (r.url().endsWith("/api/app/v1/session") && r.request().method() === "POST" && r.status() === 201) token = ((await r.json()) as { token: string }).token;
  });

  await page.goto("/login");
  await fillAndSubmit(page, password!);
  await expect(page).toHaveURL(/\/people\/r_liveshowcase\/overview$/);
  expect(token, "the real backend issued a session token").toMatch(/^clc_/);

  // The session is genuine on the server side and grants read-only access to protected data.
  expect((await request.get(`${backend}/api/app/v1/me`, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(200);
  expect((await request.get(`${backend}/api/app/v1/me`, { headers: { authorization: "Bearer clc_not-a-real-token" } })).status()).toBe(401);
  expect((await request.get(`${backend}/api/app/v1/me`)).status()).toBe(401);

  await navigate(page, "/people/r_liveshowcase/carelens");
  for (const text of expectTexts) await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Trạng thái hệ thống", { exact: false }).first()).toBeVisible();

  const stream = requests.find((u) => u.includes("/api/demo/stream"));
  expect(stream, "the Live Demo opened the backend stream").toBeTruthy();
  expect(stream).toContain("ticket=cls_");
  expect(requests.join("\n")).not.toContain("clc_");
  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
  expect(stored).not.toContain("clc_");
  expect(stored).not.toContain("cls_");

  // Logout revokes this session on the server and the app returns to the login page.
  await page.locator("aside").first().getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await request.get(`${backend}/api/app/v1/me`, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(401);
  await navigate(page, "/people/r_liveshowcase/overview");
  await expect(page).toHaveURL(/\/login/);
});

/**
 * Google sign-in against the real Worker. E2E_LIVE_GOOGLE=on when the server has Google configured (with any client id:
 * the browser never reaches Google here, the request to accounts.google.com is aborted); otherwise the server must say
 * honestly that it is not configured. A real Google login needs a real Google account and is not automated.
 */
const googleOn = process.env.E2E_LIVE_GOOGLE === "on";

test(`real Worker: the Google button ${googleOn ? "redirects to Google with state, nonce and PKCE" : "reports that Google sign-in is not configured"}`, async ({ page }) => {
  await page.goto("/login");
  if (!googleOn) {
    await page.getByRole("button", { name: "Đăng nhập bằng Google" }).click();
    await expect(page.getByRole("alert")).toContainText("chưa được cấu hình");
    await expect(page).toHaveURL(/\/login$/);
    return;
  }
  await page.route("https://accounts.google.com/**", (route) => route.abort());
  const google = page.waitForRequest((r) => r.url().startsWith("https://accounts.google.com/o/oauth2/v2/auth"));
  await page.getByRole("button", { name: "Đăng nhập bằng Google" }).click();
  const url = new URL((await google).url());
  expect(url.searchParams.get("scope")).toBe("openid email");
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")?.length).toBeGreaterThan(30);
  for (const name of ["state", "nonce", "client_id", "redirect_uri"]) expect(url.searchParams.get(name), name).toBeTruthy();
  expect(url.search).not.toMatch(/client_secret|code_verifier/);
});
