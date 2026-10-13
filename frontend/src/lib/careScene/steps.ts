/**
 * Ba bước của tình huống 01 theo tiến trình cuộn p ∈ [0, 1]: `from` là điểm bắt đầu, `rest` là ảnh tĩnh khi giảm chuyển động và đích khi
 * bấm chọn bước. Không phụ thuộc three.js: giao diện landing dùng được mà không tải cảnh 3D.
 */
export const FALL_STEPS = [
  { id: "normal", from: 0, rest: 0.1 },
  { id: "change", from: 0.24, rest: 0.4 },
  { id: "notify", from: 0.66, rest: 0.94 },
] as const;

export type FallStepIndex = 0 | 1 | 2;

export function stepAt(p: number): FallStepIndex {
  if (p >= FALL_STEPS[2].from) return 2;
  if (p >= FALL_STEPS[1].from) return 1;
  return 0;
}
