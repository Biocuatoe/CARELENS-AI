/**
 * Device commands: emergency buzzer, reminders and family voice messages.
 *
 * Lifecycle: queued → delivered (handed to the device by GET /commands/next) → accepted (the device
 * stored it and, for audio, downloaded and verified the file) → started (sound began) → completed (played
 * to the end). Terminal alternatives: failed / rejected (device-reported with a reason code), expired
 * (deadline passed before the device accepted, or before it finished), cancelled (before delivery, or after
 * the device confirmed a cancel request), superseded (a newer occurrence of the same reminder replaced it).
 *
 * - Only the device's own status reports move a command to accepted, started, completed, failed or
 *   rejected, so playback is never assumed; "completed" is the only state that means "played".
 * - Delivery is at-least-once: a delivered command the device neither reported `received` nor accepted before
 *   its ack deadline is handed out again with the same command_id (the device must treat a repeated id as the same
 *   command), up to max_delivery_attempts, then failed (no_acknowledgement). The ack deadline is
 *   ACK_TIMEOUT_SECONDS, plus ceil(byte_size / AUDIO_DOWNLOAD_MIN_BYTES_PER_SECOND) for commands with audio (ADR-022).
 * - `received` (ADR-022) is a report, not a status: the command stays `delivered`, received_at is set, it is never
 *   handed out again, and it fails with download_timeout if not accepted within 30 s + the download allowance.
 * - For commands with audio, `started` is accepted only after `accepted` (the device verified the file first).
 * - Reboots: a heartbeat or status report from a different boot than the one that last reported on a command puts
 *   commands that never started back in the queue (nothing was played) and fails started ones with device_rebooted;
 *   they never become completed on their own.
 * - A command is delivered only while no other active command of the device has an equal or higher
 *   priority; an emergency (100) therefore reaches a device that is playing a reminder (50) or a voice
 *   message (40) and tells it to preempt.
 * - Offline policy: every command has an absolute expires_at (emergency EMERGENCY_COMMAND_TTL_SECONDS,
 *   reminders their deadline, voice messages the caregiver's expires_in_seconds). Expired commands are never
 *   delivered or replayed after a device reconnects.
 * - Audio is fetched only through GET /commands/{id}/audio while that command is delivered/accepted/started
 *   and unexpired, so a device can never list or download the recording library.
 */
import { COMMAND_REASON_CODES, CommandCreateV1, CommandStatusV2 } from "./contracts";
import { observeClock } from "./clock";
import { auditStatement, bumpStreamStatement, requireRecipient, type CaregiverPrincipal, type Ctx, type DevicePrincipal } from "./context";
import { HttpError, conflict, encodeCursor, decodeCursor, forbidden, invalid, json, limitParam, notFound, readJson } from "./http";
import { notifyRecipient } from "./realtime";
import { MP3_CONTRACT } from "./media";
import { addSeconds, iso, newId } from "./util";

export const PRIORITY = { emergency_buzzer: 100, reminder: 50, play_voice_message: 40 } as const;
export const ACK_TIMEOUT_SECONDS = 30;
export const PLAYING_TIMEOUT_SECONDS = 600;
const ACTIVE = "('delivered', 'accepted', 'started')";

/** SQL: whole seconds (rounded up) a device is granted to download this command's audio at `rate` bytes/s (0 without audio).
 * The CAST keeps it whole: D1 binds JS numbers as REAL, which would turn the division into a fractional one.
 * Correlated on device_commands.payload_json, so it can be used inside an UPDATE of that table. */
function audioAllowanceSql(rate: string): string {
  return `COALESCE((SELECT CAST((v.byte_size + ${rate} - 1) / ${rate} AS INTEGER) FROM audio_asset_versions v
    WHERE v.asset_id = json_extract(device_commands.payload_json, '$.voice.voice_message_id')
      AND v.version = json_extract(device_commands.payload_json, '$.voice.version')), 0)`;
}

/** SQL: ISO instant `seconds` after the ISO instant `from`, in the same format as iso() ("YYYY-MM-DDTHH:MM:SS.sssZ"). */
function plusSecondsSql(from: string, seconds: string): string {
  return `strftime('%Y-%m-%dT%H:%M:%fZ', ${from}, '+' || (${seconds}) || ' seconds')`;
}

export const BUZZER_PATTERN = { pattern: "repeat_beep", duration_ms: 30_000, beep_on_ms: 500, beep_off_ms: 500 } as const;

