import {
  BufferGeometry,
  Bone,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  TorusGeometry,
  Uint16BufferAttribute,
  Vector3,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { loftGeometry, shapedLimbGeometry, torsoStripGeometry, torsoSurface, type LimbFold, type LimbStop, type TorsoSection } from "./shapes";
import { buildHead } from "./face";
import { getFigureTextures } from "./textures";
import { CareHand } from "./hand";

/**
 * Người lớn tuổi cho cảnh tình huống, dựng hoàn toàn bằng code (không tài sản ngoài, không giấy phép bên thứ ba): khuôn mặt và tóc bạc (`face.ts`),
 * áo len đan có nẹp khuy, cổ áo và nếp tay áo, quần vải chéo có nếp, giày da có đế, bàn tay có ngón. Khớp xương đơn giản điều khiển bằng góc.
 * Đơn vị mét, mặt hướng +Z, bên trái của người là +X. Tư thế là dữ liệu thuần (`Pose`), áp vào bằng `applyPose`; chiều cao gốc luôn tính lại
 * sao cho điểm thấp nhất của cơ thể chạm sàn (y = 0): không lơ lửng, không xuyên sàn, không phụ thuộc lịch sử.
 */

export const POSE_CHANNELS = [
  "rootX",
  "rootZ",
  "yaw",
  "pitch",
  "roll",
  "spineX",
  "spineZ",
  "chestX",
  "chestY",
  "neckX",
  "neckZ",
  "lShX",
  "lShZ",
  "lElb",
  "rShX",
  "rShZ",
  "rElb",
  "lHipX",
  "lHipZ",
  "lKnee",
  "rHipX",
  "rHipZ",
  "rKnee",
  "lAnk",
  "rAnk",
  // Cổ tay: xoay cẳng tay (sấp/ngửa quanh trục cẳng tay), gập/duỗi và nghiêng quay-trụ.
  "lRoll",
  "rRoll",
  "lWrX",
  "rWrX",
  "lWrZ",
  "rWrZ",
] as const;

export type PoseChannel = (typeof POSE_CHANNELS)[number];
/** Góc tính bằng độ; `rootX`, `rootZ` tính bằng mét. Kênh thiếu = 0. */
export type Pose = Record<PoseChannel, number>;

export function pose(partial: Partial<Pose>): Pose {
  const out = {} as Pose;
  for (const c of POSE_CHANNELS) out[c] = partial[c] ?? 0;
  return out;
}

const D2R = Math.PI / 180;

/** Bảng màu vật liệu hình người: trầm, ấm, không trùng teal nhấn của cảnh. */
const PALETTE = {
  cardigan: "#6b7d89",
  cardiganBand: "#5a6b77",
  shirt: "#e4dfd2",
  trousers: "#3f4953",
  skin: "#d6ad94",
  neck: "#b88f79",
  hair: "#c9cbcc",
  leather: "#2a2522",
  sole: "#15110f",
  button: "#2d2925",
} as const;

/**
 * Hồ sơ thân (m) theo độ cao g, đo trong khung `waist` (y của khung `chest` = g − 0,2). Áo len là MỘT mặt liền từ gấu tới cổ, gắn vào ba xương
 * (hông, thắt lưng, ngực) bằng trọng số theo độ cao: vạt dưới bám hông, thân trên bám ngực, đoạn giữa chuyển dần. Nhờ vậy khi cúi, nghiêng, xoay
 * áo uốn liền mạch (không có mối nối cứng, không để hở hay xuyên hông), và pháp tuyến đổi dần nên ánh sáng không bị chia thành các khối.
 */
const TORSO_SECTIONS: readonly TorsoSection[] = [
  { y: -0.195, rx: 0.17, rzF: 0.113, rzB: 0.111, n: 2.4 },
  { y: -0.17, rx: 0.166, rzF: 0.114, rzB: 0.112, n: 2.4 },
  { y: -0.1, rx: 0.159, rzF: 0.108, rzB: 0.108, n: 2.3 },
  { y: 0.0, rx: 0.149, rzF: 0.098, rzB: 0.1, n: 2.2 },
  { y: 0.1, rx: 0.145, rzF: 0.094, rzB: 0.098, n: 2.2 },
  { y: 0.21, rx: 0.152, rzF: 0.098, rzB: 0.102, n: 2.2 },
  { y: 0.27, rx: 0.16, rzF: 0.106, rzB: 0.108, n: 2.25 },
  { y: 0.33, rx: 0.17, rzF: 0.114, rzB: 0.112, n: 2.3 },
  { y: 0.38, rx: 0.182, rzF: 0.108, rzB: 0.112, n: 2.5 },
  { y: 0.415, rx: 0.164, rzF: 0.088, rzB: 0.104, cz: -0.005, n: 2.5 },
  { y: 0.44, rx: 0.1, rzF: 0.066, rzB: 0.09, cz: -0.01, n: 2.2 },
  { y: 0.458, rx: 0.054, rzF: 0.052, rzB: 0.062, cz: -0.008, n: 2 },
];
/** Gấu áo bo gân: dải mỏng hơi phình ra ở mép dưới. */
const HEM_SECTIONS: readonly TorsoSection[] = [
  { y: -0.197, rx: 0.172, rzF: 0.115, rzB: 0.113, n: 2.4 },
  { y: -0.17, rx: 0.1695, rzF: 0.1165, rzB: 0.1145, n: 2.4 },
  { y: -0.145, rx: 0.1635, rzF: 0.1105, rzB: 0.1105, n: 2.35 },
];
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Trọng số bám xương theo độ cao g: [hông, thắt lưng, ngực]. */
function torsoWeights(g: number): [number, number, number] {
  const hip = 1 - sstep(-0.06, 0.04, g);
  const chest = sstep(0.16, 0.24, g);
  return [hip, 1 - hip - chest, chest];
}
/** Gắn chỉ số xương và trọng số cho hình học có đỉnh nằm trong khung `waist` (y = g). */
function skinByHeight(geo: BufferGeometry): BufferGeometry {
  const pos = geo.getAttribute("position");
  const idx = new Uint16Array(pos.count * 4);
  const wgt = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const [a, b, c] = torsoWeights(pos.getY(i));
    idx.set([0, 1, 2, 0], i * 4);
    wgt.set([a, b, c, 0], i * 4);
  }
  geo.setAttribute("skinIndex", new Uint16BufferAttribute(idx, 4));
  geo.setAttribute("skinWeight", new Float32BufferAttribute(wgt, 4));
  return geo;
}

