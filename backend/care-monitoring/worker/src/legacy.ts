/**
 * Compatibility adapter for the frontend's /api/demo/* paths.
 *
 * The frontend (frontend/src/data/demo/demoAdapter.ts) opens
 * `new EventSource(`${VITE_API_BASE_URL}/api/demo/stream?ticket=…&last_seq=N`)`, ignores every frame that
 * is not JSON {"type":"state_update","state":DemoStateFromBackend}, and merges records into its
 * "r_liveshowcase" persona and the hub "d_hub_liveshowcase".
 *
 * Access (never public):
 * - ticket=<cls_…>: a single-use, 60-second ticket minted by POST /api/app/v1/stream-tickets for a signed-in
 *   caregiver or viewer with data.read on the recipient (see session.ts). This is the production path.
 * - no ticket: data only when an operator set LEGACY_STREAM_RECIPIENT_ID and the client IP is inside
 *   LEGACY_STREAM_ALLOWED_IPS (local development on 127.0.0.1). Otherwise an empty state.
 *
 * Everything served is a persisted record; nothing is fabricated: hubs come from the device's authenticated
 * last contact, events from fusion decisions, drink observations, device-command lifecycles and one
 * system-status line; alerts from the alerts table. Notes and alert_actions stay empty, reset_at stays null.
 */
import { clientIp, type Ctx } from "./context";
import { ipInCidrs, type Config, type Env } from "./env";
import { HttpError, json } from "./http";
import { sseFrame, sseResponse } from "./realtime";
import { consumeStreamTicket } from "./session";
import { addSeconds, iso, localTimeHHMM } from "./util";

export const LEGACY_RECIPIENT_ID = "r_liveshowcase";
export const LEGACY_HUB_ID = "d_hub_liveshowcase";
export const LEGACY_SCHEMA_VERSION = "care-monitoring-legacy-3";
const WINDOW_DAYS = 7;
const AGENT_STALE_SECONDS = 180;

interface DecisionRow {
  decision_id: string;
  device_id: string;
  status: string;
  case_code: string;
  verification_status: string;
  alert_id: string | null;
  observed_at: string;
  decided_at: string;
  policy_version: string;
  explanation_json: string;
  source_mode: string | null;
}

interface DrinkRow {
  event_id: string;
  device_id: string;
  classification: string;
  observed_at: string;
  received_at: string;
  model_version: string | null;
  source_mode: string;
  source_record_id: string;
  summary_vi: string;
}

interface AlertRow {
  alert_id: string;
  device_id: string;
  status: string;
  summary_vi: string;
  triggered_at: string;
  version: number;
  policy_version: string;
  acknowledged_at: string | null;
  acknowledged_name: string | null;
  review_outcome: string | null;
  review_note: string | null;
  resolved_at: string | null;
  resolved_name: string | null;
  source_mode: string | null;
}

interface CommandRow {
  command_id: string;
  device_id: string;
  command_type: string;
  status: string;
  status_reason: string | null;
  payload_json: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  cancel_requested_at: string | null;
  title: string | null;
}

interface StatusRow {
  agent_seen: string | null;
  waiting: number;
  processing: number;
  last_done: string | null;
  last_failure: string | null;
  last_imu: string | null;
}

export interface LegacySubscription {
  recipientId: string;
  /** Preferred device to show as the frontend hub (operator config); otherwise the first active device. */
  preferredDeviceId: string | null;
}

/** Network-allowlist access for local development (no ticket). */
export function legacyExposure(ctx: Ctx): string | null {
  const recipientId = ctx.config.legacyStreamRecipientId;
  if (!recipientId) return null;
  return ipInCidrs(clientIp(ctx.request), ctx.config.legacyStreamAllowedCidrs) ? recipientId : null;
}

