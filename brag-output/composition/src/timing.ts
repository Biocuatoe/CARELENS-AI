/**
 * Storyboard clock. Single source of truth for scene boundaries (seconds). The sum is exactly 30 s = 900 frames @ 30 fps.
 * All animation in the composition is a pure function of t, so any frame can be rendered independently (and in parallel).
 */
export const FPS = 30;
export const DURATION = 30;
export const FRAMES = FPS * DURATION;
export const W = 1920;
export const H = 1080;

export const SCENES = {
  s1: [0, 3],
  s2: [3, 8.5],
  s3: [8.5, 14],
  s4: [14, 19.5],
  s5: [19.5, 23.5],
  s6: [23.5, 26],
  s7: [26, 30],
} as const;

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0→1 progress of t across [a, b]. */
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const smooth = (x: number) => x * x * (3 - 2 * x);
export const smoother = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
export const sm = (t: number, a: number, b: number) => smooth(seg(t, a, b));
export const sm5 = (t: number, a: number, b: number) => smoother(seg(t, a, b));
export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Piecewise-linear map: keys are [t, value] sorted by t. Optional easing is applied inside each span. */
export function track(t: number, keys: ReadonlyArray<readonly [number, number]>, ease: (x: number) => number = smooth): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    const [t0, v0] = keys[i - 1]!;
    if (t <= t1) return lerp(v0, v1, ease(seg(t, t0, t1)));
  }
  return keys[keys.length - 1]![1];
}
/** Opacity window with fade in/out: 0 outside [a, b], ramps over fi / fo seconds inside. */
export function win(t: number, a: number, b: number, fi = 0.25, fo = 0.25): number {
  return Math.min(sm(t, a, a + fi), 1 - sm(t, b - fo, b));
}
