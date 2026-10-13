import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  Mesh,
  Object3D,
  RingGeometry,
  TubeGeometry,
  Vector3,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MaterialSet } from "./materials";

/**
 * Mô hình dựng bằng code cho linh kiện chưa có CAD được cấp phép. Đơn vị mm.
 * Khung cục bộ của mọi mô hình: X = chiều rộng, Y = chiều dài, Z = chiều dày (mặt linh kiện hướng +Z).
 * Gốc cục bộ không cần ở tâm: `assembly.ts` chuẩn hoá về tâm hộp bao.
 * Kích thước là **ước lượng điển hình, chưa xác minh** với linh kiện thật (xem assemblyConfig.ts).
 * Vật thể gắn `userData.flexible = true` (dây, đầu nối) bị loại khỏi phép kiểm tra lắp vừa.
 *
 * Chi tiết hình ảnh (chân IC, đầu thiếc của linh kiện dán, vòng pad, nét in lụa) chỉ là kiểu đóng gói tiêu chuẩn của loại linh kiện
 * tương ứng, không phải số đo hay bố trí của bo thật; chúng nằm hoàn toàn bên trong hộp bao cũ của từng bo nên không đổi kết quả
 * kiểm tra lắp. Không có chữ, mã hay nhãn in nào được bịa ra.
 */

type Pos = readonly [number, number, number];

function place<T extends Object3D>(o: T, name: string, [x, y, z]: Pos): T {
  o.name = name;
  o.position.set(x, y, z);
  return o;
}

function mesh(name: string, geo: BufferGeometry, mat: Material | Material[], pos: Pos): Mesh {
  return place(new Mesh(geo, mat), name, pos);
}

const box = (name: string, sx: number, sy: number, sz: number, mat: Material, pos: Pos) =>
  mesh(name, new BoxGeometry(sx, sy, sz), mat, pos);

const rbox = (name: string, sx: number, sy: number, sz: number, r: number, mat: Material | Material[], pos: Pos) =>
  mesh(name, new RoundedBoxGeometry(sx, sy, sz, 3, Math.min(r, sx / 2 - 1e-3, sy / 2 - 1e-3, sz / 2 - 1e-3)), mat, pos);

/** Hình trụ có trục dọc theo Z (CylinderGeometry mặc định dọc theo Y). */
function cylZ(name: string, radius: number, height: number, mat: Material, pos: Pos): Mesh {
  const m = mesh(name, new CylinderGeometry(radius, radius, height, 28), mat, pos);
  m.rotation.x = Math.PI / 2;
  return m;
}

function flexible<T extends Object3D>(o: T): T {
  o.userData.flexible = true;
  return o;
}

function wire(name: string, points: Pos[], radius: number, mat: Material): Mesh {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)));
  const tube = new Mesh(new TubeGeometry(curve, 24, radius, 8, false), mat);
  tube.name = name;
  return flexible(tube);
}

/**
 * Bo mạch: mặt trên/dưới phủ hàn, bốn cạnh lộ lõi FR4 (thứ tự nhóm mặt của BoxGeometry: +X, −X, +Y, −Y, +Z, −Z).
 * Cùng kích thước và hình học như trước; chỉ đổi vật liệu từng mặt.
 */
function board(name: string, sx: number, sy: number, sz: number, r: number, mask: Material, m: MaterialSet, pos: Pos): Mesh {
  return rbox(name, sx, sy, sz, r, [m.pcbEdge, m.pcbEdge, m.pcbEdge, m.pcbEdge, mask, mask], pos);
}

/**
 * Gom các chi tiết nhỏ (chân linh kiện, đầu thiếc, nét in lụa, vòng pad) thành một mesh cho mỗi vật liệu:
 * hàng trăm chi tiết chỉ tốn vài lần vẽ. Mesh gộp không phải BoxGeometry nên bộ kiểm tra dùng chính các đỉnh của nó.
 */
class DetailBatch {
  private readonly parts = new Map<Material, BufferGeometry[]>();

