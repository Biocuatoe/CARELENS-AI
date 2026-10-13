import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  LinearFilter,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createHexLattice, digestHex, hexPose, type HexLattice, type HexPose, type HexVisual } from "./hexLattice";

/**
 * Gói dữ liệu của tình huống "quan sát hoạt động": một vật thể bền vững, không bao giờ bị tạo lại giữa các giai đoạn.
 * Nó bắt đầu là khung ngắm quanh vùng camera thấy, đóng băng thành ảnh chụp, co lại thành một thẻ dữ liệu (ảnh thu nhỏ dạng ô vuông),
 * rồi bay theo một cung tới khay nhận của hub trong nhà và nằm lại ở đó.
 *
 * Mọi thứ ở đây là hàm thuần: `samplePacket(plan, p)` chỉ phụ thuộc kế hoạch và tiến trình `p`, nên cuộn nhanh, chậm hay ngược đều cho đúng
 * cùng một khung hình và không có trôi dạt. Đối tượng three (`DataPacket`) chỉ áp trạng thái đã tính vào cảnh.
 *
 * Tiếp nối sang chương bảo vệ: chương đó chạy trong cùng cảnh, trên chính đối tượng này (lớp lục giác và dải rút gọn nằm sẵn trong `root`,
 * bật bằng `applySecure`) và bắt đầu đúng từ `finalPacketPose`. `PacketHandoff` (cuối file) mang tư thế cuối, vị trí cuối trên màn hình, ảnh chụp,
 * đặc tả hình dạng và hàm lấy mẫu, dành cho trường hợp một khung vẽ khác cần nối tiếp gói.
 *
 * Đây là hình minh hoạ khái niệm: ảnh trong gói được dựng từ cảnh tổng hợp, không phải dữ liệu thật và không có thiết bị hay mô hình nào được kiểm chứng.
 */

export type PacketPhase = "hidden" | "framing" | "captured" | "condensing" | "transit" | "arrived";

/** Kích thước và màu của gói (mét): dùng chung cho mọi nơi dựng lại gói. */
export interface PacketSpec {
  /** Rộng × cao × dày của thẻ khi đã co lại. */
  width: number;
  height: number;
  thickness: number;
  /** Cỡ ảnh chụp (px) và cỡ lưới ô vuông của ảnh thu nhỏ. */
  snapshotSize: readonly [number, number];
  mosaicCells: readonly [number, number];
  colors: { body: string; border: string };
}

/** Màu của dải rút gọn ở chương bảo vệ: ô sẫm, ký tự teal nhạt, gạch chân teal. */
export const SECURE_COLORS = { cell: "#1d323c", glyph: "#a6e6da", rule: "#55b9a8" } as const;

export const PACKET_SPEC: PacketSpec = {
  width: 0.14,
  height: 0.105,
  thickness: 0.007,
  snapshotSize: [192, 144],
  mosaicCells: [32, 24],
  colors: { body: "#17262f", border: "#55b9a8" },
};

/** Kế hoạch bay: toàn bộ điểm, hướng và cửa sổ thời gian (theo `p` của cảnh chủ). Không có trạng thái. */
export interface PacketPlan {
  /** Tâm, độ lớn (hệ số so với thẻ) của khung ngắm. Khung nằm vuông góc trục +Z, mặt hướng về người xem. */
  frame: { center: Vector3; scale: number };
  /** Bốn điểm điều khiển Bézier bậc ba của đường bay, từ tâm khung tới khay nhận. */
  path: readonly [Vector3, Vector3, Vector3, Vector3];
  /** Tư thế nằm yên ở khay: thẻ nằm phẳng, mặt ngửa lên. */
  dock: { position: Vector3; quaternion: Quaternion };
  /** Cửa sổ thời gian [bắt đầu, kết thúc] theo p của cảnh chủ. */
  windows: {
    appear: readonly [number, number];
    capture: readonly [number, number];
    condense: readonly [number, number];
    travel: readonly [number, number];
    settle: readonly [number, number];
  };
}

