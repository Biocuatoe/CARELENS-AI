import { expect, test } from "@playwright/test";
import { BACKEND, LIVE_DEMO_HOME, mockBackend } from "./helpers";

/**
 * Google sign-in as seen from the browser. The server side (state, PKCE, nonce, signature, allowlist) is covered by the
 * Worker's own tests (backend/care-monitoring/worker/test/google.test.ts) and cannot be driven without a real Google
 * account; here the backend is faked at the network layer and no Google page is ever contacted.
 */
const googleButton = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Đăng nhập bằng Google" });

test("khi máy chủ chưa cấu hình Google, nút báo rõ và không chuyển hướng", async ({ page }) => {
  const mock = await mockBackend(page, { googleEnabled: false });
  await page.goto("/login");
  await googleButton(page).click();
  await expect(page.getByRole("alert")).toContainText("Đăng nhập bằng Google chưa được cấu hình trên máy chủ này.");
  await expect(page).toHaveURL(/\/login$/);
  expect(mock.requests).not.toContain("GET /api/app/v1/auth/google/start");
});

test("khi đã cấu hình, nút chuyển trình duyệt tới điểm bắt đầu của máy chủ (không gọi Google từ trình duyệt, không có bí mật trên URL)", async ({ page }) => {
  const mock = await mockBackend(page, { googleEnabled: true });
  await page.goto("/login");
  await googleButton(page).click();
  await expect(page).toHaveURL(`${BACKEND}/api/app/v1/auth/google/start`);
  expect(mock.requests).toContain("GET /api/app/v1/auth/google/config");
  expect(page.url()).not.toMatch(/client_secret|client_id|code_verifier/);
});

test("quay về từ Google với mã đổi phiên: đăng nhập thật qua máy chủ, vào thẳng bảng theo dõi, mã bị xóa khỏi thanh địa chỉ", async ({ page }) => {
  const mock = await mockBackend(page, { googleEnabled: true });
  await page.goto("/login#code=clx_e2e_valid_code");
  await expect(page).toHaveURL(LIVE_DEMO_HOME);
  expect(mock.exchangeCodes).toEqual(["clx_e2e_valid_code"]); // đổi đúng một lần
  expect(page.url()).not.toContain("clx_");
  // The new session is what authorizes the next API call (the stream ticket), which follows the redirect.
  await expect.poll(() => mock.authorization).toContain("Bearer clc_e2e_google_session_token");
  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
  expect(stored).not.toMatch(/clc_|clx_|cls_/);
  await expect(page.getByRole("heading", { level: 1, name: "Demo trực tiếp" })).toBeVisible();
});

test("mã đổi phiên sai, hết hạn hoặc đã dùng bị máy chủ từ chối và người dùng ở lại trang đăng nhập", async ({ page }) => {
  const mock = await mockBackend(page, { googleEnabled: true });
  await page.goto("/login#code=clx_used_or_forged");
  await expect(page.getByRole("alert")).toContainText("Phiên đăng nhập Google đã hết hạn hoặc đã được dùng");
  await expect(page).toHaveURL(/\/login$/);
  expect(mock.exchangeCodes).toEqual(["clx_used_or_forged"]);
});

for (const [reason, message] of [
  ["google_denied", "Bạn đã hủy đăng nhập bằng Google."],
  ["google_state", "Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn."],
  ["google_unauthorized", "Tài khoản Google này chưa được cấp quyền vào Demo trực tiếp."],
  ["google_token", "Không hoàn tất được đăng nhập Google."],
  ["google_exchange", "Không hoàn tất được đăng nhập Google."],
  ["something_unexpected", "Không hoàn tất được đăng nhập Google."],
] as const) {
  test(`lỗi OAuth ${reason} hiện thông báo phù hợp, không đăng nhập và không gọi máy chủ để đổi phiên`, async ({ page }) => {
    const mock = await mockBackend(page, { googleEnabled: true });
    await page.goto(`/login#error=${reason}`);
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(page).toHaveURL(/\/login$/);
    expect(mock.exchangeCodes).toEqual([]);
    expect(mock.requests.filter((r) => r.startsWith("POST /api/app/v1/session"))).toEqual([]);
  });
}

test("vùng thông báo lỗi cố định: hiện lỗi không làm thẻ đăng nhập đổi vị trí hay kích thước", async ({ page }) => {
  await mockBackend(page, { googleEnabled: false });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  const card = page.locator("section[aria-label='Đăng nhập']");
  // The password form appears once the server has said it accepts passwords; measure after that.
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible();
  const before = await card.boundingBox();
  await googleButton(page).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const after = await card.boundingBox();
  expect(after).toEqual(before);
});

test("nút Google là lối chính: đứng trước biểu mẫu trong thứ tự bàn phím, có tên truy cập và vòng focus", async ({ page }) => {
  await mockBackend(page, { googleEnabled: true });
  await page.goto("/login");
  await expect(page.getByRole("textbox", { name: /^Tài khoản/ })).toBeVisible();
  await googleButton(page).focus();
  expect(await googleButton(page).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: /^Tài khoản/ })).toBeFocused();
});

test("máy chủ chỉ nhận Google: không có biểu mẫu mật khẩu, chỉ còn nút Google", async ({ page }) => {
  const mock = await mockBackend(page, { googleEnabled: true, passwordSignIn: false });
  await page.goto("/login");
  await expect(page.getByText("Dùng tài khoản Google để vào Demo trực tiếp ở chế độ chỉ xem.")).toBeVisible();
  await expect(googleButton(page)).toBeEnabled();
  await expect(page.getByRole("textbox", { name: /^Tài khoản/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toHaveCount(0);
  await googleButton(page).click();
  await expect(page).toHaveURL(`${BACKEND}/api/app/v1/auth/google/start`);
  expect(mock.requests.filter((r) => r === "POST /api/app/v1/session")).toEqual([]);
});

test("máy chủ chỉ nhận Google nhưng chưa cấu hình Google: nói rõ là chưa đăng nhập được, không hiện biểu mẫu chết", async ({ page }) => {
  await mockBackend(page, { googleEnabled: false, passwordSignIn: false });
  await page.goto("/login");
  await expect(page.getByText("Máy chủ chưa bật phương thức đăng nhập nào")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Tài khoản/ })).toHaveCount(0);
});
