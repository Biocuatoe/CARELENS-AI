import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

const SHOT_DIR = "test-results/story-review";
const STORY = '[data-testid="hardware-story"]';
const STAGE_ORDER = ["assembled", "open", "explode", "explore", "overview"];
const BEAT_IDS = ["camera", "battery", "charger", "boost", "motion", "amp", "speaker", "switch"];
/** Trùng animationConfig: nhịp đầu ở 0,615, cách nhau 0,048. */
const beatCenter = (i: number) => 0.615 + i * 0.048;

type Vec = [number, number, number];
interface StoryDebug {
  state(): { progress: number; target: number; mode: string; ready: boolean; frames: number };
  positions(): Record<string, Vec>;
  expected(p: number): Record<string, Vec>;
  homes(): Record<string, Vec>;
  sample(): { coverage: number; distinctColors: number };
}

const api = {
  state: (page: Page) => page.evaluate(() => (window as unknown as { __hardwareStory: StoryDebug }).__hardwareStory.state()),
  positions: (page: Page) => page.evaluate(() => (window as unknown as { __hardwareStory: StoryDebug }).__hardwareStory.positions()),
  expected: (page: Page, p: number) => page.evaluate((v) => (window as unknown as { __hardwareStory: StoryDebug }).__hardwareStory.expected(v), p),
  homes: (page: Page) => page.evaluate(() => (window as unknown as { __hardwareStory: StoryDebug }).__hardwareStory.homes()),
  sample: (page: Page) => page.evaluate(() => (window as unknown as { __hardwareStory: StoryDebug }).__hardwareStory.sample()),
};

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function openStory(page: Page) {
  await page.goto("/hardware-story?debug=1");
  await expect(page.locator(`${STORY} [data-state]`)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect.poll(async () => (await api.state(page)).ready).toBe(true);
}

/** Vị trí cuộn của vùng cố định: `top` là toạ độ trang của đầu vùng, `total` là quãng cuộn được. */
const layout = (page: Page) =>
  page.evaluate((sel) => {
    const sec = document.querySelector(sel) as HTMLElement;
    const stage = sec.firstElementChild as HTMLElement;
    return { top: sec.getBoundingClientRect().top + window.scrollY, total: sec.offsetHeight - stage.clientHeight, viewport: window.innerHeight };
  }, STORY);

/** Tiến trình cuộn thật đang thấy trên trang (cùng công thức của giao diện). */
const pageProgress = (page: Page) =>
  page.evaluate((sel) => {
    const sec = document.querySelector(sel) as HTMLElement;
    const stage = sec.firstElementChild as HTMLElement;
    const total = sec.offsetHeight - stage.clientHeight;
    return total > 0 ? Math.min(1, Math.max(0, -sec.getBoundingClientRect().top / total)) : 0;
  }, STORY);

async function scrollToProgress(page: Page, p: number) {
  const { top, total } = await layout(page);
  await page.evaluate((y) => window.scrollTo(0, y), top + p * total);
}

/** Chờ tới khi không còn khung hình nào được vẽ (hoạt ảnh đã hội tụ và vòng lặp đã dừng). */
async function settle(page: Page) {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 80 && stable < 3; i++) {
    const { frames } = await api.state(page);
    stable = frames === last ? stable + 1 : 0;
    last = frames;
    await page.waitForTimeout(70);
  }
  expect(stable, "vòng lặp vẽ phải dừng khi trang đứng yên").toBeGreaterThanOrEqual(3);
}

