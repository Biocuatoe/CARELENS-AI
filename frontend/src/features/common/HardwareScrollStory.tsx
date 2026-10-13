import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "../../design-system/cn";
import { landingButtonClasses, type Tone } from "../../design-system/landing";
import {
  BEATS,
  HardwareScrollStory as StoryController,
  STAGES,
  isWebGLAvailable,
  type BeatConfig,
  type Layout,
  type StageConfig,
  type StoryFrameInfo,
  type StoryMode,
} from "../../lib/hardware3d";

declare global {
  interface Window {
    /** Chỉ có khi mở trang với `?debug=1`, phục vụ kiểm thử trình duyệt. */
    __hardwareStory?: {
      state: () => { progress: number; target: number; mode: StoryMode; ready: boolean; frames: number };
      positions: () => ReturnType<StoryController["renderedPositions"]>;
      expected: (p: number) => Record<string, [number, number, number]>;
      homes: () => Record<string, [number, number, number]>;
      sample: () => ReturnType<StoryController["viewer"]["sample"]>;
      bench: (n?: number, withGround?: boolean) => ReturnType<StoryController["viewer"]["bench"]>;
    };
  }
}

/** Độ dài vùng cuộn (đơn vị svh) theo chế độ. Svh ổn định khi thanh địa chỉ trên di động co giãn. */
const SCROLL_LENGTH_SVH: Record<StoryMode | "static", number> = { full: 760, lite: 520, reduced: 300, static: 0 };

/** Tiến trình cuộn mà chữ mở đầu bắt đầu mờ đi và mờ hẳn. */
const INTRO_FADE: readonly [number, number] = [0.012, 0.07];
/** Tiến trình cuộn mà tiêu đề giai đoạn bắt đầu hiện và hiện hẳn. */
const CHROME_FADE: readonly [number, number] = [0.05, 0.1];

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function useStoryEnvironment() {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const narrowViewport = useMedia("(max-width: 767px)");
  const portrait = useMedia("(orientation: portrait)");
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number });
  const weakDevice = (nav?.deviceMemory !== undefined && nav.deviceMemory <= 2) || (nav?.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2);
  const webgl = useSyncExternalStore(
    () => () => {},
    () => isWebGLAvailable(),
    () => true,
  );
  const mode: StoryMode = reduced ? "reduced" : narrowViewport || weakDevice ? "lite" : "full";
  const layout: Layout = narrowViewport || portrait ? "narrow" : "wide";
  return { mode, layout, webgl };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number, a: number, b: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface HardwareScrollStoryProps {
  /** Neo trang cho phần cảnh. */
  id?: string;
  /**
   * Nội dung mở đầu đặt trên khung cố định (chữ hero). Nhận `active` = còn nhìn thấy; khi false nên ngắt các điều khiển
   * (inert) vì chữ đã mờ đi, còn tiêu đề vẫn nằm trong cây truy cập.
   */
  intro?: (active: boolean) => ReactNode;
  /** Khung cố định bắt đầu dưới header cao `--landing-header-h` thay vì sát mép trên màn hình. */
  headerOffset?: boolean;
  /** Dòng gợi ý cuộn tiếp, hiện ở giai đoạn cuối khi trang còn nội dung phía sau. */
  outro?: string;
  /** Danh sách đầy đủ phía dưới cảnh (chỉ hiện khi giảm chuyển động hoặc không có WebGL). */
  staticList?: boolean;
}

