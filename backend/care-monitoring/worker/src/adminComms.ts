/**
 * Admin messaging to a device: private voice recordings, voice-playback commands, and scheduled reminders. All of it reuses the
 * existing device protocol (docs/DEVICE_API.md): an admin does not get a new command type or a new device route. A command is
 * `play_voice_message`; a reminder is a row of reminder_schedules that the minute cron turns into one `reminder` command per
 * occurrence (idempotency key reminder:<id>:<occurrence>). Nothing is "played" until the device reports `completed`.
 *
 * Every mutation here: requires an admin principal (index.ts), carries `confirm: true` in its body (the final confirmation is
 * enforced by the server, not only by the UI), is idempotent per (admin, idempotency_key), is throttled per admin, and writes an
 * audit row in the same batch as the change. Audit details hold ids and enums only, never reminder text, tokens or audio.
 */
import { z } from "zod";
import { cancelCommandOf, caregiverView, createVoiceCommand, listCommandsOf, playbackProblem, type CommandRow } from "./commands";
import { adminActorId, auditStatement, bumpStreamStatement, type Ctx } from "./context";
import { HttpError, conflict, invalid, json, notFound, readJson } from "./http";
import { AUDIO_CONTRACT, MP3_CONTRACT } from "./media";
import { checkRefs, checkSchedule, nextOccurrence, reminderView, type ReminderRow } from "./reminders";
import { listVoiceOf, storeVoice, voiceAudioOf } from "./voice";
import { addDays, addSeconds, iso, localDate, sha256Hex, weekdayOf, zonedToUtc } from "./util";

export const ADMIN_MUTATIONS_PER_MINUTE = 20;
const MUTATION_ACTIONS = ["command.create", "command.cancel", "voice.upload", "reminder.create", "reminder.pause", "reminder.resume", "reminder.cancel", "device.speaker_volume"];
/** Volume range offered for the 8 ohm / 1 W speaker on MAX98357A (fraction of full scale). A conservative software limit, not a
 * measured power rating; 0.25 is the value of the known-good baseline sketch. Mirrored by migration 0007 and the firmware. */
export const SPEAKER_VOLUME = { min: 0.05, max: 0.7, default: 0.25, step: 0.05 } as const;
/** A one-time reminder must be at least this far ahead, so "now" is not accepted as "scheduled". */
const MIN_LEAD_SECONDS = 30;
const MAX_LEAD_DAYS = 366;