const near = (a: Vec, b: Vec, tol = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol;

async function expectPositions(page: Page, expected: Record<string, Vec>, tol = 1e-6) {
  const actual = await api.positions(page);
  for (const [id, pos] of Object.entries(expected)) expect(near(actual[id]!, pos, tol), `${id}: ${actual[id]} ≠ ${pos}`).toBe(true);
}

test.describe("cảnh cuộn: máy tính", () => {
  test("cuộn chậm bằng bánh xe thật: đi qua đủ năm giai đoạn đúng thứ tự, tiến trình không lùi, không lỗi", async ({ page }) => {
    // Chromium headless vẽ WebGL bằng phần mềm (SwiftShader): khoảng 150 ms mỗi khung ở 1440 × 900 sau khi có bóng sàn và lớp phủ vỏ
    // (khoảng 117 ms nếu bỏ hai hiệu ứng này; trên GPU thật dưới 1,5 ms). Hơn 40 bước cuộn chậm cần nhiều hơn 90 s mặc định.
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await openStory(page);
    const { top, total } = await layout(page);
    await page.evaluate((y) => window.scrollTo(0, y), top);
    await page.mouse.move(720, 450);
    const seen: string[] = [];
    const progress: number[] = [];
    for (let i = 0; i < Math.ceil(total / 140) + 4; i++) {
      await page.mouse.wheel(0, 140);
      await page.waitForTimeout(22);
      const stage = (await page.locator(STORY).getAttribute("data-stage")) ?? "";
      if (seen[seen.length - 1] !== stage) seen.push(stage);
      progress.push((await api.state(page)).progress);
    }
    await settle(page);
    expect(seen).toEqual(STAGE_ORDER);
    progress.forEach((v, i) => i > 0 && expect(v).toBeGreaterThanOrEqual(progress[i - 1]! - 1e-9));
    expect((await api.state(page)).progress).toBeCloseTo(1, 4);
    await expectPositions(page, await api.expected(page, 1));
    expect(errors).toEqual([]);
  });

  test("cuộn nhanh: giật cuộn liên tiếp tới đầu và cuối rồi dừng giữa chừng thì hội tụ đúng điểm; về 0 là đúng vị trí nhà", async ({ page }) => {
    const errors = collectErrors(page);
    await openStory(page);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 1); // thao tác thật đầu tiên: từ đây trở đi hoạt ảnh được làm mượt
    const { top, total } = await layout(page);
    for (let i = 0; i < 12; i++) await page.evaluate((y) => window.scrollTo(0, y), top + (i % 2 === 0 ? total : 0));
    await scrollToProgress(page, 0.55);
    // Trong lúc đang hội tụ, tiến trình hiển thị luôn nằm trong [0, 1] và không nhảy.
    const samples: number[] = [];
    for (let i = 0; i < 12; i++) {
      samples.push((await api.state(page)).progress);
      await page.waitForTimeout(40);
    }
    for (const s of samples) expect(s >= 0 && s <= 1).toBe(true);
    await settle(page);
    const st = await api.state(page);
    expect(st.progress).toBeCloseTo(0.55, 3);
    await expectPositions(page, await api.expected(page, st.progress));

    await scrollToProgress(page, 0);
    await settle(page);
    expect((await api.state(page)).progress).toBe(0);
    await expectPositions(page, await api.homes(page), 1e-9);
    expect(errors).toEqual([]);
  });

  test("cuộn ngược: lắp lại từng bước, tiêu đề đổi sang lắp lại, nhãn hiện cả hai chiều, về 0 là đúng vị trí nhà", async ({ page }) => {
    const errors = collectErrors(page);
    await openStory(page);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 1);
    const charger = page.getByTestId("label-charger");

    await scrollToProgress(page, beatCenter(2));
    await settle(page);
    await expect(charger).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `${SHOT_DIR}/forward-charger.png` });

    await scrollToProgress(page, 0.75);
    await settle(page);
    await scrollToProgress(page, beatCenter(2));
    await settle(page);
    await expect(charger).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `${SHOT_DIR}/reverse-charger.png` });
    // Cùng một p thì cùng một tư thế dù đi tới hay đi lùi.
    await expectPositions(page, await api.expected(page, beatCenter(2)));

    await scrollToProgress(page, 0.35);
    await settle(page);
    await expect(page.getByTestId("stage-title")).toHaveText("Lắp linh kiện lại");
    await scrollToProgress(page, 0.14);
    await settle(page);
    await expect(page.getByTestId("stage-title")).toHaveText("Đóng nắp");

    await scrollToProgress(page, 0);
    await settle(page);
    await expect(page.getByTestId("stage-title")).toHaveText("Thiết bị đã đóng");
    await expectPositions(page, await api.homes(page), 1e-9);
    expect(errors).toEqual([]);
  });

  test("lặp lại 6 vòng đóng - mở: mỗi vòng trở về đúng trạng thái, vòng lặp vẽ dừng khi đứng yên", async ({ page }) => {
    const errors = collectErrors(page);
    await openStory(page);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 1);
    const homes = await api.homes(page);
    for (let i = 0; i < 6; i++) {
      await scrollToProgress(page, 1);
      await settle(page);
      await expectPositions(page, await api.expected(page, 1));
      await scrollToProgress(page, 0);
      await settle(page);
      await expectPositions(page, homes, 1e-9);
    }
    expect(errors).toEqual([]);
  });

  test("đổi kích thước cửa sổ khi đang xem một nhịp: canvas khớp khung, bố cục đổi đúng, nhãn nằm trong màn hình, vẫn có hình", async ({ page }) => {
    const errors = collectErrors(page);
    // Mỗi lần dựng lại giao diện không được tạo thêm context WebGL (trình duyệt sẽ huỷ context cũ nhất, tức canvas đang xem).
    const contextWarnings: string[] = [];
    page.on("console", (m) => {
      if (m.text().includes("Too many active WebGL contexts")) contextWarnings.push(m.text());
    });
    await openStory(page);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 1);
    await scrollToProgress(page, beatCenter(1));
    await settle(page);
    const sizes: Array<[number, number, "wide" | "narrow", string]> = [
      [1024, 768, "wide", "full"],
      [800, 1000, "narrow", "full"],
      [390, 844, "narrow", "lite"],
      [1440, 900, "wide", "full"],
    ];
    for (const [w, h, layoutName, mode] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(250);
      await scrollToProgress(page, beatCenter(1));
      await settle(page);
      await expect(page.locator(STORY)).toHaveAttribute("data-layout", layoutName);
      await expect(page.locator(STORY)).toHaveAttribute("data-mode", mode);
      const dims = await page.evaluate((sel) => {
        const canvas = document.querySelector(`${sel} canvas`) as HTMLCanvasElement;
        const stage = (document.querySelector(sel) as HTMLElement).firstElementChild as HTMLElement;
        const card = document.querySelector('[data-testid="label-battery"]') as HTMLElement;
        const r = card.getBoundingClientRect();
        return { cw: canvas.clientWidth, ch: canvas.clientHeight, sw: stage.clientWidth, sh: stage.clientHeight, bufferRatio: canvas.width / canvas.clientWidth, card: { l: r.left, r: r.right, t: r.top, b: r.bottom }, vw: window.innerWidth, vh: window.innerHeight };
      }, STORY);
      expect([dims.cw, dims.ch]).toEqual([dims.sw, dims.sh]);
      expect(dims.bufferRatio).toBeGreaterThan(0.9);
      expect(dims.card.l).toBeGreaterThanOrEqual(-1);
      expect(dims.card.r).toBeLessThanOrEqual(dims.vw + 1);
      expect(dims.card.b).toBeLessThanOrEqual(dims.vh + 1);
      await expect(page.getByTestId("label-battery")).toHaveCSS("opacity", "1");
      await expectNoHorizontalOverflow(page);
      const s = await api.sample(page);
      expect(s.coverage, `${w}×${h}`).toBeGreaterThan(0.01);
      expect(Math.abs((await api.state(page)).progress - (await pageProgress(page)))).toBeLessThan(0.01);
      await page.screenshot({ path: `${SHOT_DIR}/resize-${w}x${h}.png` });
    }
    expect(contextWarnings).toEqual([]);
    expect(errors).toEqual([]);
  });

  for (const target of [0, 0.3, 0.65, 1]) {
    test(`tải lại trang ở vị trí cuộn p ≈ ${target}: khung đầu đúng ngay, không chạy lại hoạt ảnh`, async ({ page }) => {
      const errors = collectErrors(page);
      await openStory(page);
      await page.mouse.move(720, 450);
      await page.mouse.wheel(0, 1);
      await scrollToProgress(page, target);
      await settle(page);
      await page.reload();
      await expect(page.locator(`${STORY} [data-state]`)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      await expect.poll(async () => (await api.state(page)).ready).toBe(true);
      // Trình duyệt khôi phục vị trí cuộn sau khi trang dựng xong. Ngay tại thời điểm đích đổi về vị trí cũ, tiến trình hiển thị
      // phải đã bằng đích (áp dụng tức thì), không chạy lại hoạt ảnh từ 0.
      await expect
        .poll(
          async () => {
            const s = await api.state(page);
            return Math.abs(s.target - target) < 0.02 ? Math.abs(s.progress - s.target) : 99;
          },
          { timeout: 8000 },
        )
        .toBeLessThan(0.002);
      const st = await api.state(page);
      expect(st.target).toBeCloseTo(await pageProgress(page), 2);
      await expectPositions(page, await api.expected(page, st.progress));
      expect((await api.sample(page)).coverage).toBeGreaterThan(0.01);
      expect(errors).toEqual([]);
    });
  }

  test("không chặn cuộn trang: bánh xe qua canvas vẫn cuộn, canvas không nhận con trỏ, cuộn tới nội dung phía sau", async ({ page }) => {
    await openStory(page);
    const canvas = page.locator(`${STORY} canvas`);
    await expect(canvas).toHaveCSS("pointer-events", "none");
    await expect(canvas).toHaveCSS("touch-action", "pan-y");
    const { top } = await layout(page);
    await page.evaluate((y) => window.scrollTo(0, y), top + 10);
    const before = await page.evaluate(() => window.scrollY);
    const hit = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return el?.tagName.toLowerCase();
    });
    expect(hit).not.toBe("canvas");
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 200);
    // Với WebGL chạy bằng phần mềm (SwiftShader) phím bấm trong lúc vòng vẽ còn đang hội tụ bị trình duyệt bỏ qua; trên GPU thật
    // phím hoạt động ngay sau khi cuộn (đã kiểm). Nên chờ vòng vẽ dừng rồi mới bấm.
    await settle(page);
    await page.keyboard.press("End");
    await expect(page.getByRole("heading", { name: "Giới hạn của mô hình" })).toBeInViewport();
    // Cùng lý do như trên: sau "End" cảnh hội tụ về p = 1 và vòng vẽ còn bận, phím "Home" bấm lúc đó bị bỏ qua.
    await settle(page);
    await page.keyboard.press("Home");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("khi trang đứng yên không vẽ thêm khung hình nào, khi cuộn thì có vẽ", async ({ page }) => {
    await openStory(page);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 1);
    await scrollToProgress(page, 0.4);
    await settle(page);
    const idle0 = (await api.state(page)).frames;
    await page.waitForTimeout(800);
    expect((await api.state(page)).frames).toBe(idle0);
    await scrollToProgress(page, 0.45);
    await page.waitForTimeout(150);
    expect((await api.state(page)).frames).toBeGreaterThan(idle0);
    await settle(page);
  });

  test("nhãn phối hợp với chuyển động: mỗi nhịp hiện đúng một nhãn khi linh kiện đã tới trạm, nhãn không che linh kiện đang giới thiệu", async ({ page }) => {
    const errors = collectErrors(page);
    await openStory(page);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 1);

    // Trước giai đoạn khám phá: không có nhãn nào.
    for (const p of [0, 0.1, 0.3, 0.5, 0.58]) {
      await scrollToProgress(page, p);
      await settle(page);
      for (const id of BEAT_IDS) await expect(page.getByTestId(`label-${id}`)).toHaveCSS("visibility", "hidden");
    }

    for (let i = 0; i < BEAT_IDS.length; i++) {
      await scrollToProgress(page, beatCenter(i));
      await settle(page);
      const info = await page.evaluate(
        ({ sel, ids, k }) => {
          const stage = (document.querySelector(sel) as HTMLElement).firstElementChild as HTMLElement;
          const sr = stage.getBoundingClientRect();
          const out = ids.map((id) => {
            const el = document.querySelector(`[data-testid="label-${id}"]`) as HTMLElement;
            return { id, opacity: Number(getComputedStyle(el).opacity), visibility: getComputedStyle(el).visibility, rect: el.getBoundingClientRect().toJSON() };
          });
          const line = stage.querySelectorAll("svg line")[k] as SVGLineElement;
          return { out, sr: sr.toJSON(), line: { x2: Number(line.getAttribute("x2")), y2: Number(line.getAttribute("y2")), opacity: Number(getComputedStyle(line).opacity) } };
        },
        { sel: STORY, ids: BEAT_IDS, k: i },
      );
      info.out.forEach((o, k) => {
        if (k === i) {
          expect(o.opacity, o.id).toBeGreaterThan(0.99);
          expect(o.visibility).toBe("visible");
        } else {
          expect(o.visibility, o.id).toBe("hidden");
        }
      });
      const card = info.out[i]!.rect;
      // Điểm neo (tâm linh kiện) không nằm dưới thẻ nhãn: nhãn không che đúng thứ nó đang giới thiệu.
      const ax = info.line.x2 + info.sr.left;
      const ay = info.line.y2 + info.sr.top;
      const covered = ax >= card.left && ax <= card.right && ay >= card.top && ay <= card.bottom;
      expect(covered, `nhãn ${BEAT_IDS[i]} che linh kiện của nó`).toBe(false);
      expect(info.line.opacity).toBeGreaterThan(0.5);
      expect(card.right).toBeLessThanOrEqual(info.sr.right + 1);
      await expect(page.getByTestId("stage-title")).toHaveText("Khám phá từng linh kiện");
      await page.screenshot({ path: `${SHOT_DIR}/beat-${i}-${BEAT_IDS[i]}.png` });
    }
    expect(errors).toEqual([]);
  });

  test("ảnh duyệt: các mốc đóng, mở nắp, tách, tổng quan", async ({ page }) => {
    await openStory(page);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 1);
    for (const [name, p] of [["01-closed", 0], ["02-cap-lifting", 0.14], ["03-open", 0.2], ["04-exploding", 0.4], ["05-exploded", 0.58], ["06-overview", 1]] as const) {
      await scrollToProgress(page, p);
      await settle(page);
      await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
      expect((await api.sample(page)).coverage).toBeGreaterThan(0.01);
    }
  });
});

