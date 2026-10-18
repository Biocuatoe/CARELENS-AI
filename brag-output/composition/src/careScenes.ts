import { Vector3 } from "three";
import { FallScene, MedicationScene, type FallSceneFrame, type MedSceneFrame } from "@fe/lib/careScene";

/**
 * The landing page drives these scenes from scroll with a real-time smoothing loop. For video we need a pure function of time, so we
 * stop the scene's own rAF loop (`setActive(false)`), write the progress directly and call the scene's `renderFrame`. Both fields are
 * `protected` in the source; the casts below are the only place the composition reaches past the public API, and the source is not modified.
 */
interface Driveable {
  current: number;
  target: number;
  renderFrame(settled: boolean): void;
}

function drive(scene: object, p: number): void {
  const s = scene as unknown as Driveable;
  s.current = p;
  s.target = p;
  s.renderFrame(true);
}

export class FallDirector {
  scene!: FallScene;
  lastFrame: FallSceneFrame | null = null;
  async init(host: HTMLElement, pixelRatio: number, insets: { cardRight: number; cardBottom: number; panelTop: number }): Promise<void> {
    this.scene = new FallScene(host, { mode: "full", layout: "wide", onFrame: (f) => (this.lastFrame = f) });
    this.scene.setActive(false);
    this.scene.renderer.setPixelRatio(pixelRatio);
    this.scene.setInsets(insets);
    await this.scene.load();
    this.scene.setActive(false);
    this.scene.renderer.setPixelRatio(pixelRatio);
    this.scene.renderer.setSize(host.clientWidth, host.clientHeight, false);
  }
  /** Screen position (px) of the wearable device on the chest at the last drawn frame. */
  device(out = { x: 0, y: 0 }): { x: number; y: number } {
    const fig = (this.scene as unknown as { figure: { devicePosition(v: Vector3): Vector3 } }).figure;
    const v = fig.devicePosition(new Vector3()).project(this.scene.camera);
    out.x = (v.x * 0.5 + 0.5) * 1920;
    out.y = (-v.y * 0.5 + 0.5) * 1080;
    return out;
  }
  draw(p: number): void {
    drive(this.scene, p);
  }
}

export class MedDirector {
  scene!: MedicationScene;
  lastFrame: MedSceneFrame | null = null;
  async init(host: HTMLElement, pixelRatio: number): Promise<void> {
    this.scene = new MedicationScene(host, { mode: "full", layout: "wide", onFrame: (f) => (this.lastFrame = f) });
    this.scene.setActive(false);
    this.scene.renderer.setPixelRatio(pixelRatio);
    await this.scene.load();
    this.scene.setActive(false);
    this.scene.renderer.setPixelRatio(pixelRatio);
    this.scene.renderer.setSize(host.clientWidth, host.clientHeight, false);
  }
  /** `s` is the whole-story progress; chapter 0 (observation) is s in [0, STORY_SPLIT = 0.488]. */
  draw(s: number): void {
    drive(this.scene, s);
  }
}