export interface CommandRow {
  command_id: string;
  device_id: string;
  recipient_id: string;
  command_type: "emergency_buzzer" | "reminder" | "play_voice_message";
  priority: number;
  payload_json: string;
  status: string;
  idempotency_key: string;
  source_type: string;
  source_id: string;
  created_by: string;
  not_before: string;
  expires_at: string;
  delivery_attempts: number;
  max_delivery_attempts: number;
  delivered_at: string | null;
  accepted_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested_at: string | null;
  superseded_by: string | null;
  status_reason: string | null;
  status_detail: string | null;
  created_at: string;
  updated_at: string;
  /** Migration 0006 (ADR-022); NULL on rows written by an earlier Worker. */
  received_at: string | null;
  device_boot_id: string | null;
  ack_deadline_at: string | null;
}

interface AudioVersionRow {
  asset_id: string;
  version: number;
  r2_key: string;
  content_type: string;
  sample_rate_hz: number;
  channels: number;
  bits_per_sample: number;
  duration_ms: number;
  byte_size: number;
  sha256: string;
  title: string;
}

function eventStatement(ctx: Ctx, commandId: string, status: string, reason: string | null, actor: "device" | "caregiver" | "system"): D1PreparedStatement {
  return ctx.env.DB.prepare(
    `INSERT INTO device_command_events (command_id, seq, status, reason, actor_type, at)
     VALUES (?1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM device_command_events WHERE command_id = ?1), ?2, ?3, ?4, ?5)`,
  ).bind(commandId, status, reason, actor, iso(ctx.clock.now()));
}

export function insertCommandStatements(
  ctx: Ctx,
  c: {
    commandId?: string;
    deviceId: string;
    recipientId: string;
    type: CommandRow["command_type"];
    payload: Record<string, unknown>;
    idempotencyKey: string;
    sourceType: "alert" | "reminder" | "caregiver";
    sourceId: string;
    createdBy: string;
    notBefore: Date;
    expiresAt: Date;
    maxDeliveryAttempts: number;
  },
): { commandId: string; statements: D1PreparedStatement[] } {
  const commandId = c.commandId ?? newId("cmd");
  const now = iso(ctx.clock.now());
  return {
    commandId,
    statements: [
      ctx.env.DB.prepare(
        `INSERT INTO device_commands (command_id, device_id, recipient_id, command_type, priority, payload_json, status, idempotency_key,
           source_type, source_id, created_by, not_before, expires_at, max_delivery_attempts, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
         ON CONFLICT (idempotency_key) DO NOTHING`,
      ).bind(
        commandId,
        c.deviceId,
        c.recipientId,
        c.type,
        PRIORITY[c.type],
        JSON.stringify(c.payload),
        c.idempotencyKey,
        c.sourceType,
        c.sourceId,
        c.createdBy,
        iso(c.notBefore),
        iso(c.expiresAt),
        c.maxDeliveryAttempts,
        now,
      ),
      ctx.env.DB.prepare(
        `INSERT INTO device_command_events (command_id, seq, status, reason, actor_type, at)
         SELECT ?1, 1, 'queued', NULL, 'system', ?2 WHERE EXISTS (SELECT 1 FROM device_commands WHERE command_id = ?1)
         ON CONFLICT DO NOTHING`,
      ).bind(commandId, now),
    ],
  };
}

export function emergencyBuzzerStatements(ctx: Ctx, a: { deviceId: string; recipientId: string; alertId: string }): D1PreparedStatement[] {
  const now = ctx.clock.now();
  return insertCommandStatements(ctx, {
    deviceId: a.deviceId,
    recipientId: a.recipientId,
    type: "emergency_buzzer",
    payload: { ...BUZZER_PATTERN, alert_id: a.alertId },
    idempotencyKey: `alert:${a.alertId}:buzzer`,
    sourceType: "alert",
    sourceId: a.alertId,
    createdBy: "system",
    notBefore: now,
    expiresAt: addSeconds(now, ctx.config.emergencyCommandTtlSeconds),
    maxDeliveryAttempts: 5,
  }).statements;
}

/** Housekeeping for one device or all devices: expire overdue commands, re-queue deliveries the device never
 * acknowledged, fail received commands whose download deadline passed, fail commands whose playback was never
 * reported finished. Rows without ack_deadline_at (written before migration 0006) keep the 30 s rule. */
