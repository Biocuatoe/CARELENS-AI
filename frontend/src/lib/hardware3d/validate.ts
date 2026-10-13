import { Box3, Matrix4, Mesh, MeshBasicMaterial, DoubleSide, Raycaster, Vector3, type BufferGeometry, type Object3D } from "three";
import type { HardwareAssembly } from "./assembly";
import type { PartId } from "./assemblyConfig";
import { CAMERA_WINDOW_MM } from "./units";

/**
 * Kiểm tra lắp ráp theo hình học thật, trong khung CAD (mm):
 * - Thành vỏ: mỗi đỉnh của linh kiện (và điểm rải trên cạnh của khối hộp) không được nằm trong vật liệu vỏ hay ra ngoài vỏ.
 *   Phép thử điểm-trong-khối dùng tia song song trục X với đếm chẵn lẻ trên mesh STL kín.
 * - Linh kiện với nhau: hộp bao của từng mesh con thuộc hai linh kiện khác nhau không được giao nhau.
 * - Căn chỉnh: ống kính với cửa sổ camera, miệng USB-C và cần gạt công tắc với thành vỏ (bắn tia xuyên thành để biết có lỗ hay không).
 * Kết quả là bằng chứng hình học cho bố trí trong `assemblyConfig.ts`, không chứng minh lắp được ngoài đời thật.
 */

type V3 = [number, number, number];

/** Khối kín (watertight) cho phép thử điểm-trong-khối theo tia +X, có lưới YZ để chỉ xét các tam giác liên quan. */
export class SolidTester {
  private readonly tris: Float64Array;
  private readonly grid = new Map<number, number[]>();
  private readonly cell = 1;

  constructor(geometry: BufferGeometry, matrix?: Matrix4) {
    const pos = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const count = index ? index.count : pos.count;
    this.tris = new Float64Array(count * 3);
    const v = new Vector3();
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i);
      if (matrix) v.applyMatrix4(matrix);
      this.tris[i * 3] = v.x;
      this.tris[i * 3 + 1] = v.y;
      this.tris[i * 3 + 2] = v.z;
    }
    for (let t = 0; t < count / 3; t++) {
      const o = t * 9;
      const ys = [this.tris[o + 1]!, this.tris[o + 4]!, this.tris[o + 7]!];
      const zs = [this.tris[o + 2]!, this.tris[o + 5]!, this.tris[o + 8]!];
      for (let cy = Math.floor(Math.min(...ys) / this.cell); cy <= Math.floor(Math.max(...ys) / this.cell); cy++) {
        for (let cz = Math.floor(Math.min(...zs) / this.cell); cz <= Math.floor(Math.max(...zs) / this.cell); cz++) {
          const k = this.key(cy, cz);
          const list = this.grid.get(k);
          if (list) list.push(t);
          else this.grid.set(k, [t]);
        }
      }
    }
  }

  private key(cy: number, cz: number) {
    return (cy + 1000) * 4096 + (cz + 1000);
  }

  /** Toạ độ x nơi đường thẳng song song X qua (y, z) cắt bề mặt. */
  crossings(y: number, z: number): number[] {
    // Lệch rất nhỏ để tránh tia đi đúng qua cạnh hay đỉnh tam giác.
    const py = y + 1.37e-5;
    const pz = z + 2.91e-5;
    const list = this.grid.get(this.key(Math.floor(py / this.cell), Math.floor(pz / this.cell)));
    const out: number[] = [];
    if (!list) return out;
    const T = this.tris;
    for (const t of list) {
      const o = t * 9;
      const y0 = T[o + 1]!, z0 = T[o + 2]!, y1 = T[o + 4]!, z1 = T[o + 5]!, y2 = T[o + 7]!, z2 = T[o + 8]!;
      const d = (y1 - y0) * (z2 - z0) - (y2 - y0) * (z1 - z0);
      if (Math.abs(d) < 1e-12) continue;
      const a = ((y1 - py) * (z2 - pz) - (y2 - py) * (z1 - pz)) / d;
      const b = ((y2 - py) * (z0 - pz) - (y0 - py) * (z2 - pz)) / d;
      const c = 1 - a - b;
      if (a < 0 || b < 0 || c < 0) continue;
      out.push(a * T[o]! + b * T[o + 3]! + c * T[o + 6]!);
    }
    return out;
  }

  inside(p: Vector3): boolean {
    let n = 0;
    for (const x of this.crossings(p.y, p.z)) if (x > p.x) n++;
    return n % 2 === 1;
  }
}

export type PointClass = "cavity" | "wall" | "outside";

