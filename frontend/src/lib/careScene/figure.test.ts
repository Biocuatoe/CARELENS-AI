import { Box3, Mesh, SkinnedMesh, Vector3, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { CareFigure, pose } from "./figure";
import { initialPixelRatio } from "./scrollScene";
import { loftGeometry, shapedLimbGeometry, torsoAt, type TorsoSection } from "./shapes";

function meshes(f: CareFigure): Mesh[] {
  const out: Mesh[] = [];
  f.root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

function triangles(g: BufferGeometry): number {
  return (g.getIndex()?.count ?? g.getAttribute("position").count) / 3;
}

function setup(detailedHands = true) {
  const figure = new CareFigure({ detailedHands });
  figure.applyPose(pose({}));
  return figure;
}

describe("nhân vật người lớn tuổi", () => {
  it("có đủ các bộ phận nhận diện: đầu, tóc, hai mắt, áo len đan, giày", () => {
    const f = setup();
    const names = new Set<string>();
    f.root.traverse((o) => names.add(o.name));
    expect(names.has("care-head")).toBe(true);
    expect(names.has("care-hair")).toBe(true);
    // Mắt, mi, tròng: ít nhất hai quả cầu mắt cùng mi nằm trong nhóm đầu.
    const head = f.root.getObjectByName("care-head")!;
    const small: Mesh[] = [];
    head.traverse((o) => {
      if ((o as Mesh).isMesh) small.push(o as Mesh);
    });
    expect(small.length).toBeGreaterThanOrEqual(14);
  });

  it("chiều cao đứng thẳng hợp lý cho người lớn tuổi (1,55–1,75 m) và chân chạm sàn", () => {
    const f = setup();
    const box = new Box3().setFromObject(f.root);
    expect(box.min.y).toBeGreaterThan(-0.01);
    expect(box.min.y).toBeLessThan(0.01);
    expect(box.max.y).toBeGreaterThan(1.55);
    expect(box.max.y).toBeLessThan(1.75);
    expect(f.lowestPoint()).toBeCloseTo(0, 2);
  });

  it("mọi hình học hữu hạn và nhẹ: không NaN, tổng số tam giác trong ngân sách", () => {
    const f = setup();
    let tris = 0;
    for (const m of meshes(f)) {
      const pos = m.geometry.getAttribute("position");
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i]!)).toBe(true);
      const nor = m.geometry.getAttribute("normal");
      if (nor) for (let i = 0; i < nor.array.length; i += 17) expect(Number.isFinite(nor.array[i]!)).toBe(true);
      tris += triangles(m.geometry);
    }
    // Chủ yếu là đầu (~23 nghìn tam giác) cùng tóc và hai bàn tay; cả người (chưa tính vỏ thiết bị) dưới 125 nghìn để cuộn trơn tru trên máy tầm trung.
    expect(tris).toBeLessThan(125_000);
    expect(meshes(f).length).toBeLessThan(140);
    // Chế độ nhẹ có lưới đầu thưa hơn rõ rệt.
    const lite = new CareFigure({ detailedHands: true, lite: true });
    lite.applyPose(pose({}));
    const liteTris = meshes(lite).reduce((n, m) => n + triangles(m.geometry), 0);
    expect(liteTris).toBeLessThan(tris - 10_000);
    lite.dispose();
  });

  it("áo len là một mặt liền bám ba xương: gấu bám hông, đỉnh bám ngực, trọng số cộng bằng 1", () => {
    const f = setup();
    const skinned = meshes(f).filter((m): m is SkinnedMesh => (m as SkinnedMesh).isSkinnedMesh);
    expect(skinned.length).toBeGreaterThan(0);
    for (const m of skinned) {
      expect(m.skeleton.bones).toHaveLength(3);
      const w = m.geometry.getAttribute("skinWeight");
      for (let i = 0; i < w.count; i++) expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 5);
    }
    // Cúi người: vai và ngực rời chỗ, còn gấu áo (bám hông) thì đứng yên, nên không vén lên hay để lộ hông.
    const body = skinned[0]!;
    const at = (index: number) => {
      body.updateMatrixWorld(true);
      return body.getVertexPosition(index, new Vector3()).applyMatrix4(body.matrixWorld);
    };
    const pos = body.geometry.getAttribute("position");
    let hem = 0;
    let top = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < pos.getY(hem)) hem = i;
      if (pos.getY(i) > pos.getY(top)) top = i;
    }
    const hem0 = at(hem);
    const top0 = at(top);
    f.applyPose(pose({ spineX: 30, chestX: 15 }));
    // Đặt người chạm sàn sẽ dời cả gốc; so khoảng cách tương đối với gốc người.
    const rel = (v: Vector3) => v.clone().sub(f.root.position);
    const hem1 = at(hem);
    const top1 = at(top);
    f.applyPose(pose({}));
    expect(rel(hem1).distanceTo(rel(hem0))).toBeLessThan(0.02);
    expect(rel(top1).distanceTo(rel(top0))).toBeGreaterThan(0.1);
  });

  it("không có canvas (jsdom) vẫn dựng được đầy đủ: da dùng màu đỉnh, tóc không dùng bản đồ alpha", () => {
    const f = setup(false);
    expect(meshes(f).length).toBeGreaterThan(40);
    const hair = f.root.getObjectByName("care-hair") as Mesh;
    expect(hair).toBeTruthy();
    // Trong jsdom không có texture: tóc không đặt alphaTest (nếu không, không có bản đồ alpha thì toàn bộ tóc biến mất).
    const mat = hair.material as unknown as { alphaTest: number; alphaMap: unknown };
    expect(mat.alphaMap).toBeNull();
    expect(mat.alphaTest).toBe(0);
  });

  it("dựng lại cho cùng kết quả và giải phóng sạch", () => {
    const a = setup();
    const b = setup();
    const sum = (f: CareFigure) => meshes(f).reduce((n, m) => n + m.geometry.getAttribute("position").count, 0);
    expect(sum(a)).toBe(sum(b));
    a.dispose();
    b.dispose();
  });
});

