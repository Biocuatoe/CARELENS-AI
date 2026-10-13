/**
 * Adapter mô phỏng chạy trong trình duyệt. Giả lập hành vi server theo plan §5, §7, §9:
 * phân quyền theo hồ sơ, state machine cảnh báo có version, dedup, gói đến muộn, idempotency, stream.
 * KHÔNG phải bảo mật thật: mọi kiểm tra ở đây chỉ để demo và test giao diện (AGENTS.md §6).
 * Trạng thái chỉ nằm trong bộ nhớ; tải lại trang sẽ đặt lại dữ liệu và phiên (giả định A04).
 */
import type {
  AccessOverview,
  BackendDeviceState,
  BackendLatestData,
  DataAdapter,
    DemoControls,
  DemoPersona,
    MeasurementSeries,
    Overview,
    StreamHandlers,
} from "../adapter";
import type {
  Alert,
  AlertAction,
  AlertActionInput,
  AlertDetail,
  AlertQuery,
  CareEvent,
  CareNote,
  NoteFromBackend,
  ConnectionState,
  Device,
  EventQuery,
  ExportJob,
  HistoryItem,
  HistoryQuery,
  Household,
  Invitation,
  Measurement,
  NotificationDelivery,
  NotificationSettings,
  Page,
  PairingChallenge,
  PatchSession,
  Permission,
  Product,
  RecipientContext,
  RecipientSummary,
  ReportSummary,
  ServiceDiagnostics,
  Session,
  SourceStatus,
  StreamHint,
  StreamHintType,
  TimeRange,
} from "../contracts";
import { ApiError } from "../errors";
import { ROLE_PERMISSIONS } from "../permissions";
import { toCsv } from "../../lib/csv";
import { DISPLAY_TIMEZONE, TIMEZONE_LABEL, formatDateTime, rangeToMs } from "../../lib/time";
import {
  DAY,
  DEMO_ALERT_THRESHOLD,
  DEMO_MODEL_VERSION,
  DEMO_RULE_VERSION,
  HOUR,
  MEASUREMENT_INTERVAL_MIN,
  MINUTE,
  PERSONAS,
  buildFixture,
  iso,
  isDynamicPersona,
  maskSerial,
  syntheticHeartRate,
  syntheticSpo2,
  type DemoDevice,
  type DemoFixture,
  type DemoMode,
} from "./fixtures";

/** Ngưỡng kết nối là cấu hình kỹ thuật demo, không phải cam kết sản phẩm (plan §7.4). */
export const CONNECTION_THRESHOLDS = { staleAfterMin: 5, disconnectedAfterMin: 15 };

/** Base URL of the demo-control FastAPI server (backend + bot combined).
 *  The bot writes state to a JSON file; the API serves SSE at /api/demo/stream.
 *  Configurable via VITE_API_BASE_URL (default port 8787, must match scripts/demo/_run-api.ps1).
 *  Only used for dynamic personas (LIVSHOWCASE); static personas never call this URL. */
export const DEMO_API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8787";
const PAGE_SIZE = { events: 15, alerts: 20, history: 20 };
const MAX_REPORT_RANGE_DAYS = 90;

export interface DemoAdapterOptions {
  now?: () => number;
  latencyMs?: [number, number];
  /** Override the backend API base URL (useful in tests). Falls back to VITE_API_BASE_URL then DEMO_API_BASE. */
  apiBase?: string;
}

interface DemoState extends DemoFixture {
  sessionUserId: string | null;
  sessionExpired: boolean;
  mode: DemoMode;
  measurements: Measurement[];
  generatedUntil: Record<string, number>;
  exports: Array<ExportJob & { readyAt: number; content: string | null; userId: string }>;
  pairings: Array<PairingChallenge & { recipientId: string; deviceId: string; attempts: number }>;
  idempotency: Map<string, string>;
  settings: Record<string, { backupUserId: string | null; reminderMinutes: number | null }>;
  seq: number;
  streamLog: StreamHint[];
  counter: number;
  /** Cập nhật khi nhận SSE state_update từ backend (Telegram → state.json → SSE). */
  backendUpdatedAt: string | null;
  /** Timestamp của lần reset gần nhất đã xử lý (từ backend `reset_at`). Dùng để bỏ qua reset cũ trong các SSE message sau. */
  lastResetAt: string | null;
  /**
   * Backend-driven device states keyed by device id.
   * Seeded from fixtures for LIVESHOWCASE; updated on each SSE state_update.
   * Only populated for `r_liveshowcase`. Other recipients use an empty record.
   */
  backendDevices: Record<string, BackendDeviceState>;
  /** Care notes received from the backend via SSE (e.g. from Telegram /c_water, /c_medicine). */
  notes: CareNote[];
}

type Subscriber = { id: number; recipientId: string; userId: string; handlers: StreamHandlers };


export class DemoAdapter implements DataAdapter, DemoControls {
  readonly mode = "demo" as const;
  private state!: DemoState;
  private readonly now: () => number;
  private readonly latency: [number, number];
  private readonly apiBase: string;
  private subscribers = new Map<number, Subscriber>();
  private subscriberSeq = 0;

  constructor(options: DemoAdapterOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.latency = options.latencyMs ?? [120, 320];
    this.apiBase =
      options.apiBase ??
      ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8787");
    this.reset();
  }

  /** Returns the effective API base URL (constructor option → VITE_API_BASE_URL → default). */
  getApiBase(): string {
    return this.apiBase;
  }

  /** Returns the current demo mode. */
  getMode(): DemoMode {
    return this.state.mode;
  }

  private isDynamic(): boolean {
    return this.state.mode === "dynamic";
  }

  /* ================================================================ infrastructure */

  reset(): void {
    const now = this.now();
    const fixture = buildFixture(now);
    const previousUser = this.state?.sessionUserId ?? null;
    this.state = {
      ...fixture,
      sessionUserId: previousUser,
      sessionExpired: false,
      mode: "static",
      measurements: [],
      generatedUntil: {},
      exports: [],
      pairings: [],
      idempotency: new Map(),
      settings: {
        u_minh: { backupUserId: "u_lan", reminderMinutes: 10 },
        u_lan: { backupUserId: "u_minh", reminderMinutes: 10 },
      },
      seq: 0,
      streamLog: [],
      counter: 1000,
      backendUpdatedAt: null,
      lastResetAt: null,
      backendDevices: {
        d_hub_liveshowcase: {
          id: "d_hub_liveshowcase",
          recipient_id: "r_liveshowcase",
          online: false,
          last_seen_at: null,
          signal: "offline",
          latest_data: null,
        },
        d_core_liveshowcase: {
          id: "d_core_liveshowcase",
          recipient_id: "r_liveshowcase",
          online: false,
          last_seen_at: null,
          signal: "offline",
          latest_data: null,
        },
      },
      notes: [],
    };
    for (const device of this.state.devices) this.seedMeasurements(device, now);
  }

  private async delay(): Promise<void> {
    const [min, max] = this.latency;
    if (max <= 0) return;
    await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
  }

  private nextId(prefix: string): string {
    this.state.counter += 1;
    return `${prefix}_${this.state.counter}`;
  }

  private nowIso(): string {
    return iso(this.now());
  }

  private user(id: string) {
    const user = this.state.users.find((u) => u.id === id);
    if (!user) throw new ApiError(404, "not_found", "Không tìm thấy tài khoản.");
    return user;
  }

  private requireSession() {
    if (this.state.sessionExpired) {
      this.state.sessionUserId = null;
      throw new ApiError(401, "session_expired", "Phiên đăng nhập đã hết hạn. Vui lòng vào lại.");
    }
    if (!this.state.sessionUserId) throw new ApiError(401, "unauthenticated", "Bạn cần đăng nhập để tiếp tục.");
    return this.user(this.state.sessionUserId);
  }

  private activeGrant(userId: string, recipientId: string) {
    const now = this.now();
    return this.state.grants.find(
      (g) =>
        g.userId === userId &&
        g.recipientId === recipientId &&
        !g.revokedAt &&
        (!g.expiresAt || new Date(g.expiresAt).getTime() > now),
    );
  }

  /** Kiểm tra quyền theo hồ sơ: không có grant → 404, thiếu permission → 403, chưa bật sản phẩm → 404. */
  private authorize(recipientId: string, needed: Permission[] = ["recipient.read"], product?: Product) {
    const user = this.requireSession();
    const recipient = this.state.recipients.find((r) => r.id === recipientId);
    const grant = recipient ? this.activeGrant(user.id, recipientId) : undefined;
    if (!recipient || !grant) {
      throw new ApiError(404, "not_found", "Hồ sơ không tồn tại hoặc bạn không được cấp quyền.");
    }
    const missing = needed.filter((p) => !grant.permissions.includes(p));
    if (missing.length > 0) {
      throw new ApiError(403, "forbidden", "Bạn không có quyền thực hiện thao tác này trên hồ sơ.");
    }
    if (product && !recipient.enrollments.some((e) => e.product === product)) {
      throw new ApiError(404, "not_found", "Hồ sơ này chưa kích hoạt giải pháp được yêu cầu.");
    }
    return { user, recipient, grant };
  }

  private emit(recipientId: string, type: StreamHintType, entityId: string) {
    this.state.seq += 1;
    const hint: StreamHint = { seq: this.state.seq, type, recipientId, entityId };
    this.state.streamLog.push(hint);
    if (this.state.streamLog.length > 200) this.state.streamLog.shift();
    for (const sub of this.subscribers.values()) {
      if (sub.recipientId !== recipientId) continue;
      if (!this.activeGrant(sub.userId, recipientId)) continue;
      queueMicrotask(() => sub.handlers.onHint(hint));
    }
  }

  /* ================================================================ derived data */

  private deviceRecipient(deviceId: string, at?: number): string | null {
    const time = at ?? this.now();
    const a = this.state.assignments.find(
      (x) =>
        x.deviceId === deviceId &&
        new Date(x.validFrom).getTime() <= time &&
        (!x.validTo || new Date(x.validTo).getTime() > time),
    );
    return a?.recipientId ?? null;
  }

  private connection(device: DemoDevice): { state: ConnectionState; lastSeenAt: string | null } {
    const now = this.now();
    const lastSeen = device.online ? Math.floor(now / 30_000) * 30_000 : device.lastSeenStored;
    if (lastSeen === null) return { state: "unknown", lastSeenAt: null };
    if (!device.localAccess) return { state: "local_unavailable", lastSeenAt: iso(lastSeen) };
    const ageMin = (now - lastSeen) / MINUTE;
    const state: ConnectionState =
      ageMin < CONNECTION_THRESHOLDS.staleAfterMin
        ? "connected"
        : ageMin < CONNECTION_THRESHOLDS.disconnectedAfterMin
          ? "stale"
          : "disconnected";
    return { state, lastSeenAt: iso(lastSeen) };
  }

