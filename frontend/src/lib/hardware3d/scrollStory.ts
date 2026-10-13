import { Vector3 } from "three";
import { BEATS, type Layout, type StageConfig } from "./animationConfig";
import { buildHardwareAssembly, type HardwareAssembly } from "./assembly";
import { PART_IDS, type PartId } from "./assemblyConfig";
import { snapProgress, type FrameState } from "./timeline";
import { HardwareViewer } from "./viewer";

/**
 * Điều khiển cảnh cuộn: nhận tiến trình cuộn thật của trình duyệt (0 → 1), làm mượt, tính tư thế từ `timeline` (hàm thuần) và vẽ.
 * - Trạng thái hoạt ảnh (`current`, `target`) nằm ở đây; vị trí nhà và trạm nằm ở `assemblyConfig.ts` và không bao giờ bị ghi.
 * - Vòng lặp rAF chỉ chạy khi còn đang tiến tới đích; hội tụ xong thì dừng hẳn (0 khung hình khi trang đứng yên).
 * - Canvas không nhận sự kiện con trỏ nên không chặn cuộn trang.
 */

export type StoryMode = "full" | "lite" | "reduced";

export interface StoryAnchor {
  x: number;
  y: number;
  visible: boolean;
}

export interface StoryFrameInfo {
  /** Tiến trình đang hiển thị (đã làm mượt, đã quy về ảnh tĩnh nếu giảm chuyển động). */
  progress: number;
  /** Tiến trình đích theo vị trí cuộn. */
  target: number;
  stage: StageConfig;
  /** Đang cuộn lùi (lắp lại). */
  reverse: boolean;
  beatOpacity: readonly number[];
  activeBeat: number;
  anchors: readonly StoryAnchor[];
  /** Đã hội tụ về đích: vòng lặp dừng sau khung hình này. */
  settled: boolean;
}

export interface StoryOptions {
  mode: StoryMode;
  layout: Layout;
  onFrame?: (info: StoryFrameInfo) => void;
}

/** Hằng thời gian làm mượt (giây): nhỏ hơn = bám cuộn sát hơn. */
const SMOOTHING_TAU: Record<StoryMode, number> = { full: 0.11, lite: 0.07, reduced: 0 };
const EPSILON = 1e-5;
const MAX_DT = 0.1;

const toScene = (c: Vector3, out: Vector3) => out.set(c.x, c.z, -c.y);

/** Vùng bị chữ giới thiệu chiếm, px tính từ từng mép của khung 3D. */
export interface HeroInset {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export class HardwareScrollStory {
  readonly viewer: HardwareViewer;
  private assembly: HardwareAssembly | null = null;
  private mode: StoryMode;
  private layout: Layout;
  private readonly onFrame: ((info: StoryFrameInfo) => void) | undefined;

  private current = 0;
  private target = 0;
  private reverse = false;
  private rafId = 0;
  private lastTime = 0;
  private active = true;
  private disposed = false;
  /**
   * Cho tới khi người dùng thật sự thao tác (hoặc hết thời gian chờ), mọi thay đổi vị trí cuộn do trình duyệt khôi phục
   * (tải lại trang giữa chừng) được áp dụng tức thì thay vì chạy lại hoạt ảnh.
   */
  private initialSnap = true;
  private snapTimer = 0;
  private frame: FrameState | null = null;
  private readonly sceneTarget = new Vector3();
  private heroInset: HeroInset | null = null;
  private lastPosKey = Number.NaN;
  private readonly anchorWorld = new Vector3();
  private readonly anchors: StoryAnchor[] = BEATS.map(() => ({ x: 0, y: 0, visible: false }));
  private readonly loop = (now: number) => this.step(now);

  constructor(
    private readonly host: HTMLElement,
    options: StoryOptions,
  ) {
    this.mode = options.mode;
    this.layout = options.layout;
    this.onFrame = options.onFrame;
    this.viewer = new HardwareViewer(host, {
      interactive: false,
      maxPixelRatio: options.mode === "lite" ? 1.5 : 2,
      ground: { resolution: options.mode === "lite" ? 128 : 256 },
    });
  }

