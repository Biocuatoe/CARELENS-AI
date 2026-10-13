import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  NeutralToneMapping,
  PMREMGenerator,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  type Texture,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { HardwareAssembly } from "./assembly";
import { ContactShadow } from "./contactShadow";
import { TEAL_ACCENT } from "./materials";
import { createStudioScene } from "./studioEnvironment";

export type ViewPreset = "iso" | "front" | "back" | "left" | "right" | "top" | "bottom" | "iso-back";

/** Hướng nhìn từ tâm ra camera, theo khung scene (three.js: +Z là phía trước thiết bị). */
const PRESET_DIRECTION: Record<ViewPreset, Vector3> = {
  iso: new Vector3(0.8, 0.55, 1).normalize(),
  "iso-back": new Vector3(-0.8, 0.55, -1).normalize(),
  front: new Vector3(0, 0.04, 1).normalize(),
  back: new Vector3(0, 0.04, -1).normalize(),
  left: new Vector3(-1, 0.04, 0).normalize(),
  right: new Vector3(1, 0.04, 0).normalize(),
  top: new Vector3(0.001, 1, 0.02).normalize(),
  bottom: new Vector3(0.001, -1, 0.02).normalize(),
};

const FOV_DEG = 30;
const projectionScratch = new Vector3();

export interface ViewerSample {
  width: number;
  height: number;
  /** Tỉ lệ điểm ảnh có vật thể (alpha > 0) trên toàn khung. */
  coverage: number;
  /** Số màu khác nhau sau khi lượng tử hoá 4 bit mỗi kênh, để phát hiện khung trống hoặc một màu phẳng. */
  distinctColors: number;
}

export interface ViewerOptions {
  /**
   * `true` (mặc định): kéo để xoay, cuộn để phóng to (công cụ kiểm tra).
   * `false`: không có điều khiển; canvas không nhận sự kiện con trỏ nên cuộn trang và chạm cuộn đi thẳng xuống trang (cảnh cuộn).
   */
  interactive?: boolean;
  /** Giới hạn tỉ lệ điểm ảnh để giảm tải GPU trên thiết bị yếu. */
  maxPixelRatio?: number;
  /**
   * Mặt sàn vô hình dưới đáy vỏ với bóng tiếp xúc mềm (cảnh cuộn). Tắt ở công cụ kiểm tra vì che hướng nhìn từ dưới.
   * `resolution` nhỏ hơn cho máy yếu.
   */
  ground?: false | { resolution: number };
}

export const CAMERA_FOV_DEG = FOV_DEG;

