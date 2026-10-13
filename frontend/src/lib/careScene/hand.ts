import { BufferGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, Color, type Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { limbGeometry } from "./shapes";

/**
 * Bàn tay người lớn dựng bằng code (đơn vị mét, dài cổ tay → đầu ngón giữa khoảng 18 cm): lòng bàn thuôn về phía cổ tay, bốn ngón ba đốt
 * thuôn dần, ngón cái có thể đối chiếu, móng tay mờ. Không có tài sản ngoài nên không có giấy phép bên thứ ba.
 *
 * Khung cục bộ (tay trái, buông thõng): ngón chỉ xuống −Y, lòng bàn tay hướng −X (vào thân), ngón cái ở +Z (phía trước), mu bàn tay +X.
 * Tay phải là bản phản chiếu qua mặt phẳng x = 0 (scale.x = −1); vì vậy mọi toạ độ ngoài khung này đều đối xứng khi đổi bên.
 * Tư thế là hàm thuần của `HandGrip`: cùng tham số luôn cho cùng hình dạng, không nhớ khung trước.
 */

export interface HandGrip {
  /** 0 = duỗi thả lỏng, 1 = nắm quanh vật trụ bán kính ~3,3 cm (ly nước). */
  curl: number;
  /** 0–1: mở rộng các ngón sang hai bên. */
  spread: number;
  /** 0–1: ngón cái khép vào đối diện các ngón (0 = để thả lỏng bên cạnh bàn tay). */
  thumb: number;
}

export const RELAXED_GRIP: Readonly<HandGrip> = { curl: 0.22, spread: 0.1, thumb: 0.15 };

interface FingerSpec {
  z: number;
  len: readonly [number, number, number];
  r: readonly [number, number, number];
  /** Hệ số gập riêng cho từng ngón (ngón út và áp út gập hơn). */
  curl: number;
  splay: number;
}

const KNUCKLE_Y = -0.092;
const FINGERS: readonly FingerSpec[] = [
  { z: 0.031, len: [0.043, 0.026, 0.021], r: [0.0094, 0.0084, 0.0074], curl: 0.92, splay: 0.06 },
  { z: 0.0105, len: [0.047, 0.029, 0.022], r: [0.0096, 0.0086, 0.0076], curl: 1, splay: 0 },
  { z: -0.0105, len: [0.043, 0.027, 0.021], r: [0.009, 0.008, 0.007], curl: 1.06, splay: -0.045 },
  { z: -0.03, len: [0.034, 0.02, 0.018], r: [0.008, 0.007, 0.0062], curl: 1.12, splay: -0.1 },
];
/** Góc gập tại curl = 1 (rad): đốt gần, đốt giữa, đốt xa. */
const CURL = [1.18, 1.32, 0.82] as const;

interface FingerRig {
  spec: FingerSpec;
  joints: [Object3D, Object3D, Object3D];
}

export class CareHand {
  readonly root = new Group();
  /** Điểm giữa lòng bàn tay khi nắm một vật trụ: tâm trục vật nằm ở đây (khung của bàn tay, đã phản chiếu theo bên). */
  readonly grip = new Object3D();
  private readonly fingers: FingerRig[] = [];
  private readonly thumbJoints: [Object3D, Object3D, Object3D] = [new Object3D(), new Object3D(), new Object3D()];
  private readonly geometries: BufferGeometry[] = [];
  private readonly ownMaterials: Material[] = [];
  private lastKey = "";

  /** `side` = 1 cho tay trái (x > 0), −1 cho tay phải. */
  constructor(
    private readonly side: 1 | -1,
    skin: Material,
  ) {
    const nail = new MeshStandardMaterial({ color: new Color("#e6c9b8"), roughness: 0.38, metalness: 0, envMapIntensity: 0.7 });
    this.ownMaterials.push(nail);
    const mesh = (geo: BufferGeometry, mat: Material, parent: Object3D, place?: (m: Mesh) => void) => {
      this.geometries.push(geo);
      const m = new Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      place?.(m);
      parent.add(m);
      return m;
    };

    this.root.name = "care-hand";
    if (side === -1) this.root.scale.x = -1;

    // Lòng bàn tay: hộp bo thuôn dần về phía cổ tay (rộng 6,2 → 8,6 cm), dày 2,8 cm.
    const palm = new RoundedBoxGeometry(0.028, 0.098, 0.086, 5, 0.011);
    const pos = palm.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + 0.049) / 0.098; // 0 ở đầu cổ tay (y thấp = xa cổ tay)
      const k = 0.72 + 0.28 * (1 - t);
      pos.setZ(i, pos.getZ(i) * k);
      pos.setX(i, pos.getX(i) * (0.9 + 0.1 * (1 - t)));
    }
    palm.computeVertexNormals();
    mesh(palm, skin, this.root, (m) => m.position.set(0, -0.049, 0.0));
    // Cổ tay: nối liền với tay áo.
    mesh(limbGeometry(0.02, 0.029, 0.031), skin, this.root, (m) => (m.position.y = 0.006));
    // Mô cơ gốc ngón cái (thenar): khối tròn ở phía ngón cái.
    mesh(new SphereGeometry(0.02, 20, 14), skin, this.root, (m) => {
      m.scale.set(0.8, 1.35, 1);
      m.position.set(-0.012, -0.036, 0.03);
    });

    for (const spec of FINGERS) {
      const base = new Object3D();
      base.position.set(-0.002, KNUCKLE_Y, spec.z);
      this.root.add(base);
      const j1 = base;
      const j2 = new Object3D();
      const j3 = new Object3D();
      j2.position.y = -spec.len[0];
      j3.position.y = -spec.len[1];
      mesh(limbGeometry(spec.len[0], spec.r[0], spec.r[1]), skin, j1);
      j1.add(j2);
      mesh(limbGeometry(spec.len[1], spec.r[1], spec.r[2]), skin, j2);
      j2.add(j3);
      mesh(limbGeometry(spec.len[2], spec.r[2], spec.r[2] * 0.92), skin, j3);
      // Móng: tấm elip dẹt trên mu ngón (phía +X), gần đầu ngón.
      mesh(new SphereGeometry(1, 14, 10), nail, j3, (m) => {
        m.scale.set(0.0016, spec.len[2] * 0.33, spec.r[2] * 0.62);
        m.position.set(spec.r[2] * 0.82, -spec.len[2] * 0.62, 0);
      });
      this.fingers.push({ spec, joints: [j1, j2, j3] });
    }

    // Ngón cái: gốc ở khớp cổ-bàn tay, xương bàn tay chếch ra trước và xuống.
    const [t1, t2, t3] = this.thumbJoints;
    t1.position.set(-0.01, -0.03, 0.034);
    this.root.add(t1);
    mesh(limbGeometry(0.047, 0.0135, 0.0112), skin, t1);
    t2.position.y = -0.047;
    t1.add(t2);
    mesh(limbGeometry(0.034, 0.0112, 0.0098), skin, t2);
    t3.position.y = -0.034;
    t2.add(t3);
    mesh(limbGeometry(0.028, 0.0098, 0.0088), skin, t3);
    mesh(new SphereGeometry(1, 14, 10), nail, t3, (m) => {
      m.scale.set(0.0017, 0.0095, 0.0068);
      m.position.set(0.0083, -0.0185, 0);
    });

    this.grip.position.set(-0.048, -0.07, 0);
    this.root.add(this.grip);
    this.setGrip(RELAXED_GRIP);
  }

  /** Áp dạng bàn tay. Hàm thuần của tham số; gọi lại với cùng tham số không đổi gì. */
  setGrip(g: HandGrip): void {
    const key = `${g.curl.toFixed(5)}|${g.spread.toFixed(5)}|${g.thumb.toFixed(5)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (const f of this.fingers) {
      // Gập về phía lòng bàn tay (−X): quay quanh +Z theo góc âm. Thả lỏng vẫn hơi cong, ngón nhỏ cong hơn.
      const c = g.curl * f.spec.curl;
      f.joints[0].rotation.set(-f.spec.splay * g.spread * 0.9, 0, -CURL[0] * c);
      f.joints[1].rotation.set(0, 0, -CURL[1] * c);
      f.joints[2].rotation.set(0, 0, -CURL[2] * c);
    }
    const [t1, t2, t3] = this.thumbJoints;
    // Giang ra trước (−X quanh X là kéo xuống +Z), khép dần về lòng bàn tay theo `thumb`.
    t1.rotation.set(-(0.62 - 0.32 * g.thumb) - g.spread * 0.22, 0.0, -(0.18 + 0.78 * g.thumb));
    t2.rotation.set(0, 0, -(0.08 + 0.55 * g.thumb));
    t3.rotation.set(0, 0, -(0.05 + 0.42 * g.thumb));
  }

  get mirrored(): boolean {
    return this.side === -1;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.ownMaterials) m.dispose();
    this.root.removeFromParent();
  }
}
