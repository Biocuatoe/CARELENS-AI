import {
  BufferGeometry,
  CanvasTexture,
  Color,
  FrontSide,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Raycaster,
  RepeatWrapping,
  SphereGeometry,
  Vector3,
  type Material,
} from "three";
import { FACE_UV, paintFace } from "./facePaint";
import { canvas2d, type FigureTextures } from "./textures";

/**
 * Đầu người lớn tuổi dựng bằng code, đơn vị mét, gốc ở tâm hộp sọ, mặt hướng +Z. Một lưới cầu mịn được nắn thành hộp sọ, gò má, hàm và cằm
 * (không phải quả cầu gắn mặt nạ); mắt có mi và tròng, mũi, tai, lông mày, môi là các chi tiết riêng đặt đúng trên bề mặt đó (dò bằng tia).
 * Dấu hiệu tuổi chừng mực: tóc bạc ngắn, chân tóc lùi nhẹ ở thái dương, mi trên hơi nặng, túi mắt và rãnh mũi-má nông, má hơi trũng.
 * Không nếp nhăn nặng, không biếm hoạ. Sắc da, hồng má, bóng mắt đi bằng màu đỉnh nên không cần ảnh. Hàm thuần: cùng kết quả mỗi lần dựng.
 */

export interface HeadBuild {
  group: Group;
  dispose(): void;
}

export interface HeadOptions {
  skin: string;
  hair: string;
  textures: FigureTextures | null;
  /** Chế độ nhẹ (điện thoại, máy yếu): lưới đầu thưa hơn khoảng 40%, hình dáng giữ nguyên. */
  lite?: boolean;
}

// Kích thước nửa trục của hộp sọ trước khi nắn (m).
const HW = 0.0745;
const HH = 0.107;
const HD = 0.094;
const CY = 0.003;

const smooth = (a: number, b: number, x: number) => MathUtils.smoothstep(x, a, b);
/** Bước mượt từ 0 (tại a) lên 1 (tại b); chạy đúng cả khi a > b (khi đó là bước đi xuống theo x). */
const ramp = (a: number, b: number, x: number) => {
  const t = MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const gauss = (x: number, y: number, cx: number, cy: number, rx: number, ry = rx) => Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));

const EYE_X = 0.0315;
const MOUTH_Y = -0.0595;
const EYE_Y = 0.008;

/** Phù điêu mặt trước (m, theo +Z): hốc mắt, gờ mày, gò má, má trũng, rãnh mũi-má, đường miệng, cằm. Chỉ đọc (x, y) nên không phụ thuộc lưới. */
function faceRelief(x: number, y: number): number {
  const ax = Math.abs(x);
  let dz = 0;
  dz -= 0.0042 * gauss(ax, y, EYE_X, EYE_Y, 0.0125, 0.0095); // hốc mắt
  dz += 0.0034 * gauss(ax, y, 0.03, 0.03, 0.021, 0.0075); // gờ mày
  dz += 0.0032 * gauss(ax, y, 0.047, -0.028, 0.017, 0.013); // gò má
  dz -= 0.0028 * gauss(ax, y, 0.052, -0.07, 0.013, 0.02); // má hơi trũng
  dz -= 0.0014 * gauss(ax, y, 0.0225 + (-0.01 - y) * 0.45, y, 0.0036, 0.021) * ramp(-0.012, -0.03, y) * (1 - ramp(-0.07, -0.082, y)); // rãnh mũi-má
  dz -= 0.0011 * gauss(ax, y, 0.0, MOUTH_Y, 0.021, 0.0021); // đường miệng
  dz += 0.0022 * gauss(ax, y, 0.0, MOUTH_Y - 0.024, 0.02, 0.011); // cằm
  dz -= 0.001 * gauss(ax, y, 0.0, MOUTH_Y - 0.0135, 0.016, 0.0042); // rãnh dưới môi
  dz += 0.0008 * gauss(ax, y, EYE_X, -0.0075, 0.012, 0.0045); // túi mắt nhẹ
  dz += noseRelief(x, y);
  dz += lipRelief(x, y);
  return dz;
}

