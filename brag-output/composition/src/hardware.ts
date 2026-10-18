import { DirectionalLight, HemisphereLight, SpotLight, Vector3 } from "three";
import { HardwareViewer, buildHardwareAssembly, type HardwareAssembly, type PartId } from "@fe/lib/hardware3d";
import { BEATS, beatCenterP } from "@fe/lib/hardware3d/animationConfig";
import type { FrameState } from "@fe/lib/hardware3d/timeline";

/**
 * Director for the real CareLens hardware assembly (STL enclosure + GLB/procedural components) used by the landing page.
 * It reuses `HardwareViewer`, `buildHardwareAssembly` and `timeline.evaluate(p)` exactly as `HardwareScrollStory` does, but lets the video
 * place the camera and the lights itself (opening sweep, lens close-up, lens-fill shot). Poses of parts are always `timeline.evaluate(p)`.
 */

export interface Cam {
  /** Look-at point in three.js scene coordinates (mm). CAD (x, y, z) maps to scene (x, z, -y). */
  target: Vector3;
  /** Degrees. 0 = looking at the device front (the camera-window face) from +Z. */
  az: number;
  el: number;
  /** Distance from target to camera (mm). */
  dist: number;
  fov?: number;
  /** View-offset in fractions of the frame (x > 0 pushes the subject left). */
  shiftX?: number;
}

export interface Screen {
  x: number;
  y: number;
  visible: boolean;
}

export const cadToScene = (v: { x: number; y: number; z: number }, out = new Vector3()) => out.set(v.x, v.z, -v.y);

/** Centre of the 8 x 8 mm camera window in scene coordinates (CAD x = 21.5, y = 0 front face, z = 20.5). */
export const LENS_SCENE = new Vector3(21.5, 20.5, 0);

export class HardwareDirector {
  viewer!: HardwareViewer;
  assembly!: HardwareAssembly;
  frame!: FrameState;
  private base: Array<{ light: DirectionalLight | HemisphereLight; intensity: number }> = [];
  private baseEnv = 0.72;
  readonly spot = new SpotLight(0xfff4e6, 0, 0, 0.16, 0.85, 0);
  private lastKey = Number.NaN;

  async init(host: HTMLElement, pixelRatio: number): Promise<void> {
    this.viewer = new HardwareViewer(host, { interactive: false, maxPixelRatio: pixelRatio, ground: { resolution: 256 } });
    this.viewer.renderer.setPixelRatio(pixelRatio);
    this.viewer.resize();
    this.assembly = await buildHardwareAssembly();
    this.frame = this.assembly.timeline.createFrame();
    this.viewer.setAssembly(this.assembly);
    for (const o of this.viewer.scene.children) {
      if (o instanceof DirectionalLight || o instanceof HemisphereLight) this.base.push({ light: o, intensity: o.intensity });
    }
    this.baseEnv = this.viewer.scene.environmentIntensity;
    this.viewer.scene.add(this.spot, this.spot.target);
  }

  /** Poses every part at timeline progress p (the same function the landing page uses while scrolling). */
  pose(p: number): FrameState {
    const f = this.assembly.timeline.evaluate(p, "wide", this.frame);
    this.assembly.applyPositions(f.positions);
    let key = 0;
    for (const id of Object.keys(f.positions) as PartId[]) {
      const v = f.positions[id];
      key += v.x * 1.3 + v.y * 1.7 + v.z * 2.1;
    }
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.viewer.invalidateGround();
    }
    return f;
  }

  /** Scene-space centre of a part at the last evaluated pose. */
  partScene(id: PartId, out = new Vector3()): Vector3 {
    return cadToScene(this.frame.positions[id], out);
  }

  /** Studio lighting level: 1 = the landing page's lighting; 0 = dark. `spot` adds the travelling highlight used in the opening. */
  lights(level: number, spot?: { pos: Vector3; target: Vector3; intensity: number; angle?: number; penumbra?: number }): void {
    for (const b of this.base) b.light.intensity = b.intensity * level;
    this.viewer.scene.environmentIntensity = this.baseEnv * level;
    if (spot && spot.intensity > 0) {
      this.spot.visible = true;
      this.spot.position.copy(spot.pos);
      this.spot.target.position.copy(spot.target);
      this.spot.intensity = spot.intensity;
      this.spot.angle = spot.angle ?? 0.16;
      this.spot.penumbra = spot.penumbra ?? 0.85;
    } else {
      this.spot.visible = false;
    }
  }

  camera(c: Cam): void {
    const cam = this.viewer.camera;
    const az = (c.az * Math.PI) / 180;
    const el = (c.el * Math.PI) / 180;
    const ce = Math.cos(el);
    cam.position.set(c.target.x + c.dist * ce * Math.sin(az), c.target.y + c.dist * Math.sin(el), c.target.z + c.dist * ce * Math.cos(az));
    cam.fov = c.fov ?? 30;
    cam.near = Math.max(0.2, c.dist / 120);
    cam.far = c.dist * 14 + 600;
    cam.lookAt(c.target);
    const w = this.viewer.renderer.domElement.clientWidth || 1920;
    const h = this.viewer.renderer.domElement.clientHeight || 1080;
    if (c.shiftX) cam.setViewOffset(w, h, c.shiftX * w, 0, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  /** Camera derived from the landing page's own timeline camera at progress p (centre, azimuth, elevation, framing radius). */
  timelineCamera(p: number, shiftX = 0): Cam {
    const f = this.assembly.timeline.evaluate(p, "wide", this.frame);
    const cam = f.camera;
    const target = cadToScene(cam.center);
    const vFov = (30 * Math.PI) / 180;
    const aspect = 16 / 9;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const dist = Math.max(30, (cam.radius * cam.margin) / Math.sin(hFov / 2), (cam.radius * cam.margin) / Math.sin(vFov / 2));
    return { target, az: cam.azimuth, el: cam.elevation, dist, shiftX };
  }

  /** Dims every part except `parts` (the landing page's focus effect for the explore beats). */
  focus(parts: readonly PartId[] | null, amount: number): void {
    this.assembly.setFocus(parts, amount);
  }

  render(): void {
    this.viewer.renderNow();
  }

  project(world: Vector3, out: Screen): Screen {
    this.viewer.project(world, out);
    const w = this.viewer.renderer.domElement.clientWidth || 1920;
    const h = this.viewer.renderer.domElement.clientHeight || 1080;
    // `project` clips to the frame; keep raw coordinates even when slightly outside.
    const v = world.clone().project(this.viewer.camera);
    out.x = (v.x * 0.5 + 0.5) * w;
    out.y = (-v.y * 0.5 + 0.5) * h;
    return out;
  }
}

export { BEATS, beatCenterP };
