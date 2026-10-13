// @vitest-environment node
/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { BEATS, CAP_WINDOW, EXPLODE_RANGE, PART_WINDOWS, SNAPSHOT_P, STAGES, beatCenterP } from "./animationConfig";
import { validateTimeline } from "./animationValidation";
import { buildHardwareAssembly } from "./assembly";
import { COMPONENTS, PART_IDS, center } from "./assemblyConfig";
import { createTimeline, snapProgress } from "./timeline";
import { diskLoader } from "./testing";

const timeline = createTimeline();
const movingParts = timeline.movingParts;

function positionsAt(p: number) {
  const frame = timeline.evaluate(p);
  return Object.fromEntries(PART_IDS.map((id) => [id, frame.positions[id].toArray()])) as Record<string, number[]>;
}

describe("dòng thời gian (hàm thuần của p)", () => {
  it("p = 0 trả về đúng từng bit vị trí nhà trong assemblyConfig", () => {
    const f = timeline.evaluate(0);
    for (const c of COMPONENTS) expect(f.positions[c.id].toArray(), c.id).toEqual(center(c.assembled.box));
  });

  it("p ở cuối giai đoạn tách trả về đúng từng bit trạm tách rời; nắp ở trạm của nó", () => {
    for (const p of [EXPLODE_RANGE[1], 0.9, 1]) {
      const f = timeline.evaluate(p);
      for (const c of COMPONENTS) expect(f.positions[c.id].toArray(), `${c.id}@${p}`).toEqual(c.exploded.position);
    }
  });

  it("cuộn lung tung 2000 lần rồi quay về 0 vẫn cho đúng vị trí nhà (không tích luỹ sai số)", () => {
    const frame = timeline.createFrame();
    let seed = 12345;
    const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 2000; i++) timeline.evaluate(rand(), rand() > 0.5 ? "wide" : "narrow", frame);
    timeline.evaluate(0, "wide", frame);
    for (const c of COMPONENTS) expect(frame.positions[c.id].toArray()).toEqual(center(c.assembled.box));
  });

  it("cùng một p luôn cho cùng kết quả bất kể thứ tự đã đánh giá (tiến, lùi, nhảy)", () => {
    const a = positionsAt(0.43);
    positionsAt(0.9);
    positionsAt(0.1);
    expect(positionsAt(0.43)).toEqual(a);
    // Đi tiến và đi lùi tới cùng một điểm.
    let forward = timeline.createFrame();
    for (let p = 0; p <= 0.5; p += 0.01) forward = timeline.evaluate(p);
    let backward = timeline.createFrame();
    for (let p = 1; p >= 0.5; p -= 0.01) backward = timeline.evaluate(p);
    expect(timeline.evaluate(0.5).positions["esp32-cam"].toArray()).toEqual(timeline.evaluate(0.5, "wide", forward).positions["esp32-cam"].toArray());
    expect(timeline.evaluate(0.5, "wide", backward).positions["tp4056"].toArray()).toEqual(timeline.evaluate(0.5).positions["tp4056"].toArray());
  });

  it("mỗi linh kiện đi theo đường liên tục: bước nhảy ≤ 2 mm cho mỗi 0,001 tiến trình", () => {
    let prev = timeline.evaluate(0);
    const prevPos = Object.fromEntries(PART_IDS.map((id) => [id, prev.positions[id].clone()]));
    let max = 0;
    for (let i = 1; i <= 1000; i++) {
      const f = timeline.evaluate(i / 1000);
      for (const id of PART_IDS) {
        max = Math.max(max, f.positions[id].distanceTo(prevPos[id]!));
        prevPos[id]!.copy(f.positions[id]);
      }
      prev = f;
    }
    expect(max).toBeLessThanOrEqual(2);
  });

  it("tham số đường đi của từng linh kiện không giảm khi cuộn tới", () => {
    for (const id of movingParts) {
      let last = 0;
      for (let i = 0; i <= 1000; i++) {
        const u = timeline.partU(id, i / 1000);
        expect(u, id).toBeGreaterThanOrEqual(last - 1e-12);
        last = u;
      }
      expect(last).toBe(1);
    }
  });

  it("thứ tự và cửa sổ: nắp mở trước, rồi mới tới linh kiện; mọi cửa sổ nằm trong giai đoạn tách", () => {
    expect(CAP_WINDOW[1]).toBeLessThanOrEqual(EXPLODE_RANGE[0]);
    expect(timeline.evaluate(CAP_WINDOW[0]).positions["slide-switch"].toArray()).toEqual(center(COMPONENTS.find((c) => c.id === "slide-switch")!.assembled.box));
    for (const [id, [a, b]] of Object.entries(PART_WINDOWS)) {
      expect(a, id).toBeGreaterThanOrEqual(0);
      expect(b, id).toBeLessThanOrEqual(1);
      expect(b - a, id).toBeGreaterThan(0.1);
    }
    // Trong lúc nắp đang nhấc, chưa có linh kiện nào rời chỗ.
    for (const p of [0.1, 0.15, 0.19]) {
      const f = timeline.evaluate(p);
      for (const id of movingParts) expect(f.positions[id].toArray(), `${id}@${p}`).toEqual(center(COMPONENTS.find((c) => c.id === id)!.assembled.box));
    }
  });

  it("nắp chỉ dịch theo trục Z", () => {
    for (let p = 0; p <= 1; p += 0.01) {
      const cap = timeline.evaluate(p).positions["enclosure-cap"];
      expect(cap.x).toBe(21.5);
      expect(cap.y).toBe(16);
    }
  });

  it("camera, mạch sạc và công tắc tách ra đúng dọc trục chức năng của chúng", () => {
    const cam = timeline.homes["esp32-cam"];
    const camSt = timeline.stations["esp32-cam"];
    expect(camSt.x).toBeCloseTo(cam.x, 9); // trên trục quang
    expect(camSt.z).toBeCloseTo(cam.z, 9);
    expect(camSt.y).toBeLessThan(0); // phía trước mặt ngoài thành (y = 0)
    expect(timeline.stationBox("esp32-cam").y[1]).toBeLessThan(-5); // bo nằm hẳn ngoài vỏ
    for (const id of ["tp4056", "slide-switch"] as const) {
      const h = timeline.homes[id];
      const s = timeline.stations[id];
      expect(s.y, id).toBeCloseTo(h.y, 9); // cùng y, z: chỉ dịch theo −X
      expect(s.z, id).toBeCloseTo(h.z, 9);
      expect(s.x, id).toBeLessThan(h.x);
      expect(timeline.stationBox(id).x[1], id).toBeLessThan(-5); // hẳn ngoài thành trái
    }
  });
});