  /** Tải STL và GLB rồi dựng cụm. Gọi một lần; ném lỗi nếu không tải được STL vỏ. */
  async load(): Promise<HardwareAssembly> {
    const assembly = await buildHardwareAssembly();
    if (this.disposed) {
      assembly.dispose();
      throw new Error("Cảnh đã bị huỷ trước khi tải xong.");
    }
    this.assembly = assembly;
    this.frame = assembly.timeline.createFrame();
    this.viewer.setAssembly(assembly);
    // Khung hình đầu tiên đặt ngay theo vị trí cuộn hiện tại, không làm mượt, nên tải lại ở bất kỳ vị trí cuộn nào đều không nhảy.
    this.current = this.shownProgress(this.target);
    this.render(true);
    window.clearTimeout(this.snapTimer);
    this.snapTimer = window.setTimeout(() => this.markInteracted(), 2000);
    return assembly;
  }

  /** Người dùng đã thao tác (bánh xe, chạm, phím): từ nay mọi thay đổi cuộn được làm mượt. */
  markInteracted(): void {
    this.initialSnap = false;
    window.clearTimeout(this.snapTimer);
  }

  get ready(): boolean {
    return this.assembly !== null;
  }

  get progress(): number {
    return this.current;
  }

  get targetProgress(): number {
    return this.target;
  }

  get currentMode(): StoryMode {
    return this.mode;
  }

  /** Số lần vẽ của renderer (để kiểm tra không vẽ thừa khi trang đứng yên). */
  get framesRendered(): number {
    return this.viewer.renderer.info.render.frame;
  }

  /** Quy tiến trình về giá trị hiển thị (giảm chuyển động chỉ có ba ảnh tĩnh). */
  private shownProgress(p: number): number {
    return this.mode === "reduced" ? snapProgress(p) : p;
  }

  /** Vị trí thật của các nhóm đang được vẽ (khung CAD), để kiểm thử so với trạng thái nhà/trạm. */
  renderedPositions(): Record<PartId, [number, number, number]> {
    const out = {} as Record<PartId, [number, number, number]>;
    for (const id of PART_IDS) {
      const o = this.assembly?.parts.get(id)?.object.position;
      out[id] = o ? [o.x, o.y, o.z] : [NaN, NaN, NaN];
    }
    return out;
  }

  get timeline() {
    return this.assembly?.timeline ?? null;
  }

  /** Đặt tiến trình đích từ vị trí cuộn. Gọi nhiều lần liên tiếp rất rẻ. */
  setTargetProgress(p: number): void {
    const clamped = Math.min(1, Math.max(0, p));
    if (clamped === this.target) return;
    this.reverse = clamped < this.target;
    this.target = clamped;
    if (this.initialSnap) this.current = this.shownProgress(clamped);
    this.start();
  }

  setMode(mode: StoryMode, layout: Layout): void {
    if (mode === this.mode && layout === this.layout) return;
    this.mode = mode;
    this.layout = layout;
    this.current = this.shownProgress(this.target);
    this.start();
  }

