import { Box3, Matrix4, Mesh, Vector3, type Object3D } from "three";
import type { HardwareAssembly } from "./assembly";
import type { MovingPartId } from "./animationConfig";
import type { PartId } from "./assemblyConfig";
import { SolidTester } from "./validate";

/**
 * Kiểm tra toàn bộ hoạt ảnh theo hình học thật, không lấy mẫu thưa:
 * 1. Quét từng linh kiện dọc đường đi (bước ≤ `pathStepMm`, nhỏ hơn bề dày thành vỏ 2 mm) và thử điểm-trong-khối với mesh STL thân vỏ.
 * 2. Theo thời gian (bước `pStep` của tiến trình): nắp đang nhấc không được chạm linh kiện; hai linh kiện không được có mesh con giao nhau.
 * 3. Đo bước nhảy lớn nhất của mọi vật thể giữa hai mẫu liền kề (phát hiện nhảy vị trí).
 * Hộp bao từng mesh con bảo thủ hơn hình thật, nên báo cáo trống là bằng chứng mạnh; báo cáo có mục cần xem lại bằng mắt.
 * Dây và đầu nối mềm của pin chỉ tạo cảnh báo (`flexibleCollisions`), không tính là lỗi cứng.
 */

export interface TimelineValidation {
  samples: number;
  bodyHits: Array<{ part: PartId; mesh: string; u: number; point: [number, number, number] }>;
  capHits: Array<{ part: PartId; mesh: string; p: number; point: [number, number, number]; capLiftMm: number }>;
  partCollisions: Array<{ a: PartId; meshA: string; b: PartId; meshB: string; p: number }>;
  flexibleCollisions: Array<{ a: PartId; meshA: string; b: PartId; meshB: string; p: number }>;
  /** Bước dịch chuyển lớn nhất (mm) của một vật thể giữa hai mẫu liền kề cách nhau `pStep`. */
  maxStepMm: number;
}

interface MeshRecord {
  name: string;
  flexible: boolean;
  min: [number, number, number];
  max: [number, number, number];
}

interface PartRecord {
  id: PartId;
  meshes: MeshRecord[];
  /** Điểm trên bề mặt hộp bao các mesh cứng ở tư thế nhà (khung CAD). */
  surface: Float32Array;
  surfaceMesh: string[];
  min: [number, number, number];
  max: [number, number, number];
}

function cadMatrix(object: Object3D, cadInverse: Matrix4): Matrix4 {
  object.updateWorldMatrix(true, false);
  return new Matrix4().multiplyMatrices(cadInverse, object.matrixWorld);
}

function isFlexible(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData.flexible) return true;
  return false;
}

function boxSurface(min: readonly number[], max: readonly number[], g: number, push: (x: number, y: number, z: number) => void): void {
  const n = (i: number) => Math.max(1, Math.ceil((max[i]! - min[i]!) / g));
  const nx = n(0), ny = n(1), nz = n(2);
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      for (let k = 0; k <= nz; k++) {
        // Chỉ giữ điểm nằm trên 6 mặt của hộp.
        if (i !== 0 && i !== nx && j !== 0 && j !== ny && k !== 0 && k !== nz) continue;
        push(min[0]! + ((max[0]! - min[0]!) * i) / nx, min[1]! + ((max[1]! - min[1]!) * j) / ny, min[2]! + ((max[2]! - min[2]!) * k) / nz);
      }
    }
  }
}

