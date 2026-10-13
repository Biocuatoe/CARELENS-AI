import { beforeAll, describe, expect, it } from "vitest";
import { Group, PerspectiveCamera, Vector3 } from "three";
import { finalPacketPose } from "./dataPacket";
import { CareFigure } from "./figure";
import { DIGEST_SLOTS, createHexLattice, hexPose } from "./hexLattice";
import { createMedicationTimeline } from "./medicationTimeline";
import { REPORT, createReportTimeline, worldRectFromScreen, type ReportPhase, type ReportTimeline } from "./reportTimeline";
import { SHIELD, createSecurityTimeline, type SecurityTimeline } from "./securityTimeline";
import { STORY_SPLIT, STORY_SPLIT_REPORT, STORY_STEPS, splitStory, storyProgress } from "./storySteps";

let security: SecurityTimeline;
let report: ReportTimeline;

beforeAll(() => {
  const world = new Group();
  const figure = new CareFigure({ detailedHands: true });
  world.add(figure.root);
  world.updateMatrixWorld(true);
  const obs = createMedicationTimeline(figure);
  security = createSecurityTimeline({ pose: finalPacketPose(obs.plan), camera: (layout) => obs.evaluate(1, layout).camera });
  report = createReportTimeline(security);
});

const samples = (step: number) => Array.from({ length: Math.round(1 / step) + 1 }, (_, i) => Math.min(1, i * step));
const LAYOUTS = ["wide", "narrow"] as const;

describe("bàn giao từ chương bảo vệ sang chương tổng quan", () => {
  it("khung đầu chương trùng khung cuối chương bảo vệ ở gói, dải rút gọn, khiên, ánh sáng và camera (cả hai bố cục)", () => {
    for (const layout of LAYOUTS) {
      const a = security.evaluate(1, layout);
      const b = report.evaluate(0, layout);
      expect(b.packet.position.distanceTo(a.packet.position), layout).toBeLessThan(1e-12);
      expect(b.packet.quaternion.angleTo(a.packet.quaternion), layout).toBeLessThan(1e-7);
      expect(b.packet.scale, layout).toBe(a.packet.scale);
      for (const k of ["opacity", "mosaic", "slab", "snapshot"] as const) expect(b.packet[k], `${layout} ${k}`).toBe(a.packet[k]);
      expect(b.hex, layout).toEqual(a.hex);
      expect(b.shield, layout).toEqual(a.shield);
      expect(b.roomDim, layout).toBe(a.roomDim);
      expect(b.light, layout).toBe(a.light);
      expect(b.trayGlow, layout).toBe(a.trayGlow);
      expect(b.camera.position.distanceTo(a.camera.position), layout).toBeLessThan(1e-9);
      expect(b.camera.target.distanceTo(a.camera.target), layout).toBeLessThan(1e-9);
      expect(b.camera.fov, layout).toBe(a.camera.fov);
      expect(b.camera.fit, layout).toBeCloseTo(a.camera.fit, 12);
      expect(b.camera.uiRoom, layout).toBe(a.camera.uiRoom);
      // Bảng bước còn nguyên, bề mặt và nội dung chưa hiện.
      expect(b.ui, layout).toEqual({ panel: 1, bg: 0, reveal: 0, hold: 0 });
      expect(b.surface, layout).toEqual({ grow: 0, opacity: 0 });
      expect(b.phase).toBe("resting");
    }
  });

  it("các điểm nối của câu chuyện: quy đổi qua lại đúng, mỗi chương chiếm một đoạn riêng, ảnh tĩnh của các bước nằm trước chương tổng quan", () => {
    for (const c of [0, 1, 2] as const) {
      for (const p of [0, 0.25, 1]) {
        const back = splitStory(storyProgress(c, p));
        // Đúng tại điểm nối thì thuộc cuối chương trước.
        if ((c > 0 && p === 0) || (c === 0 && p === 0)) continue;
        expect(back.chapter, `${c}@${p}`).toBe(c);
        expect(back.p, `${c}@${p}`).toBeCloseTo(p, 12);
      }
    }
    expect(splitStory(STORY_SPLIT)).toEqual({ chapter: 0, p: 1 });
    expect(splitStory(STORY_SPLIT_REPORT)).toEqual({ chapter: 1, p: 1 });
    expect(splitStory(STORY_SPLIT_REPORT + 1e-6).chapter).toBe(2);
    expect(STORY_STEPS.every((s) => s.rest <= STORY_SPLIT_REPORT)).toBe(true);
  });
});