export function commandHousekeepingStatements(ctx: Ctx, deviceId: string | null): D1PreparedStatement[] {
  const now = ctx.clock.now();
  const db = ctx.env.DB;
  const scope = "(?2 IS NULL OR device_id = ?2)";
  return [
    db
      .prepare(
        `UPDATE device_commands SET status = 'expired', status_reason = 'deadline_passed', finished_at = ?1, updated_at = ?1
         WHERE ${scope} AND status IN ('queued', 'delivered', 'accepted') AND expires_at <= ?1`,
      )
      .bind(iso(now), deviceId),
    db
      .prepare(
        `UPDATE device_commands SET status = CASE WHEN delivery_attempts >= max_delivery_attempts THEN 'failed' ELSE 'queued' END,
           status_reason = CASE WHEN delivery_attempts >= max_delivery_attempts THEN 'no_acknowledgement' ELSE 'redelivery' END,
           finished_at = CASE WHEN delivery_attempts >= max_delivery_attempts THEN ?1 ELSE NULL END, updated_at = ?1
         WHERE ${scope} AND status = 'delivered' AND received_at IS NULL
           AND ((ack_deadline_at IS NULL AND delivered_at <= ?3) OR ack_deadline_at <= ?1)`,
      )
      .bind(iso(now), deviceId, iso(addSeconds(now, -ACK_TIMEOUT_SECONDS))),
    db
      .prepare(
        `UPDATE device_commands SET status = 'failed', status_reason = 'download_timeout', finished_at = ?1, updated_at = ?1
         WHERE ${scope} AND status = 'delivered' AND received_at IS NOT NULL AND ack_deadline_at <= ?1`,
      )
      .bind(iso(now), deviceId),
    db
      .prepare(
        `UPDATE device_commands SET status = 'failed', status_reason = 'no_completion_report', finished_at = ?1, updated_at = ?1
         WHERE ${scope} AND status = 'started' AND started_at <= ?3`,
      )
      .bind(iso(now), deviceId, iso(addSeconds(now, -PLAYING_TIMEOUT_SECONDS))),
  ];
}

function voiceRef(payload: Record<string, unknown>): { voice_message_id: string; version: number } | null {
  const voice = payload.voice as { voice_message_id: string; version: number } | null | undefined;
  return voice ?? null;
}

async function audioVersion(ctx: Ctx, recipientId: string, ref: { voice_message_id: string; version: number }): Promise<AudioVersionRow | null> {
  return ctx.env.DB.prepare(
    `SELECT v.asset_id, v.version, v.r2_key, v.content_type, v.sample_rate_hz, v.channels, v.bits_per_sample, v.duration_ms, v.byte_size, v.sha256, a.title
     FROM audio_asset_versions v JOIN audio_assets a ON a.asset_id = v.asset_id
     WHERE v.asset_id = ?1 AND v.version = ?2 AND v.deleted_at IS NULL AND a.status = 'active' AND a.recipient_id = ?3`,
  )
    .bind(ref.voice_message_id, ref.version, recipientId)
    .first<AudioVersionRow>();
}

/** The codec of a stored version, from its own content_type: MP3 (ADR-025) or the legacy PCM WAV. Never inferred. */
function codecOf(v: { content_type: string }): { content_type: string; codec: string } {
  return v.content_type === MP3_CONTRACT.contentType ? { content_type: MP3_CONTRACT.contentType, codec: MP3_CONTRACT.codec } : { content_type: "audio/wav", codec: "pcm_s16le" };
}

function audioView(row: CommandRow, v: AudioVersionRow): Record<string, unknown> {
  const codec = codecOf(v);
  return {
    voice_message_id: v.asset_id,
    version: v.version,
    ...codec,
    sample_rate_hz: v.sample_rate_hz,
    channels: v.channels,
    // PCM only: an MP3 has no sample width before decoding.
    ...(codec.codec === "pcm_s16le" ? { bits_per_sample: v.bits_per_sample } : {}),
    duration_ms: v.duration_ms,
    byte_size: v.byte_size,
    sha256: v.sha256,
    path: `/api/device/v1/commands/${row.command_id}/audio`,
  };
}

/** Codecs a device reported in its latest heartbeat (status.audio_codecs, firmware ≥ carelens-fw-0.2.0). Empty when it
 * never reported any (older firmware): such a device is assumed to play only the legacy WAV. */