/** Hồ sơ bán kính và nếp vải của tay áo, ống quần (m). */
const UPPER_ARM: readonly LimbStop[] = [
  { t: 0, r: 0.052 },
  { t: 0.5, r: 0.0475 },
  { t: 1, r: 0.0415 },
];
const UPPER_ARM_FOLDS: readonly LimbFold[] = [{ t: 0.9, amp: 0.05, w: 0.05 }];
const FOREARM: readonly LimbStop[] = [
  { t: 0, r: 0.0405 },
  { t: 0.35, r: 0.0395 },
  { t: 1, r: 0.0325 },
];
const FOREARM_FOLDS: readonly LimbFold[] = [
  { t: 0.05, amp: 0.06, w: 0.045 },
  { t: 0.17, amp: 0.045, w: 0.04 },
];
const THIGH: readonly LimbStop[] = [
  { t: 0, r: 0.077 },
  { t: 0.35, r: 0.071 },
  { t: 1, r: 0.056 },
];
const THIGH_FOLDS: readonly LimbFold[] = [{ t: 0.06, amp: 0.04, w: 0.05 }];
const SHIN: readonly LimbStop[] = [
  { t: 0, r: 0.0545 },
  { t: 0.28, r: 0.0525 },
  { t: 0.55, r: 0.0435 },
  { t: 1, r: 0.0395 },
];
const SHIN_FOLDS: readonly LimbFold[] = [
  { t: 0.04, amp: 0.05, w: 0.035 },
  { t: 0.12, amp: 0.035, w: 0.03 },
  { t: 0.94, amp: 0.045, w: 0.03 },
];

interface Probe {
  bone: Object3D;
  local: Vector3;
  radius: number;
}

/** Nhân toạ độ UV của hình học (để hoa văn vải có cỡ mắt đúng thực tế trên từng bộ phận). */
function scaleUV(geo: BufferGeometry, ku: number, kv: number): BufferGeometry {
  const uv = geo.getAttribute("uv");
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ku, uv.getY(i) * kv);
  return geo;
}

