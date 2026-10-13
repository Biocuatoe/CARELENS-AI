import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "../../design-system/cn";
import { CapabilityTag, Eyebrow, landingButtonClasses } from "../../design-system/landing";
import { FALL_STEPS, stepAt, type FallStepIndex } from "../../lib/careScene/steps";
import { FALL, SECTION_IDS } from "./content";
import { clamp01, useSceneEnvironment, type SceneMode } from "./sceneEnvironment";

// Kiểu của cảnh 3D, chỉ dùng cho kiểu: module thật (three.js) được tải lười khi cần.
type CareSceneModule = typeof import("../../lib/careScene");
type FallScene = InstanceType<CareSceneModule["FallScene"]>;
type SceneFrame = Parameters<NonNullable<ConstructorParameters<CareSceneModule["FallScene"]>[1]["onFrame"]>>[0];

declare global {
  interface Window {
    /** Chỉ có khi mở trang với `?debug=1`, phục vụ kiểm thử trình duyệt. */
    __fallScene?: {
      state: () => { progress: number; target: number; ready: boolean; frames: number; step: number };
      sample: () => ReturnType<FallScene["sample"]>;
      figure: () => number[];
      view: () => ReturnType<FallScene["viewState"]>;
    };
  }
}

/** Độ dài vùng cuộn (svh) khi cảnh chạy theo cuộn. */
const SCROLL_SVH: Record<Exclude<SceneMode, "reduced">, number> = { full: 340, lite: 280 };

/**
 * Tình huống 01 (khái niệm): cảnh 3D chạy theo cuộn. Người lớn tuổi mất thăng bằng và ngã; thiết bị trên ngực ghi nhận thay đổi; khung lùi ra
 * và một thông báo văn bản xuất hiện. Cuộn ngược tua lại chính xác (mọi thứ là hàm của tiến trình cuộn).
 * Giảm chuyển động: ba ảnh tĩnh, chọn bằng nút, không tự phát. Không có WebGL: chỉ còn các bước và thông báo dạng chữ.
 */
