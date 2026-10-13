import { Vector3 } from "three";
import { POSE_CHANNELS, pose, type CareFigure, type Pose } from "./figure";
import { stepAt, type FallStepIndex } from "./steps";

/**
 * Dòng thời gian tình huống 01 (ngã): mọi thứ là hàm thuần của tiến trình cuộn p ∈ [0, 1].
 * Tư thế, camera, vòng ghi nhận và lớp giao diện đều nội suy từ khoá cố định bằng Hermite đơn điệu (Fritsch–Carlson):
 * mượt, không vượt quá khoá (không nảy), và cùng một p luôn cho cùng một khung hình, nên cuộn ngược không trôi và không giật.
 */

export type FallLayout = "wide" | "narrow";


/** Mốc nội dung (giải thích ở `FALL_BEATS` bên dưới). */
const FALL = { start: 0.22, settled: 0.52 } as const;
const RING = { start: 0.54, length: 0.12, stagger: 0.035 } as const;
const CARD: readonly [number, number] = [0.68, 0.76];
const VIGNETTE = { inStart: 0.5, inEnd: 0.58, outStart: 0.72, outEnd: 0.82, max: 0.6 } as const;

/**
 * Tư thế khoá. Góc độ (xem quy ước dấu ở `figure.ts`): ShX âm = giơ tay ra trước, Elb âm = gập khuỷu, HipX âm = đùi ra trước,
 * Knee dương = gập gối, pitch dương = đổ người về trước, roll dương = nghiêng sang phải của người.
 */
// Dáng đứng của người lớn tuổi: vai hơi khom, đầu hơi cúi.
const STAND = pose({ yaw: 14, chestX: 5, neckX: 7, lShZ: 7, rShZ: 7, lShX: -4, rShX: -4, lElb: -12, rElb: -10, lKnee: 3, rKnee: 3, lHipX: -2, rHipX: -2 });
const LYING = pose({
  yaw: 36, pitch: 4, roll: 87, rootZ: 0.44, rootX: -0.12,
  spineX: 6, neckZ: -14, neckX: -4,
  // Tay dưới duỗi qua đầu, nằm trên sàn (làm gối); tay trên buông xuống trước ngực.
  rShX: -160, rShZ: 4, rElb: -14,
  lShX: -112, lShZ: -20, lElb: -58,
  // Chân dưới gần thẳng, chân trên co ra trước tựa xuống sàn.
  rHipX: -14, rKnee: 22, rAnk: 12, lHipX: -58, lHipZ: -12, lKnee: 64, lAnk: 14,
});
const POSE_KEYS: ReadonlyArray<readonly [number, Pose]> = [
  [0, STAND],
  [FALL.start, STAND],
  // Hụt bước: chân trái khuỵu, thân đổ về trước, hai tay bật ra giữ thăng bằng.
  [0.29, pose({ yaw: 16, pitch: 8, roll: 5, rootZ: 0.08, spineX: 9, chestX: 6, neckX: 10, lShX: -30, lShZ: 22, lElb: -30, rShX: -26, rShZ: 28, rElb: -24, lHipX: -22, lKnee: 32, rHipX: 6, rKnee: 12, rAnk: 8 })],
  // Gối khuỵu về trước: người hạ dần, tay vươn ra trước tìm điểm tựa.
  [0.345, pose({ yaw: 18, pitch: 14, roll: 9, rootZ: 0.16, rootX: -0.02, spineX: 12, chestX: 6, neckX: 4, lShX: -50, lShZ: 22, lElb: -30, rShX: -56, rShZ: 30, rElb: -12, lHipX: -20, lKnee: 72, rHipX: -12, rKnee: 82, lAnk: 22, rAnk: 26 })],
  // Quỳ xuống sàn, thân đổ về trước và sang phải, tay phải chống.
  [0.39, pose({ yaw: 22, pitch: 18, roll: 22, rootZ: 0.26, rootX: -0.05, spineX: 14, spineZ: 4, chestX: 4, neckX: -2, neckZ: -6, lShX: -52, lShZ: 18, lElb: -32, rShX: -72, rShZ: 34, rElb: -8, lHipX: -8, lKnee: 104, rHipX: -4, rKnee: 110, lAnk: 30, rAnk: 32 })],
  // Đổ nghiêng xuống hông và vai phải.
  [0.45, pose({ yaw: 32, pitch: 10, roll: 66, rootZ: 0.38, rootX: -0.1, spineX: 9, neckX: -4, neckZ: -12, lShX: -90, lShZ: -10, lElb: -50, rShX: -128, rShZ: 18, rElb: -12, lHipX: -38, lHipZ: -4, lKnee: 82, rHipX: -22, rKnee: 60, lAnk: 16, rAnk: 14 })],
  // Nằm nghiêng phải, bất động.
  [FALL.settled, LYING],
  [1, LYING],
];

