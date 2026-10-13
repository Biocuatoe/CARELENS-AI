/**
 * Fixture HOÀN TOÀN TỔNG HỢP cho chế độ demo (plan §14).
 * Không có tên, email hoặc thông tin người thật. Giá trị chỉ để kiểm tra giao diện, không phải ngưỡng y khoa.
 * Email dùng tên miền dự phòng `.invalid` để không thể gửi tới người thật.
 */
import type {
  AlertAction,
  Alert,
  Capability,
  CareEvent,
  CareEventCategory,
  CareNote,
  DeviceAssignment,
  DeviceKind,
  Grant,
  Household,
  Invitation,
  Membership,
  NotificationDelivery,
  PatchSession,
  Permission,
  Product,
  ProductEnrollment,
  Severity,
  User,
} from "../contracts";
import { ROLE_PERMISSIONS } from "../permissions";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const MEASUREMENT_INTERVAL_MIN = 10;
export const DEMO_MODEL_VERSION = "simulator-1.0";
export const DEMO_RULE_VERSION = "demo-rule-1.0";
/** Quy tắc demo: care level ≥ 7 tạo cảnh báo. Lấy từ giá trị mặc định của PRD, chưa được kiểm chứng (D03). */
export const DEMO_ALERT_THRESHOLD = 7;

export const iso = (ms: number) => new Date(ms).toISOString();

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoUser extends User {
  status: "active" | "locked";
}

export interface DemoRecipient {
  id: string;
  householdId: string;
  displayName: string;
  enrollments: ProductEnrollment[];
}

export interface DemoDevice {
  id: string;
  product: Product;
  kind: DeviceKind;
  label: string;
  serial: string;
  capabilities: Capability[];
  online: boolean;
  lastSeenStored: number | null;
  localAccess: boolean;
  batteryPercent: number | null;
  activationCode: string;
  /** Khoảng mất tín hiệu mô phỏng, không sinh phép đo trong khoảng này. */
  gaps: Array<[number, number]>;
}

export interface DemoFixture {
  users: DemoUser[];
  households: Household[];
  memberships: Membership[];
  recipients: DemoRecipient[];
  grants: Grant[];
  invitations: Invitation[];
  devices: DemoDevice[];
  assignments: DeviceAssignment[];
  events: CareEvent[];
  alerts: Alert[];
  actions: AlertAction[];
  notes: CareNote[];
  patchSessions: PatchSession[];
  sink: Array<NotificationDelivery & { ownerId: string }>;
  quarantine: Array<{ id: string; at: string; deviceSerialMasked: string; reason: string }>;
}

export const PERSONAS = [
  {
    id: "u_minh",
    displayName: "Minh",
    description: "Quản lý Nhóm A và người chăm sóc Bà An. Người chăm sóc của Ông Bình (Nhóm B).",
  },
  { id: "u_lan", displayName: "Lan", description: "Người chăm sóc Bà An (Nhóm A)." },
  { id: "u_ha", displayName: "Hà", description: "Người xem hồ sơ Ông Bình (Nhóm B). Không xử lý cảnh báo." },
  {
    id: "u_khoa",
    displayName: "Khoa",
    description: "Quản trị nền tảng. Xem vận hành, không có quyền xem dữ liệu sức khỏe.",
  },
  {
    id: "u_liveshowcase",
    displayName: "LIVESHOWCASE",
    description: "",
  },
] as const;

export type DemoMode = "static" | "dynamic";

/** Persona id → mode. Static personas never open network connections. */
export const PERSONA_MODE: Record<string, DemoMode> = {
  u_minh: "static",
  u_lan: "static",
  u_ha: "static",
  u_khoa: "static",
  u_liveshowcase: "dynamic",
};

export function isDynamicPersona(personaId: string): boolean {
  return PERSONA_MODE[personaId] === "dynamic";
}

/** Thời gian fixture tổng hợp, dùng làm đơn vị test. */
export const DEMO_FIXTURE_SEED = 20260914;

export function maskSerial(serial: string): string {
  const parts = serial.split("-");
  if (parts.length < 3) return serial;
  return `${parts.slice(0, -2).join("-")}-••••-${parts[parts.length - 1]}`;
}

