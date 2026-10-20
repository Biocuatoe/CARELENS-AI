/**
 * View models and defensive parsers for the admin dashboard API. A parser shows what the server reported and nothing it did not:
 * a row without its identifier is dropped, an unknown field is ignored, a missing value stays `null`. Nothing is defaulted into a
 * healthy-looking value. A reply that is not even the right shape throws, so a broken API is an error and never an empty list.
 */
import { AdminApiError } from "./adminError";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bad = (what: string) => new AdminApiError(502, "invalid_response", `Máy chủ trả về dữ liệu ${what} không đúng định dạng.`);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isRecord(v)) for (const [k, n] of Object.entries(v)) if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  return out;
};

/* ------------------------------------------------------------------ capabilities */

export interface AdminCapabilities {
  tts: { available: boolean; note: string | null };
  /** Upload contract. ADR-025: content type audio/mpeg, codec mp3; an older server says audio/wav (then uploads cannot work). */
  audio: { contentType: string | null; codec: string | null; sampleRatesHz: number[]; channels: number[]; maxBytes: number | null; minDurationMs: number | null; maxDurationMs: number | null };
  reminders: { timezone: string | null; schedulerNote: string | null };
  devicePlayback: string | null;
  /** Range the server accepts for the speaker volume (fraction of full scale); null on a server without the setting. */
  speakerVolume: { min: number; max: number; step: number; default: number } | null;
}

export function parseCapabilities(data: unknown): AdminCapabilities {
  if (!isRecord(data) || !isRecord(data.tts) || !isRecord(data.audio)) throw bad("khả năng của máy chủ");
  const rates = Array.isArray(data.audio.sample_rates_hz) ? data.audio.sample_rates_hz.filter((n): n is number => typeof n === "number") : [];
  const reminders = isRecord(data.reminders) ? data.reminders : {};
  return {
    // Anything but an explicit true means "not available": a missing flag never switches a feature on.
    tts: { available: data.tts.available === true, note: str(data.tts.note) },
    audio: {
      contentType: str(data.audio.content_type),
      codec: str(data.audio.codec),
      sampleRatesHz: rates,
      channels: Array.isArray(data.audio.channels) ? data.audio.channels.filter((n): n is number => typeof n === "number") : typeof data.audio.channels === "number" ? [data.audio.channels] : [],
      maxBytes: num(data.audio.max_bytes),
      minDurationMs: num(data.audio.min_duration_ms),
      maxDurationMs: num(data.audio.max_duration_ms),
    },
    reminders: { timezone: str(reminders.timezone), schedulerNote: str(reminders.execution_evidence) },
    devicePlayback: str(data.device_playback),
    speakerVolume: parseVolumeRange(data.speaker_volume),
  };
}

function parseVolumeRange(v: unknown): AdminCapabilities["speakerVolume"] {
  if (!isRecord(v)) return null;
  const min = num(v.min), max = num(v.max), step = num(v.step), def = num(v.default);
  return min !== null && max !== null && step !== null && step > 0 && min <= max ? { min, max, step, default: def ?? min } : null;
}

/* ------------------------------------------------------------------ devices */

export interface AdminDevice {
  deviceId: string;
  recipientId: string;
  label: string;
  status: string;
  firmwareVersion: string | null;
  createdAt: string | null;
  revokedAt: string | null;
  credential: { state: string; version: number | null };
  lastSeenAt: string | null;
  lastContactAgeSeconds: number | null;
  connected: boolean;
  onlineWindowSeconds: number | null;
  /** The firmware's own report; null until a heartbeat has arrived. */
  heartbeat: { at: string; camera: string | null; imu: string | null; speaker: string | null; wifiRssiDbm: number | null; freeHeapBytes: number | null; lastError: string | null } | null;
  lastCapture: { capturedAt: string | null; status: string | null; failureCode: string | null; sourceMode: string | null } | null;
  lastEvent: { observedAt: string | null; eventType: string | null; classification: string | null; verificationStatus: string | null; sourceMode: string | null } | null;
  lastInferenceAt: string | null;
  commands: { active: Record<string, number>; last24h: Record<string, number> };
  hasSimulatedRecords: boolean;
  /** Speaker volume: what an admin set, and what the device itself last reported applying. Null on an older server. */
  speaker: { desiredVolume: number | null; desiredSetAt: string | null; reportedVolume: number | null; reportedAt: string | null } | null;
  /** Codecs the firmware reported in its latest heartbeat (ADR-025). Empty: older firmware or a server that does not ask. */
  audioCodecs: string[];
}

