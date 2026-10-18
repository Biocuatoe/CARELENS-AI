import { Wordmark } from "@fe/features/landing/Brand";
import { easeOut, lerp, sm, sm5 } from "./timing";
import { fx } from "./Overlay";

/** Scene 7: the 20/10 greeting card. It opens like an iris from the centre of the photographic flash, so it grows out of the lens. */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PETAL_COLORS = ["#f7b9c6", "#f2909f", "#fbd6cb", "#f5a9a3", "#ffe4d8", "#eb7f93"];
const PETALS = (() => {
  const r = rng(2010);
  return Array.from({ length: 46 }, () => ({
    x0: r() * 1920,
    y0: r() * 1300 - 150,
    v: 36 + r() * 70,
    amp: 40 + r() * 90,
    w: 0.5 + r() * 0.9,
    ph: r() * 6.28,
    drift: -20 + r() * 40,
    size: 16 + r() * 30,
    spin: (r() - 0.5) * 2.2,
    rot0: r() * 360,
    tumble: 1.2 + r() * 1.8,
    col: PETAL_COLORS[Math.floor(r() * PETAL_COLORS.length)]!,
    op: 0.55 + r() * 0.4,
    blur: r() > 0.8 ? 3 + r() * 3 : 0,
  }));
})();

function Blossom({ x, y, size, rot, op }: { x: number; y: number; size: number; rot: number; op: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${size})`} opacity={op}>
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} transform={`rotate(${i * 72})`} d="M0 0 C-0.55 -0.35 -0.62 -1.05 0 -1.15 C0.62 -1.05 0.55 -0.35 0 0Z" fill="url(#bl)" stroke="#f1a3b0" strokeWidth={0.01} />
      ))}
      <circle r={0.1} fill="#f6c768" />
    </g>
  );
}

export function Greeting({ t }: { t: number }) {
  if (t < 25.9) return null;
  const open = easeOut(sm(t, 25.98, 27.0));
  const r = lerp(0, 1650, open);
  const tt = t - 25.9;
  return (
    <div className="absolute inset-0" style={{ WebkitMaskImage: `radial-gradient(circle at 50% 50%, #000 ${Math.max(0, r - 20)}px, transparent ${r + 340}px)`, maskImage: `radial-gradient(circle at 50% 50%, #000 ${Math.max(0, r - 20)}px, transparent ${r + 340}px)`, background: "radial-gradient(120% 105% at 50% 30%, #fff9f1 0%, #fdeadf 42%, #f7d2c8 78%, #efbdb7 100%)" }}>
      {/* warm light */}
      <div className="absolute" style={{ left: 260, top: -120, width: 1400, height: 900, opacity: 0.7, background: "radial-gradient(closest-side, rgba(255,236,196,0.9), rgba(255,236,196,0))" }} />
      <div className="absolute" style={{ left: -200, top: 560, width: 800, height: 700, opacity: 0.5, background: "radial-gradient(closest-side, rgba(247,185,198,0.8), rgba(247,185,198,0))" }} />
      <div className="absolute" style={{ left: 1350, top: 420, width: 800, height: 700, opacity: 0.45, background: "radial-gradient(closest-side, rgba(255,215,170,0.8), rgba(255,215,170,0))" }} />

      <svg className="absolute inset-0" width={1920} height={1080}>
        <defs>
          <radialGradient id="bl" cx="50%" cy="85%" r="90%">
            <stop offset="0%" stopColor="#fff0ee" />
            <stop offset="100%" stopColor="#f4a6b4" />
          </radialGradient>
          <linearGradient id="pt" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Blossom x={150} y={150} size={150} rot={tt * 3} op={0.85 * sm(t, 26.6, 27.4)} />
        <Blossom x={1790} y={950} size={170} rot={-tt * 3 + 20} op={0.85 * sm(t, 26.7, 27.5)} />
        <Blossom x={1810} y={170} size={70} rot={tt * 4} op={0.6 * sm(t, 26.8, 27.6)} />
        <Blossom x={120} y={930} size={64} rot={-tt * 4} op={0.6 * sm(t, 26.9, 27.7)} />
        {PETALS.map((p, i) => {
          const dt = t - 25.9;
          const y = ((p.y0 + p.v * dt + 200) % 1380) - 200;
          const x = p.x0 + Math.sin(p.w * dt + p.ph) * p.amp + p.drift * dt * 0.3;
          const rot = p.rot0 + p.spin * dt * 60;
          const tumble = Math.cos(p.tumble * dt + p.ph);
          const o = p.op * sm(t, 26.3 + (i % 9) * 0.06, 27.2 + (i % 9) * 0.06);
          return (
            <g key={i} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${(p.size * (0.35 + 0.65 * Math.abs(tumble))).toFixed(2)} ${p.size.toFixed(2)})`} opacity={o} style={p.blur ? { filter: `blur(${p.blur}px)` } : undefined}>
              <path d="M0 -1 C0.85 -0.55 0.9 0.55 0 1 C-0.9 0.55 -0.85 -0.55 0 -1Z" fill={p.col} />
              <path d="M0 -1 C0.85 -0.55 0.9 0.55 0 1 C-0.9 0.55 -0.85 -0.55 0 -1Z" fill="url(#pt)" />
            </g>
          );
        })}
      </svg>

      <div className="absolute inset-x-0 flex flex-col items-center text-center" style={{ top: 150, color: "#5b2c3f" }}>
        <h1 className="flex flex-col items-center">
          <span className="font-display text-[88px] leading-[1.08] font-extrabold tracking-tight" style={fx(t, 26.55, 99, { fi: 0.7, rise: 34, blur: 10 })}>
            Chúc mừng Ngày Phụ nữ Việt Nam
          </span>
          <span
            className="mt-3 font-display text-[250px] leading-[0.95] font-extrabold tracking-tight"
            style={{
              ...fx(t, 26.8, 99, { fi: 0.8, rise: 26, blur: 14 }),
              backgroundImage: "linear-gradient(180deg, #e0647f 0%, #b93a63 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              transform: `scale(${lerp(0.9, 1, easeOut(sm(t, 26.8, 27.7)))})`,
            }}
          >
            20/10
          </span>
        </h1>
        <p className="mt-9 max-w-[1500px] font-display text-[42px] leading-snug font-medium" style={{ color: "#7a3b50", ...fx(t, 27.45, 99, { fi: 0.7, rise: 20 }) }}>
          Trân trọng những người luôn yêu thương và chăm sóc chúng ta.
        </p>
      </div>

      <div className="absolute inset-x-0 flex flex-col items-center gap-3" style={{ bottom: 66, color: "#5b2c3f", ...fx(t, 28.2, 99, { fi: 0.7, rise: 12 }) }}>
        <Wordmark className="text-[40px] [&_svg]:size-11" />
        <p className="font-mono text-[18px] tracking-[0.26em] uppercase" style={{ color: "#8a5568" }}>
          Kena CI
        </p>
      </div>
      <span className="hidden">{sm5(t, 0, 1)}</span>
    </div>
  );
}