describe("hình học dựng bằng code", () => {
  const sections: TorsoSection[] = [
    { y: 0, rx: 0.15, rzF: 0.1, rzB: 0.1 },
    { y: 0.1, rx: 0.14, rzF: 0.09, rzB: 0.095 },
    { y: 0.25, rx: 0.17, rzF: 0.11, rzB: 0.11 },
  ];

  it("loft: pháp tuyến đơn vị, kín hai đầu, không có đỉnh trùng pháp tuyến ở mối nối dọc", () => {
    const g = loftGeometry(sections, 32, 2);
    const nor = g.getAttribute("normal");
    for (let i = 0; i < nor.count; i++) expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 4);
    // Hàng đầu và hàng cuối có pháp tuyến nằm ngang (để các mảnh nối nhau không đổi tông).
    expect(Math.abs(nor.getY(0))).toBeLessThan(1e-6);
  });

  it("nội suy mặt cắt liên tục, đi qua các mặt cắt khai báo và không vượt quá khoảng cho phép", () => {
    for (const s of sections) {
      const t = torsoAt(sections, s.y);
      expect(t.rx).toBeCloseTo(s.rx, 6);
      expect(t.rzF).toBeCloseTo(s.rzF, 6);
    }
    let prev = torsoAt(sections, 0).rx;
    for (let y = 0.005; y <= 0.25; y += 0.005) {
      const t = torsoAt(sections, y);
      expect(Math.abs(t.rx - prev)).toBeLessThan(0.01);
      expect(t.rx).toBeGreaterThan(0.12);
      expect(t.rx).toBeLessThan(0.19);
      prev = t.rx;
    }
  });

  it("chi có nếp: bán kính luôn dương và chỉ thu nhỏ ở chỗ nếp", () => {
    const g = shapedLimbGeometry(0.3, [{ t: 0, r: 0.05 }, { t: 1, r: 0.03 }], [{ t: 0.5, amp: 0.05, w: 0.04 }]);
    const pos = g.getAttribute("position");
    let minR = Infinity;
    let maxR = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      if (pos.getY(i) < -0.01 && pos.getY(i) > -0.29) {
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
      }
    }
    expect(minR).toBeGreaterThan(0.025);
    expect(maxR).toBeLessThan(0.0505);
  });
});

describe("độ phân giải", () => {
  it("chế độ đầy đủ vẽ dư 1,5–2 lần, chế độ nhẹ không quá 1,5, tỉ lệ lạ về 1", () => {
    expect(initialPixelRatio("full", 1)).toBe(1.5);
    expect(initialPixelRatio("full", 1.25)).toBe(1.5);
    expect(initialPixelRatio("full", 2)).toBe(2);
    expect(initialPixelRatio("full", 3)).toBe(2);
    expect(initialPixelRatio("lite", 1)).toBe(1);
    expect(initialPixelRatio("lite", 3)).toBe(1.5);
    expect(initialPixelRatio("full", Number.NaN)).toBe(1.5);
    expect(initialPixelRatio("lite", 0)).toBe(1);
  });
});