  add(mat: Material, geo: BufferGeometry, [x, y, z]: Pos, rotZ = 0): void {
    if (rotZ) geo.rotateZ(rotZ);
    geo.translate(x, y, z);
    // Chỉ giữ thuộc tính chung để gộp được giữa các loại hình học.
    for (const key of Object.keys(geo.attributes)) if (key !== "position" && key !== "normal") geo.deleteAttribute(key);
    const list = this.parts.get(mat) ?? [];
    list.push(geo);
    this.parts.set(mat, list);
  }

  box(mat: Material, sx: number, sy: number, sz: number, pos: Pos, rotZ = 0): void {
    this.add(mat, new BoxGeometry(sx, sy, sz), pos, rotZ);
  }

  /** Vòng pad xuyên lỗ phẳng trên mặt bo (+Z) cùng lỗ tối ở giữa. */
  ring(m: MaterialSet, outer: number, hole: number, [x, y, z]: Pos, metal: Material = m.copperGold): void {
    this.add(metal, new RingGeometry(hole, outer, 24), [x, y, z + 0.012]);
    this.add(m.chip, new CylinderGeometry(hole, hole, 0.02, 16).rotateX(Math.PI / 2), [x, y, z + 0.006]);
  }

  /** Khung in lụa hình chữ nhật (nét 0,15 mm) quanh một linh kiện, có vạch đánh dấu chân 1 ở góc. */
  outline(m: MaterialSet, w: number, l: number, [x, y, z]: Pos, pin1 = true): void {
    const t = 0.15;
    const h = 0.02;
    const zz = z + h / 2;
    this.box(m.silkscreen, w, t, h, [x, y + l / 2, zz]);
    this.box(m.silkscreen, w, t, h, [x, y - l / 2, zz]);
    this.box(m.silkscreen, t, l, h, [x + w / 2, y, zz]);
    this.box(m.silkscreen, t, l, h, [x - w / 2, y, zz]);
    // Dấu chân 1 nằm trong góc khung (không ra ngoài mép bo).
    if (pin1) this.add(m.silkscreen, new CylinderGeometry(0.2, 0.2, h, 12).rotateX(Math.PI / 2), [x - w / 2 + 0.38, y + l / 2 - 0.38, zz]);
  }

  build(name: string): Group {
    const g = new Group();
    g.name = name;
    let i = 0;
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const geo of list) geo.dispose();
      if (!merged) continue;
      const mm = new Mesh(merged, mat);
      mm.name = `${name}-${i++}`;
      g.add(mm);
    }
    return g;
  }
}

/** Thân IC dạng khối cùng chân kiểu gull-wing trên hai cạnh (`sides` = "x": chân ở cạnh ±X, "y": ở cạnh ±Y) hoặc pad QFN quanh đáy. */
function ic(
  g: Group,
  d: DetailBatch,
  m: MaterialSet,
  name: string,
  [w, l, h]: Pos,
  [x, y, z]: Pos,
  pins: { perSide: number; sides: "x" | "y" | "qfn" },
  boardTop: number,
): void {
  g.add(box(name, w, l, h, m.chip, [x, y, z]));
  // Dấu chân 1 lõm nhẹ trên mặt thân.
  // Dày 0,004 mm, nhô đúng 0,004 mm trên mặt thân: không đổi hộp bao của bo (dung sai kiểm tra 0,005 mm).
  d.add(m.ferrite, new CylinderGeometry(Math.min(w, l) * 0.08, Math.min(w, l) * 0.08, 0.004, 16).rotateX(Math.PI / 2), [x - w / 2 + Math.min(w, l) * 0.2, y + l / 2 - Math.min(w, l) * 0.2, z + h / 2 + 0.002]);
  const n = pins.perSide;
  const leadZ = boardTop + 0.12;
  if (pins.sides === "qfn") {
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * ((Math.min(w, l) * 0.7) / Math.max(1, n - 1));
      d.box(m.tin, 0.25, 0.42, 0.2, [x + t, y - l / 2 - 0.12, leadZ]);
      d.box(m.tin, 0.25, 0.42, 0.2, [x + t, y + l / 2 + 0.12, leadZ]);
      d.box(m.tin, 0.42, 0.25, 0.2, [x - w / 2 - 0.12, y + t, leadZ]);
      d.box(m.tin, 0.42, 0.25, 0.2, [x + w / 2 + 0.12, y + t, leadZ]);
    }
    return;
  }
  const along = pins.sides === "y" ? w : l;
  const pitch = (along * 0.8) / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i - (n - 1) / 2) * pitch;
    if (pins.sides === "y") {
      d.box(m.tin, 0.4, 0.75, 0.18, [x + t, y - l / 2 - 0.3, leadZ]);
      d.box(m.tin, 0.4, 0.75, 0.18, [x + t, y + l / 2 + 0.3, leadZ]);
    } else {
      d.box(m.tin, 0.75, 0.4, 0.18, [x - w / 2 - 0.3, y + t, leadZ]);
      d.box(m.tin, 0.75, 0.4, 0.18, [x + w / 2 + 0.3, y + t, leadZ]);
    }
  }
}

