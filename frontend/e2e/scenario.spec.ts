import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

/** Tình huống 01 (ngã): cảnh 3D chạy theo cuộn trên landing. */

const SHOT_DIR = "test-results/screens";

interface FallDebug {
  state(): { progress: number; target: number; ready: boolean; frames: number; step: number };
  sample(): { coverage: number; distinctColors: number; bbox: { left: number; right: number; top: number; bottom: number } | null };
  figure(): number[];
}
const fall = {
  state: (page: Page) => page.evaluate(() => (window as unknown as { __fallScene: FallDebug }).__fallScene.state()),
  sample: (page: Page) => page.evaluate(() => (window as unknown as { __fallScene: FallDebug }).__fallScene.sample()),
  figure: (page: Page) => page.evaluate(() => (window as unknown as { __fallScene: FallDebug }).__fallScene.figure()),
};

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("Too many active WebGL contexts")) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function openScenario(page: Page) {
  await page.goto("/?debug=1");
  await page.evaluate(() => document.getElementById("tinh-huong")!.scrollIntoView({ behavior: "instant" }));
  await expect(page.getByTestId("fall-stage")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await expect.poll(async () => (await fall.state(page)).ready).toBe(true);
}

/** Cuộn tới tiến trình p của vùng dính (cùng công thức với giao diện). */
const scrollToFall = (page: Page, p: number) =>
  page.evaluate((p) => {
    const track = document.querySelector<HTMLElement>('[data-testid="fall-track"]')!;
    const stage = document.querySelector<HTMLElement>('[data-testid="fall-stage"]')!;
    const total = track.offsetHeight - stage.clientHeight;
    const top = parseFloat(getComputedStyle(stage).top) || 0;
    window.scrollTo({ top: window.scrollY + track.getBoundingClientRect().top + p * total - top, behavior: "instant" });
  }, p);

/** Chờ trình duyệt xử lý cuộn (đích của cảnh khớp p), cảnh hội tụ về đích và vòng vẽ dừng. */
async function settle(page: Page, p: number) {
  await expect.poll(async () => Math.abs((await fall.state(page)).target - p), { timeout: 15_000 }).toBeLessThan(0.002);
  await expect.poll(async () => {
    const s = await fall.state(page);
    return Math.abs(s.progress - s.target);
  }, { timeout: 30_000 }).toBeLessThan(1e-6);
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 60 && stable < 3; i++) {
    const { frames } = await fall.state(page);
    stable = frames === last ? stable + 1 : 0;
    last = frames;
    await page.waitForTimeout(80);
  }
  expect(stable, "vòng vẽ phải dừng khi trang đứng yên").toBeGreaterThanOrEqual(3);
}

const STEP_LABELS = [/Bình thường/, /Thay đổi đột ngột/, /Gửi mô tả/] as const;

test.describe("tình huống 01: máy tính", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("cuộn tới rồi cuộn ngược: cùng vị trí cuộn cho đúng cùng khung hình, bước và thông báo đồng bộ", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await openScenario(page);
    const group = page.getByRole("group", { name: /Ví dụ tình huống/ });
    const card = page.getByTestId("fall-notification");
    const checkpoints: Array<[number, 0 | 1 | 2]> = [
      [0.1, 0],
      [0.4, 1],
      [0.6, 1],
      [0.94, 2],
    ];
    const recorded: number[][] = [];
    for (const [p, step] of checkpoints) {
      await scrollToFall(page, p);
      await settle(page, p);
      recorded.push(await fall.figure(page));
      await expect(group.getByRole("button", { name: STEP_LABELS[step] })).toHaveAttribute("aria-pressed", "true");
      if (step === 2) await expect(card).not.toHaveAttribute("inert");
      else await expect(card).toHaveAttribute("inert", "");
      await page.getByTestId("fall-stage").screenshot({ path: `${SHOT_DIR}/fall-1440-${String(p).replace(".", "_")}.png` });
    }

    // Cuộn thật bằng bánh xe qua lại nhiều lần, rồi quay về từng mốc theo thứ tự ngược.
    await page.mouse.move(700, 450);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -260);
    for (let i = 0; i < 7; i++) await page.mouse.wheel(0, 300);
    // Chờ hoạt ảnh cuộn mượt của bánh xe dừng hẳn, để lần cuộn tới mốc sau không bị nó ghi đè.
    let lastY = -1;
    await expect
      .poll(async () => {
        const y = await page.evaluate(() => window.scrollY);
        const still = y === lastY;
        lastY = y;
        return still;
      }, { intervals: [250] })
      .toBe(true);
    for (let k = checkpoints.length - 1; k >= 0; k--) {
      const [p, step] = checkpoints[k]!;
      await scrollToFall(page, p);
      await settle(page, p);
      const again = await fall.figure(page);
      expect(again.length).toBe(recorded[k]!.length);
      again.forEach((v, i) => expect(v, `p = ${p}, giá trị ${i}`).toBeCloseTo(recorded[k]![i]!, 6));
      await expect(group.getByRole("button", { name: STEP_LABELS[step] })).toHaveAttribute("aria-pressed", "true");
    }
    expect(errors).toEqual([]);
  });

  test("bố cục: người là tiêu điểm, nằm trọn trong khung và không bị thẻ thông báo che", async ({ page }) => {
    test.setTimeout(150_000);
    await openScenario(page);
    for (const p of [0.1, 0.4, 0.94]) {
      await scrollToFall(page, p);
      await settle(page, p);
      const stage = (await page.getByTestId("fall-stage").boundingBox())!;
      const s = await fall.sample(page);
      expect(s.coverage, `p = ${p}`).toBeGreaterThan(0.03);
      expect(s.distinctColors, `p = ${p}`).toBeGreaterThan(20);
      expect(s.bbox, `p = ${p}`).not.toBeNull();
      expect(s.bbox!.left).toBeGreaterThan(0);
      expect(s.bbox!.right).toBeLessThan(1);
      expect(s.bbox!.top).toBeGreaterThan(0);
      expect(s.bbox!.bottom).toBeLessThan(1);
      if (p === 0.94) {
        const cardBox = (await page.getByTestId("fall-notification").boundingBox())!;
        expect(stage.x + s.bbox!.right * stage.width, "người nằm bên trái thẻ thông báo").toBeLessThan(cardBox.x);
      }
    }
  });
});

