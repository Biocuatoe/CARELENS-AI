import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  SpotLight,
  Vector3,
  WebGLRenderTarget,
} from "three";
import { TEAL_ACCENT } from "../hardware3d/materials";
import { loadDeviceModel, type DeviceModel } from "./deviceModel";
import { DataPacket, PACKET_SPEC, finalPacketPose, samplePacket, toSerializable, type PacketHandoff, type PacketPhase, type PacketState } from "./dataPacket";
import { CareFigure } from "./figure";
import { HEX_HIDDEN, type HexVisual } from "./hexLattice";
import { LAYOUT, OBSERVATION } from "./medicationLayout";
import { MED, createMedicationTimeline, type MedCamera, type MedFrame, type MedicationTimeline } from "./medicationTimeline";
import { createProps, type PropSet } from "./props";
import { ScrollScene, type SceneLayout, type SceneMode } from "./scrollScene";
import { ReportSurface } from "./reportSurface";
import { createReportTimeline, worldRectFromScreen, type ReportFrame, type ReportPhase, type ReportRect, type ReportTimeline } from "./reportTimeline";
import { createSecurityTimeline, type SecFrame, type SecurePhase, type SecurityTimeline } from "./securityTimeline";
import { createShield, type ShieldSet } from "./shield";
import { STORY_STEPS, splitStory, storyStepAt, type StoryChapter, type StoryStepIndex } from "./storySteps";

/**
 * Cảnh 3D của tình huống quan sát hoạt động và chương bảo vệ dữ liệu nối tiếp (khái niệm), trên cùng một khung vẽ, cùng một cảnh three
 * và cùng một hệ toạ độ thế giới.
 *  - Chương 0: một người đứng ở quầy cầm ly nước; thiết bị trên ngực nhìn thấy bàn tay và chiếc ly; khung nhìn đó được đóng băng thành ảnh,
 *    co lại thành một gói dữ liệu và bay sang khay nhận của hub trong nhà (`medicationTimeline.ts`).
 *  - Chương 1: chính gói đó rời khay, đi vào tấm khiên phía trên hub, mặt ảnh của nó lát thành ô lục giác rồi hội tụ thành một dải ngắn
 *    dạng mã băm (`securityTimeline.ts`). Không có gói thứ hai: chỉ một `DataPacket`, đổi lớp hiển thị theo tiến trình.
 *  - Chương 2: một bề mặt báo cáo mọc ra từ chính dải đó, camera tiến lại gần cho tới khi bề mặt đúng bằng khung của bản báo cáo HTML
 *    đặt trên khung vẽ (`reportTimeline.ts`, `reportSurface.ts`). Chữ của báo cáo là HTML thật; cảnh chỉ báo mức hiện của nó.
 * Mọi chuyển động là hàm thuần của tiến trình cuộn đã làm mượt của cả câu chuyện (`storySteps.ts`).
 *
 * Không có nhận diện thuốc, băm, mã hoá hay ẩn danh hoá nào được kiểm chứng ở đây: ảnh trong gói là cảnh tổng hợp dựng bằng code,
 * hub và khiên là hình minh hoạ, chuỗi ký tự là dấu vân của chính ảnh minh hoạ (không phải hàm băm mật mã).
 */

export type StoryPhase = PacketPhase | SecurePhase | ReportPhase;

export interface MedSceneFrame {
  progress: number;
  target: number;
  step: StoryStepIndex;
  chapter: StoryChapter;
  settled: boolean;
  packetPhase: StoryPhase;
  /** Độ hiện của nhãn chữ và vị trí neo trên khung hình (px, gốc trên-trái). */
  labels: Record<LabelKey, number>;
  anchors: Record<LabelKey, ScreenAnchor>;
  /** Lớp HTML của chương tổng quan: độ hiện của bảng bước, của nền, của nội dung và mức cuộn nội dung (0–1). Ngoài chương 2 là (1, 0, 0, 0). */
  ui: { panel: number; bg: number; reveal: number; hold: number };
}

/** Khung hình chữ nhật (px, gốc trên-trái của khung vẽ) mà bản báo cáo HTML chiếm khi đã hiện đủ. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Phần chung của khung chương bảo vệ và chương tổng quan mà `applyFrame` cần. */
interface StageFrame {
  packet: PacketState;
  hex: HexVisual;
  camera: MedCamera;
  shield: { opacity: number; glow: number; rise: number };
  roomDim: number;
  light: number;
  trayGlow: number;
  labels: { hub: number; shield: number; digest: number };
}