export function deviceAudioCodecs(lastHeartbeatJson: string | null): string[] {
  if (!lastHeartbeatJson) return [];
  try {
    const status = JSON.parse(lastHeartbeatJson) as { audio_codecs?: unknown };
    return Array.isArray(status.audio_codecs) ? status.audio_codecs.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

/** Why this device cannot play this recording, or null. MP3 needs a device that reported the mp3 codec; legacy WAV needs a
 * rate of the device profile. Checked when a command or reminder is created, so an unplayable file is refused up front. */
export async function playbackProblem(ctx: Ctx, deviceId: string, v: { content_type: string; sample_rate_hz: number }): Promise<string | null> {
  if (codecOf(v).codec === MP3_CONTRACT.codec) {
    const row = await ctx.env.DB.prepare(`SELECT last_heartbeat_json FROM devices WHERE device_id = ?1`).bind(deviceId).first<{ last_heartbeat_json: string | null }>();
    return deviceAudioCodecs(row?.last_heartbeat_json ?? null).includes(MP3_CONTRACT.codec)
      ? null
      : "This device has not reported MP3 playback. Firmware carelens-fw-0.2.0 or later reports audio_codecs in its heartbeat.";
  }
  return ctx.config.deviceAudioSampleRates.includes(v.sample_rate_hz)
    ? null
    : `The device profile plays ${ctx.config.deviceAudioSampleRates.join("/")} Hz; this recording is ${v.sample_rate_hz} Hz. Upload it again as MP3.`;
}

/** What the device receives. Times are absolute UTC plus expires_in_ms, which the device should apply to
 * its own monotonic clock because its wall clock may be unsynchronised. */
async function deviceView(ctx: Ctx, row: CommandRow): Promise<Record<string, unknown>> {
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  const ref = voiceRef(payload);
  const audio = ref ? await audioVersion(ctx, row.recipient_id, ref) : null;
  let action: Record<string, unknown>;
  if (row.command_type === "emergency_buzzer") {
    action = { kind: "buzzer", pattern: payload.pattern, duration_ms: payload.duration_ms, beep_on_ms: payload.beep_on_ms, beep_off_ms: payload.beep_off_ms };
  } else if (row.command_type === "reminder") {
    action = {
      kind: "reminder",
      reminder_kind: payload.kind,
      label: payload.label,
      occurrence_at: payload.occurrence_at,
      audio: audio ? audioView(row, audio) : null,
      fallback: "default_tone",
    };
  } else {
    action = { kind: "voice", audio: audio ? audioView(row, audio) : null };
  }
  return {
    command_id: row.command_id,
    command_type: row.command_type,
    priority: row.priority,
    preempts_lower_priority: row.command_type === "emergency_buzzer",
    delivery_attempt: row.delivery_attempts,
    created_at: row.created_at,
    expires_at: row.expires_at,
    expires_in_ms: Math.max(0, new Date(row.expires_at).getTime() - ctx.clock.now().getTime()),
    action,
    status_path: `/api/device/v1/commands/${row.command_id}/status`,
  };
}

/** What caregivers see: the full truthful lifecycle. played === true only after the device said so. */
export function caregiverView(row: CommandRow): Record<string, unknown> {
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  return {
    command_id: row.command_id,
    device_id: row.device_id,
    command_type: row.command_type,
    priority: row.priority,
    status: row.status,
    status_reason: row.status_reason,
    status_detail: row.status_detail,
    played_confirmed_by_device: row.status === "completed",
    payload,
    not_before: row.not_before,
    expires_at: row.expires_at,
    delivery_attempts: row.delivery_attempts,
    delivered_at: row.delivered_at,
    received_at: row.received_at ?? null,
    download_deadline_at: row.received_at ? row.ack_deadline_at : null,
    accepted_at: row.accepted_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    cancel_requested_at: row.cancel_requested_at,
    superseded_by: row.superseded_by,
    created_at: row.created_at,
    source_type: row.source_type,
  };
}

/** ADR-022 reboot handling. Commands the device last reported on from another boot than `bootId`: not started yet
 * (delivered with a receipt, or accepted) go back to the queue, since nothing was played; started ones fail with
 * device_rebooted and are never completed by assumption. `exceptCommandId` is the command of the report in progress. */
export async function settleRebootedCommands(ctx: Ctx, deviceId: string, bootId: string, exceptCommandId: string | null): Promise<void> {
  const now = iso(ctx.clock.now());
  const db = ctx.env.DB;
  const [requeued, interrupted] = await db.batch<{ command_id: string; recipient_id: string }>([
    db
      .prepare(
        `UPDATE device_commands SET status = 'queued', status_reason = 'device_rebooted', received_at = NULL, device_boot_id = NULL, ack_deadline_at = NULL, updated_at = ?1
         WHERE device_id = ?2 AND device_boot_id IS NOT NULL AND device_boot_id <> ?3 AND status IN ('delivered', 'accepted') AND expires_at > ?1
           AND (?4 IS NULL OR command_id <> ?4)
         RETURNING command_id, recipient_id`,
      )
      .bind(now, deviceId, bootId, exceptCommandId),
    db
      .prepare(
        `UPDATE device_commands SET status = 'failed', status_reason = 'device_rebooted', finished_at = ?1, updated_at = ?1
         WHERE device_id = ?2 AND device_boot_id IS NOT NULL AND device_boot_id <> ?3 AND status = 'started'
           AND (?4 IS NULL OR command_id <> ?4)
         RETURNING command_id, recipient_id`,
      )
      .bind(now, deviceId, bootId, exceptCommandId),
  ]);
  const rows = [
    ...(requeued?.results ?? []).map((r) => ({ ...r, status: "queued" })),
    ...(interrupted?.results ?? []).map((r) => ({ ...r, status: "failed" })),
  ];
  if (rows.length === 0) return;
  const recipients = [...new Set(rows.map((r) => r.recipient_id))];
  await db.batch([...rows.map((r) => eventStatement(ctx, r.command_id, r.status, "device_rebooted", "system")), ...recipients.map((rid) => bumpStreamStatement(ctx, rid))]);
  for (const r of rows) ctx.exec.waitUntil(notifyRecipient(ctx.env, r.recipient_id, "command.updated", r.command_id));
}

/* ------------------------------------------------------------------ device routes */

export async function deviceNextCommand(ctx: Ctx, device: DevicePrincipal): Promise<Response> {
  const now = iso(ctx.clock.now());
  const db = ctx.env.DB;
  const results = await db.batch([
    ...commandHousekeepingStatements(ctx, device.deviceId),
    db
      .prepare(
        `UPDATE device_commands SET status = 'delivered', delivered_at = ?2, delivery_attempts = delivery_attempts + 1, updated_at = ?2,
           received_at = NULL, device_boot_id = NULL,
           ack_deadline_at = ${plusSecondsSql("?2", `?3 + ${audioAllowanceSql("?4")}`)}
         WHERE command_id = (
           SELECT command_id FROM device_commands
           WHERE device_id = ?1 AND status = 'queued' AND not_before <= ?2 AND expires_at > ?2
             AND priority > COALESCE((SELECT MAX(priority) FROM device_commands WHERE device_id = ?1 AND status IN ${ACTIVE} AND expires_at > ?2), -1)
           ORDER BY priority DESC, not_before, created_at LIMIT 1)
         RETURNING *`,
      )
      .bind(device.deviceId, now, ACK_TIMEOUT_SECONDS, ctx.config.audioDownloadMinBytesPerSecond),
    db
      .prepare(`SELECT command_id FROM device_commands WHERE device_id = ?1 AND cancel_requested_at IS NOT NULL AND status IN ${ACTIVE} LIMIT 10`)
      .bind(device.deviceId),
  ]);
  const row = (results[results.length - 2]?.results?.[0] ?? null) as CommandRow | null;
  const cancels = ((results[results.length - 1]?.results ?? []) as Array<{ command_id: string }>).map((r) => r.command_id);
  if (!row && cancels.length === 0) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (row) {
    await db.batch([eventStatement(ctx, row.command_id, "delivered", null, "system"), bumpStreamStatement(ctx, row.recipient_id)]);
    ctx.exec.waitUntil(notifyRecipient(ctx.env, row.recipient_id, "command.updated", row.command_id));
  }
  return json({ command: row ? await deviceView(ctx, row) : null, cancel_command_ids: cancels, server_time: now });
}

const ALLOWED_FROM: Record<string, string[]> = {
  received: ["delivered"],
  accepted: ["delivered"],
  started: ["delivered", "accepted"],
  completed: ["delivered", "accepted", "started"],
  failed: ["delivered", "accepted", "started"],
  rejected: ["delivered", "accepted"],
  cancelled: ["delivered", "accepted", "started"],
};
const TIME_COLUMN: Record<string, string> = {
  received: "received_at",
  accepted: "accepted_at",
  started: "started_at",
  completed: "finished_at",
  failed: "finished_at",
  rejected: "finished_at",
  cancelled: "finished_at",
};

export async function deviceCommandStatus(ctx: Ctx, device: DevicePrincipal, commandId: string): Promise<Response> {
  const body = await readJson(ctx.request, CommandStatusV2);
  if (body.device_id !== device.deviceId) throw forbidden("device_mismatch", "device_id does not match the credential.");
  if ((body.status === "failed" || body.status === "rejected") && body.reason_code === null) {
    throw invalid("reason_required", `status ${body.status} requires reason_code (${COMMAND_REASON_CODES.join(", ")}).`);
  }
  await observeClock(ctx, device.deviceId, body.clock);
  // A report from a new boot settles the device's other commands of the previous boot first; the reported command
  // itself is excluded so that evidence the device kept across the restart (e.g. a late `completed`) still counts.
  await settleRebootedCommands(ctx, device.deviceId, body.clock.boot_id, commandId);
  // Settle deadlines first so a report about a stale command is answered with its real (expired) state.
  await ctx.env.DB.batch(commandHousekeepingStatements(ctx, device.deviceId));
  const now = iso(ctx.clock.now());
  const from = ALLOWED_FROM[body.status] ?? [];
  const cancelGuard = body.status === "cancelled" ? "AND cancel_requested_at IS NOT NULL" : "";
  // received/accepted/started are refused once the deadline has passed: the device must not begin stale playback.
  const deadlineGuard = ["received", "accepted", "started"].includes(body.status) ? "AND expires_at > ?2" : "";
  // Commands with audio: started only after accepted (downloaded and verified on the device).
  const verifiedGuard = body.status === "started" ? "AND (status = 'accepted' OR json_extract(payload_json, '$.voice') IS NULL)" : "";
  const receivedGuard = body.status === "received" ? "AND received_at IS NULL" : "";
  const bootColumn = ["received", "accepted", "started"].includes(body.status) ? ", device_boot_id = ?7" : "";
  // `received` leaves the status at 'delivered', records the receipt once and starts the download deadline.
  const set =
    body.status === "received"
      ? `received_at = ?2, ack_deadline_at = MIN(expires_at, ${plusSecondsSql("?2", `?8 + ${audioAllowanceSql("?9")}`)}), updated_at = ?2`
      : `status = ?1, ${TIME_COLUMN[body.status]} = ?2, status_reason = ?3, status_detail = ?4, updated_at = ?2`;
  const updated = await ctx.env.DB.prepare(
    `UPDATE device_commands SET ${set}${bootColumn}
     WHERE command_id = ?5 AND device_id = ?6 AND status IN (${from.map((s) => `'${s}'`).join(", ")}) ${cancelGuard} ${deadlineGuard} ${verifiedGuard} ${receivedGuard}
     RETURNING *`,
  )
    // D1 requires exactly as many bindings as the highest parameter index the statement uses.
    .bind(...[body.status, now, body.reason_code, body.detail, commandId, device.deviceId, body.clock.boot_id, ACK_TIMEOUT_SECONDS, ctx.config.audioDownloadMinBytesPerSecond].slice(0, body.status === "received" ? 9 : bootColumn ? 7 : 6))
    .first<CommandRow>();
  if (!updated) {
    const current = await ctx.env.DB.prepare(`SELECT * FROM device_commands WHERE command_id = ?1 AND device_id = ?2`)
      .bind(commandId, device.deviceId)
      .first<CommandRow>();
    if (!current) throw notFound("Command not found.");
    if (current.status === body.status) return json({ command: caregiverView(current), duplicate: true });
    // A repeated or late receipt is harmless: the device already reported at least that much.
    if (body.status === "received" && ((current.status === "delivered" && current.received_at) || ["accepted", "started", "completed"].includes(current.status))) {
      return json({ command: caregiverView(current), duplicate: true });
    }
    const stop = ["expired", "cancelled", "superseded", "failed", "rejected", "completed"].includes(current.status);
    const needsAccept = body.status === "started" && current.status === "delivered";
    throw conflict(
      "invalid_transition",
      `Command is ${current.status}; cannot become ${body.status}.${needsAccept ? " Report accepted (audio downloaded and verified) before started." : ""}${stop ? " Do not start or continue playback." : ""}`,
      { current_status: current.status, stop_playback: stop },
    );
  }
  await ctx.env.DB.batch([eventStatement(ctx, commandId, body.status, body.reason_code, "device"), bumpStreamStatement(ctx, updated.recipient_id)]);
  ctx.exec.waitUntil(notifyRecipient(ctx.env, updated.recipient_id, "command.updated", commandId));
  return json({ command: caregiverView(updated), duplicate: false });
}

/** Streams the audio of an active command (optionally one byte range, for devices with little RAM). Access
 * ends when the command leaves the active states or expires. */
export async function deviceCommandAudio(ctx: Ctx, device: DevicePrincipal, commandId: string): Promise<Response> {
  const now = iso(ctx.clock.now());
  const row = await ctx.env.DB.prepare(`SELECT * FROM device_commands WHERE command_id = ?1 AND device_id = ?2 AND status IN ${ACTIVE} AND expires_at > ?3`)
    .bind(commandId, device.deviceId, now)
    .first<CommandRow>();
  if (!row) throw notFound("No active command with audio.");
  const ref = voiceRef(JSON.parse(row.payload_json) as Record<string, unknown>);
  if (!ref) throw notFound("Command has no audio.");
  const version = await audioVersion(ctx, device.recipientId, ref);
  if (!version) throw new HttpError(410, "audio_deleted", "Gone", "The voice message was deleted.");
  const headers: Record<string, string> = {
    "content-type": codecOf(version).content_type,
    "x-content-sha256": version.sha256,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  };
  const range = /^bytes=(\d+)-(\d*)$/.exec(ctx.request.headers.get("range") ?? "");
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), version.byte_size - 1) : version.byte_size - 1;
    if (start >= version.byte_size || end < start) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${version.byte_size}`, "cache-control": "no-store" } });
    }
    const part = await ctx.env.AUDIO.get(version.r2_key, { range: { offset: start, length: end - start + 1 } });
    if (!part) throw new HttpError(410, "audio_missing", "Gone", "Audio object is missing from storage.");
    return new Response(part.body, { status: 206, headers: { ...headers, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${version.byte_size}` } });
  }
  const object = await ctx.env.AUDIO.get(version.r2_key);
  if (!object) throw new HttpError(410, "audio_missing", "Gone", "Audio object is missing from storage.");
  return new Response(object.body, { headers: { ...headers, "content-length": String(version.byte_size) } });
}