export function parseDevice(d: Record<string, unknown>): AdminDevice | null {
  const deviceId = str(d.device_id);
  if (!deviceId) return null;
  const hb = isRecord(d.heartbeat) ? d.heartbeat : null;
  const hbStatus = hb && isRecord(hb.status) ? hb.status : null;
  const cap = isRecord(d.last_capture) ? d.last_capture : null;
  const evt = isRecord(d.last_event) ? d.last_event : null;
  const cred = isRecord(d.credential) ? d.credential : {};
  const cmds = isRecord(d.commands) ? d.commands : {};
  return {
    deviceId,
    recipientId: str(d.recipient_id) ?? "",
    label: str(d.label) ?? deviceId,
    status: str(d.status) ?? "unknown",
    firmwareVersion: str(d.firmware_version),
    createdAt: str(d.created_at),
    revokedAt: str(d.revoked_at),
    credential: { state: str(cred.state) ?? "unknown", version: num(cred.version) },
    lastSeenAt: str(d.last_seen_at),
    lastContactAgeSeconds: num(d.last_contact_age_seconds),
    connected: d.connected === true,
    onlineWindowSeconds: num(d.online_window_seconds),
    heartbeat: hb && str(hb.at) ? { at: str(hb.at) as string, camera: str(hbStatus?.camera), imu: str(hbStatus?.imu), speaker: str(hbStatus?.speaker), wifiRssiDbm: num(hbStatus?.wifi_rssi_dbm), freeHeapBytes: num(hbStatus?.free_heap_bytes), lastError: str(hbStatus?.last_error) } : null,
    lastCapture: cap ? { capturedAt: str(cap.captured_at), status: str(cap.status), failureCode: str(cap.failure_code), sourceMode: str(cap.source_mode) } : null,
    lastEvent: evt ? { observedAt: str(evt.observed_at), eventType: str(evt.event_type), classification: str(evt.classification), verificationStatus: str(evt.verification_status), sourceMode: str(evt.source_mode) } : null,
    lastInferenceAt: str(d.last_inference_at),
    commands: { active: counts(isRecord(cmds) ? cmds.active : null), last24h: counts(isRecord(cmds) ? cmds.last_24h : null) },
    hasSimulatedRecords: d.has_simulated_records_7d === true,
    speaker: isRecord(d.speaker)
      ? { desiredVolume: num(d.speaker.desired_volume), desiredSetAt: str(d.speaker.desired_set_at), reportedVolume: num(d.speaker.reported_volume), reportedAt: str(d.speaker.reported_at) }
      : null,
    audioCodecs: Array.isArray(d.audio_codecs) ? d.audio_codecs.filter((c): c is string => typeof c === "string") : [],
  };
}

export function parseSpeakerVolumeSet(data: unknown): { desiredVolume: number; desiredSetAt: string | null } {
  const speaker = isRecord(data) && isRecord(data.speaker) ? data.speaker : null;
  const v = speaker ? num(speaker.desired_volume) : null;
  if (!speaker || v === null) throw bad("âm lượng loa");
  return { desiredVolume: v, desiredSetAt: str(speaker.desired_set_at) };
}

export interface DeviceList {
  items: AdminDevice[];
  serverTime: string | null;
  simulatedSources: string | null;
}

export function parseDeviceList(data: unknown): DeviceList {
  if (!isRecord(data) || !Array.isArray(data.items)) throw bad("danh sách thiết bị");
  return { items: list(data.items).flatMap((d) => parseDevice(d) ?? []), serverTime: str(data.server_time), simulatedSources: str(data.simulated_sources) };
}