function commandSummary(c: CommandRow, tz: string): { summary: string; severity: string } {
  const payload = JSON.parse(c.payload_json) as { label?: string; kind?: string };
  const what =
    c.command_type === "emergency_buzzer"
      ? "Còi báo nghi ngã"
      : c.command_type === "reminder"
        ? `Lời nhắc ${payload.kind === "water" ? "uống nước" : "uống thuốc"} "${payload.label ?? ""}"`
        : `Lời nhắn thoại "${c.title ?? "đã xóa"}"`;
  const at = (v: string | null) => (v ? localTimeHHMM(new Date(v), tz) : "");
  switch (c.status) {
    case "queued":
      return { summary: `${what}: đang chờ thiết bị nhận lệnh. Chưa phát.`, severity: "info" };
    case "delivered":
      return { summary: `${what}: đã gửi tới thiết bị, thiết bị chưa xác nhận nhận lệnh. Chưa phát.`, severity: "info" };
    case "accepted":
      return { summary: `${what}: thiết bị đã nhận lệnh, chưa báo bắt đầu phát.`, severity: "info" };
    case "started":
      return { summary: `${what}: thiết bị báo đang phát${c.cancel_requested_at ? " (đã yêu cầu dừng, chờ thiết bị xác nhận)" : ""}.`, severity: "info" };
    case "completed":
      return { summary: `${what}: thiết bị xác nhận đã phát xong lúc ${at(c.finished_at)}.`, severity: "info" };
    case "failed":
      return { summary: `${what}: thiết bị không phát được (${c.status_reason ?? "không rõ lý do"}).`, severity: "notice" };
    case "rejected":
      return { summary: `${what}: thiết bị từ chối lệnh (${c.status_reason ?? "không rõ lý do"}). Chưa phát.`, severity: "notice" };
    case "expired":
      return { summary: `${what}: hết hạn lúc ${at(c.finished_at)} khi thiết bị chưa phát. Lệnh sẽ không được phát lại.`, severity: "notice" };
    case "cancelled":
      return { summary: `${what}: đã hủy${c.status_reason === "voice_message_deleted" ? " vì lời nhắn đã bị xóa" : ""}.`, severity: "info" };
    case "superseded":
      return { summary: `${what}: được thay bằng lần nhắc mới hơn, lần này không phát.`, severity: "info" };
    default:
      return { summary: `${what}: trạng thái ${c.status}.`, severity: "info" };
  }
}

