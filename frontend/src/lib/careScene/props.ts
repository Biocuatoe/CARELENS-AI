import {
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector2,
  type Material,
  type Object3D,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { TEAL_ACCENT } from "../hardware3d/materials";
import { COUNTER_TOP, GLASS, LAYOUT } from "./medicationLayout";

/** Vật dụng của cảnh quan sát hoạt động. Tất cả dựng bằng code: không tài sản ngoài, không giấy phép bên thứ ba. */

export interface PropSet {
  /** Mọi thứ cố định của phòng (sàn, quầy, hộp thuốc, hub, khay). */
  room: Group;
  /** Ly nước: gốc ở tâm thân ly, trục ly dọc +Y cục bộ. Cảnh tự đặt và gắn vào tay. */
  glass: Group;
  /** Đèn trạng thái của hub (0–1), vòng viền khay (0–1). */
  setHubActivity(level: number): void;
  setTrayGlow(level: number): void;
  /** Điểm neo nhãn: tâm hub (cao hơn mặt trên một chút). */
  hubAnchor: Object3D;
  dispose(): void;
}

export function createProps(options: { quality: "full" | "lite" }): PropSet {
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const geo = <G extends BufferGeometry>(g: G) => {
    geometries.push(g);
    return g;
  };
  const mat = <M extends Material>(m: M) => {
    materials.push(m);
    return m;
  };
  const std = (color: string, roughness: number, metalness = 0, env = 0.45) => mat(new MeshStandardMaterial({ color: new Color(color), roughness, metalness, envMapIntensity: env }));
  const mesh = (g: BufferGeometry, m: Material, parent: Object3D, cast = true, receive = true) => {
    const o = new Mesh(g, m);
    o.castShadow = cast;
    o.receiveShadow = receive;
    parent.add(o);
    return o;
  };
  const seg = options.quality === "lite" ? 28 : 48;

  const room = new Group();
  room.name = "medication-room";

  // Sàn tối, tường lùi xa (chìm vào sương mù), quầy bếp. Quầy có mặt đá sáng hơn nên chính là nơi ánh sáng chính rơi xuống.
  const floor = mesh(geo(new PlaneGeometry(40, 40)), std("#15232c", 0.95), room, false);
  floor.rotation.x = -Math.PI / 2;
  const wallMat = mat(new MeshStandardMaterial({ color: new Color("#132430"), emissive: new Color("#0d1a23"), emissiveIntensity: 1, roughness: 1, metalness: 0, envMapIntensity: 0.2 }));
  const wall = mesh(geo(new PlaneGeometry(40, 8)), wallMat, room, false);
  wall.position.set(0, 4, -1.9);

  const c = LAYOUT.counter;
  const cabinet = mesh(geo(new RoundedBoxGeometry(c.width, COUNTER_TOP - 0.04, c.depth - 0.04, 2, 0.01)), std("#1a2b36", 0.7, 0, 0.3), room, true, true);
  cabinet.position.set(c.center.x, (COUNTER_TOP - 0.04) / 2, c.frontZ + (c.depth - 0.04) / 2);
  // Khe tối giữa các cánh tủ (tỉ lệ thật, không chữ).
  for (let i = -3; i <= 3; i++) {
    const gap = mesh(geo(new PlaneGeometry(0.004, COUNTER_TOP - 0.1)), mat(new MeshBasicMaterial({ color: 0x0b1319 })), room, false, false);
    gap.position.set(c.center.x + i * 0.55 + 0.27, (COUNTER_TOP - 0.04) / 2, c.frontZ - 0.0005);
    gap.rotation.y = Math.PI;
  }
  const top = mesh(geo(new RoundedBoxGeometry(c.width + 0.04, 0.04, c.depth + 0.04, 3, 0.012)), std("#6f716f", 0.52, 0, 0.5), room);
  top.position.set(c.center.x, COUNTER_TOP - 0.02, c.frontZ + c.depth / 2);

  // Hộp thuốc (nhựa hổ phách, nắp tháo đặt cạnh, nhãn trống), vài viên thuốc: chỉ là đạo cụ, không nhãn hiệu, không chữ.
  const bottle = new Group();
  bottle.position.copy(LAYOUT.bottle);
  room.add(bottle);
  mesh(geo(new CylinderGeometry(0.026, 0.027, 0.074, seg)), mat(new MeshPhysicalMaterial({ color: new Color("#a2601f"), roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.9 })), bottle).position.y = 0.037;
  const shoulder = geo(
    new LatheGeometry(
      [new Vector2(0.027, 0), new Vector2(0.0275, 0.02), new Vector2(0.021, 0.034), new Vector2(0.0195, 0.04)].map((v) => new Vector2(v.x, v.y)),
      seg,
    ),
  );
  mesh(shoulder, std("#a2601f", 0.3, 0, 0.8), bottle).position.y = 0.074;
  mesh(geo(new CylinderGeometry(0.0272, 0.0272, 0.034, seg, 1, true)), std("#e6e1d3", 0.7, 0, 0.35), bottle).position.y = 0.036;
  const cap = new Group();
  cap.position.copy(LAYOUT.cap);
  room.add(cap);
  mesh(geo(new CylinderGeometry(0.0235, 0.0235, 0.022, seg)), std("#e9e6dc", 0.52, 0, 0.5), cap).position.y = 0.011;
  for (const p of LAYOUT.pills) {
    const pill = mesh(geo(new CapsuleGeometry(0.0042, 0.009, 4, 12)), std("#ecebe3", 0.4, 0, 0.6), room);
    pill.position.copy(p);
    pill.rotation.set(0, 0.7 + p.x * 3, Math.PI / 2);
  }

  // Ly nước: thành thuỷ tinh mỏng, đáy dày, nước hơi xanh có mặt cong. Không dùng transmission (tránh thêm lượt vẽ); phản chiếu nhờ clearcoat.
  const glass = new Group();
  glass.name = "glass-of-water";
  const h = GLASS.height;
  const r1 = GLASS.radiusBottom;
  const r2 = GLASS.radiusTop;
  const wall2 = 0.0022;
  const base = 0.009;
  const outer: Vector2[] = [new Vector2(0.0001, -h / 2), new Vector2(r1 - 0.002, -h / 2), new Vector2(r1, -h / 2 + 0.002), new Vector2(r2, h / 2), new Vector2(r2 - wall2, h / 2), new Vector2(r1 - wall2, -h / 2 + base), new Vector2(0.0001, -h / 2 + base)];
  const glassMat = mat(
    new MeshPhysicalMaterial({
      color: new Color("#dff1f1"),
      roughness: 0.05,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      transparent: true,
      opacity: 0.3,
      envMapIntensity: 1.9,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  const shell = mesh(geo(new LatheGeometry(outer, seg)), glassMat, glass, false, false);
  shell.renderOrder = 4;
  const fill = h * 0.72;
  const wr = (y: number) => r1 - wall2 - 0.0006 + ((r2 - r1) * (y + h / 2 - base)) / (h - base);
  const top0 = -h / 2 + base + fill;
  const waterMat = mat(new MeshPhysicalMaterial({ color: new Color("#a9d4db"), roughness: 0.08, clearcoat: 0.6, transparent: true, opacity: 0.52, envMapIntensity: 1.4, depthWrite: false }));
  const water = mesh(
    geo(new LatheGeometry([new Vector2(0.0001, -h / 2 + base), new Vector2(wr(-h / 2 + base), -h / 2 + base), new Vector2(wr(top0), top0), new Vector2(wr(top0) * 0.9, top0 - 0.0008), new Vector2(0.0001, top0 - 0.0016)], seg)),
    waterMat,
    glass,
    false,
    false,
  );
  water.renderOrder = 3;

  // Hub trong nhà: hộp bo góc màu than, khe thoáng mặt trên, một đèn trạng thái teal (chỉ sáng khi gói tới). Không logo, không cổng, không chữ.
  const hub = new Group();
  hub.position.copy(LAYOUT.hub);
  room.add(hub);
  const hubW = 0.34;
  const hubH = 0.17;
  const hubD = 0.24;
  const body = mesh(geo(new RoundedBoxGeometry(hubW, hubH, hubD, 5, 0.02)), mat(new MeshPhysicalMaterial({ color: new Color("#2b3d48"), roughness: 0.42, metalness: 0.12, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.9 })), hub);
  body.position.y = hubH / 2;
  for (let i = 0; i < 6; i++) {
    const slit = mesh(geo(new RoundedBoxGeometry(0.2, 0.002, 0.008, 1, 0.001)), mat(new MeshBasicMaterial({ color: 0x0d151b })), hub, false, false);
    slit.position.set(0, hubH + 0.0006, -0.075 + i * 0.03);
  }
  // Khe nhận dữ liệu ở mặt hướng người: rãnh tối nằm ngang, ngay trên khay.
  const slot = mesh(geo(new RoundedBoxGeometry(0.2, 0.012, 0.01, 2, 0.004)), mat(new MeshBasicMaterial({ color: 0x081015 })), hub, false, false);
  slot.position.set(-hubW / 2 - 0.0005, 0.04, 0);
  slot.rotation.y = Math.PI / 2;
  const ledMat = mat(new MeshBasicMaterial({ color: new Color(TEAL_ACCENT), transparent: true, opacity: 0.12, toneMapped: false }));
  const led = mesh(geo(new CylinderGeometry(0.007, 0.007, 0.002, 24)), ledMat, hub, false, false);
  led.position.set(0, hubH + 0.0008, 0.09);
  const hubAnchor = new Group();
  hubAnchor.position.set(0, hubH + 0.06, 0);
  hub.add(hubAnchor);

  // Khay nhận: tấm phẳng bo góc trước hub, viền teal mảnh phát sáng nhẹ khi gói đã tới.
  const trayGroup = new Group();
  trayGroup.position.copy(LAYOUT.tray);
  room.add(trayGroup);
  const tw = 0.2;
  const td = 0.15;
  mesh(geo(new RoundedBoxGeometry(tw, 0.008, td, 3, 0.003)), std("#1b2b35", 0.5, 0.1, 0.6), trayGroup).position.y = 0.004;
  const trayEdge = mat(new MeshBasicMaterial({ color: new Color(TEAL_ACCENT), transparent: true, opacity: 0.18, toneMapped: false, depthWrite: false }));
  const eb = (w: number, d: number, x: number, z: number) => {
    const m = mesh(geo(new PlaneGeometry(w, d)), trayEdge, trayGroup, false, false);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.0088, z);
  };
  eb(tw, 0.0018, 0, td / 2 - 0.0009);
  eb(tw, 0.0018, 0, -td / 2 + 0.0009);
  eb(0.0018, td, tw / 2 - 0.0009, 0);
  eb(0.0018, td, -tw / 2 + 0.0009, 0);

  return {
    room,
    glass,
    hubAnchor,
    setHubActivity(level) {
      ledMat.opacity = 0.12 + 0.88 * Math.min(1, Math.max(0, level));
    },
    setTrayGlow(level) {
      trayEdge.opacity = 0.18 + 0.8 * Math.min(1, Math.max(0, level));
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      room.removeFromParent();
    },
  };
}
