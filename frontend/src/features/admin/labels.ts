import type { CaptureQueueStats, DeviceCaptureStats } from "../../data/admin/adminModels";
import type {
  AdminCommand,
  AdminRole,
  CommandStatus,
  ReminderState,
} from "../../data/admin/adminClient";
import type { StatusTone } from "../../design-system/feedback";

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  owner: "Chủ sở hữu",
  admin: "Quản trị viên",
};

/** Trạng thái thành phần thiết bị do chính thiết bị báo trong heartbeat (device-heartbeat.v2). */
export const COMPONENT_LABELS: Record<string, string> = {
  ok: "ok",
  error: "lỗi",
  disabled: "tắt",
  unknown: "không rõ",
};

export const ROW_STATUS_LABELS: Record<string, string> = {
  active: "Đang hoạt động",
  revoked: "Đã thu hồi",
};

/** Device connection from the age of its last authenticated request (server policy: online, then uncertain, then offline). */
export const CONNECTION_LABELS: Record<
  "online" | "stale" | "offline" | "never_seen" | "unknown",
  { label: string; tone: StatusTone }
> = {
  online: { label: "Đang liên lạc", tone: "neutral" },
  stale: { label: "Kết nối không chắc chắn", tone: "attention" },
  offline: { label: "Mất kết nối", tone: "inactive" },
  never_seen: { label: "Chưa từng liên lạc", tone: "unknown" },
  unknown: { label: "Không rõ trạng thái kết nối", tone: "unknown" },
};

/** Where a capture stands between the device upload and its results (server-derived processing_state). */
export const PROCESSING_STATE_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  uploading: { label: "Thiết bị đang tải lên", tone: "neutral" },
  awaiting_processing: { label: "Đã tải lên, chờ agent xử lý", tone: "neutral" },
  processing: { label: "Agent/Vision đang xử lý", tone: "neutral" },
  observation_unverified: { label: "Có quan sát AI, chưa xác nhận", tone: "attention" },
  needs_review: { label: "Cần người xem lại", tone: "attention" },
  insufficient_data: { label: "Không đủ dữ liệu để phân tích", tone: "unknown" },
  completed_no_event: { label: "Đã phân tích, không có sự kiện", tone: "inactive" },
  failed: { label: "Xử lý thất bại", tone: "urgent" },
  expired: { label: "Hết hạn trước khi xử lý xong", tone: "urgent" },
  unknown: { label: "Trạng thái không rõ", tone: "unknown" },
};

/** Model results per check. Every one is an AI output that no person has verified. */
export const DRINK_RESULT_LABELS: Record<string, string> = {
  none_observed: "không nhận ra uống nước/uống thuốc",
  drinking_water_observed: "có thể đang uống nước (quan sát AI, chưa xác nhận)",
  medicine_observed:
    "có thể đang uống thuốc (quan sát AI, chưa xác nhận, không phải xác nhận đã uống)",
  cross_window_review: "thấy vỉ thuốc và cốc ở hai đoạn khác nhau, cần người xem lại",
  not_enough_data: "không đủ dữ liệu",
};
export const FALL_RESULT_LABELS: Record<string, string> = {
  uncalibrated_output: "mô hình chưa hiệu chỉnh, không kết luận",
  fall_candidate: "ứng viên theo luật thử nghiệm, cần người xem lại",
  below_candidate_rule: "dưới ngưỡng thử nghiệm",
  not_enough_data: "không đủ dữ liệu",
};

/** Camera scheduling the firmware reports (heartbeat status.capture). */
export const CAPTURE_MODE_LABELS: Record<string, string> = {
  off: "tắt",
  interval: "theo khoảng thời gian",
  cycle: "chu kỳ liên tục (phiên chạy thử có giới hạn)",
};
export const CAPTURE_STATE_LABELS: Record<string, string> = {
  off: "chưa chạy",
  running: "đang chạy",
  paused_thermal: "tạm dừng vì chip nóng",
  paused_quota: "tạm dừng vì máy chủ hết hạn mức chụp",
  paused_backpressure: "chờ chỗ trong hàng đợi tải lên (không chụp để rồi bỏ)",
  paused_offline: "chờ kết nối mạng (không chụp khi không tải lên được)",
  ended: "đã hết thời lượng phiên",
};

