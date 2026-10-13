import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

/**
 * Cảnh 3D trên landing, ba chương liền nhau trên một vùng cuộn: quan sát hoạt động (hỗ trợ dùng thuốc, khái niệm) → bảo vệ dữ liệu → tổng quan hôm nay.
 * Tiến trình `s` của cả vùng: quan sát [0, A], bảo vệ (A, B], tổng quan (B, 1] (khớp `storySteps.ts`).
 */

const SHOT_DIR = "test-results/screens";
const A = 0.488;
const B = 0.79;
/** Quy tiến trình trong chương về s của cả vùng. */
const obs = (p: number) => p * A;
const sec = (p: number) => A + p * (B - A);
const rep = (p: number) => B + p * (1 - B);

interface Artifact {
  chapter: number;
  phase: string;
  packetId: string;
  packetCount: number;
  hexVisible: number;
  digest: string;
  pose: { position: number[]; quaternion: number[]; scale: number };
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface MedDebug {
  state(): { progress: number; target: number; ready: boolean; frames: number; step: number; chapter: number; phase: string; active: boolean; pending: boolean };
  sample(): { coverage: number; distinctColors: number };
  motion(): number[];
  artifact(): Artifact;
  surfaceRect(): Rect | null;
  handoff(): {
    version: number;
    phase: string;
    arrived: boolean;
    progress: number;
    current: { position: number[]; quaternion: number[]; scale: number };
    final: { position: number[]; quaternion: number[]; scale: number };
    finalScreen: { x: number; y: number };
    spec: { width: number; height: number; snapshotSize: number[] };
    snapshot: { width: number; height: number; distinctColors: number };
    sampledEnd: { phase: string; position: number[] };
    objectId: string;
  };
}
const dbg = <K extends keyof MedDebug>(page: Page, key: K) => page.evaluate((k) => (window as unknown as { __medScene: MedDebug }).__medScene[k]() as ReturnType<MedDebug[K]>, key);
const med = {
  state: (page: Page) => dbg(page, "state"),
  sample: (page: Page) => dbg(page, "sample"),
  motion: (page: Page) => dbg(page, "motion"),
  artifact: (page: Page) => dbg(page, "artifact"),
  handoff: (page: Page) => dbg(page, "handoff"),
  surfaceRect: (page: Page) => dbg(page, "surfaceRect"),
};

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("Too many active WebGL contexts")) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function openScene(page: Page) {
  await page.goto("/?debug=1");
  await page.evaluate(() => document.querySelector('[data-testid="med-track"]')!.scrollIntoView({ behavior: "instant" }));
  await expect(page.getByTestId("med-stage")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await expect.poll(async () => (await med.state(page)).ready).toBe(true);
}

/** Vùng cuộn của cảnh: đầu vùng (toạ độ trang) và quãng cuộn được. */
const trackLayout = (page: Page) =>
  page.evaluate(() => {
    const track = document.querySelector<HTMLElement>('[data-testid="med-track"]')!;
    const stage = document.querySelector<HTMLElement>('[data-testid="med-stage"]')!;
    const top = parseFloat(getComputedStyle(stage).top) || 0;
    return { start: window.scrollY + track.getBoundingClientRect().top - top, total: track.offsetHeight - stage.clientHeight };
  });

const scrollToP = (page: Page, p: number) =>
  page.evaluate((p) => {
    const track = document.querySelector<HTMLElement>('[data-testid="med-track"]')!;
    const stage = document.querySelector<HTMLElement>('[data-testid="med-stage"]')!;
    const total = track.offsetHeight - stage.clientHeight;
    const top = parseFloat(getComputedStyle(stage).top) || 0;
    window.scrollTo({ top: window.scrollY + track.getBoundingClientRect().top + p * total - top, behavior: "instant" });
  }, p);

/** Chờ trình duyệt xử lý cuộn (đích khớp p), cảnh hội tụ về đích và vòng vẽ dừng. */
async function settle(page: Page, p: number) {
  await expect.poll(async () => Math.abs((await med.state(page)).target - p), { timeout: 20_000 }).toBeLessThan(0.002);
  await expect
    .poll(async () => {
      const s = await med.state(page);
      return Math.abs(s.progress - s.target);
    }, { timeout: 40_000 })
    .toBeLessThan(1e-6);
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 80 && stable < 3; i++) {
    const { frames } = await med.state(page);
    stable = frames === last ? stable + 1 : 0;
    last = frames;
    await page.waitForTimeout(90);
  }
  expect(stable, "vòng vẽ phải dừng khi trang đứng yên").toBeGreaterThanOrEqual(3);
}

