/**
 * Lưới tổ ong của gói dữ liệu ở chương bảo vệ: mặt ảnh thu nhỏ của chính gói được lát thành các ô lục giác (màu lấy từ ảnh đó),
 * các ô tản ra một chút rồi hội tụ thành một dải ngắn tám ô mang chuỗi ký tự dạng mã băm.
 * Hàm thuần, không phụ thuộc three.js hay DOM: cùng tiến trình luôn cho cùng vị trí, kể cả khi cuộn ngược.
 *
 * Đây là hình minh hoạ: không có bước băm, mã hoá hay ẩn danh hoá nào của hệ thống thật được mô phỏng ở đây.
 */

export interface HexCell {
  /** Tâm ô trên mặt thẻ (m, hệ cục bộ của gói ở độ lớn 1, mặt thẻ là mặt phẳng z = 0 của lớp lưới). */
  x: number;
  y: number;
  /** Độ lệch sâu khi tản ra (m), cố định theo chỉ số ô. */
  depth: number;
  /** Ô đích trong dải rút gọn; ô đại diện là ô duy nhất còn lại ở ô đích đó. */
  slot: number;
  representative: boolean;
  /** Độ trễ (0–1) khi hiện và khi hội tụ, theo khoảng cách: ô gần tâm hiện trước, ô gần ô đích tới trước. */
  appearDelay: number;
  convergeDelay: number;
  /** Toạ độ lấy màu trên ảnh thu nhỏ (0–1, gốc trên-trái). */
  u: number;
  v: number;
}

export interface HexLattice {
  cells: readonly HexCell[];
  /** Bán kính ngoại tiếp của một ô lưới (m). */
  radius: number;
  /** Tâm các ô của dải rút gọn và bán kính ngoại tiếp của chúng (m). */
  slots: readonly { x: number; y: number }[];
  slotRadius: number;
  /** Khoảng cách tâm giữa hai ô liền nhau của dải. */
  slotSpacing: number;
}

export const DIGEST_SLOTS = 8;
const COLS = 9;
const ROWS = 7;
const APPEAR_SPREAD = 0.45;
const CONVERGE_SPREAD = 0.4;
/** Mức tản rộng thêm của lưới (tỉ lệ) và biên độ lệch sâu (m). */
const SPREAD = 0.3;
const DEPTH = 0.006;
const SLOT_SPACING = 0.024;

/** Kích thước dải rút gọn ở độ lớn của thẻ (m, hệ cục bộ của gói): bề mặt báo cáo mọc ra từ hình chữ nhật này. */
export const STRIP = { width: SLOT_SPACING * DIGEST_SLOTS, height: SLOT_SPACING } as const;
/** Ô không đại diện lùi sau ô đại diện khi trùng chỗ, tránh hai mặt cùng độ sâu. */
const BEHIND = -0.0012;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Lưới lục giác đỉnh nhọn phủ mặt ảnh rộng `faceWidth` × cao `faceHeight`: hàng chẵn 9 ô, hàng lẻ 8 ô (so le), 7 hàng, tổng 60 ô. */
export function createHexLattice(faceWidth: number, faceHeight: number): HexLattice {
  const r = faceWidth / (COLS * Math.sqrt(3));
  const dx = Math.sqrt(3) * r;
  const dy = 1.5 * r;
  const raw: Array<{ x: number; y: number }> = [];
  for (let row = 0; row < ROWS; row++) {
    const n = row % 2 === 0 ? COLS : COLS - 1;
    for (let c = 0; c < n; c++) raw.push({ x: (c - (n - 1) / 2) * dx, y: ((ROWS - 1) / 2 - row) * dy });
  }

  const slots = Array.from({ length: DIGEST_SLOTS }, (_, k) => ({ x: (k - (DIGEST_SLOTS - 1) / 2) * SLOT_SPACING, y: 0 }));
  const half = (COLS * dx) / 2;
  const slotOf = (x: number) => Math.min(DIGEST_SLOTS - 1, Math.max(0, Math.floor(((x + half) / (2 * half)) * DIGEST_SLOTS)));

  // Ô đại diện của mỗi ô đích: ô gần ô đích nhất trong các ô được giao cho nó.
  const reps = new Map<number, number>();
  raw.forEach((c, i) => {
    const k = slotOf(c.x);
    const s = slots[k]!;
    const d = Math.hypot(c.x - s.x, c.y - s.y);
    const cur = reps.get(k);
    if (cur === undefined) reps.set(k, i);
    else {
      const o = raw[cur]!;
      if (d < Math.hypot(o.x - s.x, o.y - s.y)) reps.set(k, i);
    }
  });

  const maxCenter = Math.max(...raw.map((c) => Math.hypot(c.x, c.y)));
  const maxTravel = Math.max(...raw.map((c) => Math.hypot(c.x - slots[slotOf(c.x)]!.x, c.y)));
  const cells: HexCell[] = raw.map((c, i) => {
    const slot = slotOf(c.x);
    return {
      x: c.x,
      y: c.y,
      // Góc vàng: lệch sâu trông như ngẫu nhiên nhưng hoàn toàn cố định theo chỉ số.
      depth: DEPTH * Math.sin(i * 2.39996),
      slot,
      representative: reps.get(slot) === i,
      appearDelay: APPEAR_SPREAD * (Math.hypot(c.x, c.y) / maxCenter),
      convergeDelay: CONVERGE_SPREAD * (Math.hypot(c.x - slots[slot]!.x, c.y) / maxTravel),
      u: clamp01(c.x / faceWidth + 0.5),
      v: clamp01(0.5 - c.y / faceHeight),
    };
  });
  return { cells, radius: r, slots, slotRadius: SLOT_SPACING / Math.sqrt(3), slotSpacing: SLOT_SPACING };
}