export function FallSection() {
  const env = useSceneEnvironment();
  const scrollDriven = env.webgl && env.mode !== "reduced";
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FallScene | null>(null);
  const envRef = useRef(env);
  useEffect(() => {
    envRef.current = env;
  }, [env]);

  const [step, setStep] = useState<FallStepIndex>(0);
  const [cardActive, setCardActive] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [sceneState, setSceneState] = useState<"loading" | "ready" | "error">("loading");
  const stepKey = useRef<FallStepIndex>(0);
  const cardKey = useRef(false);

  const applyStep = useCallback((s: FallStepIndex) => {
    if (s === stepKey.current) return;
    stepKey.current = s;
    setStep(s);
    if (s !== 2) setAcknowledged(false);
  }, []);
  const applyCard = useCallback((active: boolean) => {
    if (active === cardKey.current) return;
    cardKey.current = active;
    setCardActive(active);
  }, []);

  /** Tiến trình cuộn thật của vùng dính (0 → 1). */
  const readProgress = useCallback((): number => {
    const track = trackRef.current;
    const stage = stageRef.current;
    if (!track || !stage) return 0;
    const rect = track.getBoundingClientRect();
    const total = rect.height - stage.clientHeight;
    const stickyTop = parseFloat(getComputedStyle(stage).top) || 0;
    return total > 0 ? clamp01((stickyTop - rect.top) / total) : 0;
  }, []);

  /** Đồng bộ lớp giao diện với khung hình: ghi thẳng vào DOM, chỉ đặt state khi bước hoặc thẻ đổi. */
  const handleFrame = useCallback(
    (f: Pick<SceneFrame, "progress" | "step" | "card" | "vignette">) => {
      if (barRef.current) barRef.current.style.transform = `scaleX(${f.progress.toFixed(4)})`;
      if (vignetteRef.current) vignetteRef.current.style.opacity = f.vignette.toFixed(3);
      const card = cardRef.current;
      if (card) {
        card.style.opacity = f.card.toFixed(3);
        card.style.transform = `translateY(${((1 - f.card) * 18).toFixed(1)}px)`;
      }
      applyStep(f.step);
      applyCard(f.card > 0.6);
    },
    [applyStep, applyCard],
  );

  // Chưa có cảnh (đang tải hoặc lỗi) mà vẫn cuộn: giao diện bám theo cuộn bằng các mốc giống hệt cảnh.
  useEffect(() => {
    if (!scrollDriven || sceneState === "ready") return;
    const onScroll = () => {
      const p = readProgress();
      const s = stepAt(p);
      handleFrame({ progress: p, step: s, card: s === 2 ? 1 : 0, vignette: 0 });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [scrollDriven, sceneState, readProgress, handleFrame]);

  // Tạo và huỷ cảnh 3D (mọi chế độ có WebGL, kể cả giảm chuyển động).
  useEffect(() => {
    if (!env.webgl) return;
    const host = hostRef.current;
    const track = trackRef.current;
    if (!host || !track) return;
    let cancelled = false;
    let scene: FallScene | null = null;
    let cleanup: (() => void) | null = null;
    import("../../lib/careScene").then(
      ({ FallScene }) => {
        if (cancelled) return;
        const live = envRef.current;
        scene = new FallScene(host, { mode: live.mode, layout: live.layout, onFrame: handleFrame });
        sceneRef.current = scene;
        const s = scene;
        s.setTargetProgress(live.mode === "reduced" ? FALL_STEPS[stepKey.current].rest : readProgress());
        s.load().then(
          () => {
            if (cancelled) return;
            setSceneState("ready");
            if (new URLSearchParams(window.location.search).has("debug")) {
              window.__fallScene = {
                state: () => ({ progress: s.progress, target: s.targetProgress, ready: s.ready, frames: s.framesRendered, step: stepKey.current }),
                sample: () => s.sample(),
                figure: () => s.figureState(),
                view: () => s.viewState(),
              };
            }
          },
          () => {
            if (!cancelled) setSceneState("error");
          },
        );
        // Vùng giao diện chiếm trên khung: thẻ thông báo (phải ở màn rộng, đáy ở màn hẹp) và bảng bước (trên cùng ở màn hẹp).
        const measure = () => {
          const stageEl = stageRef.current;
          const cardEl = cardRef.current;
          const panelEl = panelRef.current;
          if (!stageEl || !cardEl || !panelEl) return;
          const st = stageEl.getBoundingClientRect();
          // offset* không tính transform (thẻ đang trượt vào), nên số đo ổn định trong lúc cuộn.
          const narrow = envRef.current.layout === "narrow";
          s.setInsets({
            cardRight: narrow ? 0 : st.width - cardEl.offsetLeft + 16,
            cardBottom: narrow ? st.height - cardEl.offsetTop + 12 : 0,
            panelTop: narrow ? panelEl.offsetTop + panelEl.offsetHeight + 8 : 0,
          });
        };
        measure();
        const ro = new ResizeObserver(measure);
        if (stageRef.current) ro.observe(stageRef.current);
        if (cardRef.current) ro.observe(cardRef.current);
        if (panelRef.current) ro.observe(panelRef.current);
        const onScroll = () => {
          if (envRef.current.mode !== "reduced") s.setTargetProgress(readProgress());
        };
        const onInput = () => s.markInteracted();
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) window.addEventListener(type, onInput, { passive: true, once: true });
        // Một lần gọi có thể gom nhiều mục (ví dụ trang nhảy xa rồi quay lại): mục cuối mới là trạng thái hiện tại.
        const io = new IntersectionObserver((entries) => s.setActive(entries[entries.length - 1]?.isIntersecting ?? true), { rootMargin: "160px" });
        io.observe(track);
        cleanup = () => {
          window.removeEventListener("scroll", onScroll);
          window.removeEventListener("resize", onScroll);
          for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) window.removeEventListener(type, onInput);
          io.disconnect();
          ro.disconnect();
        };
      },
      () => {
        if (!cancelled) setSceneState("error");
      },
    );
    return () => {
      cancelled = true;
      cleanup?.();
      delete window.__fallScene;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [env.webgl, handleFrame, readProgress]);

  // Đổi chế độ hoặc bố cục khi đang xem: áp dụng ngay, đo lại tiến trình sau khi bố cục mới đã dựng.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setMode(env.mode, env.layout);
    const id = requestAnimationFrame(() => {
      scene.setTargetProgress(env.mode === "reduced" ? FALL_STEPS[stepKey.current].rest : readProgress());
      scene.resize();
    });
    return () => cancelAnimationFrame(id);
  }, [env.mode, env.layout, readProgress]);

  const choose = (i: FallStepIndex) => {
    if (scrollDriven) {
      // Cuộn tới ảnh "nghỉ" của bước: cảnh và giao diện đi theo cuộn, nên cuộn ngược sau đó vẫn khớp.
      const track = trackRef.current;
      const stage = stageRef.current;
      if (!track || !stage) return;
      const total = track.offsetHeight - stage.clientHeight;
      const stickyTop = parseFloat(getComputedStyle(stage).top) || 0;
      window.scrollTo({ top: window.scrollY + track.getBoundingClientRect().top + FALL_STEPS[i].rest * total - stickyTop, behavior: "smooth" });
      return;
    }
    applyStep(i);
    applyCard(i === 2);
    sceneRef.current?.setTargetProgress(FALL_STEPS[i].rest);
  };

  const showCard = scrollDriven ? cardActive : step === 2;
  const current = FALL.steps[step];
  const wide = env.layout === "wide";

  return (
    <section id={SECTION_IDS.scenarios} aria-labelledby="fall-title" data-tone="dark" className="scroll-mt-(--landing-header-h) bg-midnight text-ivory">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pt-20 pb-8 md:px-6 md:pt-28 md:pb-10">
        <Eyebrow tone="dark" className="self-start">
          {FALL.eyebrow}
        </Eyebrow>
        <h2 id="fall-title" className="max-w-4xl font-display text-3xl leading-tight font-extrabold tracking-tight text-balance md:text-5xl">
          {FALL.heading}
        </h2>
        <p className="max-w-2xl text-ivory/85 md:text-lg">{FALL.body}</p>
      </div>

      <div ref={trackRef} data-testid="fall-track" data-mode={env.webgl ? env.mode : "static"} className="relative" style={scrollDriven ? { height: `${SCROLL_SVH[env.mode as "full" | "lite"]}svh` } : undefined}>
        <div
          ref={stageRef}
          data-testid="fall-stage"
          data-state={env.webgl ? sceneState : "static"}
          className={cn(
            "relative w-full overflow-hidden bg-midnight",
            scrollDriven ? "sticky top-(--landing-header-h) h-[calc(100svh-var(--landing-header-h))]" : env.webgl ? "h-[min(78svh,760px)] min-h-[520px]" : "min-h-[22rem]",
          )}
        >
          <p className="sr-only">{FALL.figureLabel}</p>
          {env.webgl ? (
            <div ref={hostRef} aria-hidden className={cn("absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none", sceneState === "ready" ? "opacity-100" : "opacity-0")} />
          ) : (
            <div className="relative mx-auto max-w-3xl px-4 pt-6 md:px-6">
              <p role="status" className="rounded-2xl border border-ivory/15 bg-graphite p-5 text-sm text-ivory/85">
                {FALL.staticNote}
              </p>
            </div>
          )}
          {/* Tối viền khung lúc thiết bị ghi nhận: dồn mắt vào giữa khung. */}
          <div
            ref={vignetteRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_50%_50%,transparent_35%,var(--color-midnight)_100%)]"
            style={{ opacity: 0 }}
          />
          {sceneState === "error" && env.webgl ? (
            <p role="status" className="absolute inset-x-4 top-4 mx-auto max-w-md rounded-2xl bg-graphite p-4 text-sm text-ivory/85">
              Không tải được cảnh 3D. Các bước bên dưới vẫn mô tả đầy đủ tình huống.
            </p>
          ) : null}

          {/* Bước và chú thích: dưới-trái ở màn rộng (kiểu phụ đề), trên cùng ở màn hẹp. */}
          <div
            ref={panelRef}
            className={cn(
              "z-10 flex flex-col gap-3 rounded-2xl bg-midnight/80 p-3 md:p-4",
              !env.webgl ? "relative mx-4 mt-6 max-w-3xl md:mx-auto" : wide ? "absolute bottom-6 left-4 max-w-md md:bottom-8 md:left-8" : "absolute inset-x-3 top-3",
            )}
          >
            <div role="group" aria-label={FALL.demoLabel} className="flex flex-wrap gap-1 sm:gap-1.5">
              {FALL.steps.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={i === step}
                  onClick={() => choose(i as FallStepIndex)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-4 sm:text-sm",
                    i === step ? "border-signal bg-signal text-midnight" : "border-ivory/30 text-ivory hover:border-signal hover:text-mint",
                  )}
                >
                  <span aria-hidden className="font-mono text-xs">
                    {i + 1}
                  </span>
                  {s.label}
                </button>
              ))}
            </div>
            {scrollDriven ? (
              <div className="h-px w-full bg-ivory/20" aria-hidden>
                <div ref={barRef} className="h-px origin-left bg-signal" style={{ transform: "scaleX(0)" }} />
              </div>
            ) : null}
            <p className="min-h-[2.5rem] text-sm text-ivory/90" aria-live={scrollDriven ? undefined : "polite"}>
              {current.caption}
            </p>
          </div>

          {/* Thông báo văn bản: phải-giữa ở màn rộng, dưới cùng ở màn hẹp. Chỉ thao tác được khi đã hiện. */}
          <div
            ref={cardRef}
            data-testid="fall-notification"
            className={cn(
              "z-10 flex flex-col gap-3 rounded-2xl border border-ivory/15 bg-graphite p-4 shadow-stage-card md:p-5",
              env.webgl ? "absolute" : "static mx-4 my-6 max-w-3xl md:mx-auto",
              env.webgl && (wide ? "top-1/2 right-6 w-[22rem] -translate-y-1/2 md:right-10" : "inset-x-3 bottom-3"),
              !scrollDriven && "transition-opacity duration-500 motion-reduce:transition-none",
            )}
            style={scrollDriven ? { opacity: 0 } : { opacity: showCard ? 1 : 0.35 }}
            aria-hidden={!showCard}
            inert={!showCard}
          >
            <div className="flex flex-wrap items-center gap-2">
              <CapabilityTag kind="simulated" tone="dark" />
              <span className="text-xs text-ivory/75">{FALL.notification.title}</span>
            </div>
            <p className="font-medium">{FALL.notification.body}</p>
            <p className="text-xs text-mint">{acknowledged ? FALL.acknowledged : FALL.notification.flag}</p>
            <button
              type="button"
              onClick={() => setAcknowledged(true)}
              disabled={acknowledged}
              className={landingButtonClasses({ tone: "dark", variant: "secondary", className: "min-h-11 self-start px-4" })}
            >
              {acknowledged ? (
                <>
                  <Check className="size-4" aria-hidden />
                  Đã tiếp nhận
                </>
              ) : (
                FALL.notification.action
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