const perms = (...sets: Permission[][]): Permission[] => Array.from(new Set(sets.flat()));

export function buildFixture(now: number): DemoFixture {
  const rand = mulberry32(DEMO_FIXTURE_SEED);
  const t = (msAgo: number) => iso(now - msAgo);

  const users: DemoUser[] = [
    { id: "u_minh", displayName: "Minh", email: "minh.demo@example.invalid", isPlatformAdmin: false, status: "active" },
    { id: "u_lan", displayName: "Lan", email: "lan.demo@example.invalid", isPlatformAdmin: false, status: "active" },
    { id: "u_quang", displayName: "Quang", email: "quang.demo@example.invalid", isPlatformAdmin: false, status: "active" },
    { id: "u_tuan", displayName: "Tuấn", email: "tuan.demo@example.invalid", isPlatformAdmin: false, status: "active" },
    { id: "u_ha", displayName: "Hà", email: "ha.demo@example.invalid", isPlatformAdmin: false, status: "active" },
    { id: "u_khoa", displayName: "Khoa", email: "khoa.demo@example.invalid", isPlatformAdmin: true, status: "active" },
    { id: "u_liveshowcase", displayName: "Liveshowcase", email: "liveshowcase.demo@example.invalid", isPlatformAdmin: false, status: "active" },
  ];

  const households: Household[] = [
    { id: "h_a", name: "Nhóm A · Gia đình minh họa" },
    { id: "h_b", name: "Nhóm B · Gia đình minh họa" },
    { id: "h_liveshowcase", name: "CareLens + EcoPatch" },
  ];

  const memberships: Membership[] = [
    { householdId: "h_a", userId: "u_minh", role: "manager" },
    { householdId: "h_a", userId: "u_lan", role: "member" },
    { householdId: "h_a", userId: "u_quang", role: "member" },
    { householdId: "h_b", userId: "u_tuan", role: "manager" },
    { householdId: "h_b", userId: "u_ha", role: "member" },
    { householdId: "h_b", userId: "u_minh", role: "member" },
    { householdId: "h_liveshowcase", userId: "u_liveshowcase", role: "manager" },
  ];

  const recipients: DemoRecipient[] = [
    {
      id: "r_an",
      householdId: "h_a",
      displayName: "Bà An · Hồ sơ minh họa",
      enrollments: [
        { product: "carelens", status: "active" },
        { product: "ecopatch", status: "active" },
      ],
    },
    {
      id: "r_binh",
      householdId: "h_b",
      displayName: "Ông Bình · Hồ sơ minh họa",
      enrollments: [{ product: "ecopatch", status: "active" }],
    },
    {
      id: "r_liveshowcase",
      householdId: "h_liveshowcase",
      displayName: "Demo trực tiếp",
      enrollments: [
        { product: "carelens", status: "active" },
        { product: "ecopatch", status: "active" },
      ],
    },
  ];

  const careData: Permission[] = ["data.read", "alerts.act", "notes.write", "patches.replace", "exports.create"];
  const grants: Grant[] = [
    {
      id: "g_minh_an",
      recipientId: "r_an",
      userId: "u_minh",
      userDisplayName: "Minh",
      userEmail: "minh.demo@example.invalid",
      role: "manager",
      permissions: perms(ROLE_PERMISSIONS.manager, careData),
      grantedAt: t(60 * DAY),
      expiresAt: null,
      revokedAt: null,
    },
    {
      id: "g_lan_an",
      recipientId: "r_an",
      userId: "u_lan",
      userDisplayName: "Lan",
      userEmail: "lan.demo@example.invalid",
      role: "caregiver",
      permissions: [...ROLE_PERMISSIONS.caregiver],
      grantedAt: t(45 * DAY),
      expiresAt: null,
      revokedAt: null,
    },
    {
      id: "g_tuan_binh",
      recipientId: "r_binh",
      userId: "u_tuan",
      userDisplayName: "Tuấn",
      userEmail: "tuan.demo@example.invalid",
      role: "manager",
      permissions: perms(ROLE_PERMISSIONS.manager, careData),
      grantedAt: t(40 * DAY),
      expiresAt: null,
      revokedAt: null,
    },
    {
      id: "g_minh_binh",
      recipientId: "r_binh",
      userId: "u_minh",
      userDisplayName: "Minh",
      userEmail: "minh.demo@example.invalid",
      role: "caregiver",
      permissions: [...ROLE_PERMISSIONS.caregiver],
      grantedAt: t(20 * DAY),
      expiresAt: null,
      revokedAt: null,
    },
    {
      id: "g_ha_binh",
      recipientId: "r_binh",
      userId: "u_ha",
      userDisplayName: "Hà",
      userEmail: "ha.demo@example.invalid",
      role: "viewer",
      permissions: [...ROLE_PERMISSIONS.viewer],
      grantedAt: t(10 * DAY),
      expiresAt: iso(now + 80 * DAY),
      revokedAt: null,
    },
    {
      id: "g_liveshowcase_an",
      recipientId: "r_liveshowcase",
      userId: "u_liveshowcase",
      userDisplayName: "Liveshowcase",
      userEmail: "liveshowcase.demo@example.invalid",
      role: "manager",
      permissions: perms(ROLE_PERMISSIONS.manager, careData),
      grantedAt: t(1 * DAY),
      expiresAt: null,
      revokedAt: null,
    },
  ];

  const invitations: Invitation[] = [
    {
      id: "inv_1",
      recipientId: "r_an",
      email: "nguoichamsoc.moi@example.invalid",
      role: "caregiver",
      status: "pending",
      createdAt: t(2 * DAY),
      expiresAt: iso(now + 5 * DAY),
      invitedByName: "Minh",
    },
    {
      id: "inv_2",
      recipientId: "r_an",
      email: "nguoixem.cu@example.invalid",
      role: "viewer",
      status: "expired",
      createdAt: t(9 * DAY),
      expiresAt: t(2 * DAY),
      invitedByName: "Minh",
    },
  ];

  const devices: DemoDevice[] = [
    {
      id: "d_hub_an",
      product: "carelens",
      kind: "carelens_hub",
      label: "Hub CareLens phòng khách",
      serial: "CL-HUB-8841-2041",
      capabilities: ["care_events", "hub_status"],
      online: true,
      lastSeenStored: now,
      localAccess: true,
      batteryPercent: null,
      activationCode: "000000",
      gaps: [],
    },
    {
      id: "d_core_an",
      product: "ecopatch",
      kind: "ecopatch_core",
      label: "Lõi EcoPatch",
      serial: "EP-CORE-3310-7715",
      capabilities: ["heart_rate", "signal_quality"],
      online: true,
      lastSeenStored: now,
      localAccess: true,
      batteryPercent: null,
      activationCode: "000000",
      gaps: [[now - 7 * HOUR, now - 5 * HOUR]],
    },
    {
      id: "d_core_binh",
      product: "ecopatch",
      kind: "ecopatch_core",
      label: "Lõi EcoPatch",
      serial: "EP-CORE-5521-0934",
      capabilities: ["heart_rate", "signal_quality", "battery"],
      online: false,
      lastSeenStored: now - 3 * HOUR - 12 * MINUTE,
      localAccess: true,
      batteryPercent: 64,
      activationCode: "000000",
      gaps: [],
    },
    // Kho thiết bị chưa ghép, dùng cho luồng ghép thiết bị mô phỏng.
    {
      id: "d_hub_spare",
      product: "carelens",
      kind: "carelens_hub",
      label: "Hub CareLens",
      serial: "CL-HUB-DEMO-3001",
      capabilities: ["care_events", "hub_status"],
      online: false,
      lastSeenStored: null,
      localAccess: true,
      batteryPercent: null,
      activationCode: "246810",
      gaps: [],
    },
    {
      id: "d_core_spare",
      product: "ecopatch",
      kind: "ecopatch_core",
      label: "Lõi EcoPatch",
      serial: "EP-CORE-DEMO-5002",
      capabilities: ["heart_rate", "signal_quality"],
      online: false,
      lastSeenStored: null,
      localAccess: true,
      batteryPercent: null,
      activationCode: "135790",
      gaps: [],
    },
    // Liveshowcase: offline hub + core — no seeded events/measurements/alerts/patches.
    {
      id: "d_hub_liveshowcase",
      product: "carelens",
      kind: "carelens_hub",
      label: "Hub CareLens",
      serial: "CL-HUB-DEMO-LS01",
      capabilities: ["care_events", "hub_status"],
      online: false,
      lastSeenStored: null,
      localAccess: true,
      batteryPercent: null,
      activationCode: "000000",
      gaps: [[now - 24 * HOUR, now + 365 * DAY]],
    },
    {
      id: "d_core_liveshowcase",
      product: "ecopatch",
      kind: "ecopatch_core",
      label: "Lõi EcoPatch",
      serial: "EP-CORE-DEMO-LS02",
      capabilities: ["heart_rate", "signal_quality"],
      online: false,
      lastSeenStored: null,
      localAccess: true,
      batteryPercent: null,
      activationCode: "000000",
      gaps: [[now - 24 * HOUR, now + 365 * DAY]],
    },
  ];

  const assignments: DeviceAssignment[] = [
    { id: "as_1", deviceId: "d_hub_an", recipientId: "r_an", validFrom: t(58 * DAY), validTo: null },
    { id: "as_2", deviceId: "d_core_an", recipientId: "r_an", validFrom: t(30 * DAY), validTo: null },
    { id: "as_3", deviceId: "d_core_binh", recipientId: "r_binh", validFrom: t(20 * DAY), validTo: null },
    { id: "as_ls_hub", deviceId: "d_hub_liveshowcase", recipientId: "r_liveshowcase", validFrom: t(1 * DAY), validTo: null },
    { id: "as_ls_core", deviceId: "d_core_liveshowcase", recipientId: "r_liveshowcase", validFrom: t(1 * DAY), validTo: null },
  ];

  /* CareLens events: mô tả trung tính, không phải chẩn đoán. */
  type Seed = [msAgo: number, category: CareEventCategory, severity: Severity, level: number, summary: string];
  const eventSeeds: Seed[] = [
    [25 * MINUTE, "posture", "warning", 7, "AI ghi nhận tư thế bất thường."],
    [95 * MINUTE, "activity", "info", 1, "AI ghi nhận người đang đi lại trong phòng."],
    [3 * HOUR, "posture", "warning", 8, "AI ghi nhận người ở tư thế thấp gần sàn trong vài phút."],
    [4 * HOUR + 20 * MINUTE, "inactivity", "notice", 4, "AI ghi nhận người ngồi yên trong thời gian dài."],
    [9 * HOUR, "activity", "info", 2, "AI ghi nhận người đứng dậy khỏi ghế."],
    [22 * HOUR, "posture", "warning", 7, "AI ghi nhận tư thế cúi thấp kéo dài."],
    [26 * HOUR, "inactivity", "notice", 5, "AI ghi nhận ít chuyển động trong khoảng thời gian dài."],
    [30 * HOUR, "activity", "info", 1, "AI ghi nhận người đang đi lại trong phòng."],
    [2 * DAY + 3 * HOUR, "inactivity", "notice", 3, "AI ghi nhận người ngồi yên trong thời gian dài."],
    [3 * DAY + 2 * HOUR, "fall_like", "critical", 9, "AI ghi nhận tư thế nằm trên sàn."],
    [3 * DAY + 6 * HOUR, "activity", "info", 2, "AI ghi nhận người đứng dậy khỏi ghế."],
    [4 * DAY + 1 * HOUR, "inactivity", "notice", 4, "AI ghi nhận ít chuyển động trong khoảng thời gian dài."],
    [5 * DAY + 5 * HOUR, "posture", "notice", 6, "AI ghi nhận tư thế ngồi lệch kéo dài."],
    [6 * DAY + 2 * HOUR, "posture", "warning", 7, "AI ghi nhận tư thế bất thường."],
    [6 * DAY + 9 * HOUR, "activity", "info", 1, "AI ghi nhận người đang đi lại trong phòng."],
    [12 * DAY, "inactivity", "notice", 4, "AI ghi nhận người ngồi yên trong thời gian dài."],
    [18 * DAY, "posture", "warning", 7, "AI ghi nhận tư thế cúi thấp kéo dài."],
  ];

  const events: CareEvent[] = eventSeeds.map(([ago, category, severity, level, summary], i) => ({
    id: `ev_${String(i + 1).padStart(3, "0")}`,
    sourceRecordId: `sim-event-${String(i + 1).padStart(4, "0")}`,
    recipientId: "r_an",
    deviceId: "d_hub_an",
    product: "carelens",
    eventType: "care_observation",
    category,
    severity,
    careLevel: level,
    summary,
    observedAt: t(ago),
    receivedAt: t(ago - Math.round(1_000 + rand() * 4_000)),
    modelVersion: DEMO_MODEL_VERSION,
    ruleVersion: DEMO_RULE_VERSION,
    alertId: null,
    sourceMode: "simulated",
  }));

  const ev = (n: number) => events[n - 1]!;

  const baseAlert = (
    id: string,
    e: CareEvent,
    patch: Partial<Alert>,
  ): Alert => ({
    id,
    recipientId: e.recipientId,
    product: "carelens",
    kind: "care_event",
    sourceEventId: e.id,
    deviceId: e.deviceId,
    severity: e.severity,
    status: "open",
    summary: e.summary,
    observedAt: e.observedAt,
    createdAt: e.receivedAt,
    assigneeId: null,
    assigneeName: null,
    reviewOutcome: null,
    resolutionNote: null,
    resolvedAt: null,
    resolvedByName: null,
    ruleVersion: DEMO_RULE_VERSION,
    version: 1,
    sourceMode: "simulated",
    ...patch,
  });

  const alerts: Alert[] = [
    baseAlert("al_001", ev(1), {}),
    baseAlert("al_002", ev(3), { status: "acknowledged", assigneeId: "u_lan", assigneeName: "Lan", version: 2 }),
    {
      id: "al_003",
      recipientId: "r_an",
      product: "ecopatch",
      kind: "device_status",
      sourceEventId: null,
      deviceId: "d_core_an",
      severity: "notice",
      status: "in_progress",
      summary: "Lõi EcoPatch không gửi phép đo trong 2 giờ (quy tắc thiết bị demo).",
      observedAt: t(5 * HOUR),
      createdAt: t(5 * HOUR),
      assigneeId: "u_minh",
      assigneeName: "Minh",
      reviewOutcome: null,
      resolutionNote: null,
      resolvedAt: null,
      resolvedByName: null,
      ruleVersion: DEMO_RULE_VERSION,
      version: 3,
      sourceMode: "simulated",
    },
    baseAlert("al_004", ev(6), {
      status: "resolved",
      assigneeId: "u_minh",
      assigneeName: "Minh",
      reviewOutcome: "false_alarm",
      resolutionNote: "Đã gọi điện kiểm tra. Bà đang tập vận động nhẹ trên thảm.",
      resolvedAt: t(21 * HOUR),
      resolvedByName: "Minh",
      version: 3,
    }),
    baseAlert("al_005", ev(10), {
      status: "resolved",
      assigneeId: "u_lan",
      assigneeName: "Lan",
      reviewOutcome: "confirmed",
      resolutionNote: "Đã đến nhà kiểm tra và hỗ trợ bà đứng dậy. Gia đình tiếp tục theo dõi.",
      resolvedAt: t(3 * DAY + 1 * HOUR),
      resolvedByName: "Lan",
      version: 4,
    }),
    baseAlert("al_006", ev(14), {
      status: "resolved",
      assigneeId: "u_minh",
      assigneeName: "Minh",
      reviewOutcome: "uncertain",
      resolutionNote: "Không xác định được tình huống từ mô tả. Đã gọi điện hỏi thăm.",
      resolvedAt: t(6 * DAY + 1 * HOUR),
      resolvedByName: "Minh",
      version: 3,
    }),
    baseAlert("al_007", ev(17), {
      status: "resolved",
      assigneeId: "u_lan",
      assigneeName: "Lan",
      reviewOutcome: "false_alarm",
      resolutionNote: "Bà đang nhặt đồ dưới sàn.",
      resolvedAt: t(18 * DAY - 20 * MINUTE),
      resolvedByName: "Lan",
      version: 3,
    }),
    {
      id: "al_101",
      recipientId: "r_binh",
      product: "ecopatch",
      kind: "device_status",
      sourceEventId: null,
      deviceId: "d_core_binh",
      severity: "notice",
      status: "open",
      summary: "Lõi EcoPatch mất kết nối hơn 3 giờ (quy tắc thiết bị demo).",
      observedAt: t(3 * HOUR),
      createdAt: t(3 * HOUR),
      assigneeId: null,
      assigneeName: null,
      reviewOutcome: null,
      resolutionNote: null,
      resolvedAt: null,
      resolvedByName: null,
      ruleVersion: DEMO_RULE_VERSION,
      version: 1,
      sourceMode: "simulated",
    },
  ];

  for (const alert of alerts) {
    if (alert.sourceEventId) {
      const e = events.find((x) => x.id === alert.sourceEventId);
      if (e) e.alertId = alert.id;
    }
  }

  const action = (
    id: string,
    alertId: string,
    type: AlertAction["type"],
    actorName: string,
    at: string,
    extra: Partial<AlertAction> = {},
  ): AlertAction => ({
    id,
    alertId,
    type,
    actorName,
    actorKind: "user",
    outcome: null,
    note: null,
    at,
    ...extra,
  });

  const actions: AlertAction[] = [
    action("ac_01", "al_001", "reminder", "Hệ thống", t(15 * MINUTE), {
      actorKind: "system",
      note: "Nhắc lại tới người chăm sóc chính sau 10 phút chưa tiếp nhận (cấu hình demo).",
    }),
    action("ac_02", "al_001", "escalate", "Hệ thống", t(5 * MINUTE), {
      actorKind: "system",
      note: "Chuyển thông báo tới người dự phòng Lan (cấu hình demo).",
    }),
    action("ac_03", "al_002", "acknowledge", "Lan", t(2 * HOUR + 50 * MINUTE)),
    action("ac_04", "al_003", "acknowledge", "Minh", t(4 * HOUR + 40 * MINUTE)),
    action("ac_05", "al_003", "start", "Minh", t(4 * HOUR + 30 * MINUTE), {
      note: "Đang nhờ người nhà kiểm tra lõi đã gắn chắc vào miếng dán chưa.",
    }),
    action("ac_06", "al_004", "acknowledge", "Minh", t(21 * HOUR + 40 * MINUTE)),
    action("ac_07", "al_004", "resolve", "Minh", t(21 * HOUR), {
      outcome: "false_alarm",
      note: "Đã gọi điện kiểm tra. Bà đang tập vận động nhẹ trên thảm.",
    }),
    action("ac_08", "al_005", "acknowledge", "Lan", t(3 * DAY + 1 * HOUR + 55 * MINUTE)),
    action("ac_09", "al_005", "start", "Lan", t(3 * DAY + 1 * HOUR + 50 * MINUTE)),
    action("ac_10", "al_005", "resolve", "Lan", t(3 * DAY + 1 * HOUR), {
      outcome: "confirmed",
      note: "Đã đến nhà kiểm tra và hỗ trợ bà đứng dậy. Gia đình tiếp tục theo dõi.",
    }),
    action("ac_11", "al_006", "acknowledge", "Minh", t(6 * DAY + 1 * HOUR + 40 * MINUTE)),
    action("ac_12", "al_006", "resolve", "Minh", t(6 * DAY + 1 * HOUR), {
      outcome: "uncertain",
      note: "Không xác định được tình huống từ mô tả. Đã gọi điện hỏi thăm.",
    }),
    action("ac_13", "al_007", "acknowledge", "Lan", t(18 * DAY - 10 * MINUTE)),
    action("ac_14", "al_007", "resolve", "Lan", t(18 * DAY - 20 * MINUTE), {
      outcome: "false_alarm",
      note: "Bà đang nhặt đồ dưới sàn.",
    }),
  ];

  const notes: CareNote[] = [
    {
      id: "n_1",
      recipientId: "r_an",
      authorName: "Lan",
      body: "Chiều nay bà đi dạo quanh sân khoảng 20 phút cùng người nhà.",
      createdAt: t(6 * HOUR),
    },
    {
      id: "n_2",
      recipientId: "r_an",
      authorName: "Minh",
      body: "Đã dời ghế tựa ra xa bàn nước để lối đi rộng hơn.",
      createdAt: t(2 * DAY),
    },
    {
      id: "n_3",
      recipientId: "r_binh",
      authorName: "Tuấn",
      body: "Ông tháo lõi EcoPatch để sạc, chưa gắn lại.",
      createdAt: t(3 * HOUR + 20 * MINUTE),
    },
  ];

  const patchSessions: PatchSession[] = [
    {
      id: "ps_1",
      coreDeviceId: "d_core_an",
      recipientId: "r_an",
      lotCode: "LOT-DEMO-0412",
      startedAt: t(11 * DAY),
      endedAt: t(4 * DAY),
      expectedReplaceAt: t(1 * DAY),
      createdByName: "Minh",
      sourceMode: "simulated",
    },
    {
      id: "ps_2",
      coreDeviceId: "d_core_an",
      recipientId: "r_an",
      lotCode: "LOT-DEMO-0425",
      startedAt: t(4 * DAY),
      endedAt: null,
      expectedReplaceAt: null,
      createdByName: "Lan",
      sourceMode: "simulated",
    },
    {
      id: "ps_3",
      coreDeviceId: "d_core_binh",
      recipientId: "r_binh",
      lotCode: null,
      startedAt: t(2 * DAY),
      endedAt: null,
      expectedReplaceAt: iso(now + 8 * DAY),
      createdByName: "Tuấn",
      sourceMode: "simulated",
    },
  ];

  const sink: DemoFixture["sink"] = [
    {
      id: "nd_1",
      ownerId: "u_minh",
      recipientUserName: "Minh",
      channel: "local_sink",
      status: "provider_accepted",
      isTest: false,
      title: "Cảnh báo cần tiếp nhận · Bà An · Hồ sơ minh họa",
      createdAt: t(24 * MINUTE),
    },
    {
      id: "nd_2",
      ownerId: "u_lan",
      recipientUserName: "Lan",
      channel: "local_sink",
      status: "provider_accepted",
      isTest: false,
      title: "Chuyển thông báo tới người dự phòng · Bà An · Hồ sơ minh họa",
      createdAt: t(5 * MINUTE),
    },
  ];

  const quarantine = [
    {
      id: "q_1",
      at: t(26 * HOUR),
      deviceSerialMasked: maskSerial("EP-CORE-5521-0934"),
      reason: "Gói đo có thời điểm đo trước khi thiết bị được gán hồ sơ hiện tại. Đã cách ly, không gán cho hồ sơ nào.",
    },
  ];

  return {
    users,
    households,
    memberships,
    recipients,
    grants,
    invitations,
    devices,
    assignments,
    events,
    alerts,
    actions,
    notes,
    patchSessions,
    sink,
    quarantine,
  };
}