/** Linh kiện dán hai đầu (tụ, điện trở, LED): thân cùng hai đầu thiếc. Trục dài theo `axis`. */
function smd(g: Group, d: DetailBatch, m: MaterialSet, name: string, [sx, sy, sz]: Pos, body: Material, pos: Pos): void {
  g.add(box(name, sx, sy, sz, body, pos));
  const alongX = sx >= sy;
  const cap = Math.min(alongX ? sx : sy, 1.6) * 0.18;
  const [x, y, z] = pos;
  if (alongX) {
    d.box(m.tin, cap, sy + 0.02, sz + 0.02, [x - sx / 2 + cap / 2 - 0.01, y, z]);
    d.box(m.tin, cap, sy + 0.02, sz + 0.02, [x + sx / 2 - cap / 2 + 0.01, y, z]);
  } else {
    d.box(m.tin, sx + 0.02, cap, sz + 0.02, [x, y - sy / 2 + cap / 2 - 0.01, z]);
    d.box(m.tin, sx + 0.02, cap, sz + 0.02, [x, y + sy / 2 - cap / 2 + 0.01, z]);
  }
}

/**
 * Bo ESP32-S3 CAM (ước lượng): bo 27 × 40 × 1,6 mm; module WROOM-1 18 × 25,5 × 3,1 mm (kích thước đối chiếu từ hai nguồn CAD)
 * và camera 8,5 × 8,5 mm **cùng ở mặt trước** (+Z), ăng-ten module nhô 1,1 mm qua mép trên như nhiều bo phát triển.
 * Mặt sau chỉ có linh kiện thấp (≤ 0,5 mm). Tâm ống kính cách tâm bo 9 mm về phía mép dưới.
 */