export function HardwareScrollStory({ id, intro, outro, headerOffset = false, staticList = true }: HardwareScrollStoryProps) {
  const env = useStoryEnvironment();
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const lineRefs = useRef<Array<SVGLineElement | null>>([]);
  const storyRef = useRef<StoryController | null>(null);
  const envRef = useRef(env);
  // Giữ bản mới nhất của môi trường cho các callback bên ngoài vòng render (không ghi ref trong lúc render).
  useEffect(() => {
    envRef.current = env;
  }, [env]);

  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<{ kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string }>({ kind: "loading" });
  const [stage, setStage] = useState<{ stage: StageConfig; reverse: boolean }>({ stage: STAGES[0]!, reverse: false });
  const [activeBeat, setActiveBeat] = useState(-1);
  const [introActive, setIntroActive] = useState(true);
  const stageKey = useRef("");
  const beatKey = useRef(-1);
  const introKey = useRef(true);

  const staticMode = !env.webgl;
  const scrollLength = staticMode ? 0 : SCROLL_LENGTH_SVH[env.mode];

  /**
   * Tiến trình cuộn thật của vùng (0 → 1): đoạn đã cuộn qua điểm bắt đầu dính chia cho phần cuộn được.
   * Điểm bắt đầu dính là `top` của khung cố định (0, hoặc chiều cao header).
   */
  const readProgress = useCallback((): number => {
    const sec = sectionRef.current;
    const stageEl = stageRef.current;
    if (!sec || !stageEl) return 0;
    const rect = sec.getBoundingClientRect();
    const total = rect.height - stageEl.clientHeight;
    const stickyTop = parseFloat(getComputedStyle(stageEl).top) || 0;
    return total > 0 ? clamp01((stickyTop - rect.top) / total) : 0;
  }, []);

  /** Cập nhật giao diện từ mỗi khung hình: viết thẳng vào DOM, chỉ đặt state khi giai đoạn hoặc nhãn thật sự đổi. */
  const handleFrame = useCallback((info: StoryFrameInfo) => {
    const p = info.progress;
    if (barRef.current) barRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
    if (hintRef.current) hintRef.current.style.opacity = String(clamp01(1 - p / 0.04));
    const introO = 1 - smooth(p, INTRO_FADE[0], INTRO_FADE[1]);
    if (introRef.current) {
      introRef.current.style.opacity = introO.toFixed(3);
      introRef.current.style.transform = `translateY(${((1 - introO) * -18).toFixed(1)}px)`;
    }
    const active = introO > 0.35;
    if (active !== introKey.current) {
      introKey.current = active;
      setIntroActive(active);
    }
    if (chromeRef.current) chromeRef.current.style.opacity = smooth(p, CHROME_FADE[0], CHROME_FADE[1]).toFixed(3);
    const key = `${info.stage.id}:${info.reverse}`;
    if (key !== stageKey.current) {
      stageKey.current = key;
      setStage({ stage: info.stage, reverse: info.reverse });
    }
    const wide = envRef.current.layout === "wide" && envRef.current.mode === "full";
    const stageRect = wide ? stageRef.current?.getBoundingClientRect() : undefined;
    let best = -1;
    let bestOpacity = 0.05;
    for (let k = 0; k < BEATS.length; k++) {
      const o = envRef.current.mode === "reduced" ? 0 : info.beatOpacity[k]!;
      const card = cardRefs.current[k];
      if (card) {
        card.style.opacity = o.toFixed(3);
        card.style.visibility = o > 0.01 ? "visible" : "hidden";
        card.style.transform = `translateY(${((1 - o) * 14).toFixed(1)}px)`;
      }
      if (o > bestOpacity) {
        bestOpacity = o;
        best = k;
      }
      const line = lineRefs.current[k];
      if (line) {
        const a = info.anchors[k]!;
        if (wide && stageRect && card && a.visible && o > 0.05) {
          const cr = card.getBoundingClientRect();
          line.setAttribute("x1", (cr.left - stageRect.left).toFixed(1));
          line.setAttribute("y1", (cr.top - stageRect.top + cr.height / 2).toFixed(1));
          line.setAttribute("x2", a.x.toFixed(1));
          line.setAttribute("y2", a.y.toFixed(1));
          line.style.opacity = (o * 0.85).toFixed(3);
        } else {
          line.style.opacity = "0";
        }
      }
    }
    if (best !== beatKey.current) {
      beatKey.current = best;
      setActiveBeat(best);
    }
  }, []);

  // Tạo và huỷ cảnh. Chạy lại khi bật/tắt WebGL hoặc bấm "Thử lại".
  useEffect(() => {
    if (staticMode) return;
    const host = hostRef.current;
    const section = sectionRef.current;
    const stageEl = stageRef.current;
    if (!host || !section || !stageEl) return;
    let cancelled = false;
    const story = new StoryController(host, { mode: envRef.current.mode, layout: envRef.current.layout, onFrame: handleFrame });
    storyRef.current = story;
    // Đặt đích theo vị trí cuộn trước khi tải: khung hình đầu tiên đã đúng, tải lại ở bất kỳ vị trí cuộn nào cũng không nhảy.
    story.setTargetProgress(readProgress());
    story.load().then(
      (assembly) => {
        if (cancelled) return;
        setLoad({ kind: "ready" });
        story.setTargetProgress(readProgress());
        story.resize();
        if (new URLSearchParams(window.location.search).has("debug")) {
          const toObj = (r: Record<string, { x: number; y: number; z: number }>) =>
            Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [v.x, v.y, v.z]])) as Record<string, [number, number, number]>;
          window.__hardwareStory = {
            state: () => ({ progress: story.progress, target: story.targetProgress, mode: story.currentMode, ready: story.ready, frames: story.framesRendered }),
            positions: () => story.renderedPositions(),
            expected: (p) => toObj(assembly.timeline.evaluate(p, envRef.current.layout).positions),
            homes: () => toObj(assembly.timeline.homes),
            sample: () => story.viewer.sample(),
            bench: (n?: number, withGround?: boolean) => story.viewer.bench(n, withGround),
          };
        }
      },
      (e: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      },
    );

    // Vùng chữ giới thiệu chiếm: camera đặt thiết bị vào phần còn lại của khung ở khung hero.
    const measureInset = () => {
      const block = introRef.current?.querySelector<HTMLElement>("[data-intro-block]");
      const host = hostRef.current;
      if (!block || !host) return story.setHeroInset(null);
      const b = block.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      const gap = 16;
      if (envRef.current.layout === "wide") story.setHeroInset({ left: Math.max(0, b.right - h.left + gap), right: 0, top: 0, bottom: 0 });
      else story.setHeroInset({ left: 0, right: 0, top: Math.max(0, b.bottom - h.top + gap), bottom: 0 });
    };
    measureInset();
    const onScroll = () => story.setTargetProgress(readProgress());
    const onSize = () => {
      measureInset();
      story.resize();
      story.setTargetProgress(readProgress());
    };
    const onInput = () => story.markInteracted();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onSize);
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) window.addEventListener(type, onInput, { passive: true, once: true });
    const io = new IntersectionObserver(([entry]) => story.setActive(entry?.isIntersecting ?? true), { rootMargin: "120px" });
    io.observe(section);
    const ro = new ResizeObserver(onSize);
    ro.observe(stageEl);
    return () => {
      cancelled = true;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onSize);
      for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) window.removeEventListener(type, onInput);
      io.disconnect();
      ro.disconnect();
      delete window.__hardwareStory;
      story.dispose();
      storyRef.current = null;
    };
  }, [staticMode, attempt, handleFrame, readProgress]);

  // Đổi chế độ (giảm chuyển động, kích thước màn hình) khi đang xem: áp dụng ngay và đo lại tiến trình sau khi bố cục mới được dựng.
  useEffect(() => {
    const story = storyRef.current;
    if (!story) return;
    story.setMode(env.mode, env.layout);
    const id = requestAnimationFrame(() => {
      const block = introRef.current?.querySelector<HTMLElement>("[data-intro-block]");
      const host = hostRef.current;
      if (block && host) {
        const b = block.getBoundingClientRect();
        const h = host.getBoundingClientRect();
        story.setHeroInset(env.layout === "wide" ? { left: Math.max(0, b.right - h.left + 16), right: 0, top: 0, bottom: 0 } : { left: 0, right: 0, top: Math.max(0, b.bottom - h.top + 16), bottom: 0 });
      }
      story.setTargetProgress(readProgress());
      story.resize();
    });
    return () => cancelAnimationFrame(id);
  }, [env.mode, env.layout, readProgress]);

  const stageTitle = stage.reverse && (stage.stage.id === "open" || stage.stage.id === "explode") ? stage.stage.reverseTitle : stage.stage.title;
  const stageIndex = STAGES.findIndex((s) => s.id === stage.stage.id) + 1;
  const beat: BeatConfig | undefined = activeBeat >= 0 ? BEATS[activeBeat] : undefined;
  const narrow = env.layout === "narrow";
  const showList = staticList && (env.mode === "reduced" || staticMode);

  return (
    <>
      <section
        ref={sectionRef}
        id={id}
        aria-labelledby="story-title"
        data-testid="hardware-story"
        data-mode={staticMode ? "static" : env.mode}
        data-layout={env.layout}
        data-stage={stage.stage.id}
        data-tone="dark"
        className="relative bg-midnight text-ivory"
        style={staticMode ? undefined : { height: `${scrollLength}svh` }}
      >
        <div
          ref={stageRef}
          className={cn(
            "w-full overflow-hidden bg-midnight",
            staticMode ? "relative min-h-svh" : "sticky",
            !staticMode && (headerOffset ? "top-(--landing-header-h) h-[calc(100svh-var(--landing-header-h))]" : "top-0 h-svh"),
          )}
        >
          {/* Ánh sáng nền: một vầng sáng dịu sau thiết bị, không phải hiệu ứng. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_65%_at_50%_52%,var(--color-graphite)_0%,var(--color-midnight)_72%)] opacity-90"
          />
          <h2 id="story-title" className="sr-only">
            Bên trong thiết bị CareLens: mở nắp và tách từng linh kiện
          </h2>

          <div ref={hostRef} className={cn("absolute inset-0", staticMode && "hidden")} data-state={staticMode ? "static" : load.kind} />

          {!staticMode && load.kind === "loading" ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-[18%] flex flex-col items-center gap-3" role="status">
              <span aria-hidden className="h-px w-24 animate-pulse bg-signal" />
              <p className="font-mono text-xs tracking-[0.16em] text-ivory/75 uppercase">Đang dựng mô hình…</p>
            </div>
          ) : null}
          {load.kind === "error" ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
              <div role="alert" className="flex max-w-md flex-col items-start gap-4 rounded-2xl border border-ivory/15 bg-graphite p-6">
                <p className="font-display text-lg font-bold">Không tải được mô hình 3D</p>
                <p className="text-sm text-ivory/80">{load.message}</p>
                <button
                  type="button"
                  className={landingButtonClasses({ tone: "dark" })}
                  onClick={() => {
                    setLoad({ kind: "loading" });
                    setAttempt((n) => n + 1);
                  }}
                >
                  Thử lại
                </button>
              </div>
            </div>
          ) : null}

          {/* Chữ mở đầu (hero): mờ dần khi bắt đầu cuộn. Vùng bao không bắt con trỏ; điều khiển bên trong tự bật lại. */}
          {intro ? (
            <div ref={introRef} className="pointer-events-none absolute inset-0 z-10">
              {intro(staticMode || introActive)}
            </div>
          ) : null}

          {staticMode ? (
            <div className="relative mx-auto max-w-3xl p-6">
              <p role="status" className="rounded-2xl border border-ivory/15 bg-graphite p-5 text-sm text-ivory/85">
                Trình duyệt này không dùng được WebGL nên không dựng được cảnh 3D. Danh sách linh kiện nằm ngay bên dưới.
              </p>
            </div>
          ) : null}

          {!staticMode ? (
            <>
              {/* Giai đoạn hiện tại và tiến trình. Hiện sau khi chữ mở đầu mờ đi. */}
              <div ref={chromeRef} className="pointer-events-none absolute top-4 left-4 right-4 flex items-start justify-between gap-4 md:top-6 md:left-8 md:right-8" style={{ opacity: intro ? 0 : 1 }}>
                <div className="flex min-w-0 max-w-[20rem] flex-col gap-1.5 rounded-xl bg-midnight/80 px-3 py-2">
                  <p className="font-mono text-[11px] font-medium tracking-[0.16em] text-signal uppercase">
                    <span aria-hidden>
                      {String(stageIndex).padStart(2, "0")}/{String(STAGES.length).padStart(2, "0")} ·{" "}
                    </span>
                    <span data-testid="stage-title">{stageTitle}</span>
                  </p>
                  <div className="h-px w-40 bg-ivory/20" aria-hidden>
                    <div ref={barRef} className="h-px origin-left bg-signal" style={{ transform: "scaleX(0)" }} />
                  </div>
                </div>
              </div>

              {outro && stage.stage.id === "overview" ? (
                <p className="pointer-events-none absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5 text-center font-mono text-[11px] tracking-[0.16em] whitespace-nowrap text-ivory/80 uppercase">
                  {outro}
                  <span aria-hidden className="block h-5 w-px bg-signal" />
                </p>
              ) : null}

              {!intro ? (
                <p ref={hintRef} className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 text-sm font-medium text-ivory/80">
                  Cuộn xuống để mở thiết bị
                </p>
              ) : null}

              {/* Đường nối nhãn tới linh kiện (chỉ màn rộng). */}
              <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
                {BEATS.map((b, k) => (
                  <line
                    key={b.id}
                    ref={(el) => {
                      lineRefs.current[k] = el;
                    }}
                    stroke="var(--color-signal)"
                    strokeWidth={1.25}
                    strokeDasharray="3 5"
                    style={{ opacity: 0 }}
                  />
                ))}
              </svg>

              {/* Nhãn: màn rộng ở bên phải, màn hẹp dán dưới đáy. Không bắt sự kiện con trỏ. */}
              <div
                className={cn(
                  "pointer-events-none absolute",
                  narrow ? "inset-x-3 bottom-4" : "top-1/2 right-[4%] w-[min(23rem,34%)] -translate-y-1/2",
                )}
              >
                <div className="relative">
                  {BEATS.map((b, k) => (
                    <div
                      key={b.id}
                      ref={(el) => {
                        cardRefs.current[k] = el;
                      }}
                      data-testid={`label-${b.id}`}
                      aria-hidden={activeBeat !== k}
                      className={cn("absolute inset-x-0 transition-none", narrow ? "bottom-0" : "top-1/2 -translate-y-1/2")}
                      style={{ opacity: 0, visibility: "hidden" }}
                    >
                      <LabelCard beat={b} index={k} compact={narrow} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Thông báo cho trình đọc màn hình khi nhịp đổi. */}
              <p className="sr-only" role="status" aria-live="polite">
                {beat ? `${beat.title}. ${beat.text}` : ""}
              </p>
            </>
          ) : null}
        </div>
      </section>

      {/* Danh sách đầy đủ: hiện rõ khi giảm chuyển động hoặc không có WebGL, chỉ dành cho trình đọc màn hình ở chế độ cuộn. */}
      {staticList ? (
        <div id="sau-mo-phong" data-tone="light" className={cn("w-full bg-ivory text-ink", showList ? "py-12" : "sr-only")}>
          <div className="mx-auto w-full max-w-7xl px-4 md:px-6">
            <h3 className="mb-6 font-display text-2xl font-bold">Các linh kiện bên trong</h3>
            <ul className="grid gap-6 md:grid-cols-2" data-testid="static-labels">
              {BEATS.map((b, k) => (
                <li key={b.id}>
                  <LabelCard beat={b} index={k} tone="light" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}

function LabelCard({ beat, index, compact = false, tone = "dark" }: { beat: BeatConfig; index: number; compact?: boolean; tone?: Tone }) {
  const dark = tone === "dark";
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-2xl border",
        compact ? "p-4" : "p-5",
        dark ? "border-ivory/12 bg-graphite text-ivory shadow-stage-card" : "border-ink/12 bg-paper text-ink shadow-soft-paper",
      )}
    >
      <span className={cn("font-mono text-[11px] font-medium tracking-[0.16em]", dark ? "text-signal" : "text-teal-deep")} aria-hidden>
        {String(index + 1).padStart(2, "0")}
      </span>
      <h4 className="font-display text-lg leading-snug font-bold">{beat.title}</h4>
      <p className={cn(compact ? "text-sm" : "text-[0.95rem]", dark ? "text-ivory/85" : "text-ink/85")}>{beat.text}</p>
    </div>
  );
}
