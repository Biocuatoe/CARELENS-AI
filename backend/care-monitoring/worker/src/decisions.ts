/**
 * When fusion decisions are made.
 *
 * A decision unit is either a firmware trigger (dedup key trigger:<event>) or, when no trigger is involved,
 * a camera burst whose fall check or raw IMU window contains a candidate (dedup key capture:<capture_pk>).
 * A unit is decided once its evidence is final:
 *
 * - vision: the designated burst (linked by trigger_id/capture_id) has a stored fall check, or failed, or the
 *   trigger's grace period (imu_decision_grace_seconds) ran out;
 * - raw IMU: the burst window is covered by imu-batch.v1 samples, or imu_wait_seconds passed after the burst.
 *
 * Re-evaluation happens on every new fall check, every new IMU batch that overlaps a pending unit, and in the
 * minute cron. Evidence is only ever aligned on the monotonic clock of one boot.
 */
import type { CaptureRow } from "./captures";
import { guardStatement, isGuardFailure, type Ctx } from "./context";
import {
  decide,
  evaluateImu,
  planDecision,
  type ImuEvidence,
  type ImuSample,
  type ImuWindowData,
  type TriggerInfo,
  type UptimeWindow,
  type VisionEvidence,
  type VisionState,
} from "./fusion";
import { notifyRecipient } from "./realtime";
import { addSeconds, iso } from "./util";

export interface TriggerEventRow {
  event_id: string;
  device_id: string;
  recipient_id: string;
  trigger_id: string;
  capture_id: string | null;
  boot_id: string;
  uptime_from_ms: number;
  observed_at: string;
  received_at: string;
  label: string | null;
  evidence_json: string;
}

export interface FallEventRow {
  event_id: string;
  device_id: string;
  recipient_id: string;
  capture_pk: string;
  classification: string;
  calibration_status: "not_calibrated" | "calibrated" | "uncalibrated_trial" | "not_applicable";
  model_score: number | null;
  boot_id: string;
  uptime_from_ms: number;
  uptime_until_ms: number;
  observed_at: string;
  observed_until: string | null;
  received_at: string;
  fusion_status: string;
  evidence_json: string;
}

/* ------------------------------------------------------------------ evidence */

export function visionStateOf(classification: string, fallStatus: string | null): VisionState {
  switch (classification) {
    case "fall_candidate":
      return "candidate";
    case "below_candidate_rule":
      return "below_rule";
    case "uncalibrated_output":
      return "uncalibrated";
    default:
      return fallStatus === "failed" ? "failed" : "missing";
  }
}

export function visionFromFallEvent(e: FallEventRow): VisionEvidence {
  const evidence = JSON.parse(e.evidence_json) as { status?: string; reason?: string | null; rule_version?: string | null };
  const state = visionStateOf(e.classification, evidence.status ?? null);
  return {
    state,
    eventId: e.event_id,
    capturePk: e.capture_pk,
    classification: e.classification,
    calibrationStatus: e.calibration_status === "not_applicable" ? "not_calibrated" : e.calibration_status,
    aggregateScore: e.model_score,
    ruleVersion: evidence.rule_version ?? null,
    window: { bootId: e.boot_id, from: e.uptime_from_ms, until: e.uptime_until_ms },
    observedFrom: new Date(e.observed_at),
    observedUntil: e.observed_until ? new Date(e.observed_until) : new Date(e.observed_at),
    missingReason: state === "missing" || state === "failed" ? `fall_check_${evidence.status ?? "not_run"}${evidence.reason ? `:${evidence.reason}` : ""}` : null,
  };
}

/** Vision evidence of a burst that produced no fall check (or of no burst at all). */
export function visionWithoutResult(capture: CaptureRow | undefined): VisionEvidence {
  const failed = capture !== undefined && (capture.status === "failed" || capture.status === "expired");
  return {
    state: failed ? "failed" : "missing",
    eventId: null,
    capturePk: capture?.capture_pk ?? null,
    classification: null,
    calibrationStatus: "not_calibrated",
    aggregateScore: null,
    ruleVersion: null,
    window: capture ? captureWindow(capture) : null,
    observedFrom: capture ? new Date(capture.captured_at) : null,
    observedUntil: capture ? new Date(capture.captured_until) : null,
    missingReason: capture ? `capture_${capture.status}${capture.failure_code ? `:${capture.failure_code}` : ""}` : "no_capture_received",
  };
}