/** Counts the actor's recent mutations from the audit log (the same rows an owner can read) and refuses past the limit. */
async function spendAdminBudget(ctx: Ctx): Promise<void> {
  const row = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM audit_log WHERE actor_type = 'admin' AND actor_id = ?1 AND at >= ?2 AND action IN (${MUTATION_ACTIONS.map(() => "?").join(",")})`,
  )
    .bind(adminActorId(ctx), iso(addSeconds(ctx.clock.now(), -60)), ...MUTATION_ACTIONS)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= ADMIN_MUTATIONS_PER_MINUTE) {
    throw new HttpError(429, "rate_limited", "Too many requests", `At most ${ADMIN_MUTATIONS_PER_MINUTE} admin changes per minute.`, { "retry-after": "30" });
  }
}

const createdBy = (ctx: Ctx) => `admin:${adminActorId(ctx)}`;

interface DeviceRef {
  device_id: string;
  recipient_id: string;
}

async function activeDevice(ctx: Ctx, deviceId: string): Promise<DeviceRef> {
  const d = await ctx.env.DB.prepare(`SELECT device_id, recipient_id FROM devices WHERE device_id = ?1 AND status = 'active'`).bind(deviceId).first<DeviceRef>();
  if (!d) throw notFound("Active device not found.");
  return d;
}

async function anyDevice(ctx: Ctx, deviceId: string): Promise<DeviceRef> {
  const d = await ctx.env.DB.prepare(`SELECT device_id, recipient_id FROM devices WHERE device_id = ?1`).bind(deviceId).first<DeviceRef>();
  if (!d) throw notFound("Device not found.");
  return d;
}

/* ------------------------------------------------------------------ capabilities */

/** What the admin pages may offer, derived from configuration. Nothing here is a claim about the physical device. */
export function capabilities(ctx: Ctx): Response {
  return json({
    tts: { available: false, reason: "no_text_to_speech_service", note: "Máy chủ không có dịch vụ chuyển văn bản thành giọng nói. Chỉ phát được bản ghi MP3 đã tải lên." },
    // Upload contract (ADR-025): MP3 stored and delivered unchanged; the device decodes it. WAV uploads are refused.
    audio: {
      content_type: MP3_CONTRACT.contentType,
      codec: MP3_CONTRACT.codec,
      sample_rates_hz: MP3_CONTRACT.sampleRates,
      channels: MP3_CONTRACT.channels,
      min_duration_ms: MP3_CONTRACT.minDurationMs,
      max_duration_ms: MP3_CONTRACT.maxDurationMs,
      max_bytes: MP3_CONTRACT.maxBytes,
      device_requirement: "audio_codecs_reports_mp3",
      legacy_wav: { upload: "refused", playback: "supported", sample_rates_hz: ctx.config.deviceAudioSampleRates, max_bytes: AUDIO_CONTRACT.maxBytes },
    },
    commands: {
      voice_expiry_seconds: { min: 30, max: 3600 },
      mutations_per_minute: ADMIN_MUTATIONS_PER_MINUTE,
      device_receipt_report: "received",
      audio_download_min_bytes_per_second: ctx.config.audioDownloadMinBytesPerSecond,
    },
    reminders: {
      timezone: ctx.config.reportTimezone,
      deadline_minutes: { min: 1, max: 240 },
      scheduler: "cloudflare_cron_every_minute",
      execution_evidence: "A reminder is dispatched only if the Worker deployment includes the cron trigger; the first command created for an occurrence is the evidence.",
    },
    report: { timezone: ctx.config.reportTimezone, interval: "[start, end)", imu_raw_retention_hours: ctx.config.imuRawRetentionHours },
    speaker_volume: { ...SPEAKER_VOLUME, delivery: "heartbeat_response", applied_evidence: "device_heartbeat_status" },
    device_playback: "not_verified_with_hardware",
  });
}

/* ------------------------------------------------------------------ speaker volume */

const SpeakerVolumeBody = z
  .object({
    volume: z
      .number()
      .min(SPEAKER_VOLUME.min)
      .max(SPEAKER_VOLUME.max)
      .refine((v) => Math.abs(Math.round(v / SPEAKER_VOLUME.step) * SPEAKER_VOLUME.step - v) < 1e-9, "volume must be a multiple of 0.05"),
    confirm: z.literal(true),
  })
  .strict();

/** Sets the volume the device is told to use. Takes effect when the device's next heartbeat (≤ 60 s) carries it; only the
 * device's own heartbeat report says it was applied. */
export async function adminSetSpeakerVolume(ctx: Ctx, deviceId: string): Promise<Response> {
  const body = await readJson(ctx.request, SpeakerVolumeBody);
  await spendAdminBudget(ctx);
  const d = await activeDevice(ctx, deviceId);
  const now = iso(ctx.clock.now());
  const volume = Math.round(body.volume * 100) / 100;
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE devices SET speaker_volume = ?1, speaker_volume_set_at = ?2, speaker_volume_set_by = ?3 WHERE device_id = ?4 AND status = 'active'`).bind(
      volume,
      now,
      createdBy(ctx),
      d.device_id,
    ),
    auditStatement(ctx, { actorType: "admin", actorId: adminActorId(ctx), action: "device.speaker_volume", targetType: "device", targetId: d.device_id, recipientId: d.recipient_id, detail: { device_id: d.device_id, volume } }),
  ]);
  return json({ device_id: d.device_id, speaker: { desired_volume: volume, desired_set_at: now, delivery: "next_heartbeat" } });
}

/* ------------------------------------------------------------------ voice recordings */

