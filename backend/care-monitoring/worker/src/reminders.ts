/**
 * Caregiver-managed medication and water reminders, scheduled entirely in the backend so the device
 * keeps no schedule. Each due occurrence becomes one device command (idempotency key
 * reminder:<id>:<occurrence>) that is deliverable from the occurrence time until occurrence +
 * deadline_minutes. If the device is offline past that deadline the command expires and is never replayed.
 * The reminder text is caregiver input; the backend does not validate medication or dosage.
 */
import { ReminderCreateV1, ReminderUpdateV1 } from "./contracts";
import { insertCommandStatements } from "./commands";
import { auditStatement, bumpStreamStatement, requireRecipient, type CaregiverPrincipal, type Ctx } from "./context";
import { conflict, invalid, json, notFound, readJson } from "./http";
import { addDays, addSeconds, isValidDate, iso, localDate, newId, weekdayOf, zonedToUtc } from "./util";

interface ReminderRow {
  reminder_id: string;
  recipient_id: string;
  device_id: string;
  kind: "medication" | "water";
  label: string;
  voice_message_id: string | null;
  times_local_json: string;
  days_of_week_json: string;
  timezone: string;
  start_date: string;
  end_date: string | null;
  deadline_minutes: number;
  status: "active" | "cancelled";
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

function view(r: ReminderRow): Record<string, unknown> {
  return {
    reminder_id: r.reminder_id,
    device_id: r.device_id,
    kind: r.kind,
    label: r.label,
    voice_message_id: r.voice_message_id,
    times_local: JSON.parse(r.times_local_json),
    days_of_week: JSON.parse(r.days_of_week_json),
    timezone: r.timezone,
    start_date: r.start_date,
    end_date: r.end_date,
    deadline_minutes: r.deadline_minutes,
    status: r.status,
    version: r.version,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function checkRefs(ctx: Ctx, recipientId: string, deviceId: string | null, voiceId: string | null | undefined): Promise<void> {
  if (deviceId) {
    const d = await ctx.env.DB.prepare(`SELECT 1 FROM devices WHERE device_id = ?1 AND recipient_id = ?2 AND status = 'active'`).bind(deviceId, recipientId).first();
    if (!d) throw invalid("device_not_found", "device_id is not an active device of this recipient.");
  }
  if (voiceId) {
    const v = await ctx.env.DB.prepare(`SELECT 1 FROM audio_assets WHERE asset_id = ?1 AND recipient_id = ?2 AND status = 'active'`).bind(voiceId, recipientId).first();
    if (!v) throw invalid("voice_message_not_found", "voice_message_id is not an active voice message of this recipient.");
  }
}

function checkSchedule(s: { timezone?: string; start_date?: string; end_date?: string | null; times_local?: string[]; days_of_week?: number[] }): void {
  if (s.timezone !== undefined && !validTimezone(s.timezone)) throw invalid("invalid_timezone", "timezone must be an IANA time zone.");
  if (s.start_date !== undefined && !isValidDate(s.start_date)) throw invalid("invalid_date", "start_date is not a calendar date.");
  if (s.end_date && !isValidDate(s.end_date)) throw invalid("invalid_date", "end_date is not a calendar date.");
  if (s.start_date && s.end_date && s.end_date < s.start_date) throw invalid("invalid_date_range", "end_date is before start_date.");
  if (s.times_local && new Set(s.times_local).size !== s.times_local.length) throw invalid("duplicate_times", "times_local has duplicates.");
  if (s.days_of_week && new Set(s.days_of_week).size !== s.days_of_week.length) throw invalid("duplicate_days", "days_of_week has duplicates.");
}

export async function createReminder(ctx: Ctx, user: CaregiverPrincipal, recipientId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "reminders.manage");
  const body = await readJson(ctx.request, ReminderCreateV1);
  checkSchedule(body);
  await checkRefs(ctx, recipientId, body.device_id, body.voice_message_id);
  const id = newId("rem");
  const now = iso(ctx.clock.now());
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `INSERT INTO reminder_schedules (reminder_id, recipient_id, device_id, kind, label, voice_message_id, times_local_json, days_of_week_json, timezone,
         start_date, end_date, deadline_minutes, status, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', ?13, ?14, ?14)`,
    ).bind(
      id,
      recipientId,
      body.device_id,
      body.kind,
      body.label,
      body.voice_message_id,
      JSON.stringify([...body.times_local].sort()),
      JSON.stringify([...body.days_of_week].sort()),
      body.timezone,
      body.start_date,
      body.end_date,
      body.deadline_minutes,
      user.userId,
      now,
    ),
    auditStatement(ctx, { actorType: "caregiver", actorId: user.userId, action: "reminder.create", targetType: "reminder", targetId: id, recipientId }),
    bumpStreamStatement(ctx, recipientId),
  ]);
  const row = await ctx.env.DB.prepare(`SELECT * FROM reminder_schedules WHERE reminder_id = ?1`).bind(id).first<ReminderRow>();
  return json({ reminder: row ? view(row) : null }, 201);
}

