import type { CSSProperties, ReactNode } from "react";
import type { FallSceneFrame, MedSceneFrame } from "@fe/lib/careScene";
import { Wordmark } from "@fe/features/landing/Brand";
import { HERO, TAGLINE } from "@fe/features/landing/content";
import { BEATS, STAGES } from "@fe/lib/hardware3d";
import type { Screen } from "./hardware";
import { SCENES, clamp01, easeOut, lerp, sm, sm5, track, win } from "./timing";
import { FallOverlay, MedicationOverlay, PrivacyOverlay } from "./OverlayStories";
import { Greeting } from "./Greeting";

export interface FrameData {
  t: number;
  /** Screen positions (px) of the exploded parts, keyed by part id. */
  anchors: Record<string, Screen>;
  lens: Screen;
  fallDevice: { x: number; y: number };
  fallFrame: FallSceneFrame | null;
  medAnchors: MedSceneFrame | null;
  hwOpacity: number;
  fallOpacity: number;
  medOpacity: number;
  /** Timeline progress p of the hardware story (0..1) when scene 2 is on screen. */
  hwP: number;
  /** Medication story chapter-0 progress (0..1). */
  medP: number;
}

/** Fade + rise style for a text block that is on screen during [a, b]. */
export function fx(t: number, a: number, b: number, o: { fi?: number; fo?: number; rise?: number; blur?: number } = {}): CSSProperties {
  const fi = o.fi ?? 0.35;
  const fo = o.fo ?? 0.3;
  const k = win(t, a, b, fi, fo);
  const rise = o.rise ?? 18;
  const into = 1 - sm(t, a, a + fi);
  const blur = (o.blur ?? 0) * into;
  return {
    opacity: k,
    transform: `translateY(${into * rise}px)`,
    filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
    visibility: k > 0.002 ? "visible" : "hidden",
  };
}

export function Overlay(d: FrameData) {
  const { t } = d;
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ fontFamily: "var(--font-sans)" }}>
      {/* soft transition flash S2 -> S3 */}
      <Opening t={t} lens={d.lens} />
      <HardwareStory d={d} />
      <FallOverlay d={d} />
      <MedicationOverlay d={d} />
      <PrivacyOverlay d={d} />
      <Shutter d={d} />
      <TransitionFlash t={t} />
      <Greeting t={t} />
    </div>
  );
}

/* ------------------------------------------------------------------ Scene 1: hook */
function Opening({ t, lens }: { t: number; lens: Screen }) {
  if (t > 3.6) return null;
  const hold = 1 - sm(t, 2.95, 3.4);
  const line = (txt: string, a: number) => (
    <span className="block" style={fx(t, a, 99, { fi: 0.55, rise: 26, blur: 14 })}>
      {txt}
    </span>
  );
  return (
    <div className="absolute inset-0" style={{ opacity: hold }}>
      <div className="absolute" style={{ left: 120, top: 280, width: 760 }}>
        <p className="font-mono text-[22px] font-medium tracking-[0.26em] text-ivory/85 uppercase" style={fx(t, 0.45, 99, { fi: 0.6, rise: 10 })}>
          Kena CI presents · CareLens AI
        </p>
        <h1 className="mt-9 font-display text-[92px] leading-[1.04] font-extrabold tracking-[0.04em] text-ivory">
          {line(TAGLINE[0], 0.85)}
          {line(TAGLINE[1], 1.4)}
          <span className="block text-signal">{line(TAGLINE[2], 1.95)}</span>
        </h1>
        <p className="mt-10 max-w-[620px] text-[20px] leading-snug text-ivory/60" style={fx(t, 2.4, 99, { fi: 0.5, rise: 8 })}>
          {HERO.taglineNote}
        </p>
      </div>
      {/* lens light: a soft bloom that gathers around the camera window while the highlight settles */}
      <LensBloom x={lens.x} y={lens.y} t={t} />
    </div>
  );
}

function LensBloom({ x, y, t }: { x: number; y: number; t: number }) {
  const k = sm(t, 1.9, 2.9);
  const r = lerp(90, 210, k);
  return <div className="absolute rounded-full" style={{ left: x - r, top: y - r, width: r * 2, height: r * 2, opacity: 0.55 * k, background: "radial-gradient(circle, rgba(176,228,216,0.55) 0%, rgba(85,185,168,0.18) 40%, rgba(85,185,168,0) 70%)" }} />;
}