export async function adminListVoice(ctx: Ctx, deviceId: string): Promise<Response> {
  const d = await anyDevice(ctx, deviceId);
  return listVoiceOf(ctx, d.recipient_id);
}

export async function adminUploadVoice(ctx: Ctx, deviceId: string): Promise<Response> {
  await spendAdminBudget(ctx);
  const d = await activeDevice(ctx, deviceId);
  return storeVoice(ctx, { actorType: "admin", actorId: adminActorId(ctx), createdBy: createdBy(ctx), auditDetail: { device_id: d.device_id } }, d.recipient_id);
}

/** Private preview for the admin's browser (fetched with the bearer token and played from a blob; there is no shareable URL). */
export async function adminVoiceAudio(ctx: Ctx, assetId: string): Promise<Response> {
  return voiceAudioOf(ctx, null, assetId);
}

/* ------------------------------------------------------------------ commands */

const VoiceCommandBody = z
  .object({
    voice_message_id: z.string().min(1).max(80),
    idempotency_key: z.string().min(8).max(128),
    expires_in_seconds: z.number().int().min(30).max(3600),
    confirm: z.literal(true),
  })
  .strict();

const adminCommandView = (row: CommandRow): Record<string, unknown> => ({ ...caregiverView(row), created_by: row.created_by });

export async function adminCreateVoiceCommand(ctx: Ctx, deviceId: string): Promise<Response> {
  const body = await readJson(ctx.request, VoiceCommandBody);
  await spendAdminBudget(ctx);
  const d = await activeDevice(ctx, deviceId);
  return createVoiceCommand(ctx, { actorType: "admin", actorId: adminActorId(ctx), createdBy: createdBy(ctx), keyScope: `admin:${adminActorId(ctx)}` }, d.recipient_id, d.device_id, body, adminCommandView);
}

export async function adminListCommands(ctx: Ctx, deviceId: string): Promise<Response> {
  const d = await anyDevice(ctx, deviceId);
  return listCommandsOf(ctx, d.recipient_id, d.device_id, adminCommandView);
}

export async function adminCommandTimeline(ctx: Ctx, commandId: string): Promise<Response> {
  const row = await ctx.env.DB.prepare(`SELECT * FROM device_commands WHERE command_id = ?1`).bind(commandId).first<CommandRow>();
  if (!row) throw notFound("Command not found.");
  const events = await ctx.env.DB.prepare(`SELECT seq, status, reason, actor_type, at FROM device_command_events WHERE command_id = ?1 ORDER BY seq`).bind(commandId).all();
  return json({ command: adminCommandView(row), timeline: events.results });
}

export async function adminCancelCommand(ctx: Ctx, commandId: string): Promise<Response> {
  await spendAdminBudget(ctx);
  const row = await ctx.env.DB.prepare(`SELECT recipient_id FROM device_commands WHERE command_id = ?1`).bind(commandId).first<{ recipient_id: string }>();
  if (!row) throw notFound("Command not found.");
  return cancelCommandOf(ctx, { actorType: "admin", actorId: adminActorId(ctx) }, row.recipient_id, commandId);
}

/* ------------------------------------------------------------------ reminders */

const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const LocalDateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ReminderBody = z
  .object({
    idempotency_key: z.string().min(8).max(128),
    kind: z.enum(["medication", "water"]),
    label: z.string().trim().min(1).max(120),
    voice_message_id: z.string().min(1).max(80).nullable(),
    deadline_minutes: z.number().int().min(1).max(240),
    schedule: z.discriminatedUnion("type", [
      z.object({ type: z.literal("once"), local_date: LocalDateText, local_time: Hhmm }).strict(),
      z
        .object({
          type: z.literal("weekly"),
          days_of_week: z.array(z.number().int().min(1).max(7)).min(1).max(7),
          times_local: z.array(Hhmm).min(1).max(12),
          start_date: LocalDateText,
          end_date: LocalDateText.nullable(),
        })
        .strict(),
    ]),
    confirm: z.literal(true),
  })
  .strict();

