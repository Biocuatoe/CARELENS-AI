import { describe, expect, it } from "vitest";
import { Group } from "three";
import { CareFigure, POSE_CHANNELS } from "./figure";
import { MonotoneCurve, createFallTimeline } from "./fallTimeline";
import { FALL_STEPS, stepAt } from "./steps";

function setup() {
  const world = new Group();
  const figure = new CareFigure();
  world.add(figure.root);
  world.updateMatrixWorld(true);
  const timeline = createFallTimeline(figure);
  /** Áp khung p và trả toạ độ các điểm dò trên bề mặt cơ thể (đã trừ bán kính). */
  const at = (p: number) => {
    const f = timeline.evaluate(p, "wide");
    figure.applyPose(f.pose);
    return { frame: f, points: figure.probePoints(), lowest: figure.lowestPoint() };
  };
  return { figure, timeline, at };
}

const samples = (step: number) => Array.from({ length: Math.round(1 / step) + 1 }, (_, i) => Math.min(1, i * step));

describe("dòng thời gian tình huống ngã", () => {
  it("người luôn chạm sàn: không lơ lửng, không xuyên sàn ở mọi tiến trình", () => {
    const { at } = setup();
    for (const p of samples(0.0025)) {
      const { lowest, points } = at(p);
      expect(Math.abs(lowest), `p = ${p}`).toBeLessThan(1e-9);
      for (const v of points) expect(v.y, `p = ${p}`).toBeGreaterThan(-1e-9);
    }
  });

  it("chuyển động liền mạch: không điểm nào trên người hay camera nhảy giữa hai bước cuộn nhỏ", () => {
    const { at } = setup();
    let prev = at(0);
    let prevCam = prev.frame.camera.position.clone();
    let maxBody = 0;
    let maxCam = 0;
    for (const p of samples(0.001).slice(1)) {
      const cur = at(p);
      cur.points.forEach((v, i) => (maxBody = Math.max(maxBody, v.distanceTo(prev.points[i]!))));
      maxCam = Math.max(maxCam, cur.frame.camera.position.distanceTo(prevCam));
      prev = cur;
      prevCam = cur.frame.camera.position.clone();
    }
    // 0,001 tiến trình ≈ 2–3 px cuộn: cơ thể dịch tối đa vài cm, camera tối đa vài cm.
    expect(maxBody).toBeLessThan(0.04);
    expect(maxCam).toBeLessThan(0.05);
  });

  it("cuộn ngược không trôi: cùng p luôn cho đúng cùng khung hình, bất kể đi tới từ đâu", () => {
    const { at } = setup();
    const checkpoints = [0, 0.1, 0.29, 0.37, 0.42, 0.5, 0.6, 0.75, 1];
    const reference = checkpoints.map((p) => at(p).points.map((v) => v.toArray()));
    // Quét tới, lùi, rồi tới lại với bước lẻ.
    const path = [...samples(0.0037), ...samples(0.0029).reverse(), ...samples(0.0051)];
    for (const p of path) at(p);
    checkpoints.forEach((p, k) => {
      const again = at(p).points.map((v) => v.toArray());
      expect(again, `p = ${p}`).toEqual(reference[k]);
    });
  });

  it("camera không xuống dưới sàn và không chui vào người", () => {
    const { at } = setup();
    for (const p of samples(0.005)) {
      const { frame, points } = at(p);
      const cam = frame.camera.position;
      expect(cam.y, `p = ${p}`).toBeGreaterThan(0.25);
      for (const v of points) expect(cam.distanceTo(v), `p = ${p}`).toBeGreaterThan(0.35);
    }
  });

  it("ba bước theo đúng thứ tự: thông báo chỉ hiện ở bước cuối, vòng ghi nhận chỉ sau khi người đã nằm yên", () => {
    const { at } = setup();
    for (const p of samples(0.005)) {
      const { frame } = at(p);
      expect(frame.step).toBe(stepAt(p));
      if (frame.card > 0) expect(frame.step, `p = ${p}`).toBe(2);
      if (p < 0.52) for (const r of frame.rings) expect(r.opacity, `p = ${p}`).toBe(0);
    }
    FALL_STEPS.forEach((s, i) => expect(stepAt(s.rest)).toBe(i));
    expect(at(FALL_STEPS[2].rest).frame.card).toBe(1);
    expect(at(1).frame.rings.every((r) => r.opacity === 0)).toBe(true);
  });

  it("tư thế đứng và tư thế nằm tách bạch: đầu cao khi đứng, sát sàn khi nằm", () => {
    const { figure, at } = setup();
    at(0);
    const standing = Math.max(...figure.probePoints().map((v) => v.y));
    at(1);
    const lying = Math.max(...figure.probePoints().map((v) => v.y));
    // Điểm dò cao nhất là mép dưới của khối đầu (đã trừ bán kính 0,1 m): đỉnh đầu khoảng 1,65 m khi đứng.
    expect(standing).toBeGreaterThan(1.35);
    expect(standing).toBeLessThan(1.6);
    expect(lying).toBeLessThan(0.45);
  });
});

describe("MonotoneCurve", () => {
  it("đi qua đúng các khoá và không vượt khoảng giữa hai khoá kề nhau", () => {
    const xs = [0, 0.2, 0.3, 0.7, 1];
    const ys = [0, 10, 10, -40, -38];
    const c = new MonotoneCurve(xs, ys);
    xs.forEach((x, i) => expect(c.at(x)).toBeCloseTo(ys[i]!, 12));
    for (let i = 0; i < xs.length - 1; i++) {
      const lo = Math.min(ys[i]!, ys[i + 1]!);
      const hi = Math.max(ys[i]!, ys[i + 1]!);
      for (let t = 0; t <= 1; t += 0.01) {
        const v = c.at(xs[i]! + (xs[i + 1]! - xs[i]!) * t);
        expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(v).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });

  it("mọi kênh tư thế được khai báo", () => {
    expect(new Set(POSE_CHANNELS).size).toBe(POSE_CHANNELS.length);
  });
});
