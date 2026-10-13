/**
 * HỢP ĐỒNG TẠM CHO FRONTEND (giả định A02 trong docs/DECISIONS.md).
 * Chưa có API/OpenAPI. Type viết tay theo docs/IMPLEMENTATION_PLAN.md §8 và docs/ARCHITECTURE.md §6.
 * Khi apps/api có OpenAPI (M1), thay bằng type sinh trong src/data/generated/ theo ADR-007.
 * Không thêm trường ngoài plan chỉ để làm đẹp giao diện.
 */

export type ISODateTime = string;
export type Product = "carelens" | "ecopatch";
export type SourceMode = "simulated" | "device" | "manual" | "telegram";

/** Forces esbuild to emit this module at runtime (esbuild strips pure-type modules in dev mode). */
export const _DATA_VERSION = "1.0";

/* ------------------------------------------------------------------ Identity & access */

export type Permission =
  | "recipient.read"
  | "recipient.manage"
  | "data.read"
  | "alerts.act"
  | "notes.write"
  | "patches.replace"
  | "devices.manage"
  | "sharing.manage"
  | "exports.create"
  | "platform.admin";

export type GrantRole = "care_recipient" | "manager" | "caregiver" | "viewer" | "device_operator";

export interface User {
  id: string;
  displayName: string;
  email: string;
  isPlatformAdmin: boolean;
}

export interface Session {
  user: User;
  mode: "demo" | "http";
  expiresAt: ISODateTime;
}

export interface Household {
  id: string;
  name: string;
}

export interface Membership {
  householdId: string;
  userId: string;
  role: "manager" | "member";
}

export interface ProductEnrollment {
  product: Product;
  status: "active" | "setup_incomplete";
}

export interface RecipientSummary {
  id: string;
  householdId: string;
  householdName: string;
  displayName: string;
  enrollments: ProductEnrollment[];
  sources: SourceStatus[];
  /** null khi người xem không có quyền đọc dữ liệu cảnh báo. */
  openAlertCount: number | null;
  sourceMode: SourceMode;
}

export interface RecipientContext {
  recipient: RecipientSummary;
  permissions: Permission[];
  role: GrantRole;
}

export interface Grant {
  id: string;
  recipientId: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  role: GrantRole;
  permissions: Permission[];
  grantedAt: ISODateTime;
  expiresAt: ISODateTime | null;
  revokedAt: ISODateTime | null;
}

export interface Invitation {
  id: string;
  recipientId: string;
  email: string;
  role: Extract<GrantRole, "caregiver" | "viewer">;
  status: "pending" | "accepted" | "expired" | "cancelled";
  createdAt: ISODateTime;
  expiresAt: ISODateTime;
  invitedByName: string;
}

export interface HouseholdMember {
  userId: string;
  displayName: string;
  role: Membership["role"];
  /** Thành viên nhóm có thể không có quyền trên hồ sơ này. */
  hasRecipientAccess: boolean;
}

/* ------------------------------------------------------------------ Devices & sources */

export type ConnectionState = "connected" | "stale" | "disconnected" | "local_unavailable" | "unknown";

export interface SourceStatus {
  product: Product;
  deviceId: string | null;
  state: ConnectionState;
  lastSeenAt: ISODateTime | null;
  lastDataAt: ISODateTime | null;
  sourceMode: SourceMode;
}

export type DeviceKind = "carelens_hub" | "ecopatch_core";
export type Capability = "care_events" | "hub_status" | "heart_rate" | "signal_quality" | "ecg_waveform" | "battery";

export interface Device {
  id: string;
  recipientId: string | null;
  product: Product;
  kind: DeviceKind;
  label: string;
  serialMasked: string;
  capabilities: Capability[];
  lastSeenAt: ISODateTime | null;
  connection: ConnectionState;
  /** null khi thiết bị không cung cấp. Không tự tạo số pin. */
  batteryPercent: number | null;
  assignedFrom: ISODateTime | null;
  sourceMode: SourceMode;
}

