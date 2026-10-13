import {
  CylinderGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  SpotLight,
  Vector3,
  WebGLRenderTarget,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { ContactShadow } from "../hardware3d/contactShadow";
import { TEAL_ACCENT } from "../hardware3d/materials";
import { loadDeviceModel, type DeviceModel } from "./deviceModel";
import { ScrollScene, type SceneMode } from "./scrollScene";
import { CareFigure } from "./figure";
import { createFallTimeline, type FallFrame, type FallLayout, type FallTimeline } from "./fallTimeline";
import { FALL_STEPS, stepAt, type FallStepIndex } from "./steps";

/**
 * Cảnh tình huống 01: một người lớn tuổi trong phòng khách tối, đứng dưới quầng sáng ấm, mất thăng bằng và ngã; thiết bị CareLens trên ngực
 * ghi nhận thay đổi (một vòng teal, một lần), rồi khung lùi ra chừa chỗ cho thông báo văn bản. Mọi chuyển động là hàm thuần của tiến trình
 * cuộn đã làm mượt (`fallTimeline.ts`). Vẽ theo yêu cầu: hội tụ xong thì dừng hẳn, ra khỏi màn hình thì tạm dừng.
 * Thiết bị dùng đúng hai file STL vỏ của dự án, tỉ lệ thật (43 × 32 × 65 mm).
 */

export type { SceneMode as FallSceneMode } from "./scrollScene";

export interface FallSceneFrame {
  progress: number;
  target: number;
  step: FallStepIndex;
  card: number;
  vignette: number;
  settled: boolean;
}

export interface FallSceneOptions {
  mode: SceneMode;
  layout: FallLayout;
  onFrame?: (frame: FallSceneFrame) => void;
}

/** Vùng (px, tính từ mép khung) bị lớp giao diện chiếm: thẻ thông báo bên phải hoặc dưới đáy, bảng bước ở trên cùng. */
export interface FallSceneInsets {
  cardRight: number;
  cardBottom: number;
  panelTop: number;
}

export interface FallSceneSample {
  /** Tỉ lệ điểm ảnh có người hoặc thiết bị (không tính phòng). */
  coverage: number;
  distinctColors: number;
  /** Hộp bao của người trên khung hình, tỉ lệ 0–1 (y tính từ trên xuống). */
  bbox: { left: number; right: number; top: number; bottom: number } | null;
}

/** Tỉ lệ khung tham chiếu của các khoá camera; khung hẹp hơn thì lùi camera ra theo `fit`. */
const REFERENCE_ASPECT = 1.55;
/** Sương mù (gần, xa) ở tỉ lệ khung tham chiếu, mét. */
const FOG: readonly [number, number] = [4.6, 9.5];

const COLORS = {
  background: "#14232d",
  floor: "#17252e",
  rug: "#21313b",
  chair: "#24353f",
  lampMetal: "#3a4750",
} as const;

export class FallScene extends ScrollScene {
  private readonly figure: CareFigure;
  private readonly timeline: FallTimeline;
  private frame: FallFrame;
  private readonly ground: ContactShadow;
  private readonly rings: Array<Mesh<RingGeometry, MeshBasicMaterial>> = [];
  private readonly room = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materialsOwned: Material[] = [];
  private device: DeviceModel | null = null;
  private readonly onFrame: ((f: FallSceneFrame) => void) | undefined;
  private lastPoseKey = Number.NaN;
  private readonly deviceWorld = new Vector3();
  private insets: FallSceneInsets = { cardRight: 0, cardBottom: 0, panelTop: 0 };

  constructor(host: HTMLElement, options: FallSceneOptions) {
    super(host, { mode: options.mode, layout: options.layout, environmentIntensity: 0.28 });
    this.onFrame = options.onFrame;
    this.figure = new CareFigure({ detailedHands: true, lite: options.mode === "lite" });

    const bg = new Color(COLORS.background);
    this.scene.background = bg;
    this.scene.fog = new Fog(bg, FOG[0], FOG[1]);

    this.buildLights(options.mode);
    this.buildRoom();

    this.scene.add(this.figure.root);
    this.timeline = createFallTimeline(this.figure);
    this.frame = this.timeline.evaluate(0, this.layout);

    // Bóng tiếp xúc mềm dưới người (dùng lại kỹ thuật của cảnh phần cứng, đơn vị mét). Đặt ngay trên thảm để thảm không bị tính là vật đổ bóng.
    this.ground = new ContactShadow({ size: 4.2, height: 0.5, resolution: options.mode === "lite" ? 128 : 256, darkness: 0.7, blur: 2.6 });
    this.ground.group.position.set(this.timeline.lyingCenter.x * 0.5, 0.0075, this.timeline.lyingCenter.z * 0.5);
    this.scene.add(this.ground.group);

    // Vòng ghi nhận: luôn quay về phía camera, vẽ đè (không bị thân che) vì là lớp chỉ dẫn, không phải vật thể.
    for (let i = 0; i < 2; i++) {
      const geo = new RingGeometry(0.94, 1, 96);
      const mat = new MeshBasicMaterial({ color: TEAL_ACCENT, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, side: DoubleSide });
      this.geometries.push(geo);
      this.materialsOwned.push(mat);
      const ring = new Mesh(geo, mat);
      ring.renderOrder = 10;
      ring.visible = false;
      this.rings.push(ring);
      this.scene.add(ring);
    }
  }

  private buildLights(mode: SceneMode): void {
    // Quầng sáng chính: đèn spot ấm trên-trước-phải, viền mềm, đổ bóng. Tạo tiêu điểm rõ: người ở giữa vùng sáng, phòng chìm vào tối.
    const key = new SpotLight(0xfff1e2, 4.4, 0, 0.44, 0.92, 0);
    key.position.set(1.7, 4.3, 2.5);
    key.target.position.set(0, 0, 0.25);
    key.castShadow = true;
    // Bóng đổ của người nhỏ hơn 1 cm nên cần ô bóng mịn: 2048 (cỡ ô khoảng 2 mm quanh người). Bóng chỉ vẽ lại khi tư thế đổi nên không tốn khi cuộn qua đoạn đứng yên.
    const size = mode === "lite" ? 1024 : 2048;
    key.shadow.mapSize.set(size, size);
    key.shadow.radius = 3;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 2;
    key.shadow.camera.far = 8;
    this.scene.add(key, key.target);

    // Viền lạnh phía sau-trái: tách bóng người khỏi nền tối. Viền teal rất nhẹ phía sau-phải, cùng tông nhấn với trang.
    const rim = new DirectionalLight(0xdbe5ee, 1.15);
    rim.position.set(-2.6, 2.9, -3.2);
    const accent = new DirectionalLight(TEAL_ACCENT, 0.2);
    accent.position.set(2.9, 1.2, -2.6);
    const sky = new HemisphereLight(0xc4d2dc, 0x141d23, 0.26);
    // Ánh bù mềm từ phía người xem, không đổ bóng: giữ gương mặt và nếp áo đọc được mà không làm phẳng phòng.
    const fill = new DirectionalLight(0xf4e9dd, 0.62);
    fill.position.set(-1.6, 1.7, 3.6);
    this.scene.add(rim, accent, sky, fill);
  }

  private buildRoom(): void {
    const std = (color: string, roughness: number, metalness = 0) => {
      const m = new MeshStandardMaterial({ color: new Color(color), roughness, metalness, envMapIntensity: 0.4 });
      this.materialsOwned.push(m);
      return m;
    };
    const mesh = (geo: BufferGeometry, mat: Material, parent: Object3D = this.room) => {
      this.geometries.push(geo);
      const m = new Mesh(geo, mat);
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    const floor = mesh(new PlaneGeometry(40, 40), std(COLORS.floor, 0.94));
    floor.rotation.x = -Math.PI / 2;
    // Thảm: mỏng hơn khoảng hở của bóng tiếp xúc, định vị vùng sống và cho sàn có chiều sâu.
    const rug = mesh(new CylinderGeometry(1.25, 1.25, 0.006, 96), std(COLORS.rug, 1));
    rug.scale.set(1, 1, 0.72);
    rug.position.set(-0.08, 0.003, 0.22);

    // Ghế bành phía sau-trái (bối cảnh phòng khách, ngoài vùng sáng chính).
    const chair = new Group();
    chair.position.set(-1.3, 0, -0.95);
    chair.rotation.y = 0.55;
    this.room.add(chair);
    const fabric = std(COLORS.chair, 0.96);
    const part = (w: number, h: number, d: number, r: number, x: number, y: number, z: number) => {
      const m = mesh(new RoundedBoxGeometry(w, h, d, 4, r), fabric, chair);
      m.position.set(x, y, z);
      m.castShadow = true;
    };
    part(0.82, 0.4, 0.78, 0.07, 0, 0.22, 0);
    part(0.82, 0.56, 0.2, 0.08, 0, 0.66, -0.31);
    part(0.15, 0.3, 0.78, 0.06, -0.42, 0.52, 0);
    part(0.15, 0.3, 0.78, 0.06, 0.42, 0.52, 0);

    // Đèn sàn ấm: chụp đèn tự sáng nhẹ và một nguồn sáng điểm yếu, cho phòng cảm giác có người ở.
    const lamp = new Group();
    lamp.position.set(-2.9, 0, -1.7);
    this.room.add(lamp);
    const metal = std(COLORS.lampMetal, 0.45, 0.6);
    mesh(new CylinderGeometry(0.15, 0.17, 0.025, 40), metal, lamp).position.y = 0.0125;
    mesh(new CylinderGeometry(0.011, 0.011, 1.42, 12), metal, lamp).position.y = 0.72;
    const shadeMat = new MeshStandardMaterial({ color: new Color("#b9ad98"), emissive: new Color("#e8c58e"), emissiveIntensity: 0.32, roughness: 0.9, side: DoubleSide });
    this.materialsOwned.push(shadeMat);
    mesh(new CylinderGeometry(0.16, 0.22, 0.27, 40, 1, true), shadeMat, lamp).position.y = 1.5;
    const glow = new PointLight(0xf6d9ab, 0.9, 3.2, 2);
    glow.position.set(0, 1.45, 0);
    lamp.add(glow);

    this.scene.add(this.room);
  }

  /** Tải hai STL vỏ (thường đã có trong bộ nhớ đệm từ cảnh phần cứng) và gắn thiết bị lên ngực. */
  async load(): Promise<void> {
    const device = await loadDeviceModel();
    if (this.disposed) {
      device.dispose();
      throw new Error("Cảnh đã bị huỷ trước khi tải xong.");
    }
    this.device = device;
    this.figure.chestMount.add(device.group);
    this.markLoaded();
  }

  protected stillProgress(p: number): number {
    return FALL_STEPS[stepAt(p)].rest;
  }

  /** Báo vùng bị giao diện chiếm; khung hình đặt người vào phần còn trống. */
  setInsets(insets: FallSceneInsets): void {
    const i = this.insets;
    if (i.cardRight === insets.cardRight && i.cardBottom === insets.cardBottom && i.panelTop === insets.panelTop) return;
    this.insets = { ...insets };
    this.redraw();
  }

  /** Tính khung theo `current`, áp vào cảnh, đặt camera, vẽ. */
  protected renderFrame(settled: boolean): void {
    if (!this.loaded || this.disposed) return;
    const f = this.timeline.evaluate(this.current, this.layout, this.frame);
    this.frame = f;
    this.figure.applyPose(f.pose);

    // Bóng (spot và tiếp xúc) chỉ vẽ lại khi tư thế đổi; đoạn camera lướt trên người đã nằm yên không tốn lượt bóng.
    let key = 0;
    let k = 1;
    for (const v of Object.values(f.pose)) key += v * (k += 0.37);
    if (key !== this.lastPoseKey) {
      this.lastPoseKey = key;
      this.renderer.shadowMap.needsUpdate = true;
      this.ground.update(this.renderer, this.scene);
    }

    this.placeCamera(f);

    const device = this.figure.devicePosition(this.deviceWorld);
    f.rings.forEach((r, i) => {
      const ring = this.rings[i]!;
      ring.visible = r.opacity > 0.002;
      ring.material.opacity = r.opacity;
      ring.scale.setScalar(r.radius);
      ring.position.copy(device);
      ring.quaternion.copy(this.camera.quaternion);
    });

    this.renderer.render(this.scene, this.camera);
    this.onFrame?.({ progress: this.current, target: this.target, step: f.step, card: f.card, vignette: f.vignette, settled });
  }

  private placeCamera(f: FallFrame): void {
    const c = f.camera;
    const cam = this.camera;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    const { cardRight, cardBottom, panelTop } = this.insets;
    // Khung hẹp (điện thoại dọc), hoặc phần còn trống bên trái thẻ thông báo hẹp: lùi camera ra để người nằm vẫn trọn khung.
    // Cận cảnh thiết bị lùi ít hơn.
    const freeAspect = (w - cardRight * c.cardRoom) / h;
    const scale = 1 + (Math.max(1, REFERENCE_ASPECT / freeAspect) ** 0.82 - 1) * c.fit;
    cam.position.copy(c.position).sub(c.target).multiplyScalar(scale).add(c.target);
    // Sương mù đi theo khoảng lùi của camera: phòng chìm vào tối như nhau ở mọi tỉ lệ khung, người không bao giờ bị mờ đi.
    const fog = this.scene.fog as Fog;
    fog.near = FOG[0] * scale;
    fog.far = FOG[1] * scale;
    cam.fov = c.fov;
    cam.lookAt(c.target);
    // Đặt tâm người vào giữa phần khung còn trống: lệch trái khi thẻ chiếm mép phải, lệch lên khi thẻ chiếm đáy, lệch xuống dưới bảng bước.
    const shiftX = (cardRight / w / 2) * c.cardRoom;
    const shiftY = ((cardBottom / h) * c.cardRoom - panelTop / h) / 2;
    if (shiftX !== 0 || shiftY !== 0) cam.setViewOffset(w, h, shiftX * w, shiftY * h, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }

  /** Đo người trên khung hình hiện tại (bỏ phòng, bóng, vòng): độ phủ, số màu, hộp bao. Chỉ dùng cho kiểm thử. */
  sample(width = 160): FallSceneSample {
    const w = width;
    const h = Math.max(1, Math.round(width / this.camera.aspect));
    const target = new WebGLRenderTarget(w, h);
    const buf = new Uint8Array(w * h * 4);
    const hidden: Object3D[] = [this.room, this.ground.group, ...this.rings];
    const vis = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const bg = this.scene.background;
    const fog = this.scene.fog;
    this.scene.background = null;
    this.scene.fog = null;
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(target, 0, 0, w, h, buf);
    this.renderer.setRenderTarget(null);
    target.dispose();
    this.scene.background = bg;
    this.scene.fog = fog;
    hidden.forEach((o, i) => (o.visible = vis[i]!));
    const seen = new Set<number>();
    let covered = 0;
    let left = w;
    let right = -1;
    let top = h;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (buf[i + 3]! === 0) continue;
        covered++;
        seen.add(((buf[i]! >> 4) << 8) | ((buf[i + 1]! >> 4) << 4) | (buf[i + 2]! >> 4));
        left = Math.min(left, x);
        right = Math.max(right, x);
        // Bộ đệm đọc từ dưới lên.
        top = Math.min(top, h - 1 - y);
        bottom = Math.max(bottom, h - 1 - y);
      }
    }
    this.redraw();
    return {
      coverage: covered / (w * h),
      distinctColors: seen.size,
      bbox: right < 0 ? null : { left: left / w, right: (right + 1) / w, top: top / h, bottom: (bottom + 1) / h },
    };
  }

  /** Kích thước khung và vùng giao diện đang dùng để đặt camera (kiểm thử). */
  viewState(): { width: number; height: number; insets: FallSceneInsets; camera: number[] } {
    return { width: this.host.clientWidth, height: this.host.clientHeight, insets: { ...this.insets }, camera: this.camera.position.toArray() };
  }

  /** Trạng thái biến đổi của người (để kiểm thử cuộn ngược không trôi). */
  figureState(): number[] {
    this.figure.root.updateMatrixWorld(true);
    const out: number[] = [];
    for (const v of this.figure.probePoints()) out.push(v.x, v.y, v.z);
    out.push(...this.camera.position.toArray());
    return out;
  }

  override dispose(): void {
    if (this.disposed) return;
    this.figure.dispose();
    this.ground.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materialsOwned) m.dispose();
    this.device?.dispose();
    super.dispose();
  }
}
