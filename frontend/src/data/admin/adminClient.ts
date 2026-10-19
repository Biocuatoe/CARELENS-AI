/**
 * HTTP client for the admin API of the care-monitoring Worker (ADR-020). Kept apart from the viewer `DataAdapter` on
 * purpose: admin sign-in state, errors and tokens must never pass through the viewer's auth bridge or query cache.
 *
 * Contract (backend/care-monitoring/worker/src/adminAuth.ts, docs/API_CONTRACT.md "Danh tính admin"):
 *   GET  /api/app/v1/auth/google/start?mode=admin   browser navigation → Google → callback → 302 /admin/login#admin_code=cax_… | #error=…
 *   POST /api/admin/v1/session/exchange {code}      201 {token: "clm_…", expires_at, admin:{admin_id, role}} | 401 | 429 | 503
 *   GET  /api/admin/v1/me                           200 {auth_method:"session", admin_id, email, role, session:{expires_at, authenticated_at}}
 *   DELETE /api/admin/v1/session                    204
 *   GET  /api/admin/v1/status                       200 operations status (read-only)
 *   GET  /ready                                     public; capabilities.admin_signin / google_signin tell whether the button can work
 *   Dashboard (docs/API_CONTRACT.md "Bảng điều khiển admin"): /capabilities, /devices, /devices/{id}, /devices/{id}/activity?date=,
 *   /devices/{id}/voice-messages, /voice-messages/{id}/audio, /devices/{id}/voice-commands, /devices/{id}/commands, /commands/{id}[/cancel],
 *   /devices/{id}/reminders, /reminders/{id}/(pause|resume|cancel), /audit.
 *
 * Tokens are passed in, used for one request and never stored, logged or put in a URL here.
 */
import { DEMO_API_BASE } from "../demo/demoAdapter";

import { AdminApiError, isAdminApiError, isAdminAuthFailure, type AdminErrorCode } from "./adminError";
import {
  parseActivity,
  parseAuditPage,
  parseCancelResult,
  parseCapabilities,
  parseCommandCreated,
  parseCommandPage,
  parseCommandTimeline,
  parseDeviceDetail,
  parseDeviceList,
  parseReminderList,
  parseReminderResult,
  parseVoiceList,
  parseVoiceUpload,
} from "./adminModels";
export { AdminApiError, isAdminApiError, isAdminAuthFailure, type AdminErrorCode };
export * from "./adminModels";

export type AdminRole = "owner" | "admin";

export interface AdminProfile {
  adminId: string;
  email: string;
  role: AdminRole;
  expiresAt: string;
  authenticatedAt: string;
}

export interface AdminExchange {
  token: string;
  expiresAt: string;
  adminId: string;
  role: AdminRole;
}

export type SignInAvailability =
  | { state: "available" }
  | { state: "unavailable"; reason: "google_off" | "admin_off" | "misconfigured" | "old_server" };

/* ------------------------------------------------------------------ operations status (read-only) */

export interface OpsDevice {
  deviceId: string;
  recipientId: string;
  status: string;
  firmwareVersion: string | null;
  lastSeenAt: string | null;
  lastContactAgeSeconds: number | null;
  connected: boolean;
  health: { camera: string | null; imu: string | null; speaker: string | null; wifiRssiDbm: number | null; lastError: string | null } | null;
}

export interface OpsAgent {
  agentId: string;
  label: string;
  status: string;
  lastSeenAt: string | null;
  connected: boolean;
  hasReport: boolean;
  /** Primitive fields of the agent's own version report (no nesting, short strings): what it said about itself, unverified. */
  reported: Array<[string, string]>;
}

export interface OpsStatus {
  serverTime: string;
  storage: { d1SizeBytes: number | null; imuIngest: string | null };
  queue: Array<{ kind: string; waiting: number; oldestAgeSeconds: number | null }>;
  failures24h: number;
  lastInference: Array<{ kind: string; completedAt: string | null }>;
  fusion: { policyVersion: string | null; suspectedFallPossible: boolean | null };
  devices: OpsDevice[];
  agents: OpsAgent[];
}