export async function buildLegacyState(env: Env, config: Config, sub: LegacySubscription | null, now: Date): Promise<Record<string, unknown>> {
  const base = {
    schema_version: LEGACY_SCHEMA_VERSION,
    hubs: {} as Record<string, unknown>,
    events: [] as unknown[],
    alerts: [] as unknown[],
    notes: [],
    alert_actions: [],
    reset_at: null,
    care_monitoring: { legacy_adapter: true, data_exposed: sub !== null, storage_durable: true, window_days: WINDOW_DAYS },
  };
  if (!sub) return { ...base, seq: 0, updated_at: iso(now) };
  const recipientId = sub.recipientId;
  const db = env.DB;
  const since = iso(addSeconds(now, -WINDOW_DAYS * 86_400));

  const [stream, recipient, devices, decisions, drinks, alerts, commands, status] = await db.batch([
    db.prepare(`SELECT seq, updated_at FROM recipient_streams WHERE recipient_id = ?1`).bind(recipientId),
    db.prepare(`SELECT timezone FROM care_recipients WHERE recipient_id = ?1`).bind(recipientId),
    db.prepare(`SELECT device_id, last_seen_at FROM devices WHERE recipient_id = ?1 AND status = 'active' ORDER BY CASE WHEN device_id = ?2 THEN 0 ELSE 1 END, created_at LIMIT 1`).bind(
      recipientId,
      sub.preferredDeviceId ?? "",
    ),
    db
      .prepare(
        `SELECT d.decision_id, d.device_id, d.status, d.case_code, d.verification_status, d.alert_id, d.observed_at, d.decided_at, d.policy_version,
                d.explanation_json, e.source_mode
         FROM fusion_decisions d LEFT JOIN events e ON e.event_id = COALESCE(d.trigger_event_id, d.vision_event_id)
         WHERE d.recipient_id = ?1 AND d.observed_at >= ?2 ORDER BY d.observed_at DESC LIMIT 100`,
      )
      .bind(recipientId, since),
    db
      .prepare(
        `SELECT event_id, device_id, classification, observed_at, received_at, model_version, source_mode, source_record_id, summary_vi FROM events
         WHERE recipient_id = ?1 AND event_type = 'drink_check' AND classification IN ('drinking_water_observed', 'medicine_observed', 'cross_window_review')
           AND observed_at >= ?2 ORDER BY observed_at DESC LIMIT 100`,
      )
      .bind(recipientId, since),
    db
      .prepare(
        `SELECT a.alert_id, a.device_id, a.status, a.summary_vi, a.triggered_at, a.version, a.policy_version, a.acknowledged_at,
                ca.display_name AS acknowledged_name, a.review_outcome, a.review_note, a.resolved_at, cr.display_name AS resolved_name, e.source_mode
         FROM alerts a LEFT JOIN caregivers ca ON ca.user_id = a.acknowledged_by LEFT JOIN caregivers cr ON cr.user_id = a.resolved_by
           LEFT JOIN fusion_decisions d ON d.decision_id = a.fusion_decision_id LEFT JOIN events e ON e.event_id = COALESCE(d.trigger_event_id, d.vision_event_id)
         WHERE a.recipient_id = ?1 AND (a.triggered_at >= ?2 OR a.status != 'resolved') ORDER BY a.triggered_at DESC LIMIT 100`,
      )
      .bind(recipientId, since),
    db
      .prepare(
        `SELECT c.command_id, c.device_id, c.command_type, c.status, c.status_reason, c.payload_json, c.created_at, c.updated_at, c.finished_at,
                c.cancel_requested_at, a.title
         FROM device_commands c LEFT JOIN audio_assets a ON a.asset_id = json_extract(c.payload_json, '$.voice.voice_message_id')
         WHERE c.recipient_id = ?1 AND c.created_at >= ?2 ORDER BY c.created_at DESC LIMIT 50`,
      )
      .bind(recipientId, since),
    db
      .prepare(
        `SELECT (SELECT MAX(last_seen_at) FROM agents WHERE status = 'active') AS agent_seen,
                (SELECT COUNT(*) FROM jobs WHERE recipient_id = ?1 AND kind = 'vision' AND status IN ('queued', 'retry_pending')) AS waiting,
                (SELECT COUNT(*) FROM jobs WHERE recipient_id = ?1 AND kind = 'vision' AND status = 'processing') AS processing,
                (SELECT MAX(completed_at) FROM jobs WHERE recipient_id = ?1 AND kind = 'vision' AND status = 'completed') AS last_done,
                (SELECT last_error_code FROM jobs WHERE recipient_id = ?1 AND kind = 'vision' AND status IN ('failed', 'expired') AND updated_at >= ?2
                   ORDER BY updated_at DESC LIMIT 1) AS last_failure,
                (SELECT MAX(end_at) FROM imu_batches WHERE recipient_id = ?1) AS last_imu`,
      )
      .bind(recipientId, iso(addSeconds(now, -3600))),
  ]);

  const tz = (recipient?.results?.[0] as { timezone: string } | undefined)?.timezone ?? config.reportTimezone;
  const seqRow = stream?.results?.[0] as { seq: number; updated_at: string } | undefined;
  const dev = devices?.results?.[0] as { device_id: string; last_seen_at: string | null } | undefined;
  const mapDevice = (id: string) => (dev && id === dev.device_id ? LEGACY_HUB_ID : id);
  const hubs: Record<string, unknown> = {};
  if (dev) {
    const lastMs = dev.last_seen_at ? new Date(dev.last_seen_at).getTime() : null;
    const online = lastMs !== null && now.getTime() - lastMs <= config.deviceOnlineWindowSeconds * 1000;
    hubs[LEGACY_HUB_ID] = {
      id: LEGACY_HUB_ID,
      recipient_id: LEGACY_RECIPIENT_ID,
      online,
      last_seen_at: dev.last_seen_at,
      last_seen_ms: lastMs,
      signal: online ? "connected" : "offline",
      latest_data: null,
      battery: null,
    };
  }

  const events: Array<Record<string, unknown>> = [];
  for (const d of (decisions?.results ?? []) as unknown as DecisionRow[]) {
    const explanation = JSON.parse(d.explanation_json) as { summary_vi?: string };
    const reviewed = d.verification_status === "verified" ? " Người chăm sóc đã xác minh." : d.verification_status === "dismissed" ? " Người chăm sóc đã bác bỏ." : "";
    events.push({
      id: d.decision_id,
      device_id: mapDevice(d.device_id),
      recipient_id: LEGACY_RECIPIENT_ID,
      category: "fall_like",
      type: d.verification_status === "unverified" ? d.status : d.verification_status,
      severity: d.status === "suspected_fall" ? "warning" : d.status === "no_fall_detected" ? "info" : "notice",
      care_level: null,
      summary: `${explanation.summary_vi ?? ""}${reviewed}`.trim(),
      description: "",
      observed_at: d.observed_at,
      received_at: d.decided_at,
      source_mode: d.source_mode ?? "device",
      schema_version: d.policy_version,
      source_record_id: d.decision_id,
      alert_triggered: d.alert_id !== null,
      alert_id: d.alert_id,
      product: "carelens",
    });
  }
  for (const e of (drinks?.results ?? []) as unknown as DrinkRow[]) {
    events.push({
      id: e.event_id,
      device_id: mapDevice(e.device_id),
      recipient_id: LEGACY_RECIPIENT_ID,
      category: "care_activity",
      type: e.classification === "medicine_observed" ? "medicine" : e.classification === "drinking_water_observed" ? "water" : "medicine_review",
      severity: e.classification === "cross_window_review" ? "notice" : "info",
      care_level: null,
      summary: e.summary_vi,
      description: "",
      observed_at: e.observed_at,
      received_at: e.received_at,
      source_mode: e.source_mode,
      schema_version: e.model_version ?? "unknown",
      source_record_id: e.source_record_id,
      alert_triggered: false,
      alert_id: null,
      product: "carelens",
    });
  }
  for (const c of (commands?.results ?? []) as unknown as CommandRow[]) {
    const { summary, severity } = commandSummary(c, tz);
    events.push({
      id: c.command_id,
      device_id: mapDevice(c.device_id),
      recipient_id: LEGACY_RECIPIENT_ID,
      category: "care_activity",
      type: `device_command_${c.status}`,
      severity,
      care_level: null,
      summary,
      description: "",
      observed_at: c.created_at,
      received_at: c.updated_at,
      source_mode: "device",
      schema_version: "device-command.v2",
      source_record_id: c.command_id,
      alert_triggered: false,
      alert_id: null,
      product: "carelens",
    });
  }
  const st = status?.results?.[0] as StatusRow | undefined;
  if (st) {
    const policy = config.fusionPolicy;
    const agentAge = st.agent_seen ? (now.getTime() - new Date(st.agent_seen).getTime()) / 1000 : null;
    const agentOk = agentAge !== null && agentAge <= AGENT_STALE_SECONDS;
    const fmt = (v: string | null) => (v ? localTimeHHMM(new Date(v), tz) : "chưa có");
    const rulesReady = policy.vision_candidate_rule !== null && policy.imu_candidate_rule !== null;
    const parts = [
      agentOk ? `AI cục bộ đang kết nối (lần cuối ${fmt(st.agent_seen)})` : `AI cục bộ chưa kết nối${st.agent_seen ? ` từ ${fmt(st.agent_seen)}` : ""}: lần chụp mới sẽ chờ, không được phân tích`,
      `${st.waiting} lần chụp chờ phân tích, ${st.processing} đang phân tích`,
      `lần phân tích hình ảnh gần nhất: ${fmt(st.last_done)}`,
      st.last_failure ? `lỗi xử lý gần nhất: ${st.last_failure}` : null,
      `dữ liệu cảm biến chuyển động thô gần nhất: ${fmt(st.last_imu)}`,
      rulesReady
        ? "phát hiện nghi ngã dùng quy tắc đã duyệt cho hình ảnh và cảm biến; mọi cảnh báo là tạm thời, cần người chăm sóc xác minh"
        : "phát hiện ngã chưa hiệu chỉnh: hệ thống chỉ ghi nhận và đưa ra mục cần xem lại, chưa thể tạo cảnh báo nghi ngã",
    ].filter(Boolean);
    events.push({
      id: `system-status:${recipientId}`,
      device_id: dev ? LEGACY_HUB_ID : "",
      recipient_id: LEGACY_RECIPIENT_ID,
      category: "activity",
      type: "system_status",
      severity: agentOk && !st.last_failure && rulesReady ? "info" : "notice",
      care_level: null,
      summary: `Trạng thái hệ thống lúc ${localTimeHHMM(now, tz)}: ${parts.join("; ")}.`,
      description: "",
      observed_at: iso(now),
      received_at: iso(now),
      source_mode: "system",
      schema_version: config.fusionPolicy.policy_version,
      source_record_id: `system-status:${recipientId}`,
      alert_triggered: false,
      alert_id: null,
      product: "carelens",
    });
  }
  events.sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)));

  const alertList = ((alerts?.results ?? []) as unknown as AlertRow[])
    .map((a) => ({
      id: a.alert_id,
      device_id: mapDevice(a.device_id),
      recipient_id: LEGACY_RECIPIENT_ID,
      severity: "warning",
      category: "fall_like",
      summary: a.summary_vi,
      status: a.status,
      version: a.version,
      policy_version: a.policy_version,
      source_mode: a.source_mode ?? "device",
      triggered_at: a.triggered_at,
      acknowledged_at: a.acknowledged_at,
      acknowledged_by: a.acknowledged_name,
      review_outcome: a.review_outcome,
      review_note: a.review_note,
      resolved_at: a.resolved_at,
      resolved_by: a.resolved_name,
      product: "carelens",
    }))
    .reverse();

  return {
    ...base,
    seq: seqRow?.seq ?? 0,
    updated_at: seqRow?.updated_at ?? iso(now),
    hubs,
    events,
    alerts: alertList,
    care_monitoring: { ...base.care_monitoring, device_status_available: dev !== undefined },
  };
}

