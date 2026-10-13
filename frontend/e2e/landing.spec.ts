import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

const SHOT_DIR = "test-results/screens";
const STORY = '[data-testid="hardware-story"]';

interface StoryDebug {
  state(): { progress: number; target: number; mode: string; ready: boolean; frames: number };
  sample(): { coverage: number; distinctColors: number };
}
const api = {
  state: (page: Page) => page.evaluate(() => (window as unknown as { __hardwareStory: StoryDebug }).__hardwareStory.state()),
  sample: (page: Page) => page.evaluate(() => (window as unknown as { __hardwareStory: StoryDebug }).__hardwareStory.sample()),
};

async function openLanding(page: Page) {
  await page.goto("/?debug=1");
  await expect(page.locator(`${STORY} [data-state]`)).toHaveAttribute("data-state", "ready", { timeout: 40_000 });
  await expect.poll(async () => (await api.state(page)).ready).toBe(true);
}

/** Tiến trình cuộn thật của cảnh (cùng công thức của giao diện, có tính điểm bắt đầu dính dưới header). */
const storyProgress = (page: Page) =>
  page.evaluate((sel) => {
    const sec = document.querySelector(sel) as HTMLElement;
    const stage = sec.firstElementChild as HTMLElement;
    const total = sec.offsetHeight - stage.clientHeight;
    const top = parseFloat(getComputedStyle(stage).top) || 0;
    return total > 0 ? Math.min(1, Math.max(0, (top - sec.getBoundingClientRect().top) / total)) : 0;
  }, STORY);

const scrollToStoryProgress = (page: Page, p: number) =>
  page.evaluate(
    ([sel, p]) => {
      const sec = document.querySelector(sel as string) as HTMLElement;
      const stage = sec.firstElementChild as HTMLElement;
      const total = sec.offsetHeight - stage.clientHeight;
      const top = parseFloat(getComputedStyle(stage).top) || 0;
      window.scrollTo({ top: window.scrollY + sec.getBoundingClientRect().top + (p as number) * total - top, behavior: "instant" });
    },
    [STORY, p] as const,
  );