/**
 * Mũi nắn thẳng vào lưới: sống mũi thoải từ chân mày, chóp tròn hơi rủ, hai cánh mũi và rãnh dưới chóp. Bề rộng tăng dần về phía chóp,
 * nên mũi không phải một khối gắn thêm mà liền với má.
 */
function noseRelief(x: number, y: number): number {
  const ax = Math.abs(x);
  const width = 0.0056 + 0.0062 * ramp(0.0, -0.032, y);
  const lateral = Math.exp(-((ax / width) ** 2.2));
  const bridge = 0.0062 * gauss(0, y, 0, -0.01, 1, 0.0175) + 0.0048 * ramp(0.03, -0.008, y);
  const tip = 0.0036 * gauss(ax, y, 0, -0.0285, 0.0086, 0.0075);
  const alae = 0.0036 * gauss(ax, y, 0.0108, -0.0312, 0.0058, 0.0066);
  const under = ramp(-0.0345, -0.0435, y); // mũi thu về môi trên
  return (bridge * lateral + tip + alae) * (1 - under) * (1 - smooth(0.03, 0.045, y));
}

/** Môi: môi trên mảnh, môi dưới đầy hơn, rãnh nhân trung nông. */
function lipRelief(x: number, y: number): number {
  const ax = Math.abs(x);
  let dz = 0;
  dz += 0.0046 * gauss(ax, y, 0.0, MOUTH_Y + 0.0045, 0.0178, 0.0036);
  dz += 0.0062 * gauss(ax, y, 0.0, MOUTH_Y - 0.0062, 0.0168, 0.0052);
  dz -= 0.0009 * gauss(ax, y, 0.0, MOUTH_Y + 0.0125, 0.0028, 0.0055);
  return dz;
}

/** Màu da tại điểm (x, y) của mặt: ấm ở má và mũi, tối ở hốc mắt, dưới cằm và rãnh, sáng ở trán. */
function faceTone(base: Color, x: number, y: number, z: number, out: Color): Color {
  const ax = Math.abs(x);
  out.copy(base);
  const mix = (hex: string, k: number) => out.lerp(TMP.set(hex), MathUtils.clamp(k, 0, 1));
  mix("#e3baa0", 0.18 * smooth(0.02, 0.07, y)); // trán sáng hơn
  mix("#c47c6c", 0.34 * gauss(ax, y, 0.043, -0.032, 0.021, 0.017)); // hồng má
  mix("#b07c6a", 0.3 * gauss(ax, y, EYE_X, EYE_Y, 0.0165, 0.0125)); // hốc mắt
  mix("#a47a76", 0.22 * gauss(ax, y, EYE_X, -0.0095, 0.0125, 0.005)); // túi mắt hơi xám
  mix("#c98676", 0.22 * gauss(ax, y, 0.0, -0.0295, 0.0105, 0.0085)); // chóp mũi hồng
  mix("#6e4038", 0.55 * gauss(ax, y, 0.0, -0.0385, 0.012, 0.0032)); // bóng dưới chóp mũi
  mix("#3f2620", 0.85 * gauss(ax, y, 0.0058, -0.0358, 0.0036, 0.0021)); // lỗ mũi
  mix("#9a4f48", 0.9 * gauss(ax, y, 0.0, MOUTH_Y + 0.0045, 0.0185, 0.0036)); // môi trên
  mix("#a85a52", 0.9 * gauss(ax, y, 0.0, MOUTH_Y - 0.0058, 0.0172, 0.005)); // môi dưới
  mix("#98604f", 0.34 * gauss(ax, y, 0.0, MOUTH_Y, 0.021, 0.0021)); // đường miệng
  mix("#a8786a", 0.22 * gauss(ax, y, 0.0225 + (-0.01 - y) * 0.45, y, 0.0036, 0.02) * ramp(-0.012, -0.03, y)); // rãnh mũi-má
  mix("#8a6a5a", 0.25 * ramp(-0.07, -0.12, y) * (z > -0.02 ? 1 : 0.6)); // dưới hàm: bóng của chính cằm
  return out;
}
const TMP = new Color();