export async function legacyStream(ctx: Ctx, cors: Record<string, string>): Promise<Response> {
  const ticket = ctx.url.searchParams.get("ticket");
  let recipientId: string | null;
  let userId: string | null = null;
  if (ticket) {
    const grant = await consumeStreamTicket(ctx, ticket);
    recipientId = grant.recipientId;
    userId = grant.userId;
  } else {
    recipientId = legacyExposure(ctx);
  }
  const sub = recipientId ? { recipientId, preferredDeviceId: ctx.config.legacyStreamDeviceId } : null;
  const state = await buildLegacyState(ctx.env, ctx.config, sub, ctx.clock.now());
  const params: Record<string, string> = recipientId ? { view: "legacy", recipient: recipientId, legacy_device: ctx.config.legacyStreamDeviceId ?? "" } : {};
  if (userId) params.user = userId;
  return sseResponse(ctx.env, {
    channel: recipientId ? `recipient:${recipientId}` : null,
    params,
    initialFrames: [sseFrame(state.seq as number, { type: "state_update", state })],
    lifetimeSeconds: ctx.config.sseMaxLifetimeSeconds,
    headers: cors,
  });
}

export async function legacyState(ctx: Ctx): Promise<Response> {
  const recipientId = legacyExposure(ctx);
  return json(await buildLegacyState(ctx.env, ctx.config, recipientId ? { recipientId, preferredDeviceId: ctx.config.legacyStreamDeviceId } : null, ctx.clock.now()));
}

export function legacyCommand(): never {
  throw new HttpError(
    410,
    "demo_command_removed",
    "Demo commands removed",
    "The demo commands (device on/off, scripted falls, water/medicine notes, reset) generated fabricated data and were removed. Device commands use the authenticated /api/app/v1 API.",
  );
}
