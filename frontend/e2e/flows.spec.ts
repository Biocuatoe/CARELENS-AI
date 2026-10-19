import { expect, test } from "@playwright/test";
import { LIVE_DEMO_HOME, liveState, mockBackend, navTo, signInLiveDemo, submitLogin } from "./helpers";

/**
 * Luồng của tài khoản Live Demo dùng chung. Backend được giả ở tầng mạng (e2e/helpers.ts): biểu mẫu đăng nhập, phiên trong bộ nhớ,
 * vé stream dùng một lần và đăng xuất chạy bằng mã thật của trình duyệt. Không có dữ liệu thật hay mật khẩu thật trong bộ test này.
 */

test("trang đăng nhập chỉ có một tài khoản: không chọn người dùng mô phỏng, không đăng ký", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Đăng nhập" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Đăng nhập bằng Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Vào bản demo/ })).toHaveCount(0);
  await expect(page.getByText(/người dùng mô phỏng|Chọn một/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /đăng ký|quên mật khẩu|tạo tài khoản/i })).toHaveCount(0);
  await expect(page.locator("form")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "CareLens AI, về trang chủ" })).toBeVisible();
});

test("đăng nhập sai báo lỗi chung, không lộ tài khoản và ở lại trang đăng nhập", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/login");
  await submitLogin(page, "sai-mat-khau");
  await expect(page.getByRole("alert")).toContainText("Tài khoản hoặc mật khẩu không đúng.");
  await expect(page).toHaveURL(/\/login$/);
});

test("máy chủ không khả dụng và bị giới hạn tần suất được báo rõ", async ({ page }) => {
  await mockBackend(page, { login: "unavailable" });
  await page.goto("/login");
  await submitLogin(page);
  await expect(page.getByRole("alert")).toContainText("Không kết nối được máy chủ CareLens");

  await page.unrouteAll();
  await mockBackend(page, { login: "throttled" });
  await submitLogin(page);
  await expect(page.getByRole("alert")).toContainText("quá nhiều lần đăng nhập");
});

test("máy chủ đang chạy nhưng từ chối địa chỉ trang (CORS) được báo khác với máy chủ tắt", async ({ page }) => {
  await mockBackend(page, { login: "origin_blocked" });
  await page.goto("/login");
  await submitLogin(page);
  await expect(page.getByRole("alert")).toContainText("Máy chủ đang chạy nhưng không chấp nhận địa chỉ trang này");
  await expect(page.getByRole("alert")).toContainText("ALLOWED_ORIGINS");
  await expect(page.getByRole("alert")).not.toContainText("Không kết nối được máy chủ");
});

test("đăng nhập đúng vào thẳng bảng theo dõi, token chỉ nằm trong bộ nhớ", async ({ page }) => {
  const mock = await mockBackend(page, { stream: liveState() });
  await signInLiveDemo(page);

  await expect(page.getByRole("heading", { level: 1, name: "Demo trực tiếp" })).toBeVisible();
  await expect(page.locator("aside").first().getByRole("link", { name: "Tổng quan", exact: true })).toHaveAttribute("aria-current", "page");
  // Một hồ sơ duy nhất: không có trang danh sách hồ sơ, bộ chọn hồ sơ hay lối vào quản trị.
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.locator("aside").first().getByRole("link", { name: /Hồ sơ chăm sóc|Vận hành/ })).toHaveCount(0);

  await expect.poll(() => mock.streamUrls.length).toBeGreaterThan(0);
  expect(mock.streamUrls[0]).toContain("ticket=cls_");
  expect(mock.streamUrls.join("\n")).not.toContain("clc_");
  expect(mock.authorization.every((value) => value === "Bearer clc_e2e_session_token")).toBe(true);
  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
  expect(stored).not.toContain("clc_");
  expect(stored).not.toContain("cls_");
});

test("chưa có sự kiện nào thì nói là chưa có, không tuyên bố an toàn", async ({ page }) => {
  await mockBackend(page); // luồng không mang dữ liệu
  await signInLiveDemo(page);
  await expect(page.getByText("Không có cảnh báo đang mở")).toBeVisible();
  await expect(page.getByText(/Người thân đang an toàn|Bình thường/)).toHaveCount(0);
});

test("cảnh báo từ máy chủ hiện ra, người chỉ xem không được xử lý", async ({ page }) => {
  await mockBackend(page, { role: "viewer", stream: liveState() });
  await signInLiveDemo(page);
  await expect(page.getByRole("heading", { name: "Cảnh báo cần xử lý" })).toBeVisible();
  await page.getByRole("link", { name: /Xem/ }).filter({ hasText: /cảnh báo|chi tiết|xử lý/i }).first().click();
  await expect(page.getByText("Bạn có quyền xem cảnh báo này nhưng không có quyền tiếp nhận hoặc xử lý.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tiếp nhận kiểm tra" })).toHaveCount(0);
});

test("vào thẳng trang được bảo vệ khi chưa đăng nhập thì chuyển về đăng nhập rồi quay lại đúng trang", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/people/r_liveshowcase/history");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fpeople%2Fr_liveshowcase%2Fhistory/);
  await submitLogin(page);
  await expect(page).toHaveURL(/\/people\/r_liveshowcase\/history$/);
  await expect(page.getByRole("heading", { level: 1, name: "Lịch sử" })).toBeVisible();
});

test("đăng xuất thu hồi phiên của chính mình và đóng lối vào các trang bảo vệ", async ({ page }) => {
  const mock = await mockBackend(page);
  await signInLiveDemo(page);
  await page.locator("aside").first().getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(mock.requests).toContain("DELETE /api/app/v1/session");

  // Điều hướng phía client tới trang bảo vệ: phiên đã mất nên bị đưa về đăng nhập.
  await page.evaluate(() => {
    window.history.pushState({}, "", "/people/r_liveshowcase/overview");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/login/);
});

test("phiên bị thu hồi khi mở stream thì báo hết hạn và quay lại đúng trang sau khi đăng nhập lại", async ({ page }) => {
  await mockBackend(page, { ticket: 401 });
  await page.goto("/login");
  await submitLogin(page); // the dashboard opens, the stream ticket is refused, and the session is dropped at once
  await expect(page).toHaveURL(/\/login\?.*reason=expired/);
  await expect(page.getByText("Phiên đăng nhập đã hết hạn")).toBeVisible();
  await page.unrouteAll();
  await mockBackend(page);
  await submitLogin(page);
  await expect(page).toHaveURL(LIVE_DEMO_HOME);
});

test("điều hướng của ứng dụng chỉ gồm các mục có thật và mở được", async ({ page }) => {
  await mockBackend(page);
  await signInLiveDemo(page);
  for (const label of ["CareLens", "EcoPatch", "Cảnh báo", "Thiết bị & hướng dẫn", "Lịch sử", "Báo cáo", "Gia đình & quyền truy cập", "Tổng quan"]) {
    await navTo(page, label);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Không tìm thấy trang")).toHaveCount(0);
  }
  await page.locator("aside").first().getByRole("link", { name: "Thông báo & tài khoản" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thông báo & tài khoản" })).toBeVisible();
  await expect(page.getByText("Tài khoản Demo trực tiếp dùng chung")).toBeVisible();
});