/* ------------------------------------------------------------------ Scene 2: hardware */
/** Label columns of the exploded view. Order inside a column follows the vertical order of the parts, so leader lines never cross. */
const LABEL_COLUMNS = {
  left: ["max98357a", "esp32-cam", "slide-switch", "tp4056"],
  right: ["gy521", "lipo-cell", "speaker"],
} as const;
const BEAT_OF: Record<string, number> = { "esp32-cam": 0, gy521: 4, "lipo-cell": 1, tp4056: 2, speaker: 6, max98357a: 5, "slide-switch": 7 };
const LABEL_X = { left: 690, right: 1450 } as const;

function HardwareStory({ d }: { d: FrameData }) {
  const { t } = d;
  if (t < S2A || t > 8.75) return null;
  const stage = STAGES.find((s) => d.hwP < s.to) ?? STAGES[STAGES.length - 1]!;
  const closeA = win(t, 6.95, 7.9, 0.3, 0.12);
  const closeB = win(t, 7.9, 8.5, 0.2, 0.15);
  const overview = win(t, 3.3, 6.9, 0.45, 0.35);
  const labelOn = sm(t, 5.7, 6.2) * (1 - sm(t, 6.75, 7.1));
  return (
    <div className="absolute inset-0">
      {/* headline */}
      <div className="absolute" style={{ left: 110, top: 96, ...fx(t, 3.35, 6.9, { fi: 0.5, fo: 0.35, rise: 22, blur: 8 }) }}>
        <p className="font-mono text-[20px] font-medium tracking-[0.2em] text-signal uppercase">{stage.title}</p>
        <h2 className="mt-5 font-display text-[52px] leading-[1.08] font-extrabold tracking-tight text-ivory">
          Thiết kế nhỏ gọn.
          <br />
          Nhiều thành phần phối hợp.
        </h2>
      </div>

      {/* labels for the exploded view */}
      <div className="absolute inset-0" style={{ opacity: labelOn }}>
        {(["left", "right"] as const).flatMap((side) =>
          LABEL_COLUMNS[side].map((id, i, arr) => {
            const a = d.anchors[id];
            if (!a) return null;
            const order = LABEL_COLUMNS.left.indexOf(id as never) >= 0 ? LABEL_COLUMNS.left.indexOf(id as never) : LABEL_COLUMNS.right.indexOf(id as never);
            const show = sm(t, 5.55 + order * 0.1 + (side === "right" ? 0.05 : 0), 5.85 + order * 0.1 + (side === "right" ? 0.05 : 0));
            const slotY = (side === "left" ? [380, 530, 680, 830] : [330, 520, 710])[i]!;
            const lx = LABEL_X[side];
            const hot = id === "esp32-cam" || id === "gy521";
            void arr;
            return (
              <div key={id} style={{ opacity: show }}>
                <svg className="absolute inset-0" width={1920} height={1080}>
                  <line x1={a.x} y1={a.y} x2={lx} y2={slotY} stroke="rgba(242,240,233,0.55)" strokeWidth={1.5} />
                  <circle cx={a.x} cy={a.y} r={6} fill={hot ? "#55b9a8" : "#f2f0e9"} />
                </svg>
                <p
                  className="absolute rounded-full border px-5 py-2 font-display text-[24px] font-bold whitespace-nowrap"
                  style={{
                    left: side === "right" ? lx : undefined,
                    right: side === "left" ? 1920 - lx : undefined,
                    top: slotY - 24,
                    background: "rgba(20,35,45,0.9)",
                    borderColor: hot ? "#55b9a8" : "rgba(242,240,233,0.35)",
                    color: "#f2f0e9",
                  }}
                >
                  {BEATS[BEAT_OF[id]!]!.title}
                </p>
              </div>
            );
          }),
        )}
      </div>

      {/* honest footnote */}
      <p className="absolute font-mono text-[18px] tracking-[0.06em] text-ivory/70" style={{ left: 110, bottom: 62, ...fx(t, 3.6, 8.45, { fi: 0.5, fo: 0.25, rise: 6 }) }}>
        Kích thước, kiểu mô-đun và vị trí một số linh kiện là ước lượng, chưa xác minh.
      </p>

      {/* close-up cards */}
      <BeatCard beat={0} style={fx(t, 6.95, 7.95, { fi: 0.35, fo: 0.15, rise: 24 })} on={closeA} />
      <BeatCard beat={4} style={fx(t, 7.9, 8.55, { fi: 0.3, fo: 0.15, rise: 24 })} on={closeB} />
      <span style={{ display: "none" }}>{overview}</span>
    </div>
  );
}
const S2A = SCENES.s2[0] - 0.01;