export type LabelKey = "device" | "hub" | "shield" | "digest";

export interface ScreenAnchor {
  x: number;
  y: number;
  visible: boolean;
}

export interface MedSceneOptions {
  mode: SceneMode;
  layout: SceneLayout;
  onFrame?: (frame: MedSceneFrame) => void;
}

/** Vùng (px, từ mép khung) bị lớp giao diện chiếm: bảng bước ở trên cùng (khung hẹp) hoặc bên trái (khung rộng). */
export interface MedSceneInsets {
  panelTop: number;
  panelBottom: number;
  panelLeft: number;
}

export interface MedSceneSample {
  coverage: number;
  distinctColors: number;
}

/** Trạng thái liền mạch của vật thể gói (kiểm thử và chương sau): đúng một đối tượng, cùng định danh trong suốt câu chuyện. */
export interface StoryArtifactState {
  chapter: StoryChapter;
  phase: StoryPhase;
  /** Định danh three của nhóm gói: không đổi khi qua ranh giới hai chương. */
  packetId: string;
  /** Số đối tượng tên "data-packet" trong cảnh: luôn là 1. */
  packetCount: number;
  /** Số ô lục giác đang hiện (0 trước khi gói lát thành ô, 8 khi đã thành dải rút gọn). */
  hexVisible: number;
  digest: string;
  /** Tư thế thật của nhóm gói trong cảnh (đọc từ đối tượng, không tính lại). */
  pose: { position: number[]; quaternion: number[]; scale: number };
}

const REFERENCE_ASPECT = 1.55;
const IDLE_UI = { panel: 1, bg: 0, reveal: 0, hold: 0 } as const;

/** Màu của bề mặt báo cáo đọc từ token của trang (một nguồn duy nhất); không có trang (kiểm thử) thì dùng giá trị mặc định cùng token. */
function readSurfaceStyle(): { fill: string; border: string } {
  const read = (name: string, fallback: string) => {
    if (typeof document === "undefined") return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  };
  const fill = read("--color-graphite", "#233642");
  const ivory = read("--color-ivory", "#f2f0e9");
  // Viền khung HTML là ivory 15% trên nền: trộn sẵn để đường viền 3D đúng màu đó.
  const mix = (a: string, b: string, k: number) => {
    // Trộn trong không gian sRGB như CSS (không phải không gian tuyến tính của three).
    const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [ra, ga, ba] = parse(a);
    const [rb, gb, bb] = parse(b);
    const c = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, "0");
    return `#${c(ra!, rb!)}${c(ga!, gb!)}${c(ba!, bb!)}`;
  };
  return { fill, border: mix(fill, ivory, 0.15) };
}
const FOG: readonly [number, number] = [4.8, 10];
/** Sương mù khi căn phòng đã chìm hẳn ở chương bảo vệ: hub còn mờ dưới khiên, quầy và người tan vào nền. */
const FOG_SECURE: readonly [number, number] = [0.85, 2.5];
const BACKGROUND = "#14232d";

export class MedicationScene extends ScrollScene {
  private readonly figure: CareFigure;
  private readonly timeline: MedicationTimeline;
  private readonly security: SecurityTimeline;
  private readonly report: ReportTimeline;
  private readonly surface: ReportSurface;
  private frame: MedFrame;
  private secFrame: SecFrame;
  private repFrame: ReportFrame;
  private reportRect: ScreenRect | null = null;
  /** Hình chữ nhật (thế giới) và độ sâu của bề mặt báo cáo đang vẽ; null khi không hiện. */
  private surfaceShown: (ReportRect & { z: number }) | null = null;
  /** Bán kính bo góc của khung HTML (px) để bề mặt 3D bo góc đúng như nó. */
  private reportRadiusPx = 24;
  private chapter: StoryChapter = 0;
  private readonly props: PropSet;
  private readonly shield: ShieldSet;
  private readonly secLight: DirectionalLight;
  private packet: DataPacket | null = null;
  private device: DeviceModel | null = null;
  private readonly cone: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly lensDot: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly onFrame: ((f: MedSceneFrame) => void) | undefined;
  private readonly anchors: Record<LabelKey, ScreenAnchor> = {
    device: { x: 0, y: 0, visible: false },
    hub: { x: 0, y: 0, visible: false },
    shield: { x: 0, y: 0, visible: false },
    digest: { x: 0, y: 0, visible: false },
  };
  private readonly labels: Record<LabelKey, number> = { device: 0, hub: 0, shield: 0, digest: 0 };
  private readonly scratch = new Vector3();
  private readonly scratchCam = new PerspectiveCamera(30, 1, 0.05, 40);
  private lastKey = Number.NaN;
  private insets: MedSceneInsets = { panelTop: 0, panelBottom: 0, panelLeft: 0 };
  private snapshot: HTMLCanvasElement | null = null;

