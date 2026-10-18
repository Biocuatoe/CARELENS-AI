import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Vector3 } from "three";
import "./styles.css";
import { HardwareDirector, LENS_SCENE, BEATS, beatCenterP, type Cam, type Screen } from "./hardware";
import { FallDirector, MedDirector } from "./careScenes";
import { Overlay, type FrameData } from "./Overlay";
import { SCENES, W, H, clamp01, lerp, sm, sm5, easeInOut, track, win } from "./timing";
import type { PartId } from "@fe/lib/hardware3d";

const params = new URLSearchParams(location.search);
const PR = Number(params.get("pr") ?? "1.5");

const lin = (x: number) => x;
const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);
const DEVICE_CENTER = v3(21.5, 32.5, -16);
/** Centre of the lens barrel, about 1.6 mm below the centre of the square window (measured from the lens-fill render). */
const LENS_CENTER = v3(21.5, 18.9, 0);

const mixCam = (a: Cam, b: Cam, k: number): Cam => ({
  target: a.target.clone().lerp(b.target, k),
  az: lerp(a.az, b.az, k),
  el: lerp(a.el, b.el, k),
  dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), k)),
  fov: lerp(a.fov ?? 30, b.fov ?? 30, k),
  shiftX: lerp(a.shiftX ?? 0, b.shiftX ?? 0, k),
});

/** Parts labelled in the exploded view (landing BEATS titles, in the brief's priority order). */
export const EXPLODED_LABELS: ReadonlyArray<{ part: PartId; beat: number }> = [
  { part: "esp32-cam", beat: 0 },
  { part: "gy521", beat: 4 },
  { part: "lipo-cell", beat: 1 },
  { part: "tp4056", beat: 2 },
  { part: "speaker", beat: 6 },
  { part: "max98357a", beat: 5 },
  { part: "slide-switch", beat: 7 },
];