describe("chương tổng quan hôm nay", () => {
  it("pha đi đúng thứ tự: đứng yên → mở ra → hiện nội dung → ổn định", () => {
    const order: ReportPhase[] = ["resting", "opening", "revealing", "stable"];
    let rank = 0;
    const seen = new Set<ReportPhase>();
    for (const p of samples(0.0025)) {
      const r = order.indexOf(report.evaluate(p, "wide").phase);
      expect(r, `p = ${p}`).toBeGreaterThanOrEqual(rank);
      rank = r;
      seen.add(order[r]!);
    }
    expect([...seen]).toEqual(order);
  });

  it("khung cuối: camera nhìn thẳng vào mặt phẳng bề mặt, bề mặt phủ đủ, ô lục giác đã tan, nội dung hiện đủ, bảng bước đã mờ", () => {
    for (const layout of LAYOUTS) {
      const f = report.evaluate(1, layout);
      const v = report.view(layout);
      expect(f.phase).toBe("stable");
      expect(f.camera.target.distanceTo(v.target)).toBeLessThan(1e-12);
      // Nhìn thẳng (vuông góc): camera nằm đúng trên pháp tuyến đi qua đích.
      expect(f.camera.position.x).toBeCloseTo(f.camera.target.x, 9);
      expect(f.camera.position.y).toBeCloseTo(f.camera.target.y, 9);
      expect(f.camera.position.z - f.camera.target.z).toBeCloseTo(v.dist, 9);
      expect(f.camera.uiRoom).toBe(0);
      expect(f.camera.fit).toBe(1);
      expect(f.surface).toEqual({ grow: 1, opacity: 1 });
      expect(f.hex.fade).toBe(1);
      expect(f.shield.opacity).toBe(0);
      expect(f.ui).toEqual({ panel: 0, bg: 1, reveal: 1, hold: 1 });
      const lattice = createHexLattice(0.14 * 0.92, 0.105 * 0.9);
      expect(lattice.cells.filter((c) => hexPose(lattice, c, f.hex).scale > 1e-4).length).toBe(0);
      // Gói vẫn là đối tượng cũ ở đúng tư thế cũ: chỉ lớp hiển thị đổi.
      const a = security.evaluate(1, layout);
      expect(f.packet.position.distanceTo(a.packet.position)).toBeLessThan(1e-12);
      expect(f.packet.scale).toBe(a.packet.scale);
    }
  });

  it("bề mặt nằm giữa khiên và các lớp của gói (không chồng độ sâu)", () => {
    const z = report.plane.z;
    // Trước mặt trước của khiên (nửa độ dày cộng cạnh vát) và sau mặt sau của các ô lục giác của gói.
    expect(z).toBeGreaterThan(SHIELD.center.z + SHIELD.depth / 2 + 0.004);
    expect(z).toBeLessThan(security.inside.z + 0.0092 - 0.0014);
  });

  it("liên tục theo p: camera, bề mặt, khiên và các lớp không nhảy giữa hai bước cuộn 0,0005 (cả hai bố cục)", () => {
    for (const layout of LAYOUTS) {
      let prev = report.evaluate(0, layout);
      const prevCam = prev.camera.position.clone();
      const prevTarget = prev.camera.target.clone();
      let nums = [prev.surface.grow, prev.surface.opacity, prev.shield.opacity, prev.hex.fade, prev.ui.panel, prev.ui.bg, prev.ui.reveal, prev.ui.hold, prev.camera.uiRoom, prev.camera.fit, prev.roomDim];
      let maxCam = 0;
      let maxTarget = 0;
      let maxNum = 0;
      for (const p of samples(0.0005).slice(1)) {
        prev = report.evaluate(p, layout);
        maxCam = Math.max(maxCam, prev.camera.position.distanceTo(prevCam));
        maxTarget = Math.max(maxTarget, prev.camera.target.distanceTo(prevTarget));
        const cur = [prev.surface.grow, prev.surface.opacity, prev.shield.opacity, prev.hex.fade, prev.ui.panel, prev.ui.bg, prev.ui.reveal, prev.ui.hold, prev.camera.uiRoom, prev.camera.fit, prev.roomDim];
        maxNum = Math.max(maxNum, ...cur.map((v, i) => Math.abs(v - nums[i]!)));
        prevCam.copy(prev.camera.position);
        prevTarget.copy(prev.camera.target);
        nums = cur;
      }
      expect(maxCam, layout).toBeLessThan(0.04);
      expect(maxTarget, layout).toBeLessThan(0.01);
      expect(maxNum, layout).toBeLessThan(0.02);
    }
  });

  it("đơn điệu đúng chiều: bảng bước mờ dần, khiên mờ dần, bề mặt mọc dần, nội dung hiện dần; không có khoảnh khắc nào mất gói", () => {
    let last = { panel: 1, shield: 1, grow: 0, reveal: 0, bg: 0, dim: 0 };
    const lattice = createHexLattice(0.14 * 0.92, 0.105 * 0.9);
    for (const p of samples(0.002)) {
      const f = report.evaluate(p, "wide");
      expect(f.ui.panel, `p = ${p}`).toBeLessThanOrEqual(last.panel + 1e-9);
      expect(f.shield.opacity, `p = ${p}`).toBeLessThanOrEqual(last.shield + 1e-9);
      expect(f.surface.grow, `p = ${p}`).toBeGreaterThanOrEqual(last.grow - 1e-9);
      expect(f.ui.reveal, `p = ${p}`).toBeGreaterThanOrEqual(last.reveal - 1e-9);
      expect(f.ui.bg, `p = ${p}`).toBeGreaterThanOrEqual(last.bg - 1e-9);
      expect(f.roomDim, `p = ${p}`).toBeGreaterThanOrEqual(last.dim - 1e-9);
      last = { panel: f.ui.panel, shield: f.shield.opacity, grow: f.surface.grow, reveal: f.ui.reveal, bg: f.ui.bg, dim: f.roomDim };
      // Dải rút gọn chỉ tan khi bề mặt đã che gần hết khoảng nó chiếm: luôn còn thứ gì đó hiện (dải, hoặc bề mặt đủ lớn).
      const cells = lattice.cells.filter((c) => hexPose(lattice, c, f.hex).scale > 0.05).length;
      expect(cells >= DIGEST_SLOTS || f.surface.opacity > 0.99 || f.hex.fade < 1, `p = ${p}`).toBe(true);
      // Nội dung HTML chỉ hiện khi bề mặt 3D đã mọc đủ và đặc: chữ không bao giờ nổi trên nền trống.
      if (f.ui.reveal > 0.01) {
        expect(f.surface.grow, `p = ${p}`).toBeGreaterThan(0.999);
        expect(f.surface.opacity, `p = ${p}`).toBeGreaterThan(0.999);
      }
    }
  });

  it("tất định: cùng p cho đúng cùng khung dù quét tới, lùi hay nhảy cóc", () => {
    const key = (p: number, layout: "wide" | "narrow") => {
      const f = report.evaluate(p, layout);
      return [...f.camera.position.toArray(), ...f.camera.target.toArray(), f.camera.uiRoom, f.surface.grow, f.surface.opacity, f.shield.opacity, f.hex.fade, f.ui.panel, f.ui.bg, f.ui.reveal, f.ui.hold, f.roomDim];
    };
    for (const layout of LAYOUTS) {
      const checkpoints = [0.05, 0.2, 0.45, 0.6, 0.75, 0.9, 1];
      const reference = checkpoints.map((p) => key(p, layout));
      const out = report.evaluate(0.5, layout);
      for (const p of [...samples(0.0037), ...samples(0.0029).reverse(), 0.5, 0.99, 0.01]) report.evaluate(p, layout, out);
      checkpoints.forEach((p, i) => expect(key(p, layout), `${layout} p = ${p}`).toEqual(reference[i]));
    }
  });

  it("camera không đi vào bề mặt và luôn nhìn về phía nó", () => {
    for (const layout of LAYOUTS) {
      for (const p of samples(0.01)) {
        const f = report.evaluate(p, layout);
        expect(f.camera.position.z, `${layout} p = ${p}`).toBeGreaterThan(report.plane.z + 0.5);
        expect(f.camera.position.distanceTo(f.camera.target), `${layout} p = ${p}`).toBeGreaterThan(0.9);
      }
    }
  });

  it("các mốc thời gian nằm trong [0, 1] và xếp đúng thứ tự: nền HTML thế chỗ bề mặt trước khi nội dung hiện", () => {
    expect(REPORT.rest).toBeLessThan(REPORT.open[0] + 0.05);
    expect(REPORT.bg[0]).toBeGreaterThanOrEqual(REPORT.open[1] - 0.06);
    expect(REPORT.bg[1]).toBeLessThanOrEqual(REPORT.reveal[0] + 0.05);
    expect(REPORT.reveal[1]).toBeLessThan(REPORT.hold[0]);
    expect(REPORT.hold[1]).toBe(1);
  });
});