/** Đợi hoạt ảnh cuộn mượt của bánh xe dừng hẳn. */
async function waitScrollIdle(page: Page) {
  let lastY = -1;
  await expect
    .poll(async () => {
      const y = await page.evaluate(() => window.scrollY);
      const still = y === lastY;
      lastY = y;
      return still;
    }, { intervals: [300], timeout: 30_000 })
    .toBe(true);
}

/** Khung HTML của bản báo cáo và của khung cảnh (px). */
const reportRects = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector('[data-testid="daily-report"]')!.getBoundingClientRect();
    const s = document.querySelector('[data-testid="med-stage"]')!.getBoundingClientRect();
    return { report: { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }, stage: { w: s.width, h: s.height } };
  });

const heading = (page: Page) => page.getByRole("heading", { level: 3, name: "Tổng quan hôm nay" });
/** Khối đầu của báo cáo (mang độ hiện theo `--r`, không phải chính thẻ h3) và nhãn "Ví dụ báo cáo". */
const headerOf = (page: Page) => heading(page).locator("xpath=ancestor::header");
const sampleTag = (page: Page) => page.getByTestId("daily-report").getByText("Ví dụ báo cáo", { exact: true });

/** Thứ tự pha của gói qua cả ba chương. */
const PHASES = ["hidden", "framing", "captured", "condensing", "transit", "arrived", "lifting", "approaching", "entering", "fragmenting", "converging", "digest", "settled", "resting", "opening", "revealing", "stable"];
const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));
/** `motionState`: gói [0–7], độ hiện thẻ [8], ly [9–11], đầu tay phải [12–14], camera [15–17], khiên [18–19], lục giác [20], bề mặt [21–22], nội dung [23], bảng bước [24]. */
const slice = (m: number[], from: number, to: number) => m.slice(from, to);