export class HardwareViewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV_DEG, 1, 5, 4000);
  readonly controls: OrbitControls | null;
  /** Dịch chuyển điểm nhìn theo tỉ lệ khung (x > 0: cảnh lệch sang trái, y > 0: cảnh lệch lên trên), dùng để chừa chỗ cho nhãn. */
  private shiftX = 0;
  private shiftY = 0;
  private lastViewKey = "";

  private assembly: HardwareAssembly | null = null;
  private frameId = 0;
  private disposed = false;
  private readonly resizeObserver: ResizeObserver;
  private readonly envTexture: Texture;
  private readonly pmrem: PMREMGenerator;
  private readonly ground: ContactShadow | null;
  /** Bóng sàn chỉ phụ thuộc vị trí vật thể (không phụ thuộc camera): chỉ vẽ lại khi vật thể đã dịch chuyển. */
  private groundDirty = true;
  private readonly onContextLost = (e: Event) => e.preventDefault();
  private readonly onContextRestored = () => this.requestRender();

  constructor(
    private readonly host: HTMLElement,
    options: ViewerOptions = {},
  ) {
    const interactive = options.interactive ?? true;
    // Nền trong suốt: bề mặt Neumorphism của trang hiện qua canvas.
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    // Neutral giữ đúng màu gốc của vật liệu (vỏ màu gốm không ngả xám hay vàng như ACES), chỉ nén vùng quá sáng.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxPixelRatio ?? 2));
    // Mặt cắt vỏ (assembly.setSection) dùng clipping plane cục bộ của vật liệu.
    this.renderer.localClippingEnabled = true;

    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    if (interactive) {
      canvas.style.touchAction = "none";
      canvas.tabIndex = 0;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Mô hình 3D thiết bị CareLens. Kéo để xoay, cuộn để phóng to, phím mũi tên để dịch chuyển.");
    } else {
      // Cảnh cuộn: không chặn cuộn trang bằng bánh xe, bàn phím hay chạm.
      canvas.style.touchAction = "pan-y";
      canvas.style.pointerEvents = "none";
      canvas.setAttribute("aria-hidden", "true");
    }
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    host.appendChild(canvas);

    // Môi trường phản chiếu: phòng chụp sản phẩm (softbox lớn, hai dải đèn dọc), dựng một lần qua PMREM. Không có nguồn phát sáng nào trong cảnh.
    this.pmrem = new PMREMGenerator(this.renderer);
    const studio = createStudioScene();
    this.envTexture = this.pmrem.fromScene(studio, 0.035).texture;
    (studio.userData.dispose as () => void)();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.72;

    // Ánh sáng ba điểm, mềm: key ấm rộng từ trên-trước-phải, fill dịu từ trước-trái, rim trung tính phía sau tách viền khỏi nền tối,
    // và một rim teal rất nhẹ phía sau-phải (nhấn có kiểm soát, không tô màu bề mặt chính).
    const key = new DirectionalLight(0xfffaf3, 1.6);
    key.position.set(110, 190, 170);
    const fill = new DirectionalLight(0xe8eef4, 0.55);
    fill.position.set(-180, 60, 140);
    const rim = new DirectionalLight(0xf0f4f8, 1.25);
    rim.position.set(-120, 140, -210);
    const accent = new DirectionalLight(TEAL_ACCENT, 0.22);
    accent.position.set(200, 40, -160);
    const sky = new HemisphereLight(0xdfe6ec, 0x2a333a, 0.35);
    this.scene.add(key, fill, rim, accent, sky);

    this.ground = options.ground ? new ContactShadow({ size: 280, height: 60, resolution: options.ground.resolution, darkness: 0.85, blur: 3.2 }) : null;
    if (this.ground) {
      // Mặt sàn ở đáy vỏ (CAD z = 0 ↔ scene y = 0), tâm dưới thân vỏ và lệch về phía các trạm tách rời.
      this.ground.group.position.set(21.5, -0.05, -16);
      this.scene.add(this.ground.group);
    }

    if (interactive) {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = false;
      this.controls.screenSpacePanning = true;
      this.controls.minDistance = 40;
      this.controls.maxDistance = 1200;
      this.controls.addEventListener("change", () => this.requestRender());
      this.controls.listenToKeyEvents(canvas);
    } else {
      this.controls = null;
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  /** Báo vật thể đã dịch chuyển: bóng sàn được vẽ lại ở khung hình kế tiếp. */
  invalidateGround(): void {
    this.groundDirty = true;
  }

  setAssembly(assembly: HardwareAssembly | null): void {
    this.groundDirty = true;
    if (this.assembly) this.scene.remove(this.assembly.root);
    this.assembly = assembly;
    if (assembly) this.scene.add(assembly.root);
    this.requestRender();
  }

  /** Đặt camera nhìn trọn cụm theo một hướng định sẵn, dựa trên hộp bao hiện tại (kể cả khi đang tách rời). */
  frame(preset: ViewPreset = "iso"): void {
    const bounds = this.assembly ? this.assembly.getSceneBounds() : new Box3(new Vector3(-30, -30, -30), new Vector3(30, 30, 30));
    const sphere = bounds.getBoundingSphere(new Sphere());
    const vFov = (FOV_DEG * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distance = (sphere.radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.08;
    this.camera.position.copy(sphere.center).addScaledVector(PRESET_DIRECTION[preset], distance);
    this.camera.near = Math.max(1, distance / 100);
    this.camera.far = distance * 10;
    if (this.controls) {
      this.controls.target.copy(sphere.center);
      this.camera.updateProjectionMatrix();
      this.controls.update();
    } else {
      this.camera.lookAt(sphere.center);
      this.applyViewOffset();
    }
    this.requestRender();
  }

  /**
   * Đặt camera trực tiếp (cảnh cuộn): quanh `target` theo góc phương vị/độ cao (độ, khung scene: 0° là nhìn từ phía trước, dương sang +X)
   * ở khoảng cách đủ để quả cầu bán kính `radius` nằm vừa khung (nhân `margin`). Không cấp phát đối tượng mới mỗi khung hình.
   */
  placeCamera(target: Vector3, azimuthDeg: number, elevationDeg: number, radius: number, margin: number, shiftX = 0, shiftY = 0, fitX = 1, fitY = 1): void {
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    const vFov = (FOV_DEG * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    // `fitX`, `fitY`: phần khung ngang/dọc mà quả cầu được phép chiếm (1 = cả khung), để chừa chỗ cho chữ.
    const distance = Math.max(30, (radius * margin) / Math.sin(hFov / 2) / Math.max(0.2, fitX), (radius * margin) / Math.sin(vFov / 2) / Math.max(0.2, fitY));
    const cosEl = Math.cos(el);
    this.camera.position.set(target.x + distance * cosEl * Math.sin(az), target.y + distance * Math.sin(el), target.z + distance * cosEl * Math.cos(az));
    this.camera.near = Math.max(1, distance / 100);
    this.camera.far = distance * 12;
    this.camera.lookAt(target);
    this.shiftX = shiftX;
    this.shiftY = shiftY;
    this.applyViewOffset();
  }

  /** Chiếu một điểm (toạ độ thế giới) ra toạ độ pixel CSS trong khung; `visible` = false nếu nằm sau camera hoặc ngoài khung. */
  project(world: Vector3, out: { x: number; y: number; visible: boolean }): void {
    const v = projectionScratch.copy(world).project(this.camera);
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    out.x = (v.x * 0.5 + 0.5) * w;
    out.y = (-v.y * 0.5 + 0.5) * h;
    out.visible = v.z > -1 && v.z < 1 && out.x >= 0 && out.x <= w && out.y >= 0 && out.y <= h;
  }

  /** Áp dụng dịch chuyển điểm nhìn bằng view offset của camera (không đổi vị trí camera). */
  private applyViewOffset(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    const key = `${w}x${h}:${this.shiftX.toFixed(4)}:${this.shiftY.toFixed(4)}`;
    if (key === this.lastViewKey) return;
    this.lastViewKey = key;
    if (this.shiftX === 0 && this.shiftY === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, this.shiftX * w, this.shiftY * h, w, h);
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.lastViewKey = "";
    this.camera.updateProjectionMatrix();
    this.applyViewOffset();
    this.requestRender();
  }

  /** Vẽ khi cần (không có vòng lặp liên tục): tiết kiệm pin và tôn trọng người dùng giảm chuyển động. */
  requestRender(): void {
    if (this.disposed || this.frameId) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = 0;
      this.renderNow();
    });
  }

  renderNow(): void {
    if (this.disposed) return;
    if (this.ground && this.groundDirty) {
      this.ground.update(this.renderer, this.scene);
      this.groundDirty = false;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Đo chi phí vẽ (chỉ dùng cho kiểm thử, qua `?debug=1`): vẽ `n` khung liền nhau, chờ GPU xong (`gl.finish`),
   * trả về thời gian trung bình mỗi khung, số lần gọi vẽ và số tam giác của một khung (gồm cả lượt bóng sàn).
   */
  bench(n = 30, withGround = true): { msPerFrame: number; calls: number; triangles: number } {
    const gl = this.renderer.getContext();
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    if (withGround) this.groundDirty = true;
    this.renderNow();
    const calls = this.renderer.info.render.calls;
    const triangles = this.renderer.info.render.triangles;
    this.renderer.info.autoReset = true;
    gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      if (withGround) this.groundDirty = true;
      this.renderNow();
    }
    gl.finish();
    return { msPerFrame: (performance.now() - t0) / n, calls, triangles };
  }

  /** Vẽ vào render target nhỏ và đọc điểm ảnh: kiểm tra khung hình không trống mà không cần preserveDrawingBuffer. */
  sample(width = 192): ViewerSample {
    const aspect = this.camera.aspect;
    const w = width;
    const h = Math.max(1, Math.round(width / aspect));
    const target = new WebGLRenderTarget(w, h);
    const buf = new Uint8Array(w * h * 4);
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    // Không tính mặt sàn và bóng: độ phủ chỉ đo vật thể thật.
    const groundVisible = this.ground?.group.visible ?? false;
    if (this.ground) this.ground.group.visible = false;
    this.renderer.render(this.scene, this.camera);
    if (this.ground) this.ground.group.visible = groundVisible;
    this.renderer.readRenderTargetPixels(target, 0, 0, w, h, buf);
    this.renderer.setRenderTarget(null);
    target.dispose();
    const seen = new Set<number>();
    let covered = 0;
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i + 3]! > 0) {
        covered++;
        seen.add(((buf[i]! >> 4) << 8) | ((buf[i + 1]! >> 4) << 4) | (buf[i + 2]! >> 4));
      }
    }
    return { width: w, height: h, coverage: covered / (w * h), distinctColors: seen.size };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.controls?.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("webglcontextlost", this.onContextLost);
    canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.ground?.dispose();
    this.envTexture.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}

let webglAvailable: boolean | undefined;

/**
 * WebGL có dùng được không (trình duyệt chặn, GPU bị tắt, môi trường kiểm thử không có GPU). Chỉ thăm dò một lần: mỗi lần thăm dò tạo
 * một context WebGL, mà trình duyệt giới hạn khoảng 16 context và sẽ huỷ context cũ nhất (chính là canvas đang hiển thị) khi vượt.
 */
export function isWebGLAvailable(): boolean {
  if (webglAvailable !== undefined) return webglAvailable;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    webglAvailable = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglAvailable = false;
  }
  return webglAvailable;
}