describe("quy khung HTML về bề mặt 3D", () => {
  it("bốn góc của hình chữ nhật thế giới chiếu đúng về bốn góc của khung HTML (cả hai bố cục, khung lệch tâm)", () => {
    const cases = [
      { layout: "wide" as const, stage: { w: 1440, h: 836 }, rect: { x: 272, y: 77, w: 896, h: 682 } },
      { layout: "narrow" as const, stage: { w: 390, h: 780 }, rect: { x: 12, y: 12, w: 366, h: 756 } },
      { layout: "narrow" as const, stage: { w: 360, h: 576 }, rect: { x: 40, y: 100, w: 250, h: 300 } },
    ];
    for (const c of cases) {
      const v = report.view(c.layout);
      // Hệ số vừa khung ở camera cuối: cùng công thức với cảnh (uiRoom = 0).
      const freeAspect = c.stage.w / c.stage.h;
      const fitScale = 1 + (Math.max(1, 1.55 / freeAspect) ** 0.82 - 1) * v.fit;
      const world = worldRectFromScreen(c.rect, c.stage, v, fitScale);
      const cam = new PerspectiveCamera(v.fov, c.stage.w / c.stage.h, 0.05, 40);
      cam.position.set(v.target.x, v.target.y, v.target.z + v.dist * fitScale);
      cam.lookAt(v.target);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      const px = (x: number, y: number) => {
        const n = new Vector3(x, y, v.target.z).project(cam);
        return { x: (n.x * 0.5 + 0.5) * c.stage.w, y: (-n.y * 0.5 + 0.5) * c.stage.h };
      };
      const tl = px(world.x0, world.y1);
      const br = px(world.x1, world.y0);
      expect(tl.x, `${c.layout} trái`).toBeCloseTo(c.rect.x, 6);
      expect(tl.y, `${c.layout} trên`).toBeCloseTo(c.rect.y, 6);
      expect(br.x, `${c.layout} phải`).toBeCloseTo(c.rect.x + c.rect.w, 6);
      expect(br.y, `${c.layout} dưới`).toBeCloseTo(c.rect.y + c.rect.h, 6);
    }
  });

  it("bề mặt mọc từ đúng quanh dải rút gọn (tâm trùng tâm gói) và không bắt đầu lớn hơn nó nhiều", () => {
    const s = report.plane.start;
    expect((s.x0 + s.x1) / 2).toBeCloseTo(security.inside.x, 9);
    expect((s.y0 + s.y1) / 2).toBeCloseTo(security.inside.y, 9);
    expect(s.x1 - s.x0).toBeLessThan(0.5);
    expect(s.y1 - s.y0).toBeLessThan(0.15);
  });
});