export interface PacketState {
  phase: PacketPhase;
  position: Vector3;
  quaternion: Quaternion;
  /** Hệ số so với thẻ kích thước thật (khung ngắm lớn hơn nhiều). */
  scale: number;
  /** 0–1: độ hiện chung. */
  opacity: number;
  /** 0–1: độ đậm của dấu ngắm (bốn góc khung). Mờ dần khi đã thành thẻ. */
  brackets: number;
  /** 0–1: độ hiện của ảnh chụp đầy đủ. */
  snapshot: number;
  /** 0–1: độ hiện của ảnh thu nhỏ dạng ô vuông (dữ liệu). */
  mosaic: number;
  /** 0–1: độ hiện của thân thẻ và viền kín. */
  slab: number;
  /** 0–1: tiến độ dọc đường bay đã làm mượt. */
  transit: number;
  /** Vận tốc tức thời (m trên một đơn vị p), để vẽ vệt bay. */
  velocity: Vector3;
}

export function createPacketState(): PacketState {
  return {
    phase: "hidden",
    position: new Vector3(),
    quaternion: new Quaternion(),
    scale: 1,
    opacity: 0,
    brackets: 0,
    snapshot: 0,
    mosaic: 0,
    slab: 0,
    transit: 0,
    velocity: new Vector3(),
  };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const window01 = (p: number, [a, b]: readonly [number, number]) => clamp01((p - a) / (b - a));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
/** Cong dạng "ease in-out" nhẹ hơn smoothstep ở hai đầu đường bay: đủ dốc để thấy hướng bay, không giật lúc bắt đầu và dừng. */
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

const Q_FACE = new Quaternion();
const Q_FLAT = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
const Q_BANK = new Quaternion();
const Q_YAW = new Quaternion();
const AXIS_Z = new Vector3(0, 0, 1);
const AXIS_Y = new Vector3(0, 1, 0);
const scratch = new Vector3();

function bezier(path: PacketPlan["path"], t: number, out: Vector3): Vector3 {
  const u = 1 - t;
  const [p0, p1, p2, p3] = path;
  return out
    .copy(p0)
    .multiplyScalar(u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
}

/**
 * Trạng thái của gói tại tiến trình `p`. Hàm thuần: không đọc, không ghi gì ngoài `out`. Liên tục theo p ở mọi cửa sổ
 * (đầu cửa sổ sau trùng cuối cửa sổ trước), nên không có bước nhảy.
 */
export function samplePacket(plan: PacketPlan, p: number, out: PacketState = createPacketState()): PacketState {
  const w = plan.windows;
  const appear = window01(p, w.appear);
  const capture = smoothstep(window01(p, w.capture));
  const condense = smootherstep(window01(p, w.condense));
  const travelRaw = window01(p, w.travel);
  const travel = smootherstep(travelRaw);
  const settle = smoothstep(window01(p, w.settle));

  // Vị trí: ở tâm khung cho tới hết đoạn co; sau đó chạy dọc đường bay; cuối cùng áp xuống khay.
  bezier(plan.path, travel, out.position);
  // Khoảng nhỏ cuối đường bay được kéo thẳng về tư thế khay (không dội, không vượt quá khay).
  out.position.lerp(plan.dock.position, settle);

  // Hướng: quay mặt về người xem khi chờ, nghiêng nhẹ theo hướng bay, rồi úp phẳng xuống khay ở nửa sau.
  const flat = smoothstep(clamp01((travel - 0.35) / 0.65));
  out.quaternion.copy(Q_FACE).slerp(Q_FLAT, flat);
  const bank = Math.sin(Math.PI * clamp01(travel)) * 0.2;
  Q_BANK.setFromAxisAngle(AXIS_Z, -bank * (1 - flat));
  Q_YAW.setFromAxisAngle(AXIS_Y, -0.28 * Math.sin(Math.PI * clamp01(travel)) * (1 - flat));
  out.quaternion.premultiply(Q_YAW).multiply(Q_BANK);
  out.quaternion.slerp(plan.dock.quaternion, settle);

  // Độ lớn: khung ngắm → thẻ.
  out.scale = 1 + (plan.frame.scale - 1) * (1 - condense);

  // Lớp hiển thị.
  out.opacity = smoothstep(appear);
  out.brackets = out.opacity * (1 - smoothstep(clamp01((condense - 0.55) / 0.45)));
  out.snapshot = capture * (1 - smoothstep(clamp01(condense / 0.7)));
  out.mosaic = smoothstep(clamp01((condense - 0.25) / 0.6));
  out.slab = smoothstep(clamp01((condense - 0.4) / 0.5));
  out.transit = travel;

  // Pha: phản ánh lớp ghi nhận đang diễn ra.
  if (p < w.appear[0] || appear <= 0) out.phase = "hidden";
  else if (p < w.capture[0]) out.phase = "framing";
  else if (p < w.condense[0]) out.phase = "captured";
  else if (p < w.travel[0]) out.phase = "condensing";
  else if (p < w.settle[1] - 1e-9) out.phase = "transit";
  else out.phase = "arrived";

  // Vận tốc (sai phân trung tâm trên vị trí) cho vệt bay.
  const e = 1e-3;
  const lo = clamp01(window01(p - e, w.travel));
  const hi = clamp01(window01(p + e, w.travel));
  bezier(plan.path, smootherstep(hi), scratch);
  out.velocity.copy(scratch);
  bezier(plan.path, smootherstep(lo), scratch);
  out.velocity.sub(scratch).multiplyScalar(1 / (2 * e));
  return out;
}

/** Vị trí cuối (tại khay), không phụ thuộc p: đúng bằng mẫu ở p = cuối cửa sổ `settle`. */
export function finalPacketPose(plan: PacketPlan): { position: Vector3; quaternion: Quaternion; scale: number } {
  return { position: plan.dock.position.clone(), quaternion: plan.dock.quaternion.clone(), scale: 1 };
}

/** Đối tượng three của gói: một nhóm duy nhất, dựng một lần, tái dùng cho mọi khung hình và có thể gắn lại sang cảnh khác. */
export class DataPacket {
  readonly root = new Group();
  readonly spec: PacketSpec;
  private readonly slab: Mesh;
  private readonly bracketGroup = new Group();
  private readonly borderGroup = new Group();
  private readonly face: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly mosaicFace: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly trail: Mesh[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly textures: CanvasTexture[] = [];
  readonly snapshotCanvas: HTMLCanvasElement;
  readonly mosaicCanvas: HTMLCanvasElement;

  constructor(snapshot: HTMLCanvasElement, spec: PacketSpec = PACKET_SPEC) {
    this.spec = spec;
    this.root.name = "data-packet";
    const { width: W, height: H, thickness: T } = spec;
    const teal = new Color(spec.colors.border);
    const own = <M extends Material>(m: M) => {
      this.materials.push(m);
      return m;
    };
    const geo = <G extends BufferGeometry>(g: G) => {
      this.geometries.push(g);
      return g;
    };

    // Ảnh chụp đầy đủ (mượt) và bản thu nhỏ dạng ô vuông (lấy mẫu gần nhất): hai lớp chồng nhau, chuyển dần từ ảnh sang dữ liệu.
    this.snapshotCanvas = snapshot;
    const [mx, my] = spec.mosaicCells;
    this.mosaicCanvas = document.createElement("canvas");
    this.mosaicCanvas.width = mx;
    this.mosaicCanvas.height = my;
    const mctx = this.mosaicCanvas.getContext("2d");
    if (mctx) {
      mctx.imageSmoothingEnabled = true;
      mctx.imageSmoothingQuality = "high";
      mctx.drawImage(snapshot, 0, 0, mx, my);
    }
    const tex = (c: HTMLCanvasElement, nearest: boolean) => {
      const t = new CanvasTexture(c);
      t.colorSpace = SRGBColorSpace;
      t.magFilter = nearest ? NearestFilter : LinearFilter;
      t.minFilter = nearest ? NearestFilter : LinearFilter;
      t.generateMipmaps = false;
      this.textures.push(t);
      return t;
    };
    const faceW = W * 0.92;
    const faceH = H * 0.9;
    const faceMat = (c: HTMLCanvasElement, nearest: boolean) => own(new MeshBasicMaterial({ map: tex(c, nearest), transparent: true, opacity: 0, toneMapped: false, depthWrite: false, fog: false }));
    this.face = new Mesh(geo(new PlaneGeometry(faceW, faceH)), faceMat(snapshot, false));
    this.mosaicFace = new Mesh(geo(new PlaneGeometry(faceW, faceH)), faceMat(this.mosaicCanvas, true));
    this.face.position.z = T / 2 + 0.0004;
    this.mosaicFace.position.z = T / 2 + 0.0008;
    this.face.renderOrder = 6;
    this.mosaicFace.renderOrder = 7;

    // Thân thẻ: khối tối bo góc, ngả xanh than (đồng bộ với nền cảnh), phản chiếu nhẹ.
    // Gói không chịu sương mù: ở chương bảo vệ căn phòng chìm vào nền nhưng gói vẫn rõ (ở chương quan sát sương mù chưa chạm tới gói nên không đổi gì).
    const slabMat = own(new MeshStandardMaterial({ color: new Color(spec.colors.body), roughness: 0.42, metalness: 0.25, transparent: true, opacity: 0, envMapIntensity: 0.9, fog: false }));
    this.slab = new Mesh(geo(new RoundedBoxGeometry(W, H, T, 3, 0.004)), slabMat);
    this.slab.castShadow = true;

    // Viền teal kín (bốn thanh mảnh, sáng, không chịu tone mapping nên giữ đúng màu nhấn) và bốn dấu ngắm ở góc (chữ L) của khung.
    const edgeMat = own(new MeshBasicMaterial({ color: teal, transparent: true, opacity: 0, toneMapped: false, depthWrite: false, fog: false }));
    const bar = (w: number, h: number, x: number, y: number, parent: Group, depth = T * 0.9) => {
      const m = new Mesh(geo(new BoxGeometry(w, h, depth)), edgeMat);
      m.position.set(x, y, 0);
      m.renderOrder = 8;
      parent.add(m);
    };
    const e = 0.0016;
    bar(W, e, 0, H / 2 - e / 2, this.borderGroup);
    bar(W, e, 0, -H / 2 + e / 2, this.borderGroup);
    bar(e, H, -W / 2 + e / 2, 0, this.borderGroup);
    bar(e, H, W / 2 - e / 2, 0, this.borderGroup);
    const arm = Math.min(W, H) * 0.24;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        // Dấu ngắm: thanh mảnh và phẳng (khi khung phóng to 3,7 lần vẫn chỉ dày vài mm, không thành khối).
        bar(arm, e * 0.8, sx * (W / 2 - arm / 2), sy * (H / 2 - e * 0.4), this.bracketGroup, 0.0004);
        bar(e * 0.8, arm, sx * (W / 2 - e * 0.4), sy * (H / 2 - arm / 2), this.bracketGroup, 0.0004);
      }
    }
    this.edgeMat = edgeMat;
    this.slabMat = slabMat;

    this.root.add(this.slab, this.face, this.mosaicFace, this.borderGroup, this.bracketGroup);
    this.root.visible = false;

    // Vệt bay: ba bản mờ của thân thẻ ở các vị trí vừa qua. Không phải hạt: chỉ ba vật thể, vị trí là hàm của p.
    for (let i = 0; i < 3; i++) {
      const ghost = new Mesh(geo(new RoundedBoxGeometry(W, H, T * 0.6, 2, 0.003)), own(new MeshBasicMaterial({ color: teal, transparent: true, opacity: 0, toneMapped: false, depthWrite: false, fog: false })));
      ghost.visible = false;
      ghost.renderOrder = 3;
      this.trail.push(ghost);
    }

    // Lớp bảo vệ (chương sau), nằm trong chính nhóm của gói: mặt ảnh thu nhỏ lát thành ô lục giác (màu lấy đúng từ ảnh đó), rồi hội tụ thành
    // dải tám ô mang chuỗi ký tự dạng mã băm của chính ảnh này. Ẩn cho tới khi chương bảo vệ bắt đầu.
    this.lattice = createHexLattice(faceW, faceH);
    const cells = this.lattice.cells;
    const pixels = mctx ? mctx.getImageData(0, 0, mx, my).data : null;
    this.digest = digestHex(pixels ?? []);
    const hexGeo = geo(new CylinderGeometry(this.lattice.radius * 0.9, this.lattice.radius * 0.9, 0.0016, 6));
    // Trục ô quay theo +Z: đỉnh nhọn hướng lên, mặt ô song song mặt thẻ.
    hexGeo.rotateX(Math.PI / 2);
    // Trong lượt vẽ trong suốt (độ hiện 1) để luôn vẽ sau bề mặt báo cáo, dù bề mặt không kiểm tra độ sâu.
    this.hexes = new InstancedMesh(hexGeo, own(new MeshBasicMaterial({ toneMapped: false, fog: false, transparent: true })), cells.length);
    this.hexes.instanceMatrix.setUsage(DynamicDrawUsage);
    this.hexes.frustumCulled = false;
    this.hexes.renderOrder = 9;
    this.baseColors = cells.map((c) => {
      if (!pixels) return new Color(spec.colors.border);
      // Trung bình 3 × 3 điểm ảnh quanh tâm ô (ảnh thu nhỏ, gốc trên-trái).
      const cx = Math.min(mx - 1, Math.floor(c.u * mx));
      const cy = Math.min(my - 1, Math.floor(c.v * my));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = Math.max(0, cy - 1); y <= Math.min(my - 1, cy + 1); y++) {
        for (let x = Math.max(0, cx - 1); x <= Math.min(mx - 1, cx + 1); x++) {
          const i = (y * mx + x) * 4;
          r += pixels[i]!;
          g += pixels[i + 1]!;
          b += pixels[i + 2]!;
          n++;
        }
      }
      return new Color().setRGB(r / n / 255, g / n / 255, b / n / 255, SRGBColorSpace);
    });
    cells.forEach((_, i) => this.hexes.setColorAt(i, this.baseColors[i]!));

    const { slotSpacing } = this.lattice;
    const stripW = slotSpacing * this.lattice.slots.length;
    const glyphCanvas = document.createElement("canvas");
    glyphCanvas.width = 128 * this.lattice.slots.length;
    glyphCanvas.height = 128;
    const gctx = glyphCanvas.getContext("2d");
    if (gctx) {
      gctx.fillStyle = SECURE_COLORS.glyph;
      gctx.font = '600 54px ui-monospace, "Cascadia Mono", "SFMono-Regular", Menlo, Consolas, monospace';
      gctx.textAlign = "center";
      gctx.textBaseline = "middle";
      this.lattice.slots.forEach((_, k) => gctx.fillText(this.digest.slice(k * 2, k * 2 + 2), 128 * k + 64, 66));
    }
    this.digestMat = own(new MeshBasicMaterial({ map: tex(glyphCanvas, false), transparent: true, opacity: 0, toneMapped: false, depthWrite: false, fog: false }));
    const plate = new Mesh(geo(new PlaneGeometry(stripW, slotSpacing)), this.digestMat);
    // Trước mặt ô đại diện ở độ lớn cuối (ô dày 1,6 mm, phóng 1,7 lần): chữ không bị mặt ô che.
    plate.position.z = 0.003;
    plate.renderOrder = 10;
    this.ruleMat = own(new MeshBasicMaterial({ color: new Color(SECURE_COLORS.rule), transparent: true, opacity: 0, toneMapped: false, depthWrite: false, fog: false }));
    const rule = new Mesh(geo(new PlaneGeometry(stripW * 0.96, 0.0009)), this.ruleMat);
    rule.position.set(0, -this.lattice.slotRadius - 0.0045, 0.003);
    rule.renderOrder = 10;
    this.secureGroup.name = "data-packet-secure-layer";
    this.secureGroup.add(this.hexes, plate, rule);
    this.secureGroup.position.z = T / 2 + 0.0016;
    this.secureGroup.visible = false;
    this.root.add(this.secureGroup);
  }

  private readonly edgeMat: MeshBasicMaterial;
  private readonly slabMat: MeshStandardMaterial;
  private readonly secureGroup = new Group();
  private readonly lattice: HexLattice;
  private readonly hexes: InstancedMesh;
  private readonly baseColors: Color[];
  private readonly digestMat: MeshBasicMaterial;
  private readonly ruleMat: MeshBasicMaterial;
  private readonly hexScratch: HexPose = { x: 0, y: 0, z: 0, scale: 0, mix: 0 };
  private readonly hexMatrix = new Matrix4();
  private readonly hexColor = new Color();
  private readonly cellColor = new Color(SECURE_COLORS.cell);
  /** Chuỗi 16 ký tự hex tính từ điểm ảnh của chính ảnh thu nhỏ (minh hoạ, không phải hàm băm mật mã). */
  readonly digest: string;

  /** Các vật thể vệt bay: cần thêm vào cùng cảnh với `root` (không nằm trong `root` vì chúng đứng ở vị trí thế giới riêng). */
  get trailObjects(): readonly Object3D[] {
    return this.trail;
  }

  /** Áp trạng thái đã tính vào đối tượng. Không đọc trạng thái trước đó. */
  apply(s: PacketState): void {
    const r = this.root;
    r.visible = s.opacity > 0.002;
    r.position.copy(s.position);
    r.quaternion.copy(s.quaternion);
    r.scale.setScalar(s.scale);
    // Độ dày không co theo độ lớn khung ngắm: thân thẻ chỉ hiện khi đã nhỏ lại, nhưng giữ độ dày thật.
    this.slab.scale.z = 1 / s.scale;
    this.face.material.opacity = s.opacity * s.snapshot;
    this.mosaicFace.material.opacity = s.opacity * s.mosaic;
    this.slabMat.opacity = s.opacity * s.slab;
    this.bracketGroup.visible = s.brackets > 0.002;
    this.borderGroup.visible = s.slab > 0.002;
    this.edgeMat.opacity = s.opacity * Math.max(s.brackets, s.slab);
    this.slab.visible = s.slab > 0.002;
  }

  /**
   * Áp lớp bảo vệ: vị trí, độ lớn và màu từng ô lục giác, độ hiện của chuỗi ký tự. Chỉ là hàm của `v` (không đọc trạng thái trước), nên cuộn ngược
   * về trước chương bảo vệ (`v.fragment = 0`) thì lớp này ẩn hoàn toàn và gói trở lại đúng thẻ dữ liệu.
   */
  applySecure(v: HexVisual): void {
    const on = v.fragment > 0;
    this.secureGroup.visible = on;
    if (!on) return;
    const pose = this.hexScratch;
    this.lattice.cells.forEach((cell, i) => {
      hexPose(this.lattice, cell, v, pose);
      this.hexMatrix.makeScale(pose.scale, pose.scale, pose.scale).setPosition(pose.x, pose.y, pose.z);
      this.hexes.setMatrixAt(i, this.hexMatrix);
      this.hexes.setColorAt(i, this.hexColor.copy(this.baseColors[i]!).lerp(this.cellColor, pose.mix));
    });
    this.hexes.instanceMatrix.needsUpdate = true;
    if (this.hexes.instanceColor) this.hexes.instanceColor.needsUpdate = true;
    this.digestMat.opacity = v.digest * (1 - v.fade);
    this.ruleMat.opacity = 0.75 * v.digest * (1 - v.fade);
  }

  /** Số ô lục giác đang hiện với `v` (kiểm thử: cuối chương chỉ còn đúng tám ô của dải rút gọn). */
  visibleHexCount(v: HexVisual): number {
    if (v.fragment <= 0) return 0;
    return this.lattice.cells.filter((cell) => hexPose(this.lattice, cell, v).scale > 1e-4).length;
  }

  /** Áp vệt bay: `states[k]` là trạng thái cách k bước trước. Chỉ hiện trong pha bay. */
  applyTrail(states: readonly PacketState[], strength: number): void {
    this.trail.forEach((g, k) => {
      const s = states[k];
      const o = s ? strength * s.opacity * (0.12 / (k + 1)) : 0;
      g.visible = o > 0.004;
      if (!s || !g.visible) return;
      g.position.copy(s.position);
      g.quaternion.copy(s.quaternion);
      g.scale.setScalar(s.scale);
      (g.material as MeshBasicMaterial).opacity = o;
    });
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.root.removeFromParent();
    for (const g of this.trail) g.removeFromParent();
  }
}