  private toDevice(device: DemoDevice): Device {
    const conn = this.connection(device);
    const assignment = this.state.assignments.find((a) => a.deviceId === device.id && !a.validTo);
    return {
      id: device.id,
      recipientId: assignment?.recipientId ?? null,
      product: device.product,
      kind: device.kind,
      label: device.label,
      serialMasked: maskSerial(device.serial),
      capabilities: [...device.capabilities],
      lastSeenAt: conn.lastSeenAt,
      connection: conn.state,
      batteryPercent: device.capabilities.includes("battery") ? device.batteryPercent : null,
      assignedFrom: assignment?.validFrom ?? null,
      sourceMode: "simulated",
    };
  }

  private recipientDevices(recipientId: string): DemoDevice[] {
    const ids = new Set(
      this.state.assignments.filter((a) => a.recipientId === recipientId && !a.validTo).map((a) => a.deviceId),
    );
    return this.state.devices.filter((d) => ids.has(d.id));
  }

  private seedMeasurements(device: DemoDevice, now: number) {
    if (device.kind !== "ecopatch_core" || !this.deviceRecipient(device.id, now)) return;
    const step = MEASUREMENT_INTERVAL_MIN * MINUTE;
    const start = Math.floor((now - 8 * DAY) / step) * step;
    this.state.generatedUntil[device.id] = start;
    this.generateMeasurements(device, now);
  }

  private generateMeasurements(device: DemoDevice, now: number) {
    const step = MEASUREMENT_INTERVAL_MIN * MINUTE;
    const limit = device.online ? now : (device.lastSeenStored ?? 0);
    let cursor = (this.state.generatedUntil[device.id] ?? limit) + step;
    while (cursor <= limit) {
      const inGap = device.gaps.some(([a, b]) => cursor >= a && cursor < b);
      if (!inGap && this.deviceRecipient(device.id, cursor)) {
        // Generate heart_rate measurement
        const { value: hrValue, quality: hrQuality } = syntheticHeartRate(device.id, cursor);
        const nearGap = device.gaps.some(([a, b]) => Math.abs(cursor - a) < 30 * MINUTE || Math.abs(cursor - b) < 30 * MINUTE);
        this.state.measurements.push({
          id: `m_${device.id}_${cursor}`,
          sourceRecordId: `sim-measurement-${device.id}-${cursor}`,
          deviceId: device.id,
          metric: "heart_rate",
          value: hrValue,
          unit: "bpm",
          quality: nearGap ? "poor" : hrQuality,
          observedAt: iso(cursor),
          receivedAt: iso(cursor + 2_000),
          sourceMode: "simulated",
        });
        // Generate spo2 measurement
        const { value: spo2Value, quality: spo2Quality } = syntheticSpo2(device.id, cursor);
        this.state.measurements.push({
          id: `s_${device.id}_${cursor}`,
          sourceRecordId: `sim-spo2-${device.id}-${cursor}`,
          deviceId: device.id,
          metric: "spo2",
          value: spo2Value,
          unit: "%",
          quality: nearGap ? "poor" : spo2Quality,
          observedAt: iso(cursor),
          receivedAt: iso(cursor + 2_000),
          sourceMode: "simulated",
        });
      }
      this.state.generatedUntil[device.id] = cursor;
      cursor += step;
    }
  }

  private refreshMeasurements() {
    const now = this.now();
    for (const d of this.state.devices) if (d.kind === "ecopatch_core" && d.online) this.generateMeasurements(d, now);
  }

  private measurementsFor(recipientId: string): Measurement[] {
    this.refreshMeasurements();
    return this.state.measurements.filter(
      (m) => this.deviceRecipient(m.deviceId, new Date(m.observedAt).getTime()) === recipientId,
    );
  }

  /** Giá trị mới nhất theo observed_at, không theo thứ tự nhận (AC08). */
  private latestMeasurement(recipientId: string): Measurement | null {
    let latest: Measurement | null = null;
    for (const m of this.measurementsFor(recipientId)) {
      if (!latest || m.observedAt > latest.observedAt) latest = m;
    }
    return latest;
  }

  private sourcesFor(recipientId: string): SourceStatus[] {
    const recipient = this.state.recipients.find((r) => r.id === recipientId)!;
    return recipient.enrollments.map((enrollment) => {
      const device = this.recipientDevices(recipientId).find((d) => d.product === enrollment.product);
      if (!device) {
        return {
          product: enrollment.product,
          deviceId: null,
          state: "unknown" as const,
          lastSeenAt: null,
          lastDataAt: null,
          sourceMode: "simulated" as const,
        };
      }
      const conn = this.connection(device);
      const lastDataAt =
        enrollment.product === "carelens"
          ? (this.state.events
              .filter((e) => e.recipientId === recipientId)
              .map((e) => e.observedAt)
              .sort()
              .at(-1) ?? null)
          : (this.latestMeasurement(recipientId)?.observedAt ?? null);
      return {
        product: enrollment.product,
        deviceId: device.id,
        state: conn.state,
        lastSeenAt: conn.lastSeenAt,
        lastDataAt,
        sourceMode: "simulated" as const,
      };
    });
  }

  private summary(recipientId: string, userId: string): RecipientSummary {
    const recipient = this.state.recipients.find((r) => r.id === recipientId)!;
    const grant = this.activeGrant(userId, recipientId);
    const canRead = grant?.permissions.includes("data.read") ?? false;
    return {
      id: recipient.id,
      householdId: recipient.householdId,
      householdName: this.state.households.find((h) => h.id === recipient.householdId)?.name ?? "",
      displayName: recipient.displayName,
      enrollments: recipient.enrollments.map((e) => ({ ...e })),
      sources: this.sourcesFor(recipientId),
      openAlertCount: canRead
        ? this.state.alerts.filter((a) => a.recipientId === recipientId && a.status !== "resolved").length
        : null,
      sourceMode: "simulated",
    };
  }

  private paginate<T>(items: T[], cursor: string | null | undefined, size: number): Page<T> {
    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const slice = items.slice(offset, offset + size);
    const next = offset + size < items.length ? String(offset + size) : null;
    return { items: slice, nextCursor: next };
  }

  private since(range: TimeRange): number {
    return this.now() - rangeToMs(range);
  }

  /* ================================================================ auth */

  listPersonas(): DemoPersona[] {
    return PERSONAS.map((p) => ({ ...p }));
  }

  async enterDemo(personaId: string): Promise<Session> {
    await this.delay();
    const user = this.user(personaId);
    this.state.sessionUserId = user.id;
    this.state.sessionExpired = false;
    this.state.mode = isDynamicPersona(personaId) ? "dynamic" : "static";
    return this.sessionFor(user.id);
  }

  private sessionFor(userId: string): Session {
    const user = this.user(userId);
    return {
      user: { id: user.id, displayName: user.displayName, email: user.email, isPlatformAdmin: user.isPlatformAdmin },
      mode: "demo",
      expiresAt: iso(this.now() + 8 * HOUR),
    };
  }

  async getSession(): Promise<Session> {
    await this.delay();
    const user = this.requireSession();
    return this.sessionFor(user.id);
  }

  async login(input: { email: string; password: string }): Promise<Session> {
    await this.delay();
    void input;
    throw new ApiError(
      503,
      "auth_unavailable",
      "Bản demo chưa kết nối máy chủ xác thực nên không kiểm tra được tài khoản. Hãy dùng “Vào bản demo”.",
    );
  }

  async logout(): Promise<void> {
    await this.delay();
    const userId = this.state.sessionUserId;
    this.state.sessionUserId = null;
    for (const [id, sub] of this.subscribers) if (sub.userId === userId) this.subscribers.delete(id);
  }

  expireSession(): void {
    this.state.sessionExpired = true;
    for (const [id, sub] of this.subscribers) {
      sub.handlers.onClose("session_expired");
      this.subscribers.delete(id);
    }
  }

  /* ================================================================ recipients */

  async listRecipients(): Promise<RecipientSummary[]> {
    await this.delay();
    const user = this.requireSession();
    return this.state.recipients
      .filter((r) => this.activeGrant(user.id, r.id))
      .map((r) => this.summary(r.id, user.id));
  }

  async getRecipientContext(recipientId: string): Promise<RecipientContext> {
    await this.delay();
    const { user, grant } = this.authorize(recipientId);
    return { recipient: this.summary(recipientId, user.id), permissions: [...grant.permissions], role: grant.role };
  }

  async listManagedHouseholds(): Promise<Household[]> {
    await this.delay();
    const user = this.requireSession();
    if (user.isPlatformAdmin) return [];
    const ids = this.state.memberships.filter((m) => m.userId === user.id && m.role === "manager").map((m) => m.householdId);
    return this.state.households.filter((h) => ids.includes(h.id));
  }

  async createRecipient(input: {
    householdId: string | null;
    newHouseholdName: string | null;
    displayName: string;
    products: Product[];
  }): Promise<RecipientSummary> {
    await this.delay();
    const user = this.requireSession();
    if (user.isPlatformAdmin) throw new ApiError(403, "forbidden", "Tài khoản quản trị nền tảng không tạo hồ sơ chăm sóc.");
    const fieldErrors: Record<string, string> = {};
    const displayName = input.displayName.trim();
    if (displayName.length < 2) fieldErrors.displayName = "Nhập tên hiển thị của hồ sơ (ít nhất 2 ký tự).";
    if (input.products.length === 0) fieldErrors.products = "Chọn ít nhất một giải pháp.";
    let householdId = input.householdId;
    if (householdId) {
      const manages = this.state.memberships.some(
        (m) => m.householdId === householdId && m.userId === user.id && m.role === "manager",
      );
      if (!manages) throw new ApiError(403, "forbidden", "Bạn không quản lý nhóm này.");
    } else if (!input.newHouseholdName || input.newHouseholdName.trim().length < 2) {
      fieldErrors.newHouseholdName = "Nhập tên nhóm gia đình (ít nhất 2 ký tự).";
    }
    if (Object.keys(fieldErrors).length) {
      throw new ApiError(422, "validation", "Thông tin chưa hợp lệ.", { fieldErrors });
    }
    if (!householdId) {
      householdId = this.nextId("h");
      this.state.households.push({ id: householdId, name: input.newHouseholdName!.trim() });
      this.state.memberships.push({ householdId, userId: user.id, role: "manager" });
    }
    const recipientId = this.nextId("r");
    this.state.recipients.push({
      id: recipientId,
      householdId,
      displayName,
      enrollments: input.products.map((product) => ({ product, status: "setup_incomplete" })),
    });
    this.state.grants.push({
      id: this.nextId("g"),
      recipientId,
      userId: user.id,
      userDisplayName: user.displayName,
      userEmail: user.email,
      role: "manager",
      permissions: Array.from(
        new Set<Permission>([...ROLE_PERMISSIONS.manager, "data.read", "alerts.act", "notes.write", "patches.replace", "exports.create"]),
      ),
      grantedAt: this.nowIso(),
      expiresAt: null,
      revokedAt: null,
    });
    return this.summary(recipientId, user.id);
  }

  /* ================================================================ overview & sources */

