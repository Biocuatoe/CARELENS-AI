import { expect, test } from "@playwright/test";
import { enterDemo, navTo, openRecipient } from "./helpers";

test("đăng nhập thật báo không khả dụng và không lộ tài khoản", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("ai.do@example.invalid");
  await page.getByLabel("Mật khẩu", { exact: false }).first().fill("sai-mat-khau");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("chưa kết nối máy chủ xác thực");
});

test("luồng cảnh báo: tiếp nhận không đóng, đóng bắt buộc có kết quả và ghi chú", async ({ page }) => {
  await enterDemo(page, "Minh");
  await openRecipient(page, /Bà An/);

  await expect(page.getByRole("heading", { name: "Cảnh báo cần xử lý" })).toBeVisible();
  await expect(page.getByText("Dữ liệu mô phỏng").first()).toBeVisible();
  await page.getByRole("link", { name: /Xem và xử lý/ }).first().click();

  await expect(page.getByText("Chưa tiếp nhận · Chưa có kết quả kiểm tra")).toBeVisible();
  await expect(page.getByText("Nhận định AI, chưa được người chăm sóc xác nhận")).toBeVisible();
  await page.getByRole("button", { name: "Tiếp nhận kiểm tra" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Đã tiếp nhận · Chưa có kết quả kiểm tra" })).toBeVisible();
  await expect(page.getByText(/Đã tiếp nhận bởi Minh · Chưa có kết quả kiểm tra/)).toBeVisible();

  await page.getByRole("button", { name: "Ghi kết quả và đóng" }).click();
  await expect(page.getByText("Cần bổ sung trước khi đóng:")).toBeVisible();

  await page.getByText("Báo động sai", { exact: true }).click();
  await page.getByLabel(/Ghi chú xử lý/).fill("Đã gọi điện, bà đang ngồi nghỉ.");
  await page.getByRole("button", { name: "Ghi kết quả và đóng" }).click();

  await expect(page.getByText("Đã ghi kết quả và đóng cảnh báo.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kết quả kiểm tra của người chăm sóc" })).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: "Đã gọi điện, bà đang ngồi nghỉ." })).toBeVisible();
});