async function boot() {
  const stage = document.getElementById("stage")!;
  const mk = (cls: string) => {
    const d = document.createElement("div");
    d.className = cls;
    stage.appendChild(d);
    return d;
  };
  const hwHost = mk("host");
  const fallHost = mk("host");
  const medHost = mk("host");
  const uiHost = mk("layer");

  await Promise.all(
    [
      ...["500", "600", "700", "800"].map((w) => document.fonts.load(`${w} 40px "Plus Jakarta Sans"`, "Chúc mừng Ngày Phụ nữ Việt Nam ặệữ")),
      ...["400", "500"].map((w) => document.fonts.load(`${w} 20px "JetBrains Mono"`, "Hỗ trợ dùng thuốc ặệữ")),
    ],
  );
  await document.fonts.ready;

  const hw = new HardwareDirector();
  const fall = new FallDirector();
  const med = new MedDirector();
  await hw.init(hwHost, PR);
  await fall.init(fallHost, PR, { cardRight: 600, cardBottom: 0, panelTop: 0 });
  await med.init(medHost, PR);
  const root = createRoot(uiHost);

  const tmp = new Vector3();
  const lensScr: Screen = { x: 0, y: 0, visible: true };

  function setTime(t: number) {
    const S = SCENES;
    const data: FrameData = { t, anchors: {}, lens: lensScr, fallDevice: { x: 0, y: 0 }, fallFrame: null, medAnchors: null, hwOpacity: 0, fallOpacity: 0, medOpacity: 0, hwP: 0, medP: 0 };

    // ---------- Hardware ----------
    const hwOn = t < 8.75 || (t >= 23.1 && t < 26.2);
    data.hwOpacity = t < 8.75 ? 1 - sm(t, 8.3, 8.7) : sm(t, 23.2, 23.7) * (1 - sm(t, 25.45, 25.75));
    if (hwOn && data.hwOpacity > 0.001) {
      let p = 0;
      let cam: Cam;
      let level = 1;
      let spot: Parameters<HardwareDirector["lights"]>[1];
      let focus: { parts: PartId[]; amt: number } | null = null;
      if (t < S.s2[0]) {
        // Scene 1: dark; a narrow highlight travels along the enclosure and settles on the camera window.
        const k = 0.55 * easeInOut(t / 3) + 0.45 * (t / 3);
        const start: Cam = { target: DEVICE_CENTER.clone(), az: 38, el: 15, dist: 235, shiftX: -0.2 };
        const end: Cam = { target: LENS_SCENE.clone(), az: 8, el: 3, dist: 100, shiftX: -0.2 };
        cam = mixCam(start, end, k);
        const sweep = sm5(t, 0.1, 2.35);
        const az = (lerp(-95, 4, sweep) * Math.PI) / 180;
        const elev = (lerp(34, 6, sweep) * Math.PI) / 180;
        const R = 170;
        const pos = v3(21.5 + R * Math.cos(elev) * Math.sin(az), 20 + R * Math.sin(elev), R * Math.cos(elev) * Math.cos(az));
        const tgt = v3(lerp(2, 21.5, sweep), lerp(52, 20.5, sweep), lerp(-6, 0, sweep));
        const spotI = 3.4 * sm(t, 0.0, 0.35);
        level = 0.035 + 0.965 * sm5(t, 2.5, 3.9);
        spot = { pos, target: tgt, intensity: spotI * (1 - sm(t, 3.0, 3.6)), angle: lerp(0.1, 0.05, sweep), penumbra: 1 };
      } else if (t < 8.75) {
        // Scene 2: pull back, open the lid, separate the components, then close up on the camera board and the motion sensor.
        p = track(t, [[3.0, 0], [3.9, 0.08], [4.9, 0.2], [6.9, 0.58], [8.75, 0.6]], lin);
        const s1End: Cam = { target: LENS_SCENE.clone(), az: 8, el: 3, dist: 100, shiftX: -0.2 };
        const base = hw.timelineCamera(Math.min(p, 0.58), -0.08);
        cam = mixCam(s1End, base, easeInOut(clamp01((t - 3.0) / 1.2)));
        // close-up: camera board, then GY-521 (poses taken from the landing BEATS camera keys)
        const A = hw.timelineCamera(beatCenterP(0), 0.17);
        const B = hw.timelineCamera(beatCenterP(4), 0.17);
        const toA = easeInOut(clamp01((t - 6.9) / 0.6));
        const toB = easeInOut(clamp01((t - 7.85) / 0.5));
        const ov = hw.timelineCamera(0.58, -0.08);
        const camA = mixCam(ov, A, toA);
        cam = t >= 6.9 ? mixCam(camA, B, toB) : cam;
        const f = sm(t, 6.9, 7.4);
        const fAmt = f * (1 - toB) + toB * 1;
        focus = f > 0 ? { parts: toB > 0.5 ? [...BEATS[4]!.parts] : [...BEATS[0]!.parts], amt: Math.min(1, fAmt) } : null;
        level = 1;
      } else {
        // Scene 6: same device, facing the viewer; the camera pushes in until the lens fills the frame.
        const k = clamp01((t - 23.5) / 1.85);
        const e = k * k * (3 - 2 * k) * 0.55 + k ** 3 * 0.45;
        const start: Cam = { target: v3(21.5, 31, 0), az: 0, el: 0, dist: 210 };
        const end: Cam = { target: LENS_CENTER.clone(), az: 0, el: 0, dist: 6.2 };
        cam = mixCam(start, end, e);
        level = 0.9;
        spot = { pos: v3(21.5, 24, 90), target: LENS_SCENE.clone(), intensity: 3 * sm(t, 24.0, 25.2), angle: 0.14, penumbra: 1 };
      }
      hw.pose(p);
      data.hwP = p;
      hw.lights(level, spot);
      hw.camera(cam);
      if (focus) hw.focus(focus.parts, focus.amt);
      else hw.focus(null, 0);
      hw.render();
      hw.project(t >= 23 ? LENS_CENTER : LENS_SCENE, lensScr);
      for (const l of EXPLODED_LABELS) {
        const a: Screen = { x: 0, y: 0, visible: true };
        hw.partScene(l.part, tmp);
        hw.project(tmp, a);
        data.anchors[l.part] = a;
      }
    }

    // ---------- Fall ----------
    data.fallOpacity = win(t, 8.3, 14.25, 0.4, 0.4);
    if (data.fallOpacity > 0.001) {
      const p = track(t, [[8.5, 0.1], [9.1, 0.2], [10.5, 0.54], [11.5, 0.7], [12.3, 0.84], [14.0, 0.94]], lin);
      fall.draw(p);
      data.fallDevice = fall.device();
      data.fallFrame = fall.lastFrame;
    }

    // ---------- Medication story (chapter 0) ----------
    data.medOpacity = win(t, 15.3, 23.6, 0.4, 0.4);
    if (data.medOpacity > 0.001) {
      const p = track(t, [[15.3, 0], [16.2, 0.3], [17.1, 0.5], [18.0, 0.7], [19.4, 1], [23.6, 1]], lin);
      med.draw(p * 0.488);
      data.medP = p;
      data.medAnchors = med.lastFrame;
    }

    for (const [host, o] of [[hwHost, data.hwOpacity], [fallHost, data.fallOpacity], [medHost, data.medOpacity]] as const) {
      host.style.opacity = String(o);
      host.style.visibility = o > 0.001 ? "visible" : "hidden";
    }
    flushSync(() => root.render(<Overlay {...data} />));
  }

  (window as unknown as { __brag: unknown }).__brag = { setTime, ready: true, W, H };
}

boot().catch((e) => {
  console.error(e);
  (window as unknown as { __bragError: string }).__bragError = String(e?.stack ?? e);
});