  async getOverview(recipientId: string): Promise<Overview> {
    await this.delay();
    const { grant, recipient } = this.authorize(recipientId, ["data.read"]);
    const enrolled = new Set(recipient.enrollments.map((e) => e.product));
    const openAlerts = this.state.alerts
      .filter((a) => a.recipientId === recipientId && a.status !== "resolved")
      .sort((a, b) => {
        if ((a.status === "open") !== (b.status === "open")) return a.status === "open" ? -1 : 1;
        return b.observedAt.localeCompare(a.observedAt);
      });
    const latestEvent = enrolled.has("carelens")
      ? (this.state.events
          .filter((e) => e.recipientId === recipientId)
          .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0] ?? null)
      : null;
    const latestMeasurement = enrolled.has("ecopatch") ? this.latestMeasurement(recipientId) : null;
    const activePatch = enrolled.has("ecopatch")
      ? (this.state.patchSessions.find((p) => p.recipientId === recipientId && !p.endedAt) ?? null)
      : null;
    const pendingInvitationCount = grant.permissions.includes("sharing.manage")
      ? this.state.invitations.filter(
          (i) => i.recipientId === recipientId && i.status === "pending" && new Date(i.expiresAt).getTime() > this.now(),
        ).length
      : null;
    const recent = this.historyItems(recipientId).slice(0, 6);
    // Persona isolation: backendUpdatedAt is only meaningful for r_liveshowcase.
    // Other personas (u_minh, u_lan, u_ha, u_khoa) MUST NOT see backend timestamps.
    const backendUpdatedAt = recipientId === "r_liveshowcase" ? this.state.backendUpdatedAt : null;
    return {
      openAlerts: openAlerts.map((a) => ({ ...a })),
      latestEvent,
      latestMeasurement,
      activePatch,
      pendingInvitationCount,
      recent,
      backendUpdatedAt,
    };
  }

  async listEvents(recipientId: string, query: EventQuery): Promise<Page<CareEvent>> {
    await this.delay();
    this.authorize(recipientId, ["data.read"], "carelens");
    const since = this.since(query.range);
    const items = this.state.events
      .filter(
        (e) =>
          e.recipientId === recipientId &&
          new Date(e.observedAt).getTime() >= since &&
          (query.severity === "all" || e.severity === query.severity) &&
          (query.category === "all" || e.category === query.category),
      )
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.id.localeCompare(a.id));
    return this.paginate(items, query.cursor, PAGE_SIZE.events);
  }

  async getEvent(recipientId: string, eventId: string): Promise<CareEvent> {
    await this.delay();
    this.authorize(recipientId, ["data.read"], "carelens");
    const event = this.state.events.find((e) => e.id === eventId && e.recipientId === recipientId);
    if (!event) throw new ApiError(404, "not_found", "Không tìm thấy sự kiện.");
    return { ...event };
  }

  async listMeasurements(recipientId: string, query: { metric: "heart_rate" | "spo2"; range: TimeRange }): Promise<MeasurementSeries> {
    await this.delay();
    this.authorize(recipientId, ["data.read"], "ecopatch");
    if (query.range === "30d") {
      throw new ApiError(422, "validation", "Khoảng thời gian phép đo tối đa là 7 ngày.");
    }
    const from = this.since(query.range);
    const all = this.measurementsFor(recipientId).filter((m) => m.metric === query.metric);
    const items = all
      .filter((m) => new Date(m.observedAt).getTime() >= from)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    return {
      items,
      latest: this.latestMeasurement(recipientId),
      expectedIntervalMinutes: MEASUREMENT_INTERVAL_MIN,
      from: iso(from),
      to: this.nowIso(),
    };
  }

  /* ================================================================ ingest (dùng bởi điều khiển demo và test) */

  /** Mô phỏng POST /ingest/carelens/events: dedup theo (device_id, source_record_id), gán hồ sơ theo assignment. */
  ingestCareEvent(payload: {
    deviceId: string;
    sourceRecordId: string;
    observedAt: string;
    category: CareEvent["category"];
    severity: CareEvent["severity"];
    careLevel: number | null;
    summary: string;
  }): { event: CareEvent | null; duplicate: boolean; quarantined: boolean } {
    const existing = this.state.events.find(
      (e) => e.deviceId === payload.deviceId && e.sourceRecordId === payload.sourceRecordId,
    );
    if (existing) return { event: existing, duplicate: true, quarantined: false };
    const observed = new Date(payload.observedAt).getTime();
    const recipientId = this.deviceRecipient(payload.deviceId, observed);
    if (!recipientId) {
      const device = this.state.devices.find((d) => d.id === payload.deviceId);
      this.state.quarantine.push({
        id: this.nextId("q"),
        at: this.nowIso(),
        deviceSerialMasked: device ? maskSerial(device.serial) : "không xác định",
        reason: "Không xác định được hồ sơ tại thời điểm đo. Đã cách ly.",
      });
      return { event: null, duplicate: false, quarantined: true };
    }
    const event: CareEvent = {
      id: this.nextId("ev"),
      sourceRecordId: payload.sourceRecordId,
      recipientId,
      deviceId: payload.deviceId,
      product: "carelens",
      eventType: "care_observation",
      category: payload.category,
      severity: payload.severity,
      careLevel: payload.careLevel,
      summary: payload.summary,
      observedAt: payload.observedAt,
      receivedAt: this.nowIso(),
      modelVersion: DEMO_MODEL_VERSION,
      ruleVersion: DEMO_RULE_VERSION,
      alertId: null,
      sourceMode: "simulated",
    };
    this.state.events.push(event);
    this.emit(recipientId, "event.created", event.id);
    if (event.careLevel !== null && event.careLevel >= DEMO_ALERT_THRESHOLD) {
      const alert: Alert = {
        id: this.nextId("al"),
        recipientId,
        product: "carelens",
        kind: "care_event",
        sourceEventId: event.id,
        deviceId: event.deviceId,
        severity: event.severity,
        status: "open",
        summary: event.summary,
        observedAt: event.observedAt,
        createdAt: event.receivedAt,
        assigneeId: null,
        assigneeName: null,
        reviewOutcome: null,
        resolutionNote: null,
        resolvedAt: null,
        resolvedByName: null,
        ruleVersion: DEMO_RULE_VERSION,
        version: 1,
        sourceMode: "simulated",
      };
      event.alertId = alert.id;
      this.state.alerts.push(alert);
      const recipient = this.state.recipients.find((r) => r.id === recipientId)!;
      for (const g of this.state.grants) {
        if (g.recipientId !== recipientId || g.revokedAt || !g.permissions.includes("alerts.act")) continue;
        this.state.sink.unshift({
          id: this.nextId("nd"),
          ownerId: g.userId,
          recipientUserName: g.userDisplayName,
          channel: "local_sink",
          status: "queued",
          isTest: false,
          title: `Cảnh báo cần tiếp nhận · ${recipient.displayName}`,
          createdAt: this.nowIso(),
        });
      }
      this.emit(recipientId, "alert.created", alert.id);
    }
    return { event, duplicate: false, quarantined: false };
  }

  /** Mô phỏng POST /ingest/ecopatch/measurements. Gói đến muộn vào lịch sử, không đè giá trị mới hơn. */
  ingestMeasurement(payload: { deviceId: string; sourceRecordId: string; observedAt: string; value: number; quality: Measurement["quality"] }) {
    const existing = this.state.measurements.find(
      (m) => m.deviceId === payload.deviceId && m.sourceRecordId === payload.sourceRecordId,
    );
    if (existing) return { measurement: existing, duplicate: true, quarantined: false };
    const recipientId = this.deviceRecipient(payload.deviceId, new Date(payload.observedAt).getTime());
    if (!recipientId) return { measurement: null, duplicate: false, quarantined: true };
    const measurement: Measurement = {
      id: this.nextId("m"),
      sourceRecordId: payload.sourceRecordId,
      deviceId: payload.deviceId,
      metric: "heart_rate",
      value: payload.value,
      unit: "bpm",
      quality: payload.quality,
      observedAt: payload.observedAt,
      receivedAt: this.nowIso(),
      sourceMode: "simulated",
    };
    this.state.measurements.push(measurement);
    this.emit(recipientId, "measurement.created", measurement.id);
    return { measurement, duplicate: false, quarantined: false };
  }

  /* ================================================================ alerts */

  async listAlerts(recipientId: string, query: AlertQuery): Promise<Page<Alert>> {
    await this.delay();
    const { user, recipient } = this.authorize(recipientId, ["data.read"]);
    const enrolled = new Set(recipient.enrollments.map((e) => e.product));
    const since = this.since(query.range);
    const items = this.state.alerts
      .filter((a) => {
        if (a.recipientId !== recipientId || !enrolled.has(a.product)) return false;
        if (query.product !== "all" && a.product !== query.product) return false;
        if (query.status === "active" && a.status === "resolved") return false;
        if (query.status !== "active" && query.status !== "all" && a.status !== query.status) return false;
        if (query.assignee === "me" && a.assigneeId !== user.id) return false;
        if (query.assignee === "unassigned" && a.assigneeId !== null) return false;
        return new Date(a.observedAt).getTime() >= since;
      })
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.id.localeCompare(a.id))
      .map((a) => ({ ...a }));
    return this.paginate(items, query.cursor, PAGE_SIZE.alerts);
  }

  private alertDetail(alert: Alert): AlertDetail {
    const event = alert.sourceEventId ? (this.state.events.find((e) => e.id === alert.sourceEventId) ?? null) : null;
    const device = this.state.devices.find((d) => d.id === alert.deviceId);
    return {
      alert: { ...alert },
      event: event ? { ...event } : null,
      device: device ? this.toDevice(device) : null,
      actions: this.state.actions
        .filter((a) => a.alertId === alert.id)
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((a) => ({ ...a })),
    };
  }

  async getAlert(recipientId: string, alertId: string): Promise<AlertDetail> {
    await this.delay();
    const { recipient } = this.authorize(recipientId, ["data.read"]);
    const alert = this.state.alerts.find((a) => a.id === alertId && a.recipientId === recipientId);
    if (!alert || !recipient.enrollments.some((e) => e.product === alert.product)) {
      throw new ApiError(404, "not_found", "Không tìm thấy cảnh báo trong hồ sơ này.");
    }
    return this.alertDetail(alert);
  }

  async actOnAlert(recipientId: string, alertId: string, input: AlertActionInput): Promise<AlertDetail> {
    await this.delay();
    const { user } = this.authorize(recipientId, ["data.read", "alerts.act"]);
    const alert = this.state.alerts.find((a) => a.id === alertId && a.recipientId === recipientId);
    if (!alert) throw new ApiError(404, "not_found", "Không tìm thấy cảnh báo trong hồ sơ này.");

    if (input.type === "resolve") {
      const fieldErrors: Record<string, string> = {};
      if (!["confirmed", "false_alarm", "uncertain"].includes(input.outcome)) fieldErrors.outcome = "Chọn kết quả kiểm tra.";
      if (input.note.trim().length < 3) fieldErrors.note = "Nhập ghi chú xử lý (ít nhất 3 ký tự).";
      if (Object.keys(fieldErrors).length) throw new ApiError(422, "validation", "Thông tin chưa hợp lệ.", { fieldErrors });
    }

    if (alert.version !== input.expectedVersion) {
      throw new ApiError(409, "conflict", this.conflictMessage(alert), { current: this.alertDetail(alert) });
    }

    const allowed: Record<AlertActionInput["type"], Alert["status"][]> = {
      acknowledge: ["open"],
      start: ["acknowledged"],
      resolve: ["acknowledged", "in_progress"],
    };
    if (!allowed[input.type].includes(alert.status)) {
      throw new ApiError(409, "conflict", this.conflictMessage(alert), { current: this.alertDetail(alert) });
    }

    const at = this.nowIso();
    const record: AlertAction = {
      id: this.nextId("ac"),
      alertId,
      type: input.type,
      actorName: user.displayName,
      actorKind: "user",
      outcome: null,
      note: null,
      at,
    };
    if (input.type === "acknowledge") {
      alert.status = "acknowledged";
      alert.assigneeId = user.id;
      alert.assigneeName = user.displayName;
    } else if (input.type === "start") {
      alert.status = "in_progress";
      if (!alert.assigneeId) {
        alert.assigneeId = user.id;
        alert.assigneeName = user.displayName;
      }
    } else {
      alert.status = "resolved";
      alert.reviewOutcome = input.outcome;
      alert.resolutionNote = input.note.trim();
      alert.resolvedAt = at;
      alert.resolvedByName = user.displayName;
      record.outcome = input.outcome;
      record.note = input.note.trim();
    }
    alert.version += 1;
    this.state.actions.push(record);
    this.emit(recipientId, "alert.updated", alertId);
    return this.alertDetail(alert);
  }

  private conflictMessage(alert: Alert): string {
    const last = this.state.actions.filter((a) => a.alertId === alert.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (last && last.actorKind === "user") {
      return `Cảnh báo đã được cập nhật bởi ${last.actorName} lúc ${formatDateTime(last.at)}. Trang đã tải trạng thái mới nhất.`;
    }
    return "Cảnh báo đã thay đổi trước khi thao tác được lưu. Trang đã tải trạng thái mới nhất.";
  }

  /* ================================================================ devices & patches */

  async listDevices(recipientId: string): Promise<Device[]> {
    await this.delay();
    this.authorize(recipientId);
    return this.recipientDevices(recipientId).map((d) => this.toDevice(d));
  }

  async checkDevice(recipientId: string, deviceId: string): Promise<Device> {
    await this.delay();
    this.authorize(recipientId);
    const device = this.recipientDevices(recipientId).find((d) => d.id === deviceId);
    if (!device) throw new ApiError(404, "not_found", "Thiết bị không thuộc hồ sơ này.");
    return this.toDevice(device);
  }

  async startPairing(recipientId: string, input: { product: Product; serial: string }): Promise<PairingChallenge> {
    await this.delay();
    this.authorize(recipientId, ["devices.manage"], input.product);
    const serial = input.serial.trim().toUpperCase();
    if (serial.length < 6) {
      throw new ApiError(422, "validation", "Thông tin chưa hợp lệ.", { fieldErrors: { serial: "Nhập số serial in trên thiết bị." } });
    }
    const device = this.state.devices.find((d) => d.serial === serial && d.product === input.product);
    const assigned = device ? this.state.assignments.some((a) => a.deviceId === device.id && !a.validTo) : false;
    if (!device || assigned) {
      // Không tiết lộ thiết bị đang thuộc người khác.
      throw new ApiError(404, "not_found", "Không tìm thấy thiết bị sẵn sàng ghép với số serial này.");
    }
    const challenge = {
      id: this.nextId("pc"),
      product: input.product,
      serial: maskSerial(serial),
      status: "awaiting_code" as const,
      expiresAt: iso(this.now() + 10 * MINUTE),
      recipientId,
      deviceId: device.id,
      attempts: 0,
    };
    this.state.pairings.push(challenge);
    return { id: challenge.id, product: challenge.product, serial: challenge.serial, status: challenge.status, expiresAt: challenge.expiresAt };
  }

  async confirmPairing(recipientId: string, challengeId: string, code: string): Promise<Device> {
    await this.delay();
    const challenge = this.state.pairings.find((p) => p.id === challengeId && p.recipientId === recipientId);
    this.authorize(recipientId, ["devices.manage"], challenge?.product);
    if (!challenge) throw new ApiError(404, "not_found", "Phiên ghép thiết bị không tồn tại.");
    if (challenge.status !== "awaiting_code") throw new ApiError(409, "conflict", "Phiên ghép đã kết thúc. Hãy bắt đầu lại.");
    if (new Date(challenge.expiresAt).getTime() < this.now()) {
      challenge.status = "expired";
      throw new ApiError(409, "conflict", "Mã xác minh đã hết hạn. Hãy bắt đầu lại.");
    }
    const device = this.state.devices.find((d) => d.id === challenge.deviceId)!;
    if (code.trim() !== device.activationCode) {
      challenge.attempts += 1;
      if (challenge.attempts >= 3) {
        challenge.status = "failed";
        throw new ApiError(409, "conflict", "Nhập sai mã quá 3 lần. Phiên ghép đã bị hủy.");
      }
      throw new ApiError(422, "validation", "Mã kích hoạt không đúng.", {
        fieldErrors: { code: `Mã kích hoạt không đúng. Còn ${3 - challenge.attempts} lần thử.` },
      });
    }
    challenge.status = "verified";
    const at = this.now();
    this.state.assignments.push({ id: this.nextId("as"), deviceId: device.id, recipientId, validFrom: iso(at), validTo: null });
    device.online = true;
    device.lastSeenStored = at;
    const recipient = this.state.recipients.find((r) => r.id === recipientId)!;
    const enrollment = recipient.enrollments.find((e) => e.product === device.product);
    if (enrollment) enrollment.status = "active";
    if (device.kind === "ecopatch_core") this.state.generatedUntil[device.id] = at;
    this.emit(recipientId, "device.updated", device.id);
    return this.toDevice(device);
  }

  async unassignDevice(recipientId: string, deviceId: string): Promise<void> {
    await this.delay();
    this.authorize(recipientId, ["devices.manage"]);
    const assignment = this.state.assignments.find((a) => a.deviceId === deviceId && a.recipientId === recipientId && !a.validTo);
    if (!assignment) throw new ApiError(404, "not_found", "Thiết bị không thuộc hồ sơ này.");
    const device = this.state.devices.find((d) => d.id === deviceId)!;
    const at = this.now();
    if (device.kind === "ecopatch_core") this.generateMeasurements(device, at);
    assignment.validTo = iso(at);
    device.lastSeenStored = device.online ? at : device.lastSeenStored;
    device.online = false;
    for (const p of this.state.patchSessions) if (p.coreDeviceId === deviceId && !p.endedAt) p.endedAt = iso(at);
    const recipient = this.state.recipients.find((r) => r.id === recipientId)!;
    const enrollment = recipient.enrollments.find((e) => e.product === device.product);
    if (enrollment && !this.recipientDevices(recipientId).some((d) => d.product === device.product)) {
      enrollment.status = "setup_incomplete";
    }
    this.emit(recipientId, "device.updated", deviceId);
  }

  async listPatchSessions(recipientId: string): Promise<PatchSession[]> {
    await this.delay();
    this.authorize(recipientId, ["data.read"], "ecopatch");
    return this.state.patchSessions
      .filter((p) => p.recipientId === recipientId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((p) => ({ ...p }));
  }

  async replacePatch(
    recipientId: string,
    coreDeviceId: string,
    input: { startedAt: string; lotCode: string | null; expectedReplaceAt: string | null; idempotencyKey: string },
  ): Promise<PatchSession> {
    await this.delay();
    const { user } = this.authorize(recipientId, ["patches.replace"], "ecopatch");
    const key = `patch:${user.id}:${input.idempotencyKey}`;
    const previousId = this.state.idempotency.get(key);
    if (previousId) {
      const previous = this.state.patchSessions.find((p) => p.id === previousId);
      if (previous) return { ...previous };
    }
    const core = this.recipientDevices(recipientId).find((d) => d.id === coreDeviceId && d.kind === "ecopatch_core");
    if (!core) throw new ApiError(404, "not_found", "Lõi EcoPatch không thuộc hồ sơ này.");
    const started = new Date(input.startedAt).getTime();
    const fieldErrors: Record<string, string> = {};
    if (Number.isNaN(started)) fieldErrors.startedAt = "Nhập thời điểm bắt đầu hợp lệ.";
    else if (started > this.now() + 5 * MINUTE) fieldErrors.startedAt = "Thời điểm bắt đầu không được ở tương lai.";
    const current = this.state.patchSessions.find((p) => p.coreDeviceId === coreDeviceId && !p.endedAt);
    if (current && started < new Date(current.startedAt).getTime()) {
      fieldErrors.startedAt = "Thời điểm bắt đầu phải sau miếng dán hiện tại.";
    }
    if (input.expectedReplaceAt && new Date(input.expectedReplaceAt).getTime() <= started) {
      fieldErrors.expectedReplaceAt = "Ngày dự kiến thay phải sau thời điểm bắt đầu.";
    }
    if (input.lotCode && input.lotCode.trim().length > 40) fieldErrors.lotCode = "Mã lô tối đa 40 ký tự.";
    if (Object.keys(fieldErrors).length) throw new ApiError(422, "validation", "Thông tin chưa hợp lệ.", { fieldErrors });

    // Kết thúc phiên cũ và mở phiên mới trong cùng một "transaction".
    if (current) current.endedAt = iso(started);
    const session: PatchSession = {
      id: this.nextId("ps"),
      coreDeviceId,
      recipientId,
      lotCode: input.lotCode?.trim() || null,
      startedAt: iso(started),
      endedAt: null,
      expectedReplaceAt: input.expectedReplaceAt,
      createdByName: user.displayName,
      sourceMode: "simulated",
    };
    this.state.patchSessions.push(session);
    this.state.idempotency.set(key, session.id);
    this.emit(recipientId, "patch.updated", session.id);
    return { ...session };
  }

  /* ================================================================ history & notes */

  private historyItems(recipientId: string): HistoryItem[] {
    const recipient = this.state.recipients.find((r) => r.id === recipientId)!;
    const enrolled = new Set(recipient.enrollments.map((e) => e.product));
    const items: HistoryItem[] = [];
    if (enrolled.has("carelens")) {
      for (const e of this.state.events.filter((x) => x.recipientId === recipientId)) {
        items.push({
          id: `h_${e.id}`,
          type: "care_event",
          at: e.observedAt,
          title: e.summary,
          detail: e.careLevel !== null ? `Điểm AI ${e.careLevel}/10 (thử nghiệm)` : null,
          actorName: null,
          product: "carelens",
          origin: "ai",
          link: e.alertId ? { kind: "alert", id: e.alertId } : { kind: "event", id: e.id },
          sourceMode: e.sourceMode,
        });
      }
    }
    const alertIds = new Map(
      this.state.alerts.filter((a) => a.recipientId === recipientId && enrolled.has(a.product)).map((a) => [a.id, a]),
    );
    const actionTitles: Record<AlertAction["type"], string> = {
      acknowledge: "Tiếp nhận kiểm tra cảnh báo",
      start: "Bắt đầu xử lý cảnh báo",
      resolve: "Đóng cảnh báo",
      escalate: "Chuyển thông báo tới người dự phòng",
      reminder: "Nhắc lại cảnh báo chưa tiếp nhận",
    };
    for (const a of this.state.actions) {
      const alert = alertIds.get(a.alertId);
      if (!alert) continue;
      items.push({
        id: `h_${a.id}`,
        type: "alert_action",
        at: a.at,
        title: actionTitles[a.type],
        detail: a.note,
        actorName: a.actorName,
        product: alert.product,
        origin: a.actorKind === "system" ? "system" : "human",
        link: { kind: "alert", id: alert.id },
        sourceMode: "simulated",
      });
    }
    for (const n of this.state.notes.filter((x) => x.recipientId === recipientId)) {
      items.push({
        id: `h_${n.id}`,
        type: "note",
        at: n.createdAt,
        title: "Ghi chú chăm sóc",
        detail: n.body,
        actorName: n.authorName,
        product: null,
        origin: "human",
        link: null,
        sourceMode: "simulated",
      });
    }
    if (enrolled.has("ecopatch")) {
      for (const p of this.state.patchSessions.filter((x) => x.recipientId === recipientId)) {
        items.push({
          id: `h_${p.id}`,
          type: "patch_change",
          at: p.startedAt,
          title: "Bắt đầu miếng dán mới",
          detail: p.lotCode ? `Mã lô ${p.lotCode}` : "Không nhập mã lô",
          actorName: p.createdByName,
          product: "ecopatch",
          origin: "human",
          link: null,
          sourceMode: p.sourceMode,
        });
      }
    }
    for (const a of this.state.assignments.filter((x) => x.recipientId === recipientId)) {
      const device = this.state.devices.find((d) => d.id === a.deviceId);
      if (!device) continue;
      items.push({
        id: `h_${a.id}_from`,
        type: "device_assignment",
        at: a.validFrom,
        title: `Gán thiết bị ${device.label}`,
        detail: maskSerial(device.serial),
        actorName: null,
        product: device.product,
        origin: "system",
        link: null,
        sourceMode: "simulated",
      });
      if (a.validTo) {
        items.push({
          id: `h_${a.id}_to`,
          type: "device_assignment",
          at: a.validTo,
          title: `Gỡ gán thiết bị ${device.label}`,
          detail: maskSerial(device.serial),
          actorName: null,
          product: device.product,
          origin: "system",
          link: null,
          sourceMode: "simulated",
        });
      }
    }
    return items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  }

  async listHistory(recipientId: string, query: HistoryQuery): Promise<Page<HistoryItem>> {
    await this.delay();
    this.authorize(recipientId, ["data.read"]);
    const since = this.since(query.range);
    const items = this.historyItems(recipientId).filter(
      (i) => (query.type === "all" || i.type === query.type) && new Date(i.at).getTime() >= since,
    );
    return this.paginate(items, query.cursor, PAGE_SIZE.history);
  }

  async addNote(recipientId: string, body: string): Promise<CareNote> {
    await this.delay();
    const { user } = this.authorize(recipientId, ["notes.write"]);
    const text = body.trim();
    if (text.length < 2 || text.length > 1000) {
      throw new ApiError(422, "validation", "Thông tin chưa hợp lệ.", {
        fieldErrors: { body: "Ghi chú cần từ 2 đến 1000 ký tự." },
      });
    }
    const note: CareNote = { id: this.nextId("n"), recipientId, authorName: user.displayName, body: text, createdAt: this.nowIso() };
    this.state.notes.push(note);
    this.emit(recipientId, "note.created", note.id);
    return { ...note };
  }

  /* ================================================================ reports & exports */

  private validateRange(from: string, to: string) {
    const a = new Date(from).getTime();
    const b = new Date(to).getTime();
    if (Number.isNaN(a) || Number.isNaN(b) || a >= b) {
      throw new ApiError(422, "validation", "Khoảng thời gian không hợp lệ.", { fieldErrors: { range: "Ngày bắt đầu phải trước ngày kết thúc." } });
    }
    return [a, b] as const;
  }

  async getReport(recipientId: string, input: { from: string; to: string; products: Product[] }): Promise<ReportSummary> {
    await this.delay();
    const { recipient } = this.authorize(recipientId, ["data.read"]);
    const [from, to] = this.validateRange(input.from, input.to);
    if (to - from > MAX_REPORT_RANGE_DAYS * DAY) {
      throw new ApiError(422, "validation", "Khoảng thời gian tối đa là 90 ngày.", {
        fieldErrors: { range: "Khoảng thời gian tối đa là 90 ngày." },
      });
    }
    const enrolled = recipient.enrollments.map((e) => e.product);
    const products = input.products.filter((p) => enrolled.includes(p));
    const within = (value: string | null) => value !== null && new Date(value).getTime() >= from && new Date(value).getTime() <= to;
    const alerts = this.state.alerts.filter((a) => a.recipientId === recipientId && products.includes(a.product));
    const resolved = alerts.filter((a) => within(a.resolvedAt));
    const outcomes = { confirmed: 0, false_alarm: 0, uncertain: 0 };
    for (const a of resolved) if (a.reviewOutcome) outcomes[a.reviewOutcome] += 1;

    let measurements: ReportSummary["measurements"] = null;
    if (products.includes("ecopatch")) {
      const series = this.measurementsFor(recipientId)
        .filter((m) => within(m.observedAt))
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
      const gapThresholdMinutes = MEASUREMENT_INTERVAL_MIN * 3;
      let gapCount = 0;
      for (let i = 1; i < series.length; i++) {
        const diff = new Date(series[i]!.observedAt).getTime() - new Date(series[i - 1]!.observedAt).getTime();
        if (diff > gapThresholdMinutes * MINUTE) gapCount += 1;
      }
      measurements = { count: series.length, gapCount, gapThresholdMinutes };
    }

    return {
      from: iso(from),
      to: iso(to),
      timezone: TIMEZONE_LABEL,
      products,
      alerts: {
        created: alerts.filter((a) => within(a.createdAt)).length,
        resolved: resolved.length,
        stillOpen: alerts.filter((a) => within(a.createdAt) && a.status !== "resolved").length,
        outcomes,
      },
      careEvents: products.includes("carelens")
        ? this.state.events.filter((e) => e.recipientId === recipientId && within(e.observedAt)).length
        : null,
      measurements,
      patchChanges: products.includes("ecopatch")
        ? this.state.patchSessions.filter((p) => p.recipientId === recipientId && within(p.startedAt)).length
        : null,
      sourceMode: "simulated",
    };
  }

  async createExport(
    recipientId: string,
    input: { from: string; to: string; products: Product[]; idempotencyKey: string },
  ): Promise<ExportJob> {
    await this.delay();
    const { user, recipient } = this.authorize(recipientId, ["data.read", "exports.create"]);
    const key = `export:${user.id}:${input.idempotencyKey}`;
    const existingId = this.state.idempotency.get(key);
    if (existingId) {
      const existing = this.state.exports.find((x) => x.id === existingId);
      if (existing) return this.publicExport(existing);
    }
    const [from, to] = this.validateRange(input.from, input.to);
    const products = input.products.filter((p) => recipient.enrollments.some((e) => e.product === p));
    if (products.length === 0) {
      throw new ApiError(422, "validation", "Thông tin chưa hợp lệ.", { fieldErrors: { products: "Chọn ít nhất một giải pháp." } });
    }
    const tooLong = to - from > MAX_REPORT_RANGE_DAYS * DAY;
    const stamp = iso(this.now()).slice(0, 10);
    const job = {
      id: this.nextId("ex"),
      recipientId,
      status: tooLong ? ("failed" as const) : ("pending" as const),
      from: iso(from),
      to: iso(to),
      products,
      filename: `du-lieu-mo-phong_${recipientId}_${stamp}.csv`,
      createdAt: this.nowIso(),
      failureReason: tooLong ? "Khoảng thời gian vượt giới hạn 90 ngày cho một bản xuất." : null,
      readyAt: this.now() + 1_500,
      content: null,
      userId: user.id,
    };
    this.state.exports.push(job);
    this.state.idempotency.set(key, job.id);
    return this.publicExport(job);
  }

  private publicExport(job: DemoState["exports"][number]): ExportJob {
    if (job.status === "pending" && this.now() >= job.readyAt) {
      job.content = this.buildCsv(job.recipientId, new Date(job.from).getTime(), new Date(job.to).getTime(), job.products);
      job.status = "ready";
    }
    return {
      id: job.id,
      recipientId: job.recipientId,
      status: job.status,
      from: job.from,
      to: job.to,
      products: [...job.products],
      filename: job.filename,
      createdAt: job.createdAt,
      failureReason: job.failureReason,
    };
  }

  private buildCsv(recipientId: string, from: number, to: number, products: Product[]): string {
    const within = (v: string) => new Date(v).getTime() >= from && new Date(v).getTime() <= to;
    const rows: Array<Array<string | number | null>> = [
      ["# DỮ LIỆU MÔ PHỎNG - không phải dữ liệu đo hoặc chẩn đoán thật"],
      [`# Múi giờ hiển thị: ${DISPLAY_TIMEZONE}`],
      ["record_type", "product", "observed_at_utc", "received_at_utc", "description", "value", "unit", "quality", "severity", "status", "review_outcome", "source_mode"],
    ];
    if (products.includes("carelens")) {
      for (const e of this.state.events.filter((x) => x.recipientId === recipientId && within(x.observedAt))) {
        rows.push(["care_event", "carelens", e.observedAt, e.receivedAt, e.summary, e.careLevel, "ai_score_0_10", null, e.severity, null, null, e.sourceMode]);
      }
    }
    for (const a of this.state.alerts.filter((x) => x.recipientId === recipientId && products.includes(x.product) && within(x.observedAt))) {
      rows.push(["alert", a.product, a.observedAt, a.createdAt, a.summary, null, null, null, a.severity, a.status, a.reviewOutcome, a.sourceMode]);
    }
    if (products.includes("ecopatch")) {
      for (const m of this.measurementsFor(recipientId).filter((x) => within(x.observedAt))) {
        rows.push(["measurement", "ecopatch", m.observedAt, m.receivedAt, m.metric, m.value, m.unit, m.quality, null, null, null, m.sourceMode]);
      }
    }
    return toCsv(rows);
  }

  async getExport(recipientId: string, exportId: string): Promise<ExportJob> {
    await this.delay();
    const { user } = this.authorize(recipientId, ["data.read", "exports.create"]);
    const job = this.state.exports.find((x) => x.id === exportId && x.recipientId === recipientId && x.userId === user.id);
    if (!job) throw new ApiError(404, "not_found", "Không tìm thấy bản xuất.");
    return this.publicExport(job);
  }

  async downloadExport(recipientId: string, exportId: string): Promise<{ filename: string; content: string }> {
    await this.delay();
    // Kiểm tra lại quyền tại thời điểm tải (plan §10).
    const { user } = this.authorize(recipientId, ["data.read", "exports.create"]);
    const job = this.state.exports.find((x) => x.id === exportId && x.recipientId === recipientId && x.userId === user.id);
    if (!job) throw new ApiError(404, "not_found", "Không tìm thấy bản xuất.");
    const current = this.publicExport(job);
    if (current.status !== "ready" || !job.content) throw new ApiError(409, "conflict", "Bản xuất chưa sẵn sàng.");
    return { filename: job.filename, content: job.content };
  }

  /* ================================================================ sharing */

  async getAccess(recipientId: string): Promise<AccessOverview> {
    await this.delay();
    const { recipient } = this.authorize(recipientId, ["sharing.manage"]);
    const now = this.now();
    for (const inv of this.state.invitations) {
      if (inv.status === "pending" && new Date(inv.expiresAt).getTime() <= now) inv.status = "expired";
    }
    const grants = this.state.grants.filter((g) => g.recipientId === recipientId).map((g) => ({ ...g, permissions: [...g.permissions] }));
    const members = this.state.memberships
      .filter((m) => m.householdId === recipient.householdId)
      .map((m) => ({
        userId: m.userId,
        displayName: this.user(m.userId).displayName,
        role: m.role,
        hasRecipientAccess: Boolean(this.activeGrant(m.userId, recipientId)),
      }));
    return {
      grants,
      invitations: this.state.invitations.filter((i) => i.recipientId === recipientId).map((i) => ({ ...i })),
      householdMembers: members,
      householdName: this.state.households.find((h) => h.id === recipient.householdId)?.name ?? "",
    };
  }

  async createInvitation(recipientId: string, input: { email: string; role: "caregiver" | "viewer" }): Promise<Invitation> {
    await this.delay();
    const { user, recipient } = this.authorize(recipientId, ["sharing.manage"]);
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(422, "validation", "Thông tin chưa hợp lệ.", { fieldErrors: { email: "Nhập địa chỉ email hợp lệ." } });
    }
    if (!["caregiver", "viewer"].includes(input.role)) {
      throw new ApiError(422, "validation", "Thông tin chưa hợp lệ.", { fieldErrors: { role: "Chọn vai trò." } });
    }
    const hasGrant = this.state.grants.some((g) => g.recipientId === recipientId && !g.revokedAt && g.userEmail === email);
    const pending = this.state.invitations.some((i) => i.recipientId === recipientId && i.status === "pending" && i.email === email);
    if (hasGrant || pending) {
      throw new ApiError(409, "conflict", "Email này đã có quyền hoặc đang có lời mời chờ chấp nhận.");
    }
    const invitation: Invitation = {
      id: this.nextId("inv"),
      recipientId,
      email,
      role: input.role,
      status: "pending",
      createdAt: this.nowIso(),
      expiresAt: iso(this.now() + 7 * DAY),
      invitedByName: user.displayName,
    };
    this.state.invitations.push(invitation);
    this.state.sink.unshift({
      id: this.nextId("nd"),
      ownerId: user.id,
      recipientUserName: email,
      channel: "local_sink",
      status: "queued",
      isTest: false,
      title: `Lời mời truy cập hồ sơ ${recipient.displayName} (không gửi email trong demo)`,
      createdAt: this.nowIso(),
    });
    return { ...invitation };
  }

  async cancelInvitation(recipientId: string, invitationId: string): Promise<void> {
    await this.delay();
    this.authorize(recipientId, ["sharing.manage"]);
    const invitation = this.state.invitations.find((i) => i.id === invitationId && i.recipientId === recipientId);
    if (!invitation) throw new ApiError(404, "not_found", "Không tìm thấy lời mời.");
    if (invitation.status !== "pending") throw new ApiError(409, "conflict", "Lời mời không còn ở trạng thái chờ.");
    invitation.status = "cancelled";
  }

  async revokeGrant(recipientId: string, grantId: string): Promise<void> {
    await this.delay();
    const { user } = this.authorize(recipientId, ["sharing.manage"]);
    const grant = this.state.grants.find((g) => g.id === grantId && g.recipientId === recipientId);
    if (!grant || grant.revokedAt) throw new ApiError(404, "not_found", "Quyền truy cập không tồn tại hoặc đã bị thu hồi.");
    if (grant.userId === user.id) throw new ApiError(409, "conflict", "Không thể tự thu hồi quyền của chính bạn.");
    grant.revokedAt = this.nowIso();
    // Stream đang mở của người bị thu hồi bị đóng (AC11).
    for (const [id, sub] of this.subscribers) {
      if (sub.userId === grant.userId && sub.recipientId === recipientId) {
        sub.handlers.onClose("revoked");
        this.subscribers.delete(id);
      }
    }
    this.emit(recipientId, "grant.revoked", grant.id);
  }

  /* ================================================================ notifications */

  async getNotificationSettings(): Promise<NotificationSettings> {
    await this.delay();
    const user = this.requireSession();
    const settings = this.state.settings[user.id] ?? { backupUserId: null, reminderMinutes: null };
    return { inPageUpdates: true, webPush: "not_configured", ...settings, backupCandidates: this.backupCandidates(user.id) };
  }

  private backupCandidates(userId: string) {
    const myRecipients = this.state.grants.filter((g) => g.userId === userId && !g.revokedAt).map((g) => g.recipientId);
    const ids = new Set(
      this.state.grants
        .filter((g) => myRecipients.includes(g.recipientId) && !g.revokedAt && g.userId !== userId && g.permissions.includes("alerts.act"))
        .map((g) => g.userId),
    );
    return [...ids].map((id) => ({ userId: id, displayName: this.user(id).displayName }));
  }

  async updateNotificationSettings(input: { backupUserId: string | null; reminderMinutes: number | null }): Promise<NotificationSettings> {
    await this.delay();
    const user = this.requireSession();
    const fieldErrors: Record<string, string> = {};
    if (input.backupUserId && !this.backupCandidates(user.id).some((c) => c.userId === input.backupUserId)) {
      fieldErrors.backupUserId = "Người dự phòng phải là người chăm sóc có quyền xử lý cảnh báo trên cùng hồ sơ.";
    }
    if (input.reminderMinutes !== null && (input.reminderMinutes < 5 || input.reminderMinutes > 120)) {
      fieldErrors.reminderMinutes = "Nhập số phút từ 5 đến 120.";
    }
    if (Object.keys(fieldErrors).length) throw new ApiError(422, "validation", "Thông tin chưa hợp lệ.", { fieldErrors });
    this.state.settings[user.id] = { backupUserId: input.backupUserId, reminderMinutes: input.reminderMinutes };
    return this.getNotificationSettings();
  }

  async sendTestNotification(): Promise<NotificationDelivery> {
    await this.delay();
    const user = this.requireSession();
    const delivery: NotificationDelivery & { ownerId: string } = {
      id: this.nextId("nd"),
      ownerId: user.id,
      recipientUserName: user.displayName,
      channel: "local_sink",
      status: "queued",
      isTest: true,
      title: "Thông báo thử · không chứa dữ liệu sức khỏe",
      createdAt: this.nowIso(),
    };
    this.state.sink.unshift(delivery);
    const { ownerId: _owner, ...publicDelivery } = delivery;
    void _owner;
    return publicDelivery;
  }

  async listNotificationSink(): Promise<NotificationDelivery[]> {
    await this.delay();
    const user = this.requireSession();
    const now = this.now();
    for (const d of this.state.sink) {
      if (d.status === "queued" && now - new Date(d.createdAt).getTime() > 1_000) d.status = "provider_accepted";
    }
    return this.state.sink
      .filter((d) => d.ownerId === user.id)
      .slice(0, 20)
      .map(({ ownerId: _owner, ...d }) => {
        void _owner;
        return d;
      });
  }

  /* ================================================================ operations */

  async getDiagnostics(): Promise<ServiceDiagnostics> {
    await this.delay();
    const user = this.requireSession();
    if (!user.isPlatformAdmin) throw new ApiError(403, "forbidden", "Chỉ quản trị nền tảng được xem trang vận hành.");
    const counts: Record<ConnectionState, number> = { connected: 0, stale: 0, disconnected: 0, local_unavailable: 0, unknown: 0 };
    for (const d of this.state.devices) {
      if (!this.state.assignments.some((a) => a.deviceId === d.id && !a.validTo)) continue;
      counts[this.connection(d).state] += 1;
    }
    return {
      dataMode: "demo",
      services: [
        { name: "API nghiệp vụ", state: "degraded", detail: "Đang dùng adapter mô phỏng trong trình duyệt. Chưa có máy chủ." },
        { name: "Luồng cập nhật trực tiếp", state: "operational", detail: "Mô phỏng SSE trong trình duyệt." },
        { name: "Nhà cung cấp thông báo", state: "not_configured", detail: "Chưa chọn nhà cung cấp (D09). Thông báo ghi vào hộp nội bộ." },
        { name: "Kết nối hub CareLens thật", state: "not_configured", detail: "Chưa tích hợp (M5, chờ D01–D03)." },
        { name: "Gateway EcoPatch thật", state: "not_configured", detail: "Chưa tích hợp (M5, chờ D04)." },
      ],
      deviceCounts: counts,
      integrationIssues: this.state.quarantine.map((q) => ({ ...q })),
      accounts: this.state.users.map((u) => ({ id: u.id, displayName: u.displayName, email: u.email, status: u.status })),
    };
  }

  /* ================================================================ stream */

    subscribe(recipientId: string, handlers: StreamHandlers, lastSeq?: number): () => void {
    const userId = this.state.sessionUserId;
    if (!userId || this.state.sessionExpired || !this.activeGrant(userId, recipientId)) {
      queueMicrotask(() => handlers.onClose(this.state.sessionExpired ? "session_expired" : "error"));
      return () => undefined;
    }
    const id = ++this.subscriberSeq;
    this.subscribers.set(id, { id, recipientId, userId, handlers });

    // Replay any hints already in the log (from before this subscription was opened).
    if (lastSeq !== undefined) {
      for (const hint of this.state.streamLog) {
        if (hint.seq > lastSeq && hint.recipientId === recipientId) queueMicrotask(() => handlers.onHint(hint));
      }
    }

    // Connect real SSE to the FastAPI backend.
    // The backend SSE polls apps/demo-control/.demo-state/state.json and emits
    // a state_update whenever seq increments (i.e. whenever the bot mutates state).
    // We translate each backend state_update into in-browser hints so React Query
    // invalidates the right queries.
    //
    // Skip SSE in test environments (jsdom does not polyfill EventSource).
    let es: EventSource | null = null;
    let esClosed = false;
    // Track the highest seq seen from the backend so we can send it back as
    // last_seq on every reconnect, allowing the server to skip already-seen state.
    // We use a query parameter because EventSource does not support custom headers.
    let lastBackendSeq = lastSeq ?? -1;

    const connectSSE = () => {
      if (esClosed) return;
      if (typeof EventSource === "undefined") return; // Not available in jsdom test env.
      // SSE always connects when there is an active session and grant for the recipient.
      // The grant check above guarantees that static personas (u_minh, u_lan, u_ha, u_khoa)
      // never reach this point.

      const url = `${this.apiBase}/api/demo/stream${lastBackendSeq >= 0 ? `?last_seq=${lastBackendSeq}` : ""}`;
      es = new EventSource(url);

      es.onmessage = (e: MessageEvent) => {
        if (esClosed) return;
        try {
          const msg = JSON.parse(e.data as string) as { type?: string; state?: DemoStateFromBackend };
          if (msg.type !== "state_update" || !msg.state) return;
          const s = msg.state;

          // ---- Merge backend state into in-memory adapter state ----
          // Telegram command → state → SSE → adapter merge → UI.
          // Track which recipients received backend data so we emit hints accurately.

          // Merge hubs (map hub_id → HubState dict from backend).
          // BPM ISOLATION: when EcoPatch transitions online via SSE, we suppress measurement
          // seeding because the backend is Telegram-driven and BPM data must not be manufactured.
          const affectedRecipients = new Set<string>();
          if (s.hubs) {
            for (const hub of Object.values(s.hubs) as HubStateFromBackend[]) {
              affectedRecipients.add(hub.recipient_id);
            }
            // BPM ISOLATION: suppress measurement seeding — SSE-driven transitions come from
            // Telegram, so BPM data must not be auto-manufactured.
            this.mergeBackendDevices(s.hubs, { seedMeasurements: false });
          }

          // Merge events using the public refactored method.
          if (s.events) {
            for (const ev of s.events as EventFromBackend[]) {
              affectedRecipients.add(ev.recipient_id);
            }
            this.mergeBackendEvents(s.events);
          }

          // Merge alerts using the public refactored method.
          if (s.alerts) {
            for (const al of s.alerts as AlertFromBackend[]) {
              affectedRecipients.add(al.recipient_id);
            }
            this.mergeBackendAlerts(s.alerts);
          }

          // Merge notes from backend (e.g. from /c_water, /c_medicine via Telegram).
          if (s.notes) {
            for (const note of s.notes as NoteFromBackend[]) {
              if (note.recipient_id !== "r_liveshowcase") continue;
              const existing = this.state.notes.find((n) => n.id === note.id);
              if (!existing) {
                this.state.notes.push({
                  id: note.id,
                  recipientId: note.recipient_id,
                  authorName: note.author_name,
                  body: note.body,
                  createdAt: note.created_at,
                });
                this.emit(note.recipient_id, "note.created", note.id);
              }
            }
          }

          // Detect reset signal from backend (/reset command).
          // CRITICAL: only fire __resetLiveshowcase when reset_at is NEWER than the last
          // processed reset time. The backend keeps the timestamp across all subsequent
          // updates, so a naive `if (s.reset_at)` check would wipe state on every SSE
          // message after the first reset.
          // NOTE: use `!= null` (not truthy) so that a backend reset_at=null (Firebase
          // telemetry before any /reset) is correctly distinguished from "no reset sent".
          // Without this, the else branch that processes hub/event/alert merges is skipped
          // on every Firebase push where reset_at is null, silently swallowing all updates.
          if (s.reset_at !== null && s.reset_at !== this.state.lastResetAt) {
            this.state.lastResetAt = s.reset_at;
            this.__resetLiveshowcase();
          }

          // Update seq from backend so React Query sees a newer version.
          // Keep lastBackendSeq separate so reconnect can send Last-Event-ID correctly.
          if (s.seq !== undefined && s.seq > lastBackendSeq) {
            lastBackendSeq = s.seq;
          }
          if (s.updated_at) {
            this.state.backendUpdatedAt = s.updated_at;
          }

          // ---- Emit hints to React Query (existing logic, preserved) ----
          // mergeBackendDevices now emits device.updated internally; events and
          // alerts still emit here.
          for (const ev of s.events ?? []) {
            this.emit(ev.recipient_id, "event.created", ev.id);
          }
          for (const al of s.alerts ?? []) {
            const existing = this.state.alerts.find((a) => a.id === al.id);
            if (!existing) {
              this.emit(al.recipient_id, "alert.created", al.id);
            } else {
              this.emit(al.recipient_id, "alert.updated", al.id);
            }
          }
        } catch {
          // Malformed SSE message — ignore.
        }
      };

      es.onerror = () => {
        if (esClosed) return;
        es?.close();
        es = null;
        // Reconnect after 5 seconds, mimicking the SSE stream.ts retry behaviour.
        setTimeout(connectSSE, 5_000);
      };
    };

    connectSSE();

    return () => {
      this.subscribers.delete(id);
      esClosed = true;
      es?.close();
    };
  }

  /* ================================================================ demo controls */

  getBackendDevices(recipientId: string): Record<string, BackendDeviceState> {
    // Only return backend devices for the LIVESHOWCASE recipient
    if (recipientId !== "r_liveshowcase") return {};
    return this.state.backendDevices;
  }

  /**
   * Seed a recent measurement window when a device comes online via SSE.
   * Wipes the 24h→+365d gap that normally blocks generation so that
   * the EcoPatch card immediately shows a "Dữ liệu gần nhất" timestamp.
   * Only runs for EcoPatch cores; CareLens has no measurements to seed.
   */
  private seedInitialMeasurements(device: DemoDevice, now: number): void {
    if (device.kind !== "ecopatch_core") return;
    // Remove the fixture gap that spans from 24h-ago to +1year so generation can produce recent points.
    device.gaps = [];
    // Generate the last 6 hours of measurements at MEASUREMENT_INTERVAL_MIN cadence.
    const step = MEASUREMENT_INTERVAL_MIN * MINUTE;
    const start = Math.floor((now - 6 * HOUR) / step) * step;
    this.state.generatedUntil[device.id] = start;
    let cursor = start + step;
    const limit = now;
    while (cursor <= limit) {
      const recipientId = this.deviceRecipient(device.id, cursor);
      if (recipientId) {
        const { value: hrValue, quality: hrQuality } = syntheticHeartRate(device.id, cursor);
        this.state.measurements.push({
          id: `m_${device.id}_${cursor}`,
          sourceRecordId: `sse-seed-${device.id}-${cursor}`,
          deviceId: device.id,
          metric: "heart_rate",
          value: hrValue,
          unit: "bpm",
          quality: hrQuality,
          observedAt: iso(cursor),
          receivedAt: iso(cursor + 2_000),
          sourceMode: "simulated",
        });
        const { value: spo2Value, quality: spo2Quality } = syntheticSpo2(device.id, cursor);
        this.state.measurements.push({
          id: `s_${device.id}_${cursor}`,
          sourceRecordId: `sse-seed-spo2-${device.id}-${cursor}`,
          deviceId: device.id,
          metric: "spo2",
          value: spo2Value,
          unit: "%",
          quality: spo2Quality,
          observedAt: iso(cursor),
          receivedAt: iso(cursor + 2_000),
          sourceMode: "simulated",
        });
      }
      this.state.generatedUntil[device.id] = cursor;
      cursor += step;
    }
  }

  /**
   * Merge backend device states received via SSE.
   * Exposed for testing; also called internally by subscribe().
   * @param hubs - device state dict from backend
   * @param opts.seedMeasurements - if false, suppresses the EcoPatch measurement seeding
   *   that normally runs on offline→online transitions.  Pass false when the online
   *   transition was driven by Telegram (/ec_on) so that BPM data is not manufactured.
   */
  mergeBackendDevices(hubs: Record<string, HubStateFromBackend>, opts?: { seedMeasurements?: boolean }): void {
    // Persona isolation: only mutate state for r_liveshowcase. Other personas
    // (u_minh, u_lan, u_ha, u_khoa) are static fixtures and MUST NOT receive
    // backend state. The inner recipient_id check is the source of truth — it
    // correctly skips non-liveshowcase data regardless of the current mode flag.
    const seed = opts?.seedMeasurements !== false; // default true
    for (const [hubId, hub] of Object.entries(hubs) as [string, HubStateFromBackend][]) {
      if (hub.recipient_id !== "r_liveshowcase") continue;
      this.state.backendDevices[hubId] = {
        id: hub.id,
        recipient_id: hub.recipient_id,
        online: hub.online,
        last_seen_at: hub.last_seen_at ?? null,
        signal: hub.signal ?? (hub.online ? "connected" : "offline"),
        latest_data: hub.latest_data ?? null,
      };
      const existingDevice = this.state.devices.find((d) => d.id === hubId);
      if (existingDevice) {
        const wasOffline = !existingDevice.online;
        existingDevice.online = hub.online;
        existingDevice.lastSeenStored = hub.last_seen_ms ? Math.floor(hub.last_seen_ms / 1000) * 1000 : null;
        // When EcoPatch transitions from offline to online, seed recent measurements so the
        // Overview card immediately shows a "Dữ liệu gần nhất" timestamp.
        // Skip seeding when the transition was Telegram-driven (/ec_on) — BPM isolation.
        if (wasOffline && hub.online && existingDevice.kind === "ecopatch_core" && seed) {
          this.seedInitialMeasurements(existingDevice, this.now());
        }
      }
      // Emit the device.updated hint so React Query invalidates qk.backendDevices(recipientId)
      // (handled by useRecipientStream) and any in-page hooks like useBackendDeviceHistory
      // re-run their accumulation effect. Centralising the emit here means every call to
      // mergeBackendDevices — whether from SSE, from test helpers, or from a future code path —
      // produces the same downstream reaction.
      this.emit(hub.recipient_id, "device.updated", hubId);
    }
  }

  /**
   * Test-only: simulate a backend device update without going through SSE.
   * Seeds EcoPatch measurements on offline→online transitions and updates
   * lastSeenStored / online in both backendDevices and the device record.
   */
  __simulateBackendDeviceUpdate(deviceId: string, online: boolean): void {
    const device = this.state.devices.find((d) => d.id === deviceId);
    if (!device) return;
    if (!device.online && online && device.kind === "ecopatch_core") {
      this.seedInitialMeasurements(device, this.now());
    }
    device.online = online;
    device.lastSeenStored = online ? this.now() : this.now() - 20 * MINUTE;
    const assignment = this.state.assignments.find((a) => a.deviceId === deviceId && !a.validTo);
    const recipientId = assignment?.recipientId ?? "";
    if (this.state.backendDevices[deviceId]) {
      this.state.backendDevices[deviceId].online = online;
      this.state.backendDevices[deviceId].last_seen_at = device.lastSeenStored ? iso(device.lastSeenStored) : null;
      this.state.backendDevices[deviceId].signal = online ? "connected" : "offline";
    }
    if (recipientId) this.emit(recipientId, "device.updated", deviceId);
  }

  /**
   * Add a care note received from the backend (e.g. from Telegram /c_water, /c_medicine).
   * Only accepts notes for r_liveshowcase.  Exposed for testing.
   * Persona isolation: only r_liveshowcase receives backend notes.
   */
  mergeBackendNote(note: NoteFromBackend): void {
    if (!this.isDynamic()) return;
    if (note.recipient_id !== "r_liveshowcase") return;
    if (this.state.notes.some((n) => n.id === note.id)) return;
    this.state.notes.push({
      id: note.id,
      recipientId: note.recipient_id,
      authorName: note.author_name,
      body: note.body,
      createdAt: note.created_at,
    });
  }

  /**
   * Merge care events received from the backend SSE stream.
   * Converts backend event shape to the adapter's CareEvent shape and stores it.
   * Emits `event.created` hints for new events.  Exposed for testing.
   * Persona isolation: only r_liveshowcase receives backend events.
   */
  mergeBackendEvents(events: EventFromBackend[]): void {
    if (!this.isDynamic()) return;
    for (const ev of events as EventFromBackend[]) {
      if (ev.recipient_id !== "r_liveshowcase") continue;
      const existing = this.state.events.find((x) => x.id === ev.id);
      if (!existing) {
        const stub: CareEvent = {
          id: ev.id,
          sourceRecordId: ev.source_record_id || `sse-evt-${ev.id}`,
          recipientId: ev.recipient_id,
          deviceId: ev.device_id || "",
          product: (ev.product as CareEvent["product"]) || "carelens",
          eventType: "care_observation",
          category: (ev.category as CareEvent["category"]) || "activity",
          severity: (ev.severity as CareEvent["severity"]) || "info",
          careLevel: ev.care_level ?? null,
          summary: ev.summary || "",
          observedAt: ev.observed_at || "",
          receivedAt: ev.received_at || "",
          modelVersion: ev.schema_version || "simulator-1.0",
          ruleVersion: ev.schema_version || "simulator-1.0",
          alertId: null,
          sourceMode: (ev.source_mode as CareEvent["sourceMode"]) || "simulated",
          // Preserve the backend `type` field if present (e.g. "lying" for posture events)
          type: ev.type ?? (ev.category as CareEvent["category"]),
        };
        this.state.events.push(stub);
        this.emit(ev.recipient_id, "event.created", ev.id);
      }
    }
  }

  /**
   * Merge alerts received from the backend SSE stream.
   * Converts backend alert shape to the adapter's Alert shape and stores it.
   * Emits `alert.created` hints for new alerts.  Exposed for testing.
   * Persona isolation: only r_liveshowcase receives backend alerts.
   */
  mergeBackendAlerts(alerts: AlertFromBackend[]): void {
    if (!this.isDynamic()) return;
    for (const al of alerts as AlertFromBackend[]) {
      if (al.recipient_id !== "r_liveshowcase") continue;
      const existing = this.state.alerts.find((x) => x.id === al.id);
      if (!existing) {
        const stub: Alert = {
          id: al.id,
          recipientId: al.recipient_id,
          product: (al.product as Alert["product"]) || "carelens",
          kind: "care_event",
          sourceEventId: null,
          deviceId: al.device_id || "unknown",
          severity: (al.severity as Alert["severity"]) || "info",
          status: (al.status as Alert["status"]) || "open",
          summary: al.summary || "",
          observedAt: al.triggered_at || new Date(0).toISOString(),
          createdAt: al.triggered_at || new Date(0).toISOString(),
          assigneeId: null,
          assigneeName: al.acknowledged_by || null,
          reviewOutcome: (al.review_outcome as Alert["reviewOutcome"]) || null,
          resolutionNote: al.review_note || null,
          resolvedAt: al.resolved_at || null,
          resolvedByName: al.resolved_by || null,
          ruleVersion: "simulator-1.0",
          version: 1,
          sourceMode: "simulated",
        };
        this.state.alerts.push(stub);
        this.emit(al.recipient_id, "alert.created", al.id);
      }
    }
  }

  /**
   * Reset the liveshowcase session state.
   * Called when the backend sends a reset signal via SSE (backend /reset command).
   * Clears events, alerts, notes for r_liveshowcase AND sets both devices offline.
   * Does NOT touch other personas' state.
   */
  __resetLiveshowcase(): void {
    // Clear session state for r_liveshowcase
    this.state.events = this.state.events.filter((e) => e.recipientId !== "r_liveshowcase");
    this.state.alerts = this.state.alerts.filter((a) => a.recipientId !== "r_liveshowcase");
    this.state.notes = this.state.notes.filter((n) => n.recipientId !== "r_liveshowcase");
    // Reset both device records in state.devices (so connection() returns unknown/disconnected)
    for (const device of this.state.devices) {
      if (device.id === "d_hub_liveshowcase" || device.id === "d_core_liveshowcase") {
        device.online = false;
        device.lastSeenStored = null;
      }
    }
    // Reset backendDevices
    this.state.backendDevices = {
      d_hub_liveshowcase: { id: "d_hub_liveshowcase", recipient_id: "r_liveshowcase", online: false, last_seen_at: null, signal: "offline", latest_data: null },
      d_core_liveshowcase: { id: "d_core_liveshowcase", recipient_id: "r_liveshowcase", online: false, last_seen_at: null, signal: "offline", latest_data: null },
    };
    // Emit hints so React Query re-fetches with clean state.
    // CRITICAL: must invalidate events/alerts/overview/history so the frontend
    // drops the previous session's data. Without these, post-reset Telegram
    // commands may not appear correctly in the UI because the old events/alerts
    // cache from the prior session is still rendered.
    this.emit("r_liveshowcase", "device.updated", "d_hub_liveshowcase");
    this.emit("r_liveshowcase", "device.updated", "d_core_liveshowcase");
    // Synthetic event.created/alert.created with sentinel ids so useRecipientStream
    // invalidates the corresponding queries via the same handler it uses for live updates.
    // The handler keys on hint.type ("event.created"/"alert.created") and uses the
    // recipientId from the hint, so the entityId is irrelevant for invalidation.
    this.emit("r_liveshowcase", "event.created", "__reset__");
    this.emit("r_liveshowcase", "alert.created", "__reset__");
    this.emit("r_liveshowcase", "note.created", "__reset__");
  }

  async emitCareEvent(recipientId: string): Promise<string> {
    const { recipient } = this.authorize(recipientId);
    const hub = this.recipientDevices(recipientId).find((d) => d.kind === "carelens_hub");
    if (!recipient.enrollments.some((e) => e.product === "carelens") || !hub) {
      return "Hồ sơ này chưa có hub CareLens nên không phát được sự kiện.";
    }
    if (this.connection(hub).state !== "connected") {
      return "Hub CareLens đang mất kết nối nên không có sự kiện mới được gửi lên.";
    }
    const n = this.state.counter + 1;
    this.ingestCareEvent({
      deviceId: hub.id,
      sourceRecordId: `sim-event-live-${n}`,
      observedAt: iso(this.now() - 3_000),
      category: "posture",
      severity: "warning",
      careLevel: 7,
      summary: "AI ghi nhận tư thế bất thường.",
    });
    return "Đã phát một sự kiện CareLens mô phỏng. Quy tắc demo tạo cảnh báo mới.";
  }

  async simulateOtherCaregiverClaim(recipientId: string): Promise<string> {
    const { user } = this.authorize(recipientId);
    const alert = this.state.alerts
      .filter((a) => a.recipientId === recipientId && a.status === "open")
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    if (!alert) return "Không có cảnh báo nào ở trạng thái Chưa tiếp nhận.";
    const other = this.state.grants.find(
      (g) => g.recipientId === recipientId && !g.revokedAt && g.userId !== user.id && g.permissions.includes("alerts.act"),
    );
    if (!other) return "Hồ sơ không có người chăm sóc khác để mô phỏng.";
    alert.status = "acknowledged";
    alert.assigneeId = other.userId;
    alert.assigneeName = other.userDisplayName;
    alert.version += 1;
    this.state.actions.push({
      id: this.nextId("ac"),
      alertId: alert.id,
      type: "acknowledge",
      actorName: other.userDisplayName,
      actorKind: "user",
      outcome: null,
      note: null,
      at: this.nowIso(),
    });
    // Cố ý không phát stream hint để mô phỏng trang chưa kịp nhận cập nhật, dùng để thử xung đột 409.
    return `${other.userDisplayName} vừa tiếp nhận cảnh báo “${alert.summary}”. Trang hiện tại chưa nhận cập nhật, hãy thử thao tác để thấy xử lý xung đột.`;
  }

  async toggleHubConnection(recipientId: string): Promise<string> {
    this.authorize(recipientId);
    const hub = this.recipientDevices(recipientId).find((d) => d.kind === "carelens_hub");
    if (!hub) return "Hồ sơ này chưa có hub CareLens.";
    if (hub.online) {
      hub.online = false;
      hub.lastSeenStored = this.now() - 20 * MINUTE;
      this.emit(recipientId, "device.updated", hub.id);
      return "Mô phỏng: hub CareLens ngừng gửi tín hiệu từ 20 phút trước.";
    }
    hub.online = true;
    hub.lastSeenStored = this.now();
    this.emit(recipientId, "device.updated", hub.id);
    return "Mô phỏng: hub CareLens đã kết nối lại.";
  }

  async sendLateMeasurement(recipientId: string): Promise<string> {
    this.authorize(recipientId);
    const core = this.recipientDevices(recipientId).find((d) => d.kind === "ecopatch_core");
    if (!core) return "Hồ sơ này chưa có lõi EcoPatch.";
    const observed = Math.floor((this.now() - 55 * MINUTE) / MINUTE) * MINUTE + 5 * MINUTE;
    const result = this.ingestMeasurement({
      deviceId: core.id,
      sourceRecordId: `sim-late-${observed}`,
      observedAt: iso(observed),
      value: 71,
      quality: "fair",
    });
    if (result.duplicate) return "Gói đo đến muộn này đã được nhận trước đó; không tạo bản ghi trùng.";
    return `Đã nhận gói đo đến muộn, đo lúc ${formatDateTime(iso(observed))}. Gói được lưu vào lịch sử và không thay giá trị mới nhất.`;
  }
}