/** Nhịp tim tổng hợp, tất định theo thời điểm. Chỉ là fixture UI, không mang ý nghĩa y khoa. */
export function syntheticHeartRate(deviceId: string, observedAt: number): { value: number; quality: "good" | "fair" | "poor" } {
  const seed = Math.floor(observedAt / MINUTE) + deviceId.length * 7919;
  const r = mulberry32(seed)();
  const wave = Math.sin(observedAt / (3 * HOUR)) * 5;
  const value = Math.round(70 + wave + (r - 0.5) * 6);
  const quality = r > 0.93 ? "poor" : r > 0.8 ? "fair" : "good";
  return { value, quality };
}

/** SpO₂ tổng hợp, tất định theo thời điểm. Giá trị 95–100% phù hợp với người khỏe mạnh. Chỉ là fixture UI, không mang ý nghĩa y khoa. */
export function syntheticSpo2(deviceId: string, observedAt: number): { value: number; quality: "good" | "fair" | "poor" } {
  const seed = Math.floor(observedAt / MINUTE) + deviceId.length * 7919 + 31337;
  const r = mulberry32(seed)();
  const wave = Math.sin(observedAt / (3 * HOUR)) * 1.5;
  const value = Math.round(97 + wave + (r - 0.5) * 3);
  const clamped = Math.max(95, Math.min(100, value));
  const quality = r > 0.93 ? "poor" : r > 0.8 ? "fair" : "good";
  return { value: clamped, quality };
}
