import { CurvePath, LineCurve3, QuadraticBezierCurve3, Vector3 } from "three";
import {
  BEATS,
  BEAT_HOLD_P,
  CAP_WINDOW,
  EXPLODE_RANGE,
  LABEL_FADE,
  PART_WINDOWS,
  PATH_RULES,
  SNAPSHOT_P,
  STAGES,
  STAGE_CAMERA_KEYS,
  VIEW_SHIFT,
  beatCenterP,
  type CameraKey,
  type Layout,
  type MovingPartId,
  type StageConfig,
} from "./animationConfig";
import { COMPONENTS, center, extent, type AxisBox, type PartId } from "./assemblyConfig";

/**
 * Dòng thời gian cuộn: hàm THUẦN từ tiến trình p ∈ [0, 1] ra tư thế mọi vật thể, góc máy và độ mờ nhãn.
 * Không đọc hay ghi trạng thái nào khác ngoài `assemblyConfig` (vị trí nhà, trạm) và `animationConfig` (thời gian, góc máy):
 * cùng một p luôn cho cùng một kết quả nên cuộn tới, lùi, nhảy hay tải lại ở vị trí bất kỳ đều không để lại sai số tích luỹ,
 * và p = 0 trả về đúng từng bit vị trí nhà.
 */

export interface CameraPose {
  /** Điểm nhìn (khung CAD, mm). */
  center: Vector3;
  radius: number;
  azimuth: number;
  elevation: number;
  margin: number;
  shiftX: number;
  shiftY: number;
  /** Trọng số khung hero (0 → 1), xem CameraKey.hero. */
  hero: number;
}

export interface FrameState {
  progress: number;
  stage: StageConfig;
  /** Tiến trình trong giai đoạn hiện tại, 0 → 1. */
  stageProgress: number;
  /** Vị trí tâm vật thể (khung CAD, mm). Hướng của vật thể không đổi trong hoạt ảnh. */
  positions: Record<PartId, Vector3>;
  camera: CameraPose;
  /** Độ mờ (0 → 1) của nhãn từng nhịp, theo thứ tự `BEATS`. */
  beatOpacity: number[];
  /** Chỉ số nhịp có nhãn rõ nhất, hoặc −1 nếu chưa có nhãn nào. */
  activeBeat: number;
  /** Các linh kiện cần nhấn mạnh (viền teal) cho nhịp đang rõ. */
  highlight: PartId[];
}

export interface Timeline {
  readonly homes: Readonly<Record<PartId, Vector3>>;
  readonly stations: Readonly<Record<PartId, Vector3>>;
  readonly movingParts: readonly MovingPartId[];
  evaluate(p: number, layout?: Layout, out?: FrameState): FrameState;
  createFrame(): FrameState;
  /** Điểm trên đường đi của linh kiện theo tham số độ dài cung u ∈ [0, 1]. */
  pathPoint(id: MovingPartId, u: number, out: Vector3): Vector3;
  pathLength(id: MovingPartId): number;
  /** Tham số u (đã làm mượt) của linh kiện ở tiến trình p. */
  partU(id: MovingPartId, p: number): number;
  /** Điểm trên đường đi của nắp (chỉ dịch theo Z). */
  capU(p: number): number;
  stationBox(id: PartId): AxisBox;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const smootherstep = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Chế độ giảm chuyển động: chỉ ba ảnh tĩnh (đóng, đã mở nắp, đã tách), không nội suy. */
export function snapProgress(p: number): number {
  return p < 1 / 3 ? SNAPSHOT_P.assembled : p < 2 / 3 ? SNAPSHOT_P.open : SNAPSHOT_P.exploded;
}

function buildPath(points: Vector3[], radius: number): CurvePath<Vector3> {
  // Bỏ điểm trùng và điểm thẳng hàng để bo góc đúng ở các chỗ đổi hướng thật.
  const pts: Vector3[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (last && last.distanceTo(p) < 1e-6) continue;
    pts.push(p.clone());
  }
  for (let i = pts.length - 2; i >= 1; i--) {
    const a = pts[i]!.clone().sub(pts[i - 1]!);
    const b = pts[i + 1]!.clone().sub(pts[i]!);
    if (a.clone().cross(b).lengthSq() < 1e-9) pts.splice(i, 1);
  }
  const path = new CurvePath<Vector3>();
  path.arcLengthDivisions = 1000;
  let cursor = pts[0]!;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    const next = pts[i + 1]!;
    const a = cur.clone().sub(prev);
    const b = next.clone().sub(cur);
    const r = Math.min(radius, a.length() / 2, b.length() / 2);
    const start = cur.clone().addScaledVector(a.normalize(), -r);
    const end = cur.clone().addScaledVector(b.normalize(), r);
    if (cursor.distanceTo(start) > 1e-6) path.add(new LineCurve3(cursor, start));
    path.add(new QuadraticBezierCurve3(start, cur.clone(), end));
    cursor = end;
  }
  const lastPoint = pts[pts.length - 1]!;
  if (cursor.distanceTo(lastPoint) > 1e-6) path.add(new LineCurve3(cursor, lastPoint));
  return path;
}