describe("góc máy và nhãn", () => {
  it("ba ảnh tĩnh của chế độ giảm chuyển động khớp các mốc đã định, nằm ở đầu mỗi phần ba của cuộn", () => {
    expect(snapProgress(0)).toBe(SNAPSHOT_P.assembled);
    expect(snapProgress(0.32)).toBe(SNAPSHOT_P.assembled);
    expect(snapProgress(0.34)).toBe(SNAPSHOT_P.open);
    expect(snapProgress(0.66)).toBe(SNAPSHOT_P.open);
    expect(snapProgress(0.67)).toBe(SNAPSHOT_P.exploded);
    expect(snapProgress(1)).toBe(SNAPSHOT_P.exploded);
  });

  it("giai đoạn phủ kín [0, 1] không hở không chồng", () => {
    expect(STAGES[0]!.from).toBe(0);
    expect(STAGES[STAGES.length - 1]!.to).toBe(1);
    for (let i = 1; i < STAGES.length; i++) expect(STAGES[i]!.from).toBe(STAGES[i - 1]!.to);
    expect(timeline.evaluate(0).stage.id).toBe("assembled");
    expect(timeline.evaluate(0.1).stage.id).toBe("open");
    expect(timeline.evaluate(0.3).stage.id).toBe("explode");
    expect(timeline.evaluate(0.7).stage.id).toBe("explore");
    expect(timeline.evaluate(1).stage.id).toBe("overview");
  });

  it("nhãn chỉ hiện trong giai đoạn khám phá, tại mỗi thời điểm có tối đa một nhãn rõ, và nhãn đạt 100% ở tâm nhịp", () => {
    for (let p = 0; p <= 1; p += 0.002) {
      const f = timeline.evaluate(p);
      const visible = f.beatOpacity.filter((o) => o > 0.5).length;
      expect(visible, `p=${p.toFixed(3)}`).toBeLessThanOrEqual(1);
      if (p < STAGES[3]!.from) expect(Math.max(...f.beatOpacity), `p=${p.toFixed(3)}`).toBe(0);
    }
    BEATS.forEach((beat, i) => {
      const f = timeline.evaluate(beatCenterP(i));
      expect(f.beatOpacity[i]).toBe(1);
      expect(f.activeBeat).toBe(i);
      expect(f.highlight).toEqual(beat.parts);
    });
    // Nhãn đầu tiên chỉ hiện sau khi linh kiện tương ứng đã tới trạm.
    const first = BEATS[0]!;
    expect(timeline.partU(first.parts[0] as (typeof movingParts)[number], beatCenterP(0) - 0.018)).toBe(1);
  });

  it("mọi nhãn đều có ghi chú trung thực và nhãn cho cả bảy nhóm linh kiện yêu cầu", () => {
    for (const b of BEATS) {
      expect(b.note.length).toBeGreaterThan(10);
      expect(b.text).not.toMatch(/\d+ ?%|chính xác|đột quỵ|mất nước|chẩn đoán|hydrat|SpO2/i);
    }
    const covered = new Set(BEATS.flatMap((b) => b.parts));
    for (const id of ["esp32-cam", "lipo-cell", "tp4056", "boost-converter", "gy521", "max98357a", "speaker", "slide-switch"] as const) expect(covered.has(id)).toBe(true);
  });

  it("góc máy liên tục: tâm, bán kính và góc không nhảy giữa hai mẫu liền kề", () => {
    let prev = timeline.evaluate(0).camera;
    const snap = { c: prev.center.clone(), r: prev.radius, az: prev.azimuth, el: prev.elevation };
    let maxCenter = 0;
    let maxAngle = 0;
    let maxRadius = 0;
    for (let i = 1; i <= 2000; i++) {
      const cam = timeline.evaluate(i / 2000).camera;
      maxCenter = Math.max(maxCenter, cam.center.distanceTo(snap.c));
      maxAngle = Math.max(maxAngle, Math.abs(cam.azimuth - snap.az), Math.abs(cam.elevation - snap.el));
      maxRadius = Math.max(maxRadius, Math.abs(cam.radius - snap.r));
      snap.c.copy(cam.center);
      snap.r = cam.radius;
      snap.az = cam.azimuth;
      snap.el = cam.elevation;
      prev = cam;
    }
    expect(prev).toBeTruthy();
    expect(maxCenter).toBeLessThan(5); // mm mỗi 0,0005
    expect(maxAngle).toBeLessThan(2); // độ
    expect(maxRadius).toBeLessThan(4);
  });

  it("dịch điểm nhìn chừa chỗ nhãn chỉ có trong giai đoạn khám phá, và đổi trục theo màn rộng/hẹp", () => {
    expect(timeline.evaluate(0.3, "wide").camera.shiftX).toBe(0);
    const wide = timeline.evaluate(beatCenterP(2), "wide").camera;
    const narrow = timeline.evaluate(beatCenterP(2), "narrow").camera;
    expect(wide.shiftX).toBeGreaterThan(0);
    expect(wide.shiftY).toBe(0);
    expect(narrow.shiftY).toBeGreaterThan(0);
    expect(narrow.shiftX).toBe(0);
  });
});