export function parseDeviceDetail(data: unknown): AdminDevice {
  if (!isRecord(data) || !isRecord(data.device)) throw bad("chi tiết thiết bị");
  const device = parseDevice(data.device);
  if (!device) throw bad("chi tiết thiết bị");
  return device;
}

/* ------------------------------------------------------------------ daily activity report */

export interface ActivityEntry {
  at: string;
  source: string;
  kind: string;
  refId: string | null;
  sourceMode: string | null;
  status: string | null;
  detail: Record<string, unknown>;
}

export interface ActivitySource {
  status: string;
  count: number;
  note: string | null;
}

export interface ActivityReport {
  deviceId: string;
  label: string;
  date: string;
  timezone: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string | null;
  inFuture: boolean;
  sources: Record<string, ActivitySource>;
  entries: ActivityEntry[];
}

export function parseActivity(data: unknown): ActivityReport {
  if (!isRecord(data) || !isRecord(data.device) || !isRecord(data.period) || !isRecord(data.sources) || !Array.isArray(data.entries)) throw bad("báo cáo hoạt động");
  const deviceId = str(data.device.device_id);
  const date = str(data.date);
  const timezone = str(data.timezone);
  const periodStart = str(data.period.start);
  const periodEnd = str(data.period.end);
  if (!deviceId || !date || !timezone || !periodStart || !periodEnd) throw bad("báo cáo hoạt động");
  const sources: Record<string, ActivitySource> = {};
  for (const [name, v] of Object.entries(data.sources)) if (isRecord(v)) sources[name] = { status: str(v.status) ?? "unknown", count: num(v.count) ?? 0, note: str(v.note) };
  const entries = list(data.entries).flatMap((e): ActivityEntry[] => {
    const at = str(e.at);
    const source = str(e.source);
    const kind = str(e.kind);
    if (!at || !source || !kind) return [];
    return [{ at, source, kind, refId: str(e.ref_id), sourceMode: str(e.source_mode), status: str(e.status), detail: isRecord(e.detail) ? e.detail : {} }];
  });
  return { deviceId, label: str(data.device.label) ?? deviceId, date, timezone, periodStart, periodEnd, generatedAt: str(data.generated_at), inFuture: data.in_future === true, sources, entries };
}

/* ------------------------------------------------------------------ voice recordings and commands */

export interface VoiceMessage {
  voiceMessageId: string;
  title: string;
  /** audio/mpeg (ADR-025) or audio/wav for a recording stored before it. */
  contentType: string | null;
  durationMs: number | null;
  sampleRateHz: number | null;
  channels: number | null;
  byteSize: number | null;
  createdBy: string | null;
  createdAt: string | null;
}

export function parseVoiceMessage(v: Record<string, unknown>): VoiceMessage | null {
  const voiceMessageId = str(v.voice_message_id);
  if (!voiceMessageId) return null;
  const audio = isRecord(v.audio) ? v.audio : {};
  return {
    voiceMessageId,
    title: str(v.title) ?? voiceMessageId,
    contentType: str(audio.content_type),
    durationMs: num(audio.duration_ms),
    sampleRateHz: num(audio.sample_rate_hz),
    channels: num(audio.channels),
    byteSize: num(audio.byte_size),
    createdBy: str(v.created_by),
    createdAt: str(v.created_at),
  };
}

export function parseVoiceList(data: unknown): VoiceMessage[] {
  if (!isRecord(data) || !Array.isArray(data.items)) throw bad("danh sách bản ghi âm");
  return list(data.items).flatMap((v) => parseVoiceMessage(v) ?? []);
}

export function parseVoiceUpload(data: unknown): VoiceMessage {
  const v = isRecord(data) && isRecord(data.voice_message) ? parseVoiceMessage(data.voice_message) : null;
  if (!v) throw bad("bản ghi âm");
  return v;
}

/** Every state the device protocol can put a command in. Anything else is shown as unknown, never as success. */
export const COMMAND_STATUSES = ["queued", "delivered", "accepted", "started", "completed", "failed", "rejected", "cancelled", "expired", "superseded"] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number] | "unknown";
export const TERMINAL_COMMAND_STATUSES: readonly string[] = ["completed", "failed", "rejected", "cancelled", "expired", "superseded"];

