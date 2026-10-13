import { Vector3 } from "three";
import { createPacketState, type PacketState } from "./dataPacket";
import { MonotoneCurve } from "./fallTimeline";
import { STRIP, type HexVisual } from "./hexLattice";
import type { MedCamera, MedLayout } from "./medicationTimeline";
import { SECURE_SCALE, toKey, type SecurityTimeline } from "./securityTimeline";
import { REPORT_HOLD } from "./storySteps";

/**
 * Chương tổng quan hôm nay (minh hoạ khái niệm), nối tiếp chương bảo vệ trên cùng một cảnh, cùng hệ toạ độ và cùng một gói dữ liệu.
 * Dải rút gọn vừa đứng yên ở cuối chương trước; chương này giữ nguyên nó một lúc, rồi một bề mặt báo cáo mọc ra từ chính dải đó, khiên mờ đi,
 * các ô tan vào bề mặt trong khi camera tiến lại gần cho tới khi bề mặt đúng bằng khung của bản báo cáo HTML. Chữ của báo cáo là HTML thật
 * (sắc nét, co giãn theo màn hình, đọc được bằng trình đọc màn hình) đặt đúng lên khung đó; lớp HTML hiện dần khi camera đã tới nơi.
 *
 * Mọi thứ là hàm thuần của p ∈ [0, 1] (tiến trình trong chương). Khung ở p = 0 trùng khung cuối của chương bảo vệ ở mọi thành phần.
 * Báo cáo là dữ liệu mô phỏng có nhãn; không có số liệu đo, độ chính xác hay kết luận y khoa nào ở đây.
 */

export type ReportPhase = "resting" | "opening" | "revealing" | "stable";

export const REPORT = {
  /** Đứng yên: dải rút gọn vẫn như cuối chương bảo vệ. */
  rest: 0.08,
  /** Bề mặt mọc ra và camera tiến tới. */
  open: [0.1, 0.5],
  surface: [0.07, 0.15],
  shield: [0.14, 0.42],
  strip: [0.36, 0.52],
  panelUi: [0.04, 0.26],
  roomFade: [0.1, 0.4],
  /** Nền HTML thế chỗ bề mặt 3D (cùng màu, cùng khung), rồi nội dung hiện dần. */
  bg: [0.46, 0.58],
  reveal: [0.54, 0.8],
  /** Báo cáo đứng yên; nếu nội dung cao hơn khung, phần cuối cuộn lên trong khoảng này. */
  hold: REPORT_HOLD,
} as const;

/** Bề mặt báo cáo nằm sau các ô lục giác một chút và trước khiên (mặt trước của khiên ở z ≈ +13 mm so với tâm khiên). */
const SURFACE_LIFT = 0.0045;
/** Mức sương mù thêm vào `roomDim` (1 = cuối chương bảo vệ) để căn phòng biến mất hẳn. */
const ROOM_FADE = 0.35;
/** Biên quanh dải rút gọn khi bề mặt mới mọc (m, ở độ lớn thật của cảnh). */
const STRIP_PAD = { x: 0.035, y: 0.03 } as const;

export interface ReportRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ReportView {
  /** Điểm trên mặt phẳng bề mặt mà camera cuối nhìn vào và khoảng cách tới đó (trước khi nhân hệ số vừa khung). */
  target: Vector3;
  dist: number;
  fov: number;
  fit: number;
}

export interface ReportFrame {
  p: number;
  phase: ReportPhase;
  packet: PacketState;
  hex: HexVisual;
  camera: MedCamera;
  shield: { opacity: number; glow: number; rise: number };
  roomDim: number;
  light: number;
  trayGlow: number;
  labels: { hub: number; shield: number; digest: number };
  /** Bề mặt 3D: mức mọc (0 = vừa quanh dải rút gọn, 1 = đúng khung báo cáo) và độ hiện. */
  surface: { grow: number; opacity: number };
  /** Lớp HTML: độ hiện của bảng bước, của nền, của nội dung (0–1) và mức cuộn nội dung khi cao hơn khung (0–1). */
  ui: { panel: number; bg: number; reveal: number; hold: number };
}