export interface ShellIssue {
  id: PartId;
  mesh: string;
  kind: "wall" | "outside";
  point: V3;
}

export interface Collision {
  a: PartId;
  meshA: string;
  b: PartId;
  meshB: string;
  volumeMm3: number;
}

export interface FeatureCheck {
  /** Tâm của bộ phận cần căn (khung CAD, mm). */
  position: V3;
  /** Hướng nhìn ra ngoài của bộ phận. */
  direction: V3;
  /** Khoảng cách từ bộ phận tới mặt trong của vỏ theo hướng đó (mm); `null` nếu tia thoát ra ngoài. */
  gapToWallMm: number | null;
  /** Tia từ bộ phận đi ra ngoài có lọt qua vỏ không (tức là có lỗ ở đúng chỗ). */
  openingFound: boolean;
}

export interface ValidationReport {
  checkedPoints: number;
  shellIssues: ShellIssue[];
  collisions: Collision[];
  camera: FeatureCheck & { offsetFromWindowMm: number; axisErrorDeg: number };
  usbC: FeatureCheck;
  switchActuator: FeatureCheck;
  /** Linh kiện mềm (dây, đầu nối) chạm vỏ: chỉ là cảnh báo. */
  flexibleShellIssues: ShellIssue[];
}

const tmp = new Vector3();

function cadMatrix(object: Object3D, cadInverse: Matrix4): Matrix4 {
  object.updateWorldMatrix(true, false);
  return new Matrix4().multiplyMatrices(cadInverse, object.matrixWorld);
}

function isFlexible(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData.flexible) return true;
  return false;
}

