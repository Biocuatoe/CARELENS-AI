/**
 * Bốn bước của tình huống quan sát hoạt động theo tiến trình cuộn p ∈ [0, 1]. `from` là điểm bắt đầu; `rest` là ảnh tĩnh khi giảm chuyển động
 * và là đích khi bấm chọn bước. Không phụ thuộc three.js: giao diện dùng được mà không tải cảnh 3D.
 */
export const MED_STEPS = [
  { id: "action", from: 0, rest: 0.3 },
  { id: "observe", from: 0.34, rest: 0.47 },
  { id: "packet", from: 0.55, rest: 0.69 },
  { id: "send", from: 0.73, rest: 1 },
] as const;

export type MedStepIndex = 0 | 1 | 2 | 3;

export function medStepAt(p: number): MedStepIndex {
  let s = 0;
  for (let i = 1; i < MED_STEPS.length; i++) if (p >= MED_STEPS[i]!.from) s = i;
  return s as MedStepIndex;
}