test.describe("quan sát → bảo vệ → tổng quan: máy tính", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("cuộn chậm qua cả hai ranh giới rồi cuộn ngược: cùng một gói, pha đúng thứ tự, không nhảy, quay về đúng khung cũ (không trôi)", async ({ page }) => {
    test.setTimeout(420_000);
    const errors = collectErrors(page);
    await openScene(page);
    await page.mouse.move(900, 450);
    const { start, total } = await trackLayout(page);
    const from = obs(0.8);
    await scrollToP(page, from);
    await settle(page, from);
    const initial = await med.motion(page);
    const id = (await med.artifact(page)).packetId;

    // Cuộn chậm xuống bằng bánh xe (mỗi nhịp 110 px ≈ 0,017 tiến trình), qua cả hai ranh giới tới hết vùng.
    const forward: Array<{ p: number; phase: string; chapter: number; motion: number[] }> = [];
    let y = await page.evaluate(() => window.scrollY);
    while (y < start + total + 150) {
      await page.mouse.wheel(0, 110);
      await page.waitForTimeout(120);
      y = await page.evaluate(() => window.scrollY);
      const s = await med.state(page);
      const a = await med.artifact(page);
      expect(a.packetId, "luôn cùng một đối tượng gói").toBe(id);
      expect(a.packetCount, "không bao giờ có gói thứ hai").toBe(1);
      forward.push({ p: s.progress, phase: s.phase, chapter: s.chapter, motion: await med.motion(page) });
    }
    expect(forward.length).toBeGreaterThan(20);
    expect([...new Set(forward.map((f) => f.chapter))].sort(), "đã đi qua cả ba chương").toEqual([0, 1, 2]);
    for (let i = 1; i < forward.length; i++) {
      expect(forward[i]!.p, `khung ${i}`).toBeGreaterThanOrEqual(forward[i - 1]!.p - 1e-9);
      expect(PHASES.indexOf(forward[i]!.phase), `pha ở khung ${i}`).toBeGreaterThanOrEqual(PHASES.indexOf(forward[i - 1]!.phase));
      // Không cảnh nào bị đặt lại: gói và camera không nhảy quá xa giữa hai nhịp cuộn (kể cả lúc đổi chương).
      expect(dist(slice(forward[i]!.motion, 0, 3), slice(forward[i - 1]!.motion, 0, 3)), `gói ở khung ${i}`).toBeLessThan(0.45);
      expect(dist(slice(forward[i]!.motion, 15, 18), slice(forward[i - 1]!.motion, 15, 18)), `camera ở khung ${i}`).toBeLessThan(0.6);
    }
    await settle(page, 1);
    expect((await med.state(page)).phase).toBe("stable");
    await expect(headerOf(page)).toHaveCSS("opacity", "1");
    const end = await med.motion(page);

    // Cuộn chậm ngược về điểm xuất phát: báo cáo ẩn lại, khiên hiện lại, gói trở về khay.
    const backward: number[] = [];
    const back = start + from * total;
    while ((await page.evaluate(() => window.scrollY)) > back + 60) {
      await page.mouse.wheel(0, -110);
      await page.waitForTimeout(120);
      backward.push((await med.state(page)).progress);
      expect((await med.artifact(page)).packetId).toBe(id);
    }
    for (let i = 1; i < backward.length; i++) expect(backward[i]!, `ngược khung ${i}`).toBeLessThanOrEqual(backward[i - 1]! + 1e-9);
    await waitScrollIdle(page);
    await scrollToP(page, from);
    await settle(page, from);
    expect((await med.state(page)).chapter).toBe(0);
    expect((await med.artifact(page)).hexVisible).toBe(0);
    await expect(headerOf(page)).toHaveCSS("opacity", "0");
    // Về đúng khung cũ: không trôi, dù đã đi một vòng qua hai chương sau.
    const again = await med.motion(page);
    again.forEach((v, i) => expect(v, `giá trị ${i}`).toBeCloseTo(initial[i]!, 6));

    // Và tới lần nữa thì ra đúng khung cuối như lần đầu.
    await scrollToP(page, 1);
    await settle(page, 1);
    const end2 = await med.motion(page);
    end2.forEach((v, i) => expect(v, `giá trị cuối ${i}`).toBeCloseTo(end[i]!, 6));
    expect(errors).toEqual([]);
  });

  test("cuộn nhanh và nhảy cóc qua cả ba chương: mỗi mốc ra đúng cùng một khung bất kể đi tới từ đâu", async ({ page }) => {
    test.setTimeout(420_000);
    const errors = collectErrors(page);
    await openScene(page);
    const marks = [obs(0.6), obs(0.97), A, sec(0.4), sec(0.9), rep(0.1), rep(0.35), rep(0.6), rep(0.95), 1];
    const reference: number[][] = [];
    for (const p of marks) {
      await scrollToP(page, p);
      await settle(page, p);
      reference.push(await med.motion(page));
    }
    const id = (await med.artifact(page)).packetId;
    // Nhảy cóc qua lại, lướt thẳng từ đầu tới cuối rồi ngược lại, không chờ hội tụ giữa chừng.
    for (const p of [1, 0, 0.82, 0.99, 0.01, 0.55, 0.2, 1, 0.9, 0.3]) {
      await scrollToP(page, p);
      await page.waitForTimeout(30);
    }
    await page.mouse.move(700, 450);
    for (let i = 0; i < 25; i++) await page.mouse.wheel(0, i % 2 ? -1500 : 1500);
    await waitScrollIdle(page);
    for (let k = marks.length - 1; k >= 0; k--) {
      const p = marks[k]!;
      await scrollToP(page, p);
      await settle(page, p);
      const again = await med.motion(page);
      again.forEach((v, i) => expect(v, `p = ${p}, giá trị ${i}`).toBeCloseTo(reference[k]![i]!, 6));
      const a = await med.artifact(page);
      expect(a.packetId).toBe(id);
      expect(a.packetCount).toBe(1);
    }
    expect(errors).toEqual([]);
  });

  test("bàn giao tại ranh giới quan sát → bảo vệ: chương bảo vệ bắt đầu đúng tư thế cuối của gói, trên chính đối tượng đó", async ({ page }) => {
    test.setTimeout(240_000);
    await openScene(page);
    await scrollToP(page, obs(0.8));
    await settle(page, obs(0.8));
    const mid = await med.handoff(page);
    expect(mid.version).toBe(1);
    expect(mid.arrived).toBe(false);
    expect(mid.sampledEnd.phase).toBe("arrived");

    // Cuộn theo điểm ảnh không đặt đúng được s = ranh giới, nên kiểm hai bên: ngay trước (chương quan sát, gói đang hạ xuống khay)
    // và ngay sau (chương bảo vệ, các đoạn chuyển động của chương này chưa bắt đầu nên gói đứng đúng tư thế bàn giao).
    const before = A - 0.0008;
    await scrollToP(page, before);
    await settle(page, before);
    const atEnd = await med.artifact(page);
    expect(atEnd.chapter).toBe(0);

    const just = A + 0.0008;
    await scrollToP(page, just);
    await settle(page, just);
    const done = await med.handoff(page);
    const after = await med.artifact(page);
    expect(after.chapter).toBe(1);
    expect(done.arrived).toBe(true);
    expect(done.objectId, "bàn giao trỏ đúng đối tượng đang vẽ").toBe(after.packetId);
    expect(after.packetId, "cùng đối tượng ở hai bên ranh giới").toBe(atEnd.packetId);
    after.pose.position.forEach((v, i) => expect(v).toBeCloseTo(done.final.position[i]!, 6));
    after.pose.quaternion.forEach((v, i) => expect(v).toBeCloseTo(done.final.quaternion[i]!, 6));
    expect(after.pose.scale).toBeCloseTo(1, 9);
    expect(dist(atEnd.pose.position, done.final.position)).toBeLessThan(0.005);
    const [qx, qy, qz, qw] = done.final.quaternion as [number, number, number, number];
    expect(2 * (qy * qz - qw * qx), "nằm phẳng, mặt ngửa").toBeCloseTo(1, 6);
    expect(done.finalScreen.x).toBeGreaterThan(0.1);
    expect(done.finalScreen.x).toBeLessThan(0.95);
    expect(done.finalScreen.y).toBeGreaterThan(0.1);
    expect(done.finalScreen.y).toBeLessThan(0.95);
    expect(done.snapshot.width).toBe(done.spec.snapshotSize[0]);
    expect(done.snapshot.distinctColors).toBeGreaterThan(40);
  });

  test("bàn giao tại ranh giới bảo vệ → tổng quan: dải rút gọn đứng yên, cùng gói, cùng tư thế; sang chương mới không có bước nhảy", async ({ page }) => {
    test.setTimeout(240_000);
    await openScene(page);
    const before = B - 0.001;
    await scrollToP(page, before);
    await settle(page, before);
    const a = await med.artifact(page);
    const ma = await med.motion(page);
    expect(a.chapter).toBe(1);
    expect(a.hexVisible).toBe(8);

    const just = B + 0.001;
    await scrollToP(page, just);
    await settle(page, just);
    const b = await med.artifact(page);
    const mb = await med.motion(page);
    expect(b.chapter).toBe(2);
    expect(b.phase).toBe("resting");
    expect(b.packetId).toBe(a.packetId);
    expect(b.packetCount).toBe(1);
    expect(b.hexVisible).toBe(8);
    expect(b.digest).toBe(a.digest);
    // Gói đứng yên đúng tại chỗ; camera chỉ lệch rất nhỏ giữa hai điểm cách nhau 0,002 tiến trình.
    expect(dist(b.pose.position, a.pose.position)).toBeLessThan(1e-6);
    expect(dist(slice(mb, 15, 18), slice(ma, 15, 18))).toBeLessThan(0.02);
    expect(mb[19], "khiên vẫn hiện").toBe(1);
    expect(mb[21], "bề mặt chưa mọc").toBe(0);
    await expect(headerOf(page)).toHaveCSS("opacity", "0");
    await expect(page.getByRole("button", { name: /Một hành động/ })).toBeVisible();
  });

  test("chương tổng quan: bề mặt 3D mọc từ dải rút gọn và khớp từng điểm ảnh với khung báo cáo HTML; chữ chỉ hiện sau khi bề mặt đã tới", async ({ page }) => {
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    await openScene(page);
    const seen: Array<{ p: number; grow: number; reveal: number; panel: number; heading: string }> = [];
    for (const p of [0.02, 0.15, 0.3, 0.45, 0.55, 0.65, 0.8, 1]) {
      const s = rep(p);
      await scrollToP(page, s);
      await settle(page, s);
      const m = await med.motion(page);
      const op = await headerOf(page).evaluate((el) => getComputedStyle(el).opacity);
      seen.push({ p, grow: m[21]!, reveal: m[23]!, panel: m[24]!, heading: op });
      // Chữ không bao giờ hiện khi bề mặt chưa mọc đủ.
      if (m[23]! > 0.01) {
        expect(m[21], `p = ${p}`).toBeGreaterThan(0.999);
        expect(m[22], `p = ${p}`).toBeGreaterThan(0.999);
      }
      // Khi bề mặt đã mọc đủ thì khớp khung HTML trong vòng 1,5 px.
      if (m[21]! > 0.999) {
        const surface = await med.surfaceRect(page);
        const { report } = await reportRects(page);
        expect(surface, `p = ${p}`).not.toBeNull();
        expect(Math.abs(surface!.x - report.x), `x ở p = ${p}`).toBeLessThan(1.5);
        expect(Math.abs(surface!.y - report.y), `y ở p = ${p}`).toBeLessThan(1.5);
        expect(Math.abs(surface!.w - report.w), `w ở p = ${p}`).toBeLessThan(1.5);
        expect(Math.abs(surface!.h - report.h), `h ở p = ${p}`).toBeLessThan(1.5);
      }
      if (p === 0.3 || p === 0.55) await page.getByTestId("med-stage").screenshot({ path: `${SHOT_DIR}/med-1440-report-${String(p).replace(".", "_")}.png` });
    }
    // Bề mặt mọc dần, bảng bước mờ dần, chữ hiện dần.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.grow).toBeGreaterThanOrEqual(seen[i - 1]!.grow - 1e-9);
      expect(seen[i]!.panel).toBeLessThanOrEqual(seen[i - 1]!.panel + 1e-9);
      expect(seen[i]!.reveal).toBeGreaterThanOrEqual(seen[i - 1]!.reveal - 1e-9);
    }
    expect(seen[0]!.grow).toBeLessThan(0.05);
    expect(Number(seen[0]!.heading)).toBe(0);
    expect(Number(seen[seen.length - 1]!.heading)).toBe(1);
    expect(errors).toEqual([]);
  });

  test("báo cáo đứng yên khi cuộn qua phần cuối: khung không xê dịch, trang không tràn ngang, đọc được đủ nội dung", async ({ page }) => {
    test.setTimeout(300_000);
    await openScene(page);
    const rects: Rect[] = [];
    for (const p of [0.6, 0.7, 0.8, 0.9, 1]) {
      await scrollToP(page, rep(p));
      await settle(page, rep(p));
      rects.push((await reportRects(page)).report);
      await expectNoHorizontalOverflow(page);
    }
    // Khung báo cáo là một: không dịch chuyển, không đổi kích thước suốt phần cuối.
    for (const r of rects) {
      expect(Math.abs(r.x - rects[0]!.x)).toBeLessThan(0.5);
      expect(Math.abs(r.y - rects[0]!.y)).toBeLessThan(0.5);
      expect(Math.abs(r.w - rects[0]!.w)).toBeLessThan(0.5);
      expect(Math.abs(r.h - rects[0]!.h)).toBeLessThan(0.5);
    }
    // Máy tính đủ cao: không cần cuộn nội dung, mọi dòng nằm trong khung và trong tầm nhìn.
    await expect(page.getByTestId("daily-report")).toBeInViewport({ ratio: 0.99 });
    for (const text of ["Đi lại trong nhà", "Cầm ly nước", "Giờ nhắc dùng thuốc", "Tư thế thay đổi đột ngột", "Dành cho người chăm sóc", "Mô tả do AI tạo, chưa được con người xác nhận."]) {
      await expect(page.getByText(text, { exact: true })).toBeInViewport({ ratio: 1 });
    }
    await expect(sampleTag(page)).toBeVisible();
    // Bảng bước đã nhường chỗ.
    await expect(page.getByRole("button", { name: /Một hành động/ })).toBeHidden();
    await expect(page.getByTestId("med-stage")).toHaveAttribute("data-chapter", "2");
    await page.getByTestId("med-stage").screenshot({ path: `${SHOT_DIR}/med-1440-report-final.png` });
    // Ngay sau vùng cảnh là phần Riêng tư.
    const next = await page.evaluate(() => document.querySelector('[data-testid="med-track"]')!.closest("section")!.nextElementSibling?.id);
    expect(next).toBe("rieng-tu");
  });

  test("cuộn ngược khỏi chương tổng quan: chữ ẩn trước, bề mặt co lại về dải rút gọn, khiên và bảng bước trở lại, cùng một gói", async ({ page }) => {
    test.setTimeout(300_000);
    await openScene(page);
    const id = (await med.artifact(page)).packetId;
    await scrollToP(page, 1);
    await settle(page, 1);
    await expect(headerOf(page)).toHaveCSS("opacity", "1");
    const steps = [rep(0.7), rep(0.45), rep(0.25), rep(0.05), sec(0.95)];
    let lastGrow = 2;
    let lastReveal = 2;
    for (const s of steps) {
      await scrollToP(page, s);
      await settle(page, s);
      const m = await med.motion(page);
      expect(m[21], `s = ${s}`).toBeLessThanOrEqual(lastGrow + 1e-9);
      expect(m[23], `s = ${s}`).toBeLessThanOrEqual(lastReveal + 1e-9);
      lastGrow = m[21]!;
      lastReveal = m[23]!;
      expect((await med.artifact(page)).packetId).toBe(id);
    }
    const back = await med.artifact(page);
    expect(back.chapter).toBe(1);
    expect(back.hexVisible).toBe(8);
    await expect(headerOf(page)).toHaveCSS("opacity", "0");
    await expect(page.getByRole("button", { name: /Chỉ còn bản rút gọn/ })).toBeVisible();
    await expect(page.getByTestId("security-note")).toHaveCSS("opacity", "1");
    expect(await med.surfaceRect(page)).toBeNull();
  });

  test("bố cục từng giai đoạn: cảnh có hình, không trống; nhãn và lưu ý về hình minh hoạ hiện đúng lúc; ảnh duyệt", async ({ page }) => {
    test.setTimeout(300_000);
    await openScene(page);
    // Đo khi đã ẩn căn phòng: ở cuối chương quan sát chỉ còn gói nhỏ trên khay nên ngưỡng thấp hơn.
    for (const [p, min] of [
      [0, 0.04],
      [obs(0.47), 0.04],
      [A, 0.003],
      [sec(0.5), 0.2],
      [B - 0.001, 0.2],
      [rep(0.3), 0.1],
      [1, 0.2],
    ] as const) {
      await scrollToP(page, p);
      await settle(page, p);
      const s = await med.sample(page);
      expect(s.coverage, `p = ${p}`).toBeGreaterThan(min);
      expect(s.distinctColors, `p = ${p}`).toBeGreaterThan(1);
      await page.getByTestId("med-stage").screenshot({ path: `${SHOT_DIR}/med-1440-${p.toFixed(3).replace(".", "_")}.png` });
    }
    const note = page.getByTestId("security-note");
    await scrollToP(page, obs(0.47));
    await settle(page, obs(0.47));
    await expect(page.getByText("Camera đeo ngực", { exact: true })).toHaveCSS("opacity", "1");
    await expect(note).toHaveCSS("opacity", "0");
    await scrollToP(page, A);
    await settle(page, A);
    await expect(page.getByText("Hub trong nhà", { exact: true })).toHaveCSS("opacity", "1");
    await scrollToP(page, sec(0.3));
    await settle(page, sec(0.3));
    await expect(page.getByText("Máy chủ đám mây CareLens AI", { exact: true })).toHaveCSS("opacity", "1");
    await expect(page.getByText("Hub trong nhà", { exact: true })).toHaveCSS("opacity", "0");
    await scrollToP(page, B - 0.001);
    await settle(page, B - 0.001);
    await expect(page.getByText("Bản rút gọn", { exact: true })).toHaveCSS("opacity", "1");
    await expect(page.getByTestId("med-stage")).toHaveAttribute("data-chapter", "1");
    await expect(note).toHaveCSS("opacity", "1");
    await expect(note).toContainText("không chứng minh hệ thống băm, mã hoá hay ẩn danh hoá");
    // Sang chương tổng quan: lưu ý và nhãn của chương trước nhường chỗ cho báo cáo.
    await scrollToP(page, 1);
    await settle(page, 1);
    await expect(page.getByTestId("med-stage")).toHaveAttribute("data-chapter", "2");
    await expect(note).toHaveCSS("opacity", "0");
    await expect(page.getByText("Bản rút gọn", { exact: true })).toHaveCSS("opacity", "0");
  });

  test("chọn bước bằng nút cuộn tới đúng ảnh của bước, cả hai chương; khi trang đứng yên không vẽ thêm khung nào", async ({ page }) => {
    test.setTimeout(240_000);
    await openScene(page);
    const sc = page.getByRole("group", { name: /Các bước bảo vệ dữ liệu/ });
    await sc.getByRole("button", { name: /Chỉ còn bản rút gọn/ }).click();
    await expect(sc.getByRole("button", { name: /Chỉ còn bản rút gọn/ })).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await settle(page, sec(0.97));
    expect((await med.state(page)).phase).toBe("digest");
    expect((await med.artifact(page)).chapter).toBe(1);
    const frames = (await med.state(page)).frames;
    await page.waitForTimeout(600);
    expect((await med.state(page)).frames).toBe(frames);
    const ob = page.getByRole("group", { name: /Các bước quan sát hoạt động/ });
    await ob.getByRole("button", { name: /Camera quan sát/ }).click();
    await expect(ob.getByRole("button", { name: /Camera quan sát/ })).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await settle(page, obs(0.47));
    expect((await med.state(page)).phase).toBe("captured");
    const m = await med.motion(page);
    expect(m[19], "khiên ẩn khi quay lại chương quan sát").toBe(0);
    expect((await med.artifact(page)).hexVisible).toBe(0);
  });
});