export function captureWindow(c: Pick<CaptureRow, "boot_id" | "first_uptime_ms" | "last_uptime_ms">): UptimeWindow {
  return { bootId: c.boot_id, from: c.first_uptime_ms, until: c.last_uptime_ms };
}

interface BatchRow {
  batch_pk: string;
  sample_rate_hz: number;
  samples_json: string;
}

/** Raw samples of one boot between two uptimes, merged across batches (duplicates by timestamp dropped). */
export async function loadImuWindow(ctx: Ctx, deviceId: string, bootId: string, from: number, until: number): Promise<ImuWindowData | null> {
  const rows = await ctx.env.DB.prepare(
    `SELECT batch_pk, sample_rate_hz, samples_json FROM imu_batches
     WHERE device_id = ?1 AND boot_id = ?2 AND last_uptime_ms >= ?3 AND first_uptime_ms <= ?4 ORDER BY first_uptime_ms LIMIT 60`,
  )
    .bind(deviceId, bootId, from, until)
    .all<BatchRow>();
  if (rows.results.length === 0) return null;
  const byTime = new Map<number, ImuSample>();
  let rate = 0;
  for (const b of rows.results) {
    rate = Math.max(rate, b.sample_rate_hz);
    const s = JSON.parse(b.samples_json) as Record<"uptime_ms" | "ax" | "ay" | "az" | "gx" | "gy" | "gz", number[]>;
    s.uptime_ms.forEach((t, i) => {
      if (t < from || t > until || byTime.has(t)) return;
      byTime.set(t, { t, ax: s.ax[i] ?? 0, ay: s.ay[i] ?? 0, az: s.az[i] ?? 0, gx: s.gx[i] ?? 0, gy: s.gy[i] ?? 0, gz: s.gz[i] ?? 0 });
    });
  }
  return { bootId, samples: [...byTime.values()].sort((a, b) => a.t - b.t), nominalRateHz: rate, batchIds: rows.results.map((b) => b.batch_pk) };
}

export async function imuEvidenceFor(ctx: Ctx, deviceId: string, core: UptimeWindow): Promise<ImuEvidence> {
  const p = ctx.config.fusionPolicy;
  const data = await loadImuWindow(ctx, deviceId, core.bootId, core.from - p.imu_search_margin_ms, core.until + p.imu_search_margin_ms);
  return evaluateImu(data, core, p);
}

export function imuFinal(imu: ImuEvidence): boolean {
  return imu.state !== "missing" && imu.state !== "insufficient_coverage";
}

/** Raw IMU for a burst may still be on its way until imu_wait_seconds after the burst ended. */
export function imuWaitOver(ctx: Ctx, capture: Pick<CaptureRow, "captured_until"> | undefined): boolean {
  if (!capture) return true;
  return ctx.clock.now().getTime() >= new Date(capture.captured_until).getTime() + ctx.config.fusionPolicy.imu_wait_seconds * 1000;
}

export function triggerInfo(t: TriggerEventRow): TriggerInfo {
  return { eventId: t.event_id, triggerId: t.trigger_id, triggerType: t.label ?? "other", bootId: t.boot_id, uptimeMs: t.uptime_from_ms, at: new Date(t.observed_at) };
}

/* ------------------------------------------------------------------ units */

export async function recipientTimezone(ctx: Ctx, recipientId: string): Promise<string> {
  const row = await ctx.env.DB.prepare(`SELECT timezone FROM care_recipients WHERE recipient_id = ?1`).bind(recipientId).first<{ timezone: string }>();
  return row?.timezone ?? ctx.config.reportTimezone;
}

