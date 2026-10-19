import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, liveState, mockBackend, navTo, signInLiveDemo } from "./helpers";

const WIDTHS = [360, 390, 768, 1024, 1440];
const PAGES = [
  "Tổng quan",
  "CareLens",
  "EcoPatch",
  "Cảnh báo",
  "Thiết bị & hướng dẫn",
  "Lịch sử",
  "Báo cáo",
  "Gia đình & quyền truy cập",
];
const SHOT_DIR = "test-results/screens";

test("các màn hình không tràn ngang ở 360–1440px", async ({ page }) => {
  test.setTimeout(240_000);
  await mockBackend(page, { stream: liveState() });
  await page.goto("/login");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
    if (width === 390 || width === 1440) await page.screenshot({ path: `${SHOT_DIR}/login-${width}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await signInLiveDemo(page);

  for (const label of PAGES) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navTo(page, label);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      await expectNoHorizontalOverflow(page);
      const slug = label.replace(/[^a-zA-Z]+/g, "-").toLowerCase() || "page";
      if (width === 390 || width === 1440 || width === 768) {
        await page.screenshot({ path: `${SHOT_DIR}/${slug}-${width}.png`, fullPage: true });
      }
    }
  }

  // Chi tiết cảnh báo (cảnh báo do luồng giả của máy chủ mang tới)
  await page.setViewportSize({ width: 1440, height: 900 });
  await navTo(page, "Cảnh báo");
  await page.getByRole("link", { name: /Xem chi tiết|Xem và xử lý/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Chỉ xem")).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    await expectNoHorizontalOverflow(page);
    if (width === 390 || width === 1440) await page.screenshot({ path: `${SHOT_DIR}/alert-detail-${width}.png`, fullPage: true });
  }
});

test("menu mobile: nút Menu/X có trạng thái rõ, đóng khi chuyển trang", async ({ page }) => {
  await mockBackend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signInLiveDemo(page);
  // The recipient context loads after the redirect; the menu lists the profile's pages only once it has.
  await expect(page.getByRole("heading", { level: 1, name: "Demo trực tiếp" })).toBeVisible();
  const toggle = page.getByRole("button", { name: "Mở menu" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByRole("button", { name: "Đóng menu" })).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({ path: `${SHOT_DIR}/mobile-menu-390.png` });
  await page.locator("header").getByRole("link", { name: "EcoPatch", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "EcoPatch" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mở menu" })).toHaveAttribute("aria-expanded", "false");
});

test("touch target tối thiểu 44px cho nút và link điều hướng trên mobile", async ({ page }) => {
  await mockBackend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signInLiveDemo(page);
  const small = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("main button, header button, header a, main a[class*='rounded-full']"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 44) bad.push(`${el.textContent?.trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad;
  });
  expect(small).toEqual([]);
});

test("reduced motion tắt animation float", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1024, height: 800 } });
  const page = await context.newPage();
  await page.goto("http://localhost:4173/not-found-route");
  const duration = await page.locator(".animate-float").first().evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.1);
  await context.close();
});

test("bàn phím: link bỏ qua điều hướng và focus ring hiển thị", async ({ page }) => {
  await mockBackend(page);
  await signInLiveDemo(page);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Bỏ qua điều hướng" });
  await expect(skip).toBeFocused();
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
});

test("bàn phím: biểu mẫu đăng nhập đi được hết bằng Tab và nút hiện mật khẩu có tên", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/login");
  await page.getByRole("textbox", { name: /^Tài khoản/ }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel(/^Mật khẩu/)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Hiện mật khẩu" })).toBeFocused();
  await page.keyboard.press("Tab");
  const submit = page.getByRole("button", { name: "Đăng nhập", exact: true });
  await expect(submit).toBeFocused();
  expect(await submit.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
});
