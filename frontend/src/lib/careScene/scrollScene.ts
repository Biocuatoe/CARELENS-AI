import { NeutralToneMapping, PCFShadowMap, PMREMGenerator, PerspectiveCamera, SRGBColorSpace, Scene, WebGLRenderer, type Texture } from "three";
import { createStudioScene } from "../hardware3d/studioEnvironment";

/**
 * Nền chung của các cảnh 3D chạy theo cuộn (tình huống ngã, quan sát hoạt động): bộ vẽ, môi trường phản chiếu, làm mượt tiến trình cuộn,
 * vòng lặp chỉ chạy khi còn đang tiến tới đích, tạm dừng khi ra khỏi màn hình, và dọn dẹp.
 * Lớp con chỉ cần nói "ảnh tĩnh của giảm chuyển động" (`stillProgress`) và "vẽ khung hình theo `current`" (`renderFrame`).
 */

export type SceneMode = "full" | "lite" | "reduced";
export type SceneLayout = "wide" | "narrow";

export interface ScrollSceneOptions {
  mode: SceneMode;
  layout: SceneLayout;
  /** Cường độ môi trường phản chiếu (phòng chụp dùng chung với cảnh phần cứng). */
  environmentIntensity?: number;
}

/**
 * Tỉ lệ điểm ảnh ban đầu. Chế độ đầy đủ không bao giờ vẽ dưới 1,5 lần kích thước CSS (màn 1080p thường có tỉ lệ 1: vẽ dư rồi để trình duyệt thu nhỏ
 * cho cạnh người và đường may mịn, không răng cưa) và không quá 2; chế độ nhẹ (điện thoại, máy yếu) không quá 1,5. Cảnh chỉ vẽ khi đang chuyển động
 * nên chi phí thêm chỉ phát sinh lúc cuộn, và khung nào quá chậm sẽ tự hạ tỉ lệ (xem `step`).
 */
export function initialPixelRatio(mode: SceneMode, dpr: number): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return mode === "lite" ? Math.min(d, 1.5) : Math.min(2, Math.max(1.5, d));
}
/** Khung kéo dài hơn mức này (ms) liền nhau từng ấy khung thì hạ tỉ lệ điểm ảnh một bậc. */
const SLOW_FRAME_MS = 30;
const SLOW_FRAMES_TO_DOWNSCALE = 14;
const PIXEL_RATIO_STEP = 0.25;

/** Hằng thời gian làm mượt (giây): nhỏ hơn = bám cuộn sát hơn. */
const SMOOTHING_TAU: Record<SceneMode, number> = { full: 0.12, lite: 0.08, reduced: 0 };
const EPSILON = 1e-5;
const MAX_DT = 0.1;

