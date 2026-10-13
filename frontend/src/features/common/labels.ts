/**
 * Nhãn tiếng Việt dùng chung giữa các màn hình. `features/common` là module nghiệp vụ dùng chung duy nhất
 * mà các feature khác được import (giả định A05).
 */
import type {
  AlertActionType,
  AlertStatus,
  CareEventCategory,
  ConnectionState,
  HistoryItemType,
  Product,
  ReviewOutcome,
  Severity,
  SignalQuality,
  TimeRange,
} from "../../data/contracts";
import type { StatusTone } from "../../design-system/feedback";

export const PRODUCT_LABELS: Record<Product, string> = { carelens: "CareLens", ecopatch: "EcoPatch" };

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Khẩn cấp",
  warning: "Cần chú ý",
  notice: "Theo dõi",
  info: "Thông tin",
};

export const SEVERITY_TONE: Record<Severity, StatusTone> = {
  critical: "urgent",
  warning: "attention",
  notice: "neutral",
  info: "inactive",
};

export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  open: "Chưa tiếp nhận",
  acknowledged: "Đã tiếp nhận",
  in_progress: "Đang xử lý",
  resolved: "Đã xử lý",
};

export const ALERT_STATUS_TONE: Record<AlertStatus, StatusTone> = {
  open: "attention",
  acknowledged: "neutral",
  in_progress: "neutral",
  resolved: "inactive",
};

export const OUTCOME_LABELS: Record<ReviewOutcome, string> = {
  confirmed: "Xác nhận sự kiện",
  false_alarm: "Báo động sai",
  uncertain: "Chưa xác định",
};

export const ACTION_LABELS: Record<AlertActionType, string> = {
  acknowledge: "Tiếp nhận kiểm tra",
  start: "Bắt đầu xử lý",
  resolve: "Ghi kết quả và đóng",
  escalate: "Chuyển người dự phòng",
  reminder: "Nhắc lại",
};

export const CONNECTION_LABELS: Record<ConnectionState, { label: string; tone: StatusTone }> = {
  connected: { label: 'Online', tone: 'neutral' },
  stale: { label: 'Online', tone: 'neutral' },
  disconnected: { label: 'Offline', tone: 'urgent' },
  local_unavailable: { label: 'Offline', tone: 'urgent' },
  unknown: { label: 'Offline', tone: 'neutral' },
};

export const CONNECTION_TONE: Record<ConnectionState, StatusTone> = {
  connected: "neutral",
  stale: "attention",
  disconnected: "urgent",
  local_unavailable: "attention",
  unknown: "unknown",
};

export const CATEGORY_LABELS: Record<CareEventCategory, string> = {
  posture: "Tư thế",
  inactivity: "Ít vận động",
  fall_like: "Tư thế nằm/ngã",
  activity: "Hoạt động",
  care_activity: "Hoạt động chăm sóc",
};

export const QUALITY_LABELS: Record<SignalQuality, string> = {
  good: "Tín hiệu tốt",
  fair: "Tín hiệu trung bình",
  poor: "Tín hiệu kém",
};

export const QUALITY_TONE: Record<SignalQuality, StatusTone> = {
  good: "neutral",
  fair: "attention",
  poor: "urgent",
};

export const RANGE_LABELS: Record<TimeRange, string> = {
  "6h": "6 giờ",
  "24h": "24 giờ",
  "7d": "7 ngày",
  "30d": "30 ngày",
};

export const HISTORY_TYPE_LABELS: Record<HistoryItemType, string> = {
  care_event: "Sự kiện CareLens",
  alert_action: "Xử lý cảnh báo",
  note: "Ghi chú",
  patch_change: "Thay miếng dán",
  device_assignment: "Gán thiết bị",
};

export const AI_UNCONFIRMED = "Nhận định AI, chưa được người chăm sóc xác nhận";
export const AI_SCORE_NOTE = "Điểm AI thử nghiệm, không phải xác suất hay độ chính xác";