/** Nội suy Hermite đơn điệu: tiếp tuyến Fritsch–Carlson, không vượt quá giá trị khoá giữa hai khoá liền kề. */
export class MonotoneCurve {
  private readonly m: number[];

  constructor(
    private readonly xs: readonly number[],
    private readonly ys: readonly number[],
  ) {
    const n = xs.length;
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
    const m: number[] = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const a = d[i - 1]!;
      const b = d[i]!;
      if (a * b <= 0) m[i] = 0;
      else {
        const w1 = 2 * (xs[i + 1]! - xs[i]!) + (xs[i]! - xs[i - 1]!);
        const w2 = (xs[i + 1]! - xs[i]!) + 2 * (xs[i]! - xs[i - 1]!);
        m[i] = (w1 + w2) / (w1 / a + w2 / b);
      }
    }
    // Hai đầu: tiếp tuyến 0 (bắt đầu và dừng êm).
    this.m = m;
  }

  at(x: number): number {
    const { xs, ys, m } = this;
    const n = xs.length;
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * m[i + 1]!;
  }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number, a: number, b: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface FallCamera {
  position: Vector3;
  target: Vector3;
  fov: number;
  /** 0–1: mức được lùi xa thêm khi khung hẹp hơn tỉ lệ tham chiếu (cảnh rộng = 1, cận cảnh thiết bị thấp hơn). */
  fit: number;
  /** 0–1: mức nhường chỗ cho thẻ thông báo (cảnh đặt người vào phần khung còn trống). */
  cardRoom: number;
}

export interface FallFrame {
  p: number;
  step: FallStepIndex;
  pose: Pose;
  camera: FallCamera;
  /** Hai vòng ghi nhận quanh thiết bị: tỉ lệ (m) và độ mờ. Chỉ một lần, chạy theo p, không lặp. */
  rings: Array<{ radius: number; opacity: number }>;
  /** 0–1: độ hiện của thẻ thông báo. */
  card: number;
  /** 0–1: độ tối viền khung (tập trung vào thiết bị lúc ghi nhận). */
  vignette: number;
}

interface CameraKey {
  p: number;
  position: Vector3;
  target: Vector3;
  fov: number;
  fit: number;
}

export interface FallTimeline {
  evaluate(p: number, layout: FallLayout, out?: FallFrame): FallFrame;
  /** Tâm thân người khi nằm và vị trí thiết bị khi nằm (để kiểm thử và đặt camera). */
  readonly lyingCenter: Vector3;
  readonly lyingDevice: Vector3;
}