export class CareFigure {
  readonly root = new Group();
  /** Điểm gắn thiết bị trên ngực (mặt trước áo), theo khung xương ngực. */
  readonly chestMount = new Object3D();
  /** Xương hông (cùng gốc với `waist` khi đứng thẳng, không xoay theo cột sống), thắt lưng và ngực: ba xương mà áo len bám vào. */
  private readonly hip = new Bone();
  private readonly waist = new Bone();
  private readonly chest = new Bone();
  private skeleton: Skeleton | null = null;
  private readonly neck = new Object3D();
  private readonly lSh = new Object3D();
  private readonly rSh = new Object3D();
  private readonly lElb = new Object3D();
  private readonly rElb = new Object3D();
  private readonly lHip = new Object3D();
  private readonly rHip = new Object3D();
  private readonly lKnee = new Object3D();
  private readonly rKnee = new Object3D();
  private readonly lAnk = new Object3D();
  private readonly rAnk = new Object3D();
  private readonly probes: Probe[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly scratch = new Vector3();
  private disposeHead: (() => void) | null = null;

  readonly hands: { left: CareHand | null; right: CareHand | null } = { left: null, right: null };
  private readonly lWrist = new Object3D();
  private readonly rWrist = new Object3D();

  /** `detailedHands`: bàn tay có ngón (cho cảnh cận cảnh); mặc định là bàn tay dạng găng nhẹ. */
  constructor(options: { detailedHands?: boolean; lite?: boolean } = {}) {
    this.root.name = "care-figure";
    const tex = getFigureTextures();
    const mat = (color: string, roughness: number, extra: { knit?: boolean; twill?: boolean; normalScale?: number } = {}) => {
      const m = new MeshStandardMaterial({ color: new Color(color), roughness, metalness: 0, envMapIntensity: 0.55 });
      const maps = extra.knit ? tex?.knit : extra.twill ? tex?.twill : undefined;
      if (maps) {
        m.map = maps.map;
        m.normalMap = maps.normalMap;
        m.normalScale.setScalar(extra.normalScale ?? 0.8);
      }
      this.materials.push(m);
      return m;
    };
    const cardigan = mat(PALETTE.cardigan, 0.92, { knit: true, normalScale: 0.85 });
    const band = mat(PALETTE.cardiganBand, 0.94, { knit: true, normalScale: 1.1 });
    const shirt = mat(PALETTE.shirt, 0.86);
    const trousers = mat(PALETTE.trousers, 0.86, { twill: true, normalScale: 0.7 });
    const skinMat = (color: string) => {
      const m = new MeshPhysicalMaterial({ color: new Color(color), roughness: 0.58, metalness: 0, sheen: 0.3, sheenRoughness: 0.6, sheenColor: new Color("#e6c3b3"), envMapIntensity: 0.5 });
      this.materials.push(m);
      return m;
    };
    const skin = skinMat(PALETTE.skin);
    const neckSkin = skinMat(PALETTE.neck);
    const leather = new MeshPhysicalMaterial({ color: new Color(PALETTE.leather), roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.7 });
    const sole = mat(PALETTE.sole, 0.82);
    const lace = mat("#3b352f", 0.6);
    const button = new MeshPhysicalMaterial({ color: new Color(PALETTE.button), roughness: 0.34, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 0.8 });
    this.materials.push(leather, button);

    const add = (parent: Object3D, geo: BufferGeometry, material: Material, place?: (m: Mesh) => void) => {
      this.geometries.push(geo);
      const m = new Mesh(geo, material);
      m.castShadow = true;
      m.receiveShadow = true;
      place?.(m);
      parent.add(m);
      return m;
    };
    const probe = (bone: Object3D, x: number, y: number, z: number, radius = 0) => this.probes.push({ bone, local: new Vector3(x, y, z), radius });

    // Khung xương (vị trí nghỉ, gốc = tâm hông). Tổng chiều cao khoảng 1,68 m.
    const r = this.root;
    r.add(this.waist, this.hip);
    this.waist.position.set(0, 0.06, 0);
    this.hip.position.set(0, 0.06, 0);
    this.waist.add(this.chest);
    this.chest.position.set(0, 0.2, 0);
    this.chest.add(this.neck);
    this.neck.position.set(0, 0.24, 0);
    for (const [sh, side] of [
      [this.lSh, 1],
      [this.rSh, -1],
    ] as const) {
      this.chest.add(sh);
      sh.position.set(0.162 * side, 0.172, 0);
    }
    this.lSh.add(this.lElb);
    this.rSh.add(this.rElb);
    this.lElb.position.set(0, -0.27, 0);
    this.rElb.position.set(0, -0.27, 0);
    for (const [hip, side] of [
      [this.lHip, 1],
      [this.rHip, -1],
    ] as const) {
      r.add(hip);
      hip.position.set(0.09 * side, -0.04, 0);
    }
    this.lHip.add(this.lKnee);
    this.rHip.add(this.rKnee);
    this.lKnee.position.set(0, -0.42, 0);
    this.rKnee.position.set(0, -0.42, 0);
    this.lKnee.add(this.lAnk);
    this.rKnee.add(this.rAnk);
    this.lAnk.position.set(0, -0.4, 0);
    this.rAnk.position.set(0, -0.4, 0);

    // Hông: phần quần lộ dưới vạt áo.
    add(r, scaleUV(new SphereGeometry(1, 32, 20), 6, 3), trousers, (m) => {
      m.scale.set(0.158, 0.12, 0.098);
      m.position.y = -0.03;
    });

    // Áo len dài: một mặt liền bám ba xương; hoa văn len đan có cỡ mắt đều nhờ UV theo độ cao thật. Gấu bo gân, nẹp khuy và khuy cùng bám xương.
    const skinned = (geo: BufferGeometry, material: Material): SkinnedMesh => {
      this.geometries.push(geo);
      const m = new SkinnedMesh(skinByHeight(geo), material);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.position.set(0, 0.06, 0);
      r.add(m);
      return m;
    };
    const KNIT_U = 11;
    const KNIT_V = 14.5; // số lần lặp trên mỗi mét chiều cao
    const bodies: SkinnedMesh[] = [];
    bodies.push(skinned(scaleUV(loftGeometry(TORSO_SECTIONS, 56, 3), KNIT_U, KNIT_V * 0.653), cardigan));
    bodies.push(skinned(scaleUV(loftGeometry(HEM_SECTIONS, 56, 1), 14, 1.2), band));
    // Nẹp khuy: dải gân chạy dọc từ gấu tới cổ; khuy sừng đặt tránh chỗ thiết bị (y 0,0975–0,1625 trên ngực, tức g 0,2975–0,3625).
    bodies.push(skinned(scaleUV(torsoStripGeometry(TORSO_SECTIONS, -0.19, 0.438, 0, 0.08, 0.0016, 72), 1.2, 15), band));
    for (const g of [0.415, 0.25, 0.1, -0.07, -0.14]) {
      const surf = torsoSurface(TORSO_SECTIONS, g);
      const geo = new SphereGeometry(0.0054, 16, 10);
      geo.scale(1, 1, 0.42);
      geo.translate(0, g, surf.z + 0.0021);
      bodies.push(skinned(geo, button));
    }

    // Cổ áo: vòng gân quanh gốc cổ, áo sơ mi kem ló lên phía trên.
    add(this.chest, scaleUV(new TorusGeometry(0.0555, 0.0125, 14, 44), 5, 1.2), band, (m) => {
      m.rotation.x = Math.PI / 2;
      m.scale.set(1, 0.9, 1);
      m.position.set(0, 0.249, 0.006);
    });
    add(this.chest, new TorusGeometry(0.0495, 0.0052, 12, 44), shirt, (m) => {
      m.rotation.x = Math.PI / 2;
      m.scale.set(1, 0.9, 1);
      m.position.set(0, 0.2635, 0.006);
    });

    // Vai tròn dạng áo len, cổ, đầu có mặt và tóc bạc.
    for (const sh of [this.lSh, this.rSh]) {
      add(sh, scaleUV(new SphereGeometry(1, 28, 18), 3, 2), cardigan, (m) => m.scale.set(0.052, 0.05, 0.052));
    }
    // Cổ đi lên từ gốc cổ: lật chi (vốn chạy dọc −Y).
    add(
      this.neck,
      shapedLimbGeometry(
        0.15,
        [
          { t: 0, r: 0.0435 },
          { t: 0.55, r: 0.0405 },
          { t: 1, r: 0.0455 },
        ],
        [],
        28,
        10,
      ),
      neckSkin,
      (m) => {
        m.rotation.x = Math.PI;
        m.position.y = -0.005;
      },
    );
    const head = new Object3D();
    head.position.set(0, 0.138, 0.012);
    this.neck.add(head);
    const built = buildHead({ skin: PALETTE.skin, hair: PALETTE.hair, textures: tex, lite: options.lite });
    head.add(built.group);
    this.disposeHead = built.dispose;

    // Tay: tay áo len dài tới cổ tay có nếp ở khuỷu, bo gân ở cổ tay; áo sơ mi ló ra một chút.
    for (const [sh, elb, hand, side] of [
      [this.lSh, this.lElb, this.lWrist, 1],
      [this.rSh, this.rElb, this.rWrist, -1],
    ] as const) {
      add(sh, scaleUV(shapedLimbGeometry(0.27, UPPER_ARM, UPPER_ARM_FOLDS), 5, 4), cardigan);
      add(elb, scaleUV(shapedLimbGeometry(0.235, FOREARM, FOREARM_FOLDS), 4.5, 3.5), cardigan);
      add(elb, scaleUV(new CylinderGeometry(0.0352, 0.0345, 0.034, 28, 1, false), 4, 0.8), band, (m) => (m.position.y = -0.236));
      add(elb, new CylinderGeometry(0.0318, 0.0318, 0.013, 24, 1, false), shirt, (m) => (m.position.y = -0.258));
      hand.position.set(0, -0.25, 0);
      elb.add(hand);
      if (options.detailedHands) {
        const h = new CareHand(side, skin);
        hand.add(h.root);
        this.hands[side === 1 ? "left" : "right"] = h;
        probe(hand, 0, -0.165, 0, 0.012);
      } else {
        add(hand, new SphereGeometry(1, 18, 14), skin, (m) => {
          m.scale.set(0.03, 0.06, 0.024);
          m.position.set(0, -0.045, 0.004);
        });
      }
      probe(sh, 0, 0, 0, 0.052);
      probe(elb, 0, 0, 0, 0.04);
      probe(hand, 0, -0.045, 0, 0.032);
      probe(hand, 0, -0.1, 0, 0.012);
    }

    // Chân: quần vải chéo có nếp ở háng, đầu gối và gấu; giày da có đế riêng, mũi bo tròn hướng +Z.
    for (const [hip, knee, ank] of [
      [this.lHip, this.lKnee, this.lAnk],
      [this.rHip, this.rKnee, this.rAnk],
    ] as const) {
      add(hip, scaleUV(shapedLimbGeometry(0.42, THIGH, THIGH_FOLDS, 32), 6, 5), trousers);
      add(knee, scaleUV(shapedLimbGeometry(0.39, SHIN, SHIN_FOLDS, 32), 5, 5), trousers);
      add(ank, new RoundedBoxGeometry(0.082, 0.058, 0.2, 4, 0.024), leather, (m) => m.position.set(0, -0.022, 0.044));
      add(ank, new SphereGeometry(1, 24, 16), leather, (m) => {
        m.scale.set(0.0415, 0.031, 0.066);
        m.position.set(0, -0.0315, 0.104);
      });
      add(ank, new SphereGeometry(1, 28, 12), sole, (m) => {
        m.scale.set(0.0455, 0.0105, 0.1215);
        m.position.set(0, -0.0565, 0.0525);
      });
      add(ank, new RoundedBoxGeometry(0.034, 0.008, 0.07, 2, 0.003), lace, (m) => {
        m.position.set(0, 0.0, 0.058);
        m.rotation.x = -0.33;
      });
      probe(knee, 0, 0, 0, 0.052);
      probe(ank, 0, 0, 0, 0.038);
      for (const x of [-0.046, 0.046]) {
        probe(ank, x, -0.067, -0.069);
        probe(ank, x, -0.067, 0.165);
      }
      probe(ank, 0, -0.03, 0.165, 0.035);
    }

    // Điểm dò trên thân để tính chạm sàn khi nằm: bề mặt hông, bụng, ngực, vai, đầu.
    for (const x of [-0.165, 0.165]) probe(r, x, 0, 0);
    for (const z of [-0.112, 0.112]) probe(r, 0, 0, z);
    probe(r, 0, -0.12, 0);
    for (const x of [-0.162, 0.162]) probe(this.hip, x, -0.17, 0);
    for (const z of [-0.114, 0.114]) probe(this.hip, 0, -0.17, z);
    for (const [bone, rad, y] of [
      [this.waist, 0.14, 0.08],
      [this.chest, 0.165, 0.12],
    ] as const) {
      for (const x of [-rad, rad]) probe(bone, x, y, 0);
      for (const z of [-rad * 0.69, rad * 0.69]) probe(bone, 0, y, z);
    }
    probe(head, 0, 0, -0.003, 0.094);

    // Thiết bị kẹp giữa ngực, mặt sau áp vào áo (vỏ dày 32 mm, nên tâm cách mặt áo 16 mm).
    this.chestMount.position.set(0, 0.13, torsoSurface(TORSO_SECTIONS, 0.33).z + 0.0016 + 0.016);
    this.chest.add(this.chestMount);
    probe(this.chestMount, 0, 0, 0.018);

    // Ràng áo len vào ba xương ở tư thế nghỉ: ma trận nghịch đảo của xương tính từ đây.
    r.updateMatrixWorld(true);
    this.skeleton = new Skeleton([this.hip, this.waist, this.chest]);
    for (const m of bodies) m.bind(this.skeleton, m.matrixWorld);
  }

  /** Áp tư thế. Hoàn toàn xác định theo `p`: không cộng dồn, không nhớ khung trước. */
  applyPose(p: Pose): void {
    const r = this.root;
    r.rotation.set(p.pitch * D2R, p.yaw * D2R, p.roll * D2R, "YXZ");
    r.position.set(p.rootX, 0, p.rootZ);
    this.waist.rotation.set(p.spineX * D2R, 0, p.spineZ * D2R);
    this.chest.rotation.set(p.chestX * D2R, p.chestY * D2R, 0);
    this.neck.rotation.set(p.neckX * D2R, 0, p.neckZ * D2R);
    this.lSh.rotation.set(p.lShX * D2R, 0, p.lShZ * D2R);
    this.rSh.rotation.set(p.rShX * D2R, 0, -p.rShZ * D2R);
    this.lElb.rotation.set(p.lElb * D2R, 0, 0);
    this.rElb.rotation.set(p.rElb * D2R, 0, 0);
    this.lWrist.rotation.set(p.lWrX * D2R, p.lRoll * D2R, p.lWrZ * D2R, "YXZ");
    this.rWrist.rotation.set(p.rWrX * D2R, -p.rRoll * D2R, -p.rWrZ * D2R, "YXZ");
    this.lHip.rotation.set(p.lHipX * D2R, 0, p.lHipZ * D2R);
    this.rHip.rotation.set(p.rHipX * D2R, 0, -p.rHipZ * D2R);
    this.lKnee.rotation.set(p.lKnee * D2R, 0, 0);
    this.rKnee.rotation.set(p.rKnee * D2R, 0, 0);
    this.lAnk.rotation.set(p.lAnk * D2R, 0, 0);
    this.rAnk.rotation.set(p.rAnk * D2R, 0, 0);
    r.updateMatrixWorld(true);
    // Đặt người chạm sàn: điểm thấp nhất của cơ thể nằm đúng y = 0.
    r.position.y = -this.lowestPoint();
    r.updateMatrixWorld(true);
  }

  /** Độ cao thấp nhất của bề mặt cơ thể (theo khung cha của gốc), sau lần áp tư thế gần nhất. */
  lowestPoint(): number {
    let min = Infinity;
    const parentInv = this.root.parent ? this.root.parent.matrixWorld.clone().invert() : null;
    for (const pr of this.probes) {
      const v = pr.bone.localToWorld(this.scratch.copy(pr.local));
      if (parentInv) v.applyMatrix4(parentInv);
      min = Math.min(min, v.y - pr.radius);
    }
    return min;
  }

  /** Toạ độ các điểm dò (khung cha của gốc), để kiểm thử không xuyên sàn và không nhảy. */
  probePoints(): Vector3[] {
    const parentInv = this.root.parent ? this.root.parent.matrixWorld.clone().invert() : null;
    return this.probes.map((pr) => {
      const v = pr.bone.localToWorld(new Vector3().copy(pr.local));
      if (parentInv) v.applyMatrix4(parentInv);
      v.y -= pr.radius;
      return v;
    });
  }

  /** Điểm nắm (giữa lòng bàn tay khi nắm vật trụ) của bàn tay có ngón, khung thế giới. Cần `detailedHands`. */
  gripWorld(side: "left" | "right", out = new Vector3()): Vector3 {
    const h = this.hands[side];
    if (!h) throw new Error("Hình người này không có bàn tay chi tiết.");
    return h.grip.getWorldPosition(out);
  }

  /** Vị trí điểm gắn thiết bị (khung thế giới). */
  devicePosition(out = new Vector3()): Vector3 {
    return this.chestMount.getWorldPosition(out);
  }

  dispose(): void {
    this.skeleton?.dispose();
    this.disposeHead?.();
    this.hands.left?.dispose();
    this.hands.right?.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }
}
