/**
 * Daily reports (path B), independent of alerts (path A).
 *
 * - One report per recipient and local calendar day, keyed UNIQUE (recipient_id, report_date); the job
 *   key daily_report:<recipient>:<date> makes repeated or overlapping cron runs harmless.
 * - The report for local day D is due at DAILY_REPORT_LOCAL_TIME (default 00:15) on D+1 in the
 *   recipient's time zone (default Asia/Ho_Chi_Minh, UTC+7: cron "15 17 * * *" UTC). The every-minute
 *   maintenance cron also ensures the latest two due days, so a missed cron run or a long agent outage
 *   still produces the report later.
 * - Statistics are computed here, deterministically, from stored records. The LLM receives them as
 *   input and may only summarise; its output is rejected if it cites unknown events or gaps, or states a
 *   number that does not appear in the input.
 * - A report is stored as completed only with a validated LLM output and the runtime's inference counters.
 */
import { requireRecipient, type CaregiverPrincipal, type Ctx } from "./context";
import type { DailyReportLlmV1 } from "./contracts";
import { badRequest, json, notFound } from "./http";
import { notifyAgents } from "./realtime";
import { addDays, isValidDate, iso, localDate, localDayPeriod, localParts, localTimeHHMM, newId } from "./util";
import type { z } from "zod";

export const REPORT_PRIORITY = 10;
const REPORT_MAX_ATTEMPTS = 6;
const MAX_NOTABLE = 60;

