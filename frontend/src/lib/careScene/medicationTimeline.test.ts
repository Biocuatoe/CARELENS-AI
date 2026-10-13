import { beforeAll, describe, expect, it } from "vitest";
import { Group, Quaternion, Vector3 } from "three";
import { CareFigure } from "./figure";
import { createPacketState, samplePacket, type PacketPhase } from "./dataPacket";
import { COUNTER_TOP, LAYOUT } from "./medicationLayout";
import { MED_STEPS, medStepAt } from "./medicationSteps";
import { MED, createMedicationTimeline, type MedicationTimeline } from "./medicationTimeline";

let figure: CareFigure;
let timeline: MedicationTimeline;

beforeAll(() => {
  const world = new Group();
  figure = new CareFigure({ detailedHands: true });
  world.add(figure.root);
  world.updateMatrixWorld(true);
  timeline = createMedicationTimeline(figure);
});

const samples = (step: number) => Array.from({ length: Math.round(1 / step) + 1 }, (_, i) => Math.min(1, i * step));

/** Áp khung p vào hình người và trả về vị trí điểm nắm của tay phải. */
function gripAt(p: number): Vector3 {
  const f = timeline.evaluate(p, "wide");
  figure.applyPose(f.pose);
  figure.hands.right!.setGrip(f.grips.right);
  return figure.gripWorld("right", new Vector3());
}

describe("động học ngược của tay phải", () => {
  it("điểm nắm trùng đích ở mọi khoá (sai số dưới 1 mm)", () => {
    expect(timeline.ikError).toBeLessThan(0.001);
  });

  it("ly đổi chủ (quầy → tay → quầy) không nhảy: điểm nắm trùng đúng vị trí ly trên quầy lúc nắm và lúc thả", () => {
    expect(timeline.graspAnchor.distanceTo(LAYOUT.glassRest)).toBeLessThan(0.001);
    expect(gripAt(MED.grasp).distanceTo(LAYOUT.glassRest)).toBeLessThan(0.001);
    expect(gripAt(MED.released - 1e-6).distanceTo(LAYOUT.glassRest)).toBeLessThan(0.002);
    // Ly chỉ ở trong tay trong khoảng [nắm, thả).
    expect(timeline.evaluate(MED.grasp - 0.001, "wide").glassHeld).toBe(false);
    expect(timeline.evaluate(MED.grasp, "wide").glassHeld).toBe(true);
    expect(timeline.evaluate(MED.released - 0.001, "wide").glassHeld).toBe(true);
    expect(timeline.evaluate(MED.released, "wide").glassHeld).toBe(false);
  });

  it("ly cầm trong tay không xuyên mặt quầy và không bay xa tầm với của người", () => {
    const shoulder = new Vector3(-0.162, 1.37, 0);
    for (const p of samples(0.005)) {
      const f = timeline.evaluate(p, "wide");
      if (!f.glassHeld) continue;
      const g = gripAt(p);
      expect(g.y, `p = ${p}`).toBeGreaterThan(LAYOUT.glassRest.y - 0.002);
      expect(g.distanceTo(shoulder), `p = ${p}`).toBeLessThan(0.62);
    }
  });

  it("bàn tay chuyển động liền mạch: không bước nhảy nào quá 1 cm giữa hai bước cuộn 0,001", () => {
    let prev = gripAt(0);
    let max = 0;
    for (const p of samples(0.001).slice(1)) {
      const cur = gripAt(p);
      max = Math.max(max, cur.distanceTo(prev));
      prev = cur;
    }
    expect(max).toBeLessThan(0.01);
  });
});