/* ------------------------------------------------------------------ caregiver routes */

export async function caregiverCreateCommand(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, deviceId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "devices.command");
  const body = await readJson(ctx.request, CommandCreateV1);
  return createVoiceCommand(ctx, { actorType: "caregiver", actorId: user.userId, createdBy: user.userId, keyScope: `caregiver:${user.userId}` }, recipientId, deviceId, body);
}

/** Who issues a command. `createdBy` is stored on the command; `keyScope` prefixes the client's idempotency key so two
 * actors can never collide on (or replay) each other's keys. */
export interface CommandActor {
  actorType: "admin" | "caregiver";
  actorId: string;
  createdBy: string;
  keyScope: string;
}

/** Queues one play_voice_message command for a device of the recipient. Authorization and body validation are the caller's. */
export async function createVoiceCommand(
  ctx: Ctx,
  actor: CommandActor,
  recipientId: string,
  deviceId: string,
  body: { voice_message_id: string; idempotency_key: string; expires_in_seconds: number },
  view: (row: CommandRow) => Record<string, unknown> = caregiverView,
): Promise<Response> {
  const device = await ctx.env.DB.prepare(`SELECT device_id FROM devices WHERE device_id = ?1 AND recipient_id = ?2 AND status = 'active'`)
    .bind(deviceId, recipientId)
    .first();
  if (!device) throw notFound("Device not found.");
  const asset = await ctx.env.DB.prepare(
    `SELECT a.current_version, v.sample_rate_hz, v.content_type FROM audio_assets a JOIN audio_asset_versions v ON v.asset_id = a.asset_id AND v.version = a.current_version
     WHERE a.asset_id = ?1 AND a.recipient_id = ?2 AND a.status = 'active'`,
  )
    .bind(body.voice_message_id, recipientId)
    .first<{ current_version: number; sample_rate_hz: number; content_type: string }>();
  if (!asset) throw invalid("voice_message_not_found", "voice_message_id is not an active voice message of this recipient.");
  const problem = await playbackProblem(ctx, deviceId, asset);
  if (problem) throw invalid("audio_not_playable", problem);
  const now = ctx.clock.now();
  const key = `${actor.keyScope}:${body.idempotency_key}`;
  const payload = { voice: { voice_message_id: body.voice_message_id, version: asset.current_version } };
  const { commandId, statements } = insertCommandStatements(ctx, {
    deviceId,
    recipientId,
    type: "play_voice_message",
    payload,
    idempotencyKey: key,
    sourceType: "caregiver",
    sourceId: actor.actorId,
    createdBy: actor.createdBy,
    notBefore: now,
    expiresAt: addSeconds(now, body.expires_in_seconds),
    maxDeliveryAttempts: 3,
  });
  // A replay of the same key inserts no second command (ON CONFLICT DO NOTHING); the attempt is still audited, so the audit
  // detail names no command id (a replayed request would carry an id that was never stored).
  await ctx.env.DB.batch([
    ...statements,
    auditStatement(ctx, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "command.create",
      targetType: "device",
      targetId: deviceId,
      recipientId,
      detail: actor.actorType === "admin" ? { device_id: deviceId, command_type: "play_voice_message", voice_message_id: body.voice_message_id } : undefined,
    }),
    bumpStreamStatement(ctx, recipientId),
  ]);
  const row = await ctx.env.DB.prepare(`SELECT * FROM device_commands WHERE idempotency_key = ?1`).bind(key).first<CommandRow>();
  if (!row) throw new HttpError(500, "command_not_stored", "Internal error", "Command was not stored.");
  const created = row.command_id === commandId;
  if (!created && (row.device_id !== deviceId || row.payload_json !== JSON.stringify(payload))) {
    throw conflict("idempotency_key_reused", "idempotency_key was already used for a different command.");
  }
  if (created) ctx.exec.waitUntil(notifyRecipient(ctx.env, recipientId, "command.updated", row.command_id));
  return json({ command: view(row), created }, created ? 201 : 200);
}