test.describe("tình huống 01: điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("người nằm giữa bảng bước và thẻ thông báo, không tràn ngang", async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await openScenario(page);
    for (const p of [0.1, 0.94]) {
      await scrollToFall(page, p);
      await settle(page, p);
      // Đo sau khi cuộn: khung đã dính dưới header.
      const stage = (await page.getByTestId("fall-stage").boundingBox())!;
      const panel = (await page.getByRole("group", { name: /Ví dụ tình huống/ }).boundingBox())!;
      await expectNoHorizontalOverflow(page);
      const s = await fall.sample(page);
      expect(s.bbox, `p = ${p}`).not.toBeNull();
      expect(s.bbox!.left).toBeGreaterThanOrEqual(0);
      expect(s.bbox!.right).toBeLessThanOrEqual(1);
      expect(stage.y + s.bbox!.top * stage.height, "đầu người không nằm dưới bảng bước").toBeGreaterThan(panel.y + panel.height - 4);
      if (p === 0.94) {
        const cardBox = (await page.getByTestId("fall-notification").boundingBox())!;
        expect(stage.y + s.bbox!.bottom * stage.height, "người nằm trên thẻ thông báo").toBeLessThan(cardBox.y);
      }
      await page.getByTestId("fall-stage").screenshot({ path: `${SHOT_DIR}/fall-390-${String(p).replace(".", "_")}.png` });
    }
    expect(errors).toEqual([]);
  });
});

test.describe("tình huống 01: giảm chuyển động", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

  test("không cuộn dính, không tự phát: ba ảnh tĩnh đổi bằng nút", async ({ page }) => {
    await openScenario(page);
    await expect(page.getByTestId("fall-track")).toHaveAttribute("data-mode", "reduced");
    const stage = (await page.getByTestId("fall-stage").boundingBox())!;
    expect(stage.height).toBeLessThan(800);
    const group = page.getByRole("group", { name: /Ví dụ tình huống/ });
    await page.waitForTimeout(2000);
    await expect(group.getByRole("button", { name: /Bình thường/ })).toHaveAttribute("aria-pressed", "true");
    const before = await fall.figure(page);
    await group.getByRole("button", { name: /Thay đổi đột ngột/ }).click();
    await expect.poll(async () => (await fall.figure(page))[1]).not.toBe(before[1]);
    await group.getByRole("button", { name: /Gửi mô tả/ }).click();
    await expect(page.getByTestId("fall-notification")).not.toHaveAttribute("inert");
    await page.getByRole("button", { name: "Tiếp nhận kiểm tra" }).click();
    await expect(page.getByText("Đã tiếp nhận · Chưa có kết quả kiểm tra")).toBeVisible();
    await page.getByTestId("fall-stage").screenshot({ path: `${SHOT_DIR}/fall-reduced.png` });
  });
});
