import type { CSSProperties } from "react";
import { Check, Minus, Power, Volume2, ShieldCheck } from "lucide-react";
import { CapabilityTag } from "@fe/design-system/landing";
import { cn } from "@fe/design-system/cn";
import { BEATS } from "@fe/lib/hardware3d";
import { DAILY_REPORT, FALL, MEDICATION, PRIVACY } from "@fe/features/landing/content";
import { slotState } from "@fe/features/landing/medication";
import type { FrameData } from "./Overlay";
import { fx } from "./Overlay";
import { clamp01, lerp, sm, track, win } from "./timing";


/**
 * Upper-left scenario caption shared by scenarios 1 and 2 (same position, size, weight and spacing). One instance per scenario for the whole
 * scenario, so it fades once in and once out and never moves, blurs or re-renders between sub-scenes. Plus Jakarta Sans carries the Vietnamese
 * diacritics; no letter-spacing, no uppercase, so stacked accents stay legible. The "Ví dụ" badge follows the title on the same baseline row.
 */
function ScenarioCaption({ t, a, b, title }: { t: number; a: number; b: number; title: string }) {
  const k = win(t, a, b, 0.35, 0.3);
  if (k <= 0.002) return null;
  const [num, topic] = title.split(" · ");
  return (
    <div className="absolute flex items-center gap-5 rounded-[32px]" style={{ left: 86, top: 48, height: 84, paddingLeft: 24, paddingRight: 28, opacity: k, whiteSpace: "nowrap", background: "rgba(10,19,25,0.97)" }}>
      <p className="font-display text-[34px] leading-none font-bold text-ivory">
        {num}
        <span className="text-ivory/60"> · </span>
        <span className="text-mint">{topic}</span>
      </p>
      <span className="inline-flex h-[44px] items-center gap-2.5 rounded-full border-2 border-signal bg-signal/15 px-5 font-display text-[24px] leading-none font-bold text-mint">
        <span aria-hidden className="size-3 rounded-full border-2 border-current bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]" />
        Ví dụ
      </span>
    </div>
  );
}

/* ================================================================== Scene 3 · Fall (tình huống 01) */
const PIPE = ["Thiết bị đeo", "Hub trong nhà", "Máy chủ đám mây CareLens AI", "Ứng dụng"] as const;