/** Shape of the state emitted by the FastAPI SSE endpoint (snake_case from Python).
  *  Must match apps/demo-control/src/demo_control/state.py _save() output. */
interface HubStateFromBackend {
  id: string;
  recipient_id: string;
  online: boolean;
  last_seen_at: string | null;
  last_seen_ms: number | null;
  signal: "connected" | "offline";
  latest_data: BackendLatestData | null;
  battery: number | null;
}

interface EventFromBackend {
  id: string;
  device_id: string;
  recipient_id: string;
  category: string;
  severity: string;
  care_level: number;
  summary: string;
  description: string;
  observed_at: string;
  received_at: string;
  source_mode: string;
  schema_version: string;
  source_record_id: string;
  alert_triggered: boolean;
  product: string;
  /** Free-form sub-type, e.g. "lying" for a posture-category event. */
  type?: string;
}

interface AlertFromBackend {
  id: string;
  device_id: string;
  recipient_id: string;
  severity: string;
  category: string;
  summary: string;
  status: string;
  triggered_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  review_outcome: string | null;
  review_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  product: string;
}

interface DemoStateFromBackend {
  schema_version: string;
  hubs: Record<string, HubStateFromBackend>;
  events: EventFromBackend[];
  alerts: AlertFromBackend[];
  notes: NoteFromBackend[];
  reset_at: string | null;
  alert_actions: Array<{
    id: string;
    alert_id: string;
    action: string;
    actor: string;
    note: string;
    created_at: string;
  }>;
  seq: number;
  updated_at: string;
}

