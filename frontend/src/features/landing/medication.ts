import { MEDICATION, type MedSlot } from "./content";

export type SlotState = keyof typeof MEDICATION.states;

/**
 * Trạng thái một lịch uống thuốc (mô phỏng) tại thời điểm `now` (phút từ 0h).
 * Có ghi chú quan sát thì đã quan sát; chưa tới giờ thì chờ; trong khung giờ thì mở; hết khung giờ mà không có quan sát thì "chưa ghi nhận",
 * không bao giờ là "chưa uống".
 */
export function slotState(slot: MedSlot, now: number, windowMinutes: number = MEDICATION.windowMinutes): SlotState {
  if (slot.observed !== null && now >= slot.observed) return "observed";
  if (now < slot.scheduled) return "waiting";
  if (now <= slot.scheduled + windowMinutes) return "open";
  return "missed";
}