/** Fixed Vietnamese text for the server's machine codes. The server's own wording is never shown. */
const PROBLEM_MESSAGES: Record<string, string> = {
  schedule_in_past: "Thời điểm đã qua hoặc quá gần (cần cách hiện tại ít nhất 30 giây).",
  schedule_too_far: "Thời điểm quá xa (tối đa 1 năm).",
  no_future_occurrence: "Lịch này không còn lần nào trong tương lai. Kiểm tra các ngày trong tuần và ngày kết thúc.",
  invalid_date_range: "Ngày kết thúc trước ngày bắt đầu.",
  invalid_date: "Ngày không hợp lệ.",
  voice_message_not_found: "Bản ghi âm không còn hoặc không thuộc thiết bị này.",
  audio_not_playable: "Bản ghi âm không đúng tốc độ lấy mẫu mà thiết bị phát được. Hãy tải lên lại.",
  invalid_audio: "Tệp âm thanh không đúng định dạng (cần WAV PCM 16-bit mono, đúng tốc độ lấy mẫu, 0,5–60 giây).",
  unsupported_media_type: "Loại tệp không được hỗ trợ.",
  payload_too_large: "Tệp quá lớn.",
  idempotency_key_reused: "Yêu cầu này trùng khóa với một yêu cầu khác nội dung. Mở lại hộp xác nhận rồi gửi lại.",
  schedule_finished: "Lịch này không còn lần nào để chạy.",
  reminder_cancelled: "Nhắc lịch này đã bị hủy nên không thay đổi được.",
  not_cancellable: "Lệnh này không thể hủy ở trạng thái hiện tại.",
  invalid_payload: "Thông tin gửi lên chưa hợp lệ.",
  title_required: "Cần đặt tên cho bản ghi âm.",
  title_too_long: "Tên bản ghi âm quá dài (tối đa 120 ký tự).",
  duplicate_times: "Có giờ bị trùng.",
  duplicate_days: "Có ngày bị trùng.",
};

/* ------------------------------------------------------------------ helpers */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const roleOf = (v: unknown): AdminRole | null => (v === "owner" || v === "admin" ? v : null);
const bad = (what: string) => new AdminApiError(502, "invalid_response", `Máy chủ trả về dữ liệu ${what} không đúng định dạng.`);

export function parseProfile(data: unknown): AdminProfile {
  if (!isRecord(data) || data.auth_method !== "session") throw bad("danh tính quản trị");
  const session = data.session;
  const role = roleOf(data.role);
  const adminId = str(data.admin_id);
  const email = str(data.email);
  if (!isRecord(session) || !role || !adminId || !email) throw bad("danh tính quản trị");
  const expiresAt = str(session.expires_at);
  const authenticatedAt = str(session.authenticated_at);
  if (!expiresAt || !authenticatedAt) throw bad("danh tính quản trị");
  return { adminId, email, role, expiresAt, authenticatedAt };
}

export function parseExchange(data: unknown): AdminExchange {
  if (!isRecord(data) || data.token_type !== "Bearer") throw bad("phiên quản trị");
  const token = str(data.token);
  const expiresAt = str(data.expires_at);
  const admin = data.admin;
  if (!token || !token.startsWith("clm_") || !expiresAt || !isRecord(admin)) throw bad("phiên quản trị");
  const role = roleOf(admin.role);
  const adminId = str(admin.admin_id);
  if (!role || !adminId) throw bad("phiên quản trị");
  return { token, expiresAt, adminId, role };
}

/** Defensive: shows what the server reported and nothing it did not. Unknown or malformed parts are dropped, never invented. */
export function parseOpsStatus(data: unknown): OpsStatus {
  if (!isRecord(data)) throw bad("trạng thái hệ thống");
  const serverTime = str(data.server_time);
  if (!serverTime) throw bad("trạng thái hệ thống");
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);
  const storage = isRecord(data.storage) ? data.storage : {};
  const fusion = isRecord(data.fusion) ? data.fusion : {};
  const devices: OpsDevice[] = list(data.devices).flatMap((d) => {
    const deviceId = str(d.device_id);
    if (!deviceId) return [];
    const hb = isRecord(d.heartbeat_status) ? d.heartbeat_status : null;
    return [
      {
        deviceId,
        recipientId: str(d.recipient_id) ?? "",
        status: str(d.status) ?? "unknown",
        firmwareVersion: str(d.firmware_version),
        lastSeenAt: str(d.last_seen_at),
        lastContactAgeSeconds: num(d.last_contact_age_seconds),
        connected: d.connected === true,
        health: hb ? { camera: str(hb.camera), imu: str(hb.imu), speaker: str(hb.speaker), wifiRssiDbm: num(hb.wifi_rssi_dbm), lastError: str(hb.last_error) } : null,
      },
    ];
  });
  const agents: OpsAgent[] = list(data.agents).flatMap((a) => {
    const agentId = str(a.agent_id);
    if (!agentId) return [];
    const reported = isRecord(a.reported)
      ? Object.entries(a.reported)
          .flatMap(([k, v]): Array<[string, string]> => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? [[k.slice(0, 40), String(v).slice(0, 80)]] : []))
          .slice(0, 12)
      : [];
    return [{ agentId, label: str(a.label) ?? agentId, status: str(a.status) ?? "unknown", lastSeenAt: str(a.last_seen_at), connected: a.connected === true, hasReport: a.reported !== null && a.reported !== undefined, reported }];
  });
  return {
    serverTime,
    storage: { d1SizeBytes: num(storage.d1_size_bytes), imuIngest: str(storage.imu_ingest) },
    queue: list(data.queue).flatMap((q) => (str(q.kind) ? [{ kind: str(q.kind) as string, waiting: num(q.waiting) ?? 0, oldestAgeSeconds: num(q.oldest_age_seconds) }] : [])),
    failures24h: list(data.failures_24h).reduce((sum, f) => sum + (num(f.n) ?? 0), 0),
    lastInference: list(data.last_successful_inference).flatMap((r) => (str(r.kind) ? [{ kind: str(r.kind) as string, completedAt: str(r.last_completed_at) }] : [])),
    fusion: { policyVersion: str(fusion.policy_version), suspectedFallPossible: typeof fusion.suspected_fall_possible === "boolean" ? fusion.suspected_fall_possible : null },
    devices,
    agents,
  };
}

