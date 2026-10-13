import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

const SHOT_DIR = "test-results/screens";
const PART_IDS = [
  "enclosure-body",
  "enclosure-cap",
  "esp32-cam",
  "lipo-cell",
  "tp4056",
  "boost-converter",
  "gy521",
  "max98357a",
  "speaker",
  "slide-switch",
];

async function openInspector(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.goto("/hardware-inspector?debug=1");
  await expect(page.getByRole("heading", { level: 1, name: /Kiểm tra mô hình 3D/ })).toBeVisible();
  for (const id of PART_IDS) await expect(page.locator(`li[data-part-id="${id}"]`)).toHaveAttribute("data-status", "loaded", { timeout: 30_000 });
  await expect(page.getByTestId("viewer-stage").locator("[data-state]")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("shell-issues")).toBeVisible({ timeout: 30_000 });
  return errors;
}

type Sample = { width: number; height: number; coverage: number; distinctColors: number };
const sample = (page: Page) =>
  page.evaluate(() => (window as unknown as { __hardwareInspector: { sample: () => Sample } }).__hardwareInspector.sample());

async function shot(page: Page, view: string, file: string) {
  await page.getByRole("radiogroup", { name: "Hướng nhìn" }).getByRole("radio", { name: view, exact: true }).click();
  await page.waitForTimeout(120);
  await page.getByTestId("viewer-stage").screenshot({ path: `${SHOT_DIR}/${file}.png` });
}

test("hardware: 10 vật thể tải được, kiểm tra hình học báo 0 xuyên vỏ và 0 va chạm, camera nhìn qua cửa sổ", async ({ page }) => {
  const errors = await openInspector(page);
  await expect(page.getByTestId("shell-issues")).toContainText("0 điểm");
  await expect(page.getByTestId("collisions")).toContainText("0 cặp");
  await expect(page.getByTestId("camera-check")).toContainText("Lệch tâm cửa sổ 0,0 mm, lệch trục 0,0°, nhìn ra ngoài qua cửa sổ");
  await expect(page.getByTestId("usb-check")).toContainText("Vỏ chưa có lỗ");
  await expect(page.getByTestId("switch-check")).toContainText("Vỏ chưa có lỗ");
  const s = await sample(page);
  expect(s.coverage).toBeGreaterThan(0.04);
  expect(s.distinctColors).toBeGreaterThan(10); // không phải khung trống hay một màu phẳng
  for (const id of PART_IDS) {
    await page.locator(`li[data-part-id="${id}"] button`).click();
    await expect(page.getByTestId("part-detail")).toContainText(id);
    await expect(page.getByTestId("part-detail")).toContainText("Sai lệch cấu hình so với hình học");
  }
  expect(errors).toEqual([]);
});

test("hardware: ảnh kiểm tra trạng thái đóng, sáu hướng, mặt cắt bên trong và tách rời", async ({ page }) => {
  const errors = await openInspector(page);
  await page.locator('li[data-part-id="enclosure-body"] button').click(); // khung chọn quanh thân, không che linh kiện

  // Trạng thái đóng (vỏ đục) từ mọi hướng.
  for (const [view, file] of [
    ["Chéo trước", "closed-iso"],
    ["Trước", "closed-front"],
    ["Sau", "closed-back"],
    ["Trái", "closed-left"],
    ["Phải", "closed-right"],
    ["Trên", "closed-top"],
    ["Dưới", "closed-bottom"],
  ] as const) {
    await shot(page, view, file);
  }

  // Nhìn vào bên trong: cắt nửa trước rồi nhìn từ trước; cắt nửa phải rồi nhìn từ phải.
  const sections = page.getByRole("radiogroup", { name: "Mặt cắt vỏ" });
  await sections.getByRole("radio", { name: "Cắt nửa trước" }).click();
  await shot(page, "Trước", "section-front");
  await shot(page, "Chéo trước", "section-front-iso");
  await sections.getByRole("radio", { name: "Cắt nửa phải" }).click();
  await shot(page, "Phải", "section-right");
  await shot(page, "Chéo sau", "section-right-iso-back");
  await sections.getByRole("radio", { name: "Không cắt" }).click();

  // Nhìn xuyên vỏ từ trên và dưới.
  await page.getByLabel("Vỏ trong suốt").check({ force: true });
  await shot(page, "Trên", "ghost-top");
  await shot(page, "Dưới", "ghost-bottom");
  await shot(page, "Chéo trước", "ghost-iso");
  await page.getByLabel("Vỏ trong suốt").uncheck({ force: true });

  await page.getByLabel(/Tách rời/).fill("1");
  await expect(page.getByText("Tách rời: 100%")).toBeVisible();
  await shot(page, "Chéo trước", "exploded-iso");
  await shot(page, "Trước", "exploded-front");
  expect((await sample(page)).coverage).toBeGreaterThan(0.02);

  await page.getByRole("radio", { name: "BẬT" }).check({ force: true });
  expect(errors).toEqual([]);
});

test("hardware: không tràn ngang ở 360–1440px", async ({ page }) => {
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/hardware-inspector?debug=1");
    await expect(page.getByRole("heading", { level: 1, name: /Kiểm tra mô hình 3D/ })).toBeVisible();
    const offenders = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`),
    );
    expect(offenders, `phần tử tràn ngang ở ${width}px`).toEqual([]);
    await expectNoHorizontalOverflow(page);
  }
});
