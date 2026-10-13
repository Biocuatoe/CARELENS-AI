import { CanvasTexture, ClampToEdgeWrapping, LinearMipmapLinearFilter, SRGBColorSpace } from "three";
import { canvas2d } from "./textures";

/**
 * Lớp vẽ mặt (không phải ảnh có sẵn, không có tệp): hình khối của mặt do lưới đầu đảm nhiệm, còn sắc độ và nét nhỏ — hốc mắt, túi mắt, nếp mi, lông mày,
 * môi, rãnh mũi-má, nếp trán, đuôi mắt — được vẽ mềm bằng canvas rồi chiếu thẳng từ phía trước lên đầu. Nét vẽ mảnh và nhạt (người lớn tuổi, chừng mực).
 * Hàm thuần của tham số, hạt giống cố định: cùng một ảnh mỗi lần dựng. Không có canvas (kiểm thử) thì trả `null` và đầu dùng màu đỉnh.
 */

/** Hộp chiếu: x ∈ [−HALF_W, HALF_W], y ∈ [−HALF_H, HALF_H] (m), quanh tâm hộp sọ. */
export const FACE_UV = { halfW: 0.085, halfH: 0.115 } as const;

const SIZE = 1024;

export interface FacePaintSpec {
  skin: string;
  eyeX: number;
  eyeY: number;
  mouthY: number;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let cache: { key: string; tex: CanvasTexture | null } | null = null;

export function paintFace(spec: FacePaintSpec): CanvasTexture | null {
  const key = JSON.stringify(spec);
  if (cache && cache.key === key) return cache.tex;
  cache = { key, tex: draw(spec) };
  return cache.tex;
}

function draw(spec: FacePaintSpec): CanvasTexture | null {
  const made = canvas2d(SIZE);
  if (!made) return null;
  const { canvas, ctx } = made;

  const X = (x: number) => (x / (2 * FACE_UV.halfW) + 0.5) * SIZE;
  const Y = (y: number) => (0.5 - y / (2 * FACE_UV.halfH)) * SIZE;
  const SX = (d: number) => (d / (2 * FACE_UV.halfW)) * SIZE; // độ dài ngang (m) → px
  const SY = (d: number) => (d / (2 * FACE_UV.halfH)) * SIZE; // độ dài dọc (m) → px
  const rand = rng(5);

  // Nền da: sáng ở trán, ấm dần xuống má, hơi tối ở hàm.
  ctx.fillStyle = spec.skin;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const blob = (cx: number, cy: number, rx: number, ry: number, color: string, alpha: number) => {
    ctx.save();
    ctx.translate(X(cx), Y(cy));
    ctx.scale(SX(rx), SY(ry));
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, color);
    g.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  const rgba = (hex: string, a = 1) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  blob(0, 0.0, 0.08, 0.1, rgba("#f0cbb4"), 0.3); // mặt sáng đều, nhất là trán
  for (const s of [1, -1]) {
    blob(0.044 * s, -0.03, 0.026, 0.02, rgba("#c8786a"), 0.34); // hồng má
    blob(0.052 * s, -0.062, 0.02, 0.026, rgba("#8f6355"), 0.11); // hõm má dưới gò má
    blob(spec.eyeX * s, spec.eyeY + 0.001, 0.02, 0.0135, rgba("#9a6c5c"), 0.22); // hốc mắt
    blob(spec.eyeX * s, spec.eyeY - 0.0125, 0.0175, 0.0062, rgba("#8c6670"), 0.26); // túi mắt hơi xám tím
    blob(0.01 * s, spec.eyeY + 0.0065, 0.009, 0.007, rgba("#8f6254"), 0.26); // góc mắt trong, bên sống mũi
  }
  blob(0, -0.097, 0.05, 0.018, rgba("#6a4638"), 0.15); // dưới cằm
  blob(0, -0.075, 0.06, 0.03, rgba("#7a5444"), 0.04); // hàm

  // Nét mảnh mềm: đi theo đường cong, viền mờ nhờ shadowBlur.
  const soft = (pts: Array<[number, number]>, color: string, width: number, alpha: number, blur: number) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y))));
    ctx.stroke();
    ctx.restore();
  };
  const curve = (f: (t: number) => [number, number], n = 24): Array<[number, number]> => Array.from({ length: n + 1 }, (_, i) => f(i / n));

  for (const s of [1, -1]) {
    const ex = spec.eyeX;
    const ey = spec.eyeY;
    // Nếp mi trên (hơi nặng): vòng cung phía trên mắt.
    soft(curve((t) => [s * (ex - 0.017 + 0.034 * t), ey + 0.0105 + 0.0075 * Math.sin(Math.PI * t) - 0.002 * t]), "#6f4a3f", SX(0.0008), 0.5, 5);
    // Đuôi mắt: ba nếp rất nhạt toả ra.
    for (let k = 0; k < 3; k++) {
      const a = -0.35 + k * 0.3;
      soft([[s * (ex + 0.0185), ey + 0.0005], [s * (ex + 0.0185 + 0.011 * Math.cos(a)), ey + 0.0005 + 0.011 * Math.sin(a)]], "#7c5547", SX(0.00055), 0.2, 3);
    }
    // Rãnh mũi-má: từ cánh mũi xuống khoé miệng, nông.
    soft(curve((t) => [s * (0.0155 + 0.012 * t), -0.026 - 0.04 * t]), "#7a4f43", SX(0.0022), 0.17, 12);
    // Nếp khoé miệng.
    soft([[s * 0.0235, spec.mouthY + 0.001], [s * 0.0272, spec.mouthY - 0.0085]], "#7a4f43", SX(0.0011), 0.22, 4);
    // Bóng cạnh sống mũi.
    soft([[s * 0.0075, 0.012], [s * 0.0095, -0.02], [s * 0.0125, -0.036]], "#7d5648", SX(0.004), 0.1, 14);
  }
  // Nếp trán: hai đường ngang rất nhạt.
  for (const y of [0.046, 0.057]) soft(curve((t) => [(t - 0.5) * 0.085, y + 0.0025 * Math.sin(t * 6.3)]), "#8a6354", SX(0.0007), 0.09, 6);
  // Bóng dưới chóp mũi.
  blob(0, -0.0385, 0.0125, 0.0045, rgba("#5a3a30"), 0.42);

  // Lông mày bạc: nhiều sợi ngắn xếp theo đường cong của mày, dày ở đầu mày và thưa dần về đuôi.
  for (const s of [1, -1]) {
    const brow = (t: number): [number, number] => [s * (0.012 + 0.047 * t), 0.0262 + 0.0125 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.08)) - 0.007 * t * t];
    soft(curve(brow, 18), "#8b8379", SX(0.0036), 0.28, 8);
    for (let i = 0; i < 260; i++) {
      const t = rand() ** 1.25;
      const [bx, by] = brow(t);
      const next = brow(Math.min(1, t + 0.02));
      const dx = (next[0] - bx) * s;
      const dy = next[1] - by;
      const ang = Math.atan2(dy, dx) + (0.25 - 0.4 * t) * (rand() - 0.2);
      const len = 0.0034 + 0.0024 * rand();
      const w = (0.00075 + 0.0005 * rand()) * (1 - 0.4 * t);
      const ox = (rand() - 0.5) * 0.0026 * (1 - t * 0.5);
      const oy = (rand() - 0.5) * 0.0034 * (1 - t * 0.6);
      const col = rand() < 0.5 ? "#c9c5bb" : "#a8a398";
      soft([[bx + ox, by + oy], [bx + ox + Math.cos(ang) * len * s, by + oy + Math.sin(ang) * len]], col, SX(w), 0.55, 0);
    }
  }

  // Môi: hình mềm từ đường cong, màu hồng nâu dịu, môi dưới đầy hơn, đường miệng sẫm.
  const m = spec.mouthY;
  const lipShape = (top: Array<[number, number]>, bottom: Array<[number, number]>, color: string, alpha: number, blur: number) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.beginPath();
    top.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y))));
    [...bottom].reverse().forEach(([x, y]) => ctx.lineTo(X(x), Y(y)));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  const halfW = 0.0225;
  const upperTop = curve((t) => {
    const x = (t * 2 - 1) * halfW;
    const bow = 0.0072 * Math.exp(-(((t * 2 - 1) * 0.9) ** 2) * 3) + 0.0014; // cung Cupid nông
    return [x, m + bow * (1 - Math.abs(t * 2 - 1) ** 2.2) + 0.0006];
  }, 28);
  const centre = curve((t) => [(t * 2 - 1) * halfW, m - 0.0012 * (1 - Math.abs(t * 2 - 1) ** 2) - 0.0014 * Math.abs(t * 2 - 1) ** 2], 28);
  const lowerBottom = curve((t) => [(t * 2 - 1) * (halfW * 0.88), m - 0.0105 * (1 - Math.abs(t * 2 - 1) ** 2.1) - 0.0016], 28);
  lipShape(upperTop, centre, "#a86a60", 0.75, 5);
  lipShape(centre, lowerBottom, "#b97a70", 0.8, 6);
  // Ánh sáng nhẹ trên môi dưới và bóng dưới môi dưới.
  soft(curve((t) => [(t * 2 - 1) * halfW * 0.5, m - 0.0042 - 0.001 * (1 - Math.abs(t * 2 - 1))]), "#e3b3a6", SX(0.0013), 0.3, 6);
  soft(curve((t) => [(t * 2 - 1) * halfW * 0.6, m - 0.0128]), "#6b463b", SX(0.002), 0.26, 8);
  // Đường miệng.
  soft(centre, "#5f352d", SX(0.00085), 0.8, 2);
  // Nhân trung.
  soft([[0, m + 0.0095], [0, 0.0 - 0.0405]], "#8a5c50", SX(0.0016), 0.14, 6);

  // Hạt da rất nhẹ: nhiễu nhỏ để da không phẳng hoàn toàn khi đứng gần (không phải nốt hay vết).
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const n = rng(77);
  for (let i = 0; i < img.data.length; i += 4) {
    const d = (n() - 0.5) * 7;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + d));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + d));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + d));
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