export async function caregiverListCommands(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, deviceId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  return listCommandsOf(ctx, recipientId, deviceId);
}

export async function listCommandsOf(ctx: Ctx, recipientId: string, deviceId: string, view: (row: CommandRow) => Record<string, unknown> = caregiverView): Promise<Response> {
  const limit = limitParam(ctx.url, 50, 200);
  const cursor = decodeCursor(ctx.url.searchParams.get("cursor"));
  const rows = await ctx.env.DB.prepare(
    `SELECT * FROM device_commands WHERE recipient_id = ?1 AND device_id = ?2
       AND (?3 IS NULL OR created_at < ?3 OR (created_at = ?3 AND command_id < ?4))
     ORDER BY created_at DESC, command_id DESC LIMIT ?5`,
  )
    .bind(recipientId, deviceId, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1)
    .all<CommandRow>();
  const items = rows.results.slice(0, limit);
  const last = items[items.length - 1];
  return json({
    items: items.map(view),
    next_cursor: rows.results.length > limit && last ? encodeCursor(last.created_at, last.command_id) : null,
  });
}

export async function caregiverCommandTimeline(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, commandId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  const row = await ctx.env.DB.prepare(`SELECT * FROM device_commands WHERE command_id = ?1 AND recipient_id = ?2`).bind(commandId, recipientId).first<CommandRow>();
  if (!row) throw notFound("Command not found.");
  const events = await ctx.env.DB.prepare(`SELECT seq, status, reason, actor_type, at FROM device_command_events WHERE command_id = ?1 ORDER BY seq`).bind(commandId).all();
  return json({ command: caregiverView(row), timeline: events.results });
}