/** Tư thế dạng số thuần (an toàn để chuyển giữa các cảnh, lưu hoặc ghi log). Quaternion theo thứ tự [x, y, z, w]. */
export interface SerializablePose {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: number;
}

/**
 * Giao diện bàn giao ở cuối chương quan sát. Chương bảo vệ trong cùng cảnh dùng `final` làm điểm xuất phát và dùng lại chính `object`;
 * một khung vẽ khác (nếu sau này cần) có đủ dữ liệu để tiếp nối gói mà không dựng lại hình ảnh từ đầu:
 *  - `final`: tư thế cuối trong hệ toạ độ mét của cảnh quan sát (gốc ở chân người, +Y lên, +Z hướng về người xem).
 *  - `finalScreen`: vị trí cuối trên khung hình (0–1, gốc góc trên-trái của khung cố định), để phần sau đặt gói ở đúng điểm ảnh khi chuyển cảnh.
 *  - `spec`, `snapshot`, `mosaic`: đủ để dựng một `DataPacket` giống hệt (`new DataPacket(snapshot, spec)`).
 *  - `sample(p)`: hàm thuần của cảnh gốc, để phát lại hoặc nối đoạn bay.
 *  - `object`: đối tượng sống, chỉ hợp lệ khi cảnh gốc còn tồn tại (chủ sở hữu huỷ cảnh thì đối tượng cũng bị huỷ).
 */
export interface PacketHandoff {
  readonly version: 1;
  /** Pha hiện tại của gói ở thời điểm lấy bàn giao. */
  readonly phase: PacketPhase;
  /** Tiến trình p của cảnh chủ tại thời điểm lấy. */
  readonly progress: number;
  /** Tư thế hiện tại (đang vẽ) và tư thế cuối của gói. */
  readonly current: SerializablePose;
  readonly final: SerializablePose;
  readonly finalScreen: { x: number; y: number };
  /** `true` khi gói đã tới khay (pha arrived): phần sau có thể tiếp nối ngay. */
  readonly arrived: boolean;
  readonly spec: PacketSpec;
  readonly snapshot: HTMLCanvasElement;
  readonly mosaic: HTMLCanvasElement;
  readonly object: DataPacket;
  sample(p: number): PacketState;
}

export function toSerializable(position: Vector3, quaternion: Quaternion, scale: number): SerializablePose {
  return { position: [position.x, position.y, position.z], quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w], scale };
}