/** A burst is "designated" for a trigger when the device linked them (capture.trigger_id or the trigger's
 * capture_id). Only a designated burst, or the grace period running out, closes a trigger; any other burst
 * in the time window may decide early only when that raises an alert. This keeps a routine burst that
 * happens to overlap the trigger from pre-empting the burst recorded for it. */
export function isDesignated(c: Pick<CaptureRow, "trigger_id" | "capture_id">, t: Pick<TriggerEventRow, "trigger_id" | "capture_id">): boolean {
  return c.trigger_id === t.trigger_id || (t.capture_id !== null && c.capture_id === t.capture_id);
}

const inProgress = (c: CaptureRow) => c.status === "receiving" || c.status === "uploaded" || c.status === "processing";

async function commit(ctx: Ctx, guard: D1PreparedStatement, plan: Awaited<ReturnType<typeof planDecision>>, recipientId: string): Promise<"decided" | "retry"> {
  try {
    await ctx.env.DB.batch([guard, ...plan.statements]);
    ctx.exec.waitUntil(notifyRecipient(ctx.env, recipientId, plan.alertCreated ? "alert.created" : "decision.created", plan.alertId ?? plan.decisionId));
    return "decided";
  } catch (err) {
    if (isGuardFailure(err)) return "decided";
    if (err instanceof Error && /UNIQUE/i.test(err.message)) return "retry";
    throw err;
  }
}

/** Decides a pending firmware trigger once its evidence is final (see the module comment). */
export async function tryDecideTrigger(ctx: Ctx, t: TriggerEventRow, graceExpired: boolean): Promise<"decided" | "waiting"> {
  const db = ctx.env.DB;
  const policy = ctx.config.fusionPolicy;
  const corr = policy.correlation_window_seconds * 1000;
  const captures = await db
    .prepare(
      `SELECT * FROM capture_sessions WHERE device_id = ?1
         AND (trigger_id = ?2 OR capture_id = ?3 OR (boot_id = ?4 AND first_uptime_ms <= ?6 AND last_uptime_ms >= ?5))
       ORDER BY CASE WHEN trigger_id = ?2 THEN 0 ELSE 1 END, first_uptime_ms LIMIT 8`,
    )
    .bind(t.device_id, t.trigger_id, t.capture_id, t.boot_id, t.uptime_from_ms - corr, t.uptime_from_ms + corr)
    .all<CaptureRow>();
  const designated = captures.results.filter((c) => isDesignated(c, t));
  const fallOf = async (list: CaptureRow[]): Promise<FallEventRow | null> => {
    const ids = list.filter((c) => c.status === "processed").map((c) => c.capture_pk);
    if (ids.length === 0) return null;
    return db
      .prepare(`SELECT * FROM events WHERE event_type = 'fall_check' AND capture_pk IN (${ids.map((_, i) => `?${i + 1}`).join(", ")}) ORDER BY uptime_from_ms LIMIT 1`)
      .bind(...ids)
      .first<FallEventRow>();
  };

  let vision: VisionEvidence;
  let capture: CaptureRow | undefined;
  let earlyOnly = false;
  if (designated.length > 0) {
    if (designated.some(inProgress)) return "waiting";
    const fall = await fallOf(designated);
    capture = fall ? designated.find((c) => c.capture_pk === fall.capture_pk) : (designated.find((c) => c.status === "failed" || c.status === "expired") ?? designated[0]);
    vision = fall ? visionFromFallEvent(fall) : visionWithoutResult(capture);
  } else {
    const fall = await fallOf(captures.results);
    if (fall) {
      capture = captures.results.find((c) => c.capture_pk === fall.capture_pk);
      vision = visionFromFallEvent(fall);
    } else {
      if (!graceExpired || captures.results.some(inProgress)) return "waiting";
      capture = captures.results.find((c) => c.status === "failed" || c.status === "expired");
      vision = visionWithoutResult(capture);
    }
    // Without a designated burst, close the trigger before the grace period only on an alert.
    earlyOnly = !graceExpired;
  }
  const core = vision.window ?? { bootId: t.boot_id, from: t.uptime_from_ms - policy.alignment_tolerance_ms, until: t.uptime_from_ms + policy.alignment_tolerance_ms };
  const imu = await imuEvidenceFor(ctx, t.device_id, core);
  const visionUsable = vision.state !== "missing" && vision.state !== "failed";
  if (visionUsable && !imuFinal(imu) && !graceExpired && !imuWaitOver(ctx, capture)) return "waiting";
  const trigger = triggerInfo(t);
  const outcome = decide(policy, { trigger, vision, imu });
  if (!outcome || (earlyOnly && !outcome.raiseAlert)) return "waiting";
  const tz = await recipientTimezone(ctx, t.recipient_id);
  for (let attempt = 0; attempt < 2; attempt++) {
    const plan = await planDecision(ctx, { recipientId: t.recipient_id, deviceId: t.device_id, timezone: tz, trigger, vision, imu, outcome });
    const result = await commit(ctx, guardStatement(db, `SELECT 1 FROM events WHERE event_id = ?1 AND fusion_status = 'pending'`, t.event_id), plan, t.recipient_id);
    if (result === "decided") return "decided";
  }
  return "waiting";
}

