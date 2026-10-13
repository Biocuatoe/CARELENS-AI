import { Euler, Quaternion, Vector3 } from "three";
import { createPacketState, type PacketState } from "./dataPacket";
import { MonotoneCurve } from "./fallTimeline";
import { HEX_HIDDEN, type HexVisual } from "./hexLattice";
import { COUNTER_TOP, LAYOUT } from "./medicationLayout";
import type { MedCamera, MedLayout } from "./medicationTimeline";

/**
 * Chương bảo vệ dữ liệu (minh hoạ khái niệm), nối tiếp chương quan sát trên cùng một cảnh và cùng hệ toạ độ thế giới.
 * Gói dữ liệu không được dựng lại: chương này bắt đầu đúng từ tư thế cuối của gói (bàn giao tường minh qua `SecurityStart`), camera bắt đầu
 * đúng từ camera cuối của chương trước, rồi gói rời khay, bay vào tấm khiên phía trên hub, mặt ảnh của chính nó lát thành ô lục giác,
 * các ô hội tụ thành một dải ngắn dạng mã băm và đứng yên.
 *
 * Mọi thứ là hàm thuần của p ∈ [0, 1] (tiến trình trong chương): cùng p cho cùng khung, cuộn nhanh, chậm hay ngược đều không trôi.
 * Hình ảnh khiên và chuỗi dạng mã băm không chứng minh hệ thống băm, mã hoá hay ẩn danh hoá dữ liệu.
 */

export type SecurePhase = "lifting" | "approaching" | "entering" | "fragmenting" | "converging" | "digest" | "settled";

/** Tấm khiên: lơ lửng phía trên hub (vùng xử lý trong nhà), mặt hướng về người xem (+Z). Mét, cùng hệ toạ độ với `LAYOUT`. */
export const SHIELD = {
  center: new Vector3(LAYOUT.hub.x, 1.56, 0.44),
  width: 0.46,
  height: 0.56,
  depth: 0.018,
} as const;

/** Mốc then chốt (p của chương). Mỗi đoạn có đầu và cuối rõ ràng; các đoạn gối nhau bằng đường cong êm nên không có điểm gãy. */
export const SEC = {
  travel: [0.02, 0.36],
  tilt: [0.03, 0.2],
  face: [0.16, 0.38],
  grow: [0.06, 0.38],
  enter: [0.32, 0.44],
  fragment: [0.44, 0.6],
  card: [0.46, 0.58],
  spread: [0.5, 0.64],
  converge: [0.64, 0.84],
  finalGrow: [0.64, 0.86],
  digest: [0.82, 0.92],
} as const;

/** Độ lớn của gói (so với thẻ thật) khi nằm trong khiên và khi đã thành dải rút gọn: đủ lớn để đọc được ở khoảng cách camera mới. */
export const SECURE_SCALE = { inside: 1.6, final: 1.8 } as const;

export interface SecurityStart {
  /** Tư thế cuối của gói ở chương quan sát (nằm phẳng trên khay). */
  pose: { position: Vector3; quaternion: Quaternion; scale: number };
  /** Camera cuối của chương quan sát theo bố cục. */
  camera(layout: MedLayout): MedCamera;
}

export interface SecFrame {
  p: number;
  phase: SecurePhase;
  /** Biến đổi và các lớp của thẻ (dùng chung `DataPacket.apply`). */
  packet: PacketState;
  /** Các lớp lục giác và dải rút gọn (`DataPacket.applySecure`). */
  hex: HexVisual;
  camera: MedCamera;
  /** Khiên: độ hiện, độ sáng viền trong, mức nâng lên chỗ (0 = thấp hơn 5 cm). */
  shield: { opacity: number; glow: number; rise: number };
  /** 0–1: căn phòng chìm vào nền (sương mù khép lại), đèn riêng của khiên, viền khay. */
  roomDim: number;
  light: number;
  trayGlow: number;
  labels: { hub: number; shield: number; digest: number };
}