interface LastDispatch {
  source_id: string;
  command_id: string;
  status: string;
  status_reason: string | null;
  not_before: string;
  finished_at: string | null;
  delivery_attempts: number;
}

function scheduleKind(r: ReminderRow): "once" | "recurring" {
  const times = JSON.parse(r.times_local_json) as string[];
  return r.end_date !== null && r.end_date === r.start_date && times.length === 1 ? "once" : "recurring";
}

function adminReminderView(ctx: Ctx, r: ReminderRow, last: LastDispatch | undefined): Record<string, unknown> {
  const now = ctx.clock.now();
  const next = r.status === "active" ? nextOccurrence(r, now) : null;
  const state = r.status === "cancelled" ? "cancelled" : r.paused_at ? "paused" : next ? "scheduled" : "finished";
  return {
    ...reminderView(r),
    schedule_kind: scheduleKind(r),
    state,
    // The next occurrence whose delivery window has not ended. While paused it is shown for reference but nothing will be queued.
    next_occurrence_at: next ? iso(next) : null,
    window_open: next !== null && next.getTime() <= now.getTime(),
    last_dispatch: last
      ? { command_id: last.command_id, occurrence_at: last.not_before, status: last.status, status_reason: last.status_reason, delivery_attempts: last.delivery_attempts, finished_at: last.finished_at, played_confirmed_by_device: last.status === "completed" }
      : null,
  };
}

async function lastDispatches(ctx: Ctx, deviceId: string): Promise<Map<string, LastDispatch>> {
  const rows = await ctx.env.DB.prepare(
    `SELECT source_id, command_id, status, status_reason, not_before, finished_at, delivery_attempts FROM device_commands c
     WHERE source_type = 'reminder' AND device_id = ?1 AND created_at = (SELECT MAX(created_at) FROM device_commands WHERE source_type = 'reminder' AND source_id = c.source_id)
     GROUP BY source_id`,
  )
    .bind(deviceId)
    .all<LastDispatch>();
  return new Map(rows.results.map((r) => [r.source_id, r]));
}

export async function adminListReminders(ctx: Ctx, deviceId: string): Promise<Response> {
  await anyDevice(ctx, deviceId);
  const [rows, last] = await Promise.all([
    ctx.env.DB.prepare(`SELECT * FROM reminder_schedules WHERE device_id = ?1 ORDER BY (status = 'active') DESC, created_at DESC LIMIT 100`).bind(deviceId).all<ReminderRow>(),
    lastDispatches(ctx, deviceId),
  ]);
  return json({ items: rows.results.map((r) => adminReminderView(ctx, r, last.get(r.reminder_id))), timezone: ctx.config.reportTimezone, server_time: iso(ctx.clock.now()) });
}