/** Decides a burst whose fall check is waiting for raw IMU (events.fusion_status = 'pending'). */
export async function tryDecideCapture(ctx: Ctx, e: FallEventRow, graceExpired: boolean): Promise<"decided" | "waiting"> {
  const db = ctx.env.DB;
  const capture = (await db.prepare(`SELECT * FROM capture_sessions WHERE capture_pk = ?1`).bind(e.capture_pk).first<CaptureRow>()) ?? undefined;
  const vision = visionFromFallEvent(e);
  const imu = await imuEvidenceFor(ctx, e.device_id, vision.window as UptimeWindow);
  if (!imuFinal(imu) && !graceExpired && !imuWaitOver(ctx, capture)) return "waiting";
  const outcome = decide(ctx.config.fusionPolicy, { trigger: null, vision, imu });
  if (!outcome) {
    await db.prepare(`UPDATE events SET fusion_status = 'not_applicable' WHERE event_id = ?1 AND fusion_status = 'pending'`).bind(e.event_id).run();
    return "decided";
  }
  const tz = await recipientTimezone(ctx, e.recipient_id);
  for (let attempt = 0; attempt < 2; attempt++) {
    const plan = await planDecision(ctx, { recipientId: e.recipient_id, deviceId: e.device_id, timezone: tz, trigger: null, vision, imu, outcome });
    const result = await commit(ctx, guardStatement(db, `SELECT 1 FROM events WHERE event_id = ?1 AND fusion_status = 'pending'`, e.event_id), plan, e.recipient_id);
    if (result === "decided") return "decided";
  }
  return "waiting";
}

/** A burst whose vision job ended without a result and that no trigger claims: decide only if its raw IMU
 * window holds a candidate (the outcome is then processing_failed). Idempotent via the dedup key. */
export async function decideFailedCapture(ctx: Ctx, capture: CaptureRow): Promise<boolean> {
  if (!ctx.config.fusionPolicy.imu_candidate_rule) return false;
  const vision = visionWithoutResult(capture);
  const imu = await imuEvidenceFor(ctx, capture.device_id, captureWindow(capture));
  const outcome = decide(ctx.config.fusionPolicy, { trigger: null, vision, imu });
  if (!outcome) return false;
  const tz = await recipientTimezone(ctx, capture.recipient_id);
  const plan = await planDecision(ctx, { recipientId: capture.recipient_id, deviceId: capture.device_id, timezone: tz, trigger: null, vision, imu, outcome });
  const guard = guardStatement(ctx.env.DB, `SELECT 1 FROM capture_sessions WHERE capture_pk = ?1 AND NOT EXISTS (SELECT 1 FROM fusion_decisions WHERE dedup_key = ?2)`, capture.capture_pk, `capture:${capture.capture_pk}`);
  return (await commit(ctx, guard, plan, capture.recipient_id)) === "decided";
}

