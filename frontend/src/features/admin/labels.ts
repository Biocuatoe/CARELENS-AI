import type { AdminRole, CommandStatus, ReminderState } from "../../data/admin/adminClient";
import type { StatusTone } from "../../design-system/feedback";

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = { owner: "Chủ sở hữu", admin: "Quản trị viên" };

/** Trạng thái thành phần thiết bị do chính thiết bị báo trong heartbeat (device-heartbeat.v2). */
export const COMPONENT_LABELS: Record<string, string> = { ok: "ok", error: "lỗi", disabled: "tắt", unknown: "không rõ" };

export const ROW_STATUS_LABELS: Record<string, string> = { active: "Đang hoạt động", revoked: "Đã thu hồi" };

export const JOB_KIND_LABELS: Record<string, string> = { vision: "Suy luận hình ảnh", daily_report: "Báo cáo ngày" };

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
  accepted: { label: "Thiết bị đã nhận lệnh", tone: "neutral" },
  started: { label: "Thiết bị báo đang phát", tone: "neutral" },
  completed: { label: "Thiết bị báo đã phát xong", tone: "success" },
  failed: { label: "Thiết bị báo lỗi khi phát", tone: "urgent" },
  rejected: { label: "Thiết bị từ chối lệnh", tone: "urgent" },
  cancelled: { label: "Đã hủy", tone: "inactive" },
  expired: { label: "Hết hạn trước khi phát", tone: "inactive" },
  superseded: { label: "Bị lần nhắc sau thay thế", tone: "inactive" },
  unknown: { label: "Không rõ trạng thái", tone: "unknown" },
};

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

export const REMINDER_KIND_LABELS: Record<string, string> = { water: "Uống nước", medication: "Uống thuốc" };

/** Thứ ISO 1 = thứ Hai … 7 = Chủ nhật. */
export const WEEKDAY_LABELS: Record<number, string> = { 1: "T2", 2: "T3", 3: "T4", 4: "T5", 5: "T6", 6: "T7", 7: "CN" };

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

export const SOURCE_MODE_LABELS: Record<string, string> = { simulated: "Dữ liệu mô phỏng", device: "Từ thiết bị", mixed: "Lẫn dữ liệu mô phỏng" };

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
