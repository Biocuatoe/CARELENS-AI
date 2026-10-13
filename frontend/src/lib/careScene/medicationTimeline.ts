import { Matrix3, Quaternion, Vector3 } from "three";
import { CareFigure, POSE_CHANNELS, pose, type Pose } from "./figure";
import { MonotoneCurve } from "./fallTimeline";
import { RELAXED_GRIP, type HandGrip } from "./hand";
import { LAYOUT, OBSERVATION } from "./medicationLayout";
import { medStepAt, type MedStepIndex } from "./medicationSteps";
import { createPacketState, samplePacket, type PacketPlan, type PacketState } from "./dataPacket";

/**
 * Dòng thời gian tình huống quan sát hoạt động: hàm thuần của tiến trình cuộn p ∈ [0, 1].
 * Tay phải với tới ly bằng động học ngược giải một lần lúc dựng (không giải mỗi khung); các góc khớp, độ nắm, camera và gói dữ liệu đều
 * nội suy đơn điệu giữa các khoá cố định. Cùng p luôn cho cùng khung hình, nên cuộn nhanh, chậm hay ngược đều không trôi.
 */

export type MedLayout = "wide" | "narrow";

/** Mốc then chốt (p). Từng giai đoạn có đầu và cuối rõ ràng, không giai đoạn nào đặt lại cảnh. */
export const MED = {
  idleEnd: 0.03,
  approach: 0.13,
  grasp: 0.18,
  lifted: 0.31,
  holdEnd: 0.56,
  placed: 0.64,
  released: 0.69,
  retreat: 0.76,
  away: 0.88,
  /** Tiến trình dùng để chụp ảnh khung hình: người đang giữ ly ở miệng, khung ngắm đã khoá. */
  snapshot: 0.44,
} as const;

export interface MedCamera {
  position: Vector3;
  target: Vector3;
  fov: number;
  /** 0–1: mức lùi thêm khi khung hẹp hơn tỉ lệ tham chiếu. */
  fit: number;
  /** 0–1: mức nhường chỗ cho lớp giao diện (bảng bước, thẻ). */
  uiRoom: number;
}

export interface MedFrame {
  p: number;
  step: MedStepIndex;
  pose: Pose;
  grips: { left: HandGrip; right: HandGrip };
  /** Ly đang nằm trong tay (đặt tại điểm nắm) hay nằm yên trên quầy. */
  glassHeld: boolean;
  camera: MedCamera;
  /** Độ hiện của hình chóp tầm nhìn từ ống kính tới khung ngắm, và của đèn báo ống kính. */
  cone: number;
  lens: number;
  hubActivity: number;
  trayGlow: number;
  /** Nhãn chữ: thiết bị và hub. */
  labels: { device: number; hub: number };
  packet: PacketState;
  trail: PacketState[];
}