export async function adminCreateReminder(ctx: Ctx, deviceId: string): Promise<Response> {
  const body = await readJson(ctx.request, ReminderBody);
  await spendAdminBudget(ctx);
  const d = await activeDevice(ctx, deviceId);
  const tz = ctx.config.reportTimezone;
  const now = ctx.clock.now();

  const record =
    body.schedule.type === "once"
      ? { times_local: [body.schedule.local_time], days_of_week: [weekdayOf(body.schedule.local_date)], start_date: body.schedule.local_date, end_date: body.schedule.local_date as string | null }
      : { times_local: [...new Set(body.schedule.times_local)].sort(), days_of_week: [...body.schedule.days_of_week].sort(), start_date: body.schedule.start_date, end_date: body.schedule.end_date };
  checkSchedule({ timezone: tz, ...record });
  if (body.schedule.type === "once") {
    const at = zonedToUtc(body.schedule.local_date, body.schedule.local_time, tz);
    if (at.getTime() < now.getTime() + MIN_LEAD_SECONDS * 1000) throw invalid("schedule_in_past", `A one-time reminder must be at least ${MIN_LEAD_SECONDS} seconds in the future (${tz}).`);
    if (at.getTime() > now.getTime() + MAX_LEAD_DAYS * 86_400_000) throw invalid("schedule_too_far", `A one-time reminder can be at most ${MAX_LEAD_DAYS} days ahead.`);
  } else {
    if (record.start_date < localDate(now, tz)) throw invalid("schedule_in_past", "start_date is before today.");
    if (record.start_date > addDays(localDate(now, tz), MAX_LEAD_DAYS)) throw invalid("schedule_too_far", `start_date can be at most ${MAX_LEAD_DAYS} days ahead.`);
    const probe = { times_local_json: JSON.stringify(record.times_local), days_of_week_json: JSON.stringify(record.days_of_week), timezone: tz, start_date: record.start_date, end_date: record.end_date, deadline_minutes: body.deadline_minutes };
    if (!nextOccurrence(probe, now)) throw invalid("no_future_occurrence", "The schedule has no occurrence left (check the days of the week and the end date).");
  }
  await checkRefs(ctx, d.recipient_id, null, body.voice_message_id);
  if (body.voice_message_id) {
    const v = await ctx.env.DB.prepare(
      `SELECT v.sample_rate_hz, v.content_type FROM audio_assets a JOIN audio_asset_versions v ON v.asset_id = a.asset_id AND v.version = a.current_version WHERE a.asset_id = ?1`,
    )
      .bind(body.voice_message_id)
      .first<{ sample_rate_hz: number; content_type: string }>();
    const problem = v ? await playbackProblem(ctx, d.device_id, v) : null;
    if (problem) throw invalid("audio_not_playable", problem);
  }

  // The id derives from (admin, idempotency key): a double click or a retry finds the row it already made.
  const id = `rem_${(await sha256Hex(`admin:${adminActorId(ctx)}:${body.idempotency_key}`)).slice(0, 32)}`;
  const sameContent = (r: ReminderRow) =>
    r.device_id === d.device_id && r.kind === body.kind && r.label === body.label && r.voice_message_id === body.voice_message_id && r.deadline_minutes === body.deadline_minutes &&
    r.times_local_json === JSON.stringify(record.times_local) && r.days_of_week_json === JSON.stringify(record.days_of_week) && r.start_date === record.start_date && r.end_date === record.end_date;
  const existing = await ctx.env.DB.prepare(`SELECT * FROM reminder_schedules WHERE reminder_id = ?1`).bind(id).first<ReminderRow>();
  if (existing) {
    if (!sameContent(existing)) throw conflict("idempotency_key_reused", "idempotency_key was already used for a different reminder.");
    return json({ reminder: adminReminderView(ctx, existing, undefined), created: false });
  }
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `INSERT INTO reminder_schedules (reminder_id, recipient_id, device_id, kind, label, voice_message_id, times_local_json, days_of_week_json, timezone,
         start_date, end_date, deadline_minutes, status, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', ?13, ?14, ?14) ON CONFLICT (reminder_id) DO NOTHING`,
    ).bind(id, d.recipient_id, d.device_id, body.kind, body.label, body.voice_message_id, JSON.stringify(record.times_local), JSON.stringify(record.days_of_week), tz, record.start_date, record.end_date, body.deadline_minutes, createdBy(ctx), iso(now)),
    auditStatement(ctx, {
      actorType: "admin",
      actorId: adminActorId(ctx),
      action: "reminder.create",
      targetType: "reminder",
      targetId: id,
      recipientId: d.recipient_id,
      detail: { device_id: d.device_id, schedule_kind: body.schedule.type === "once" ? "once" : "recurring", reminder_kind: body.kind },
    }),
    bumpStreamStatement(ctx, d.recipient_id),
  ]);
  const row = await ctx.env.DB.prepare(`SELECT * FROM reminder_schedules WHERE reminder_id = ?1`).bind(id).first<ReminderRow>();
  if (!row) throw new HttpError(500, "reminder_not_stored", "Internal error", "Reminder was not stored.");
  return json({ reminder: adminReminderView(ctx, row, undefined), created: true }, 201);
}

type ReminderOp = "pause" | "resume" | "cancel";