export interface DeviceAssignment {
  id: string;
  deviceId: string;
  recipientId: string;
  validFrom: ISODateTime;
  validTo: ISODateTime | null;
}

export interface PairingChallenge {
  id: string;
  product: Product;
  serial: string;
  status: "awaiting_code" | "verified" | "failed" | "expired";
  expiresAt: ISODateTime;
}

/* ------------------------------------------------------------------ CareLens */

export type Severity = "critical" | "warning" | "notice" | "info";
export type CareEventCategory =
  | "posture"
  | "inactivity"
  | "fall_like"
  | "activity"
  | "care_activity";

export interface CareEvent {
  id: string;
  sourceRecordId: string;
  recipientId: string;
  deviceId: string;
  product: "carelens";
  eventType: "care_observation";
  category: CareEventCategory;
  /** Loại phụ của sự kiện. Ví dụ: "lying" (từ /c_lying). Mặc định = category. */
  type?: string;
  severity: Severity;
  /** Điểm AI thử nghiệm 0–10 do nguồn cung cấp. Không phải xác suất hay độ chính xác. */
  careLevel: number | null;
  summary: string;
  observedAt: ISODateTime;
  receivedAt: ISODateTime;
  modelVersion: string;
  ruleVersion: string;
  alertId: string | null;
  sourceMode: SourceMode;
}

/* ------------------------------------------------------------------ EcoPatch */

export type Metric = "heart_rate" | "spo2";
export type SignalQuality = "good" | "fair" | "poor";

export interface Measurement {
  id: string;
  sourceRecordId: string;
  deviceId: string;
  metric: Metric;
  value: number;
  unit: "bpm" | "%";
  quality: SignalQuality;
  observedAt: ISODateTime;
  receivedAt: ISODateTime;
  sourceMode: SourceMode;
}

export interface PatchSession {
  id: string;
  coreDeviceId: string;
  recipientId: string;
  lotCode: string | null;
  startedAt: ISODateTime;
  endedAt: ISODateTime | null;
  expectedReplaceAt: ISODateTime | null;
  createdByName: string;
  sourceMode: SourceMode;
}

/* ------------------------------------------------------------------ Alerts */

export type AlertStatus = "open" | "acknowledged" | "in_progress" | "resolved";
export type ReviewOutcome = "confirmed" | "false_alarm" | "uncertain";
export type AlertKind = "care_event" | "device_status";

export interface Alert {
  id: string;
  recipientId: string;
  product: Product;
  kind: AlertKind;
  sourceEventId: string | null;
  deviceId: string;
  severity: Severity;
  status: AlertStatus;
  summary: string;
  observedAt: ISODateTime;
  createdAt: ISODateTime;
  assigneeId: string | null;
  assigneeName: string | null;
  reviewOutcome: ReviewOutcome | null;
  resolutionNote: string | null;
  resolvedAt: ISODateTime | null;
  resolvedByName: string | null;
  ruleVersion: string;
  version: number;
  sourceMode: SourceMode;
}

export type AlertActionType = "acknowledge" | "start" | "resolve" | "escalate" | "reminder";

export interface AlertAction {
  id: string;
  alertId: string;
  type: AlertActionType;
  actorName: string;
  /** "system" cho nhắc việc/chuyển người dự phòng do worker ghi. */
  actorKind: "user" | "system";
  outcome: ReviewOutcome | null;
  note: string | null;
  at: ISODateTime;
}

export interface AlertDetail {
  alert: Alert;
  event: CareEvent | null;
  device: Device | null;
  actions: AlertAction[];
}

export type AlertActionInput =
  | { type: "acknowledge"; expectedVersion: number }
  | { type: "start"; expectedVersion: number }
  | { type: "resolve"; expectedVersion: number; outcome: ReviewOutcome; note: string };

/* ------------------------------------------------------------------ Backend device state (LIVESHOWCASE SSE) */

export interface BackendLatestData {
  kind: "hub_status" | "heart_rate" | "spo2";
  value: number | null;
  unit: "bpm" | "%" | null;
  quality: SignalQuality | null;
  observed_at: ISODateTime;
  summary: string | null;
}