describe("kiểm tra hoạt ảnh theo mesh STL thật (animationValidation)", async () => {
  const assembly = await buildHardwareAssembly({ load: diskLoader });

  it("không có xuyên thân, chạm nắp hay va chạm giữa linh kiện suốt dòng thời gian; không nhảy vị trí", () => {
    const r = validateTimeline(assembly);
    expect(r.samples).toBe(2001);
    expect(r.bodyHits).toEqual([]);
    expect(r.capHits).toEqual([]);
    expect(r.partCollisions).toEqual([]);
    expect(r.flexibleCollisions).toEqual([]);
    expect(r.maxStepMm).toBeLessThan(1);
  });

  it("bắt được đường đi xuyên thành vỏ (kiểm tra âm)", () => {
    const straight = Object.create(assembly.timeline) as typeof assembly.timeline;
    straight.pathPoint = (id, u, out) => out.lerpVectors(assembly.timeline.homes[id], assembly.timeline.stations[id], u);
    const r = validateTimeline({ ...assembly, timeline: straight });
    expect(r.bodyHits.length).toBeGreaterThan(0);
  });

  it("bắt được va chạm khi mọi linh kiện chuyển động cùng lúc theo đường thẳng (kiểm tra âm)", () => {
    const base = assembly.timeline;
    const simultaneous = Object.create(base) as typeof base;
    simultaneous.evaluate = (p, _layout, out = base.createFrame()) => {
      base.evaluate(p, "wide", out);
      for (const id of base.movingParts) out.positions[id].lerpVectors(base.homes[id], base.stations[id], Math.min(1, Math.max(0, p)));
      return out;
    };
    const r = validateTimeline({ ...assembly, timeline: simultaneous }, { pStep: 0.002 });
    expect(r.partCollisions.length + r.capHits.length).toBeGreaterThan(0);
  });

  it("applyPositions(homes) khôi phục đúng trạng thái lắp sau khi quét toàn bộ", () => {
    validateTimeline(assembly, { pStep: 0.01 });
    for (const c of COMPONENTS) {
      expect(assembly.parts.get(c.id)!.object.position.toArray(), c.id).toEqual(center(c.assembled.box));
    }
  });
});
