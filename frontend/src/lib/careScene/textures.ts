import { CanvasTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from "three";

/**
 * Hoa văn vải và tóc sinh bằng code (không tệp ảnh, không giấy phép, không tốn băng thông): mỗi hoa văn là một bản đồ độ cao nhỏ (256 px, lặp),
 * đổi thành bản đồ pháp tuyến để vải len, vải quần và sợi tóc có thớ nhìn rõ ở cận cảnh nhưng hoà vào màu phẳng khi xa (mipmap + lọc dị hướng),
 * nên không có nhiễu moiré. Hàm thuần của tham số và hạt giống cố định: cùng kết quả mỗi lần dựng.
 */

export interface FabricMaps {
  /** Màu xám nhân với màu vật liệu (rãnh tối hơn đỉnh một chút, như ao cục bộ). */
  map: CanvasTexture;
  normalMap: CanvasTexture;
}

const SIZE = 256;

/** Bộ sinh số giả ngẫu nhiên cố định (mulberry32). */
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

/**
 * Canvas 2D kích thước `w × h`, hoặc `null` khi không có (kiểm thử jsdom, máy chủ): khi đó không có hoa văn, vật liệu vẫn dùng được với màu phẳng.
 * Không gọi `getContext` ở jsdom để khỏi in cảnh báo "not implemented" cho mỗi texture.
 */
export function canvas2d(w: number, h = w): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined" || (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent))) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    // Không có canvas 2D.
  }
  return ctx ? { canvas, ctx } : null;
}

function makeCanvas() {
  return canvas2d(SIZE);
}

/** Bản đồ độ cao (0–1, SIZE × SIZE, lặp) → cặp bản đồ màu xám và pháp tuyến. */
function toMaps(height: Float32Array, strength: number, shade: number): FabricMaps | null {
  const c1 = makeCanvas();
  const c2 = makeCanvas();
  if (!c1 || !c2) return null;
  const img = c1.ctx.createImageData(SIZE, SIZE);
  const nrm = c2.ctx.createImageData(SIZE, SIZE);
  const at = (x: number, y: number) => height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)]!;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const h = at(x, y);
      const g = Math.round(255 * (1 - shade + shade * h));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
      // Sobel nhỏ (3 × 3), lặp qua mép. Trục v của texture ngược chiều hàng ảnh nên dấu của thành phần y đã đảo.
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
      let nx = -dx * strength;
      let ny = dy * strength;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nrm.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      nrm.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      nrm.data[i + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
      nrm.data[i + 3] = 255;
    }
  }
  c1.ctx.putImageData(img, 0, 0);
  c2.ctx.putImageData(nrm, 0, 0);
  const finish = (t: CanvasTexture, srgb: boolean) => {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    t.anisotropy = 8;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  return { map: finish(new CanvasTexture(c1.canvas), true), normalMap: finish(new CanvasTexture(c2.canvas), false) };
}

/** Len đan: hàng mắt chữ V xếp dọc, mỗi mắt hai chân nghiêng gặp nhau ở đáy. */
function knitHeight(): Float32Array {
  const h = new Float32Array(SIZE * SIZE);
  const cells = 16;
  const cell = SIZE / cells;
  const rand = rng(11);
  const wobble = new Float32Array(cells * cells).map(() => 0.9 + 0.1 * rand());
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const u = (x % cell) / cell;
      const v = 1 - (y % cell) / cell; // đáy chữ V ở v = 0
      const dl = Math.abs(u - (0.5 - 0.5 * v));
      const dr = Math.abs(u - (0.5 + 0.5 * v));
      const leg = (d: number) => Math.max(0, 1 - d / 0.24) ** 1.4;
      h[y * SIZE + x] = Math.min(1, Math.max(leg(dl), leg(dr))) * wobble[cy * cells + cx]!;
    }
  }
  return h;
}

/** Vải quần: dệt chéo (twill) mịn. */
function twillHeight(): Float32Array {
  const h = new Float32Array(SIZE * SIZE);
  const rand = rng(23);
  const grain = new Float32Array(SIZE * SIZE).map(() => rand());
  const period = 8;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = ((x + y) % period) / period;
      const ridge = 0.5 + 0.5 * Math.cos(d * Math.PI * 2);
      h[y * SIZE + x] = 0.82 * ridge + 0.18 * grain[y * SIZE + x]!;
    }
  }
  return h;
}

/** Sợi tóc: vệt dọc dài, độ đậm đổi chậm theo chiều dọc; lặp theo chiều ngang. */
function hairHeight(): Float32Array {
  const h = new Float32Array(SIZE * SIZE);
  const rand = rng(37);
  const cols = 128;
  const base = new Float32Array(cols).map(() => rand());
  const drift = new Float32Array(cols * 8).map(() => rand());
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = Math.floor((x / SIZE) * cols);
      const band = Math.floor((y / SIZE) * 8);
      const t = (y / SIZE) * 8 - band;
      const a = drift[c * 8 + band]!;
      const b = drift[c * 8 + ((band + 1) % 8)]!;
      const strand = base[c]! * 0.6 + (a + (b - a) * t) * 0.4;
      const edge = Math.abs(((x / SIZE) * cols) % 1 - 0.5) * 2; // sợi tròn: gờ ở giữa
      h[y * SIZE + x] = strand * (1 - 0.35 * edge * edge);
    }
  }
  return h;
}

export interface FigureTextures {
  knit: FabricMaps;
  twill: FabricMaps;
  hair: FabricMaps;
}

let cache: FigureTextures | null | undefined;

/** Hoa văn dùng chung cho mọi hình người (sinh một lần). `null` khi không có canvas 2D (kiểm thử, máy chủ). */
export function getFigureTextures(): FigureTextures | null {
  if (cache !== undefined) return cache;
  const knit = toMaps(knitHeight(), 2.6, 0.22);
  const twill = toMaps(twillHeight(), 1.6, 0.18);
  const hair = toMaps(hairHeight(), 1.8, 0.25);
  cache = knit && twill && hair ? { knit, twill, hair } : null;
  return cache;
}