test.describe("quan sát → bảo vệ → tổng quan: điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("bảng bước ở trên và cao không đổi; báo cáo vừa khung, tiêu đề luôn thấy, bề mặt khớp khung HTML, không tràn ngang", async ({ page }) => {
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    await openScene(page);
    const heights = new Set<number>();
    for (const [p, min] of [
      [obs(0.1), 0.01],
      [obs(0.47), 0.01],
      [A, 0.002],
      [sec(0.7), 0.2],
      [rep(0.35), 0.1],
      [1, 0.2],
    ] as const) {
      await scrollToP(page, p);
      await settle(page, p);
      await expectNoHorizontalOverflow(page);
      const s = await med.sample(page);
      expect(s.coverage, `p = ${p}`).toBeGreaterThan(min);
      heights.add(await page.evaluate(() => document.querySelector('[data-testid="med-stage"] [role="group"]')!.closest("div.z-10")!.getBoundingClientRect().height));
      await page.getByTestId("med-stage").screenshot({ path: `${SHOT_DIR}/med-390-${p.toFixed(3).replace(".", "_")}.png` });
    }
    // Bảng bước cao như nhau ở mọi bước: khung cảnh không xê dịch khi đổi bước hay đổi chương (kể cả khi đã mờ đi).
    expect(heights.size).toBe(1);
    const a = await med.artifact(page);
    expect(a.chapter).toBe(2);
    expect(a.packetCount).toBe(1);
    // Báo cáo ở cuối: trong khung nhìn, tiêu đề và nhãn mô phỏng luôn thấy, tóm tắt và dòng cuối đọc được; bề mặt 3D khớp khung HTML.
    await expect(heading(page)).toBeInViewport({ ratio: 1 });
    await expect(sampleTag(page)).toBeInViewport({ ratio: 1 });
    await expect(page.getByText("Dành cho người chăm sóc", { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByText("Mô tả do AI tạo, chưa được con người xác nhận.", { exact: true })).toBeInViewport({ ratio: 1 });
    const surface = await med.surfaceRect(page);
    const { report, stage } = await reportRects(page);
    expect(surface).not.toBeNull();
    for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(surface![k] - report[k]), k).toBeLessThan(1.5);
    expect(report.x).toBeGreaterThanOrEqual(0);
    expect(report.x + report.w).toBeLessThanOrEqual(stage.w + 0.5);
    expect(report.y + report.h).toBeLessThanOrEqual(stage.h + 0.5);
    expect(errors).toEqual([]);
  });

  test("màn hình thấp (360 × 640): nội dung báo cáo cuộn lên trong khung khi hết vùng, tiêu đề đứng yên, không nội dung nào bị mất", async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 360, height: 640 });
    await openScene(page);
    await scrollToP(page, rep(0.8));
    await settle(page, rep(0.8));
    const top = await heading(page).boundingBox();
    const early = await page.getByText("Dành cho người chăm sóc", { exact: true }).boundingBox();
    await scrollToP(page, 1);
    await settle(page, 1);
    await expectNoHorizontalOverflow(page);
    const topEnd = await heading(page).boundingBox();
    const lateBox = await page.getByText("Dành cho người chăm sóc", { exact: true }).boundingBox();
    // Tiêu đề không nhúc nhích; phần thân đã cuộn lên để lộ tóm tắt và dòng cuối.
    expect(Math.abs(topEnd!.y - top!.y)).toBeLessThan(0.5);
    expect(lateBox!.y).toBeLessThan(early!.y);
    await expect(page.getByText("Dành cho người chăm sóc", { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByText("Mô tả do AI tạo, chưa được con người xác nhận.", { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(sampleTag(page)).toBeInViewport({ ratio: 1 });
    // Cuộn ngược một chút: nội dung trượt về chỗ cũ (không nhảy).
    await scrollToP(page, rep(0.8));
    await settle(page, rep(0.8));
    const again = await page.getByText("Dành cho người chăm sóc", { exact: true }).boundingBox();
    expect(Math.abs(again!.y - early!.y)).toBeLessThan(0.5);
  });
});

test.describe("quan sát → bảo vệ → tổng quan: giảm chuyển động", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

  test("bảy ảnh tĩnh đổi bằng nút, không cuộn dính, không tự phát; bản báo cáo nằm trong luồng trang, hiện đủ", async ({ page }) => {
    test.setTimeout(240_000);
    await openScene(page);
    await expect(page.getByTestId("med-track")).toHaveAttribute("data-mode", "reduced");
    await page.waitForTimeout(1500);
    const ob = page.getByRole("group", { name: /Các bước quan sát hoạt động/ });
    const sc = page.getByRole("group", { name: /Các bước bảo vệ dữ liệu/ });
    await expect(ob.getByRole("button", { name: /Một hành động/ })).toHaveAttribute("aria-pressed", "true");
    const phases: string[] = [];
    for (const [group, name] of [
      [ob, /Một hành động/],
      [ob, /Camera quan sát/],
      [ob, /Thành gói dữ liệu/],
      [ob, /Gửi tới hub/],
      [sc, /Lên máy chủ đám mây/],
      [sc, /Tách thành các phần/],
      [sc, /Chỉ còn bản rút gọn/],
    ] as const) {
      await group.getByRole("button", { name }).click();
      await expect(group.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
      await expect
        .poll(async () => {
          const s = await med.state(page);
          return Math.abs(s.progress - s.target);
        }, { timeout: 20_000, message: JSON.stringify(await med.state(page)) })
        .toBeLessThan(1e-6);
      phases.push((await med.state(page)).phase);
    }
    expect(phases).toEqual(["hidden", "captured", "condensing", "arrived", "entering", "fragmenting", "digest"]);
    await page.getByTestId("med-stage").screenshot({ path: `${SHOT_DIR}/med-reduced.png` });
    // Báo cáo ngày: không phụ thuộc cảnh, nằm trong luồng bình thường (không định vị tuyệt đối), hiện đủ ngay.
    const report = page.getByTestId("daily-report");
    await expect(report).toBeVisible();
    await expect(headerOf(page)).toHaveCSS("opacity", "1");
    await expect(page.getByText("Mô tả do AI tạo, chưa được con người xác nhận.", { exact: true })).toHaveCSS("opacity", "1");
    expect(await report.evaluate((el) => getComputedStyle(el).position)).not.toBe("absolute");
    await expectNoHorizontalOverflow(page);
  });
});