/** Điểm trên hộp sọ đã nắn ứng với hướng đơn vị `d` (trước khi thêm phù điêu). */
function skullPoint(d: Vector3, out: Vector3): Vector3 {
  const { x, y, z } = d;
  const low = ramp(0.18, -0.98, y); // 0 ở trên mắt, 1 ở đáy cằm
  const front = Math.max(0, z);
  const back = Math.max(0, -z);
  let px = x * HW;
  const py = (y >= 0 ? y * HH : y * HH * 0.93) + CY;
  let pz = z * HD;
  px *= 1 - 0.17 * low ** 1.3; // hàm thon dần về cằm
  px *= 1 + 0.025 * Math.sin(Math.PI * MathUtils.clamp((y + 0.3) / 0.9, 0, 1)) * front; // hơi rộng ở gò má
  pz += 0.008 * low ** 1.4 * front; // cằm nhô về trước
  pz *= 1 - 0.3 * low ** 1.1 * back; // hàm nghiêng về phía cổ
  pz *= 1 + 0.035 * back * ramp(-0.5, 0.1, y); // chẩm đầy hơn
  pz -= 0.006 * front * ramp(0.35, 0.95, y) ** 1.2; // trán hơi lùi về phía đỉnh đầu
  pz -= 0.003 * front * Math.sin(Math.PI * MathUtils.clamp((y + 0.1) / 0.5, 0, 1)) * Math.abs(x) ** 2; // mặt trước hơi phẳng
  out.set(px, py, pz);
  return out;
}

/**
 * Lưới cầu đơn vị tự dựng: dày hơn ở mặt trước và quanh vùng mắt-mũi-miệng (chi tiết nhỏ cỡ vài mm cần lưới cỡ đó), thưa ở phía sau đầu.
 * Không có đường nối (không trùng đỉnh) nên pháp tuyến liền mạch khắp đầu.
 */