export function FallOverlay({ d }: { d: FrameData }) {
  const { t } = d;
  if (t < 8.3 || t > 14.4) return null;
  const root = win(t, 8.45, 14.05, 0.3, 0.3);
  const step = d.fallFrame?.step ?? 0;
  const vignette = d.fallFrame?.vignette ?? 0;

  // device call-outs while the wearable registers the change
  const call = win(t, 10.35, 11.55, 0.3, 0.3);
  const dv = d.fallDevice;

  // pipeline: device -> hub -> cloud -> app, one pulse
  const pipeOn = win(t, 10.95, 13.9, 0.35, 0.3);
  const pulse = clamp01((t - 11.1) / 1.0);
  const lit = (i: number) => sm(t, 11.1 + i * 0.3, 11.35 + i * 0.3);

  // event card + acknowledge
  const press = clamp01((t - 13.3) / 0.12) * (1 - clamp01((t - 13.42) / 0.14));
  const acknowledged = t >= 13.5;
  return (
    <div className="absolute inset-0" style={{ opacity: root }}>
      <div className="absolute inset-0" style={{ opacity: vignette, background: "radial-gradient(60% 55% at 50% 50%, transparent 35%, #14232d 100%)" }} />

      <ScenarioCaption t={t} a={8.5} b={14.0} title={FALL.eyebrow} />

      {/* call-outs: the wearable camera and the motion sensor (names from the hardware BEATS) */}
      <div className="absolute inset-0" style={{ opacity: call }}>
        <svg className="absolute inset-0" width={1920} height={1080}>
          <line x1={dv.x} y1={dv.y} x2={dv.x + 250} y2={dv.y - 110} stroke="rgba(242,240,233,0.6)" strokeWidth={1.5} />
          <line x1={dv.x} y1={dv.y} x2={dv.x + 250} y2={dv.y + 90} stroke="rgba(242,240,233,0.6)" strokeWidth={1.5} />
          <circle cx={dv.x} cy={dv.y} r={7} fill="#55b9a8" />
        </svg>
        {[
          { txt: BEATS[0]!.title, dy: -110 },
          { txt: BEATS[4]!.title, dy: 90 },
        ].map((c) => (
          <p
            key={c.txt}
            className="absolute rounded-full border border-signal bg-midnight/90 px-5 py-2 font-display text-[24px] font-bold whitespace-nowrap text-ivory"
            style={{ left: dv.x + 250, top: dv.y + c.dy - 24 }}
          >
            {c.txt}
          </p>
        ))}
      </div>

      {/* pipeline */}
      <div className="absolute flex items-center" style={{ left: 110, right: 110, top: 196, opacity: pipeOn }}>
        {PIPE.map((n, i) => (
          <div key={n} className="flex flex-1 items-center last:flex-none">
            <p
              className="rounded-full border px-5 py-2.5 font-display text-[21px] font-bold whitespace-nowrap"
              style={{
                borderColor: `rgba(85,185,168,${0.35 + 0.65 * lit(i)})`,
                background: `rgba(35,54,66,${0.85})`,
                color: lit(i) > 0.5 ? "#b0e4d8" : "#f2f0e9",
              }}
            >
              {n}
            </p>
            {i < PIPE.length - 1 ? (
              <span className="relative mx-3 h-px flex-1 bg-ivory/25">
                <span
                  className="absolute top-1/2 -mt-1.5 size-3 rounded-full bg-signal"
                  style={{ left: `${clamp01(pulse * 3 - i) * 100}%`, opacity: clamp01(pulse * 3 - i) > 0 && clamp01(pulse * 3 - i) < 1 ? 1 : 0 }}
                />
                <span className="absolute inset-y-0 left-0 bg-signal" style={{ width: `${clamp01(pulse * 3 - i) * 100}%` }} />
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {/* event card (same structure and classes as the landing's notification) */}
      <div className="absolute" style={{ right: 110, top: 330, width: 640, ...fx(t, 11.85, 14.05, { fi: 0.5, fo: 0.25, rise: 30 }) }}>
        <div style={{ zoom: 1.8 }}>
          <div className="flex flex-col gap-3 rounded-2xl border border-ivory/15 bg-graphite p-4 shadow-stage-card md:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <CapabilityTag kind="simulated" tone="dark" />
              <span className="text-xs text-ivory/75">{FALL.notification.title}</span>
            </div>
            <p className="font-medium">{FALL.notification.body}</p>
            <p className="text-xs text-mint" style={{ opacity: sm(t, 12.45, 12.8) }}>
              {acknowledged ? FALL.acknowledged : FALL.notification.flag}
            </p>
            <span
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full border px-4 text-sm font-bold whitespace-nowrap",
                acknowledged ? "border-ivory/20 text-ivory/70" : "border-ivory/35 text-ivory",
              )}
              style={{
                opacity: sm(t, 12.7, 13.0),
                transform: `translateY(${press * 1.5}px) scale(${1 - press * 0.05})`,
                background: press > 0.05 ? "rgba(85,185,168,0.35)" : undefined,
                borderColor: press > 0.05 ? "#55b9a8" : undefined,
              }}
            >
              {acknowledged ? (
                <>
                  <Check className="size-4" aria-hidden />
                  Đã tiếp nhận
                </>
              ) : (
                FALL.notification.action
              )}
            </span>
          </div>
        </div>
      </div>

      {/* step chips as in the landing panel */}
      <div className="absolute flex gap-3 rounded-[28px] bg-midnight/80 p-3" style={{ left: 98, bottom: 58, ...fx(t, 8.6, 14, { rise: 10 }) }}>
        {FALL.steps.map((s, i) => (
          <span
            key={s.id}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-6 py-3 text-[22px] font-medium",
              i === step ? "border-signal bg-signal text-midnight" : "border-ivory/30 text-ivory",
            )}
          >
            <span className="font-mono text-[18px]">{i + 1}</span>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== Scene 4 · Medication (tình huống 02) */
const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;
const DAY = 24 * 60;
const pct = (m: number) => `${(m / DAY) * 100}%`;
const stateStyle = {
  waiting: "border border-ink/35 bg-transparent text-ink",
  open: "border-2 border-teal-deep bg-teal-deep/10 text-ink",
  observed: "border border-teal-deep bg-teal-deep text-paper",
  missed: "border-2 border-dashed border-ink bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgb(38_54_62/0.16)_5px_7px)] text-ink",
} as const;

export function MedicationOverlay({ d }: { d: FrameData }) {
  const { t } = d;
  if (t < 13.8 || t > 19.7) return null;
  const A = win(t, 13.95, 15.75, 0.25, 0.4);
  const now = track(t, [[14.1, 6 * 60], [14.95, 8 * 60 - 6], [15.55, 8 * 60 + 5]], (x) => x);
  const noon = MEDICATION.slots[1]!;
  void noon;
  return (
    <div className="absolute inset-0">
      {/* Part A: scheduled reminder on the example day */}
      <div className="absolute inset-0" style={{ opacity: A, background: "radial-gradient(70% 70% at 50% 40%, #1a2d38 0%, #14232d 75%)" }}>
        <div className="absolute" style={{ left: 110, top: 150, width: 1750, ...fx(t, 14.0, 15.75, { fi: 0.4, fo: 0.3, rise: 18 }) }}>
          <h2 className="font-display text-[72px] leading-[1.06] font-extrabold tracking-tight text-ivory">{MEDICATION.heading}</h2>
        </div>

        <div className="absolute" style={{ left: 110, top: 440, width: 1700, ...fx(t, 14.2, 15.75, { fi: 0.45, fo: 0.3, rise: 36 }) }}>
          <div style={{ zoom: 1.78, width: 950 }}>
            <div className="rounded-3xl border border-ink/12 bg-ivory p-5 text-ink md:p-8">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <p className="font-display text-lg font-bold">{MEDICATION.demoLabel.split(":")[0]}</p>
              </div>
              <div className="relative mx-1 h-20">
                <div className="absolute inset-x-0 top-9 h-px bg-ink/30" />
                {[0, 6, 12, 18, 24].map((h) => (
                  <div key={h} className="absolute top-8 flex -translate-x-1/2 flex-col items-center gap-1 font-mono text-[11px] text-ink/75" style={{ left: pct(h * 60) }}>
                    <span className="block h-2 w-px bg-ink/45" />
                    {String(h).padStart(2, "0")}h
                  </div>
                ))}
                {MEDICATION.slots.map((s) => (
                  <div key={s.id} className={cn("absolute top-1 h-6 rounded-full", stateStyle[slotState(s, now)])} style={{ left: pct(s.scheduled), width: pct(MEDICATION.windowMinutes) }} />
                ))}
                <div className="absolute top-0 bottom-0 w-px bg-teal-deep" style={{ left: pct(now) }}>
                  <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full rounded-full bg-teal-deep px-2 py-0.5 font-mono text-[11px] whitespace-nowrap text-paper">{fmt(now)}</span>
                </div>
              </div>

              {/* the reminder: set by the caregiver, spoken by the device speaker */}
              <div className="relative h-12" style={{ opacity: sm(t, 14.85, 15.15) }}>
                <div className="absolute flex items-center gap-2 rounded-full bg-teal-deep px-3 py-1.5 text-xs font-bold whitespace-nowrap text-paper" style={{ left: pct(8 * 60 + 40), top: 0, transform: "translateX(-50%)" }}>
                  <Volume2 className="size-4" aria-hidden />
                  Loa có thể nhắc nhẹ
                  <span className="ml-1 font-mono font-medium opacity-90">08:00</span>
                </div>
              </div>

              <ul className="mt-3 grid gap-4 md:grid-cols-3">
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
          </div>
          <p className="mt-6 font-mono text-[22px] tracking-[0.06em] text-ivory/80" style={{ opacity: sm(t, 14.7, 15.0) }}>
            Giờ nhắc do người chăm sóc đặt.
          </p>
        </div>
      </div>

      <MedicationScenePart d={d} />
      <ScenarioCaption t={t} a={14.0} b={19.5} title={MEDICATION.eyebrow} />
    </div>
  );
}

function MedicationScenePart({ d }: { d: FrameData }) {
  const { t } = d;
  if (t < 15.4) return null;
  const f = d.medAnchors;
  const step = f ? Math.min(3, f.step) : 0;
  const on = win(t, 15.5, 19.5, 0.45, 0.3);
  const lab = (key: "device" | "hub", text: string) => {
    if (!f) return null;
    const a = f.anchors[key];
    const o = f.labels[key];
    if (!a.visible || o <= 0.01) return null;
    return (
      <p
        key={key}
        className="absolute rounded-full bg-midnight/90 px-5 py-2 font-mono text-[18px] tracking-[0.12em] whitespace-nowrap text-ivory uppercase"
        style={{ left: a.x, top: a.y, transform: "translate(-50%, -140%)", opacity: o }}
      >
        {text}
      </p>
    );
  };
  // observation note (the interface)
  const note = win(t, 17.75, 19.55, 0.5, 0.25);
  return (
    <div className="absolute inset-0" style={{ opacity: on }}>
      {lab("device", MEDICATION.scene.deviceLabel)}
      {lab("hub", MEDICATION.scene.hubLabel)}

      <div className="absolute flex gap-3 rounded-[28px] bg-midnight/80 p-3" style={{ left: 98, bottom: 58, ...fx(t, 15.6, 19.5, { rise: 10 }) }}>
        {MEDICATION.scene.steps.map((s, i) => (
          <span
            key={s.id}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-6 py-3 text-[22px] font-medium",
              i === step ? "border-signal bg-signal text-midnight" : "border-ivory/30 text-ivory",
            )}
          >
            <span className="font-mono text-[18px]">{i + 1}</span>
            {s.label}
          </span>
        ))}
      </div>

      {/* observation note, a caregiver-facing card: AI/hub description, not a confirmation */}
      <div className="absolute" style={{ right: 110, top: 150, width: 700, opacity: note, transform: `translateY(${(1 - note) * 34}px)` }}>
        <div style={{ zoom: 1.8 }}>
          <div className="flex flex-col gap-2.5 rounded-2xl border border-ivory/15 bg-graphite p-4 shadow-stage-card md:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <CapabilityTag kind="simulated" tone="dark" />
              <span className="font-mono text-xs text-ivory/85">08:12</span>
            </div>
            <p className="font-display text-base font-bold">{DAILY_REPORT.events[1]!.title}</p>
            <p className="text-sm text-ivory/90">{DAILY_REPORT.events[1]!.note}</p>
            <span className="inline-flex min-h-6 w-fit items-center rounded-full border border-ivory/40 px-2.5 text-xs text-ivory/90">{MEDICATION.states.observed.label}</span>
            <p className="text-xs text-mint">{DAILY_REPORT.footnote}</p>
          </div>
        </div>
      </div>

    </div>
  );
}

/* ================================================================== Scene 5 · Privacy */
export function PrivacyOverlay({ d }: { d: FrameData }) {
  const { t } = d;
  if (t < 19.3 || t > 23.8) return null;
  const root = win(t, 19.55, 23.5, 0.35, 0.3);
  const dim = sm(t, 19.7, 20.3);
  const k = sm(t, 20.35, 21.2); // image data -> text
  const card = win(t, 20.95, 23.55, 0.45, 0.3);
  const rows = [
    { a: 21.25, icon: <Check className="size-7" strokeWidth={3} />, kind: "yes", text: "Ứng dụng chỉ hiển thị mô tả sự kiện." },
    { a: 21.9, icon: <Minus className="size-7" strokeWidth={3} />, kind: "no", text: "Không có ảnh/video hay camera trực tiếp trong ứng dụng." },
    { a: 22.5, icon: <Power className="size-7" strokeWidth={3} />, kind: "sw", text: "Người được chăm sóc có công tắc BẬT/TẮT vật lý." },
  ] as const;
  return (
    <div className="absolute inset-0" style={{ opacity: root }}>
      <div className="absolute inset-0" style={{ opacity: dim, background: "linear-gradient(90deg, rgba(10,19,25,0.97) 0%, rgba(12,23,30,0.94) 52%, rgba(14,27,35,0.84) 100%)" }} />

      <p className="absolute font-mono text-[22px] font-medium tracking-[0.18em] text-signal uppercase" style={{ left: 110, top: 100, ...fx(t, 19.7, 23.5, { rise: 10 }) }}>
        {PRIVACY.eyebrow}
      </p>
      <h2 className="absolute font-display text-[96px] leading-[1.04] font-extrabold tracking-tight text-ivory" style={{ left: 110, top: 160, width: 900, ...fx(t, 19.75, 23.5, { fi: 0.5, rise: 26, blur: 8 }) }}>
        {PRIVACY.heading}
      </h2>

      <ul className="absolute flex flex-col gap-8" style={{ left: 110, top: 520, width: 900 }}>
        {rows.map((r) => (
          <li key={r.text} className="flex items-start gap-5" style={fx(t, r.a, 23.5, { fi: 0.4, rise: 22 })}>
            <span
              className={cn(
                "mt-1 flex size-12 shrink-0 items-center justify-center rounded-full",
                r.kind === "yes" ? "bg-signal text-midnight" : r.kind === "sw" ? "bg-ivory text-midnight" : "border-2 border-ivory/70 text-ivory",
              )}
            >
              {r.icon}
            </span>
            <p className="font-display text-[38px] leading-snug font-bold text-ivory">{r.text}</p>
          </li>
        ))}
      </ul>

      {/* image data becomes text */}
      <div className="absolute" style={{ left: 1130, top: 140, width: 680 }}>
        <ImageToText k={k} t={t} />
      </div>

      <div className="absolute" style={{ left: 1130, top: 450, width: 680, opacity: card, transform: `translateY(${(1 - card) * 30}px)` }}>
        <div style={{ zoom: 1.7 }}>
          <div className="flex flex-col gap-2.5 rounded-2xl border border-ivory/15 bg-graphite p-4 shadow-stage-card md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CapabilityTag kind="simulated" tone="dark" />
              <span className="font-mono text-[11px] tracking-[0.12em] text-ivory/80 uppercase">Ứng dụng CareLens AI</span>
            </div>
            <p className="font-display text-base font-bold">{DAILY_REPORT.events[1]!.title}</p>
            <p className="text-sm text-ivory/90">{DAILY_REPORT.events[1]!.note}</p>
            <p className="text-xs text-mint">{DAILY_REPORT.footnote}</p>
            <p className="mt-1 flex items-center gap-2 border-t border-ivory/15 pt-3 text-xs text-ivory/90" style={{ opacity: sm(t, 22.7, 23.0) }}>
              <ShieldCheck className="size-4 shrink-0 text-signal" aria-hidden />
              Mỗi người chỉ xem hồ sơ được cấp quyền.
            </p>
          </div>
        </div>
      </div>

      {/* flow strip: honest, illustrative */}
      <div className="absolute" style={{ left: 110, right: 110, bottom: 70, ...fx(t, 20.2, 23.5, { rise: 8 }) }}>
        <div className="flex items-center gap-4 font-display text-[21px] font-bold text-ivory">
          {["Camera đeo ngực", "Hub trong nhà", "Máy chủ đám mây CareLens AI", "Ứng dụng: chỉ mô tả văn bản"].map((n, i, a) => (
            <div key={n} className="flex items-center gap-4">
              <span className="rounded-full border border-ivory/35 bg-graphite px-5 py-2.5 whitespace-nowrap" style={{ borderColor: i === a.length - 1 ? "#55b9a8" : undefined }}>
                {n}
              </span>
              {i < a.length - 1 ? <span className="h-px w-12 bg-ivory/30" /> : null}
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[17px] tracking-[0.05em] text-ivory/65">Minh hoạ luồng dữ liệu, không phải bằng chứng kỹ thuật về bảo mật.</p>
      </div>
    </div>
  );
}

/** A small mosaic ("image data") that collapses into lines of text. Illustrative only. */
function ImageToText({ k, t }: { k: number; t: number }) {
  const rowsN = 7;
  const palette = ["#233642", "#2f4b57", "#55b9a8", "#b0e4d8", "#3d6b6a", "#f2f0e9", "#6e8f93", "#1a2d38"];
  const widths = [0.94, 0.78, 0.86, 0.6, 0.9, 0.7, 0.45];
  const grid = 12;
  const on = win(t, 20.2, 23.5, 0.3, 0.3);
  return (
    <div style={{ opacity: on }}>
      <p className="mb-4 font-mono text-[18px] tracking-[0.16em] text-ivory/75 uppercase">{k < 0.5 ? "Dữ liệu hình ảnh" : "Mô tả dạng văn bản"}</p>
      <div className="flex flex-col" style={{ gap: lerp(0, 16, k) }}>
        {Array.from({ length: rowsN }).map((_, r) => {
          const stops = Array.from({ length: grid }).map((__, c) => {
            const col = palette[(r * 5 + c * 3 + ((r * c) % 4)) % palette.length]!;
            return `${col} ${(c / grid) * 100}% ${((c + 1) / grid) * 100}%`;
          });
          const w = lerp(1, widths[r]!, k);
          return (
            <div key={r} className="relative" style={{ width: `${w * 100}%`, height: lerp(26, 13, k), borderRadius: lerp(2, 8, k), overflow: "hidden" }}>
              <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${stops.join(", ")})`, opacity: 1 - k }} />
              <div className="absolute inset-0" style={{ background: "rgba(242,240,233,0.86)", opacity: k }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { CSSProperties };
