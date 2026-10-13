import { MED_STEPS } from "./medicationSteps";

/**
 * Câu chuyện nối ba chương trên cùng một khung cảnh 3D: quan sát hoạt động (chương 0), bảo vệ dữ liệu (chương 1), tổng quan hôm nay (chương 2).
 * Tiến trình cuộn của cả vùng là s ∈ [0, 1]; mỗi chương có tiến trình riêng p ∈ [0, 1] để dòng thời gian của từng chương giữ nguyên.
 * Không phụ thuộc three.js: giao diện dùng được mà không tải cảnh 3D.
 */

/** Điểm nối quan sát → bảo vệ và bảo vệ → tổng quan theo s. Độ dài vùng cuộn: quan sát ≈ 395 svh, bảo vệ ≈ 245 svh, tổng quan ≈ 170 svh. */
export const STORY_SPLIT = 0.488;
export const STORY_SPLIT_REPORT = 0.79;

export type StoryChapter = 0 | 1 | 2;

/** Khoảng cuối của chương tổng quan (theo p của chương) trong đó nội dung báo cáo cao hơn khung được cuộn lên; báo cáo đứng yên nếu vừa khung. */
export const REPORT_HOLD = [0.84, 1] as const;

/** Ba bước của chương bảo vệ theo p của chương. `rest` là ảnh tĩnh khi giảm chuyển động và là đích khi bấm chọn bước. */
export const SEC_STEPS = [
  { id: "shield", from: 0.04, rest: 0.4 },
  { id: "fragment", from: 0.44, rest: 0.6 },
  // Ảnh tĩnh của bước cuối nằm sát cuối chương, không đúng điểm nối: làm tròn điểm ảnh khi cuộn không bao giờ đẩy nó sang chương tổng quan.
  { id: "digest", from: 0.66, rest: 0.97 },
] as const;

export interface StoryStep {
  id: string;
  chapter: 0 | 1;
  /** Theo s của cả câu chuyện. */
  from: number;
  rest: number;
}

/** Tiến trình p của chương `chapter` quy về s của cả câu chuyện. */
export function storyProgress(chapter: StoryChapter, p: number): number {
  if (chapter === 0) return p * STORY_SPLIT;
  if (chapter === 1) return STORY_SPLIT + p * (STORY_SPLIT_REPORT - STORY_SPLIT);
  return STORY_SPLIT_REPORT + p * (1 - STORY_SPLIT_REPORT);
}

/** Bảy bước có nút bấm (hai chương đầu). Chương tổng quan là điểm đến, không có nút riêng: bảng bước mờ đi và bản báo cáo thế chỗ. */
export const STORY_STEPS: readonly StoryStep[] = [
  ...MED_STEPS.map((s) => ({ id: s.id, chapter: 0 as const, from: storyProgress(0, s.from), rest: storyProgress(0, s.rest) })),
  ...SEC_STEPS.map((s) => ({ id: s.id, chapter: 1 as const, from: storyProgress(1, s.from), rest: storyProgress(1, s.rest) })),
];

export type StoryStepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function storyStepAt(s: number): StoryStepIndex {
  let k = 0;
  for (let i = 1; i < STORY_STEPS.length; i++) if (s >= STORY_STEPS[i]!.from) k = i;
  return k as StoryStepIndex;
}

/**
 * Chương và tiến trình trong chương. Đúng tại các điểm nối vẫn thuộc cuối chương trước, nên cảnh không đổi chương trước khi thật sự đi qua.
 */
export function splitStory(s: number): { chapter: StoryChapter; p: number } {
  const c = Math.min(1, Math.max(0, s));
  if (c <= STORY_SPLIT) return { chapter: 0, p: c / STORY_SPLIT };
  if (c <= STORY_SPLIT_REPORT) return { chapter: 1, p: (c - STORY_SPLIT) / (STORY_SPLIT_REPORT - STORY_SPLIT) };
  return { chapter: 2, p: (c - STORY_SPLIT_REPORT) / (1 - STORY_SPLIT_REPORT) };
}