export interface ReportTimeline {
  evaluate(p: number, layout: MedLayout, out?: ReportFrame): ReportFrame;
  /** Camera cuối (theo bố cục) dùng để quy khung HTML về khung 3D. */
  view(layout: MedLayout): ReportView;
  /** Mặt phẳng bề mặt (toạ độ z) và hình chữ nhật xuất phát quanh dải rút gọn (m, thế giới). */
  readonly plane: { z: number; start: ReportRect };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const win = (p: number, [a, b]: readonly [number, number]) => clamp01((p - a) / (b - a));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const smooth = (p: number, w: readonly [number, number]) => smoothstep(win(p, w));
const D2R = Math.PI / 180;

export function createReportTimeline(security: SecurityTimeline): ReportTimeline {
  const end = { wide: security.evaluate(1, "wide"), narrow: security.evaluate(1, "narrow") };
  const z = security.inside.z + SURFACE_LIFT;
  const cx = security.inside.x;
  const cy = security.inside.y;
  const stripW = (STRIP.width * SECURE_SCALE.final) / 2 + STRIP_PAD.x;
  const stripH = (STRIP.height * SECURE_SCALE.final) / 2 + STRIP_PAD.y;
  const start: ReportRect = { x0: cx - stripW, y0: cy - stripH, x1: cx + stripW, y1: cy + stripH };

  const views: Record<MedLayout, ReportView> = {
    wide: { target: new Vector3(cx, cy, z), dist: 1.0, fov: end.wide.camera.fov, fit: 1 },
    narrow: { target: new Vector3(cx, cy, z), dist: 1.0, fov: end.narrow.camera.fov, fit: 1 },
  };

  const curves = (layout: MedLayout) => {
    const a = toKey(0, end[layout].camera);
    const v = views[layout];
    const keys = [
      a,
      { ...a, p: REPORT.rest },
      { p: REPORT.open[1], target: v.target.clone(), dist: v.dist, az: 0, el: 0, fit: v.fit },
      { p: 1, target: v.target.clone(), dist: v.dist, az: 0, el: 0, fit: v.fit },
    ];
    const xs = keys.map((k) => k.p);
    const c = (get: (k: (typeof keys)[number]) => number) => new MonotoneCurve(xs, keys.map(get));
    return { tx: c((k) => k.target.x), ty: c((k) => k.target.y), tz: c((k) => k.target.z), dist: c((k) => k.dist), az: c((k) => k.az), el: c((k) => k.el), fit: c((k) => k.fit) };
  };
  const cam = { wide: curves("wide"), narrow: curves("narrow") };

  const newFrame = (): ReportFrame => ({
    p: 0,
    phase: "resting",
    packet: createPacketState(),
    hex: { fragment: 0, spread: 0, converge: 0, digest: 0, fade: 0 },
    camera: { position: new Vector3(), target: new Vector3(), fov: 30, fit: 1, uiRoom: 1 },
    shield: { opacity: 0, glow: 0, rise: 0 },
    roomDim: 0,
    light: 0,
    trayGlow: 0,
    labels: { hub: 0, shield: 0, digest: 0 },
    surface: { grow: 0, opacity: 0 },
    ui: { panel: 1, bg: 0, reveal: 0, hold: 0 },
  });

  const copyPacket = (a: PacketState, out: PacketState) => {
    out.phase = a.phase;
    out.position.copy(a.position);
    out.quaternion.copy(a.quaternion);
    out.scale = a.scale;
    out.opacity = a.opacity;
    out.brackets = a.brackets;
    out.snapshot = a.snapshot;
    out.mosaic = a.mosaic;
    out.slab = a.slab;
    out.transit = a.transit;
    out.velocity.copy(a.velocity);
  };

  return {
    plane: { z, start },
    view: (layout) => views[layout],
    evaluate(pIn, layout, out = newFrame()) {
      const p = clamp01(pIn);
      const e = end[layout];
      out.p = p;
      // Gói dữ liệu và dải rút gọn: giữ nguyên tư thế và độ lớn cuối của chương bảo vệ, chỉ các ô tan đi.
      copyPacket(e.packet, out.packet);
      out.hex.fragment = e.hex.fragment;
      out.hex.spread = e.hex.spread;
      out.hex.converge = e.hex.converge;
      out.hex.digest = e.hex.digest;
      out.hex.fade = smooth(p, REPORT.strip);

      // Camera: đứng yên, rồi tiến về mặt phẳng bề mặt (nhìn thẳng, vuông góc) và nhường lại toàn khung (uiRoom về 0).
      const c = cam[layout];
      const cc = out.camera;
      const dist = c.dist.at(p);
      const az = c.az.at(p) * D2R;
      const el = c.el.at(p) * D2R;
      cc.target.set(c.tx.at(p), c.ty.at(p), c.tz.at(p));
      const horiz = Math.cos(el) * dist;
      cc.position.set(cc.target.x + Math.sin(az) * horiz, cc.target.y + Math.sin(el) * dist, cc.target.z + Math.cos(az) * horiz);
      cc.fov = e.camera.fov;
      cc.fit = c.fit.at(p);
      cc.uiRoom = e.camera.uiRoom * (1 - smootherstep(win(p, [REPORT.rest, REPORT.open[1]])));

      // Khiên mờ đi khi bề mặt mọc; căn phòng vẫn chìm trong nền.
      out.shield.opacity = e.shield.opacity * (1 - smooth(p, REPORT.shield));
      out.shield.glow = e.shield.glow * (1 - smooth(p, [REPORT.shield[0], REPORT.shield[1] - 0.05]));
      out.shield.rise = e.shield.rise;
      // Căn phòng (hub, quầy) chìm hẳn vào nền khi bề mặt mọc: sương mù khép quá mức cuối của chương bảo vệ. Gói, khiên và bề mặt không chịu sương mù.
      out.roomDim = e.roomDim + ROOM_FADE * smooth(p, REPORT.roomFade);
      out.light = e.light;
      out.trayGlow = e.trayGlow;
      out.labels.hub = 0;
      out.labels.shield = 0;
      out.labels.digest = e.labels.digest * (1 - smooth(p, [0, REPORT.rest + 0.02]));

      out.surface.grow = smootherstep(win(p, REPORT.open));
      out.surface.opacity = smooth(p, REPORT.surface);
      out.ui.panel = 1 - smooth(p, REPORT.panelUi);
      out.ui.bg = smooth(p, REPORT.bg);
      out.ui.reveal = smooth(p, REPORT.reveal);
      out.ui.hold = smooth(p, REPORT.hold);

      if (p < REPORT.rest) out.phase = "resting";
      else if (p < REPORT.open[1]) out.phase = "opening";
      else if (p < REPORT.reveal[1]) out.phase = "revealing";
      else out.phase = "stable";
      return out;
    },
  };
}

/** Khung HTML (px, gốc trên-trái của khung vẽ) quy về hình chữ nhật trên mặt phẳng bề mặt (m, thế giới) với camera cuối. */
export function worldRectFromScreen(
  rect: { x: number; y: number; w: number; h: number },
  stage: { w: number; h: number },
  view: ReportView,
  fitScale: number,
): ReportRect {
  const k = (2 * view.dist * fitScale * Math.tan((view.fov * D2R) / 2)) / stage.h;
  const left = view.target.x + (rect.x - stage.w / 2) * k;
  const right = view.target.x + (rect.x + rect.w - stage.w / 2) * k;
  const top = view.target.y - (rect.y - stage.h / 2) * k;
  const bottom = view.target.y - (rect.y + rect.h - stage.h / 2) * k;
  return { x0: left, y0: bottom, x1: right, y1: top };
}