/* ------------------------------------------------------------------ client */

interface Reply {
  status: number;
  data: unknown;
  problemCode: string | null;
  /** Only for binary downloads (the audio preview), and only on success. */
  blob?: Blob;
}

/** Fields of the reminder form, as the API takes them. Times are wall-clock in the server's report time zone (Asia/Ho_Chi_Minh). */
export type ReminderSchedule =
  | { type: "once"; local_date: string; local_time: string }
  | { type: "weekly"; days_of_week: number[]; times_local: string[]; start_date: string; end_date: string | null };

export interface ReminderInput {
  idempotencyKey: string;
  kind: "medication" | "water";
  label: string;
  voiceMessageId: string | null;
  deadlineMinutes: number;
  schedule: ReminderSchedule;
}

const seg = encodeURIComponent;

export class AdminClient {
  constructor(
    private readonly apiBase: string | null = DEMO_API_BASE,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  /** Where the browser is sent to start the admin Google flow (a full-page navigation; never fetched). */
  get startUrl(): string | null {
    return this.apiBase ? `${this.apiBase}/api/app/v1/auth/google/start?mode=admin` : null;
  }

  private async call(method: string, path: string, opts: { token?: string; body?: unknown; raw?: { body: BodyInit; contentType: string }; binary?: boolean } = {}): Promise<Reply> {
    if (!this.apiBase) {
      throw new AdminApiError(503, "no_backend", "Bản web này chưa kết nối máy chủ (thiếu VITE_API_BASE_URL lúc build). Vui lòng liên hệ người vận hành.");
    }
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.raw) headers["content-type"] = opts.raw.contentType;
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}${path}`, {
        method,
        headers,
        body: opts.raw ? opts.raw.body : opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      throw await this.explainNetworkFailure();
    }
    if (opts.binary && res.status === 200) return { status: 200, data: null, problemCode: null, blob: await res.blob() };
    const text = await res.text();
    let data: unknown = null;
    try {
      if (text) data = JSON.parse(text);
    } catch {
      // Not JSON (a proxy page): the status code decides.
    }
    return { status: res.status, data, problemCode: isRecord(data) ? str(data.code) : null };
  }

  /** A rejected fetch is either "nothing answers" or "the server refuses this page's origin"; a no-cors probe tells them apart. */
  private async explainNetworkFailure(): Promise<AdminApiError> {
    let reachable = false;
    try {
      await this.fetchImpl(`${this.apiBase}/health`, { mode: "no-cors", credentials: "omit", cache: "no-store" });
      reachable = true;
    } catch {
      // nothing answered
    }
    if (reachable) {
      return new AdminApiError(503, "origin_blocked", "Máy chủ đang chạy nhưng không chấp nhận địa chỉ trang này. Người vận hành cần thêm địa chỉ này vào ALLOWED_ORIGINS.");
    }
    return new AdminApiError(503, "unavailable", "Không kết nối được máy chủ CareLens. Kiểm tra mạng rồi thử lại.");
  }

  /** Maps a non-success reply to one error. The server body is never shown to the user. */
  private fail(reply: Reply): AdminApiError {
    const { status, problemCode } = reply;
    if (status === 401) return new AdminApiError(401, "unauthenticated", "Phiên quản trị không hợp lệ hoặc đã hết hạn.");
    if (status === 403) return new AdminApiError(403, "forbidden", "Tài khoản này không có quyền quản trị.");
    if (status === 429) return new AdminApiError(429, "rate_limited", "Có quá nhiều lần thử hoặc thao tác trong thời gian ngắn. Vui lòng thử lại sau một phút.");
    if (status === 503 && problemCode === "misconfigured") {
      return new AdminApiError(503, "misconfigured", "Cấu hình đăng nhập quản trị trên máy chủ chưa đúng. Người vận hành cần kiểm tra.");
    }
    if (status === 503 && (problemCode === "admin_signin_not_configured" || problemCode === "admin_not_configured" || problemCode === "google_not_configured")) {
      return new AdminApiError(503, "not_configured", "Đăng nhập quản trị chưa được bật trên máy chủ này.");
    }
    if (status === 404) return new AdminApiError(404, "not_found", "Không tìm thấy mục này, hoặc máy chủ chưa có API này (cần triển khai phiên bản Worker mới).", problemCode);
    if (status === 409) return new AdminApiError(409, "conflict", PROBLEM_MESSAGES[problemCode ?? ""] ?? "Trạng thái đã thay đổi. Tải lại rồi thử lại.", problemCode);
    if (status === 400 || status === 413 || status === 415 || status === 422) {
      return new AdminApiError(status, "bad_request", PROBLEM_MESSAGES[problemCode ?? ""] ?? "Máy chủ không chấp nhận yêu cầu.", problemCode);
    }
    return new AdminApiError(status >= 500 ? 503 : status, "unavailable", `Máy chủ không xử lý được yêu cầu (mã ${status}). Vui lòng thử lại sau.`);
  }

  /** Whether the "sign in" button can work, from the public /ready report. Says nothing about who may sign in. */
  async signInAvailability(): Promise<SignInAvailability> {
    const reply = await this.call("GET", "/ready");
    // /ready answers 503 with the same JSON when a dependency is down, so the body is read whatever the status.
    const caps = isRecord(reply.data) && isRecord(reply.data.capabilities) ? reply.data.capabilities : null;
    if (!caps) throw this.fail(reply);
    if (caps.google_signin !== "configured") return { state: "unavailable", reason: caps.google_signin === "misconfigured" ? "misconfigured" : "google_off" };
    // Servers from before Phase B do not report admin_signin at all.
    if (caps.admin_signin === undefined) return { state: "unavailable", reason: "old_server" };
    if (caps.admin_signin === "configured") return { state: "available" };
    return { state: "unavailable", reason: caps.admin_signin === "misconfigured" ? "misconfigured" : "admin_off" };
  }

  async exchangeCode(code: string): Promise<AdminExchange> {
    const reply = await this.call("POST", "/api/admin/v1/session/exchange", { body: { code } });
    // The code is single-use: a 401 means expired, already used, or never issued. Trying the same code again cannot help.
    if (reply.status === 401) throw new AdminApiError(401, "unauthenticated", "Mã đăng nhập đã hết hạn hoặc đã được dùng. Vui lòng đăng nhập lại bằng Google.");
    if (reply.status !== 201) throw this.fail(reply);
    return parseExchange(reply.data);
  }

  async me(token: string): Promise<AdminProfile> {
    const reply = await this.call("GET", "/api/admin/v1/me", { token });
    if (reply.status !== 200) throw this.fail(reply);
    return parseProfile(reply.data);
  }

  async status(token: string): Promise<OpsStatus> {
    const reply = await this.call("GET", "/api/admin/v1/status", { token });
    if (reply.status !== 200) throw this.fail(reply);
    return parseOpsStatus(reply.data);
  }

  /* ---- dashboard API: every method needs the session token and returns parsed view models (adminModels.ts) ---- */

  private async expect<T>(reply: Reply, statuses: number[], parse: (data: unknown) => T): Promise<T> {
    if (!statuses.includes(reply.status)) throw this.fail(reply);
    return parse(reply.data);
  }

  capabilities(token: string) {
    return this.call("GET", "/api/admin/v1/capabilities", { token }).then((r) => this.expect(r, [200], parseCapabilities));
  }

  devices(token: string) {
    return this.call("GET", "/api/admin/v1/devices", { token }).then((r) => this.expect(r, [200], parseDeviceList));
  }

  device(token: string, deviceId: string) {
    return this.call("GET", `/api/admin/v1/devices/${seg(deviceId)}`, { token }).then((r) => this.expect(r, [200], parseDeviceDetail));
  }

  /** `date` is a calendar date YYYY-MM-DD in Asia/Ho_Chi_Minh; the server turns it into the half-open UTC interval. */
  activity(token: string, deviceId: string, date: string) {
    return this.call("GET", `/api/admin/v1/devices/${seg(deviceId)}/activity?date=${seg(date)}`, { token }).then((r) => this.expect(r, [200], parseActivity));
  }

  voiceMessages(token: string, deviceId: string) {
    return this.call("GET", `/api/admin/v1/devices/${seg(deviceId)}/voice-messages`, { token }).then((r) => this.expect(r, [200], parseVoiceList));
  }

  uploadVoice(token: string, deviceId: string, title: string, wav: Blob) {
    return this.call("POST", `/api/admin/v1/devices/${seg(deviceId)}/voice-messages?title=${seg(title)}`, { token, raw: { body: wav, contentType: "audio/wav" } }).then((r) => this.expect(r, [201], parseVoiceUpload));
  }

  /** The recording as a Blob for the admin's own browser to play. There is no shareable URL for it. */
  async voiceAudio(token: string, voiceMessageId: string): Promise<Blob> {
    const reply = await this.call("GET", `/api/admin/v1/voice-messages/${seg(voiceMessageId)}/audio`, { token, binary: true });
    if (reply.status !== 200 || !reply.blob) throw this.fail(reply);
    return reply.blob;
  }

  /** Always sends `confirm: true`: the server refuses the command without it, so no code path can send one by accident. */
  createVoiceCommand(token: string, deviceId: string, input: { voiceMessageId: string; idempotencyKey: string; expiresInSeconds: number }) {
    const body = { voice_message_id: input.voiceMessageId, idempotency_key: input.idempotencyKey, expires_in_seconds: input.expiresInSeconds, confirm: true };
    return this.call("POST", `/api/admin/v1/devices/${seg(deviceId)}/voice-commands`, { token, body }).then((r) => this.expect(r, [200, 201], parseCommandCreated));
  }

  commands(token: string, deviceId: string, cursor?: string) {
    const query = cursor ? `?limit=20&cursor=${seg(cursor)}` : "?limit=20";
    return this.call("GET", `/api/admin/v1/devices/${seg(deviceId)}/commands${query}`, { token }).then((r) => this.expect(r, [200], parseCommandPage));
  }

  commandTimeline(token: string, commandId: string) {
    return this.call("GET", `/api/admin/v1/commands/${seg(commandId)}`, { token }).then((r) => this.expect(r, [200], parseCommandTimeline));
  }

  cancelCommand(token: string, commandId: string) {
    return this.call("POST", `/api/admin/v1/commands/${seg(commandId)}/cancel`, { token, body: {} }).then((r) => this.expect(r, [200, 202], parseCancelResult));
  }

  reminders(token: string, deviceId: string) {
    return this.call("GET", `/api/admin/v1/devices/${seg(deviceId)}/reminders`, { token }).then((r) => this.expect(r, [200], parseReminderList));
  }

  createReminder(token: string, deviceId: string, input: ReminderInput) {
    const body = {
      idempotency_key: input.idempotencyKey,
      kind: input.kind,
      label: input.label,
      voice_message_id: input.voiceMessageId,
      deadline_minutes: input.deadlineMinutes,
      schedule: input.schedule,
      confirm: true,
    };
    return this.call("POST", `/api/admin/v1/devices/${seg(deviceId)}/reminders`, { token, body }).then((r) => this.expect(r, [200, 201], parseReminderResult));
  }

  changeReminder(token: string, reminderId: string, op: "pause" | "resume" | "cancel") {
    return this.call("POST", `/api/admin/v1/reminders/${seg(reminderId)}/${op}`, { token, body: {} }).then((r) => this.expect(r, [200], parseReminderResult));
  }

  audit(token: string, opts: { cursor?: string; actionPrefix?: string; limit?: number } = {}) {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 30) });
    if (opts.cursor) q.set("cursor", opts.cursor);
    if (opts.actionPrefix) q.set("action_prefix", opts.actionPrefix);
    return this.call("GET", `/api/admin/v1/audit?${q.toString()}`, { token }).then((r) => this.expect(r, [200], parseAuditPage));
  }

  /** Ends this session on the server. Resolves true when the server confirmed (204) or already considers it ended (401). */
  async logout(token: string): Promise<boolean> {
    try {
      const reply = await this.call("DELETE", "/api/admin/v1/session", { token });
      return reply.status === 204 || reply.status === 401;
    } catch {
      return false;
    }
  }
}