function headGrid(nAz: number, nPol: number): BufferGeometry {
  const pos: number[] = [0, 1, 0];
  for (let j = 1; j < nPol; j++) {
    const sj = j / nPol;
    const theta = Math.PI * (sj + (0.5 * Math.sin(Math.PI * 2 * sj)) / (Math.PI * 2));
    for (let i = 0; i < nAz; i++) {
      const t = -1 + (2 * i) / nAz;
      const psi = Math.PI * (0.45 * t + 0.55 * Math.sign(t) * t * t);
      pos.push(Math.sin(theta) * Math.sin(psi), Math.cos(theta), Math.sin(theta) * Math.cos(psi));
    }
  }
  pos.push(0, -1, 0);
  const bottom = pos.length / 3 - 1;
  const ring = (j: number, i: number) => 1 + (j - 1) * nAz + (((i % nAz) + nAz) % nAz);
  const idx: number[] = [];
  for (let i = 0; i < nAz; i++) idx.push(0, ring(1, i), ring(1, i + 1));
  for (let j = 1; j < nPol - 1; j++) {
    for (let i = 0; i < nAz; i++) {
      const a = ring(j, i);
      const b = ring(j, i + 1);
      const c = ring(j + 1, i);
      const d = ring(j + 1, i + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  for (let i = 0; i < nAz; i++) idx.push(bottom, ring(nPol - 1, i + 1), ring(nPol - 1, i));
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function headGeometry(base: Color, lite: boolean): BufferGeometry {
  const g = lite ? headGrid(96, 72) : headGrid(128, 92);
  const pos = g.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const uv = new Float32Array(pos.count * 2);
  const d = new Vector3();
  const p = new Vector3();
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    skullPoint(d, p);
    if (p.z > 0) p.z += faceRelief(p.x, p.y);
    pos.setXYZ(i, p.x, p.y, p.z);
    uv[i * 2] = MathUtils.clamp(p.x / (2 * FACE_UV.halfW) + 0.5, 0, 1);
    uv[i * 2 + 1] = MathUtils.clamp(p.y / (2 * FACE_UV.halfH) + 0.5, 0, 1);
    faceTone(base, p.x, p.y, p.z, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Chân tóc phía trước theo x (m): lùi nhẹ ở thái dương, xuống thành tóc mai ở mép mặt. */
function frontHairline(ax: number): number {
  const centre = 0.066 - 0.55 * ax * ax * 6; // đỉnh trán
  const temple = 0.0315 * ramp(0.04, 0.062, ax); // xuống dọc tóc mai
  return Math.max(-0.012, Math.min(centre, 0.066) - temple * 1.8);
}

/** Đường chân tóc phía dưới (m, theo y) tại điểm trên đầu: phía trước theo `frontHairline`, phía sau xuống gáy. */
function hairLower(x: number, z: number): number {
  const front = frontHairline(Math.abs(x));
  const rear = -0.058;
  const k = ramp(-0.026, 0.034, z); // 1 ở phía trước, 0 ở phía sau
  return rear + (front - rear) * k;
}

export function buildHead(opts: HeadOptions): HeadBuild {
  const group = new Group();
  group.name = "care-head";
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const keep = <T extends BufferGeometry>(g: T) => {
    geometries.push(g);
    return g;
  };
  const own = <T extends Material>(m: T) => {
    materials.push(m);
    return m;
  };
  const add = (parent: Object3D, geo: BufferGeometry, mat: Material, place?: (m: Mesh) => void) => {
    const m = new Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    place?.(m);
    parent.add(m);
    return m;
  };

  const base = new Color(opts.skin);
  const paint = paintFace({ skin: opts.skin, eyeX: EYE_X, eyeY: EYE_Y, mouthY: MOUTH_Y });
  // Có lớp vẽ: màu da lấy từ ảnh vẽ. Không có canvas (kiểm thử): dùng màu đỉnh tính từ cùng các hàm hình khối.
  const skinMat = own(
    new MeshPhysicalMaterial({
      ...(paint ? { map: paint, color: new Color("#ffffff") } : { vertexColors: true }),
      roughness: 0.58,
      metalness: 0,
      sheen: 0.3,
      sheenRoughness: 0.6,
      sheenColor: new Color("#e6c3b3"),
      envMapIntensity: 0.5,
    }),
  );
  const plainSkin = (color: string, roughness = 0.58) => own(new MeshPhysicalMaterial({ color: new Color(color), roughness, metalness: 0, sheen: 0.3, sheenRoughness: 0.6, sheenColor: new Color("#e6c3b3"), envMapIntensity: 0.5 }));

  const headGeo = headGeometry(base, opts.lite ?? false);
  keep(headGeo);
  const head = add(group, headGeo, skinMat);
  head.updateMatrixWorld(true);

  /** Cao độ z của mặt trước tại (x, y) (tia từ phía trước chiếu vào đầu). */
  const ray = new Raycaster();
  const surfaceZ = (x: number, y: number, fallback = 0.075): number => {
    ray.set(new Vector3(x, y, 0.3), new Vector3(0, 0, -1));
    const hit = ray.intersectObject(head, false)[0];
    return hit ? hit.point.z : fallback;
  };

  // ----- Tai: vành tai dẹt, lòng tai tối hơn, dái tai nhỏ. Tai người già hơi dài.
  for (const s of [1, -1]) {
    const ear = new Group();
    ear.position.set(0.0715 * s, -0.01, -0.004);
    ear.rotation.set(0, -0.26 * s, 0.06 * s);
    group.add(ear);
    add(ear, keep(new SphereGeometry(1, 24, 18)), plainSkin("#c58f78"), (m) => m.scale.set(0.0105, 0.0295, 0.0195));
    add(ear, keep(new SphereGeometry(1, 20, 14)), plainSkin("#a9705e", 0.7), (m) => {
      m.scale.set(0.0075, 0.0195, 0.0125);
      m.position.set(-0.002 * s, 0.002, 0.003);
    });
    add(ear, keep(new SphereGeometry(1, 16, 12)), plainSkin("#c58f78"), (m) => {
      m.scale.set(0.0082, 0.0098, 0.0105);
      m.position.set(0, -0.0262, 0.002);
    });
  }

  // ----- Mũi: sống và nền chóp đã nắn trong lưới đầu; chóp tròn hơi rủ và hai cánh mũi là khối nhỏ đặt lên đó, kèm lỗ mũi tối.
  const nz = surfaceZ(0, -0.0358);
  add(group, keep(new SphereGeometry(0.0079, 24, 18)), plainSkin("#c98f7b", 0.5), (m) => {
    m.scale.set(1, 0.92, 1.02);
    m.position.set(0, -0.0292, surfaceZ(0, -0.0292) + 0.0036);
  });
  for (const s of [1, -1]) {
    add(group, keep(new SphereGeometry(1, 14, 10)), own(new MeshStandardMaterial({ color: new Color("#4a2c26"), roughness: 0.9 })), (m) => {
      m.scale.set(0.0026, 0.0011, 0.0036);
      m.position.set(0.0056 * s, -0.0362, nz - 0.0004);
      m.rotation.set(0.5, 0, -0.25 * s);
    });
  }

  // ----- Mắt: lòng trắng ngả kem, tròng, đồng tử, mi trên hơi nặng và mi dưới.
  const sclera = own(new MeshStandardMaterial({ color: new Color("#ebe3d6"), roughness: 0.32, metalness: 0, envMapIntensity: 0.7 }));
  const iris = own(new MeshStandardMaterial({ color: new Color("#4a3527"), roughness: 0.2, metalness: 0, envMapIntensity: 0.9 }));
  const pupil = own(new MeshStandardMaterial({ color: new Color("#0d0907"), roughness: 0.15, metalness: 0, envMapIntensity: 0.9 }));
  const lidMat = own(new MeshPhysicalMaterial({ color: new Color("#b98a74"), roughness: 0.6, metalness: 0, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new Color("#f2b8a0"), envMapIntensity: 0.5 }));
  const R_EYE = 0.0126;
  for (const s of [1, -1]) {
    const eye = new Group();
    const ez = surfaceZ(EYE_X * s, EYE_Y) - R_EYE * 0.56;
    eye.position.set(EYE_X * s, EYE_Y, ez);
    eye.rotation.y = 0.07 * s; // nhìn thẳng, hai mắt hơi chụm nhẹ
    group.add(eye);
    add(eye, keep(new SphereGeometry(R_EYE, 28, 20)), sclera);
    add(eye, keep(new SphereGeometry(R_EYE * 1.004, 20, 12, 0, Math.PI * 2, 0, 0.47)), iris, (m) => (m.rotation.x = Math.PI / 2));
    add(eye, keep(new SphereGeometry(R_EYE * 1.008, 16, 8, 0, Math.PI * 2, 0, 0.19)), pupil, (m) => (m.rotation.x = Math.PI / 2));
    // Mi trên phủ phần trên của tròng một chút; mi dưới ngang rìa dưới tròng.
    add(eye, keep(new SphereGeometry(R_EYE * 1.085, 28, 14, 0, Math.PI * 2, 0, 1.4)), lidMat, (m) => (m.rotation.x = -0.02));
    add(eye, keep(new SphereGeometry(R_EYE * 1.07, 28, 10, 0, Math.PI * 2, Math.PI - 0.55, 0.55)), lidMat);
  }

  // Lông mày và môi được vẽ mềm trong lớp vẽ mặt (`facePaint.ts`); môi còn có phù điêu nhẹ trong lưới đầu.

  // ----- Tóc bạc ngắn: vỏ mỏng ôm đúng hộp sọ, mép là đường chân tóc răng cưa mềm cắt bằng bản đồ alpha (không bậc thang theo lưới).
  group.add(buildHair(head, opts, keep, own));

  return {
    group,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

function buildHair(head: Mesh, opts: HeadOptions, keep: <T extends BufferGeometry>(g: T) => T, own: <T extends Material>(m: T) => T): Mesh {
  const src = head.geometry;
  const pos = src.getAttribute("position");
  const nor = src.getAttribute("normal");
  const index = src.getIndex()!;
  const hairBase = new Color(opts.hair);
  const root = new Color("#8d9094");
  const n = pos.count;
  const out = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const uv0 = new Float32Array(n * 2);
  const uv1 = new Float32Array(n * 2);
  const weight = new Float32Array(n);
  const c = new Color();
  const p = new Vector3();
  const nn = new Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    nn.fromBufferAttribute(nor, i);
    const x = p.x;
    const y = p.y;
    const z = p.z;
    const w = MathUtils.clamp((y - hairLower(x, z)) / 0.016, 0, 1);
    weight[i] = w;
    // Độ dày: mỏng nhất ở mép, đầy ở đỉnh và phía sau; gợn nhẹ như từng nhúm tóc.
    const clump = 1 + 0.22 * Math.sin(x * 150 + z * 110) * Math.sin(y * 120 - z * 80) + 0.12 * Math.sin(y * 210 + x * 60) + 0.1 * Math.sin(x * 55 + y * 40);
    const thick = (0.0026 + 0.0058 * ramp(-0.02, 0.07, y)) * (0.35 + 0.65 * w) * clump;
    out[i * 3] = x + nn.x * thick;
    out[i * 3 + 1] = y + nn.y * thick;
    out[i * 3 + 2] = z + nn.z * thick;
    // Chân tóc sẫm hơn một chút (bóng của chính lớp tóc), ngọn sáng.
    c.copy(root).lerp(hairBase, MathUtils.clamp(0.35 + 0.65 * w * (0.8 + 0.2 * clump), 0, 1));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    // Hoa văn sợi: u quanh trục dọc, v từ đỉnh xuống.
    uv0[i * 2] = (Math.atan2(x, z) / (Math.PI * 2) + 0.5) * 12;
    uv0[i * 2 + 1] = (1 - y / 0.11) * 1.4;
    // Kênh alpha: x = độ tiến vào vùng tóc, y = chỉ số nhúm quanh đầu.
    uv1[i * 2] = w;
    uv1[i * 2 + 1] = (Math.atan2(x, z) / (Math.PI * 2) + 0.5) * 140;
  }
  // Chỉ giữ tam giác có ít nhất một đỉnh nằm trong vùng tóc.
  const keepIdx: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const d = index.getX(t + 2);
    if (weight[a]! > 0 || weight[b]! > 0 || weight[d]! > 0) keepIdx.push(a, b, d);
  }
  const g = keep(new BufferGeometry());
  g.setAttribute("position", new Float32BufferAttribute(out, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv0, 2));
  g.setAttribute("uv1", new Float32BufferAttribute(uv1, 2));
  g.setIndex(keepIdx);
  g.computeVertexNormals();

  const mat = own(
    new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0,
      envMapIntensity: 0.6,
      side: FrontSide,
      alphaTest: 0.5,
    }),
  );
  if (opts.textures) {
    mat.normalMap = opts.textures.hair.normalMap;
    mat.alphaMap = hairlineAlpha();
    if (mat.alphaMap) mat.alphaMap.channel = 1;
  } else {
    // Không có canvas (kiểm thử): chân tóc cắt thẳng theo lưới, vẫn đúng hình khối.
    mat.alphaTest = 0;
  }
  const mesh = new Mesh(g, mat);
  mesh.name = "care-hair";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

let alphaCache: CanvasTexture | null | undefined;
/** Bản đồ alpha 1 chiều của chân tóc: ngưỡng thay đổi theo từng nhúm nên mép tóc răng cưa mềm, không thẳng như dao cắt. */
function hairlineAlpha(): CanvasTexture | null {
  if (alphaCache !== undefined) return alphaCache;
  alphaCache = null;
  const made = canvas2d(128, 64);
  if (!made) return alphaCache;
  const { canvas, ctx } = made;
  const img = ctx.createImageData(128, 64);
  let a = 91;
  const rand = () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
  const th = new Float32Array(64);
  for (let y = 0; y < 64; y++) th[y] = 0.18 + 0.5 * rand() ** 1.3;
  for (let y = 0; y < 64; y++) {
    const t = (th[y]! * 2 + th[(y + 1) % 64]! + th[(y + 63) % 64]!) / 4;
    for (let x = 0; x < 128; x++) {
      const v = MathUtils.clamp((x / 127 - t) / 0.09 + 0.5, 0, 1);
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(v * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapT = RepeatWrapping;
  tex.needsUpdate = true;
  alphaCache = tex;
  return alphaCache;
}