export interface SecurityTimeline {
  evaluate(p: number, layout: MedLayout, out?: SecFrame): SecFrame;
  readonly start: SecurityStart["pose"];
  /** Vị trí gói khi đã ở trong khiên (tâm lưới lục giác và dải rút gọn). */
  readonly inside: Vector3;
  readonly path: readonly [Vector3, Vector3, Vector3, Vector3];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const win = (p: number, [a, b]: readonly [number, number]) => clamp01((p - a) / (b - a));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const smooth = (p: number, a: number, b: number) => smoothstep(win(p, [a, b]));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const D2R = Math.PI / 180;

const Q_FACE = new Quaternion();
/** Nửa đường từ nằm phẳng sang đứng: thẻ nghiêng về phía người xem khi vừa nhấc khỏi khay. */
const Q_TILT = new Quaternion().setFromEuler(new Euler(-0.6, 0, 0));

function bezier(path: readonly [Vector3, Vector3, Vector3, Vector3], t: number, out: Vector3): Vector3 {
  const u = 1 - t;
  const [p0, p1, p2, p3] = path;
  return out
    .copy(p0)
    .multiplyScalar(u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
}

export interface CamKey {
  p: number;
  target: Vector3;
  dist: number;
  az: number;
  el: number;
  fit: number;
}

/** Đổi camera (vị trí, đích) về toạ độ cầu quanh đích, đúng quy ước của chương quan sát. */
export function toKey(p: number, c: MedCamera): CamKey {
  const d = c.position.clone().sub(c.target);
  const dist = d.length();
  return { p, target: c.target.clone(), dist, az: Math.atan2(d.x, d.z) / D2R, el: Math.asin(d.y / dist) / D2R, fit: c.fit };
}

export function createSecurityTimeline(start: SecurityStart): SecurityTimeline {
  const pose = { position: start.pose.position.clone(), quaternion: start.pose.quaternion.clone(), scale: start.pose.scale };
  const S = SHIELD.center;
  // Gói đứng trong lòng khiên, hơi trước mặt nền bên trong (mặt nền ở z = −4 mm so với tâm khiên).
  const inside = S.clone().add(new Vector3(0, -0.02, 0.012));
  const entry = inside.clone().add(new Vector3(0, -0.01, 0.1));
  // Một đường cong duy nhất: nhấc thẳng lên khỏi khay trước (điểm điều khiển thứ hai ngay phía trên), rồi vòng sang phải-lên tới trước khiên.
  const path: [Vector3, Vector3, Vector3, Vector3] = [
    pose.position.clone(),
    pose.position.clone().add(new Vector3(0, 0.24, 0.02)),
    entry.clone().add(new Vector3(-0.22, 0.04, 0.1)),
    entry.clone(),
  ];
  const enterOffset = inside.clone().sub(entry);

  // Camera: khoá đầu là camera cuối của chương quan sát (theo từng bố cục), sau đó bám gói lên khiên và tiến lại gần khi gói biến đổi.
  const shared = (fits: readonly number[]): CamKey[] => [
    { p: 0.2, target: new Vector3(1.52, 1.24, 0.5), dist: 1.8, az: -4, el: 13, fit: fits[0]! },
    { p: 0.38, target: S.clone().add(new Vector3(0, -0.03, 0)), dist: 1.7, az: -2, el: 5, fit: fits[1]! },
    { p: 0.58, target: S.clone().add(new Vector3(0, -0.02, 0)), dist: 1.38, az: 0, el: 3, fit: fits[2]! },
    { p: 0.84, target: S.clone().add(new Vector3(0, -0.02, 0)), dist: 1.34, az: 0, el: 2, fit: fits[3]! },
    { p: 1, target: S.clone().add(new Vector3(0, -0.01, 0)), dist: 1.48, az: 0, el: 2, fit: fits[4]! },
  ];
  const build = (keys: CamKey[]) => {
    const xs = keys.map((k) => k.p);
    const c = (get: (k: CamKey) => number) => new MonotoneCurve(xs, keys.map(get));
    return { tx: c((k) => k.target.x), ty: c((k) => k.target.y), tz: c((k) => k.target.z), dist: c((k) => k.dist), az: c((k) => k.az), el: c((k) => k.el), fit: c((k) => k.fit) };
  };
  const startCam = { wide: start.camera("wide"), narrow: start.camera("narrow") };
  // Khung hẹp (dọc): bớt lùi xa khi đã tới khiên để dải ký tự còn đọc được; khiên vẫn nằm trọn trong bề ngang.
  const curves = {
    wide: build([toKey(0, startCam.wide), ...shared([1, 1, 1, 1, 1])]),
    narrow: build([toKey(0, startCam.narrow), ...shared([0.92, 0.78, 0.66, 0.64, 0.66])]),
  };
  const fov = { wide: startCam.wide.fov, narrow: startCam.narrow.fov };
  const uiRoom = { wide: startCam.wide.uiRoom, narrow: startCam.narrow.uiRoom };

  const newFrame = (): SecFrame => ({
    p: 0,
    phase: "lifting",
    packet: createPacketState(),
    hex: { ...HEX_HIDDEN },
    camera: { position: new Vector3(), target: new Vector3(), fov: 30, fit: 1, uiRoom: 1 },
    shield: { opacity: 0, glow: 0, rise: 0 },
    roomDim: 0,
    light: 0,
    trayGlow: 1,
    labels: { hub: 1, shield: 0, digest: 0 },
  });

  const qa = new Quaternion();
  return {
    start: pose,
    inside,
    path,
    evaluate(pIn, layout, out = newFrame()) {
      const p = clamp01(pIn);
      out.p = p;

      // Gói: đường bay + đoạn đi vào lòng khiên (cộng dồn, nên hai đoạn gối nhau vẫn liên tục).
      const s = out.packet;
      bezier(path, smootherstep(win(p, SEC.travel)), s.position);
      s.position.addScaledVector(enterOffset, smoothstep(win(p, SEC.enter)));
      qa.copy(pose.quaternion).slerp(Q_TILT, smoothstep(win(p, SEC.tilt)));
      s.quaternion.copy(qa).slerp(Q_FACE, smoothstep(win(p, SEC.face)));
      s.scale = pose.scale * lerp(1, SECURE_SCALE.inside, smootherstep(win(p, SEC.grow))) * lerp(1, SECURE_SCALE.final / SECURE_SCALE.inside, smootherstep(win(p, SEC.finalGrow)));
      // Các lớp của thẻ: giữ đúng trạng thái cuối của chương trước, chỉ mờ dần khi mặt ảnh đã lát thành ô.
      const card = 1 - smooth(p, SEC.card[0], SEC.card[1]);
      s.phase = "arrived";
      s.opacity = 1;
      s.brackets = 0;
      s.snapshot = 0;
      s.mosaic = card;
      s.slab = card;
      s.transit = 1;
      s.velocity.set(0, 0, 0);

      out.hex.fragment = win(p, SEC.fragment);
      out.hex.spread = smooth(p, SEC.spread[0], SEC.spread[1]);
      out.hex.converge = win(p, SEC.converge);
      out.hex.digest = smooth(p, SEC.digest[0], SEC.digest[1]);
      out.hex.fade = 0;

      if (p < 0.14) out.phase = "lifting";
      else if (p < SEC.enter[0]) out.phase = "approaching";
      else if (p < SEC.fragment[0]) out.phase = "entering";
      else if (p < SEC.converge[0]) out.phase = "fragmenting";
      else if (p < SEC.digest[0]) out.phase = "converging";
      else if (p < 1 - 1e-9) out.phase = "digest";
      else out.phase = "settled";

      // Camera.
      const c = curves[layout];
      const cam = out.camera;
      const dist = c.dist.at(p);
      const az = c.az.at(p) * D2R;
      const el = c.el.at(p) * D2R;
      cam.target.set(c.tx.at(p), c.ty.at(p), c.tz.at(p));
      const horiz = Math.cos(el) * dist;
      cam.position.set(cam.target.x + Math.sin(az) * horiz, cam.target.y + Math.sin(el) * dist, cam.target.z + Math.cos(az) * horiz);
      cam.fov = fov[layout];
      cam.fit = c.fit.at(p);
      cam.uiRoom = uiRoom[layout];

      // Khiên và không khí: khiên hiện và nâng nhẹ lên chỗ; viền trong sáng hơn khi gói đi vào, dịu lại lúc biến đổi, ổn định ở cuối.
      out.shield.opacity = smooth(p, 0.04, 0.26);
      out.shield.rise = smooth(p, 0.04, 0.3);
      out.shield.glow = 0.3 + 0.5 * smooth(p, 0.3, 0.44) - 0.3 * smooth(p, 0.58, 0.78) + 0.2 * smooth(p, 0.86, 1);
      out.roomDim = smooth(p, 0.08, 0.5);
      out.light = smooth(p, 0.02, 0.3);
      out.trayGlow = 1 - smooth(p, 0.03, 0.15);
      out.labels.hub = 1 - smooth(p, 0.03, 0.14);
      out.labels.shield = smooth(p, 0.16, 0.26) * (1 - smooth(p, 0.46, 0.54));
      out.labels.digest = smooth(p, 0.88, 0.96);
      return out;
    },
  };
}

/** Hộp bao của thân hub (m): dùng cho kiểm thử va chạm. */
export const HUB_BOX = {
  min: new Vector3(LAYOUT.hub.x - 0.17, COUNTER_TOP, LAYOUT.hub.z - 0.12),
  max: new Vector3(LAYOUT.hub.x + 0.17, COUNTER_TOP + 0.17, LAYOUT.hub.z + 0.12),
} as const;