export function validateTimeline(
  assembly: HardwareAssembly,
  options: { pStep?: number; pathStepMm?: number; gridMm?: number } = {},
): TimelineValidation {
  const pStep = options.pStep ?? 0.0005;
  const pathStepMm = options.pathStepMm ?? 0.5;
  const gridMm = options.gridMm ?? 1.5;
  const timeline = assembly.timeline;
  const cad = assembly.cadFrame;

  assembly.applyPositions(timeline.homes);
  cad.updateMatrixWorld(true);
  const cadInverse = cad.matrixWorld.clone().invert();

  const bodyMesh = assembly.parts.get("enclosure-body")!.object.getObjectByName("body-mesh") as Mesh;
  const capMesh = assembly.parts.get("enclosure-cap")!.object.getObjectByName("cap-mesh") as Mesh;
  const body = new SolidTester(assembly.enclosureGeometry.body, cadMatrix(bodyMesh, cadInverse));
  const cap = new SolidTester(assembly.enclosureGeometry.cap, cadMatrix(capMesh, cadInverse));
  const capBoxHome = (() => {
    capMesh.geometry.computeBoundingBox();
    return capMesh.geometry.boundingBox!.clone().applyMatrix4(cadMatrix(capMesh, cadInverse));
  })();
  const bodyBoxHome = (() => {
    bodyMesh.geometry.computeBoundingBox();
    return bodyMesh.geometry.boundingBox!.clone().applyMatrix4(cadMatrix(bodyMesh, cadInverse));
  })();

  const parts: PartRecord[] = [];
  for (const [id, h] of assembly.parts) {
    if (h.config.group !== "electronics") continue;
    const meshes: MeshRecord[] = [];
    const pts: number[] = [];
    const names: string[] = [];
    const union = new Box3();
    h.object.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox!.clone().applyMatrix4(cadMatrix(mesh, cadInverse));
      const flexible = isFlexible(mesh);
      meshes.push({ name: mesh.name, flexible, min: b.min.toArray(), max: b.max.toArray() });
      if (flexible) return;
      union.union(b);
      const push = (x: number, y: number, z: number) => {
        pts.push(x, y, z);
        names.push(mesh.name);
      };
      if (mesh.geometry.type === "BoxGeometry") {
        // Hộp thẳng trục: hộp bao chính là hình thật, lấy lưới điểm trên 6 mặt.
        boxSurface(b.min.toArray(), b.max.toArray(), gridMm, push);
      } else {
        // Hình bo tròn, trụ, GLB: hộp bao có góc không nằm trên vật thể, nên chỉ dùng đỉnh thật của mesh.
        const m = cadMatrix(mesh, cadInverse);
        const pos = mesh.geometry.getAttribute("position");
        const seen = new Set<string>();
        const v = new Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          const key = `${Math.round(v.x * 20)},${Math.round(v.y * 20)},${Math.round(v.z * 20)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          push(v.x, v.y, v.z);
        }
      }
    });
    parts.push({ id, meshes, surface: Float32Array.from(pts), surfaceMesh: names, min: union.min.toArray(), max: union.max.toArray() });
  }

  const result: TimelineValidation = { samples: 0, bodyHits: [], capHits: [], partCollisions: [], flexibleCollisions: [], maxStepMm: 0 };
  const probe = new Vector3();
  const off = new Vector3();
  const tmp = new Vector3();
  const margin = 0.5;

  // 1. Quét dọc đường đi với thân vỏ.
  for (const id of timeline.movingParts as readonly MovingPartId[]) {
    const rec = parts.find((r) => r.id === id)!;
    const home = timeline.homes[id];
    const steps = Math.max(2, Math.ceil(timeline.pathLength(id) / pathStepMm));
    let hits = 0;
    for (let k = 0; k <= steps && hits < 20; k++) {
      const u = k / steps;
      timeline.pathPoint(id, u, off).sub(home);
      for (let i = 0; i < rec.surface.length; i += 3) {
        probe.set(rec.surface[i]! + off.x, rec.surface[i + 1]! + off.y, rec.surface[i + 2]! + off.z);
        if (probe.x < bodyBoxHome.min.x - margin || probe.x > bodyBoxHome.max.x + margin || probe.y < bodyBoxHome.min.y - margin || probe.y > bodyBoxHome.max.y + margin || probe.z < bodyBoxHome.min.z - margin || probe.z > bodyBoxHome.max.z + margin) continue;
        if (body.inside(probe)) {
          result.bodyHits.push({ part: id, mesh: rec.surfaceMesh[i / 3]!, u, point: probe.toArray() });
          hits++;
          break;
        }
      }
    }
  }

  // 2 + 3. Theo thời gian.
  const frame = timeline.createFrame();
  const prev = new Map<PartId, Vector3>();
  const offsets = new Map<PartId, Vector3>();
  for (const r of parts) offsets.set(r.id, new Vector3());
  const capOffset = new Vector3();
  const reported = new Set<string>();
  const total = Math.round(1 / pStep);
  for (let s = 0; s <= total; s++) {
    const p = s / total;
    timeline.evaluate(p, "wide", frame);
    result.samples++;
    capOffset.copy(frame.positions["enclosure-cap"]).sub(timeline.homes["enclosure-cap"]);
    for (const r of parts) {
      offsets.get(r.id)!.copy(frame.positions[r.id]).sub(timeline.homes[r.id]);
      const before = prev.get(r.id);
      if (before) result.maxStepMm = Math.max(result.maxStepMm, before.distanceTo(frame.positions[r.id]));
      (prev.get(r.id) ?? prev.set(r.id, new Vector3()).get(r.id)!).copy(frame.positions[r.id]);
    }
    for (const id of ["enclosure-cap", "enclosure-body"] as const) {
      const before = prev.get(id);
      if (before) result.maxStepMm = Math.max(result.maxStepMm, before.distanceTo(frame.positions[id]));
      (prev.get(id) ?? prev.set(id, new Vector3()).get(id)!).copy(frame.positions[id]);
    }

    // Nắp đang di chuyển so với linh kiện.
    const capMinX = capBoxHome.min.x + capOffset.x, capMaxX = capBoxHome.max.x + capOffset.x;
    const capMinY = capBoxHome.min.y + capOffset.y, capMaxY = capBoxHome.max.y + capOffset.y;
    const capMinZ = capBoxHome.min.z + capOffset.z, capMaxZ = capBoxHome.max.z + capOffset.z;
    for (const r of parts) {
      const o = offsets.get(r.id)!;
      if (r.max[0] + o.x < capMinX || r.min[0] + o.x > capMaxX || r.max[1] + o.y < capMinY || r.min[1] + o.y > capMaxY || r.max[2] + o.z < capMinZ || r.min[2] + o.z > capMaxZ) continue;
      for (let i = 0; i < r.surface.length; i += 3) {
        probe.set(r.surface[i]! + o.x - capOffset.x, r.surface[i + 1]! + o.y - capOffset.y, r.surface[i + 2]! + o.z - capOffset.z);
        if (cap.inside(probe)) {
          const key = `cap:${r.id}`;
          if (!reported.has(key)) {
            reported.add(key);
            result.capHits.push({ part: r.id, mesh: r.surfaceMesh[i / 3]!, p, point: [probe.x + capOffset.x, probe.y + capOffset.y, probe.z + capOffset.z], capLiftMm: capOffset.z });
          }
          break;
        }
      }
    }

    // Linh kiện với nhau.
    for (let i = 0; i < parts.length; i++) {
      const A = parts[i]!;
      const oa = offsets.get(A.id)!;
      for (let j = i + 1; j < parts.length; j++) {
        const B = parts[j]!;
        const ob = offsets.get(B.id)!;
        if (A.max[0] + oa.x <= B.min[0] + ob.x || B.max[0] + ob.x <= A.min[0] + oa.x) continue;
        if (A.max[1] + oa.y <= B.min[1] + ob.y || B.max[1] + ob.y <= A.min[1] + oa.y) continue;
        if (A.max[2] + oa.z <= B.min[2] + ob.z || B.max[2] + ob.z <= A.min[2] + oa.z) continue;
        for (const ma of A.meshes) {
          for (const mb of B.meshes) {
            const dx = Math.min(ma.max[0] + oa.x, mb.max[0] + ob.x) - Math.max(ma.min[0] + oa.x, mb.min[0] + ob.x);
            if (dx <= 0.01) continue;
            const dy = Math.min(ma.max[1] + oa.y, mb.max[1] + ob.y) - Math.max(ma.min[1] + oa.y, mb.min[1] + ob.y);
            if (dy <= 0.01) continue;
            const dz = Math.min(ma.max[2] + oa.z, mb.max[2] + ob.z) - Math.max(ma.min[2] + oa.z, mb.min[2] + ob.z);
            if (dz <= 0.01) continue;
            const key = `${A.id}/${ma.name}|${B.id}/${mb.name}`;
            if (reported.has(key)) continue;
            reported.add(key);
            const entry = { a: A.id, meshA: ma.name, b: B.id, meshB: mb.name, p };
            (ma.flexible || mb.flexible ? result.flexibleCollisions : result.partCollisions).push(entry);
          }
        }
      }
    }
  }
  tmp.set(0, 0, 0);
  assembly.applyPositions(timeline.homes);
  return result;
}