export async function listReminders(ctx: Ctx, user: CaregiverPrincipal, recipientId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  const rows = await ctx.env.DB.prepare(`SELECT * FROM reminder_schedules WHERE recipient_id = ?1 ORDER BY status, created_at DESC LIMIT 200`).bind(recipientId).all<ReminderRow>();
  return json({ items: rows.results.map(view) });
}

export async function updateReminder(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, reminderId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "reminders.manage");
  const body = await readJson(ctx.request, ReminderUpdateV1);
  const current = await ctx.env.DB.prepare(`SELECT * FROM reminder_schedules WHERE reminder_id = ?1 AND recipient_id = ?2`).bind(reminderId, recipientId).first<ReminderRow>();
  if (!current) throw notFound("Reminder not found.");
  if (current.status !== "active") throw conflict("reminder_cancelled", "Cancelled reminders cannot be edited.");
  if (current.version !== body.expected_version) throw conflict("version_conflict", `Reminder is at version ${current.version}.`, { reminder: view(current) });
  const merged = {
    kind: body.kind ?? current.kind,
    label: body.label ?? current.label,
    voice_message_id: body.voice_message_id === undefined ? current.voice_message_id : body.voice_message_id,
    times_local: body.times_local ?? (JSON.parse(current.times_local_json) as string[]),
    days_of_week: body.days_of_week ?? (JSON.parse(current.days_of_week_json) as number[]),
    timezone: body.timezone ?? current.timezone,
    start_date: body.start_date ?? current.start_date,
    end_date: body.end_date === undefined ? current.end_date : body.end_date,
    deadline_minutes: body.deadline_minutes ?? current.deadline_minutes,
  };
  checkSchedule(merged);
  await checkRefs(ctx, recipientId, null, merged.voice_message_id);
  const now = iso(ctx.clock.now());
  const res = await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `UPDATE reminder_schedules SET kind = ?1, label = ?2, voice_message_id = ?3, times_local_json = ?4, days_of_week_json = ?5, timezone = ?6, start_date = ?7,
         end_date = ?8, deadline_minutes = ?9, version = version + 1, updated_at = ?10 WHERE reminder_id = ?11 AND version = ?12 AND status = 'active'`,
    ).bind(
      merged.kind,
      merged.label,
      merged.voice_message_id,
      JSON.stringify([...merged.times_local].sort()),
      JSON.stringify([...merged.days_of_week].sort()),
      merged.timezone,
      merged.start_date,
      merged.end_date,
      merged.deadline_minutes,
      now,
      reminderId,
      body.expected_version,
    ),
    auditStatement(ctx, { actorType: "caregiver", actorId: user.userId, action: "reminder.update", targetType: "reminder", targetId: reminderId, recipientId }),
    bumpStreamStatement(ctx, recipientId),
  ]);
  if ((res[0]?.meta?.changes ?? 0) === 0) throw conflict("version_conflict", "Reminder changed concurrently.");
  const row = await ctx.env.DB.prepare(`SELECT * FROM reminder_schedules WHERE reminder_id = ?1`).bind(reminderId).first<ReminderRow>();
  return json({ reminder: row ? view(row) : null });
}