export interface MedicationTimeline {
  evaluate(p: number, layout: MedLayout, out?: MedFrame): MedFrame;
  readonly plan: PacketPlan;
  /** Ống kính thiết bị (thế giới) và hướng nhìn (đơn vị): cố định vì thân người không đổi tư thế trong cảnh. */
  readonly lens: { position: Vector3; direction: Vector3 };
  /** Sai số lớn nhất (m) giữa điểm nắm và đích của các khoá động học ngược. */
  readonly ikError: number;
  /** Vị trí điểm nắm khi cầm ly, ở khoá nắm (để kiểm tra không nhảy lúc chuyển ly từ quầy sang tay). */
  readonly graspAnchor: Vector3;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number, a: number, b: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const D2R = Math.PI / 180;

/** Thân người đứng yên suốt cảnh: chỉ tay và đầu cử động. Nghiêng nhẹ về trước như người đang làm việc ở quầy. */
const BODY = { yaw: 0, chestX: 4, spineX: 3 } as const;
const LEFT_ARM = { lShX: -5, lShZ: 5, lElb: -16 } as const;

interface ArmAngles {
  shX: number;
  shZ: number;
  elb: number;
}

/** Cổ tay giữ ngón cái hướng lên: tổng góc quay quanh X của vai, khuỷu và cổ tay bằng −90°, nên ly cầm luôn thẳng đứng. */
const wristFor = (a: ArmAngles) => -90 - (a.shX + a.elb);

function buildPose(base: Partial<Pose>, a: ArmAngles | null, neckX: number): Pose {
  const p = pose({ ...BODY, ...LEFT_ARM, neckX, ...base });
  if (a) {
    p.rShX = a.shX;
    p.rShZ = a.shZ;
    p.rElb = a.elb;
    p.rWrX = wristFor(a);
  }
  return p;
}

/** Giải động học ngược giảm dần theo bình phương (DLS) cho ba góc của tay phải sao cho điểm nắm trùng đích. */
function solveArm(figure: CareFigure, target: Vector3, start: ArmAngles, neckX: number): { angles: ArmAngles; error: number } {
  const a: [number, number, number] = [start.shX, start.shZ, start.elb];
  const anchor = new Vector3();
  const at = (v: readonly [number, number, number]) => {
    const ang: ArmAngles = { shX: v[0], shZ: v[1], elb: v[2] };
    figure.applyPose(buildPose({}, ang, neckX));
    return figure.gripWorld("right", anchor).clone();
  };
  const delta = 0.4;
  for (let iter = 0; iter < 160; iter++) {
    const cur = at(a);
    const e = target.clone().sub(cur);
    if (e.length() < 1e-4) break;
    // Ma trận Jacobi số (m trên độ).
    const cols: Vector3[] = [];
    for (let k = 0; k < 3; k++) {
      const b: [number, number, number] = [a[0], a[1], a[2]];
      b[k]! += delta;
      cols.push(at(b).sub(cur).multiplyScalar(1 / delta));
    }
    // (J Jᵀ + λ² I) y = e, rồi Δ = Jᵀ y.
    const jjt = new Matrix3();
    const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const row = [cols[0]!, cols[1]!, cols[2]!].map((v) => [v.x, v.y, v.z][r]!);
        const col = [cols[0]!, cols[1]!, cols[2]!].map((v) => [v.x, v.y, v.z][c]!);
        m[r * 3 + c] = row[0]! * col[0]! + row[1]! * col[1]! + row[2]! * col[2]! + (r === c ? 1e-6 : 0);
      }
    }
    jjt.set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!);
    if (Math.abs(jjt.determinant()) < 1e-18) break;
    const y = e.clone().applyMatrix3(jjt.invert());
    for (let k = 0; k < 3; k++) {
      const step = cols[k]!.dot(y);
      a[k]! += Math.max(-6, Math.min(6, step));
    }
  }
  const final = at(a);
  return { angles: { shX: a[0], shZ: a[1], elb: a[2] }, error: final.distanceTo(target) };
}

interface ArmKey {
  p: number;
  /** Đích của điểm nắm; null = buông thõng. */
  target: Vector3 | null;
  hang?: ArmAngles;
  neckX: number;
  grip: HandGrip;
}

/** Điểm nắm khi nâng ly: ngang ngực, ở trước vai phải, trong tầm nhìn của camera thiết bị (không chắn thiết bị khi nhìn từ trước-trái). */
const DRINK = new Vector3(-0.1, 1.3, 0.4);

