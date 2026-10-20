/**
 * Read-only admin views: the device registry, one device's detail, the per-day activity report and the audit history.
 * Everything is returned exactly as stored; nothing here is derived into a health score or a "safe" verdict, and an empty
 * list never stands in for a failed query (a failure is an HTTP error, never an empty body).
 *
 * Credential material is never selected: `devices.token_sha256` does not appear in any query below, and the credential
 * is reported only as a state (active / revoked) and its version counter.
 */
import { deviceAudioCodecs } from "./commands";
import type { Ctx } from "./context";
import { badRequest, decodeCursor, encodeCursor, invalid, json, limitParam, notFound } from "./http";
import { addSeconds, isValidDate, iso, localDayPeriod } from "./util";

const ACTIVE_COMMAND_STATES = ["queued", "delivered", "accepted", "started"] as const;
const TERMINAL_COMMAND_STATES = ["completed", "failed", "rejected", "expired", "cancelled", "superseded"] as const;
/** Rows read per source for one report day. A source that hits it is reported as truncated, never silently cut. */
export const REPORT_ROWS_PER_SOURCE = 300;

interface DeviceRow {
  device_id: string;
  recipient_id: string;
  kind: string;
  label: string;
  credential_version: number;
  status: "active" | "revoked";
  firmware_version: string | null;
  last_seen_at: string | null;
  last_boot_id: string | null;
  last_heartbeat_at: string | null;
  last_heartbeat_json: string | null;
  created_at: string;
  revoked_at: string | null;
  speaker_volume: number | null;
  speaker_volume_set_at: string | null;
}

const DEVICE_COLUMNS = `device_id, recipient_id, kind, label, credential_version, status, firmware_version, last_seen_at, last_boot_id,
  last_heartbeat_at, last_heartbeat_json, created_at, revoked_at, speaker_volume, speaker_volume_set_at`;

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return "unparseable";
  }
}