export function buildEsp32Cam(m: MaterialSet): Group {
  const g = new Group();
  g.name = "esp32-cam";
  const d = new DetailBatch();
  g.add(board("board", 27, 40, 1.6, 0.6, m.solderMask, m, [0, 0, 0]));

  const mod = new Group();
  mod.name = "esp32-s3-wroom-1";
  mod.add(box("module-pcb", 18, 25.5, 0.8, m.solderMaskBlack, [0, 8.35, 1.2]));
  mod.add(rbox("module-shield", 18, 19.2, 2.3, 0.25, m.metalShield, [0, 5.2, 2.75]));
  // Ăng-ten PCB của module là một đường mạch uốn khúc (meander) dưới lớp phủ hàn, ở phần module không có nắp chắn.
  const ax0 = -7;
  const ax1 = 7;
  const legs = 6;
  for (let i = 0; i < legs; i++) {
    const x = ax0 + (i * (ax1 - ax0)) / (legs - 1);
    d.box(m.copperGold, 0.45, 4.2, 0.03, [x, 18.2, 1.615]);
    if (i < legs - 1) d.box(m.copperGold, (ax1 - ax0) / (legs - 1) + 0.45, 0.45, 0.03, [x + (ax1 - ax0) / (legs - 1) / 2, i % 2 === 0 ? 20.08 : 16.32, 1.615]);
  }
  // Pad bán lỗ (castellated) dọc hai cạnh module.
  for (let i = 0; i < 12; i++) {
    const y = -3.6 + i * 1.27;
    d.box(m.copperGold, 0.55, 0.8, 0.82, [-8.75, y, 1.2]);
    d.box(m.copperGold, 0.55, 0.8, 0.82, [8.75, y, 1.2]);
  }
  g.add(mod);

  const cam = new Group();
  cam.name = "camera-module";
  cam.add(box("fpc-connector", 12, 3.4, 1.4, m.plasticBlack, [0, -9, 1.5]));
  // Cần khoá của đầu nối FPC (màu nâu sẫm như đầu nối ZIF thông dụng) lộ ra hai bên camera.
  d.box(m.flexCable, 1.6, 3.6, 0.3, [-5.2, -9, 2.35]);
  d.box(m.flexCable, 1.6, 3.6, 0.3, [5.2, -9, 2.35]);
  cam.add(rbox("camera-holder", 8.5, 8.5, 3.2, 0.35, m.plasticBlack, [0, -9, 3.1]));
  const lens = new Group();
  lens.name = "lens";
  lens.add(cylZ("lens-barrel", 3, 2.4, m.plasticBlack, [0, -9, 5.9]));
  lens.add(cylZ("lens-ring", 2.5, 0.3, m.metalBright, [0, -9, 7.2]));
  lens.add(cylZ("lens-glass", 2.05, 0.35, m.opticalGlass, [0, -9, 7.3]));
  cam.add(lens);
  g.add(cam);

  // Linh kiện nhỏ ở hai dải mép trước (ngoài vùng module và camera) và linh kiện thấp ở mặt sau.
  ic(g, d, m, "chip-a", [3, 3, 0.9], [-11.3, -12, 1.25], { perSide: 4, sides: "qfn" }, 0.8);
  ic(g, d, m, "chip-b", [3, 3, 0.9], [11.3, -12, 1.25], { perSide: 4, sides: "qfn" }, 0.8);
  d.outline(m, 4.2, 4.2, [-11.3, -12, 0.8]);
  d.outline(m, 4.2, 4.2, [11.3, -12, 0.8]);
  for (let i = 0; i < 4; i++) smd(g, d, m, `passive-${i}`, [0.8, 1.6, 0.5], m.ceramicCap, [11.6, -4 + i * 2.4, 1.05]);
  smd(g, d, m, "led", [1.2, 2, 0.7], m.ledPale, [-11.6, -4, 1.15]);
  for (let i = 0; i < 6; i++) d.ring(m, 0.8, 0.42, [-6.5 + i * 2.6, -18.3, 0.8]);
  g.add(box("back-chip", 4, 4, 0.5, m.chip, [-6, 2, -1.05]));
  for (let i = 0; i < 4; i++) g.add(box(`back-passive-${i}`, 1.6, 0.8, 0.5, m.ceramicCap, [4 + i * 2.2, -6, -1.05]));
  g.add(d.build("esp32-details"));
  return g;
}

export interface CellDimensions {
  /** Chiều rộng (mm). */
  width: number;
  /** Chiều dài túi kể cả mép hàn, không kể lá tab (mm). */
  length: number;
  /** Chiều dày (mm). */
  thickness: number;
}

/**
 * Pin Li-Po dẹt dạng túi: thân túi, nhãn, mép hàn 6 mm ở đầu +Y, hai lá tab và dây ra đầu nối JST.
 * Dây và đầu nối nằm phía sau túi (−Z cục bộ) và được đánh dấu mềm (không tính vào kiểm tra lắp vừa cứng).
 * Nhãn để trống: dung lượng và mã pin thật chưa biết nên không in gì.
 */