  constructor(host: HTMLElement, options: MedSceneOptions) {
    super(host, { mode: options.mode, layout: options.layout, environmentIntensity: 0.3 });
    this.onFrame = options.onFrame;
    this.figure = new CareFigure({ detailedHands: true, lite: options.mode === "lite" });

    const bg = new Color(BACKGROUND);
    this.scene.background = bg;
    this.scene.fog = new Fog(bg, FOG[0], FOG[1]);
    this.buildLights(options.mode);
    this.secLight = new DirectionalLight(0xeef3f6, 0);
    this.scene.add(this.secLight, this.secLight.target);

    this.props = createProps({ quality: options.mode === "lite" ? "lite" : "full" });
    this.scene.add(this.props.room, this.props.glass);

    this.scene.add(this.figure.root);
    this.timeline = createMedicationTimeline(this.figure);
    this.frame = this.timeline.evaluate(0, this.layout);

    // Bàn giao tường minh giữa hai chương: chương bảo vệ bắt đầu đúng từ tư thế cuối của gói và camera cuối của chương quan sát.
    this.security = createSecurityTimeline({
      pose: finalPacketPose(this.timeline.plan),
      camera: (layout) => this.timeline.evaluate(1, layout).camera,
    });
    this.secFrame = this.security.evaluate(0, this.layout);
    // Chương tổng quan bắt đầu đúng từ khung cuối của chương bảo vệ (bàn giao tường minh, có kiểm thử).
    this.report = createReportTimeline(this.security);
    this.repFrame = this.report.evaluate(0, this.layout);
    this.surface = new ReportSurface(readSurfaceStyle());
    this.scene.add(this.surface.group);
    this.shield = createShield();
    this.scene.add(this.shield.group);
    this.secLight.position.copy(this.shield.group.position).add(new Vector3(-1.4, 1.8, 2.6));
    this.secLight.target.position.copy(this.shield.group.position);

    // Hình chóp tầm nhìn: bốn cạnh mảnh từ ống kính tới bốn góc khung ngắm. Hiện nhạt khi camera "đang quan sát", không quét, không nhấp nháy.
    const { position: lens } = this.timeline.lens;
    const c = this.timeline.plan.frame.center;
    const hw = OBSERVATION.halfWidth;
    const hh = OBSERVATION.halfHeight;
    const corners = [new Vector3(-hw, -hh, 0), new Vector3(hw, -hh, 0), new Vector3(hw, hh, 0), new Vector3(-hw, hh, 0)].map((o) => c.clone().add(o));
    const pts: number[] = [];
    for (const k of corners) pts.push(lens.x, lens.y, lens.z, k.x, k.y, k.z);
    const coneGeo = new BufferGeometry();
    coneGeo.setAttribute("position", new Float32BufferAttribute(pts, 3));
    this.cone = new LineSegments(coneGeo, new LineBasicMaterial({ color: TEAL_ACCENT, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
    this.cone.renderOrder = 5;
    this.cone.visible = false;
    this.scene.add(this.cone);

    // Đèn báo ống kính: chấm teal nhỏ ngay trước cửa sổ camera, sáng khi đang quan sát.
    this.lensDot = new Mesh(new CircleGeometry(0.0046, 24), new MeshBasicMaterial({ color: TEAL_ACCENT, transparent: true, opacity: 0, toneMapped: false, depthWrite: false, side: DoubleSide }));
    this.lensDot.position.copy(lens).addScaledVector(this.timeline.lens.direction, 0.002);
    this.lensDot.lookAt(lens.clone().add(this.timeline.lens.direction));
    this.lensDot.renderOrder = 9;
    this.lensDot.visible = false;
    this.scene.add(this.lensDot);
  }

  private buildLights(mode: SceneMode): void {
    // Quầng sáng chính từ trên-trước-trái: rơi xuống bàn tay, chiếc ly và mặt quầy; phần còn lại của phòng chìm vào tối.
    const key = new SpotLight(0xfff0de, 6.2, 0, 0.52, 0.9, 0);
    key.position.set(-0.7, 3.6, 2.4);
    key.target.position.set(0.25, 1.0, 0.35);
    key.castShadow = true;
    const size = mode === "lite" ? 1024 : 2048;
    key.shadow.mapSize.set(size, size);
    key.shadow.radius = 3;
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.012;
    key.shadow.camera.near = 1.5;
    key.shadow.camera.far = 8;
    this.scene.add(key, key.target);
    // Viền lạnh phía sau-phải tách người khỏi nền; viền teal rất nhẹ phía hub (cùng tông nhấn với trang).
    const rim = new DirectionalLight(0xdbe5ee, 1.1);
    rim.position.set(2.2, 2.6, -3);
    const fill = new DirectionalLight(0xf0e6dc, 0.55);
    fill.position.set(-1.8, 1.6, 3.2);
    const accent = new DirectionalLight(TEAL_ACCENT, 0.16);
    accent.position.set(3.2, 0.8, 1.2);
    this.scene.add(rim, fill, accent, new HemisphereLight(0xc4d2dc, 0x141d23, 0.22));
  }

  /** Tải vỏ thiết bị, gắn lên ngực và chụp ảnh khung hình của camera thiết bị (một lần), rồi dựng gói dữ liệu từ ảnh đó. */
  async load(): Promise<void> {
    const device = await loadDeviceModel();
    if (this.disposed) {
      device.dispose();
      throw new Error("Cảnh đã bị huỷ trước khi tải xong.");
    }
    this.device = device;
    this.figure.chestMount.add(device.group);
    this.figure.root.updateMatrixWorld(true);

    this.snapshot = this.captureSnapshot();
    this.packet = new DataPacket(this.snapshot, PACKET_SPEC);
    this.scene.add(this.packet.root, ...this.packet.trailObjects);
    this.markLoaded();
  }

  protected stillProgress(s: number): number {
    return STORY_STEPS[storyStepAt(s)]!.rest;
  }

  /** Báo vùng bị giao diện chiếm; khung hình đặt cảnh vào phần còn trống. */
  setInsets(insets: MedSceneInsets): void {
    const i = this.insets;
    if (insets.panelTop === i.panelTop && insets.panelBottom === i.panelBottom && insets.panelLeft === i.panelLeft) return;
    this.insets = { ...insets };
    this.redraw();
  }

  /**
   * Áp khung quan sát `f` (tư thế, bàn tay, ly, hub) và, nếu đang ở chương bảo vệ, khung `sec` (gói, khiên, không khí). Không đặt camera, không vẽ.
   * Ở chương bảo vệ chương quan sát được giữ ở khung cuối (p = 1), nên mọi thứ không thuộc chương mới đứng yên đúng chỗ cũ.
   */
  private applyFrame(f: MedFrame, sec: StageFrame | null): void {
    this.figure.applyPose(f.pose);
    this.figure.hands.left?.setGrip(f.grips.left);
    this.figure.hands.right?.setGrip(f.grips.right);
    const glass = this.props.glass;
    if (f.glassHeld) glass.position.copy(this.figure.gripWorld("right", this.scratch));
    else glass.position.copy(LAYOUT.glassRest);
    this.props.setHubActivity(f.hubActivity);
    this.props.setTrayGlow(sec ? f.trayGlow * sec.trayGlow : f.trayGlow);
    this.cone.material.opacity = f.cone * 0.5;
    this.cone.visible = f.cone > 0.003;
    this.lensDot.material.opacity = f.lens;
    this.lensDot.visible = f.lens > 0.003;
    if (this.packet) {
      if (sec) {
        this.packet.apply(sec.packet);
        this.packet.applyTrail(f.trail, 0);
        this.packet.applySecure(sec.hex);
      } else {
        this.packet.apply(f.packet);
        const transit = f.packet.phase === "transit" ? Math.sin(Math.PI * f.packet.transit) : 0;
        this.packet.applyTrail(f.trail, transit);
        this.packet.applySecure(HEX_HIDDEN);
      }
    }
    this.shield.set(sec ? sec.shield : { opacity: 0, glow: 0, rise: 0 });
    this.secLight.intensity = sec ? 1.8 * sec.light : 0;
    this.labels.device = f.labels.device;
    this.labels.hub = sec ? f.labels.hub * sec.labels.hub : f.labels.hub;
    this.labels.shield = sec ? sec.labels.shield : 0;
    this.labels.digest = sec ? sec.labels.digest : 0;
  }

  /** Camera người xem từ `c`, đặt lên `cam`. Vùng giao diện chiếm được nhường bằng lệch khung nhìn. */
  private cameraScale(c: Pick<MedCamera, "uiRoom" | "fit">, w: number, h: number): number {
    const { panelTop, panelBottom, panelLeft } = this.insets;
    const freeAspect = Math.max(1, w - panelLeft * c.uiRoom) / Math.max(1, h - (panelTop + panelBottom) * c.uiRoom);
    return 1 + (Math.max(1, REFERENCE_ASPECT / freeAspect) ** 0.82 - 1) * c.fit;
  }

  private placeCamera(c: MedCamera, cam: PerspectiveCamera, w: number, h: number): number {
    const { panelTop, panelBottom, panelLeft } = this.insets;
    const scale = this.cameraScale(c, w, h);
    cam.position.copy(c.position).sub(c.target).multiplyScalar(scale).add(c.target);
    cam.fov = c.fov;
    cam.aspect = w / h;
    cam.lookAt(c.target);
    // Dồn cảnh vào phần khung còn trống: sang phải bảng bước ở bên trái, xuống dưới bảng ở trên, lên trên bảng ở dưới.
    const shiftX = (-panelLeft / 2) * c.uiRoom;
    const shiftY = ((panelBottom - panelTop) / 2) * c.uiRoom;
    if (shiftX !== 0 || shiftY !== 0) cam.setViewOffset(w, h, shiftX, shiftY, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    return scale;
  }

  /** Đánh giá cả hai chương tại tiến trình câu chuyện `s` (hàm thuần của s). */
  private evaluateStory(s: number): { f: MedFrame; sec: StageFrame | null; chapter: StoryChapter } {
    const { chapter, p } = splitStory(s);
    this.frame = this.timeline.evaluate(chapter === 0 ? p : 1, this.layout, this.frame);
    this.secFrame = this.security.evaluate(chapter === 0 ? 0 : chapter === 1 ? p : 1, this.layout, this.secFrame);
    this.repFrame = this.report.evaluate(chapter === 2 ? p : 0, this.layout, this.repFrame);
    return { f: this.frame, sec: chapter === 0 ? null : chapter === 1 ? this.secFrame : this.repFrame, chapter };
  }

  /** Bề mặt báo cáo: ở chương 2 mọc từ dải rút gọn tới đúng khung HTML; ngoài chương 2 ẩn. */
  private applySurface(chapter: StoryChapter, w: number, h: number): void {
    const rect = this.reportRect;
    if (chapter !== 2 || !rect) {
      this.surface.set({ x0: 0, y0: 0, x1: 0, y1: 0 }, 0, 0, 0, 0);
      this.surfaceShown = null;
      return;
    }
    const f = this.repFrame;
    const view = this.report.view(this.layout);
    // Camera cuối: không nhường chỗ cho giao diện (uiRoom 0), nên hệ số vừa khung chỉ phụ thuộc tỉ lệ khung.
    const fitScale = this.cameraScale({ uiRoom: 0, fit: view.fit }, w, h);
    const end: ReportRect = worldRectFromScreen(rect, { w, h }, view, fitScale);
    const start = this.report.plane.start;
    const t = f.surface.grow;
    const lerp = (a: number, b: number) => a + (b - a) * t;
    const worldPerPx = (end.x1 - end.x0) / Math.max(1, rect.w);
    const now: ReportRect = { x0: lerp(start.x0, end.x0), y0: lerp(start.y0, end.y0), x1: lerp(start.x1, end.x1), y1: lerp(start.y1, end.y1) };
    this.surface.set(now, lerp(0.012, this.reportRadiusPx * worldPerPx), this.report.plane.z, f.surface.opacity, 1);
    this.surfaceShown = f.surface.opacity > 0.002 ? { ...now, z: this.report.plane.z } : null;
  }

  /** Hình chữ nhật mà bề mặt báo cáo đang chiếm trên khung vẽ (px, gốc trên-trái), qua camera đang dùng. null khi bề mặt không hiện. */
  reportSurfaceScreen(): ScreenRect | null {
    const s = this.surfaceShown;
    if (!s) return null;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    const a = new Vector3(s.x0, s.y1, s.z).project(this.camera);
    const b = new Vector3(s.x1, s.y0, s.z).project(this.camera);
    return { x: (a.x * 0.5 + 0.5) * w, y: (-a.y * 0.5 + 0.5) * h, w: (b.x - a.x) * 0.5 * w, h: (a.y - b.y) * 0.5 * h };
  }

  /** Báo khung HTML mà bản báo cáo chiếm khi hiện đủ (px, gốc trên-trái của khung vẽ) và bán kính bo góc của nó. */
  setReportRect(rect: ScreenRect, radiusPx = 24): void {
    const r = this.reportRect;
    if (r && r.x === rect.x && r.y === rect.y && r.w === rect.w && r.h === rect.h && radiusPx === this.reportRadiusPx) return;
    this.reportRect = { ...rect };
    this.reportRadiusPx = radiusPx;
    this.redraw();
  }

  protected renderFrame(settled: boolean): void {
    if (!this.loaded || this.disposed) return;
    const { f, sec, chapter } = this.evaluateStory(this.current);
    this.chapter = chapter;
    this.applyFrame(f, sec);

    // Bóng chỉ vẽ lại khi tay, ly hoặc gói thật sự đổi chỗ.
    const pk = sec ? sec.packet : f.packet;
    let key = f.glassHeld ? 1 : 0;
    let k = 1;
    for (const v of Object.values(f.pose)) key += v * (k += 0.37);
    key += (f.grips.right.curl + f.grips.right.thumb * 1.3) * 7.7 + pk.position.x * 3.1 + pk.position.y * 5.3 + pk.position.z * 1.9 + pk.scale * 2.2 + pk.slab * 0.7;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.renderer.shadowMap.needsUpdate = true;
    }

    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    const scale = this.placeCamera(sec ? sec.camera : f.camera, this.camera, w, h);
    this.applySurface(chapter, w, h);
    const fog = this.scene.fog as Fog;
    const dim = sec ? sec.roomDim : 0;
    fog.near = (FOG[0] + (FOG_SECURE[0] - FOG[0]) * dim) * scale;
    fog.far = (FOG[1] + (FOG_SECURE[1] - FOG[1]) * dim) * scale;

    this.renderer.render(this.scene, this.camera);
    this.project(this.figure.devicePosition(this.scratch).add(this.deviceLabelOffset), this.anchors.device, w, h);
    this.project(this.props.hubAnchor.getWorldPosition(this.scratch), this.anchors.hub, w, h);
    this.project(this.shield.anchor.getWorldPosition(this.scratch), this.anchors.shield, w, h);
    this.project(this.scratch.copy(this.security.inside).add(this.digestLabelOffset), this.anchors.digest, w, h);
    this.onFrame?.({
      progress: this.current,
      target: this.target,
      step: storyStepAt(this.current),
      chapter,
      settled,
      packetPhase: this.packetPhase,
      labels: this.labels,
      anchors: this.anchors,
      ui: chapter === 2 ? this.repFrame.ui : IDLE_UI,
    });
  }

  private readonly deviceLabelOffset = new Vector3(0, 0.12, 0);
  /** Nhãn của dải rút gọn: ngay dưới dải (dải cao khoảng 4 cm ở độ lớn cuối). */
  private readonly digestLabelOffset = new Vector3(0, -0.07, 0);

  private project(world: Vector3, out: ScreenAnchor, w: number, h: number): void {
    const v = world.clone().project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * w;
    out.y = (-v.y * 0.5 + 0.5) * h;
    out.visible = v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05;
  }

  /**
   * Chụp khung hình của camera thiết bị (đúng vị trí ống kính, tầm nhìn 4:3 khớp khung ngắm) ở thời điểm `MED.snapshot`, khi người đang giữ ly.
   * Ảnh là cảnh tổng hợp dựng bằng code; chụp một lần lúc tải nên hoàn toàn tất định và không phụ thuộc vị trí cuộn lúc đó.
   */
  private captureSnapshot(): HTMLCanvasElement {
    const [W, H] = PACKET_SPEC.snapshotSize;
    const f = this.timeline.evaluate(MED.snapshot, this.layout, this.frame);
    this.applyFrame(f, null);
    // Ảnh không có chính thiết bị, gói, khiên và lớp chỉ dẫn.
    const hide: Object3D[] = [this.cone, this.lensDot, this.device!.group, this.shield.group];
    if (this.packet) hide.push(this.packet.root);
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));

    const lens = this.timeline.lens;
    const cam = new PerspectiveCamera((2 * Math.atan(OBSERVATION.halfHeight / OBSERVATION.distance) * 180) / Math.PI, W / H, 0.03, 20);
    cam.position.copy(lens.position);
    cam.lookAt(lens.position.clone().add(lens.direction));
    cam.updateMatrixWorld(true);

    const target = new WebGLRenderTarget(W, H, { samples: 4 });
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, cam);
    const buf = new Uint8Array(W * H * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, W, H, buf);
    this.renderer.setRenderTarget(null);
    target.dispose();
    hide.forEach((o, i) => (o.visible = vis[i]!));
    this.lastKey = Number.NaN;

    // Bộ đệm đọc từ dưới lên và ở không gian tuyến tính: lật dọc và mã hoá sang sRGB để ảnh khớp với những gì trình duyệt hiển thị.
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const img = ctx.createImageData(W, H);
      // Camera tự bù sáng: nhân thêm hệ số phơi sáng trước khi mã hoá, vì cảnh quan sát chủ yếu tối.
      const enc = (c: number) => Math.round(255 * Math.min(1, Math.pow(Math.min(1, (c / 255) * 1.9), 1 / 2.2)));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const s = ((H - 1 - y) * W + x) * 4;
          const d = (y * W + x) * 4;
          img.data[d] = enc(buf[s]!);
          img.data[d + 1] = enc(buf[s + 1]!);
          img.data[d + 2] = enc(buf[s + 2]!);
          img.data[d + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    return canvas;
  }

  /**
   * Giao diện bàn giao gói ở cuối chương quan sát (xem `PacketHandoff`). Chương bảo vệ trong cùng cảnh này dùng đúng `final` làm điểm xuất phát
   * và dùng lại chính `object`; một phần khác của trang (khung vẽ khác) có thể dựng lại gói từ `spec` + `snapshot` tại `finalScreen`.
   * `finalScreen` tính với khung nhìn của chính cảnh này ở cuối chương quan sát và kích thước khung hiện tại.
   */
  getPacketHandoff(): PacketHandoff {
    if (!this.packet || !this.snapshot) throw new Error("Cảnh chưa tải xong nên chưa có gói để bàn giao.");
    const plan = this.timeline.plan;
    const last = this.timeline.evaluate(1, this.layout);
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.placeCamera(last.camera, this.scratchCam, w, h);
    const end = samplePacket(plan, 1);
    const ndc = end.position.clone().project(this.scratchCam);
    // Ở chương bảo vệ gói đã rời khay: trạng thái "hiện tại" của chương quan sát là trạng thái cuối của nó.
    const cur = this.chapter >= 1 ? end : this.frame.packet;
    const timeline = this.timeline;
    const packet = this.packet;
    return {
      version: 1,
      phase: cur.phase,
      progress: this.chapter >= 1 ? 1 : splitStory(this.current).p,
      current: toSerializable(cur.position, cur.quaternion, cur.scale),
      final: toSerializable(end.position, end.quaternion, end.scale),
      finalScreen: { x: ndc.x * 0.5 + 0.5, y: -ndc.y * 0.5 + 0.5 },
      arrived: cur.phase === "arrived",
      spec: PACKET_SPEC,
      snapshot: packet.snapshotCanvas,
      mosaic: packet.mosaicCanvas,
      object: packet,
      sample: (p: number) => samplePacket(timeline.plan, p),
    };
  }

  /** Trạng thái vật thể gói đang vẽ, đọc thẳng từ đối tượng trong cảnh (kiểm chứng tính liền mạch qua ranh giới hai chương). */
  artifactState(): StoryArtifactState {
    if (!this.packet) throw new Error("Cảnh chưa tải xong.");
    let count = 0;
    this.scene.traverse((o) => {
      if (o.name === "data-packet") count++;
    });
    const r = this.packet.root;
    return {
      chapter: this.chapter,
      phase: this.packetPhase,
      packetId: r.uuid,
      packetCount: count,
      hexVisible: this.chapter === 0 ? 0 : this.packet.visibleHexCount(this.chapter === 1 ? this.secFrame.hex : this.repFrame.hex),
      digest: this.packet.digest,
      pose: { position: r.position.toArray(), quaternion: r.quaternion.toArray(), scale: r.scale.x },
    };
  }

  /** Pha hiện tại của gói (đang vẽ): pha của chương quan sát hoặc của chương bảo vệ. */
  get packetPhase(): StoryPhase {
    if (this.chapter === 2) return this.repFrame.phase;
    return this.chapter === 1 ? this.secFrame.phase : this.frame.packet.phase;
  }

  /** Kích thước khung và camera đang dùng (kiểm thử). */
  viewState(): { width: number; height: number; camera: number[]; step: number; chapter: number } {
    return { width: this.host.clientWidth, height: this.host.clientHeight, camera: this.camera.position.toArray(), step: storyStepAt(this.current), chapter: this.chapter };
  }

  /**
   * Trạng thái biến đổi dùng để kiểm tra cuộn ngược không trôi, đọc từ chính các đối tượng: gói [0–7] (vị trí, hướng, độ lớn), độ hiện của thẻ [8],
   * ly [9–11], đầu ngón tay phải [12–14], camera [15–17], khiên (độ cao, hiện) [18–19], tổng kiểm các ô lục giác [20],
   bề mặt báo cáo (mức mọc, độ hiện) [21–22], nội dung HTML (độ hiện) [23], bảng bước (độ hiện) [24].
   */
  motionState(): number[] {
    const out: number[] = [];
    const r = this.packet?.root;
    const pk = this.chapter === 2 ? this.repFrame.packet : this.chapter === 1 ? this.secFrame.packet : this.frame.packet;
    if (r) out.push(...r.position.toArray(), ...r.quaternion.toArray(), r.scale.x);
    else out.push(0, 0, 0, 0, 0, 0, 1, 1);
    out.push(pk.opacity * pk.slab);
    out.push(...this.props.glass.position.toArray());
    out.push(...this.figure.gripWorld("right", new Vector3()).toArray());
    out.push(...this.camera.position.toArray());
    out.push(this.shield.group.position.y, this.shield.group.visible ? 1 : 0);
    const v = this.chapter === 2 ? this.repFrame.hex : this.chapter === 1 ? this.secFrame.hex : HEX_HIDDEN;
    out.push(v.fragment + v.spread * 3 + v.converge * 7 + v.digest * 11 + v.fade * 13);
    const rep = this.chapter === 2 ? this.repFrame : null;
    out.push(rep ? rep.surface.grow : 0, rep ? rep.surface.opacity : 0, rep ? rep.ui.reveal : 0, rep ? rep.ui.panel : 1);
    return out;
  }

  /** Độ phủ và số màu của khung hình hiện tại (kiểm thử: khung không trống, không một màu phẳng). Căn phòng được ẩn khi đo. */
  sample(width = 160): MedSceneSample {
    const w = width;
    const h = Math.max(1, Math.round(width / this.camera.aspect));
    const target = new WebGLRenderTarget(w, h);
    const buf = new Uint8Array(w * h * 4);
    const bg = this.scene.background;
    const fog = this.scene.fog;
    this.scene.background = null;
    this.scene.fog = null;
    const hide: Object3D[] = [this.props.room];
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(target, 0, 0, w, h, buf);
    this.renderer.setRenderTarget(null);
    target.dispose();
    this.scene.background = bg;
    this.scene.fog = fog;
    hide.forEach((o, i) => (o.visible = vis[i]!));
    const seen = new Set<number>();
    let covered = 0;
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i + 3]! === 0) continue;
      covered++;
      seen.add(((buf[i]! >> 4) << 8) | ((buf[i + 1]! >> 4) << 4) | (buf[i + 2]! >> 4));
    }
    this.redraw();
    return { coverage: covered / (w * h), distinctColors: seen.size };
  }

  override dispose(): void {
    if (this.disposed) return;
    this.figure.dispose();
    this.props.dispose();
    this.shield.dispose();
    this.surface.dispose();
    this.packet?.dispose();
    this.cone.geometry.dispose();
    this.cone.material.dispose();
    this.lensDot.geometry.dispose();
    this.lensDot.material.dispose();
    this.device?.dispose();
    super.dispose();
  }
}