test.describe("cảnh cuộn: điện thoại (chạm)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test("chế độ nhẹ, bố cục hẹp; cử chỉ vuốt thật qua canvas vẫn cuộn trang và điều khiển hoạt ảnh; nhãn dán đáy", async ({ page }) => {
    const errors = collectErrors(page);
    await openStory(page);
    await expect(page.locator(STORY)).toHaveAttribute("data-mode", "lite");
    await expect(page.locator(STORY)).toHaveAttribute("data-layout", "narrow");
    await expect(page.locator(`${STORY} canvas`)).toHaveCSS("touch-action", "pan-y");

    const { top, total } = await layout(page);
    await page.evaluate((y) => window.scrollTo(0, y), top);
    const cdp = await page.context().newCDPSession(page);
    const y0 = await page.evaluate(() => window.scrollY);
    // Vuốt bằng ngón tay thật (chuỗi sự kiện chạm) bắt đầu ngay trên canvas.
    const swipe = async (from: number, to: number) => {
      const send = (type: "touchStart" | "touchMove" | "touchEnd", y: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }] });
      await send("touchStart", from);
      const dir = to < from ? -1 : 1;
      for (let y = from; dir < 0 ? y > to : y < to; y += dir * 25) {
        await send("touchMove", y);
        await page.waitForTimeout(8);
      }
      await send("touchEnd", to);
      await page.waitForTimeout(350);
    };
    await swipe(760, 160);
    await swipe(760, 160);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y0 + 600);
    await settle(page);
    const st = await api.state(page);
    expect(st.progress).toBeGreaterThan(0.05);
    expect(st.progress).toBeCloseTo(await pageProgress(page), 2);

    // Tới nhịp thứ hai: thẻ nhãn nằm trong màn hình, dán đáy, và phần chủ đề được đẩy lên khỏi thẻ.
    await scrollToProgress(page, beatCenter(1));
    await settle(page);
    const geo = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="label-battery"]') as HTMLElement;
      const r = card.getBoundingClientRect();
      return { bottom: r.bottom, top: r.top, left: r.left, right: r.right, vh: window.innerHeight, vw: window.innerWidth, opacity: Number(getComputedStyle(card).opacity) };
    });
    expect(geo.opacity).toBeGreaterThan(0.99);
    expect(geo.bottom).toBeLessThanOrEqual(geo.vh);
    expect(geo.left).toBeGreaterThanOrEqual(0);
    expect(geo.right).toBeLessThanOrEqual(geo.vw);
    expect(geo.top).toBeGreaterThan(geo.vh * 0.45); // nhãn ở nửa dưới, nhường nửa trên cho mô hình
    await expectNoHorizontalOverflow(page);
    expect((await api.sample(page)).coverage).toBeGreaterThan(0.01);
    await page.screenshot({ path: `${SHOT_DIR}/mobile-battery.png` });

    // Vuốt ngược một đoạn rồi về đầu: trở lại đúng vị trí nhà.
    const before = await page.evaluate(() => window.scrollY);
    await swipe(160, 760);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before - 300);
    await scrollToProgress(page, 0);
    await settle(page);
    await expectPositions(page, await api.homes(page), 1e-9);
    // Vùng cuộn ngắn hơn máy tính để đỡ mỏi tay.
    expect(total / 844).toBeLessThan(5.2);
    expect(errors).toEqual([]);
  });
});

