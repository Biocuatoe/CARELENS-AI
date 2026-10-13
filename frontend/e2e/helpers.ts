import { expect, type Page } from "@playwright/test";

/** Phiên demo chỉ nằm trong bộ nhớ, nên mọi điều hướng sau khi vào demo phải đi qua link trong app. */
export async function enterDemo(page: Page, name: "Minh" | "Lan" | "Hà" | "Khoa") {
  await page.goto("/login");
  await page.getByRole("button", { name: `Vào bản demo với ${name}` }).click();
}

export async function openRecipient(page: Page, name: RegExp) {
  await expect(page.getByRole("heading", { name: "Hồ sơ chăm sóc" })).toBeVisible();
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name }) });
  await card.getByRole("link", { name: "Mở hồ sơ" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
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