const boxSphere = (b: AxisBox): { center: Vector3; radius: number } => {
  const c = center(b);
  const e = extent(b);
  return { center: new Vector3(...c), radius: Math.hypot(e[0], e[1], e[2]) / 2 };
};

export function createTimeline(): Timeline {
  const homes = {} as Record<PartId, Vector3>;
  const stations = {} as Record<PartId, Vector3>;
  const stationBoxes = {} as Record<PartId, AxisBox>;
  for (const c of COMPONENTS) {
    homes[c.id] = new Vector3(...center(c.assembled.box));
    stations[c.id] = new Vector3(...c.exploded.position);
    const e = extent(c.assembled.box);
    const s = c.exploded.position;
    stationBoxes[c.id] = { x: [s[0] - e[0] / 2, s[0] + e[0] / 2], y: [s[1] - e[1] / 2, s[1] + e[1] / 2], z: [s[2] - e[2] / 2, s[2] + e[2] / 2] };
  }

  const movingParts = Object.keys(PART_WINDOWS) as MovingPartId[];
  const paths = new Map<MovingPartId, CurvePath<Vector3>>();
  for (const id of movingParts) {
    const cfg = COMPONENTS.find((c) => c.id === id)!;
    const home = homes[id];
    const station = stations[id];
    const lift = Math.max(0, PATH_RULES.rimZ + PATH_RULES.clearanceMm - cfg.assembled.box.z[0]);
    const zHigh = Math.max(home.z + lift, station.z);
    paths.set(
      id,
      buildPath(
        [home, new Vector3(home.x, home.y, zHigh), new Vector3(station.x, station.y, zHigh), station],
        PATH_RULES.cornerRadiusMm,
      ),
    );
  }

  // Khoá góc máy: các giai đoạn lớn cộng với hai khoá (đầu và cuối đoạn giữ) cho mỗi nhịp khám phá.
  const keys: CameraKey[] = [...STAGE_CAMERA_KEYS];
  BEATS.forEach((beat, i) => {
    const p = beatCenterP(i);
    for (const dp of [-BEAT_HOLD_P, BEAT_HOLD_P]) {
      keys.push({ p: p + dp, azimuth: beat.azimuth, elevation: beat.elevation, focus: { parts: beat.parts }, margin: beat.margin, shift: 1 });
    }
  });
  keys.sort((a, b) => a.p - b.p);
  const resolved = keys.map((k) => {
    let sphere: { center: Vector3; radius: number };
    if ("box" in k.focus) sphere = boxSphere(k.focus.box);
    else {
      const ids = k.focus.parts;
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const id of ids) {
        const b = stationBoxes[id];
        min.min(new Vector3(b.x[0], b.y[0], b.z[0]));
        max.max(new Vector3(b.x[1], b.y[1], b.z[1]));
      }
      sphere = boxSphere({ x: [min.x, max.x], y: [min.y, max.y], z: [min.z, max.z] });
    }
    return { key: k, ...sphere };
  });

  const createFrame = (): FrameState => ({
    progress: 0,
    stage: STAGES[0]!,
    stageProgress: 0,
    positions: Object.fromEntries(COMPONENTS.map((c) => [c.id, homes[c.id]!.clone()])) as Record<PartId, Vector3>,
    camera: { center: new Vector3(), radius: 1, azimuth: 0, elevation: 0, margin: 1, shiftX: 0, shiftY: 0, hero: 0 },
    beatOpacity: BEATS.map(() => 0),
    activeBeat: -1,
    highlight: [],
  });

  const capHome = homes["enclosure-cap"];
  const capStation = stations["enclosure-cap"];

  const timeline: Timeline = {
    homes,
    stations,
    movingParts,
    createFrame,
    stationBox: (id) => stationBoxes[id],
    pathPoint(id, u, out) {
      if (u <= 0) return out.copy(homes[id]);
      if (u >= 1) return out.copy(stations[id]);
      return paths.get(id)!.getPointAt(u, out);
    },
    pathLength: (id) => paths.get(id)!.getLength(),
    partU(id, p) {
      const [e0, e1] = EXPLODE_RANGE;
      const s = (p - e0) / (e1 - e0);
      const [w0, w1] = PART_WINDOWS[id];
      return smoothstep((s - w0) / (w1 - w0));
    },
    capU: (p) => smootherstep((p - CAP_WINDOW[0]) / (CAP_WINDOW[1] - CAP_WINDOW[0])),
    evaluate(pIn, layout = "wide", out = createFrame()) {
      const p = clamp01(pIn);
      out.progress = p;
      let stage = STAGES[STAGES.length - 1]!;
      for (const s of STAGES) {
        if (p < s.to) {
          stage = s;
          break;
        }
      }
      out.stage = stage;
      out.stageProgress = clamp01((p - stage.from) / (stage.to - stage.from));

      for (const c of COMPONENTS) out.positions[c.id].copy(homes[c.id]);
      const capU = timeline.capU(p);
      if (capU >= 1) out.positions["enclosure-cap"].copy(capStation);
      else if (capU > 0) out.positions["enclosure-cap"].lerpVectors(capHome, capStation, capU);
      for (const id of movingParts) timeline.pathPoint(id, timeline.partU(id, p), out.positions[id]);

      // Camera: nội suy mượt giữa hai khoá liền kề.
      let i = 0;
      while (i < resolved.length - 2 && p >= resolved[i + 1]!.key.p) i++;
      const a = resolved[i]!;
      const b = resolved[i + 1]!;
      const t = smootherstep((p - a.key.p) / (b.key.p - a.key.p));
      const cam = out.camera;
      cam.center.lerpVectors(a.center, b.center, t);
      cam.radius = a.radius + (b.radius - a.radius) * t;
      cam.azimuth = a.key.azimuth + (b.key.azimuth - a.key.azimuth) * t;
      cam.elevation = a.key.elevation + (b.key.elevation - a.key.elevation) * t;
      const ma = layout === "narrow" ? (a.key.marginNarrow ?? a.key.margin) : a.key.margin;
      const mb = layout === "narrow" ? (b.key.marginNarrow ?? b.key.margin) : b.key.margin;
      cam.margin = ma + (mb - ma) * t;
      const shift = VIEW_SHIFT[layout];
      const sk = a.key.shift + (b.key.shift - a.key.shift) * t;
      cam.shiftX = shift.x * sk;
      cam.shiftY = shift.y * sk;
      const ha = a.key.hero ?? 0;
      cam.hero = ha + ((b.key.hero ?? 0) - ha) * t;

      // Nhãn.
      let best = -1;
      let bestOpacity = 0;
      for (let k = 0; k < BEATS.length; k++) {
        const d = Math.abs(p - beatCenterP(k));
        const o = 1 - smoothstep((d - LABEL_FADE.inner) / (LABEL_FADE.outer - LABEL_FADE.inner));
        out.beatOpacity[k] = o;
        if (o > bestOpacity) {
          bestOpacity = o;
          best = k;
        }
      }
      out.activeBeat = best;
      out.highlight = best >= 0 && bestOpacity > 0.55 ? [...BEATS[best]!.parts] : [];
      return out;
    },
  };
  return timeline;
}