export abstract class ScrollScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 0.05, 40);
  protected mode: SceneMode;
  protected layout: SceneLayout;
  protected current = 0;
  protected target = 0;
  protected loaded = false;
  protected disposed = false;
  private readonly envTexture: Texture;
  private readonly pmrem: PMREMGenerator;
  private readonly resizeObserver: ResizeObserver;
  private rafId = 0;
  private lastTime = 0;
  private pixelRatio: number;
  private slowFrames = 0;
  private active = true;
  /** Cho tới khi người dùng thật sự thao tác (hoặc hết thời gian chờ), mọi thay đổi cuộn do trình duyệt khôi phục áp dụng tức thì. */
  private initialSnap = true;
  private snapTimer = 0;
  private readonly loop = (now: number) => this.step(now);

  protected constructor(
    protected readonly host: HTMLElement,
    options: ScrollSceneOptions,
  ) {
    this.mode = options.mode;
    this.layout = options.layout;

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.pixelRatio = initialPixelRatio(options.mode, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    // Bóng chỉ đổi khi vật thể cử động: tắt tự cập nhật, lớp con bật lại theo khung hình có tư thế mới.
    this.renderer.shadowMap.autoUpdate = false;
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "pan-y";
    canvas.style.pointerEvents = "none";
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);

    this.pmrem = new PMREMGenerator(this.renderer);
    const studio = createStudioScene();
    this.envTexture = this.pmrem.fromScene(studio, 0.04).texture;
    (studio.userData.dispose as () => void)();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = options.environmentIntensity ?? 0.28;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.syncSize();
  }

  /** Ảnh tĩnh của giảm chuyển động: quy tiến trình về giá trị được phép hiển thị. */
  protected abstract stillProgress(p: number): number;
  /** Tính khung theo `this.current`, đặt vào cảnh, đặt camera, vẽ, báo cho giao diện. */
  protected abstract renderFrame(settled: boolean): void;

  private shown(p: number): number {
    return this.mode === "reduced" ? this.stillProgress(p) : p;
  }

  /** Lớp con gọi khi đã tải xong: vẽ khung đầu ngay theo vị trí cuộn hiện tại, không làm mượt, nên tải lại ở đâu cũng không nhảy. */
  protected markLoaded(): void {
    this.loaded = true;
    this.current = this.shown(this.target);
    this.renderFrame(true);
    window.clearTimeout(this.snapTimer);
    this.snapTimer = window.setTimeout(() => this.markInteracted(), 2000);
  }

  get ready(): boolean {
    return this.loaded;
  }
  get progress(): number {
    return this.current;
  }
  get targetProgress(): number {
    return this.target;
  }
  /** Cảnh đang được phép vẽ (đang ở gần khung nhìn) và có đang chờ khung kế tiếp không (kiểm thử). */
  get loopState(): { active: boolean; pending: boolean } {
    return { active: this.active, pending: this.rafId !== 0 };
  }
  get framesRendered(): number {
    return this.renderer.info.render.frame;
  }

  markInteracted(): void {
    this.initialSnap = false;
    window.clearTimeout(this.snapTimer);
  }

  setTargetProgress(p: number): void {
    const clamped = Math.min(1, Math.max(0, p));
    if (clamped === this.target) return;
    this.target = clamped;
    if (this.initialSnap) this.current = this.shown(clamped);
    this.start();
  }

  setMode(mode: SceneMode, layout: SceneLayout): void {
    if (mode === this.mode && layout === this.layout) return;
    this.mode = mode;
    this.layout = layout;
    this.current = this.shown(this.target);
    this.start();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.resize();
    else if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private syncSize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
  }

  resize(): void {
    this.syncSize();
    this.start();
  }

  /** Vẽ lại ngay một khung (khi một thông số bên ngoài như vùng giao diện đổi). */
  protected redraw(): void {
    if (this.loaded && !this.disposed) this.renderFrame(true);
  }

  protected start(): void {
    if (this.disposed || !this.loaded || !this.active || this.rafId) return;
    this.lastTime = 0;
    this.rafId = requestAnimationFrame(this.loop);
  }

  private step(now: number): void {
    this.rafId = 0;
    if (this.disposed || !this.loaded || !this.active) return;
    const dt = this.lastTime ? Math.min(MAX_DT, (now - this.lastTime) / 1000) : 1 / 60;
    this.lastTime = now;
    this.adaptResolution(dt * 1000);
    const goal = this.shown(this.target);
    const tau = SMOOTHING_TAU[this.mode];
    if (tau === 0) this.current = goal;
    else this.current += (goal - this.current) * (1 - Math.exp(-dt / tau));
    // Hội tụ thì chốt đúng đích (không để lại sai số): cùng p luôn cho cùng khung hình.
    const settled = Math.abs(goal - this.current) < EPSILON;
    if (settled) this.current = goal;
    this.renderFrame(settled);
    if (!settled) this.rafId = requestAnimationFrame(this.loop);
  }

  /**
   * Độ phân giải thích ứng: chỉ hạ, không nâng lại (tránh dao động). Chỉ tính khi đang chuyển động liên tục (khung đầu sau mỗi lần dừng không tính) và
   * không bao giờ xuống dưới tỉ lệ 1 của chính màn hình.
   */
  private adaptResolution(frameMs: number): void {
    const floor = Math.min(1, window.devicePixelRatio || 1);
    if (frameMs < SLOW_FRAME_MS || this.pixelRatio <= floor) {
      this.slowFrames = 0;
      return;
    }
    if (++this.slowFrames < SLOW_FRAMES_TO_DOWNSCALE) return;
    this.slowFrames = 0;
    this.pixelRatio = Math.max(floor, this.pixelRatio - PIXEL_RATIO_STEP);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.syncSize();
  }

  /** Tỉ lệ điểm ảnh đang dùng (kiểm thử và chẩn đoán). */
  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  /** Lớp con gọi `super.dispose()` sau khi giải phóng phần của mình. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this.snapTimer);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.resizeObserver.disconnect();
    this.envTexture.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