/** Pending triggers that a burst may settle: linked by id, or on the same boot within the correlation window. */
export async function pendingTriggersFor(ctx: Ctx, c: Pick<CaptureRow, "device_id" | "trigger_id" | "capture_id" | "boot_id" | "first_uptime_ms" | "last_uptime_ms">): Promise<TriggerEventRow[]> {
  const corr = ctx.config.fusionPolicy.correlation_window_seconds * 1000;
  const res = await ctx.env.DB.prepare(
    `SELECT * FROM events WHERE device_id = ?1 AND event_type = 'imu_trigger' AND fusion_status = 'pending'
       AND ((?2 IS NOT NULL AND trigger_id = ?2) OR capture_id = ?3 OR (boot_id = ?4 AND uptime_from_ms >= ?5 AND uptime_from_ms <= ?6))
     ORDER BY uptime_from_ms LIMIT 10`,
  )
    .bind(c.device_id, c.trigger_id, c.capture_id, c.boot_id, c.first_uptime_ms - corr, c.last_uptime_ms + corr)
    .all<TriggerEventRow>();
  return res.results;
}

/** New raw IMU arrived: re-evaluate pending units of the same boot whose window it may complete. */
export async function reevaluateForImu(ctx: Ctx, deviceId: string, bootId: string, from: number, until: number): Promise<number> {
  const p = ctx.config.fusionPolicy;
  const margin = p.imu_search_margin_ms + p.correlation_window_seconds * 1000;
  const db = ctx.env.DB;
  const [triggers, falls] = await db.batch([
    db
      .prepare(
        `SELECT * FROM events WHERE device_id = ?1 AND boot_id = ?2 AND event_type = 'imu_trigger' AND fusion_status = 'pending'
           AND uptime_from_ms >= ?3 AND uptime_from_ms <= ?4 ORDER BY uptime_from_ms LIMIT 3`,
      )
      .bind(deviceId, bootId, from - margin, until + margin),
    db
      .prepare(
        `SELECT * FROM events WHERE device_id = ?1 AND boot_id = ?2 AND event_type = 'fall_check' AND fusion_status = 'pending'
           AND uptime_until_ms >= ?3 AND uptime_from_ms <= ?4 ORDER BY uptime_from_ms LIMIT 3`,
      )
      .bind(deviceId, bootId, from - margin, until + margin),
  ]);
  let decided = 0;
  for (const t of (triggers?.results ?? []) as unknown as TriggerEventRow[]) if ((await tryDecideTrigger(ctx, t, false)) === "decided") decided++;
  for (const e of (falls?.results ?? []) as unknown as FallEventRow[]) if ((await tryDecideCapture(ctx, e, false)) === "decided") decided++;
  return decided;
}

/** Cron: decide triggers whose grace period passed and bursts whose IMU wait passed. */
export async function decideOverdue(ctx: Ctx): Promise<number> {
  const p = ctx.config.fusionPolicy;
  const now = ctx.clock.now();
  const db = ctx.env.DB;
  const [triggers, falls] = await db.batch([
    db
      .prepare(`SELECT * FROM events WHERE fusion_status = 'pending' AND event_type = 'imu_trigger' AND received_at <= ?1 ORDER BY received_at LIMIT 3`)
      .bind(iso(addSeconds(now, -p.imu_decision_grace_seconds))),
    db
      .prepare(`SELECT * FROM events WHERE fusion_status = 'pending' AND event_type = 'fall_check' AND observed_until <= ?1 ORDER BY received_at LIMIT 3`)
      .bind(iso(addSeconds(now, -p.imu_wait_seconds))),
  ]);
  let decided = 0;
  for (const t of (triggers?.results ?? []) as unknown as TriggerEventRow[]) if ((await tryDecideTrigger(ctx, t, true)) === "decided") decided++;
  for (const e of (falls?.results ?? []) as unknown as FallEventRow[]) if ((await tryDecideCapture(ctx, e, true)) === "decided") decided++;
  return decided;
}