/** Dựng dòng thời gian. Cần hình người để đo vị trí thật của thân và thiết bị ở tư thế nằm; trả hình người về tư thế đứng. */
export function createFallTimeline(figure: CareFigure): FallTimeline {
  const xs = POSE_KEYS.map(([p]) => p);
  const curves = Object.fromEntries(POSE_CHANNELS.map((c) => [c, new MonotoneCurve(xs, POSE_KEYS.map(([, k]) => k[c]))])) as Record<keyof Pose, MonotoneCurve>;

  const lying = POSE_KEYS[POSE_KEYS.length - 1]![1];
  figure.applyPose(lying);
  const pts = figure.probePoints();
  const lyingCenter = pts.reduce((a, v) => a.add(v), new Vector3()).multiplyScalar(1 / pts.length);
  const lyingDevice = figure.devicePosition(new Vector3());
  figure.applyPose(STAND);

  const lc = lyingCenter;
  const ld = lyingDevice;
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  // Camera: toàn cảnh ấm → theo người xuống sàn → áp sát thiết bị lúc ghi nhận → lùi ra khung kết có chỗ cho thông báo.
  // Hướng nhìn cận cảnh thiết bị: chéo trước-phải, hơi từ trên xuống; khoảng cách cho khung cao khoảng 0,7 m (người vẫn đọc được).
  const close = (d: number) => v(ld.x + 0.53 * d, ld.y + 0.43 * d, ld.z + 0.73 * d);
  const keys: CameraKey[] = [
    { p: 0, position: v(2.4, 1.52, 3.85), target: v(0, 0.86, 0), fov: 30, fit: 0.5 },
    { p: FALL.start, position: v(2.15, 1.42, 3.45), target: v(0.03, 0.82, 0.1), fit: 0.5, fov: 30 },
    { p: 0.33, position: v(2.08, 1.24, 3.28), target: v(0, 0.6, 0.2), fit: 0.7, fov: 30 },
    { p: 0.42, position: v(lc.x + 1.95, 1.05, lc.z + 2.75), target: v(lc.x, 0.36, lc.z), fit: 1, fov: 30 },
    { p: FALL.settled, position: v(lc.x + 1.75, 0.95, lc.z + 2.45), target: v(lc.x, 0.22, lc.z), fit: 1, fov: 30 },
    { p: 0.6, position: close(1.28), target: ld.clone(), fit: 0.45, fov: 27 },
    { p: 0.68, position: close(1.16), target: ld.clone(), fit: 0.45, fov: 27 },
    { p: 0.82, position: v(lc.x + 1.55, 1.3, lc.z + 2.4), target: v(lc.x, 0.22, lc.z), fit: 1, fov: 30 },
    { p: 1, position: v(lc.x + 1.66, 1.4, lc.z + 2.55), target: v(lc.x, 0.22, lc.z), fit: 1, fov: 30 },
  ];
  const kx = keys.map((k) => k.p);
  const curve = (get: (k: CameraKey) => number) => new MonotoneCurve(kx, keys.map(get));
  const cam = {
    px: curve((k) => k.position.x),
    py: curve((k) => k.position.y),
    pz: curve((k) => k.position.z),
    tx: curve((k) => k.target.x),
    ty: curve((k) => k.target.y),
    tz: curve((k) => k.target.z),
    fov: curve((k) => k.fov),
    fit: curve((k) => k.fit),
  };

  const createFrame = (): FallFrame => ({
    p: 0,
    step: 0,
    pose: pose({}),
    camera: { position: new Vector3(), target: new Vector3(), fov: 30, fit: 1, cardRoom: 0 },
    rings: [
      { radius: 0, opacity: 0 },
      { radius: 0, opacity: 0 },
    ],
    card: 0,
    vignette: 0,
  });

  return {
    lyingCenter,
    lyingDevice,
    evaluate(pIn, _layout, out = createFrame()) {
      const p = clamp01(pIn);
      out.p = p;
      out.step = stepAt(p);
      for (const c of POSE_CHANNELS) out.pose[c] = curves[c].at(p);
      // Đứng yên trước khi ngã: dồn trọng tâm rất nhẹ (bằng 0 và đạo hàm bằng 0 ở hai đầu, nên nối liền với khoá).
      if (p < FALL.start) {
        const s = Math.sin((Math.PI * p) / FALL.start) ** 2;
        out.pose.spineZ += -1.6 * s;
        out.pose.neckZ += 3.5 * s;
        out.pose.lKnee += 4 * s;
      }
      const c = out.camera;
      c.position.set(cam.px.at(p), cam.py.at(p), cam.pz.at(p));
      c.target.set(cam.tx.at(p), cam.ty.at(p), cam.tz.at(p));
      c.fov = cam.fov.at(p);
      c.fit = cam.fit.at(p);
      c.cardRoom = smooth(p, CARD[0] - 0.04, CARD[1] + 0.02);

      out.rings.forEach((ring, i) => {
        const t = clamp01((p - RING.start - i * RING.stagger) / RING.length);
        const eased = 1 - (1 - t) ** 3;
        ring.radius = 0.04 + 0.13 * eased;
        ring.opacity = t > 0 && t < 1 ? Math.sin(Math.PI * t) ** 1.5 * (i === 0 ? 0.95 : 0.6) : 0;
      });
      out.card = smooth(p, CARD[0], CARD[1]);
      out.vignette = VIGNETTE.max * (smooth(p, VIGNETTE.inStart, VIGNETTE.inEnd) - smooth(p, VIGNETTE.outStart, VIGNETTE.outEnd));
      return out;
    },
  };
}