function BeatCard({ beat, style, on }: { beat: number; style: CSSProperties; on: number }) {
  const b = BEATS[beat]!;
  const first = b.text.split(". ")[0]!.replace(/\.?$/, ".");
  return (
    <div className="absolute rounded-[28px] border border-ivory/15 bg-graphite/95 p-9" style={{ right: 110, top: 360, width: 620, boxShadow: "var(--shadow-stage-card)", ...style }} data-on={on.toFixed(2)}>
      <p className="font-mono text-[18px] tracking-[0.16em] text-signal uppercase">Thành phần</p>
      <h3 className="mt-3 font-display text-[44px] leading-tight font-extrabold text-ivory">{b.title}</h3>
      <p className="mt-4 text-[26px] leading-snug text-ivory/90">{first}</p>
      <p className="mt-5 border-t border-ivory/15 pt-4 font-mono text-[18px] leading-snug text-ivory/70">{b.note}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ Scene 6: photograph */
function Shutter({ d }: { d: FrameData }) {
  const { t } = d;
  if (t < 23.4 || t > 26.3) return null;
  const gather = sm5(t, 24.0, 25.3);
  const x = d.lens.x;
  const y = d.lens.y;
  const vf = win(t, 23.9, 25.3, 0.4, 0.08);
  const bracket = (pos: CSSProperties) => <span className="absolute h-[70px] w-[70px] border-ivory/90" style={{ ...pos, borderWidth: 0 }} />;
  void bracket;
  const r = lerp(60, 1500, gather ** 2.2);
  return (
    <div className="absolute inset-0">
      {/* light gathering around the lens */}
      <div
        className="absolute rounded-full"
        style={{
          left: x - r,
          top: y - r,
          width: r * 2,
          height: r * 2,
          opacity: gather * 0.9,
          background: "radial-gradient(circle, rgba(255,250,240,0.95) 0%, rgba(255,244,224,0.55) 18%, rgba(176,228,216,0.18) 42%, rgba(255,255,255,0) 68%)",
        }}
      />
      {/* viewfinder corners */}
      <svg className="absolute inset-0" width={1920} height={1080} style={{ opacity: vf * 0.85 }}>
        {[
          [150, 110, 1, 1],
          [1770, 110, -1, 1],
          [150, 970, 1, -1],
          [1770, 970, -1, -1],
        ].map(([cx, cy, sx, sy], i) => (
          <path key={i} d={`M ${cx! + sx! * 80} ${cy} H ${cx} V ${cy! + sy! * 80}`} fill="none" stroke="#f2f0e9" strokeWidth={4} strokeLinecap="round" />
        ))}
        <circle cx={960} cy={540} r={lerp(150, 62, sm(t, 24.1, 24.9))} fill="none" stroke="#55b9a8" strokeWidth={3} opacity={0.9 - sm(t, 25.0, 25.3)} />
      </svg>
      <p className="absolute font-mono text-[18px] tracking-[0.2em] text-ivory/70 uppercase" style={{ left: 150, top: 132, ...fx(t, 23.9, 25.2, { fi: 0.4, fo: 0.1, rise: 0 }) }}>
        CareLens AI
      </p>
    </div>
  );
}

/** The full-frame white of the photographic flash (scene 6) and the soft flash that bridges scene 2 to scene 3. */
function TransitionFlash({ t }: { t: number }) {
  const bridge = Math.min(1, Math.max(0, 1 - Math.abs(t - 8.52) / 0.17) * 1.25);
  // white photographic flash: rises over ~4 frames at 25.3, holds, and hands over to the greeting card from 26.0
  const flash = t >= 25.27 && t < 27.1 ? sm(t, 25.27, 25.4) : 0;
  return (
    <>
      <div className="absolute inset-0" style={{ opacity: bridge, background: "radial-gradient(circle at 50% 50%, #ffffff 0%, #f2fbf8 60%, #d3f0e8 100%)", pointerEvents: "none" }} />
      <div className="absolute inset-0" style={{ opacity: flash, background: "#ffffff", pointerEvents: "none" }} />
    </>
  );
}

export type { ReactNode };
export { clamp01, easeOut, sm5, track, Wordmark };