export interface AdminCommand {
  commandId: string;
  deviceId: string;
  commandType: string;
  status: CommandStatus;
  statusReason: string | null;
  /** True only when the server says the DEVICE reported completion. Never derived from queued/delivered. */
  playedConfirmedByDevice: boolean;
  voiceMessageId: string | null;
  notBefore: string | null;
  expiresAt: string | null;
  deliveryAttempts: number | null;
  createdAt: string | null;
  deliveredAt: string | null;
  /** When the device reported `received` (ADR-022): it holds the command, nothing played yet. Null on older servers. */
  receivedAt: string | null;
  /** Until when the device may finish downloading the audio once it reported `received`. */
  downloadDeadlineAt: string | null;
  acceptedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequestedAt: string | null;
  createdBy: string | null;
}

export function parseCommand(c: Record<string, unknown>): AdminCommand | null {
  const commandId = str(c.command_id);
  if (!commandId) return null;
  const status = str(c.status);
  const payload = isRecord(c.payload) ? c.payload : {};
  const voice = isRecord(payload.voice) ? payload.voice : {};
  return {
    commandId,
    deviceId: str(c.device_id) ?? "",
    commandType: str(c.command_type) ?? "unknown",
    status: (COMMAND_STATUSES as readonly string[]).includes(status ?? "") ? (status as CommandStatus) : "unknown",
    statusReason: str(c.status_reason),
    // Trust the flag only together with the matching status, so an inconsistent reply cannot show "played".
    playedConfirmedByDevice: c.played_confirmed_by_device === true && status === "completed",
    voiceMessageId: str(voice.voice_message_id),
    notBefore: str(c.not_before),
    expiresAt: str(c.expires_at),
    deliveryAttempts: num(c.delivery_attempts),
    createdAt: str(c.created_at),
    deliveredAt: str(c.delivered_at),
    receivedAt: str(c.received_at),
    downloadDeadlineAt: str(c.download_deadline_at),
    acceptedAt: str(c.accepted_at),
    startedAt: str(c.started_at),
    finishedAt: str(c.finished_at),
    cancelRequestedAt: str(c.cancel_requested_at),
    createdBy: str(c.created_by),
  };
}

export interface CommandPage {
  items: AdminCommand[];
  nextCursor: string | null;
}

export function parseCommandPage(data: unknown): CommandPage {
  if (!isRecord(data) || !Array.isArray(data.items)) throw bad("danh sách lệnh");
  return { items: list(data.items).flatMap((c) => parseCommand(c) ?? []), nextCursor: str(data.next_cursor) };
}

export function parseCommandCreated(data: unknown): { command: AdminCommand; created: boolean } {
  const command = isRecord(data) && isRecord(data.command) ? parseCommand(data.command) : null;
  if (!isRecord(data) || !command) throw bad("lệnh");
  return { command, created: data.created === true };
}

export interface CommandTimelineEvent {
  seq: number;
  status: string;
  reason: string | null;
  actorType: string | null;
  at: string | null;
}

export function parseCommandTimeline(data: unknown): { command: AdminCommand; timeline: CommandTimelineEvent[] } {
  const command = isRecord(data) && isRecord(data.command) ? parseCommand(data.command) : null;
  if (!isRecord(data) || !command) throw bad("diễn tiến lệnh");
  return { command, timeline: list(data.timeline).map((e) => ({ seq: num(e.seq) ?? 0, status: str(e.status) ?? "unknown", reason: str(e.reason), actorType: str(e.actor_type), at: str(e.at) })) };
}

export function parseCancelResult(data: unknown): { command: AdminCommand; cancelPendingDeviceConfirmation: boolean } {
  const command = isRecord(data) && isRecord(data.command) ? parseCommand(data.command) : null;
  if (!isRecord(data) || !command) throw bad("kết quả hủy lệnh");
  return { command, cancelPendingDeviceConfirmation: data.cancel_pending_device_confirmation === true };
}

/* ------------------------------------------------------------------ reminders */

export type ReminderState = "scheduled" | "paused" | "cancelled" | "finished" | "unknown";