function reportedVolume(text: string | null): number | null {
  const status = parseJson(text);
  const v = status && typeof status === "object" ? (status as { speaker_volume?: unknown }).speaker_volume : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function ageSeconds(ctx: Ctx, at: string | null): number | null {
  return at ? Math.round((ctx.clock.now().getTime() - new Date(at).getTime()) / 1000) : null;
}

type Counts = Record<string, number>;
function addCount(map: Map<string, Counts>, deviceId: string, status: string, n: number): void {
  const row = map.get(deviceId) ?? {};
  row[status] = n;
  map.set(deviceId, row);
}

/** Registry rows with the live facts the backend really holds. `deviceId` null = every device. */
async function deviceViews(ctx: Ctx, deviceId: string | null): Promise<Array<Record<string, unknown>>> {
  const db = ctx.env.DB;
  const now = ctx.clock.now();
  const dayAgo = iso(addSeconds(now, -86_400));
  const weekAgo = iso(addSeconds(now, -7 * 86_400));
  const scope = "(?1 IS NULL OR device_id = ?1)";
  const [devices, active, recent, capture, event, inference, simulated] = await db.batch([
    db.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE ${scope} ORDER BY created_at, device_id LIMIT 200`).bind(deviceId),
    db
      .prepare(`SELECT device_id, status, COUNT(*) AS n FROM device_commands WHERE ${scope} AND status IN (${ACTIVE_COMMAND_STATES.map((s) => `'${s}'`).join(",")}) GROUP BY device_id, status`)
      .bind(deviceId),
    db
      .prepare(
        `SELECT device_id, status, COUNT(*) AS n FROM device_commands WHERE ${scope} AND created_at >= ?2 AND status IN (${TERMINAL_COMMAND_STATES.map((s) => `'${s}'`).join(",")}) GROUP BY device_id, status`,
      )
      .bind(deviceId, dayAgo),
    db
      .prepare(
        `SELECT device_id, captured_at, status, failure_code, source_mode FROM capture_sessions c
         WHERE ${scope} AND captured_at = (SELECT MAX(captured_at) FROM capture_sessions WHERE device_id = c.device_id) GROUP BY device_id`,
      )
      .bind(deviceId),
    db
      .prepare(
        `SELECT device_id, observed_at, event_type, classification, verification_status, source_mode FROM events e
         WHERE ${scope} AND observed_at = (SELECT MAX(observed_at) FROM events WHERE device_id = e.device_id) GROUP BY device_id`,
      )
      .bind(deviceId),
    db.prepare(`SELECT device_id, MAX(completed_at) AS last_completed_at FROM jobs WHERE kind = 'vision' AND status = 'completed' AND device_id IS NOT NULL AND ${scope} GROUP BY device_id`).bind(deviceId),
    db
      .prepare(
        `SELECT device_id FROM capture_sessions WHERE source_mode = 'simulated' AND captured_at >= ?2 AND ${scope}
         UNION SELECT device_id FROM events WHERE source_mode = 'simulated' AND observed_at >= ?2 AND ${scope}`,
      )
      .bind(deviceId, weekAgo),
  ]);

  const activeBy = new Map<string, Counts>();
  for (const r of (active?.results ?? []) as Array<{ device_id: string; status: string; n: number }>) addCount(activeBy, r.device_id, r.status, r.n);
  const recentBy = new Map<string, Counts>();
  for (const r of (recent?.results ?? []) as Array<{ device_id: string; status: string; n: number }>) addCount(recentBy, r.device_id, r.status, r.n);
  const captureBy = new Map((capture?.results ?? []).map((r) => [(r as { device_id: string }).device_id, r as Record<string, unknown>]));
  const eventBy = new Map((event?.results ?? []).map((r) => [(r as { device_id: string }).device_id, r as Record<string, unknown>]));
  const inferenceBy = new Map((inference?.results ?? []).map((r) => [(r as { device_id: string }).device_id, (r as { last_completed_at: string | null }).last_completed_at]));
  const simulatedIds = new Set((simulated?.results ?? []).map((r) => (r as { device_id: string }).device_id));

  return ((devices?.results ?? []) as unknown as DeviceRow[]).map((d) => {
    const age = ageSeconds(ctx, d.last_seen_at);
    const lastCapture = captureBy.get(d.device_id);
    const lastEvent = eventBy.get(d.device_id);
    return {
      device_id: d.device_id,
      recipient_id: d.recipient_id,
      kind: d.kind,
      label: d.label,
      status: d.status,
      firmware_version: d.firmware_version,
      created_at: d.created_at,
      revoked_at: d.revoked_at,
      // Credential state only. The verifier hash is never selected and the secret is not recoverable.
      credential: { state: d.status === "active" ? "active" : "revoked", version: d.credential_version },
      last_seen_at: d.last_seen_at,
      last_contact_age_seconds: age,
      connected: d.status === "active" && age !== null && age <= ctx.config.deviceOnlineWindowSeconds,
      online_window_seconds: ctx.config.deviceOnlineWindowSeconds,
      last_boot_id: d.last_boot_id,
      // The firmware's own report; the backend does not verify it. Null until the first heartbeat arrives.
      heartbeat: d.last_heartbeat_at ? { at: d.last_heartbeat_at, status: parseJson(d.last_heartbeat_json) } : null,
      // What the admin set (delivered with the next heartbeat) and what the device itself last reported applying.
      speaker: {
        desired_volume: d.speaker_volume,
        desired_set_at: d.speaker_volume_set_at,
        reported_volume: reportedVolume(d.last_heartbeat_json),
        reported_at: reportedVolume(d.last_heartbeat_json) === null ? null : d.last_heartbeat_at,
      },
      // ADR-025: codecs the firmware reported in its latest heartbeat; empty = older firmware (legacy WAV only).
      audio_codecs: deviceAudioCodecs(d.last_heartbeat_json),
      last_capture: lastCapture
        ? { captured_at: lastCapture.captured_at, status: lastCapture.status, failure_code: lastCapture.failure_code, source_mode: lastCapture.source_mode }
        : null,
      last_event: lastEvent
        ? { observed_at: lastEvent.observed_at, event_type: lastEvent.event_type, classification: lastEvent.classification, verification_status: lastEvent.verification_status, source_mode: lastEvent.source_mode }
        : null,
      last_inference_at: inferenceBy.get(d.device_id) ?? null,
      commands: { active: activeBy.get(d.device_id) ?? {}, last_24h: recentBy.get(d.device_id) ?? {} },
      // True when this device sent records labelled source_mode "simulated" in the last 7 days (test harness data).
      has_simulated_records_7d: simulatedIds.has(d.device_id),
    };
  });
}

export async function listDevices(ctx: Ctx): Promise<Response> {
  const items = await deviceViews(ctx, null);
  return json({ items, server_time: iso(ctx.clock.now()), simulated_sources: ctx.config.acceptSimulatedSources ? "accepted" : "rejected" });
}

export async function getDevice(ctx: Ctx, deviceId: string): Promise<Response> {
  const [device] = await deviceViews(ctx, deviceId);
  if (!device) throw notFound("Device not found.");
  const boot = await ctx.env.DB.prepare(
    `SELECT boot_id, first_seen_at, last_seen_at, max_uptime_ms, wall_clock_synced, wall_offset_ms FROM device_boots WHERE device_id = ?1 ORDER BY last_seen_at DESC LIMIT 1`,
  )
    .bind(deviceId)
    .first();
  return json({ device, last_boot: boot ?? null, server_time: iso(ctx.clock.now()) });
}

/* ------------------------------------------------------------------ activity report */

type SourceState = "ok" | "truncated" | "partial" | "retention_expired" | "not_stored";
interface Entry {
  at: string;
  source: string;
  kind: string;
  ref_id: string | null;
  source_mode: string | null;
  status: string | null;
  detail: Record<string, unknown>;
}

/**
 * GET /api/admin/v1/devices/:id/activity?date=YYYY-MM-DD (a calendar date in REPORT_TIMEZONE).
 *
 * The day is the half-open UTC interval [start, end) of that local date, and every source is filtered by its own primary
 * timestamp with the same rule (at >= start AND at < end), so a record belongs to exactly one day. The response says, per
 * source, whether it is complete, truncated, only partly retained, or not stored at all, so "nothing listed" can always be
 * told apart from "nothing recorded" and from "not kept". Frames, media keys, credentials and raw samples are never returned.
 */
export async function deviceActivity(ctx: Ctx, deviceId: string): Promise<Response> {
  const date = ctx.url.searchParams.get("date") ?? "";
  if (!isValidDate(date)) throw badRequest("invalid_date", "date must be a calendar date YYYY-MM-DD.");
  const tz = ctx.config.reportTimezone;
  const { start, end } = localDayPeriod(date, tz);
  if (start.getTime() < Date.UTC(2020, 0, 1)) throw invalid("date_out_of_range", "date is before this system existed.");
  const device = await ctx.env.DB.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE device_id = ?1`).bind(deviceId).first<DeviceRow>();
  if (!device) throw notFound("Device not found.");

  const db = ctx.env.DB;
  const s = iso(start);
  const e = iso(end);
  const earlier = iso(addSeconds(start, -86_400)); // commands may be created the day before their last event
  const cap = REPORT_ROWS_PER_SOURCE + 1;
  const [boots, presence, events, captures, imu, decisions, alerts, commands, commandEvents, jobs, audit] = await db.batch([
    db.prepare(`SELECT boot_id, first_seen_at, wall_clock_synced, max_uptime_ms FROM device_boots WHERE device_id = ?1 AND first_seen_at >= ?2 AND first_seen_at < ?3 ORDER BY first_seen_at LIMIT ${cap}`).bind(deviceId, s, e),
    db.prepare(`SELECT hour_utc, first_seen_at, last_seen_at, request_count FROM device_presence WHERE device_id = ?1 AND first_seen_at >= ?2 AND first_seen_at < ?3 ORDER BY first_seen_at LIMIT ${cap}`).bind(deviceId, s, e),
    db
      .prepare(
        `SELECT event_id, event_type, observed_at, source_mode, source, model_version, model_score, score_kind, label, classification, calibration_status,
           verification_status, processing_status, fusion_status, alert_status, summary_vi
         FROM events WHERE device_id = ?1 AND observed_at >= ?2 AND observed_at < ?3 ORDER BY observed_at, event_id LIMIT ${cap}`,
      )
      .bind(deviceId, s, e),
    db
      .prepare(
        `SELECT capture_id, mode, captured_at, source_mode, status, failure_code, cadence_status, frame_count, media_deleted_at
         FROM capture_sessions WHERE device_id = ?1 AND captured_at >= ?2 AND captured_at < ?3 ORDER BY captured_at, capture_id LIMIT ${cap}`,
      )
      .bind(deviceId, s, e),
    // One row per UTC hour: raw samples are summarised, never listed.
    db
      .prepare(
        `SELECT substr(start_at, 1, 13) AS hour_utc, MIN(start_at) AS first_at, COUNT(*) AS batches, SUM(sample_count) AS samples, SUM(seq_gap_before) AS missing_batches,
           MIN(source_mode) AS source_mode_min, MAX(source_mode) AS source_mode_max
         FROM imu_batches WHERE device_id = ?1 AND start_at >= ?2 AND start_at < ?3 GROUP BY hour_utc ORDER BY hour_utc LIMIT ${cap}`,
      )
      .bind(deviceId, s, e),
    db
      .prepare(
        `SELECT decision_id, observed_at, status, case_code, verification_status, alert_decision, policy_version
         FROM fusion_decisions WHERE device_id = ?1 AND observed_at >= ?2 AND observed_at < ?3 ORDER BY observed_at, decision_id LIMIT ${cap}`,
      )
      .bind(deviceId, s, e),
    db
      .prepare(
        `SELECT alert_id, triggered_at, status, severity, review_outcome, policy_version
         FROM alerts WHERE recipient_id = ?4 AND device_id = ?1 AND triggered_at >= ?2 AND triggered_at < ?3 ORDER BY triggered_at, alert_id LIMIT ${cap}`,
      )
      .bind(deviceId, s, e, device.recipient_id),
    db
      .prepare(
        `SELECT command_id, command_type, status, status_reason, source_type, created_by, created_at, expires_at, delivery_attempts
         FROM device_commands WHERE device_id = ?1 AND created_at >= ?2 AND created_at < ?3 ORDER BY created_at, command_id LIMIT ${cap}`,
      )
      .bind(deviceId, s, e),
    db
      .prepare(
        `SELECT e.command_id, e.seq, e.status, e.reason, e.actor_type, e.at FROM device_commands c JOIN device_command_events e ON e.command_id = c.command_id
         WHERE c.device_id = ?1 AND c.created_at >= ?4 AND c.created_at < ?3 AND e.at >= ?2 AND e.at < ?3 ORDER BY e.at, e.command_id, e.seq LIMIT ${cap}`,
      )
      .bind(deviceId, s, e, earlier),
    db
      .prepare(
        `SELECT job_id, kind, status, attempts, last_error_code, created_at FROM jobs
         WHERE device_id = ?1 AND created_at >= ?2 AND created_at < ?3 ORDER BY created_at, job_id LIMIT ${cap}`,
      )
      .bind(deviceId, s, e),
    db
      .prepare(
        `SELECT audit_id, at, actor_type, actor_id, action, outcome, request_id, detail_json FROM audit_log
         WHERE at >= ?2 AND at < ?3 AND (target_id = ?1 OR json_extract(detail_json, '$.device_id') = ?1) ORDER BY at, audit_id LIMIT ${cap}`,
      )
      .bind(deviceId, s, e),
  ]);

  const entries: Entry[] = [];
  const sources: Record<string, { status: SourceState; count: number; note?: string }> = {};
  const rows = <T>(r: D1Result | undefined): T[] => ((r?.results ?? []) as unknown as T[]).slice(0, REPORT_ROWS_PER_SOURCE);
  const finish = (name: string, result: D1Result | undefined, extra: { status?: SourceState; note?: string } = {}): void => {
    const total = result?.results?.length ?? 0;
    const truncated = total > REPORT_ROWS_PER_SOURCE;
    sources[name] = { status: extra.status ?? (truncated ? "truncated" : "ok"), count: Math.min(total, REPORT_ROWS_PER_SOURCE), ...(extra.note ? { note: extra.note } : {}) };
    if (truncated && !extra.status) sources[name]!.note = `Chỉ hiển thị ${REPORT_ROWS_PER_SOURCE} bản ghi đầu tiên của nguồn này trong ngày.`;
  };

  for (const r of rows<{ boot_id: string; first_seen_at: string; wall_clock_synced: number; max_uptime_ms: number }>(boots)) {
    entries.push({ at: r.first_seen_at, source: "boots", kind: "boot", ref_id: r.boot_id, source_mode: null, status: null, detail: { boot_id: r.boot_id, wall_clock_synced: r.wall_clock_synced === 1, max_uptime_ms: r.max_uptime_ms } });
  }
  finish("boots", boots);

  for (const r of rows<{ hour_utc: string; first_seen_at: string; last_seen_at: string; request_count: number }>(presence)) {
    entries.push({ at: r.first_seen_at, source: "presence", kind: "presence_hour", ref_id: r.hour_utc, source_mode: null, status: null, detail: { hour_utc: r.hour_utc, last_seen_at: r.last_seen_at, request_count: r.request_count } });
  }
  finish("presence", presence, { note: "Mỗi dòng là một giờ UTC mà thiết bị có gửi yêu cầu đã xác thực. Không có dòng nghĩa là không ghi nhận yêu cầu nào trong giờ đó." });

  // Heartbeat history is not stored: the device row keeps only the latest report.
  const hbAt = device.last_heartbeat_at;
  if (hbAt && hbAt >= s && hbAt < e) {
    entries.push({ at: hbAt, source: "heartbeat", kind: "heartbeat_latest", ref_id: null, source_mode: null, status: null, detail: { status: parseJson(device.last_heartbeat_json), latest_only: true } });
  }
  sources.heartbeat = { status: "partial", count: hbAt && hbAt >= s && hbAt < e ? 1 : 0, note: "Chỉ lưu heartbeat gần nhất của thiết bị, không có lịch sử heartbeat theo ngày." };

  for (const r of rows<Record<string, unknown> & { event_id: string; observed_at: string; source_mode: string; event_type: string }>(events)) {
    const { event_id, observed_at, source_mode, event_type, ...rest } = r;
    entries.push({ at: observed_at, source: "events", kind: event_type, ref_id: event_id, source_mode, status: (rest.classification as string) ?? null, detail: rest });
  }
  finish("events", events);

  for (const r of rows<Record<string, unknown> & { capture_id: string; captured_at: string; source_mode: string; media_deleted_at: string | null }>(captures)) {
    const { capture_id, captured_at, source_mode, media_deleted_at, ...rest } = r;
    entries.push({ at: captured_at, source: "captures", kind: "capture", ref_id: capture_id, source_mode, status: (rest.status as string) ?? null, detail: { ...rest, media_deleted: media_deleted_at !== null } });
  }
  finish("captures", captures, { note: "Chỉ siêu dữ liệu của lần chụp. Khung hình không được lưu quá thời hạn tạm thời và không bao giờ có trong báo cáo." });

  for (const r of rows<{ hour_utc: string; first_at: string; batches: number; samples: number; missing_batches: number; source_mode_min: string; source_mode_max: string }>(imu)) {
    entries.push({
      at: r.first_at,
      source: "imu",
      kind: "imu_hour_summary",
      ref_id: r.hour_utc,
      source_mode: r.source_mode_min === r.source_mode_max ? r.source_mode_min : "mixed",
      status: null,
      detail: { hour_utc: r.hour_utc, batches: r.batches, samples: r.samples, missing_batches: r.missing_batches },
    });
  }
  const retentionStart = addSeconds(ctx.clock.now(), -ctx.config.imuRawRetentionHours * 3600);
  if (end.getTime() <= retentionStart.getTime()) {
    finish("imu", imu, { status: "retention_expired", note: `IMU thô chỉ được giữ ${ctx.config.imuRawRetentionHours} giờ; ngày này đã quá hạn nên không còn dữ liệu để hiển thị.` });
  } else if (start.getTime() < retentionStart.getTime()) {
    finish("imu", imu, { status: "partial", note: `IMU thô chỉ được giữ ${ctx.config.imuRawRetentionHours} giờ; phần đầu của ngày này đã bị xóa.` });
  } else {
    finish("imu", imu, { note: "Mỗi dòng tóm tắt một giờ UTC; mẫu thô không có trong báo cáo." });
  }

  for (const r of rows<Record<string, unknown> & { decision_id: string; observed_at: string }>(decisions)) {
    const { decision_id, observed_at, ...rest } = r;
    entries.push({ at: observed_at, source: "decisions", kind: "fusion_decision", ref_id: decision_id, source_mode: null, status: (rest.status as string) ?? null, detail: rest });
  }
  finish("decisions", decisions);

  for (const r of rows<Record<string, unknown> & { alert_id: string; triggered_at: string }>(alerts)) {
    const { alert_id, triggered_at, ...rest } = r;
    entries.push({ at: triggered_at, source: "alerts", kind: "alert", ref_id: alert_id, source_mode: null, status: (rest.status as string) ?? null, detail: rest });
  }
  finish("alerts", alerts);

  for (const r of rows<Record<string, unknown> & { command_id: string; created_at: string; status: string; created_by: string }>(commands)) {
    const { command_id, created_at, created_by, ...rest } = r;
    entries.push({
      at: created_at,
      source: "commands",
      kind: "command",
      ref_id: command_id,
      source_mode: null,
      status: r.status,
      detail: { ...rest, created_by_kind: created_by === "system" ? "system" : created_by.startsWith("admin:") ? "admin" : "caregiver", played_confirmed_by_device: r.status === "completed" },
    });
  }
  finish("commands", commands);

  for (const r of rows<{ command_id: string; seq: number; status: string; reason: string | null; actor_type: string; at: string }>(commandEvents)) {
    entries.push({ at: r.at, source: "command_events", kind: "command_event", ref_id: `${r.command_id}#${r.seq}`, source_mode: null, status: r.status, detail: { command_id: r.command_id, reason: r.reason, actor_type: r.actor_type } });
  }
  finish("command_events", commandEvents, { note: "Các trạng thái do thiết bị tự báo (accepted, started, completed, failed...) và do hệ thống ghi." });

  for (const r of rows<{ job_id: string; kind: string; status: string; attempts: number; last_error_code: string | null; created_at: string }>(jobs)) {
    entries.push({ at: r.created_at, source: "agent_jobs", kind: `${r.kind}_job`, ref_id: r.job_id, source_mode: null, status: r.status, detail: { attempts: r.attempts, error_code: r.last_error_code } });
  }
  finish("agent_jobs", jobs, { note: "Việc suy luận giao cho Local AI Agent và kết quả của chúng." });

  for (const r of rows<{ audit_id: string; at: string; actor_type: string; actor_id: string | null; action: string; outcome: string; request_id: string | null; detail_json: string | null }>(audit)) {
    entries.push({ at: r.at, source: "admin_actions", kind: r.action, ref_id: r.audit_id, source_mode: null, status: r.outcome, detail: { actor_type: r.actor_type, actor_id: r.actor_id, request_id: r.request_id, ...(r.detail_json ? { detail: parseJson(r.detail_json) } : {}) } });
  }
  finish("admin_actions", audit);

  // Not persisted anywhere: say so instead of letting an empty list suggest "no changes".
  sources.agent_connectivity = { status: "not_stored", count: 0, note: "Chỉ lưu thời điểm agent liên lạc gần nhất, không có lịch sử kết nối hay mất kết nối." };
  sources.device_connectivity_changes = { status: "not_stored", count: 0, note: "Không có nhật ký chuyển trạng thái online/offline; chỉ có các giờ có kết nối (presence)." };

  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : (a.ref_id ?? "") < (b.ref_id ?? "") ? -1 : 1));
  return json({
    device: { device_id: device.device_id, recipient_id: device.recipient_id, label: device.label, status: device.status },
    date,
    timezone: tz,
    period: { start: s, end: e, interval: "[start, end)" },
    generated_at: iso(ctx.clock.now()),
    in_future: start.getTime() > ctx.clock.now().getTime(),
    sources,
    entries,
  });
}

