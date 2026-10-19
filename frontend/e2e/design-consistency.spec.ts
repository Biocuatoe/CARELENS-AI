import { expect, test, type Page } from "@playwright/test";
import { mockBackend, signInLiveDemo } from "./helpers";

/**
 * Landing, đăng nhập và bảng theo dõi phải dùng cùng một hệ thiết kế. Test đọc style đã tính của trình duyệt (không đọc mã nguồn)
 * và so với bảng màu landing (A19). Đây là kiểm tra tự động cho các token dùng chung; độ hài hòa thị giác vẫn cần xem ảnh chụp.
 */
const MIDNIGHT = "rgb(20, 35, 45)";
const IVORY = "rgb(242, 240, 233)";
const PAPER = "rgb(250, 251, 248)";
const INK = "rgb(38, 54, 62)";
const TEAL_DEEP = "rgb(36, 95, 90)";

const style = (page: Page, selector: string, prop: string) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test("landing, đăng nhập và bảng theo dõi dùng chung bảng màu, phông và hình khối nút", async ({ page }) => {
  await mockBackend(page);

  await page.goto("/");
  const landingHeaderBg = await style(page, "header", "background-color");
  const landingFont = await style(page, "h1, h2", "font-family");
  expect(landingHeaderBg).toBe(MIDNIGHT);

  await page.goto("/login");
  // Khu thương hiệu: nền gradient từ graphite về midnight, cùng tông với header landing.
  expect(await style(page, "aside", "background-image")).toContain(MIDNIGHT);
  expect(await style(page, "body", "background-color")).toBe(IVORY);
  expect(await style(page, "h1", "font-family")).toBe(landingFont);
  expect(await style(page, "section[aria-label='Đăng nhập']", "background-color")).toBe(PAPER);
  const loginButton = page.getByRole("button", { name: "Đăng nhập", exact: true });
  expect(await loginButton.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(TEAL_DEEP);
  expect(await loginButton.evaluate((el) => getComputedStyle(el).borderRadius)).toMatch(/^(9999|33554400)px$|^3.35544e\+07px$/);

  await signInLiveDemo(page);
  expect(await style(page, "header", "background-color")).toBe(landingHeaderBg);
  expect(await style(page, "aside", "background-color")).toBe(MIDNIGHT);
  expect(await style(page, "body", "background-color")).toBe(IVORY);
  expect(await style(page, "main", "color")).toBe(INK);
  expect(await style(page, "h1", "font-family")).toBe(landingFont);
  // Thẻ nội dung là paper có viền mảnh, như thẻ của landing và đăng nhập.
  expect(await style(page, "main section[aria-labelledby='open-alerts-title']", "background-color")).toBe(PAPER);
});

test("ứng dụng không còn dấu vết Neumorphism cũ: nền, chữ và nhấn đều từ bảng màu landing", async ({ page }) => {
  await mockBackend(page);
  await signInLiveDemo(page);
  const palette = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return ["--color-surface", "--color-fg", "--color-accent"].map((name) => root.getPropertyValue(name).trim());
  });
  expect(palette.join(" ")).not.toMatch(/#e0e5ec|#3d4852|#6c63ff/i);
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  expect(html).not.toContain("Day1Care");
});
