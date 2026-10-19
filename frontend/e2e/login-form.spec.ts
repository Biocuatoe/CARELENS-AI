import { expect, test } from "@playwright/test";
import { LIVE_DEMO_HOME, mockBackend, submitLogin } from "./helpers";

const SHOT_DIR = "test-results/screens";

test("biểu mẫu trống không báo lỗi khi vừa hiện hay khi rời ô trống; chỉ báo sau khi bấm Đăng nhập", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/login");
  await expect(page.getByText(/Nhập tài khoản|Nhập mật khẩu/)).toHaveCount(0);

  const account = page.getByRole("textbox", { name: /^Tài khoản/ });
  await account.focus();
  await page.getByLabel(/^Mật khẩu/).focus();
  await page.getByRole("button", { name: "Hiện mật khẩu" }).focus();
  await expect(page.getByText(/Nhập tài khoản|Nhập mật khẩu/)).toHaveCount(0);

  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByText("Nhập tài khoản.")).toBeVisible();
  await expect(page.getByText("Nhập mật khẩu.")).toBeVisible();
  await expect(account).toHaveAttribute("aria-invalid", "true");
  await expect(account).toBeFocused();
});

test("tài khoản là tên đăng nhập thuần: DAYONE được nhận, không có kiểm tra định dạng email", async ({ page }) => {
  const mock = await mockBackend(page);
  await page.goto("/login");
  const account = page.getByRole("textbox", { name: /^Tài khoản/ });
  await expect(account).toHaveAttribute("type", "text");
  await expect(page.getByLabel("Email")).toHaveCount(0);
  // Không điền sẵn và không tự đăng nhập.
  await expect(account).toHaveValue("");
  await expect(page.getByLabel(/^Mật khẩu/)).toHaveValue("");

  await account.fill("DAYONE");
  await page.getByLabel(/^Mật khẩu/).fill("sai-mat-khau");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Tài khoản hoặc mật khẩu không đúng.");
  await expect(page.getByText(/địa chỉ email/i)).toHaveCount(0);

  await submitLogin(page);
  await expect(page).toHaveURL(LIVE_DEMO_HOME);
  // Tên đăng nhập đi tới máy chủ đúng như người dùng gõ (máy chủ không phân biệt hoa thường), không có lối tắt phía trình duyệt.
  expect(mock.loginBodies.at(-1)).toMatchObject({ username: "DAYONE" });
  expect(mock.loginBodies.every((body) => !("email" in body))).toBe(true);
});

test("mật khẩu không nằm trong gói frontend production", async ({ request }) => {
  const html = await (await request.get("/login")).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!);
  expect(assets.length).toBeGreaterThan(0);
  for (const path of assets) {
    const body = await (await request.get(path)).text();
    // Cả bản ghi nguyên văn lẫn dạng "DAYONE"/"DAYONE" đều không được xuất hiện trong mã nguồn đã build.
    expect(body, path).not.toMatch(/DAYONE/i);
    // Google sign-in runs on the server: no client secret, authorization code handling or token endpoint in the bundle.
    expect(body, path).not.toMatch(/client_secret|GOOGLE_CLIENT_SECRET|oauth2\.googleapis\.com|GOCSPX/);
  }
});

type Box = { x: number; y: number; width: number; height: number };

const VIEWPORTS = [
  { width: 1800, height: 768 },
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  test(`bố cục đăng nhập ${viewport.width}×${viewport.height}: nhóm nội dung cân giữa, không tràn, không bị cắt`, async ({ page }) => {
    await mockBackend(page);
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const doc = await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight }));
    expect(doc.overflowX, "không tràn ngang").toBeLessThanOrEqual(0);

    const box = async (selector: string): Promise<Box> => {
      const b = await page.locator(selector).first().boundingBox();
      expect(b, selector).not.toBeNull();
      return b!;
    };
    const main = await box("main");
    const group = await box("main > div");
    const card = await box("section[aria-label='Đăng nhập']");
    const h1 = await box("main h1");

    // Nhóm (tiêu đề + thẻ) và thẻ cùng nằm trọn trong khu bên phải, không bị cắt ở mép.
    for (const b of [group, card, h1]) {
      expect(b.x).toBeGreaterThanOrEqual(main.x);
      expect(b.x + b.width).toBeLessThanOrEqual(main.x + main.width + 0.5);
    }
    // Căn giữa theo chiều ngang trong khu bên phải (sai số 1px), không lệch về phía đường chia.
    expect(Math.abs(group.x + group.width / 2 - (main.x + main.width / 2))).toBeLessThanOrEqual(1);
    // Tiêu đề và thẻ cùng một cột: cùng mép trái.
    expect(Math.abs(h1.x - card.x)).toBeLessThanOrEqual(1);
    // Bề rộng khối giới hạn ở khoảng 540–580px khi khu bên phải đủ rộng.
    if (main.width > 700) {
      expect(group.width).toBeGreaterThanOrEqual(540);
      expect(group.width).toBeLessThanOrEqual(580);
    }

    if (viewport.width >= 1024) {
      // Cân giữa theo chiều dọc: khoảng trên và dưới của cả nhóm xấp xỉ bằng nhau và nhóm nằm gọn trong khung nhìn.
      const top = group.y;
      const bottom = viewport.height - (group.y + group.height);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeGreaterThanOrEqual(0);
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(2);
      expect(doc.scrollHeight).toBeLessThanOrEqual(viewport.height);
    } else {
      // Điện thoại và máy tính bảng dọc: biểu mẫu hiện ngay trong khung nhìn đầu tiên.
      expect(card.y + card.height).toBeLessThanOrEqual(viewport.height);
    }
    await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `${SHOT_DIR}/login-form-${viewport.width}x${viewport.height}.png` });
  });
}