/** Queued commands are cancelled at once. Commands already on the device get a cancel request that the
 * device must confirm (status "cancelled"); until then their status stays truthful. The emergency buzzer
 * cannot be cancelled here (it stops on its own after 30 s). */
export async function caregiverCancelCommand(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, commandId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "devices.command");
  return cancelCommandOf(ctx, { actorType: "caregiver", actorId: user.userId }, recipientId, commandId);
}

export async function cancelCommandOf(ctx: Ctx, actor: { actorType: "admin" | "caregiver"; actorId: string }, recipientId: string, commandId: string): Promise<Response> {
  const now = iso(ctx.clock.now());
  const db = ctx.env.DB;
  const current = await db.prepare(`SELECT * FROM device_commands WHERE command_id = ?1 AND recipient_id = ?2`).bind(commandId, recipientId).first<CommandRow>();
  if (!current) throw notFound("Command not found.");
  if (current.command_type === "emergency_buzzer") throw conflict("not_cancellable", "The emergency buzzer cannot be cancelled remotely.", { current_status: current.status });
  let row: CommandRow | null = null;
  if (current.status === "queued") {
    row = await db
      .prepare(`UPDATE device_commands SET status = 'cancelled', status_reason = 'cancelled_by_caregiver', finished_at = ?1, updated_at = ?1 WHERE command_id = ?2 AND status = 'queued' RETURNING *`)
      .bind(now, commandId)
      .first<CommandRow>();
  } else if (["delivered", "accepted", "started"].includes(current.status)) {
    row = await db
      .prepare(`UPDATE device_commands SET cancel_requested_at = COALESCE(cancel_requested_at, ?1), updated_at = ?1 WHERE command_id = ?2 AND status IN ${ACTIVE} RETURNING *`)
      .bind(now, commandId)
      .first<CommandRow>();
  }
  if (!row) throw conflict("not_cancellable", `Command is ${current.status}.`, { current_status: current.status });
  await db.batch([
    // device_command_events only knows device/caregiver/system as actors; an admin's cancel is attributed in the audit log.
    eventStatement(ctx, commandId, row.status === "cancelled" ? "cancelled" : "cancel_requested", actor.actorType === "admin" ? "cancelled_by_admin" : "cancelled_by_caregiver", actor.actorType === "admin" ? "system" : "caregiver"),
    auditStatement(ctx, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "command.cancel",
      targetType: "command",
      targetId: commandId,
      recipientId,
      detail: actor.actorType === "admin" ? { device_id: current.device_id } : undefined,
    }),
    bumpStreamStatement(ctx, recipientId),
  ]);
  ctx.exec.waitUntil(notifyRecipient(ctx.env, recipientId, "command.updated", commandId));
  return json({ command: caregiverView(row), cancel_pending_device_confirmation: row.status !== "cancelled" }, row.status === "cancelled" ? 200 : 202);
}
