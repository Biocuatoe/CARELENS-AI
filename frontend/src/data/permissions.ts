import type { GrantRole, Permission } from "./contracts";

/**
 * Bộ permission mặc định theo vai trò (ARCHITECTURE §6.2, còn chốt ở M1).
 * `patches.replace` cho caregiver là giả định A06. Server là nơi thực thi thật; UI chỉ dùng để ẩn/hiện.
 */
export const ROLE_PERMISSIONS: Record<GrantRole, Permission[]> = {
  care_recipient: ["recipient.read", "data.read", "sharing.manage"],
  /** Quản lý nhóm không tự có quyền đọc dữ liệu sức khỏe; quyền dữ liệu được cấp thêm khi có đồng ý chia sẻ. */
  manager: ["recipient.read", "recipient.manage", "devices.manage", "sharing.manage"],
  caregiver: ["recipient.read", "data.read", "alerts.act", "notes.write", "patches.replace"],
  viewer: ["recipient.read", "data.read"],
  device_operator: ["recipient.read", "devices.manage"],
};

export function hasPermission(permissions: readonly Permission[], needed: Permission): boolean {
  return permissions.includes(needed);
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  "recipient.read": "Xem thông tin hồ sơ",
  "recipient.manage": "Chỉnh sửa hồ sơ",
  "data.read": "Xem sự kiện, chỉ số và cảnh báo",
  "alerts.act": "Tiếp nhận và xử lý cảnh báo",
  "notes.write": "Ghi chú chăm sóc",
  "patches.replace": "Ghi nhận thay miếng dán",
  "devices.manage": "Ghép và gỡ thiết bị",
  "sharing.manage": "Mời và thu hồi quyền truy cập",
  "exports.create": "Xuất dữ liệu",
  "platform.admin": "Vận hành nền tảng",
};

export const ROLE_LABELS: Record<GrantRole, string> = {
  care_recipient: "Người được chăm sóc",
  manager: "Người quản lý",
  caregiver: "Người chăm sóc",
  viewer: "Người xem",
  device_operator: "Vận hành thiết bị",
};