/** Tiến trình hiển thị của lớp lục giác (đều 0–1, là hàm thuần của tiến trình cuộn). */
export interface HexVisual {
  /** Mặt ảnh lát thành ô (mỗi ô lớn dần theo độ trễ riêng). */
  fragment: number;
  /** Lưới tản rộng và lệch sâu. */
  spread: number;
  /** Các ô hội tụ về dải rút gọn. */
  converge: number;
  /** Chuỗi ký tự trên dải hiện ra. */
  digest: number;
  /** Dải rút gọn tan đi (các ô thu nhỏ về không) để nhường chỗ cho bề mặt báo cáo. Mặc định 0. */
  fade: number;
}

export const HEX_HIDDEN: HexVisual = { fragment: 0, spread: 0, converge: 0, digest: 0, fade: 0 };

export interface HexPose {
  x: number;
  y: number;
  z: number;
  /** Hệ số so với ô lưới gốc (0 = ẩn). */
  scale: number;
  /** 0–1: mức chuyển từ màu ảnh sang màu của dải rút gọn. */
  mix: number;
}

export function hexPose(lattice: HexLattice, cell: HexCell, v: HexVisual, out: HexPose = { x: 0, y: 0, z: 0, scale: 0, mix: 0 }): HexPose {
  const appear = smoothstep(clamp01((v.fragment - cell.appearDelay) / (1 - APPEAR_SPREAD))) * (1 - v.fade);
  const grow = 1 + SPREAD * v.spread;
  const t = smootherstep(clamp01((v.converge - cell.convergeDelay) / (1 - CONVERGE_SPREAD)));
  const slot = lattice.slots[cell.slot]!;
  out.x = lerp(cell.x * grow, slot.x, t);
  out.y = lerp(cell.y * grow, slot.y, t);
  out.z = lerp(cell.depth * v.spread, cell.representative ? 0 : BEHIND, t);
  out.scale = cell.representative
    ? appear * lerp(1, lattice.slotRadius / lattice.radius, t)
    : // Ô không đại diện thu nhỏ trong lúc bay rồi tan vào ô đại diện khi tới nơi.
      appear * lerp(1, 0.7, t) * (1 - smoothstep(clamp01((t - 0.7) / 0.3)));
  out.mix = t;
  return out;
}

/**
 * Dấu vân 16 ký tự hex của chính ảnh thu nhỏ trong gói (FNV-1a hai làn 32 bit trên các byte điểm ảnh). Chỉ để chuỗi minh hoạ gắn với đúng gói này
 * và cố định giữa các lần cuộn. Không phải hàm băm mật mã và không phải điều hệ thống thật làm với dữ liệu.
 */
export function digestHex(bytes: ArrayLike<number>): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    const x = bytes[i]! & 0xff;
    a = Math.imul(a ^ x, 0x01000193) >>> 0;
    b = Math.imul(b ^ x, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