export function buildLipoCell(m: MaterialSet, dims: CellDimensions): Group {
  const { width: w, length: l, thickness: t } = dims;
  const g = new Group();
  g.name = "lipo-cell";
  const pouch = new Group();
  pouch.name = "pouch";
  pouch.add(rbox("pouch-body", w, l - 6, t - 0.1, 2.2, m.batteryFoil, [0, -3, -0.05]));
  pouch.add(rbox("label", w - 4, l - 16, 0.1, 0.04, m.batteryLabel, [0, -5, t / 2 - 0.05]));
  pouch.add(rbox("seal-flange", w, 6, 1.4, 0.5, m.batteryFoil, [0, l / 2 - 3, 0]));
  g.add(pouch);
  const top = l / 2;
  g.add(flexible(box("tab-positive", 4, 3.5, 0.25, m.tabNickel, [6, top + 1.75, 0])));
  g.add(flexible(box("tab-negative", 4, 3.5, 0.25, m.tabNickel, [-6, top + 1.75, 0])));

  const wires = new Group();
  wires.name = "wires";
  wires.add(wire("wire-positive", [[6, top + 3.3, 0], [6, top + 4.2, -0.8], [3.5, top + 4.3, -1.6], [1.5, top + 4.0, -2.4]], 0.5, m.wireRed));
  wires.add(wire("wire-negative", [[-6, top + 3.3, 0], [-6, top + 4.2, -0.8], [-3.5, top + 4.3, -1.6], [-1.5, top + 4.0, -2.4]], 0.5, m.wireBlack));
  wires.add(box("jst-connector", 6, 3, 4.5, m.plasticWhite, [0, top + 2.6, -2.55]));
  wires.children.forEach(flexible);
  g.add(wires);
  return g;
}

/** Mạch sạc TP4056 USB-C điển hình 17 × 28 mm; cổng USB-C ở đầu −Y. */
export function buildTp4056(m: MaterialSet): Group {
  const g = new Group();
  g.name = "tp4056";
  const d = new DetailBatch();
  g.add(board("board", 17, 28, 1.2, 0.4, m.solderMask, m, [0, 0, 0]));

  const usb = new Group();
  usb.name = "usb-c";
  usb.add(rbox("usb-c-shell", 8.9, 7.4, 3.2, 0.9, m.metalBright, [0, -11.3, 2.2]));
  usb.add(box("usb-c-mouth", 7.6, 0.3, 1.5, m.plasticBlack, [0, -14.95, 2.2]));
  usb.add(box("usb-c-tongue", 6.2, 0.2, 0.5, m.metalShield, [0, -14.9, 2.2]));
  g.add(usb);
  // Chân hàn của vỏ cổng (thiếc) hai bên.
  d.box(m.tin, 0.9, 1.6, 0.25, [-4.9, -10, 0.72]);
  d.box(m.tin, 0.9, 1.6, 0.25, [4.9, -10, 0.72]);

  ic(g, d, m, "tp4056-ic", [5, 4, 1.5], [-2, -1, 1.35], { perSide: 4, sides: "y" }, 0.6);
  ic(g, d, m, "dw01-ic", [3, 1.7, 1], [3.5, 3.5, 1.1], { perSide: 3, sides: "y" }, 0.6);
  ic(g, d, m, "fs8205-ic", [3, 4.4, 1.2], [-3.5, 7, 1.2], { perSide: 4, sides: "x" }, 0.6);
  d.outline(m, 6.4, 6.2, [-2, -1, 0.6]);
  smd(g, d, m, "led-charge", [2, 1.2, 0.7], m.ledPale, [6, -4.5, 0.95]);
  smd(g, d, m, "led-done", [2, 1.2, 0.7], m.ledPale, [6, -7, 0.95]);
  for (let i = 0; i < 4; i++) smd(g, d, m, `resistor-${i}`, [1.6, 0.8, 0.5], m.chip, [3 + (i % 2) * 2.4, -1 + Math.floor(i / 2) * 1.8, 0.85]);
  for (let i = 0; i < 4; i++) d.ring(m, 1.1, 0.5, [-6 + i * 4, 12.2, 0.6], m.tin);
  g.add(d.build("tp4056-details"));
  return g;
}

