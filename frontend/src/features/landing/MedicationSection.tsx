import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "../../design-system/cn";
import { CapabilityTag, Eyebrow } from "../../design-system/landing";
import { REPORT_HOLD, STORY_STEPS, splitStory, storyStepAt, type StoryChapter, type StoryStepIndex } from "../../lib/careScene/storySteps";
import { MEDICATION, SECTION_IDS, SECURITY_SCENE } from "./content";
import { DailyReportCard } from "./DailyReport";
import { slotState, type SlotState } from "./medication";
import { Reveal } from "./Reveal";
import { clamp01, useSceneEnvironment, type SceneMode } from "./sceneEnvironment";

// Kiểu của cảnh 3D, chỉ dùng cho kiểu: module thật (three.js) được tải lười khi cần.
type CareSceneModule = typeof import("../../lib/careScene");
type MedScene = InstanceType<CareSceneModule["MedicationScene"]>;
type SceneFrame = Parameters<NonNullable<ConstructorParameters<CareSceneModule["MedicationScene"]>[1]["onFrame"]>>[0];
type LabelKey = keyof SceneFrame["labels"];

declare global {
  interface Window {
    /** Chỉ có khi mở trang với `?debug=1`, phục vụ kiểm thử trình duyệt. */
    __medScene?: {
      state: () => { progress: number; target: number; ready: boolean; frames: number; step: number; chapter: number; phase: string; active: boolean; pending: boolean };
      sample: () => ReturnType<MedScene["sample"]>;
      motion: () => number[];
      view: () => ReturnType<MedScene["viewState"]>;
      /** Trạng thái vật thể gói đọc từ cảnh: định danh, số bản trong cảnh, số ô lục giác đang hiện, tư thế. */
      artifact: () => ReturnType<MedScene["artifactState"]>;
      /** Hình chữ nhật (px) mà bề mặt báo cáo 3D đang chiếm, để so với khung HTML của báo cáo. */
      surfaceRect: () => ReturnType<MedScene["reportSurfaceScreen"]>;
      /** Bản tóm tắt thuần dữ liệu của giao diện bàn giao gói (không chứa đối tượng three, an toàn để tuần tự hoá). */
      handoff: () => {
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
    };
  }
}

/** Độ dài vùng cuộn (svh) khi cảnh chạy theo cuộn: quan sát ≈ 395, bảo vệ ≈ 245, tổng quan hôm nay ≈ 170 (bản nhẹ ngắn hơn khoảng 21%). */
const SCROLL_SVH: Record<Exclude<SceneMode, "reduced">, number> = { full: 810, lite: 640 };

const DAY = 24 * 60;
const START = 6 * 60;
const END = 21 * 60 + 30;

const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;

const stateStyle: Record<SlotState, string> = {
  waiting: "border border-ink/35 bg-transparent text-ink",
  open: "border-2 border-teal-deep bg-teal-deep/10 text-ink",
  observed: "border border-teal-deep bg-teal-deep text-paper",
  missed: "border-2 border-dashed border-ink bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgb(38_54_62/0.16)_5px_7px)] text-ink",
};

/** Bảy bước của cả câu chuyện, cùng thứ tự với `STORY_STEPS`: bốn bước quan sát rồi ba bước bảo vệ. */
const STEPS = [...MEDICATION.scene.steps.map((s) => ({ ...s, chapter: 0 as const })), ...SECURITY_SCENE.steps.map((s) => ({ ...s, chapter: 1 as const }))];
const CHAPTER_STEPS = [STEPS.filter((s) => s.chapter === 0), STEPS.filter((s) => s.chapter === 1)] as const;
const GROUP_LABELS = [MEDICATION.scene.label, SECURITY_SCENE.label] as const;

/**
 * Tình huống hỗ trợ dùng thuốc (khái niệm). Phần trên là lời giới thiệu và một ngày mô phỏng (dữ liệu cố định, có nhãn); phần cuối là cảnh 3D chạy
 * theo cuộn: một hành động → camera quan sát → gói dữ liệu → hub trong nhà → (chương bảo vệ, cùng gói) khiên → ô lục giác → bản rút gọn.
 * Cảnh kết thúc ngay trước phần Riêng tư. Câu then chốt: không quan sát được không có nghĩa là chưa uống thuốc.
 */
export function MedicationSection() {
  const [now, setNow] = useState(9 * 60 + 40);
  const rangeId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        let t = START;
        setNow(t);
        timer = window.setInterval(() => {
          if (touched.current) {
            window.clearInterval(timer);
            return;
          }
          t += 12;
          if (t >= END) {
            t = END;
            window.clearInterval(timer);
          }
          setNow(t);
        }, 80);
      },
      { threshold: 0.7 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  const pct = (m: number) => `${(m / DAY) * 100}%`;
  const ticks = [0, 6, 12, 18, 24];

  return (
    <section id={SECTION_IDS.activity} aria-labelledby="med-title" data-tone="light" className="scroll-mt-(--landing-header-h) bg-paper text-ink">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 pt-20 pb-16 md:px-6 md:pt-28 md:pb-24">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
          <div className="flex flex-col gap-6">
            <Eyebrow className="self-start">{MEDICATION.eyebrow}</Eyebrow>
            <h2 id="med-title" className="font-display text-3xl leading-tight font-extrabold tracking-tight text-balance md:text-5xl">
              {MEDICATION.heading}
            </h2>
            <p className="max-w-2xl text-ink/85 md:text-lg">{MEDICATION.body}</p>
          </div>
          <div className="flex flex-col gap-4 self-end border-l-2 border-teal-deep pl-6">
            <p className="font-display text-xl leading-snug font-bold text-balance md:text-2xl">{MEDICATION.rule}</p>
            <p className="text-ink/85">{MEDICATION.ruleBody}</p>
          </div>
        </div>

        <Reveal>
          <div ref={panelRef} className="rounded-3xl border border-ink/12 bg-ivory p-5 md:p-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <p className="font-display text-lg font-bold">{MEDICATION.demoLabel}</p>
              <CapabilityTag kind="simulated" tone="light" />
            </div>

            {/* Trục thời gian trong ngày. */}
            <div className="relative mx-1 h-20" aria-hidden>
              <div className="absolute inset-x-0 top-9 h-px bg-ink/30" />
              {ticks.map((h) => (
                <div key={h} className="absolute top-8 flex -translate-x-1/2 flex-col items-center gap-1 font-mono text-[11px] text-ink/75" style={{ left: pct(h * 60) }}>
                  <span className="block h-2 w-px bg-ink/45" />
                  {String(h).padStart(2, "0")}h
                </div>
              ))}
              {MEDICATION.slots.map((s) => (
                <div
                  key={s.id}
                  className={cn("absolute top-1 h-6 rounded-full transition-colors duration-300", stateStyle[slotState(s, now)])}
                  style={{ left: pct(s.scheduled), width: pct(MEDICATION.windowMinutes) }}
                />
              ))}
              <div className="absolute top-0 bottom-0 w-px bg-teal-deep" style={{ left: pct(now) }}>
                <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full rounded-full bg-teal-deep px-2 py-0.5 font-mono text-[11px] whitespace-nowrap text-paper">{fmt(now)}</span>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-4">
              <label htmlFor={rangeId} className="shrink-0 text-sm font-medium">
                Giờ trong ngày
              </label>
              <input
                id={rangeId}
                type="range"
                min={START}
                max={END}
                step={5}
                value={now}
                aria-valuetext={fmt(now)}
                onChange={(e) => {
                  touched.current = true;
                  setNow(Number(e.target.value));
                }}
                className="h-11 w-full cursor-pointer accent-teal-deep focus-visible:outline-2 focus-visible:outline-offset-2"
              />
              <output htmlFor={rangeId} className="w-14 shrink-0 text-right font-mono text-sm">
                {fmt(now)}
              </output>
            </div>

            <ul className="mt-6 grid gap-4 md:grid-cols-3">
              {MEDICATION.slots.map((s) => {
                const st = slotState(s, now);
                const info = MEDICATION.states[st];
                return (
                  <li key={s.id} className="flex flex-col gap-2 border-t border-ink/20 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-display text-lg font-bold">
                        {s.label} <span className="font-mono text-sm font-normal text-ink/75">{fmt(s.scheduled)}</span>
                      </p>
                      <span className={cn("inline-flex min-h-7 items-center rounded-full px-3 text-xs font-medium", stateStyle[st])}>{info.label}</span>
                    </div>
                    <p className="text-sm text-ink/85">{info.note}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </Reveal>
      </div>

      <ObservationStage />
    </section>
  );
}

/** Nhãn chữ gắn vào vật thể trong cảnh (vị trí do cảnh tính, ghi thẳng vào DOM). */
const LABELS: ReadonlyArray<{ key: LabelKey; text: string }> = [
  { key: "device", text: MEDICATION.scene.deviceLabel },
  { key: "hub", text: MEDICATION.scene.hubLabel },
  { key: "shield", text: SECURITY_SCENE.shieldLabel },
  { key: "digest", text: SECURITY_SCENE.digestLabel },
];

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Khối cảnh 3D quan sát hoạt động, bảo vệ dữ liệu và tổng quan hôm nay: tràn mép, nền tối, ghim dưới header khi cuộn. */
function ObservationStage() {
  const env = useSceneEnvironment();
  const scrollDriven = env.webgl && env.mode !== "reduced";
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const reportBgRef = useRef<HTMLDivElement>(null);
  const reportBodyRef = useRef<HTMLDivElement>(null);
  const reportBodyInnerRef = useRef<HTMLDivElement>(null);
  /** Phần nội dung báo cáo cao hơn khung (px): cuộn lên theo tiến trình ở cuối chương, bằng 0 khi báo cáo vừa khung. */
  const overflowRef = useRef(0);
  const headingId = useId();
  const labelRefs = useRef<Partial<Record<LabelKey, HTMLParagraphElement | null>>>({});
  const sceneRef = useRef<MedScene | null>(null);
  const envRef = useRef(env);
  useEffect(() => {
    envRef.current = env;
  }, [env]);

  const [step, setStep] = useState<StoryStepIndex>(0);
  const [storyChapter, setStoryChapter] = useState<StoryChapter>(0);
  const chapterKey = useRef<StoryChapter>(0);
  const [sceneState, setSceneState] = useState<"loading" | "ready" | "error">("loading");
  const stepKey = useRef<StoryStepIndex>(0);

  const applyStep = useCallback((s: StoryStepIndex) => {
    if (s === stepKey.current) return;
    stepKey.current = s;
    setStep(s);
  }, []);

  const applyChapter = useCallback((c: StoryChapter) => {
    if (c === chapterKey.current) return;
    chapterKey.current = c;
    setStoryChapter(c);
  }, []);

  /** Tiến trình cuộn thật của vùng dính (0 → 1), cho cả ba chương. */
  const readProgress = useCallback((): number => {
    const track = trackRef.current;
    const stage = stageRef.current;
    if (!track || !stage) return 0;
    const rect = track.getBoundingClientRect();
    const total = rect.height - stage.clientHeight;
    const stickyTop = parseFloat(getComputedStyle(stage).top) || 0;
    return total > 0 ? clamp01((stickyTop - rect.top) / total) : 0;
  }, []);

  /** Đồng bộ lớp giao diện với khung hình: ghi thẳng vào DOM, chỉ đặt state khi bước đổi. */
  const handleFrame = useCallback(
    (f: Pick<SceneFrame, "progress" | "step" | "chapter" | "labels" | "anchors" | "ui">) => {
      if (barRef.current) barRef.current.style.transform = `scaleX(${f.progress.toFixed(4)})`;
      applyStep(f.step);
      applyChapter(f.chapter);
      // Chương tổng quan: bảng bước mờ đi, bản báo cáo thế chỗ (nền, nội dung, mức cuộn khi nội dung cao hơn khung).
      const panel = panelRef.current;
      if (panel) {
        panel.style.opacity = f.ui.panel.toFixed(3);
        panel.style.visibility = f.ui.panel > 0.02 ? "visible" : "hidden";
      }
      const rep = reportRef.current;
      if (rep) {
        rep.style.setProperty("--r", f.ui.reveal.toFixed(4));
        rep.style.setProperty("--bg", f.ui.bg.toFixed(4));
        rep.style.setProperty("--shift", (overflowRef.current * f.ui.hold).toFixed(1));
      }
      for (const { key } of LABELS) {
        const el = labelRefs.current[key];
        if (!el) continue;
        const a = f.anchors[key];
        const o = a.visible ? f.labels[key] : 0;
        el.style.opacity = o.toFixed(3);
        el.style.visibility = o > 0.01 ? "visible" : "hidden";
        // Nhãn của dải rút gọn nằm dưới điểm neo; các nhãn khác nằm trên.
        el.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px) translate(-50%, ${key === "digest" ? "0%" : "-100%"})`;
      }
    },
    [applyStep, applyChapter],
  );

  // Chưa có cảnh (đang tải hoặc lỗi) mà vẫn cuộn: giao diện bám theo cuộn bằng các mốc giống hệt cảnh.
  useEffect(() => {
    if (!scrollDriven || sceneState === "ready") return;
    const none = { x: 0, y: 0, visible: false };
    const onScroll = () => {
      const p = readProgress();
      // Chưa có cảnh 3D: giao diện vẫn bám theo cuộn; tới chương tổng quan thì bản báo cáo hiện thẳng trên nền tối.
      const { chapter, p: pc } = splitStory(p);
      const report = chapter === 2;
      const hold = smoothstep(Math.min(1, Math.max(0, (pc - REPORT_HOLD[0]) / (REPORT_HOLD[1] - REPORT_HOLD[0]))));
      handleFrame({
        progress: p,
        step: storyStepAt(p),
        chapter,
        labels: { device: 0, hub: 0, shield: 0, digest: 0 },
        anchors: { device: none, hub: none, shield: none, digest: none },
        ui: report ? { panel: 0, bg: 1, reveal: 1, hold } : { panel: 1, bg: 0, reveal: 0, hold: 0 },
      });
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
    let scene: MedScene | null = null;
    let cleanup: (() => void) | null = null;
    import("../../lib/careScene").then(
      ({ MedicationScene }) => {
        if (cancelled) return;
        const live = envRef.current;
        scene = new MedicationScene(host, { mode: live.mode, layout: live.layout, onFrame: handleFrame });
        sceneRef.current = scene;
        const s = scene;
        s.setTargetProgress(live.mode === "reduced" ? STORY_STEPS[stepKey.current]!.rest : readProgress());
        s.load().then(
          () => {
            if (cancelled) return;
            setSceneState("ready");
            if (new URLSearchParams(window.location.search).has("debug")) {
              window.__medScene = {
                state: () => {
                  const v = s.viewState();
                  return { progress: s.progress, target: s.targetProgress, ready: s.ready, frames: s.framesRendered, step: stepKey.current, chapter: v.chapter, phase: s.packetPhase, ...s.loopState };
                },
                sample: () => s.sample(),
                motion: () => s.motionState(),
                view: () => s.viewState(),
                artifact: () => s.artifactState(),
                surfaceRect: () => s.reportSurfaceScreen(),
                handoff: () => {
                  const h = s.getPacketHandoff();
                  const px = h.snapshot.getContext("2d")?.getImageData(0, 0, h.snapshot.width, h.snapshot.height).data;
                  const seen = new Set<number>();
                  if (px) for (let i = 0; i < px.length; i += 4) seen.add(((px[i]! >> 4) << 8) | ((px[i + 1]! >> 4) << 4) | (px[i + 2]! >> 4));
                  const end = h.sample(1);
                  return {
                    version: h.version,
                    phase: h.phase,
                    arrived: h.arrived,
                    progress: h.progress,
                    current: { position: [...h.current.position], quaternion: [...h.current.quaternion], scale: h.current.scale },
                    final: { position: [...h.final.position], quaternion: [...h.final.quaternion], scale: h.final.scale },
                    finalScreen: h.finalScreen,
                    spec: { width: h.spec.width, height: h.spec.height, snapshotSize: [...h.spec.snapshotSize] },
                    snapshot: { width: h.snapshot.width, height: h.snapshot.height, distinctColors: seen.size },
                    sampledEnd: { phase: end.phase, position: end.position.toArray() },
                    objectId: h.object.root.uuid,
                  };
                },
              };
            }
          },
          () => {
            if (!cancelled) setSceneState("error");
          },
        );
        // Vùng giao diện chiếm trên khung: bảng bước nằm trên cùng ở màn hẹp (cảnh nhường chỗ), bên trái ở màn rộng.
        const measure = () => {
          const stageEl = stageRef.current;
          const panelEl = panelRef.current;
          if (!stageEl || !panelEl) return;
          const narrow = envRef.current.layout === "narrow";
          s.setInsets({
            panelTop: narrow ? panelEl.offsetTop + panelEl.offsetHeight + 8 : 0,
            panelBottom: 0,
            panelLeft: narrow ? 0 : panelEl.offsetLeft + panelEl.offsetWidth + 24,
          });
        };
        measure();
        // Khung mà bản báo cáo chiếm (px, gốc trên-trái của khung vẽ): cảnh quy về hình chữ nhật 3D để bề mặt mọc ra đúng khung này.
        const measureReport = () => {
          const stageEl = stageRef.current;
          const rep = reportRef.current;
          const body = reportBodyRef.current;
          const inner = reportBodyInnerRef.current;
          const bg = reportBgRef.current;
          if (!stageEl || !rep || !body || !inner) return;
          const a = stageEl.getBoundingClientRect();
          const b = rep.getBoundingClientRect();
          overflowRef.current = Math.max(0, inner.offsetHeight - body.clientHeight);
          const radius = bg ? parseFloat(getComputedStyle(bg).borderTopLeftRadius) || 24 : 24;
          s.setReportRect({ x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height }, radius);
        };
        measureReport();
        const ro = new ResizeObserver(() => {
          measure();
          measureReport();
        });
        if (stageRef.current) ro.observe(stageRef.current);
        if (panelRef.current) ro.observe(panelRef.current);
        if (reportRef.current) ro.observe(reportRef.current);
        if (reportBodyRef.current) ro.observe(reportBodyRef.current);
        if (reportBodyInnerRef.current) ro.observe(reportBodyInnerRef.current);
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
      delete window.__medScene;
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
      scene.setTargetProgress(env.mode === "reduced" ? STORY_STEPS[stepKey.current]!.rest : readProgress());
      scene.resize();
    });
    return () => cancelAnimationFrame(id);
  }, [env.mode, env.layout, readProgress]);

  const choose = (i: StoryStepIndex) => {
    if (scrollDriven) {
      // Cuộn tới ảnh "nghỉ" của bước: cảnh và giao diện đi theo cuộn, nên cuộn ngược sau đó vẫn khớp.
      const track = trackRef.current;
      const stage = stageRef.current;
      if (!track || !stage) return;
      const total = track.offsetHeight - stage.clientHeight;
      const stickyTop = parseFloat(getComputedStyle(stage).top) || 0;
      window.scrollTo({ top: window.scrollY + track.getBoundingClientRect().top + STORY_STEPS[i]!.rest * total - stickyTop, behavior: "smooth" });
      return;
    }
    applyStep(i);
    sceneRef.current?.setTargetProgress(STORY_STEPS[i]!.rest);
  };

  const current = STEPS[step]!;
  // Chương của khung đang vẽ (0 quan sát, 1 bảo vệ, 2 tổng quan hôm nay). Bảng bước chỉ có hai chương đầu.
  const chapter = storyChapter;
  const wide = env.layout === "wide";
  // Màn hẹp có cảnh: bảy nút số tròn trên một hàng và nhãn bước hiện tại bên dưới, nên bảng luôn cao như nhau và khung cảnh không xê dịch khi đổi bước.
  const compact = env.webgl && !wide;

  const stepButton = (s: (typeof STEPS)[number], i: number) => {
    const active = i === step;
    return (
      <button
        key={s.id}
        type="button"
        aria-pressed={active}
        aria-label={compact ? `${i + 1}. ${s.label}` : undefined}
        onClick={() => choose(i as StoryStepIndex)}
        className={cn(
          "inline-flex min-h-11 items-center gap-1 rounded-full border text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:gap-1.5 sm:text-sm",
          compact ? "min-w-11 justify-center px-0" : "px-2.5 sm:px-4",
          active ? "border-signal bg-signal text-midnight" : "border-ivory/30 text-ivory hover:border-signal hover:text-mint",
        )}
      >
        <span aria-hidden className="font-mono text-xs">
          {i + 1}
        </span>
        {compact ? null : s.label}
      </button>
    );
  };

  return (
    <div ref={trackRef} data-testid="med-track" data-mode={env.webgl ? env.mode : "static"} data-tone="dark" className="relative bg-midnight text-ivory" style={scrollDriven ? { height: `${SCROLL_SVH[env.mode as "full" | "lite"]}svh` } : undefined}>
      <div
        ref={stageRef}
        data-testid="med-stage"
        data-state={env.webgl ? sceneState : "static"}
        data-chapter={chapter}
        className={cn(
          "relative w-full overflow-hidden bg-midnight",
          scrollDriven ? "sticky top-(--landing-header-h) h-[calc(100svh-var(--landing-header-h))]" : env.webgl ? "h-[min(78svh,760px)] min-h-[520px]" : "min-h-[22rem]",
        )}
      >
        <p className="sr-only">{MEDICATION.scene.figureLabel}</p>
        <p className="sr-only">{SECURITY_SCENE.figureLabel}</p>
        {env.webgl ? (
          <div ref={hostRef} aria-hidden className={cn("absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none", sceneState === "ready" ? "opacity-100" : "opacity-0")} />
        ) : (
          <div className="relative mx-auto max-w-3xl px-4 pt-6 md:px-6">
            <p role="status" className="rounded-2xl border border-ivory/15 bg-graphite p-5 text-sm text-ivory/85">
              {MEDICATION.scene.staticNote}
            </p>
          </div>
        )}
        {sceneState === "error" && env.webgl ? (
          <p role="status" className="absolute inset-x-4 top-4 mx-auto max-w-md rounded-2xl bg-graphite p-4 text-sm text-ivory/85">
            Không tải được cảnh 3D. Các bước bên dưới vẫn mô tả đầy đủ quy trình.
          </p>
        ) : null}

        {/* Nhãn gắn vào vật thể: chỉ hiện lúc cần để hiểu (thiết bị khi camera quan sát, hub khi gói tới, khiên khi gói đi vào, bản rút gọn ở cuối). */}
        {LABELS.map(({ key, text }) => (
          <p
            key={key}
            ref={(el) => {
              labelRefs.current[key] = el;
            }}
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 z-10 rounded-full bg-midnight/85 px-3 py-1 font-mono text-[11px] tracking-[0.12em] whitespace-nowrap text-ivory uppercase"
            style={{ opacity: 0, visibility: "hidden" }}
          >
            {text}
          </p>
        ))}

        {/* Bước và chú thích: bên trái ở màn rộng, trên cùng ở màn hẹp. */}
        <div
          ref={panelRef}
          className={cn(
            "z-10 flex flex-col gap-3 rounded-2xl bg-midnight/80 p-3 md:p-4",
            !env.webgl ? "relative mx-4 mt-6 max-w-3xl md:mx-auto" : wide ? "absolute top-1/2 left-4 w-[17.5rem] -translate-y-1/2 md:left-8" : "absolute inset-x-3 top-3",
          )}
        >
          {/* Màn hẹp: hai nhóm nút xuống dòng theo bề ngang khung (không theo bước), nên chiều cao bảng cố định trong suốt lúc cuộn. */}
          <div className={cn("flex", compact ? "flex-row flex-wrap items-center gap-x-2.5 gap-y-1.5" : "flex-col gap-3")}>
            {CHAPTER_STEPS.map((group, c) => (
              <div key={c} className={cn("flex flex-col gap-1.5", compact && c === 1 && "border-l border-ivory/20 pl-2.5")}>
                {compact ? null : <p className={cn("font-mono text-[11px] tracking-[0.14em] uppercase", c === chapter ? "text-mint" : "text-ivory/70")}>{SECURITY_SCENE.chapters[c]}</p>}
                <div role="group" aria-label={GROUP_LABELS[c]} className={cn("flex gap-1 sm:gap-1.5", wide && env.webgl ? "flex-col items-stretch" : "flex-wrap")}>
                  {group.map((s) => {
                    const i = STEPS.indexOf(s);
                    return stepButton(s, i);
                  })}
                </div>
              </div>
            ))}
          </div>
          {scrollDriven ? (
            <div className="h-px w-full bg-ivory/20" aria-hidden>
              <div ref={barRef} className="h-px origin-left bg-signal" style={{ transform: "scaleX(0)" }} />
            </div>
          ) : null}
          <div aria-live={scrollDriven ? undefined : "polite"} className="flex flex-col gap-1">
            {compact ? <p className="text-sm font-bold text-ivory">{`${step + 1}. ${current.label}`}</p> : null}
            <p className={cn("text-sm text-ivory/90", compact ? "h-[3.75rem] overflow-hidden" : "min-h-[2.5rem]")}>{current.caption}</p>
            {!env.webgl && chapter === 1 ? <p className="text-xs text-ivory/80">{SECURITY_SCENE.note}</p> : null}
          </div>
        </div>

        {/* Bản báo cáo ngày (chương tổng quan): HTML thật đặt đúng lên bề mặt 3D. Nền và nội dung hiện dần theo `--bg` và `--r` do cảnh đặt;
            cuộn ngược thì ẩn lại đúng như cũ. Khi vừa khung thì đứng yên suốt phần cuối của vùng cuộn. */}
        {scrollDriven ? (
          <div
            ref={reportRef}
            data-testid="daily-report"
            role="region"
            aria-labelledby={headingId}
            className="pointer-events-none absolute top-1/2 left-1/2 z-20 flex max-h-[calc(100%-1.5rem)] w-[min(calc(100%-1.5rem),56rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl"
            style={{ ["--r" as string]: 0, ["--bg" as string]: 0, ["--shift" as string]: 0 }}
          >
            <div ref={reportBgRef} aria-hidden className="absolute inset-0 rounded-3xl border border-ivory/15 bg-graphite" style={{ opacity: "var(--bg)" }} />
            <div className="relative flex min-h-0 flex-1 flex-col p-4 md:p-8">
              <DailyReportCard headingId={headingId} bodyRef={reportBodyRef} bodyInnerRef={reportBodyInnerRef} />
            </div>
          </div>
        ) : null}

        {/* Lưu ý về hình minh hoạ của chương bảo vệ: đặt riêng ở chân khung để bảng bước không đổi kích thước (khung cảnh không xê dịch). */}
        {env.webgl ? (
          <p
            data-testid="security-note"
            aria-hidden={chapter !== 1}
            className={cn(
              "pointer-events-none absolute z-10 rounded-xl bg-midnight/85 px-3 py-2 text-xs text-ivory/85 transition-opacity duration-300 motion-reduce:transition-none",
              wide ? "bottom-4 left-4 w-[17.5rem] md:left-8" : "inset-x-3 bottom-3",
              chapter === 1 ? "opacity-100" : "opacity-0",
            )}
          >
            {SECURITY_SCENE.note}
          </p>
        ) : null}
      </div>

      {/* Giảm chuyển động hoặc không có WebGL: bản báo cáo nằm trong luồng trang, hiện đủ ngay, không phụ thuộc cảnh. */}
      {!scrollDriven ? (
        <div className="px-4 pt-10 pb-16 md:px-6 md:pb-20">
          <div
            data-testid="daily-report"
            role="region"
            aria-labelledby={headingId}
            className="mx-auto w-full max-w-[56rem] rounded-3xl border border-ivory/15 bg-graphite p-5 md:p-8"
            style={{ ["--r" as string]: 1 }}
          >
            <DailyReportCard headingId={headingId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