/** Device self-reported burst counters (heartbeat status.capture). Dropped bursts never reached the server. */
export function captureCountersText(c: DeviceCaptureStats): string {
  return `đã chụp ${c.burstsCaptured} · đã tải lên ${c.burstsUploaded} · bỏ trên thiết bị ${c.burstsDropped} · máy chủ từ chối ${c.uploadRefused} · lỗi tải ${c.uploadFailed} · đang giữ trên thiết bị ${c.queueDepth}`;
}

/** Firmware >= 0.4.0 (ADR-027): every burst is in exactly one of these, so the totals must add up. */
export function captureReconciles(c: DeviceCaptureStats): boolean {
  return c.burstsCaptured === c.burstsUploaded + c.burstsDropped + c.uploadRefused + c.uploadFailed + c.queueDepth;
}

export function captureQueueText(q: CaptureQueueStats): string {
  return `đang chờ ${q.queued} · đang tải lên ${q.uploading} · chờ thử lại ${q.retrying} · bỏ vì hàng đợi đầy ${q.droppedQueueFull} · bỏ vì quá hạn ${q.droppedExpired} · lần thử lại ${q.retries}`;
}

export function captureEventsText(q: CaptureQueueStats): string {
  return `đã chụp ${q.eventsCaptured} · đã tải lên ${q.eventsUploaded} · không lên được máy chủ ${q.eventsLost} · sự kiện kích hoạt không gửi được ${q.triggerEventsLost}`;
}

export function captureBackpressureText(q: CaptureQueueStats): string {
  return `chụp phải chờ hàng đợi ${q.deferredBackpressure} lần · chờ kết nối ${q.deferredOffline} lần · yêu cầu chụp bị bỏ qua ${q.requestsSkipped}`;
}

export function imuUplinkText(q: CaptureQueueStats): string {
  return `mẫu cũ nhất chưa gửi ${(q.imuLagMs / 1000).toFixed(1)} s · mẫu bị ghi đè trước khi gửi ${q.imuOverrunSamples}`;
}

/** Why the current boot started, as the firmware read it (heartbeat status.reset_reason). Self-reported by the device. */
export const RESET_REASON_LABELS: Record<string, string> = {
  power_on: "bật nguồn",
  external_pin: "nút/chân reset",
  software: "khởi động lại bằng phần mềm",
  panic: "lỗi firmware (panic)",
  interrupt_watchdog: "watchdog ngắt",
  task_watchdog: "watchdog tác vụ",
  other_watchdog: "watchdog khác",
  deep_sleep: "thức dậy từ ngủ sâu",
  brownout: "sụt áp nguồn (brownout)",
  sdio: "SDIO",
  usb: "USB",
  jtag: "JTAG",
  unknown: "không rõ",
};

export const JOB_KIND_LABELS: Record<string, string> = {
  vision: "Suy luận hình ảnh",
  daily_report: "Báo cáo ngày",
};

export const IMU_INGEST_LABELS: Record<string, string> = {
  accepting: "Đang nhận IMU thô",
  refusing_storage_budget: "Đang từ chối IMU thô (hết ngân sách lưu trữ)",
};

/* ------------------------------------------------------------------ commands (device protocol states) */

/**
 * One label per protocol state. Only `completed` means "the device reported it played to the end"; every other label says what
 * is actually known, so a queued or delivered command is never described as played.
 */
export const COMMAND_STATUS_LABELS: Record<CommandStatus, { label: string; tone: StatusTone }> = {
  queued: { label: "Đang chờ thiết bị lấy lệnh", tone: "neutral" },
  delivered: { label: "Đã giao cho thiết bị, chưa được xác nhận", tone: "attention" },
  accepted: { label: "Thiết bị đã tải và kiểm tra, chưa phát", tone: "neutral" },
  started: { label: "Thiết bị báo đang phát", tone: "neutral" },
  completed: { label: "Thiết bị báo đã phát xong", tone: "success" },
  failed: { label: "Thiết bị báo lỗi khi phát", tone: "urgent" },
  rejected: { label: "Thiết bị từ chối lệnh", tone: "urgent" },
  cancelled: { label: "Đã hủy", tone: "inactive" },
  expired: { label: "Hết hạn trước khi phát", tone: "inactive" },
  superseded: { label: "Bị lần nhắc sau thay thế", tone: "inactive" },
  unknown: { label: "Không rõ trạng thái", tone: "unknown" },
};