export async function cancelReminder(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, reminderId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "reminders.manage");
  const now = iso(ctx.clock.now());
  const res = await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE reminder_schedules SET status = 'cancelled', cancelled_at = ?1, updated_at = ?1, version = version + 1 WHERE reminder_id = ?2 AND recipient_id = ?3 AND status = 'active'`).bind(
      now,
      reminderId,
      recipientId,
    ),
    ctx.env.DB.prepare(
      `UPDATE device_commands SET status = 'cancelled', status_reason = 'reminder_cancelled', finished_at = ?1, updated_at = ?1
       WHERE source_type = 'reminder' AND source_id = ?2 AND recipient_id = ?3 AND status = 'queued'`,
    ).bind(now, reminderId, recipientId),
    ctx.env.DB.prepare(
      `UPDATE device_commands SET cancel_requested_at = COALESCE(cancel_requested_at, ?1), updated_at = ?1
       WHERE source_type = 'reminder' AND source_id = ?2 AND recipient_id = ?3 AND status IN ('delivered', 'accepted', 'started')`,
    ).bind(now, reminderId, recipientId),
    auditStatement(ctx, { actorType: "caregiver", actorId: user.userId, action: "reminder.cancel", targetType: "reminder", targetId: reminderId, recipientId }),
    bumpStreamStatement(ctx, recipientId),
  ]);
  if ((res[0]?.meta?.changes ?? 0) === 0) {
    const exists = await ctx.env.DB.prepare(`SELECT status FROM reminder_schedules WHERE reminder_id = ?1 AND recipient_id = ?2`).bind(reminderId, recipientId).first<{ status: string }>();
    if (!exists) throw notFound("Reminder not found.");
    return json({ reminder_id: reminderId, status: exists.status, duplicate: true });
  }
  return json({ reminder_id: reminderId, status: "cancelled", duplicate: false });
}

/** Occurrences of a schedule whose delivery window [t, t + deadline) contains `now`. */
export function dueOccurrences(r: Pick<ReminderRow, "times_local_json" | "days_of_week_json" | "timezone" | "start_date" | "end_date" | "deadline_minutes">, now: Date): Date[] {
  const times = JSON.parse(r.times_local_json) as string[];
  const days = new Set(JSON.parse(r.days_of_week_json) as number[]);
  const today = localDate(now, r.timezone);
  const out: Date[] = [];
  // A deadline of up to 240 min can reach back across local midnight: check today and yesterday.
  for (const date of [addDays(today, -1), today]) {
    if (date < r.start_date || (r.end_date && date > r.end_date) || !days.has(weekdayOf(date))) continue;
    for (const hhmm of times) {
      const at = zonedToUtc(date, hhmm, r.timezone);
      if (at.getTime() <= now.getTime() && now.getTime() < at.getTime() + r.deadline_minutes * 60_000) out.push(at);
    }
  }
  return out;
}

/** Cron: queue commands for due occurrences. Idempotent per occurrence. A newer occurrence supersedes an
 * older one of the same reminder that the device has not accepted yet, so a device that comes back online
 * never plays a backlog of stale reminders. */
export async function queueDueReminders(ctx: Ctx, maxStatements = 24): Promise<number> {
  const now = ctx.clock.now();
  const rows = await ctx.env.DB.prepare(
    `SELECT r.* FROM reminder_schedules r JOIN devices d ON d.device_id = r.device_id
     WHERE r.status = 'active' AND d.status = 'active' AND r.start_date <= ?1 AND (r.end_date IS NULL OR r.end_date >= ?2) LIMIT 100`,
  )
    .bind(localDate(addSeconds(now, 86_400), "UTC"), localDate(addSeconds(now, -2 * 86_400), "UTC"))
    .all<ReminderRow>();
  const statements: D1PreparedStatement[] = [];
  const insertIndexes: number[] = [];
  for (const r of rows.results) {
    for (const at of dueOccurrences(r, now)) {
      if (statements.length >= maxStatements) break;
      const key = `reminder:${r.reminder_id}:${iso(at)}`;
      const voice = r.voice_message_id
        ? await ctx.env.DB.prepare(`SELECT current_version FROM audio_assets WHERE asset_id = ?1 AND status = 'active'`).bind(r.voice_message_id).first<{ current_version: number }>()
        : null;
      insertIndexes.push(statements.length);
      statements.push(
        ...insertCommandStatements(ctx, {
          deviceId: r.device_id,
          recipientId: r.recipient_id,
          type: "reminder",
          payload: {
            reminder_id: r.reminder_id,
            kind: r.kind,
            label: r.label,
            occurrence_at: iso(at),
            voice: voice && r.voice_message_id ? { voice_message_id: r.voice_message_id, version: voice.current_version } : null,
            fallback: "default_tone",
          },
          idempotencyKey: key,
          sourceType: "reminder",
          sourceId: r.reminder_id,
          createdBy: "system",
          notBefore: at,
          expiresAt: new Date(at.getTime() + r.deadline_minutes * 60_000),
          maxDeliveryAttempts: 3,
        }).statements,
        ctx.env.DB.prepare(
          `UPDATE device_commands SET status = 'superseded', status_reason = 'newer_occurrence', finished_at = ?1, updated_at = ?1,
             superseded_by = (SELECT command_id FROM device_commands WHERE idempotency_key = ?2)
           WHERE source_type = 'reminder' AND source_id = ?3 AND status IN ('queued', 'delivered') AND not_before < ?4 AND idempotency_key != ?2`,
        ).bind(iso(now), key, r.reminder_id, iso(at)),
      );
    }
  }
  if (statements.length === 0) return 0;
  const results = await ctx.env.DB.batch(statements);
  return insertIndexes.filter((i) => (results[i]?.meta?.changes ?? 0) > 0).length;
}