  /** Tạm dừng khi cảnh ra khỏi màn hình; bật lại thì vẽ ngay theo vị trí cuộn hiện tại. */
  setActive(active: boolean): void {
    this.active = active;
    if (active) {
      this.current = this.mode === "reduced" ? this.shownProgress(this.target) : this.current;
      this.viewer.resize();
      this.start();
    } else if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /**
   * Vùng (px, tính từ mép khung) bị chữ giới thiệu chiếm: thiết bị ở khung hero sẽ nằm gọn trong phần còn lại.
   * Truyền null để dùng khung mặc định (dịch cố định theo tỉ lệ).
   */
  setHeroInset(inset: HeroInset | null): void {
    const same = inset && this.heroInset && inset.left === this.heroInset.left && inset.right === this.heroInset.right && inset.top === this.heroInset.top && inset.bottom === this.heroInset.bottom;
    if (same || (!inset && !this.heroInset)) return;
    this.heroInset = inset;
    this.start();
  }

  /** Báo kích thước khung đã đổi: đặt lại góc máy theo tỉ lệ mới ở khung hình kế tiếp. */
  resize(): void {
    this.viewer.resize();
    this.start();
  }

  private start(): void {
    if (this.disposed || !this.assembly || !this.active || this.rafId) return;
    this.lastTime = 0;
    this.rafId = requestAnimationFrame(this.loop);
  }

  private step(now: number): void {
    this.rafId = 0;
    if (this.disposed || !this.assembly || !this.active) return;
    const dt = this.lastTime ? Math.min(MAX_DT, (now - this.lastTime) / 1000) : 1 / 60;
    this.lastTime = now;

    const goal = this.shownProgress(this.target);
    const tau = SMOOTHING_TAU[this.mode];
    if (tau === 0) this.current = goal;
    else this.current += (goal - this.current) * (1 - Math.exp(-dt / tau));
    // Hội tụ thì chốt đúng đích (không để lại sai số): p = 0 luôn là đúng vị trí nhà.
    const settled = Math.abs(goal - this.current) < EPSILON;
    if (settled) this.current = goal;

    this.render(settled);
    if (!settled) this.rafId = requestAnimationFrame(this.loop);
  }

  /** Tính tư thế theo `current`, đặt vào cảnh, đặt camera, vẽ và báo cho giao diện. */
  private render(settled: boolean): void {
    const assembly = this.assembly;
    if (!assembly) return;
    this.frame ??= assembly.timeline.createFrame();
    const frame = assembly.timeline.evaluate(this.current, this.layout, this.frame);
    assembly.applyPositions(frame.positions);
    // Vị trí vật thể chỉ đổi trong đoạn mở nắp và tách; ngoài đoạn đó (khám phá, tổng quan) bóng sàn giữ nguyên.
    let posKey = 0;
    for (const id of PART_IDS) {
      const v = frame.positions[id];
      posKey += v.x * 1.3 + v.y * 1.7 + v.z * 2.1;
    }
    if (posKey !== this.lastPosKey) {
      this.lastPosKey = posKey;
      this.viewer.invalidateGround();
    }

    const cam = frame.camera;
    let shiftX = cam.shiftX;
    let shiftY = cam.shiftY;
    let fitX = 1;
    let fitY = 1;
    const inset = this.heroInset;
    if (inset && cam.hero > 0) {
      // Khung hero: đặt thiết bị vào chính giữa vùng trống còn lại (bên phải chữ, hoặc phía dưới chữ ở bố cục hẹp) và co cho vừa vùng đó.
      const W = Math.max(1, this.host.clientWidth);
      const H = Math.max(1, this.host.clientHeight);
      const w = cam.hero;
      if (this.layout === "wide") {
        const free = Math.max(0.25 * W, W - inset.left - inset.right);
        shiftX += (-(inset.left + free / 2 - W / 2) / W - shiftX) * w;
        fitX += (free / W - 1) * w;
      } else {
        const free = Math.max(0.25 * H, H - inset.top - inset.bottom);
        shiftY += (-(inset.top + free / 2 - H / 2) / H - shiftY) * w;
        fitY += (free / H - 1) * w;
      }
    }
    this.viewer.placeCamera(toScene(cam.center, this.sceneTarget), cam.azimuth, cam.elevation, cam.radius, cam.margin, shiftX, shiftY, fitX, fitY);

    // Linh kiện đang giới thiệu nổi lên: các vật thể còn lại tối dần theo độ hiện của nhãn (không vẽ khung dây kiểu CAD).
    // Giảm chuyển động: không có nhịp nào nên không làm tối.
    const beat = frame.activeBeat;
    if (this.mode !== "reduced" && beat >= 0) assembly.setFocus(BEATS[beat]!.parts, frame.beatOpacity[beat]!);
    else assembly.setFocus(null, 0);

    this.viewer.renderNow();

    for (let k = 0; k < BEATS.length; k++) {
      const a = this.anchors[k]!;
      if (frame.beatOpacity[k]! <= 0.01 || this.mode === "reduced") {
        a.visible = false;
        continue;
      }
      // Điểm neo của nhãn: tâm linh kiện đầu tiên của nhịp, theo vị trí đang vẽ.
      toScene(frame.positions[BEATS[k]!.parts[0]!], this.anchorWorld);
      this.viewer.project(this.anchorWorld, a);
    }

    this.onFrame?.({
      progress: this.current,
      target: this.target,
      stage: frame.stage,
      reverse: this.reverse,
      beatOpacity: frame.beatOpacity,
      activeBeat: frame.activeBeat,
      anchors: this.anchors,
      settled,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this.snapTimer);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.viewer.setAssembly(null);
    this.assembly?.dispose();
    this.viewer.dispose();
  }
}