/** The state to show for one command. A delivered command whose device reported `received` (ADR-022) is described as such:
 * the device holds it (and is fetching the audio), which is still not "played". */
export function commandStateLabel(
  c: Pick<AdminCommand, "status" | "receivedAt" | "voiceMessageId">,
): { label: string; tone: StatusTone } {
  if (c.status === "delivered" && c.receivedAt) {
    return {
      label: c.voiceMessageId
        ? "Thiết bị đã nhận lệnh, đang tải âm thanh"
        : "Thiết bị đã nhận lệnh, chưa phát",
      tone: "neutral",
    };
  }
  return COMMAND_STATUS_LABELS[c.status];
}

export const COMMAND_TYPE_LABELS: Record<string, string> = {
  play_voice_message: "Phát lời nhắn thoại",
  reminder: "Nhắc lịch",
  emergency_buzzer: "Còi khẩn cấp",
};

/** Mã lý do (thiết bị hoặc hệ thống) → chữ. Mã lạ giữ nguyên để không giấu thông tin. */
export const REASON_LABELS: Record<string, string> = {
  expired_on_device: "Thiết bị thấy lệnh đã hết hạn",
  unsupported_command: "Thiết bị không hỗ trợ lệnh này",
  audio_download_failed: "Thiết bị tải âm thanh thất bại",
  audio_integrity_failed: "Âm thanh tải về không khớp mã kiểm tra",
  audio_format_unsupported: "Thiết bị không phát được định dạng này",
  playback_error: "Lỗi khi phát",
  preempted_by_higher_priority: "Bị lệnh ưu tiên cao hơn chen vào",
  busy: "Thiết bị đang bận",
  cancel_requested: "Theo yêu cầu hủy",
  device_rebooted: "Thiết bị khởi động lại khi đang giữ lệnh",
  download_timeout: "Thiết bị không tải xong âm thanh trước hạn",
  other: "Lý do khác",
  deadline_passed: "Quá hạn mà thiết bị chưa nhận",
  no_acknowledgement: "Thiết bị không xác nhận sau số lần giao tối đa",
  no_completion_report: "Thiết bị không báo kết thúc phát",
  redelivery: "Giao lại vì chưa được xác nhận",
  cancelled_by_admin: "Quản trị viên hủy",
  cancelled_by_caregiver: "Người chăm sóc hủy",
  reminder_cancelled: "Nhắc lịch bị hủy",
  reminder_paused: "Nhắc lịch bị tạm dừng",
  newer_occurrence: "Có lần nhắc mới hơn",
  device_revoked: "Thiết bị đã bị thu hồi",
  voice_message_deleted: "Bản ghi âm đã bị xóa",
};

/* ------------------------------------------------------------------ reminders */

export const REMINDER_STATE_LABELS: Record<ReminderState, { label: string; tone: StatusTone }> = {
  scheduled: { label: "Đang hẹn giờ", tone: "neutral" },
  paused: { label: "Tạm dừng", tone: "attention" },
  cancelled: { label: "Đã hủy", tone: "inactive" },
  finished: { label: "Đã hết lượt", tone: "inactive" },
  unknown: { label: "Không rõ", tone: "unknown" },
};

export const REMINDER_KIND_LABELS: Record<string, string> = {
  water: "Uống nước",
  medication: "Uống thuốc",
};

/** Thứ ISO 1 = thứ Hai … 7 = Chủ nhật. */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: "T2",
  2: "T3",
  3: "T4",
  4: "T5",
  5: "T6",
  6: "T7",
  7: "CN",
};

/* ------------------------------------------------------------------ daily activity report */