describe("gói dữ liệu", () => {
  const plan = () => timeline.plan;

  it("đi đúng thứ tự pha và kết thúc ở khay: ẩn → ngắm → chụp → co lại → bay → tới", () => {
    const order: PacketPhase[] = ["hidden", "framing", "captured", "condensing", "transit", "arrived"];
    let rank = 0;
    const seen = new Set<PacketPhase>();
    for (const p of samples(0.0025)) {
      const s = samplePacket(plan(), p);
      const r = order.indexOf(s.phase);
      expect(r, `p = ${p}`).toBeGreaterThanOrEqual(rank);
      rank = r;
      seen.add(s.phase);
    }
    expect([...seen]).toEqual(order);
  });

  it("tư thế cuối đúng khay: nằm phẳng, mặt ngửa, tâm trên khay, độ lớn bằng thẻ thật", () => {
    const end = samplePacket(plan(), 1);
    expect(end.phase).toBe("arrived");
    expect(end.position.distanceTo(plan().dock.position)).toBeLessThan(1e-9);
    expect(end.quaternion.angleTo(plan().dock.quaternion)).toBeLessThan(1e-9);
    expect(end.scale).toBeCloseTo(1, 12);
    const normal = new Vector3(0, 0, 1).applyQuaternion(end.quaternion);
    expect(normal.y).toBeCloseTo(1, 9);
    expect(end.position.y).toBeGreaterThan(COUNTER_TOP);
    expect(Math.hypot(end.position.x - LAYOUT.tray.x, end.position.z - LAYOUT.tray.z)).toBeLessThan(1e-9);
  });

  it("liên tục theo p: vị trí, hướng, độ lớn và độ hiện không nhảy giữa hai bước cuộn 0,0005", () => {
    let prev = samplePacket(plan(), 0);
    let maxPos = 0;
    let maxAngle = 0;
    let maxScale = 0;
    let maxAlpha = 0;
    const prevQ = new Quaternion();
    for (const p of samples(0.0005).slice(1)) {
      const cur = samplePacket(plan(), p);
      if (prev.opacity > 0.01 && cur.opacity > 0.01) {
        maxPos = Math.max(maxPos, cur.position.distanceTo(prev.position));
        prevQ.copy(prev.quaternion);
        maxAngle = Math.max(maxAngle, cur.quaternion.angleTo(prevQ));
        maxScale = Math.max(maxScale, Math.abs(cur.scale - prev.scale));
      }
      maxAlpha = Math.max(maxAlpha, Math.abs(cur.opacity - prev.opacity), Math.abs(cur.snapshot - prev.snapshot), Math.abs(cur.mosaic - prev.mosaic), Math.abs(cur.slab - prev.slab));
      prev = cur;
    }
    expect(maxPos).toBeLessThan(0.012);
    expect(maxAngle).toBeLessThan(0.02);
    expect(maxScale).toBeLessThan(0.06);
    expect(maxAlpha).toBeLessThan(0.05);
  });

  it("tất định: cùng p cho đúng cùng trạng thái dù quét tới, lùi hay nhảy cóc", () => {
    const checkpoints = [0.39, 0.46, 0.6, 0.7, 0.8, 0.9, 0.97, 1];
    const key = (p: number) => {
      const s = samplePacket(plan(), p);
      return [...s.position.toArray(), ...s.quaternion.toArray(), s.scale, s.opacity, s.brackets, s.snapshot, s.mosaic, s.slab, s.transit];
    };
    const reference = checkpoints.map(key);
    const path = [...samples(0.0037), ...samples(0.0029).reverse(), 0.5, 0.99, 0.01, 0.73, 0.42];
    for (const p of path) key(p);
    checkpoints.forEach((p, i) => expect(key(p), `p = ${p}`).toEqual(reference[i]));
    // Ghi đè vào cùng một đối tượng đầu ra không để lại dấu vết của lần trước.
    const shared = createPacketState();
    samplePacket(plan(), 0.9, shared);
    samplePacket(plan(), 0.5, shared);
    expect(samplePacket(plan(), 0.8, shared).position.toArray()).toEqual(samplePacket(plan(), 0.8).position.toArray());
  });

  it("không xuyên mặt quầy hay thân hub trong suốt chuyến bay", () => {
    const hub = { min: new Vector3(LAYOUT.hub.x - 0.17, COUNTER_TOP, LAYOUT.hub.z - 0.12), max: new Vector3(LAYOUT.hub.x + 0.17, COUNTER_TOP + 0.17, LAYOUT.hub.z + 0.12) };
    for (const p of samples(0.002)) {
      const s = samplePacket(plan(), p);
      if (p < plan().windows.travel[0]) continue;
      expect(s.position.y, `p = ${p}`).toBeGreaterThan(COUNTER_TOP);
      const inside = s.position.x > hub.min.x && s.position.x < hub.max.x && s.position.y > hub.min.y && s.position.y < hub.max.y && s.position.z > hub.min.z && s.position.z < hub.max.z;
      expect(inside, `p = ${p}`).toBe(false);
    }
  });

  it("hạ xuống khay êm: không xuống thấp hơn mặt khay và tốc độ về 0 khi tới", () => {
    const trayTop = LAYOUT.tray.y + 0.0085;
    for (const p of samples(0.002)) {
      if (p < plan().windows.settle[0]) continue;
      expect(samplePacket(plan(), p).position.y).toBeGreaterThanOrEqual(trayTop);
    }
    expect(samplePacket(plan(), 1).velocity.length()).toBeLessThan(1e-3);
  });
});