/** Mạch boost 3,7 → 5 V điển hình 17 × 35 mm (kiểu MT3608: cuộn cảm, IC, biến trở, diode). */
export function buildBoostConverter(m: MaterialSet): Group {
  const g = new Group();
  g.name = "boost-converter";
  const d = new DetailBatch();
  g.add(board("board", 17, 35, 1.2, 0.4, m.solderMask, m, [0, 0, 0]));
  g.add(rbox("inductor", 6.6, 6.6, 3.2, 0.9, m.ferrite, [-3.2, -6, 2.2]));
  d.box(m.tin, 1.2, 6.8, 0.2, [-6.4, -6, 0.7]);
  d.box(m.tin, 1.2, 6.8, 0.2, [0, -6, 0.7]);
  ic(g, d, m, "boost-ic", [3, 1.6, 1.1], [3.5, 1.5, 1.15], { perSide: 3, sides: "y" }, 0.6);
  const trimmer = new Group();
  trimmer.name = "trimmer";
  trimmer.add(rbox("trimmer-body", 4.5, 4.5, 2.4, 0.3, m.trimmer, [3.5, -9, 1.8]));
  trimmer.add(cylZ("trimmer-screw", 1, 0.3, m.copperGold, [3.5, -9, 3.15]));
  d.box(m.metalShield, 1.6, 0.25, 0.05, [3.5, -9, 3.32]);
  g.add(trimmer);
  // Diode SMA: thân đen, vạch cực âm in xám ở một đầu, hai tai thiếc.
  g.add(rbox("diode", 4.3, 2.6, 2.2, 0.25, m.plasticBlack, [-1, 9, 1.7]));
  d.box(m.silkscreen, 0.6, 2.62, 0.04, [-2.6, 9, 2.81]);
  d.box(m.tin, 0.6, 1.6, 0.2, [-3.45, 9, 0.7]);
  d.box(m.tin, 0.6, 1.6, 0.2, [1.45, 9, 0.7]);
  for (let i = 0; i < 3; i++) smd(g, d, m, `capacitor-${i}`, [3.2, 1.6, 1.2], m.ceramicCap, [3.5, 6 + i * 2.6, 1.2]);
  for (const [x, y] of [[-6, -15.5], [6, -15.5], [-6, 15.5], [6, 15.5]] as const) d.ring(m, 1.1, 0.5, [x, y, 0.6], m.tin);
  d.outline(m, 8, 8, [-3.2, -6, 0.6], false);
  g.add(d.build("boost-details"));
  return g;
}

/** Bo GY-521 MPU6050 điển hình 16 × 21 mm với tám lỗ chân 2,54 mm (không hàn header). */
export function buildGy521(m: MaterialSet): Group {
  const g = new Group();
  g.name = "gy521";
  const d = new DetailBatch();
  g.add(board("board", 16, 21, 1.2, 0.5, m.solderMask, m, [0, 0, 0]));
  ic(g, d, m, "mpu6050", [4, 4, 0.9], [1.2, 0, 1.05], { perSide: 6, sides: "qfn" }, 0.6);
  d.outline(m, 4.9, 4.9, [1.2, 0, 0.6]);
  ic(g, d, m, "regulator", [3.5, 6.5, 1.6], [-1.5, 6, 1.4], { perSide: 2, sides: "x" }, 0.6);
  for (let i = 0; i < 4; i++) smd(g, d, m, `capacitor-${i}`, [1.6, 0.8, 0.6], m.ceramicCap, [4.5, -6 + i * 1.8, 0.9]);
  smd(g, d, m, "led", [1.6, 0.8, 0.6], m.ledPale, [4.5, 6.5, 0.9]);
  for (let i = 0; i < 8; i++) d.ring(m, 0.95, 0.5, [-6.7, -8.89 + i * 2.54, 0.6], m.tin);
  g.add(d.build("gy521-details"));
  return g;
}