/* ------------------------------------------------------------------ audit history */

/** GET /api/admin/v1/audit?limit&cursor[&action_prefix=command.]. Newest first. The detail column never holds tokens by construction. */
export async function listAudit(ctx: Ctx): Promise<Response> {
  const limit = limitParam(ctx.url, 50, 200);
  const cursor = decodeCursor(ctx.url.searchParams.get("cursor"));
  const prefix = ctx.url.searchParams.get("action_prefix");
  if (prefix !== null && !/^[a-z_.]{1,40}$/.test(prefix)) throw badRequest("invalid_action_prefix", "action_prefix may contain a-z, underscore and dot only.");
  const rows = await ctx.env.DB.prepare(
    `SELECT audit_id, at, actor_type, actor_id, action, target_type, target_id, recipient_id, outcome, request_id, detail_json FROM audit_log
     WHERE (?1 IS NULL OR at < ?1 OR (at = ?1 AND audit_id < ?2)) AND (?3 IS NULL OR substr(action, 1, length(?3)) = ?3)
     ORDER BY at DESC, audit_id DESC LIMIT ?4`,
  )
    .bind(cursor?.[0] ?? null, cursor?.[1] ?? null, prefix, limit + 1)
    .all<{ audit_id: string; at: string; detail_json: string | null } & Record<string, unknown>>();
  const items = rows.results.slice(0, limit);
  const last = items[items.length - 1];
  return json({
    items: items.map(({ detail_json, ...r }) => ({ ...r, detail: parseJson(detail_json) })),
    next_cursor: rows.results.length > limit && last ? encodeCursor(last.at, last.audit_id) : null,
  });
}