const HANG: ArmAngles = { shX: 4, shZ: 7, elb: -18 };
/** Điểm xuất phát của bộ giải: khuỷu hạ thấp sát thân, cẳng tay hướng ra trước (không dang khuỷu). Giữ nghiệm trên đúng nhánh này. */
const SEED: ArmAngles = { shX: -22, shZ: 5, elb: -78 };
const OPEN: HandGrip = { curl: 0.14, spread: 0.55, thumb: 0 };
const CLOSED: HandGrip = { curl: 1, spread: 0, thumb: 1 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function createMedicationTimeline(figure: CareFigure): MedicationTimeline {
  const glass = LAYOUT.glassRest.clone();
  const lateral = new Vector3(-0.085, 0.004, -0.012);
  const keys: ArmKey[] = [
    { p: 0, target: null, hang: HANG, neckX: 10, grip: RELAXED_GRIP },
    { p: MED.idleEnd, target: null, hang: HANG, neckX: 10, grip: RELAXED_GRIP },
    { p: MED.approach, target: glass.clone().add(lateral), neckX: 14, grip: OPEN },
    { p: MED.grasp, target: glass.clone(), neckX: 14, grip: CLOSED },
    { p: MED.grasp + 0.025, target: glass.clone(), neckX: 14, grip: CLOSED },
    { p: MED.lifted, target: DRINK.clone(), neckX: 0, grip: CLOSED },
    { p: MED.holdEnd, target: DRINK.clone(), neckX: 0, grip: CLOSED },
    { p: MED.placed, target: glass.clone(), neckX: 12, grip: CLOSED },
    { p: MED.released, target: glass.clone(), neckX: 12, grip: { curl: 0.5, spread: 0.3, thumb: 0.4 } },
    { p: MED.retreat, target: glass.clone().add(lateral).add(new Vector3(-0.04, 0.02, 0)), neckX: 6, grip: OPEN },
    { p: MED.away, target: null, hang: HANG, neckX: 6, grip: RELAXED_GRIP },
    { p: 1, target: null, hang: HANG, neckX: 6, grip: RELAXED_GRIP },
  ];

  // Giải động học ngược theo thứ tự, mỗi khoá bắt đầu từ nghiệm khoá trước để các góc liên tục (không đổi nhánh).
  let prev: ArmAngles = HANG;
  let ikError = 0;
  const solved = keys.map((k) => {
    if (!k.target) {
      prev = k.hang ?? HANG;
      return prev;
    }
    const r = solveArm(figure, k.target, SEED, k.neckX);
    ikError = Math.max(ikError, r.error);
    prev = r.angles;
    return r.angles;
  });

  const xs = keys.map((k) => k.p);
  const curve = (get: (k: ArmKey, a: ArmAngles) => number) => new MonotoneCurve(xs, keys.map((k, i) => get(k, solved[i]!)));
  const arm = { shX: curve((_, a) => a.shX), shZ: curve((_, a) => a.shZ), elb: curve((_, a) => a.elb), neck: curve((k) => k.neckX) };
  const grip = { curl: curve((k) => k.grip.curl), spread: curve((k) => k.grip.spread), thumb: curve((k) => k.grip.thumb) };

  // Điểm nắm tại khoá nắm (kiểm tra liên tục lúc đổi chủ sở hữu ly).
  const graspAnchor = new Vector3();
  {
    const a = solved[3]!;
    figure.applyPose(buildPose({}, a, keys[3]!.neckX));
    figure.gripWorld("right", graspAnchor);
  }

  // Ống kính thiết bị: thân người cố định nên đo một lần.
  figure.applyPose(buildPose({}, HANG, 10));
  const device = figure.devicePosition(new Vector3());
  const q = new Quaternion();
  figure.chestMount.getWorldQuaternion(q);
  const dir = new Vector3(0, 0, 1).applyQuaternion(q).normalize();
  const lens = { position: device.clone().addScaledVector(dir, OBSERVATION.lensForward), direction: dir };

  const frameCenter = lens.position.clone().addScaledVector(dir, OBSERVATION.distance);
  const dockPos = LAYOUT.tray.clone().add(new Vector3(0, 0.0085 + 0.0035, 0));
  const hover = dockPos.clone().add(new Vector3(0, 0.07, 0));
  const plan: PacketPlan = {
    frame: { center: frameCenter, scale: (OBSERVATION.halfWidth * 2) / 0.14 },
    path: [
      frameCenter.clone().add(new Vector3(0.0, 0.0, 0.0)),
      frameCenter.clone().add(new Vector3(0.38, 0.34, 0.1)),
      hover.clone().add(new Vector3(-0.42, 0.3, 0.02)),
      hover,
    ],
    dock: { position: dockPos, quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2) },
    windows: {
      appear: [0.38, 0.43],
      capture: [0.45, 0.5],
      condense: [0.57, 0.69],
      travel: [0.73, 0.93],
      settle: [0.92, 1],
    },
  };

  // Camera: vị trí = đích + khoảng cách theo hướng từ trước-trái; khoá theo p, nội suy đơn điệu. Cuối cảnh bám theo đường bay.
  interface CamKey {
    p: number;
    target: Vector3;
    dist: number;
    az: number;
    el: number;
    fov: number;
    fit: number;
  }
  const mid = (t: number) => {
    // Điểm trên đường bay (đã làm mượt) tại t, để camera đi theo gói.
    const s = samplePacket(plan, lerp(plan.windows.travel[0], plan.windows.travel[1], t));
    return s.position.clone();
  };
  /** Khung cuối: khay nhận và hub ở giữa khung, gói dữ liệu là vật chính (người đã lùi ra ngoài khung). */
  const finalTarget = LAYOUT.tray.clone().lerp(LAYOUT.hub, 0.45).add(new Vector3(0, 0.1, 0));
  const camKeys: CamKey[] = [
    { p: 0, target: new Vector3(0.0, 1.14, 0.25), dist: 2.35, az: -16, el: 9, fov: 30, fit: 1 },
    { p: 0.07, target: new Vector3(0.0, 1.14, 0.25), dist: 2.35, az: -16, el: 9, fov: 30, fit: 1 },
    { p: 0.16, target: new Vector3(-0.1, 1.1, 0.3), dist: 1.75, az: -20, el: 11, fov: 30, fit: 0.9 },
    { p: 0.3, target: new Vector3(-0.05, 1.27, 0.3), dist: 1.55, az: -16, el: 8, fov: 30, fit: 0.8 },
    { p: 0.4, target: new Vector3(0.0, 1.3, 0.36), dist: 1.62, az: -5, el: 6, fov: 30, fit: 0.8 },
    { p: 0.52, target: new Vector3(0.0, 1.32, 0.42), dist: 1.66, az: -5, el: 6, fov: 30, fit: 0.85 },
    { p: 0.64, target: frameCenter.clone().add(new Vector3(0, -0.02, 0)), dist: 1.55, az: -12, el: 5, fov: 30, fit: 0.9 },
    { p: 0.73, target: frameCenter.clone().add(new Vector3(0.1, 0, 0)), dist: 1.7, az: -10, el: 8, fov: 30, fit: 1 },
    { p: 0.84, target: mid(0.5).add(new Vector3(0.1, -0.05, 0)), dist: 2.15, az: -8, el: 15, fov: 30, fit: 1 },
    { p: 0.97, target: finalTarget.clone(), dist: 1.7, az: -6, el: 22, fov: 30, fit: 1 },
    { p: 1, target: finalTarget.clone(), dist: 1.7, az: -6, el: 22, fov: 30, fit: 1 },
  ];
  const cx = camKeys.map((k) => k.p);
  const cc = (get: (k: CamKey) => number) => new MonotoneCurve(cx, camKeys.map(get));
  const cam = {
    tx: cc((k) => k.target.x),
    ty: cc((k) => k.target.y),
    tz: cc((k) => k.target.z),
    dist: cc((k) => k.dist),
    az: cc((k) => k.az),
    el: cc((k) => k.el),
    fov: cc((k) => k.fov),
    fit: cc((k) => k.fit),
  };

  const newFrame = (): MedFrame => ({
    p: 0,
    step: 0,
    pose: pose({}),
    grips: { left: { ...RELAXED_GRIP }, right: { ...RELAXED_GRIP } },
    glassHeld: false,
    camera: { position: new Vector3(), target: new Vector3(), fov: 30, fit: 1, uiRoom: 0 },
    cone: 0,
    lens: 0,
    hubActivity: 0,
    trayGlow: 0,
    labels: { device: 0, hub: 0 },
    packet: createPacketState(),
    trail: [createPacketState(), createPacketState(), createPacketState()],
  });

  const tmp = new Vector3();
  return {
    plan,
    lens,
    ikError,
    graspAnchor,
    evaluate(pIn, layout, out = newFrame()) {
      const p = clamp01(pIn);
      out.p = p;
      out.step = medStepAt(p);
      // Tư thế: thân cố định; tay phải theo các đường cong góc; tay trái buông.
      const pp = out.pose;
      for (const c of POSE_CHANNELS) pp[c] = 0;
      Object.assign(pp, BODY, LEFT_ARM);
      pp.neckX = arm.neck.at(p);
      pp.rShX = arm.shX.at(p);
      pp.rShZ = arm.shZ.at(p);
      pp.rElb = arm.elb.at(p);
      pp.rWrX = wristFor({ shX: pp.rShX, shZ: pp.rShZ, elb: pp.rElb });
      out.grips.left.curl = RELAXED_GRIP.curl;
      out.grips.left.spread = RELAXED_GRIP.spread;
      out.grips.left.thumb = RELAXED_GRIP.thumb;
      out.grips.right.curl = grip.curl.at(p);
      out.grips.right.spread = grip.spread.at(p);
      out.grips.right.thumb = grip.thumb.at(p);
      // Ly ở trong tay từ lúc khép tay quanh ly (điểm nắm trùng vị trí ly trên quầy) tới lúc đặt lại xuống đúng chỗ cũ.
      out.glassHeld = p >= MED.grasp && p < MED.released;

      // Camera.
      const c = out.camera;
      const dist = cam.dist.at(p);
      const az = cam.az.at(p) * D2R;
      const el = cam.el.at(p) * D2R;
      c.target.set(cam.tx.at(p), cam.ty.at(p), cam.tz.at(p));
      // Khung hẹp: ở đoạn cuối bám theo vị trí gói (người xem vẫn thấy gói và hub dù không còn thấy người).
      if (layout === "narrow") {
        const follow = smooth(p, 0.7, 0.95);
        const packetPos = samplePacket(plan, Math.min(p + 0.04, 1), out.packet).position;
        tmp.copy(packetPos).add(new Vector3(0.28, 0, 0));
        c.target.lerp(tmp, follow * 0.85);
      }
      const horiz = Math.cos(el) * dist;
      c.position.set(c.target.x + Math.sin(az) * horiz, c.target.y + Math.sin(el) * dist, c.target.z + Math.cos(az) * horiz);
      c.fov = cam.fov.at(p);
      c.fit = cam.fit.at(p);
      c.uiRoom = 1;

      // Hiển thị quan sát và hub.
      out.cone = smooth(p, 0.33, 0.4) * (1 - smooth(p, 0.6, 0.66));
      out.lens = smooth(p, 0.34, 0.38) * (1 - smooth(p, 0.64, 0.7));
      out.hubActivity = smooth(p, 0.9, 0.99);
      out.trayGlow = smooth(p, 0.94, 1);
      out.labels.device = smooth(p, 0.32, 0.38) * (1 - smooth(p, 0.56, 0.62));
      out.labels.hub = smooth(p, 0.82, 0.9);

      // Gói và vệt bay (ba bước lùi cách đều theo p).
      samplePacket(plan, p, out.packet);
      for (let k = 0; k < out.trail.length; k++) samplePacket(plan, p - (k + 1) * 0.014, out.trail[k]!);
      return out;
    },
  };
}