/** Điểm kiểm tra cho một mesh: mọi đỉnh (bỏ trùng), cộng điểm rải mỗi 1,5 mm trên 12 cạnh nếu là khối hộp. */
function samplePoints(mesh: Mesh, m: Matrix4): Vector3[] {
  const pos = mesh.geometry.getAttribute("position");
  const seen = new Set<string>();
  const out: Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new Vector3().fromBufferAttribute(pos, i).applyMatrix4(m);
    const k = `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  if (mesh.geometry.type === "BoxGeometry" || mesh.geometry.type === "RoundedBoxGeometry") {
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    const c = [bb.min, bb.max];
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(c[i & 1]!.x, c[(i >> 1) & 1]!.y, c[(i >> 2) & 1]!.z));
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) {
        const j = i | bit;
        if (j === i) continue;
        const a = corners[i]!, b = corners[j]!;
        const n = Math.max(1, Math.ceil(a.distanceTo(b) / 1.5));
        for (let s = 1; s < n; s++) out.push(a.clone().lerp(b, s / n).applyMatrix4(m));
      }
    }
  }
  return out;
}

export function validateAssembly(assembly: HardwareAssembly, options: { includeShell?: boolean } = {}): ValidationReport {
  const includeShell = options.includeShell ?? true;
  const cad = assembly.cadFrame;
  cad.updateMatrixWorld(true);
  const cadInverse = cad.matrixWorld.clone().invert();

  const bodyHolder = assembly.parts.get("enclosure-body")!.object;
  const capHolder = assembly.parts.get("enclosure-cap")!.object;
  const bodyMesh = bodyHolder.getObjectByName("body-mesh") as Mesh;
  const capMesh = capHolder.getObjectByName("cap-mesh") as Mesh;
  const body = new SolidTester(assembly.enclosureGeometry.body, cadMatrix(bodyMesh, cadInverse));
  const cap = new SolidTester(assembly.enclosureGeometry.cap, cadMatrix(capMesh, cadInverse));

  const classify = (p: Vector3): PointClass => {
    if (body.inside(p) || cap.inside(p)) return "wall";
    const xs = [...body.crossings(p.y, p.z), ...cap.crossings(p.y, p.z)];
    return xs.some((x) => x < p.x) && xs.some((x) => x > p.x) ? "cavity" : "outside";
  };

  // Mesh cứng của linh kiện điện tử.
  const meshes: Array<{ id: PartId; mesh: Mesh; flexible: boolean; box: Box3; m: Matrix4 }> = [];
  for (const [id, h] of assembly.parts) {
    if (h.config.group !== "electronics") continue;
    h.object.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const m = cadMatrix(mesh, cadInverse);
      mesh.geometry.computeBoundingBox();
      meshes.push({ id, mesh, flexible: isFlexible(mesh), box: mesh.geometry.boundingBox!.clone().applyMatrix4(m), m });
    });
  }

  const shellIssues: ShellIssue[] = [];
  const flexibleShellIssues: ShellIssue[] = [];
  let checkedPoints = 0;
  if (includeShell) {
    for (const { id, mesh, flexible, m } of meshes) {
      for (const p of samplePoints(mesh, m)) {
        checkedPoints++;
        const k = classify(p);
        if (k !== "cavity") (flexible ? flexibleShellIssues : shellIssues).push({ id, mesh: mesh.name, kind: k, point: p.toArray() });
      }
    }
  }

  const collisions: Collision[] = [];
  const rigid = meshes.filter((x) => !x.flexible);
  for (let i = 0; i < rigid.length; i++) {
    for (let j = i + 1; j < rigid.length; j++) {
      const A = rigid[i]!, B = rigid[j]!;
      if (A.id === B.id || !A.box.intersectsBox(B.box)) continue;
      const inter = A.box.clone().intersect(B.box);
      const s = inter.getSize(tmp);
      const vol = s.x * s.y * s.z;
      if (s.x > 0.01 && s.y > 0.01 && s.z > 0.01) collisions.push({ a: A.id, meshA: A.mesh.name, b: B.id, meshB: B.mesh.name, volumeMm3: vol });
    }
  }

  // Bắn tia trong khung CAD tới mesh vỏ đặt ở khung CAD.
  const shell = [
    new Mesh(assembly.enclosureGeometry.body, new MeshBasicMaterial({ side: DoubleSide })),
    new Mesh(assembly.enclosureGeometry.cap, new MeshBasicMaterial({ side: DoubleSide })),
  ];
  shell[0]!.matrixAutoUpdate = false;
  shell[0]!.matrix.copy(cadMatrix(bodyMesh, cadInverse));
  shell[1]!.matrixAutoUpdate = false;
  shell[1]!.matrix.copy(cadMatrix(capMesh, cadInverse));
  shell.forEach((s) => s.updateMatrixWorld(true));
  const rc = new Raycaster();
  const feature = (object: Object3D | undefined, localDir: Vector3, surface: "max" | "center"): FeatureCheck => {
    if (!object) return { position: [NaN, NaN, NaN], direction: [0, 0, 0], gapToWallMm: null, openingFound: false };
    const m = cadMatrix(object, cadInverse);
    const box = new Box3().setFromObject(object, true).applyMatrix4(cadInverse);
    const dir = localDir.clone().transformDirection(m);
    const c = box.getCenter(new Vector3());
    // Điểm xuất phát: tâm mặt ngoài cùng theo hướng nhìn.
    const origin = surface === "max" ? c.clone().addScaledVector(dir, Math.abs(box.getSize(tmp).dot(dir)) / 2) : c;
    rc.set(origin.clone().addScaledVector(dir, -0.01), dir);
    const hits = rc.intersectObjects(shell, false);
    // Không chạm mesh nào nghĩa là tia lọt ra ngoài: có lỗ đúng hướng nhìn của bộ phận.
    const openingFound = hits.length === 0;
    return {
      position: origin.toArray(),
      direction: dir.toArray().map((v) => Math.round(v * 1e6) / 1e6 + 0) as V3, // + 0 bỏ −0
      gapToWallMm: hits[0] ? hits[0].distance - 0.01 : null,
      openingFound,
    };
  };

  // Trục quang = trục +Z của nhóm `lens` (mesh kính tự xoay 90° nên không dùng làm hướng).
  const lensObj = assembly.root.getObjectByName("lens");
  const camera = feature(lensObj, new Vector3(0, 0, 1), "max");
  const lensCenter = lensObj ? new Box3().setFromObject(lensObj, true).applyMatrix4(cadInverse).getCenter(new Vector3()) : new Vector3(NaN, NaN, NaN);
  const offsetFromWindowMm = Math.hypot(lensCenter.x - CAMERA_WINDOW_MM.centerX, lensCenter.z - CAMERA_WINDOW_MM.centerZ);
  const axisErrorDeg = (new Vector3(...camera.direction).angleTo(new Vector3(0, -1, 0)) * 180) / Math.PI;

  const report: ValidationReport = {
    checkedPoints,
    shellIssues,
    collisions,
    camera: { ...camera, offsetFromWindowMm, axisErrorDeg },
    usbC: feature(assembly.root.getObjectByName("usb-c-mouth"), new Vector3(0, -1, 0), "max"),
    switchActuator: feature(assembly.root.getObjectByName("slider-knob"), new Vector3(0, 0, 1), "max"),
    flexibleShellIssues,
  };
  shell.forEach((s) => (s.material as MeshBasicMaterial).dispose());
  return report;
}