export const SOURCE_LABELS: Record<string, string> = {
  boots: "Lần khởi động của thiết bị",
  presence: "Giờ có kết nối",
  heartbeat: "Heartbeat",
  events: "Sự kiện nhận diện và kích hoạt IMU",
  captures: "Lần chụp",
  imu: "IMU thô (tóm tắt theo giờ)",
  decisions: "Quyết định hợp nhất",
  alerts: "Cảnh báo",
  commands: "Lệnh gửi thiết bị",
  command_events: "Trạng thái lệnh do thiết bị và hệ thống ghi",
  agent_jobs: "Việc giao cho Local AI Agent",
  admin_actions: "Thao tác quản trị",
  agent_connectivity: "Lịch sử kết nối của agent",
  device_connectivity_changes: "Chuyển trạng thái online/offline của thiết bị",
};

export const SOURCE_STATE_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  ok: { label: "Đầy đủ", tone: "neutral" },
  truncated: { label: "Bị cắt bớt", tone: "attention" },
  partial: { label: "Chỉ một phần", tone: "attention" },
  retention_expired: { label: "Quá hạn lưu giữ", tone: "inactive" },
  not_stored: { label: "Không được lưu", tone: "inactive" },
};

export const ENTRY_KIND_LABELS: Record<string, string> = {
  boot: "Thiết bị khởi động",
  presence_hour: "Có yêu cầu đã xác thực trong giờ này",
  heartbeat_latest: "Heartbeat gần nhất (do thiết bị tự báo)",
  imu_trigger: "Firmware báo kích hoạt IMU (không phải kết luận ngã)",
  fall_check: "Điểm AI kiểm tra ngã (chưa hiệu chỉnh)",
  drink_check: "Quan sát AI uống nước/thuốc (chưa xác nhận)",
  capture: "Lần chụp",
  imu_hour_summary: "IMU thô nhận được trong giờ",
  fusion_decision: "Quyết định hợp nhất",
  alert: "Cảnh báo",
  command: "Lệnh được tạo",
  command_event: "Trạng thái lệnh",
  vision_job: "Việc suy luận hình ảnh",
  daily_report_job: "Việc báo cáo ngày",
};

/** Chữ hiển thị cho trạng thái chung (mã lạ giữ nguyên). */
export const GENERIC_STATUS_LABELS: Record<string, string> = {
  uploaded: "Đã tải lên, chờ xử lý",
  receiving: "Đang nhận",
  processing: "Đang xử lý",
  processed: "Đã xử lý",
  failed: "Lỗi",
  expired: "Hết hạn",
  queued: "Đang chờ",
  completed: "Hoàn tất",
  retry_pending: "Chờ thử lại",
  success: "Thành công",
  denied: "Bị từ chối",
};

export const SOURCE_MODE_LABELS: Record<string, string> = {
  simulated: "Dữ liệu mô phỏng",
  device: "Từ thiết bị",
  mixed: "Lẫn dữ liệu mô phỏng",
};

/* ------------------------------------------------------------------ audit */

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "admin.google_login": "Đăng nhập quản trị bằng Google",
  "admin.session_create": "Tạo phiên quản trị",
  "admin.session_revoke": "Kết thúc phiên quản trị",
  "command.create": "Tạo lệnh phát âm thanh",
  "command.cancel": "Hủy lệnh",
  "voice.upload": "Tải lên bản ghi âm",
  "reminder.create": "Tạo nhắc lịch",
  "reminder.pause": "Tạm dừng nhắc lịch",
  "reminder.resume": "Tiếp tục nhắc lịch",
  "reminder.cancel": "Hủy nhắc lịch",
  "device.create": "Đăng ký thiết bị",
  "device.rotate_token": "Xoay credential thiết bị",
  "device.revoke": "Thu hồi thiết bị",
};

export const AUDIT_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "Tất cả" },
  { value: "admin.", label: "Phiên quản trị" },
  { value: "command.", label: "Lệnh" },
  { value: "voice.", label: "Bản ghi âm" },
  { value: "reminder.", label: "Nhắc lịch" },
  { value: "device.", label: "Thiết bị" },
];