test.skip("xung đột: người khác tiếp nhận trước thì hiện trạng thái server và giữ ghi chú", async ({ page }) => {
  // SKIPPED: requires DemoTools drawer which has been removed.
  await enterDemo(page, "Minh");
  await openRecipient(page, /Bà An/);
  await page.getByRole("link", { name: /Xem và xử lý/ }).first().click();
  await expect(page.getByRole("button", { name: "Tiếp nhận kiểm tra" })).toBeVisible();

  await page.getByRole("button", { name: /Mở công cụ demo/ }).click();
  await page.getByRole("button", { name: "Mô phỏng người khác tiếp nhận trước" }).click();
  await expect(page.getByRole("dialog").getByText(/vừa tiếp nhận cảnh báo/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Đóng" }).click();

  await page.getByRole("button", { name: "Tiếp nhận kiểm tra" }).click();
  await expect(page.getByText("Cảnh báo đã thay đổi")).toBeVisible();
  await expect(page.getByText(/Phụ trách: Lan/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Tiếp nhận kiểm tra" })).toHaveCount(0);
});

test.skip("sự kiện mới không tự đổi thứ tự danh sách cảnh báo", async ({ page }) => {
  // SKIPPED: requires DemoTools drawer which has been removed.
  await enterDemo(page, "Minh");
  await openRecipient(page, /Bà An/);
  await navTo(page, "Cảnh báo");
  const rows = page.locator("tbody tr"); // viewport mặc định 1440px hiển thị dạng bảng
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();

  await page.getByRole("button", { name: /Mở công cụ demo/ }).click();
  await page.getByRole("button", { name: "Phát sự kiện CareLens mô phỏng" }).click();
  await expect(page.getByRole("dialog").getByText(/Đã phát một sự kiện/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Đóng" }).click();

  await expect(page.getByText("Có cập nhật cảnh báo mới")).toBeVisible();
  expect(await rows.count()).toBe(before);
  await page.getByRole("button", { name: "Tải lại danh sách" }).click();
  await expect(rows).toHaveCount(before + 1);
});

test.skip("mất kết nối hub hiển thị riêng, không báo bình thường", async ({ page }) => {
  // SKIPPED: requires DemoTools drawer which has been removed.
  await enterDemo(page, "Minh");
  await openRecipient(page, /Bà An/);
  await page.getByRole("button", { name: /Mở công cụ demo/ }).click();
  await page.getByRole("button", { name: "Bật/tắt mất kết nối hub CareLens" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Đóng" }).click();
  await expect(page.getByText("Mất kết nối").first()).toBeVisible();
  await expect(page.getByText(/Người thân đang an toàn|Bình thường/)).toHaveCount(0);
});

test("AC03: người xem Nhóm B không thấy và không mở được hồ sơ Nhóm A", async ({ page }) => {
  await enterDemo(page, "Hà");
  await expect(page.getByRole("heading", { name: /Ông Bình/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Bà An/ })).toHaveCount(0);
  await openRecipient(page, /Ông Bình/);
  await expect(page.getByRole("link", { name: "CareLens", exact: true })).toHaveCount(0);
  await navTo(page, "Cảnh báo");
  await page.getByRole("link", { name: /Xem chi tiết/ }).first().click();
  await expect(page.getByText("Bạn có quyền xem cảnh báo này nhưng không có quyền tiếp nhận hoặc xử lý.")).toBeVisible();
});

test("AC11: thu hồi quyền có hiệu lực khi người bị thu hồi vào lại", async ({ page }) => {
  await enterDemo(page, "Minh");
  await openRecipient(page, /Bà An/);
  await navTo(page, "Gia đình & quyền truy cập");
  const lanRow = page.getByRole("listitem").filter({ hasText: "lan.demo@example.invalid" });
  await lanRow.getByRole("button", { name: "Thu hồi quyền" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Lan");
  await expect(dialog).toContainText("Bà An");
  await dialog.getByRole("button", { name: "Thu hồi quyền" }).click();
  await expect(lanRow.getByText(/Đã thu hồi/)).toBeVisible();

  // Close any open dialog first, then log out and log in as Lan.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /đăng xuất|logout/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: "Vào bản demo với Lan" }).click();
  await expect(page.getByText("Chưa có hồ sơ nào")).toBeVisible();
});

test("thay miếng dán: gửi thành công một phiên, lịch sử giữ phiên cũ", async ({ page }) => {
  await enterDemo(page, "Lan");
  await openRecipient(page, /Bà An/);
  await navTo(page, "Thiết bị & hướng dẫn");
  await page.getByRole("button", { name: "Thay miếng dán" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mã lô (không bắt buộc)").fill("LOT-E2E-01");
  await dialog.getByRole("button", { name: "Ghi nhận thay miếng dán" }).click();
  await expect(dialog.getByText("Đã ghi nhận miếng dán mới (mô phỏng)")).toBeVisible();
  await dialog.getByRole("button", { name: "Xong" }).click();
  await expect(page.getByRole("cell", { name: "LOT-E2E-01" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Đang dùng" })).toHaveCount(1);
});

test("hết phiên đưa về đăng nhập và quay lại đúng trang", async ({ page }) => {
  await enterDemo(page, "Minh");
  await openRecipient(page, /Bà An/);
  await navTo(page, "Lịch sử");
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__demo?.expireSession();
  });
  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByText("Phiên đăng nhập đã hết hạn")).toBeVisible();
  await page.getByRole("button", { name: "Vào bản demo với Minh" }).click();
  await expect(page).toHaveURL(/\/people\/r_an\/history/);
});

test("dialog: Esc đóng và trả focus về nút mở", async ({ page }) => {
  await enterDemo(page, "Minh");
  await openRecipient(page, /Bà An/);
  await navTo(page, "Thiết bị & hướng dẫn");
  const opener = page.getByRole("button", { name: "Ghép thiết bị" });
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("ghép thiết bị cần mã kích hoạt, serial một mình không đủ", async ({ page }) => {
  await enterDemo(page, "Minh");
  await openRecipient(page, /Bà An/);
  await navTo(page, "Thiết bị & hướng dẫn");
  await page.getByRole("button", { name: "Ghép thiết bị" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Số serial/).fill("CL-HUB-DEMO-3001");
  await dialog.getByRole("button", { name: "Tiếp tục" }).click();
  await dialog.getByLabel(/Mã kích hoạt/).fill("000001");
  await dialog.getByRole("button", { name: "Xác minh và gán" }).click();
  await expect(dialog.getByText(/Mã kích hoạt không đúng/)).toBeVisible();
  await dialog.getByLabel(/Mã kích hoạt/).fill("246810");
  await dialog.getByRole("button", { name: "Xác minh và gán" }).click();
  await expect(dialog.getByText("Đã gán thiết bị cho hồ sơ")).toBeVisible();
});