export type SwitchPosition = "on" | "off";
const SLIDE_TRAVEL_MM = 1.5;

/**
 * Công tắc trượt ON/OFF **chốt** (SPDT) cỡ nhỏ, kiểu SS-12D00 (kích thước ước lượng, chưa đo):
 * thân 8,6 × 3,6 × 3,5 mm, nắp kim loại có rãnh 5 × 1,5 mm, cần gạt 2 × 1,4 mm nhô 3 mm, ba chân dài 3,5 mm.
 * Cần gạt chỉ có hai vị trí chốt (±1,5 mm), không phải nút bấm nhả. Trục trượt là X; cần gạt hướng +Z.
 */
export function buildSlideSwitch(m: MaterialSet, position: SwitchPosition = "off"): Group {
  const g = new Group();
  g.name = "slide-switch";
  g.add(rbox("housing", 8.6, 3.6, 3.5, 0.2, m.plasticBlack, [0, 0, 1.75]));
  g.add(box("cover-strip-a", 8.6, 1.05, 0.3, m.metalShield, [0, 1.275, 3.65]));
  g.add(box("cover-strip-b", 8.6, 1.05, 0.3, m.metalShield, [0, -1.275, 3.65]));
  g.add(box("cover-end-a", 1.8, 1.5, 0.3, m.metalShield, [3.4, 0, 3.65]));
  g.add(box("cover-end-b", 1.8, 1.5, 0.3, m.metalShield, [-3.4, 0, 3.65]));
  for (let i = 0; i < 3; i++) g.add(box(`pin-${i}`, 0.5, 0.3, 3.5, m.tin, [(i - 1) * 2, 0, -1.75]));

  const slider = new Group();
  slider.name = "slider";
  slider.add(box("slider-stem", 2, 1.4, 0.6, m.switchSlider, [0, 0, 3.5]));
  slider.add(rbox("slider-knob", 2, 1.4, 3, 0.2, m.switchSlider, [0, 0, 5.3]));
  for (let i = -1; i <= 1; i++) slider.add(box(`slider-grip-${i + 1}`, 0.25, 1.45, 0.2, m.metalShield, [i * 0.6, 0, 6.85]));
  g.add(slider);

  g.userData.positions = { on: SLIDE_TRAVEL_MM, off: -SLIDE_TRAVEL_MM } satisfies Record<SwitchPosition, number>;
  setSwitchPosition(g, position);
  return g;
}

/** Đặt cần gạt vào một trong hai vị trí chốt. Trả về false nếu không tìm thấy cần gạt. */
export function setSwitchPosition(root: Object3D, position: SwitchPosition): boolean {
  // `root` có thể là nhóm bao ngoài do assembly thêm; tìm nhóm công tắc thật bên trong theo dữ liệu `positions`.
  let sw: Object3D | undefined;
  root.traverse((o) => {
    if (!sw && o.userData.positions) sw = o;
  });
  const slider = sw?.getObjectByName("slider");
  const positions = sw?.userData.positions as Record<SwitchPosition, number> | undefined;
  if (!sw || !slider || !positions) return false;
  slider.position.x = positions[position];
  sw.userData.position = position;
  return true;
}

/** Hộp thay thế khi không tải được tài sản CAD. Luôn được gắn nhãn là thay thế. */
export function buildFallbackBox(name: string, size: Pos, m: MaterialSet): Group {
  const g = new Group();
  g.name = name;
  g.userData.fallback = true;
  g.add(box("fallback-box", size[0], size[1], size[2], m.plasticWhite, [0, 0, 0]));
  return g;
}