export interface AdminReminder {
  reminderId: string;
  deviceId: string;
  kind: string;
  label: string;
  voiceMessageId: string | null;
  scheduleKind: "once" | "recurring" | "unknown";
  state: ReminderState;
  timesLocal: string[];
  daysOfWeek: number[];
  startDate: string | null;
  endDate: string | null;
  timezone: string | null;
  deadlineMinutes: number | null;
  pausedAt: string | null;
  nextOccurrenceAt: string | null;
  windowOpen: boolean;
  lastDispatch: { commandId: string; occurrenceAt: string | null; status: string; statusReason: string | null; deliveryAttempts: number | null; finishedAt: string | null; playedConfirmedByDevice: boolean } | null;
}

export function parseReminder(r: Record<string, unknown>): AdminReminder | null {
  const reminderId = str(r.reminder_id);
  if (!reminderId) return null;
  const state = str(r.state);
  const kind = str(r.schedule_kind);
  const last = isRecord(r.last_dispatch) ? r.last_dispatch : null;
  const lastStatus = last ? str(last.status) : null;
  return {
    reminderId,
    deviceId: str(r.device_id) ?? "",
    kind: str(r.kind) ?? "unknown",
    label: str(r.label) ?? "",
    voiceMessageId: str(r.voice_message_id),
    scheduleKind: kind === "once" || kind === "recurring" ? kind : "unknown",
    state: state === "scheduled" || state === "paused" || state === "cancelled" || state === "finished" ? state : "unknown",
    timesLocal: Array.isArray(r.times_local) ? r.times_local.filter((t): t is string => typeof t === "string") : [],
    daysOfWeek: Array.isArray(r.days_of_week) ? r.days_of_week.filter((d): d is number => typeof d === "number") : [],
    startDate: str(r.start_date),
    endDate: str(r.end_date),
    timezone: str(r.timezone),
    deadlineMinutes: num(r.deadline_minutes),
    pausedAt: str(r.paused_at),
    nextOccurrenceAt: str(r.next_occurrence_at),
    windowOpen: r.window_open === true,
    lastDispatch:
      last && str(last.command_id) && lastStatus
        ? {
            commandId: str(last.command_id) as string,
            occurrenceAt: str(last.occurrence_at),
            status: lastStatus,
            statusReason: str(last.status_reason),
            deliveryAttempts: num(last.delivery_attempts),
            finishedAt: str(last.finished_at),
            playedConfirmedByDevice: last.played_confirmed_by_device === true && lastStatus === "completed",
          }
        : null,
  };
}

export function parseReminderList(data: unknown): { items: AdminReminder[]; timezone: string | null } {
  if (!isRecord(data) || !Array.isArray(data.items)) throw bad("danh sách nhắc lịch");
  return { items: list(data.items).flatMap((r) => parseReminder(r) ?? []), timezone: str(data.timezone) };
}

export function parseReminderResult(data: unknown): { reminder: AdminReminder; created: boolean; duplicate: boolean } {
  const reminder = isRecord(data) && isRecord(data.reminder) ? parseReminder(data.reminder) : null;
  if (!isRecord(data) || !reminder) throw bad("nhắc lịch");
  return { reminder, created: data.created === true, duplicate: data.duplicate === true };
}

/* ------------------------------------------------------------------ audit */

export interface AuditEntry {
  auditId: string;
  at: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  requestId: string | null;
}

export function parseAuditPage(data: unknown): { items: AuditEntry[]; nextCursor: string | null } {
  if (!isRecord(data) || !Array.isArray(data.items)) throw bad("nhật ký quản trị");
  const items = list(data.items).flatMap((a): AuditEntry[] => {
    const auditId = str(a.audit_id);
    const at = str(a.at);
    const action = str(a.action);
    if (!auditId || !at || !action) return [];
    return [{ auditId, at, actorType: str(a.actor_type) ?? "unknown", actorId: str(a.actor_id), action, targetType: str(a.target_type), targetId: str(a.target_id), outcome: str(a.outcome) ?? "unknown", requestId: str(a.request_id) }];
  });
  return { items, nextCursor: str(data.next_cursor) };
}