export interface ReportRow {
  report_id: string;
  recipient_id: string;
  report_date: string;
  timezone: string;
  period_start: string;
  period_end: string;
  status: "pending" | "completed" | "failed";
  stats_json: string | null;
  input_snapshot_sha256: string | null;
  llm_report_json: string | null;
  model_name: string | null;
  model_digest: string | null;
  inference_json: string | null;
  generated_at: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

/** Latest local date whose report is due at `now`, given the configured local release time. */
export function latestDueReportDate(now: Date, tz: string, release: { hour: number; minute: number }): string {
  const p = localParts(now, tz);
  const today = localDate(now, tz);
  const afterRelease = p.hour > release.hour || (p.hour === release.hour && p.minute >= release.minute);
  return addDays(today, afterRelease ? -1 : -2);
}

/** Creates missing report rows and jobs for the latest `days` due dates. Idempotent. */
export async function ensureDailyReportJobs(ctx: Ctx, days = 2): Promise<number> {
  const now = ctx.clock.now();
  const db = ctx.env.DB;
  const recipients = await db
    .prepare(
      `SELECT r.recipient_id, r.timezone, r.created_at FROM care_recipients r
       WHERE r.status = 'active' AND EXISTS (SELECT 1 FROM devices d WHERE d.recipient_id = r.recipient_id)`,
    )
    .all<{ recipient_id: string; timezone: string; created_at: string }>();
  const statements: D1PreparedStatement[] = [];
  for (const r of recipients.results) {
    const latest = latestDueReportDate(now, r.timezone, ctx.config.dailyReportLocalTime);
    for (let i = 0; i < days; i++) {
      const date = addDays(latest, -i);
      const period = localDayPeriod(date, r.timezone);
      if (iso(period.end) <= r.created_at) continue; // the recipient did not exist that day
      statements.push(
        db
          .prepare(
            `INSERT INTO daily_reports (report_id, recipient_id, report_date, timezone, period_start, period_end, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?7) ON CONFLICT (recipient_id, report_date) DO NOTHING`,
          )
          .bind(newId("rpt"), r.recipient_id, date, r.timezone, iso(period.start), iso(period.end), iso(now)),
        db
          .prepare(
            `INSERT INTO jobs (job_id, kind, recipient_id, report_id, idempotency_key, priority, status, payload_json, max_attempts, next_attempt_at, created_at, updated_at)
             SELECT ?1, 'daily_report', recipient_id, report_id, ?2, ?3, 'queued', '{}', ?4, ?5, ?5, ?5 FROM daily_reports
             WHERE recipient_id = ?6 AND report_date = ?7 AND status = 'pending'
             ON CONFLICT (idempotency_key) DO NOTHING`,
          )
          .bind(newId("job"), `daily_report:${r.recipient_id}:${date}`, REPORT_PRIORITY, REPORT_MAX_ATTEMPTS, iso(now), r.recipient_id, date),
      );
    }
  }
  if (statements.length === 0) return 0;
  const results = await db.batch(statements);
  const created = results.filter((res, i) => i % 2 === 1 && (res.meta?.changes ?? 0) > 0).length;
  if (created > 0) ctx.exec.waitUntil(notifyAgents(ctx.env, { type: "job_available", kind: "daily_report", priority: REPORT_PRIORITY }));
  return created;
}

/* ------------------------------------------------------------------ input snapshot */

export interface ReportInput {
  schema_version: "daily-report-input.v1";
  report_date: string;
  timezone: string;
  period_start: string;
  period_end: string;
  model_status: { fall_check: string; drink_check: string };
  stats: Record<string, Record<string, number>>;
  notable_events: Array<Record<string, unknown>>;
  notable_events_truncated: boolean;
  data_gaps: Array<{ gap_id: string; from_local: string; to_local: string; hours: number }>;
  rules: string[];
}

type CountRow = Record<string, string | number | null> & { n: number };

function count(rows: CountRow[], where: (r: CountRow) => boolean): number {
  return rows.filter(where).reduce((a, r) => a + Number(r.n), 0);
}

export async function buildReportInput(ctx: Ctx, report: ReportRow): Promise<ReportInput> {
  const db = ctx.env.DB;
  const { recipient_id: rid, period_start: start, period_end: end, timezone: tz } = report;
  const [captures, events, decisions, alerts, drinks, commands, presence] = await db.batch([
    db.prepare(`SELECT mode, status, COUNT(*) AS n FROM capture_sessions WHERE recipient_id = ?1 AND captured_at >= ?2 AND captured_at < ?3 GROUP BY mode, status`).bind(rid, start, end),
    db.prepare(`SELECT event_type, classification, COUNT(*) AS n FROM events WHERE recipient_id = ?1 AND observed_at >= ?2 AND observed_at < ?3 GROUP BY event_type, classification`).bind(rid, start, end),
    db
      .prepare(
        `SELECT d.decision_id, d.observed_at, d.status, d.case_code, d.verification_status, d.alert_id, a.status AS alert_status, a.review_outcome
         FROM fusion_decisions d LEFT JOIN alerts a ON a.alert_id = d.alert_id
         WHERE d.recipient_id = ?1 AND d.observed_at >= ?2 AND d.observed_at < ?3 ORDER BY d.observed_at`,
      )
      .bind(rid, start, end),
    db.prepare(`SELECT status, review_outcome, COUNT(*) AS n FROM alerts WHERE recipient_id = ?1 AND triggered_at >= ?2 AND triggered_at < ?3 GROUP BY status, review_outcome`).bind(rid, start, end),
    db
      .prepare(
        `SELECT event_id, observed_at, classification, verification_status FROM events WHERE recipient_id = ?1 AND event_type = 'drink_check'
           AND classification IN ('drinking_water_observed', 'medicine_observed', 'cross_window_review') AND observed_at >= ?2 AND observed_at < ?3 ORDER BY observed_at`,
      )
      .bind(rid, start, end),
    db.prepare(`SELECT command_type, status, COUNT(*) AS n FROM device_commands WHERE recipient_id = ?1 AND not_before >= ?2 AND not_before < ?3 GROUP BY command_type, status`).bind(rid, start, end),
    db
      .prepare(
        `SELECT DISTINCT p.hour_utc FROM device_presence p JOIN devices d ON d.device_id = p.device_id
         WHERE d.recipient_id = ?1 AND p.hour_utc >= ?2 AND p.hour_utc < ?3`,
      )
      .bind(rid, start.slice(0, 13), end.slice(0, 13)),
  ]);
  const cap = (captures?.results ?? []) as CountRow[];
  const ev = (events?.results ?? []) as CountRow[];
  const al = (alerts?.results ?? []) as CountRow[];
  const cmd = (commands?.results ?? []) as CountRow[];
  const dec = (decisions?.results ?? []) as Array<Record<string, string | null>>;

  const captureStats = (mode: string) => ({
    received: count(cap, (r) => r.mode === mode),
    analysed: count(cap, (r) => r.mode === mode && r.status === "processed"),
    failed: count(cap, (r) => r.mode === mode && r.status === "failed"),
    expired_unanalysed: count(cap, (r) => r.mode === mode && r.status === "expired"),
  });
  const evStats = (type: string, classes: string[]) =>
    Object.fromEntries([["total", count(ev, (r) => r.event_type === type)], ...classes.map((c) => [c, count(ev, (r) => r.event_type === type && r.classification === c)])]);
  const cmdStats = (type: string) =>
    Object.fromEntries(["queued", "delivered", "acknowledged", "playing", "completed", "failed", "expired", "cancelled"].map((s) => [s, count(cmd, (r) => r.command_type === type && r.status === s)]));

  // Hour-by-hour device contact over the local day (23–25 hours on DST days).
  const seen = new Set(((presence?.results ?? []) as Array<{ hour_utc: string }>).map((r) => r.hour_utc));
  const hours: Array<{ hourUtc: string; at: Date; seen: boolean }> = [];
  for (let t = new Date(start).getTime(); t < new Date(end).getTime(); t += 3_600_000) {
    const at = new Date(t);
    hours.push({ hourUtc: iso(at).slice(0, 13), at, seen: seen.has(iso(at).slice(0, 13)) });
  }
  const gaps: ReportInput["data_gaps"] = [];
  for (let i = 0; i < hours.length; ) {
    if (hours[i]?.seen) {
      i++;
      continue;
    }
    let j = i;
    while (j < hours.length && !hours[j]?.seen) j++;
    const from = hours[i]?.at ?? new Date(start);
    const to = hours[j]?.at ?? new Date(end);
    gaps.push({ gap_id: `g${gaps.length + 1}`, from_local: localTimeHHMM(from, tz), to_local: j >= hours.length ? "24:00" : localTimeHHMM(to, tz), hours: j - i });
    i = j;
  }

  const notable: Array<Record<string, unknown>> = [
    ...dec.map((d) => ({
      event_id: d.decision_id,
      kind: "fall_decision",
      time_local: localTimeHHMM(new Date(String(d.observed_at)), tz),
      status: d.status,
      case_code: d.case_code,
      verification_status: d.verification_status,
      alert: d.alert_id ? { status: d.alert_status, review_outcome: d.review_outcome } : null,
      _at: d.observed_at,
    })),
    ...((drinks?.results ?? []) as Array<Record<string, string>>).map((d) => ({
      event_id: d.event_id,
      kind: "drink_observation",
      time_local: localTimeHHMM(new Date(String(d.observed_at)), tz),
      status: d.classification,
      verification_status: d.verification_status,
      _at: d.observed_at,
    })),
  ].sort((a, b) => String(a._at).localeCompare(String(b._at)));
  const truncated = notable.length > MAX_NOTABLE;
  const rule = ctx.config.fusionPolicy.vision_candidate_rule;

  return {
    schema_version: "daily-report-input.v1",
    report_date: report.report_date,
    timezone: tz,
    period_start: start,
    period_end: end,
    model_status: {
      fall_check: rule ? `candidate rule ${rule.rule_version} (${rule.calibration})` : "NOT_CALIBRATED: điểm mô hình ngã chưa hiệu chỉnh, không kết luận ngã",
      drink_check: "UNCALIBRATED: nhãn uống nước/thuốc là quan sát AI chưa xác nhận",
    },
    stats: {
      captures_normal: captureStats("normal"),
      captures_triggered: captureStats("triggered"),
      fall_checks: evStats("fall_check", ["uncalibrated_output", "fall_candidate", "below_candidate_rule", "not_enough_data"]),
      drink_checks: evStats("drink_check", ["drinking_water_observed", "medicine_observed", "cross_window_review", "none_observed", "not_enough_data"]),
      imu_triggers: { total: count(ev, (r) => r.event_type === "imu_trigger") },
      fall_decisions: {
        total: dec.length,
        suspected_fall: dec.filter((d) => d.status === "suspected_fall").length,
        needs_review: dec.filter((d) => d.status === "needs_review").length,
        not_enough_data: dec.filter((d) => d.status === "not_enough_data").length,
        verified_by_caregiver: dec.filter((d) => d.verification_status === "verified").length,
        dismissed_by_caregiver: dec.filter((d) => d.verification_status === "dismissed").length,
        unverified: dec.filter((d) => d.verification_status === "unverified").length,
      },
      alerts: {
        raised: count(al, () => true),
        not_resolved: count(al, (r) => r.status !== "resolved"),
        resolved_confirmed: count(al, (r) => r.review_outcome === "confirmed"),
        resolved_false_alarm: count(al, (r) => r.review_outcome === "false_alarm"),
        resolved_uncertain: count(al, (r) => r.review_outcome === "uncertain"),
      },
      reminder_commands: cmdStats("reminder"),
      voice_message_commands: cmdStats("play_voice_message"),
      emergency_buzzer_commands: cmdStats("emergency_buzzer"),
      coverage: { hours_in_day: hours.length, hours_with_device_contact: hours.filter((h) => h.seen).length, hours_without_device_contact: hours.filter((h) => !h.seen).length },
    },
    notable_events: notable.slice(0, MAX_NOTABLE).map(({ _at: _ignored, ...rest }) => rest),
    notable_events_truncated: truncated,
    data_gaps: gaps,
    rules: [
      "Chỉ dùng số liệu trong stats; không tự cộng, ước lượng hay suy ra số mới.",
      "Mọi nhận định AI là chưa được xác nhận; không gọi nghi ngã là ngã đã xảy ra.",
      "Không chẩn đoán, không khuyên điều trị.",
      "Khoảng không có liên lạc thiết bị là thiếu dữ liệu, không phải bình thường.",
    ],
  };
}

/* ------------------------------------------------------------------ output validation */

function numbersIn(value: unknown, out: Set<number>): void {
  if (typeof value === "number" && Number.isFinite(value)) out.add(Math.abs(Math.trunc(value)));
  else if (typeof value === "string") for (const m of value.match(/\d+/g) ?? []) out.add(Number(m));
  else if (Array.isArray(value)) for (const v of value) numbersIn(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) numbersIn(v, out);
}

/** Problems with an LLM report; empty when acceptable. Numbers in the prose must appear in the input
 * (counts, times, dates), so the model cannot introduce counts the backend did not compute. */
export function validateReportOutput(report: z.infer<typeof DailyReportLlmV1>, input: ReportInput): string[] {
  const problems: string[] = [];
  const eventIds = new Set(input.notable_events.map((e) => String(e.event_id)));
  const unverified = new Set(input.notable_events.filter((e) => e.verification_status === "unverified").map((e) => String(e.event_id)));
  const gapIds = new Set(input.data_gaps.map((g) => g.gap_id));
  for (const id of report.source_event_ids) if (!eventIds.has(id)) problems.push(`unknown source_event_id ${id}`);
  for (const n of report.notable_events) if (!eventIds.has(n.event_id)) problems.push(`unknown notable event ${n.event_id}`);
  for (const n of report.unverified_items) if (!unverified.has(n.event_id)) problems.push(`unverified_items lists ${n.event_id}, which is not an unverified input event`);
  for (const g of report.data_gaps) if (!gapIds.has(g.gap_id)) problems.push(`unknown gap ${g.gap_id}`);
  const cited = new Set([...report.notable_events.map((n) => n.event_id), ...report.unverified_items.map((n) => n.event_id)]);
  for (const id of cited) if (!report.source_event_ids.includes(id)) problems.push(`event ${id} is cited but missing from source_event_ids`);

  const allowed = new Set<number>([0, 24]);
  numbersIn(input.stats, allowed);
  numbersIn(input.data_gaps, allowed);
  numbersIn(input.notable_events.map((e) => e.time_local), allowed);
  numbersIn(input.report_date, allowed);
  numbersIn(input.report_date.split("-").map(Number), allowed);
  const prose = [report.summary_vi, ...report.notable_events.map((n) => n.note_vi), ...report.unverified_items.map((n) => n.note_vi), ...report.data_gaps.map((g) => g.note_vi)];
  const stated = new Set<number>();
  numbersIn(prose, stated);
  const unknown = [...stated].filter((n) => !allowed.has(n));
  if (unknown.length > 0) problems.push(`numbers not present in the input: ${unknown.slice(0, 10).join(", ")}`);
  return problems;
}

/* ------------------------------------------------------------------ caregiver routes */

function reportView(r: ReportRow, full: boolean): Record<string, unknown> {
  const base: Record<string, unknown> = {
    report_id: r.report_id,
    report_date: r.report_date,
    timezone: r.timezone,
    period_start: r.period_start,
    period_end: r.period_end,
    status: r.status,
    failure_code: r.failure_code,
    generated_at: r.generated_at,
  };
  if (!full) return base;
  return {
    ...base,
    stats: r.stats_json ? JSON.parse(r.stats_json) : null,
    ai_summary: r.llm_report_json
      ? { ...(JSON.parse(r.llm_report_json) as object), label_vi: "Tóm tắt do AI cục bộ tạo, chưa được con người xác nhận." }
      : null,
    model: r.model_name ? { name: r.model_name, digest: r.model_digest, inference: r.inference_json ? JSON.parse(r.inference_json) : null } : null,
  };
}

export async function listReports(ctx: Ctx, user: CaregiverPrincipal, recipientId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  const from = ctx.url.searchParams.get("from") ?? "0000-01-01";
  const to = ctx.url.searchParams.get("to") ?? "9999-12-31";
  if ((from !== "0000-01-01" && !isValidDate(from)) || (to !== "9999-12-31" && !isValidDate(to))) throw badRequest("invalid_date", "from/to must be YYYY-MM-DD.");
  const rows = await ctx.env.DB.prepare(
    `SELECT * FROM daily_reports WHERE recipient_id = ?1 AND report_date >= ?2 AND report_date <= ?3 ORDER BY report_date DESC LIMIT 62`,
  )
    .bind(recipientId, from, to)
    .all<ReportRow>();
  return json({ items: rows.results.map((r) => reportView(r, false)) });
}

export async function getReport(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, date: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  if (!isValidDate(date)) throw badRequest("invalid_date", "date must be YYYY-MM-DD.");
  const row = await ctx.env.DB.prepare(`SELECT * FROM daily_reports WHERE recipient_id = ?1 AND report_date = ?2`).bind(recipientId, date).first<ReportRow>();
  if (!row) throw notFound("No report for this date.");
  return json({ report: reportView(row, true) });
}