describe("camera và bước", () => {
  it("camera không chui vào quầy, không xuống sàn và luôn nhìn về phía cảnh", () => {
    for (const layout of ["wide", "narrow"] as const) {
      for (const p of samples(0.005)) {
        const f = timeline.evaluate(p, layout);
        const c = f.camera.position;
        expect(c.y, `${layout} p = ${p}`).toBeGreaterThan(0.5);
        const insideCounter = c.y < COUNTER_TOP && c.z > LAYOUT.counter.frontZ && c.z < LAYOUT.counter.frontZ + LAYOUT.counter.depth;
        expect(insideCounter, `${layout} p = ${p}`).toBe(false);
        expect(c.distanceTo(f.camera.target)).toBeGreaterThan(1);
      }
    }
  });

  it("camera liền mạch: không nhảy quá 6 cm giữa hai bước cuộn 0,001", () => {
    const prev = timeline.evaluate(0, "wide").camera.position.clone();
    let max = 0;
    for (const p of samples(0.001).slice(1)) {
      const c = timeline.evaluate(p, "wide").camera.position;
      max = Math.max(max, c.distanceTo(prev));
      prev.copy(c);
    }
    expect(max).toBeLessThan(0.06);
  });

  it("bốn bước theo đúng thứ tự, ảnh tĩnh của từng bước thuộc đúng bước đó", () => {
    expect(MED_STEPS.map((s) => s.id)).toEqual(["action", "observe", "packet", "send"]);
    MED_STEPS.forEach((s, i) => expect(medStepAt(s.rest), s.id).toBe(i));
    let last = 0;
    for (const p of samples(0.002)) {
      const s = medStepAt(p);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });

  it("ảnh tĩnh của giảm chuyển động nói đúng điều cần thấy ở từng bước", () => {
    const f0 = timeline.evaluate(MED_STEPS[0].rest, "wide");
    expect(f0.glassHeld).toBe(true);
    expect(f0.packet.phase).toBe("hidden");
    const f1 = timeline.evaluate(MED_STEPS[1].rest, "wide");
    expect(f1.cone).toBeGreaterThan(0.9);
    expect(f1.packet.phase).toBe("captured");
    const f2 = timeline.evaluate(MED_STEPS[2].rest, "wide");
    expect(f2.packet.phase).toBe("condensing");
    expect(f2.packet.slab).toBeGreaterThan(0.9);
    const f3 = timeline.evaluate(MED_STEPS[3].rest, "wide");
    expect(f3.packet.phase).toBe("arrived");
    expect(f3.hubActivity).toBeGreaterThan(0.99);
  });
});