test.describe("cảnh cuộn: giảm chuyển động", () => {
  test.use({ reducedMotion: "reduce" });

  test("chỉ ba ảnh tĩnh, không nội suy, không nhãn trôi nổi; danh sách linh kiện hiện đầy đủ", async ({ page }) => {
    const errors = collectErrors(page);
    await openStory(page);
    await expect(page.locator(STORY)).toHaveAttribute("data-mode", "reduced");
    await expect(page.getByTestId("static-labels").getByRole("heading", { level: 4 })).toHaveCount(8);
    await expect(page.getByTestId("static-labels")).toBeVisible();

    const snaps: Array<[number, number]> = [[0.1, 0], [0.5, 0.2], [0.9, 0.58], [0.7, 0.58], [0.2, 0]];
    for (const [p, expectedSnap] of snaps) {
      await scrollToProgress(page, p);
      // Không có hoạt ảnh làm mượt: ngay trong vài khung hình tiến trình hiển thị đã bằng ảnh tĩnh.
      await expect.poll(async () => (await api.state(page)).progress, { timeout: 1500 }).toBe(expectedSnap);
      await settle(page);
      await expectPositions(page, await api.expected(page, expectedSnap));
      for (const id of BEAT_IDS) await expect(page.getByTestId(`label-${id}`)).toHaveCSS("visibility", "hidden");
      await page.screenshot({ path: `${SHOT_DIR}/reduced-${String(expectedSnap).replace(".", "_")}-${String(p).replace(".", "_")}.png` });
    }
    // Vùng cuộn ngắn hơn bản đầy đủ.
    const { total, viewport } = await layout(page);
    expect(total / viewport).toBeLessThan(2.2);
    expect(errors).toEqual([]);
  });
});