/** Commands already queued for a reminder stop with it; one the device holds gets a cancel request it must confirm. */
function stopCommandsStatements(ctx: Ctx, r: ReminderRow, reason: string): D1PreparedStatement[] {
  const now = iso(ctx.clock.now());
  return [
    ctx.env.DB.prepare(
      `UPDATE device_commands SET status = 'cancelled', status_reason = ?4, finished_at = ?1, updated_at = ?1
       WHERE source_type = 'reminder' AND source_id = ?2 AND recipient_id = ?3 AND status = 'queued'`,
    ).bind(now, r.reminder_id, r.recipient_id, reason),
    ctx.env.DB.prepare(
      `UPDATE device_commands SET cancel_requested_at = COALESCE(cancel_requested_at, ?1), updated_at = ?1
       WHERE source_type = 'reminder' AND source_id = ?2 AND recipient_id = ?3 AND status IN ('delivered', 'accepted', 'started')`,
    ).bind(now, r.reminder_id, r.recipient_id),
  ];
}

export async function adminChangeReminder(ctx: Ctx, reminderId: string, op: ReminderOp): Promise<Response> {
  await spendAdminBudget(ctx);
  const r = await ctx.env.DB.prepare(`SELECT * FROM reminder_schedules WHERE reminder_id = ?1`).bind(reminderId).first<ReminderRow>();
  if (!r) throw notFound("Reminder not found.");
  const now = iso(ctx.clock.now());
  const view = (row: ReminderRow, duplicate: boolean) => json({ reminder: adminReminderView(ctx, row, undefined), duplicate });

  if (r.status === "cancelled") {
    if (op === "cancel") return view(r, true);
    throw conflict("reminder_cancelled", "A cancelled reminder cannot be changed.");
  }
  if (op === "pause" && r.paused_at) return view(r, true);
  if (op === "resume" && !r.paused_at) return view(r, true);
  if (op === "resume" && !nextOccurrence(r, ctx.clock.now())) throw conflict("schedule_finished", "The schedule has no occurrence left, so it cannot be resumed.");

  const update =
    op === "cancel"
      ? ctx.env.DB.prepare(`UPDATE reminder_schedules SET status = 'cancelled', cancelled_at = ?1, updated_at = ?1, version = version + 1 WHERE reminder_id = ?2 AND status = 'active'`).bind(now, reminderId)
      : op === "pause"
        ? ctx.env.DB.prepare(`UPDATE reminder_schedules SET paused_at = ?1, updated_at = ?1, version = version + 1 WHERE reminder_id = ?2 AND status = 'active' AND paused_at IS NULL`).bind(now, reminderId)
        : ctx.env.DB.prepare(`UPDATE reminder_schedules SET paused_at = NULL, updated_at = ?1, version = version + 1 WHERE reminder_id = ?2 AND status = 'active' AND paused_at IS NOT NULL`).bind(now, reminderId);
  const res = await ctx.env.DB.batch([
    update,
    ...(op === "resume" ? [] : stopCommandsStatements(ctx, r, op === "cancel" ? "reminder_cancelled" : "reminder_paused")),
    auditStatement(ctx, { actorType: "admin", actorId: adminActorId(ctx), action: `reminder.${op}`, targetType: "reminder", targetId: reminderId, recipientId: r.recipient_id, detail: { device_id: r.device_id } }),
    bumpStreamStatement(ctx, r.recipient_id),
  ]);
  // Someone changed it between our read and write: report the real current state instead of a success we did not cause.
  if ((res[0]?.meta?.changes ?? 0) === 0) {
    const current = await ctx.env.DB.prepare(`SELECT * FROM reminder_schedules WHERE reminder_id = ?1`).bind(reminderId).first<ReminderRow>();
    if (current) return view(current, true);
    throw notFound("Reminder not found.");
  }
  const row = await ctx.env.DB.prepare(`SELECT * FROM reminder_schedules WHERE reminder_id = ?1`).bind(reminderId).first<ReminderRow>();
  return view(row ?? r, false);
}