export interface BackendDeviceState {
  id: string;
  recipient_id: string;
  online: boolean;
  last_seen_at: ISODateTime | null;
  signal: "connected" | "offline";
  latest_data: BackendLatestData | null;
}

/* ------------------------------------------------------------------ Notes, history, reports */

export interface CareNote {
  id: string;
  recipientId: string;
  authorName: string;
  body: string;
  createdAt: ISODateTime;
}

/** Shape emitted by the demo-control backend SSE stream. */
export interface NoteFromBackend {
  id: string;
  recipient_id: string;
  author_name: string;
  body: string;
  created_at: ISODateTime;
}

export type HistoryItemType = "care_event" | "alert_action" | "note" | "patch_change" | "device_assignment";

export interface HistoryItem {
  id: string;
  type: HistoryItemType;
  at: ISODateTime;
  title: string;
  detail: string | null;
  actorName: string | null;
  product: Product | null;
  /** Nhận định AI (chưa xác nhận) tách khỏi ghi chú của con người. */
  origin: "ai" | "human" | "system";
  link: { kind: "alert" | "event"; id: string } | null;
  sourceMode: SourceMode;
}

export interface ReportSummary {
  from: ISODateTime;
  to: ISODateTime;
  timezone: string;
  products: Product[];
  alerts: {
    created: number;
    resolved: number;
    stillOpen: number;
    outcomes: Record<ReviewOutcome, number>;
  };
  careEvents: number | null;
  measurements: {
    count: number;
    gapCount: number;
    gapThresholdMinutes: number;
  } | null;
  patchChanges: number | null;
  sourceMode: SourceMode;
}

export interface ExportJob {
  id: string;
  recipientId: string;
  status: "pending" | "ready" | "failed";
  from: ISODateTime;
  to: ISODateTime;
  products: Product[];
  filename: string;
  createdAt: ISODateTime;
  failureReason: string | null;
}

/* ------------------------------------------------------------------ Notifications */

export interface NotificationDelivery {
  id: string;
  recipientUserName: string;
  channel: "local_sink";
  status: "queued" | "provider_accepted" | "failed";
  isTest: boolean;
  title: string;
  createdAt: ISODateTime;
}

export interface NotificationSettings {
  inPageUpdates: boolean;
  webPush: "not_configured";
  backupUserId: string | null;
  reminderMinutes: number | null;
  backupCandidates: Array<{ userId: string; displayName: string }>;
}

/* ------------------------------------------------------------------ Admin */

export interface ServiceDiagnostics {
  dataMode: "demo" | "http";
  services: Array<{ name: string; state: "operational" | "degraded" | "unavailable" | "not_configured"; detail: string }>;
  deviceCounts: Record<ConnectionState, number>;
  integrationIssues: Array<{ id: string; at: ISODateTime; deviceSerialMasked: string; reason: string }>;
  accounts: Array<{ id: string; displayName: string; email: string; status: "active" | "locked" }>;
}

/* ------------------------------------------------------------------ Stream hints (ADR-010) */

export type StreamHintType =
  | "alert.created"
  | "alert.updated"
  | "event.created"
  | "measurement.created"
  | "device.updated"
  | "grant.revoked"
  | "patch.updated"
  | "note.created";

export interface StreamHint {
  seq: number;
  type: StreamHintType;
  recipientId: string;
  entityId: string;
}

/* ------------------------------------------------------------------ Paging & queries */

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type TimeRange = "6h" | "24h" | "7d" | "30d";

export interface EventQuery {
  range: TimeRange;
  severity: Severity | "all";
  category: CareEventCategory | "all";
  cursor?: string | null;
}

export interface AlertQuery {
  product: Product | "all";
  status: AlertStatus | "active" | "all";
  range: TimeRange;
  assignee: "all" | "me" | "unassigned";
  cursor?: string | null;
}

export interface HistoryQuery {
  type: HistoryItemType | "all";
  range: TimeRange;
  cursor?: string | null;
}
