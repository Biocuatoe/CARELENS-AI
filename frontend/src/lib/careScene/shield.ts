import {
  CanvasTexture,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { TEAL_ACCENT } from "../hardware3d/materials";
import { SHIELD } from "./securityTimeline";

/**
 * Tấm khiên của chương bảo vệ: viền kim loại tối bo cạnh, mặt trong sẫm như kính khói, một đường teal mảnh ở mép trong và một quầng sáng rất nhẹ
 * phía sau để tách khỏi nền. Không chữ, không biểu tượng ổ khoá, không xoay, không hạt. Dựng bằng code, không tài sản ngoài.
 */

export interface ShieldSet {
  group: Group;
  /** Điểm neo nhãn: ngay trên đỉnh khiên. */
  anchor: Object3D;
  set(state: { opacity: number; glow: number; rise: number }): void;
  dispose(): void;
}

/** Đường viền khiên: đỉnh hơi vồng, hai vai, hai cạnh thẳng rồi thu về mũi nhọn phía dưới. Tâm hình ở gốc toạ độ. */
function outline(w: number, h: number): Shape {
  const s = new Shape();
  s.moveTo(0, h * 0.5);
  s.quadraticCurveTo(w * 0.3, h * 0.5, w * 0.5, h * 0.4);
  s.lineTo(w * 0.5, h * 0.04);
  s.bezierCurveTo(w * 0.5, -h * 0.2, w * 0.27, -h * 0.4, 0, -h * 0.5);
  s.bezierCurveTo(-w * 0.27, -h * 0.4, -w * 0.5, -h * 0.2, -w * 0.5, h * 0.04);
  s.lineTo(-w * 0.5, h * 0.4);
  s.quadraticCurveTo(-w * 0.3, h * 0.5, 0, h * 0.5);
  return s;
}

/** Cùng đường viền thu nhỏ quanh một tâm hơi cao hơn, để viền dưới (mũi nhọn) không dày hơn hai cạnh quá nhiều. */
function inset(w: number, h: number, k: number): Shape {
  const s = outline(w * k, h * k);
  const lift = h * (1 - k) * 0.12;
  const pts = s.getPoints(32).map((v) => v.setY(v.y + lift));
  return new Shape(pts);
}

export function createShield(): ShieldSet {
  const { width: w, height: h, depth } = SHIELD;
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const textures: Texture[] = [];
  const geo = <G extends BufferGeometry>(g: G) => (geometries.push(g), g);
  const mat = <M extends Material>(m: M) => (materials.push(m), m);

  const group = new Group();
  group.name = "security-shield";
  group.position.copy(SHIELD.center);

  // Viền: khối đùn có lỗ ở giữa, cạnh vát nhẹ.
  const rimShape = outline(w, h);
  rimShape.holes.push(inset(w, h, 0.86));
  const rimGeo = geo(new ExtrudeGeometry(rimShape, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 32 }));
  rimGeo.translate(0, 0, -depth / 2);
  const rimMat = mat(
    new MeshPhysicalMaterial({ color: new Color("#2a3c47"), roughness: 0.34, metalness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 1.1, transparent: true, opacity: 0, fog: false }),
  );
  const rim = new Mesh(rimGeo, rimMat);
  group.add(rim);

  // Mặt trong: sẫm, gần như đục, để các ô lục giác và chuỗi ký tự nổi rõ.
  const panelMat = mat(new MeshBasicMaterial({ color: new Color("#0c1820"), transparent: true, opacity: 0, fog: false, depthWrite: false, side: DoubleSide }));
  const panel = new Mesh(geo(new ShapeGeometry(inset(w, h, 0.865), 32)), panelMat);
  panel.position.z = -0.004;
  panel.renderOrder = 1;
  group.add(panel);

  // Đường teal mảnh ở mép trong.
  const lineShape = inset(w, h, 0.858);
  lineShape.holes.push(inset(w, h, 0.85));
  const lineMat = mat(new MeshBasicMaterial({ color: new Color(TEAL_ACCENT), transparent: true, opacity: 0, toneMapped: false, fog: false, depthWrite: false }));
  const line = new Mesh(geo(new ShapeGeometry(lineShape, 32)), lineMat);
  line.position.z = -0.0035;
  line.renderOrder = 2;
  group.add(line);

  // Quầng sáng phía sau: gradient tròn rất nhạt (không phải hạt hay tia).
  let haloMat: MeshBasicMaterial | null = null;
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = canvas?.getContext("2d") ?? null;
  if (canvas && ctx) {
    canvas.width = 128;
    canvas.height = 128;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(85,185,168,0.55)");
    g.addColorStop(0.45, "rgba(85,185,168,0.16)");
    g.addColorStop(1, "rgba(85,185,168,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    haloMat = mat(new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, toneMapped: false, fog: false, depthWrite: false }));
    const halo = new Mesh(geo(new PlaneGeometry(w * 2.4, h * 2.1)), haloMat);
    halo.position.z = -0.06;
    halo.renderOrder = 0;
    group.add(halo);
    textures.push(tex);
  }

  const anchor = new Group();
  anchor.position.set(0, h / 2 + 0.05, 0);
  group.add(anchor);
  group.visible = false;

  return {
    group,
    anchor,
    set({ opacity, glow, rise }) {
      group.visible = opacity > 0.002;
      group.position.y = SHIELD.center.y - 0.05 * (1 - rise);
      rimMat.opacity = opacity;
      panelMat.opacity = 0.88 * opacity;
      lineMat.opacity = opacity * Math.min(1, Math.max(0, glow));
      if (haloMat) haloMat.opacity = opacity * (0.35 + 0.3 * glow);
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      group.removeFromParent();
    },
  };
}