async function settle(page: Page) {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 80 && stable < 3; i++) {
    const { frames } = await api.state(page);
    stable = frames === last ? stable + 1 : 0;
    last = frames;
    await page.waitForTimeout(70);
  }
  expect(stable, "vòng vẽ phải dừng khi trang đứng yên").toBeGreaterThanOrEqual(3);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("Too many active WebGL contexts")) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test.describe("landing: máy tính", () => {
  test("hero: thiết bị 3D là trung tâm, chữ rõ ràng, khẩu hiệu đúng, không lỗi", async ({ page }) => {
    const errors = collectErrors(page);
    await openLanding(page);
    await expect(page.getByRole("heading", { level: 1, name: /nhìn thấy nhiều hơn/ })).toBeVisible();
    await expect(page.getByText("SEE MORE. STORE LESS. CARE BETTER.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Mở thiết bị ra xem" })).toBeVisible();

    // Thiết bị chiếm phần đáng kể của khung hình, không phải vật trang trí nhỏ.
    const s = await api.sample(page);
    expect(s.coverage).toBeGreaterThan(0.12);
    expect(s.distinctColors).toBeGreaterThan(5);

    // Khung 3D nằm ngay dưới header và đủ cao để thấy cả thiết bị.
    const box = await page.locator(`${STORY} canvas`).boundingBox();
    expect(box!.width).toBeGreaterThan(1000);
    expect(box!.height).toBeGreaterThan(700);
    await page.screenshot({ path: `${SHOT_DIR}/landing-hero-1440.png` });
    expect(errors).toEqual([]);
  });

  test("cuộn khỏi hero: chữ mờ đi và ngắt điều khiển, thiết bị mở nắp, cuộn ngược trả lại hero", async ({ page }) => {
    await openLanding(page);
    await page.mouse.move(900, 450);
    await page.mouse.wheel(0, 1);
    const cta = page.getByRole("button", { name: "Mở thiết bị ra xem" });
    await expect(cta).toBeEnabled();

    await scrollToStoryProgress(page, 0.3);
    await settle(page);
    await expect(page.locator(STORY)).toHaveAttribute("data-stage", "explode");
    // Chữ đã mờ; nút bị ngắt (không focus được) nhưng tiêu đề vẫn nằm trong cây truy cập.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(cta).toHaveCount(0);
    const introOpacity = await page.locator(`${STORY} h1`).evaluate((el) => parseFloat(getComputedStyle(el.closest("[class*='pointer-events-none']") as HTMLElement).opacity));
    expect(introOpacity).toBeLessThan(0.05);

    await scrollToStoryProgress(page, 0);
    await settle(page);
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
    const s = await api.sample(page);
    expect(s.coverage).toBeGreaterThan(0.12);
  });

  test("'Mở thiết bị ra xem' cuộn tới đoạn mở nắp", async ({ page }) => {
    await openLanding(page);
    await page.getByRole("button", { name: "Mở thiết bị ra xem" }).click();
    await expect.poll(() => storyProgress(page), { timeout: 8000 }).toBeGreaterThan(0.12);
    await settle(page);
    await expect(page.locator(STORY)).toHaveAttribute("data-stage", /open|explode/);
  });

  test("cuộn liền mạch từ cảnh 3D xuống các phần sau, không bị kẹt, rồi cuộn ngược về đầu trang", async ({ page }) => {
    await openLanding(page);
    await page.mouse.move(900, 450);
    let last = -1;
    const seen = new Set<string>();
    const heading = page.getByRole("heading", { level: 2, name: /tư thế thay đổi đột ngột/ });
    for (let i = 0; i < 120; i++) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(25);
      const y = await page.evaluate(() => window.scrollY);
      expect(y, "cuộn không được lùi khi đang cuộn xuống").toBeGreaterThanOrEqual(last);
      last = y;
      seen.add((await page.locator(STORY).getAttribute("data-stage")) ?? "");
      if (await heading.evaluate((el) => el.getBoundingClientRect().top < window.innerHeight * 0.5)) break;
    }
    expect([...seen]).toEqual(expect.arrayContaining(["assembled", "open", "explode", "explore", "overview"]));
    await expect(heading).toBeInViewport({ timeout: 8000 });
    await page.keyboard.press("End");
    await settle(page);
    await expect(page.getByRole("contentinfo")).toBeInViewport();
    await page.keyboard.press("Home");
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 8000 }).toBe(0);
  });

  test("điều hướng: mọi mục đưa tới đúng phần, dưới header", async ({ page }) => {
    await openLanding(page);
    const header = await page.getByRole("banner").boundingBox();
    const targets: Array<[string, string, RegExp]> = [
      ["Tình huống", "tinh-huong", /tư thế thay đổi đột ngột/],
      ["Riêng tư", "rieng-tu", /Thấy đủ để chăm sóc/],
      ["Đội ngũ", "doi-ngu", /Đội ngũ của chúng tôi/],
    ];
    for (const [label, id, heading] of targets) {
      await page.getByRole("banner").getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      const h = page.getByRole("heading", { level: 2, name: heading });
      await expect(h).toBeInViewport();
      await expect.poll(async () => (await h.boundingBox())!.y).toBeGreaterThanOrEqual(header!.height - 2);
    }
    await page.getByRole("banner").getByRole("link", { name: "Liên hệ", exact: true }).click();
    await expect(page).toHaveURL(/#lien-he$/);
    await expect(page.getByRole("heading", { name: "Liên hệ với chúng tôi" })).toBeInViewport();
  });

  test("bàn phím: liên kết bỏ qua điều hướng, thứ tự Tab hợp lý, mọi điều khiển có vòng focus nhìn thấy", async ({ page }) => {
    await openLanding(page);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Bỏ qua điều hướng" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#noi-dung")).toBeFocused();

    const visited: string[] = [];
    await page.locator("body").focus();
    // Đi qua mọi điểm dừng Tab của trang cho tới khi focus rời khỏi tài liệu (về `body`): các nút bước của cảnh 3D (7), thanh trượt, liên kết,
    // header và chân trang đều được kiểm vòng focus. Không đặt số lần cố định vì số điều khiển của trang thay đổi khi trang có thêm nội dung;
    // giới hạn 60 chỉ để chặn vòng lặp vô hạn.
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40), outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth), leftPage: el === document.body };
      });
      expect(info).not.toBeNull();
      if (info!.leftPage) break;
      visited.push(info!.name);
      expect(info!.outline, `focus ring của ${info!.name}`).not.toBe("none");
      expect(info!.width).toBeGreaterThanOrEqual(2);
    }
    // Phải đi qua nhiều điều khiển thật (không thoát sớm vì lý do khác).
    expect(visited.length).toBeGreaterThan(14);
    expect(visited).toEqual(expect.arrayContaining(["Thiết bị", "Tình huống", "Đăng nhập", "Liên hệ"]));
  });

  test("hai bản minh hoạ chạy được bằng bàn phím: tình huống an toàn và ví dụ một ngày dùng thuốc", async ({ page }) => {
    await openLanding(page);
    await page.evaluate(() => document.getElementById("tinh-huong")!.scrollIntoView({ behavior: "instant" }));
    const group = page.getByRole("group", { name: /Ví dụ tình huống/ });
    await group.getByRole("button", { name: /Gửi mô tả/ }).click();
    // Chọn bước cuộn tới bước đó; thẻ thông báo chỉ thao tác được khi đã hiện hẳn.
    await expect(group.getByRole("button", { name: /Gửi mô tả/ })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await expect(page.getByTestId("fall-notification")).not.toHaveAttribute("inert", { timeout: 15_000 });
    const ack = page.getByRole("button", { name: "Tiếp nhận kiểm tra" });
    await ack.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Đã tiếp nhận · Chưa có kết quả kiểm tra")).toBeVisible();
    await group.getByRole("button", { name: /Bình thường/ }).click();
    await expect(page.getByText("Đã tiếp nhận · Chưa có kết quả kiểm tra")).toHaveCount(0, { timeout: 15_000 });

    const slider = page.getByRole("slider", { name: "Giờ trong ngày" });
    await slider.scrollIntoViewIfNeeded();
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuetext", "06:00");
    for (let i = 0; i < 110; i++) await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuetext", "15:10");
    await expect(page.getByText("Chưa ghi nhận quan sát").first()).toBeVisible();
    await expect(page.getByText("Không quan sát được không có nghĩa là chưa uống thuốc.")).toBeVisible();
  });

  test("hero hiện ngay khi chunk 3D còn đang tải chậm, rồi cảnh thay vào đúng chỗ", async ({ page }) => {
    await page.route("**/assets/hardware3d-*.js", async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.goto("/?debug=1");
    await expect(page.getByRole("heading", { level: 1, name: /nhìn thấy nhiều hơn/ })).toBeVisible({ timeout: 2000 });
    await expect(page.getByText("SEE MORE. STORE LESS. CARE BETTER.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Mở thiết bị ra xem" })).toBeEnabled();
    await expect(page.locator(`${STORY} [data-state]`)).toHaveAttribute("data-state", "ready", { timeout: 40_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("không có WebGL: hero và toàn bộ nội dung vẫn dùng được, có thông báo rõ", async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /nhìn thấy nhiều hơn/ })).toBeVisible();
    await expect(page.getByText(/không dùng được WebGL/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Các linh kiện bên trong" })).toBeVisible();
    await expect(page.getByTestId("static-labels").getByRole("heading", { level: 4 })).toHaveCount(8);
    await expect(page.locator("#linh-kien")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `${SHOT_DIR}/landing-no-webgl.png` });
  });

  test("không tràn ngang ở 360–1440px; chụp toàn trang để duyệt", async ({ page }) => {
    test.setTimeout(180_000);
    await openLanding(page);
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      await expectNoHorizontalOverflow(page);
      await expect(page.getByRole("banner").getByRole("button", { name: "Mở menu" }).or(page.getByRole("banner").getByRole("link", { name: "Tình huống", exact: true }))).toBeVisible();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    // Cuộn hết trang một lượt để mọi phần "hiện dần" được dựng trước khi chụp.
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += 700) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y);
      await page.waitForTimeout(40);
    }
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("landing: điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("menu mở/đóng, đóng khi chọn mục và khi nhấn Esc; nút chính nằm ngoài menu", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Mở menu" });
    await toggle.click();
    await expect(page.getByRole("button", { name: "Đóng menu" })).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: `${SHOT_DIR}/landing-menu-390.png` });
    await page.getByRole("banner").getByRole("link", { name: "Đội ngũ", exact: true }).click();
    await expect(page).toHaveURL(/#doi-ngu$/);
    await expect(page.getByRole("button", { name: "Mở menu" })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Mở menu" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Mở menu" })).toBeFocused();
  });

  test("hero dọc: chữ ở trên, thiết bị lớn ở dưới, không tràn ngang; vuốt qua canvas vẫn cuộn trang", async ({ page }) => {
    const errors = collectErrors(page);
    await openLanding(page);
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
    expect(h1!.y + h1!.height).toBeLessThan(300);
    const s = await api.sample(page);
    expect(s.coverage, "thiết bị phải đủ lớn trên màn hình điện thoại").toBeGreaterThan(0.12);
    await page.screenshot({ path: `${SHOT_DIR}/landing-hero-390.png` });

    const client = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchMove" | "touchEnd", y: number) =>
      client.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }] });
    const before = await page.evaluate(() => window.scrollY);
    await send("touchStart", 650);
    for (let y = 650; y >= 250; y -= 25) {
      await send("touchMove", y);
      await page.waitForTimeout(8);
    }
    await send("touchEnd", 250);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 150);
    await expect.poll(() => storyProgress(page)).toBeGreaterThan(0.02);
    expect(errors).toEqual([]);
  });

  test("touch target tối thiểu 44px", async ({ page }) => {
    await openLanding(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const small = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("a, button, summary, input"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.closest("[hidden]") || el.closest("[inert]") || el.classList.contains("sr-only") || el.closest(".sr-only")) continue;
        if (r.height < 43.5 || r.width < 43.5) bad.push(`${el.tagName} ${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return bad;
    });
    expect(small).toEqual([]);
  });

  test("các phần sau cảnh 3D không tràn ngang và chữ không bị cắt", async ({ page }) => {
    await page.goto("/");
    for (const id of ["tinh-huong", "rieng-tu", "doi-ngu", "lien-he"]) {
      await page.evaluate((id) => document.getElementById(id)!.scrollIntoView({ behavior: "instant" }), id);
      await page.waitForTimeout(150);
      await expectNoHorizontalOverflow(page);
      const clipped = await page.evaluate((id) => {
        const sec = document.getElementById(id)!;
        // Bỏ qua chữ chỉ dành cho trình đọc màn hình (sr-only: khung 1 px, cố ý ẩn khỏi mắt).
        return Array.from(sec.querySelectorAll<HTMLElement>("h2, h3, p, li, button, a")).filter((el) => el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible").map((el) => el.textContent?.slice(0, 30));
      }, id);
      expect(clipped, id).toEqual([]);
    }
  });
});

test.describe("landing: giảm chuyển động", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

  test("ba ảnh tĩnh, mũi tên cuộn và tự phát bị tắt, nội dung hiện đủ", async ({ page }) => {
    await page.goto("/?debug=1");
    await expect(page.locator(`${STORY} [data-state]`)).toHaveAttribute("data-state", "ready", { timeout: 40_000 });
    await expect(page.locator(STORY)).toHaveAttribute("data-mode", "reduced");
    const cue = await page.locator(".animate-cue").first().evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(cue).toBeLessThan(0.1);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");

    // Tình huống an toàn không tự phát: vẫn ở bước 1 sau khi cuộn tới.
    await page.evaluate(() => document.getElementById("tinh-huong")!.scrollIntoView({ behavior: "instant" }));
    await page.waitForTimeout(2500 * 2);
    await expect(page.getByRole("group", { name: /Ví dụ tình huống/ }).getByRole("button", { name: /Bình thường/ })).toHaveAttribute("aria-pressed", "true");
    // Các khối "hiện dần" luôn hiện.
    const hidden = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("[data-reveal='hidden']")).filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.99).length);
    expect(hidden).toBe(0);

    // Danh sách linh kiện thay thế hiện ngay sau cảnh (không còn phần liệt kê riêng bên dưới).
    await expect(page.getByTestId("static-labels")).toBeVisible();
    await expect(page.getByTestId("static-labels").getByRole("heading", { level: 4 })).toHaveCount(8);
    await expect(page.locator("#linh-kien")).toHaveCount(0);

    // Nút "Mở thiết bị ra xem" nhảy thẳng tới ảnh tĩnh mở nắp.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("button", { name: "Mở thiết bị ra xem" }).click();
    await expect.poll(() => storyProgress(page)).toBeGreaterThan(0.2);
    await expect(page.locator(STORY)).toHaveAttribute("data-stage", /open|explode/);
    await page.screenshot({ path: `${SHOT_DIR}/landing-reduced-motion.png` });
  });
});
