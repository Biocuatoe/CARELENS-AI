/**
 * Sensor fusion: a transparent rule engine (fusion-rules.v2) over three inputs of one device boot:
 *
 * - vision evidence: the fall check of a camera burst (an uncalibrated logit unless an owner-approved
 *   candidate rule applies);
 * - raw IMU evidence: accelerometer and gyroscope samples the backend itself evaluates over the burst's
 *   window (coverage, a sensor-fault check, and an owner-approved candidate rule if one is configured);
 * - optionally a firmware trigger, which may start a decision but is never evidence: its type and
 *   device_metrics are recorded and ignored.
 *
 * Outcomes: suspected_fall (only when both rules matched and the IMU match lies inside the burst window
 * ± alignment_tolerance_ms), needs_review, not_enough_data, no_fall_detected (both rules below
 * threshold — never presented as "safe"), processing_failed (vision job failed, or the IMU signal is
 * frozen). Only suspected_fall raises a provisional alert. Nothing here is ever a confirmed fall: a
 * caregiver sets verified/dismissed. Alerts never wait for, or call, the daily-report LLM.
 */
import { auditStatement, bumpStreamStatement, type Ctx } from "./context";
import { emergencyBuzzerStatements } from "./commands";
import type { FusionPolicy } from "./env";
import { addSeconds, iso, localTimeHHMM, newId } from "./util";

export type FusionStatus = "suspected_fall" | "needs_review" | "not_enough_data" | "no_fall_detected" | "processing_failed";

/** A window on one boot's monotonic clock (ms since boot), inclusive. */
export interface UptimeWindow {
  bootId: string;
  from: number;
  until: number;
}

export interface ImuSample {
  t: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
}

export interface ImuWindowData {
  bootId: string;
  /** Sorted by t, one sample per t. */
  samples: ImuSample[];
  nominalRateHz: number;
  batchIds: string[];
}

export type ImuState = "candidate" | "below_rule" | "rule_not_configured" | "insufficient_coverage" | "missing" | "sensor_fault";

export interface ImuEvidence {
  state: ImuState;
  /** candidate only: true when the match lies inside the burst window ± alignment tolerance. */
  aligned: boolean | null;
  window: UptimeWindow;
  coverage: { samples: number; expected: number; ratio: number; max_gap_ms: number } | null;
  features: {
    peak_accel_magnitude_g: number;
    min_accel_magnitude_g: number;
    peak_gyro_magnitude_dps: number;
    peak_accel_uptime_ms: number;
  } | null;
  matchUptimeMs: number | null;
  ruleVersion: string | null;
  calibration: "calibrated" | "uncalibrated_trial" | null;
  batchIds: string[];
  reasons: string[];
}

export type VisionState = "candidate" | "below_rule" | "uncalibrated" | "missing" | "failed";

export interface VisionEvidence {
  state: VisionState;
  eventId: string | null;
  capturePk: string | null;
  classification: string | null;
  calibrationStatus: "not_calibrated" | "calibrated" | "uncalibrated_trial";
  aggregateScore: number | null;
  ruleVersion: string | null;
  window: UptimeWindow | null;
  observedFrom: Date | null;
  observedUntil: Date | null;
  missingReason: string | null;
}

export interface TriggerInfo {
  eventId: string;
  triggerId: string;
  triggerType: string;
  bootId: string | null;
  uptimeMs: number | null;
  at: Date;
}

export type CaseCode =
  | "aligned_candidates"
  | "candidates_not_aligned"
  | "conflicting_evidence"
  | "vision_rule_not_configured"
  | "imu_rule_not_configured"
  | "rules_not_configured"
  | "both_below_rules"
  | "vision_missing"
  | "imu_missing"
  | "imu_insufficient_coverage"
  | "vision_processing_failed"
  | "imu_sensor_fault";

export interface FusionOutcome {
  caseCode: CaseCode;
  status: FusionStatus;
  raiseAlert: boolean;
  reasons: string[];
  trialRule: boolean;
}

const r4 = (v: number) => Number(v.toFixed(4));

/** Data-quality flag, not a fall measure: a real MEMS sensor always shows noise, so identical readings on
 * all six axes over a whole window mean a frozen register or a dead bus. */
function frozen(samples: ImuSample[]): boolean {
  if (samples.length < 10) return false;
  const first = samples[0] as ImuSample;
  return samples.every((s) => s.ax === first.ax && s.ay === first.ay && s.az === first.az && s.gx === first.gx && s.gy === first.gy && s.gz === first.gz);
}

/** Evaluates raw IMU samples against the burst window `core`. Pure; no I/O. */
export function evaluateImu(data: ImuWindowData | null, core: UptimeWindow, policy: FusionPolicy): ImuEvidence {
  const base: ImuEvidence = {
    state: "missing",
    aligned: null,
    window: core,
    coverage: null,
    features: null,
    matchUptimeMs: null,
    ruleVersion: policy.imu_candidate_rule?.rule_version ?? null,
    calibration: policy.imu_candidate_rule?.calibration ?? null,
    batchIds: data?.batchIds ?? [],
    reasons: [],
  };
  if (!data || data.bootId !== core.bootId) return { ...base, reasons: ["no_raw_imu_samples_for_this_boot_and_window"] };
  const tol = policy.alignment_tolerance_ms;
  const inCore = data.samples.filter((s) => s.t >= core.from && s.t <= core.until);
  const nearCore = data.samples.filter((s) => s.t >= core.from - tol && s.t <= core.until + tol);
  if (inCore.length === 0) return { ...base, reasons: ["no_raw_imu_samples_inside_burst_window"] };

  const expected = Math.floor(((core.until - core.from) * data.nominalRateHz) / 1000) + 1;
  let maxGap = Math.max((inCore[0] as ImuSample).t - core.from, core.until - (inCore[inCore.length - 1] as ImuSample).t);
  for (let i = 1; i < inCore.length; i++) maxGap = Math.max(maxGap, (inCore[i] as ImuSample).t - (inCore[i - 1] as ImuSample).t);
  const ratio = Math.min(1, inCore.length / Math.max(1, expected));
  const coverage = { samples: inCore.length, expected, ratio: r4(ratio), max_gap_ms: maxGap };

  let peakA = -1;
  let peakAt = core.from;
  let minA = Infinity;
  let peakG = 0;
  for (const s of nearCore) {
    const a = Math.hypot(s.ax, s.ay, s.az);
    const g = Math.hypot(s.gx, s.gy, s.gz);
    if (a > peakA) {
      peakA = a;
      peakAt = s.t;
    }
    minA = Math.min(minA, a);
    peakG = Math.max(peakG, g);
  }
  const features = {
    peak_accel_magnitude_g: r4(peakA),
    min_accel_magnitude_g: r4(minA),
    peak_gyro_magnitude_dps: Number(peakG.toFixed(3)),
    peak_accel_uptime_ms: peakAt,
  };
  const withData = { ...base, coverage, features };
  if (frozen(nearCore)) return { ...withData, state: "sensor_fault", reasons: ["identical_readings_on_all_axes"] };
  if (ratio < policy.imu_min_coverage_ratio || maxGap > policy.imu_max_gap_ms) {
    return { ...withData, state: "insufficient_coverage", reasons: [`coverage_ratio:${coverage.ratio}`, `max_gap_ms:${maxGap}`] };
  }
  const rule = policy.imu_candidate_rule;
  if (!rule) return { ...withData, state: "rule_not_configured", reasons: ["no_owner_approved_imu_rule"] };

  /** First time at which every configured condition has been met within `samples` (or null). */
  const match = (samples: ImuSample[]): number | null => {
    let accelAt: number | null = rule.min_peak_accel_g === null ? -Infinity : null;
    let dipAt: number | null = rule.max_min_accel_g === null ? -Infinity : null;
    let gyroAt: number | null = rule.min_peak_gyro_dps === null ? -Infinity : null;
    for (const s of samples) {
      const a = Math.hypot(s.ax, s.ay, s.az);
      if (accelAt === null && rule.min_peak_accel_g !== null && a >= rule.min_peak_accel_g) accelAt = s.t;
      if (dipAt === null && rule.max_min_accel_g !== null && a <= rule.max_min_accel_g) dipAt = s.t;
      if (gyroAt === null && rule.min_peak_gyro_dps !== null && Math.hypot(s.gx, s.gy, s.gz) >= rule.min_peak_gyro_dps) gyroAt = s.t;
      if (accelAt !== null && dipAt !== null && gyroAt !== null) return s.t;
    }
    return null;
  };
  const inside = match(nearCore);
  if (inside !== null) return { ...withData, state: "candidate", aligned: true, matchUptimeMs: inside, reasons: [`imu_rule_matched:${rule.rule_version}`] };
  const outside = match(data.samples.filter((s) => s.t < core.from - tol || s.t > core.until + tol));
  if (outside !== null) {
    return { ...withData, state: "candidate", aligned: false, matchUptimeMs: outside, reasons: [`imu_rule_matched_outside_burst_window:${rule.rule_version}`] };
  }
  return { ...withData, state: "below_rule", reasons: [`imu_below_rule:${rule.rule_version}`] };
}

/** Pure decision function. Returns null when nothing started a decision: no firmware trigger, no vision
 * candidate and no IMU candidate (a routine burst stays a plain evidence event). */
export function decide(policy: FusionPolicy, input: { trigger: TriggerInfo | null; vision: VisionEvidence; imu: ImuEvidence }): FusionOutcome | null {
  const { trigger, vision, imu } = input;
  if (!trigger && vision.state !== "candidate" && imu.state !== "candidate") return null;
  const reasons: string[] = [];
  if (trigger) {
    reasons.push(`firmware_trigger_reported:${trigger.triggerType}`);
    if (vision.window && trigger.bootId === vision.window.bootId && trigger.uptimeMs !== null) {
      const inside = trigger.uptimeMs >= vision.window.from - policy.alignment_tolerance_ms && trigger.uptimeMs <= vision.window.until + policy.alignment_tolerance_ms;
      reasons.push(inside ? "firmware_trigger_inside_burst_window" : "firmware_trigger_outside_burst_window");
    }
  }
  reasons.push(`vision:${vision.state}${vision.missingReason ? `:${vision.missingReason}` : ""}`);
  reasons.push(`imu:${imu.state}${imu.aligned === false ? ":not_aligned" : ""}`);
  const trialRule = vision.calibrationStatus === "uncalibrated_trial" || (imu.state === "candidate" && imu.calibration === "uncalibrated_trial");
  const out = (caseCode: CaseCode, status: FusionStatus): FusionOutcome => ({ caseCode, status, raiseAlert: status === "suspected_fall", reasons, trialRule });

  if (vision.state === "failed") return out("vision_processing_failed", "processing_failed");
  if (imu.state === "sensor_fault") return out("imu_sensor_fault", "processing_failed");
  if (vision.state === "missing") return out("vision_missing", "not_enough_data");
  if (imu.state === "missing") return out("imu_missing", "not_enough_data");
  if (imu.state === "insufficient_coverage") return out("imu_insufficient_coverage", "not_enough_data");

  const v = vision.state;
  const i = imu.state;
  if (v === "candidate" && i === "candidate") return imu.aligned ? out("aligned_candidates", "suspected_fall") : out("candidates_not_aligned", "needs_review");
  if ((v === "candidate" && i === "below_rule") || (v === "below_rule" && i === "candidate")) return out("conflicting_evidence", "needs_review");
  if (v === "uncalibrated" && i === "rule_not_configured") return out("rules_not_configured", "needs_review");
  if (v === "uncalibrated") return out("vision_rule_not_configured", "needs_review");
  if (i === "rule_not_configured") return out("imu_rule_not_configured", "needs_review");
  return out("both_below_rules", "no_fall_detected");
}

export function decisionSummaryVi(outcome: FusionOutcome, observedAt: Date, tz: string): string {
  const at = localTimeHHMM(observedAt, tz);
  const trial = outcome.trialRule ? " Có quy tắc là ngưỡng thử, chưa hiệu chỉnh." : "";
  switch (outcome.caseCode) {
    case "aligned_candidates":
      return `Nghi ngã lúc ${at}: dữ liệu gia tốc/con quay thô và mô hình hình ảnh cùng vượt quy tắc đã duyệt, trùng thời điểm. Cảnh báo tạm thời, cần người chăm sóc xác minh ngay.${trial}`;
    case "candidates_not_aligned":
      return `Lúc ${at}: cảm biến chuyển động và hình ảnh đều có dấu hiệu nhưng không trùng thời điểm. Không tạo cảnh báo; cần người chăm sóc xem lại.${trial}`;
    case "conflicting_evidence":
      return `Lúc ${at}: cảm biến chuyển động và hình ảnh cho kết quả trái ngược. Không tạo cảnh báo; cần người chăm sóc xem lại.${trial}`;
    case "vision_rule_not_configured":
      return `Lúc ${at}: mô hình hình ảnh chưa hiệu chỉnh nên không đối chiếu được với cảm biến chuyển động. Cần người chăm sóc xem lại.`;
    case "imu_rule_not_configured":
      return `Lúc ${at}: chưa có quy tắc đã duyệt cho dữ liệu gia tốc/con quay nên không đối chiếu được với hình ảnh. Cần người chăm sóc xem lại.`;
    case "rules_not_configured":
      return `Lúc ${at}: thiết bị báo kích hoạt; cả mô hình hình ảnh và dữ liệu cảm biến chuyển động đều chưa hiệu chỉnh nên hệ thống chưa kết luận. Cần người chăm sóc xem lại.`;
    case "both_below_rules":
      return `Lúc ${at}: hình ảnh và cảm biến chuyển động đều thấp hơn quy tắc nghi ngã. Đây không phải xác nhận an toàn.${trial}`;
    case "vision_missing":
      return `Lúc ${at}: không có kết quả hình ảnh để đối chiếu với cảm biến chuyển động. Thiếu dữ liệu, cần người chăm sóc kiểm tra.`;
    case "imu_missing":
      return `Lúc ${at}: không nhận được dữ liệu gia tốc/con quay thô cho khoảng thời gian của lần chụp. Thiếu dữ liệu, cần người chăm sóc kiểm tra.`;
    case "imu_insufficient_coverage":
      return `Lúc ${at}: dữ liệu gia tốc/con quay bị thiếu mẫu trong khoảng thời gian của lần chụp. Thiếu dữ liệu, cần người chăm sóc kiểm tra.`;
    case "vision_processing_failed":
      return `Lúc ${at}: xử lý hình ảnh của lần chụp thất bại nên không kết luận được. Cần người chăm sóc kiểm tra.`;
    case "imu_sensor_fault":
      return `Lúc ${at}: cảm biến chuyển động trả về giá trị đứng yên bất thường (có thể lỗi cảm biến). Không kết luận được, cần kiểm tra thiết bị.`;
  }
}

export interface DecisionPlan {
  statements: D1PreparedStatement[];
  decisionId: string;
  alertId: string | null;
  alertCreated: boolean;
  commandsQueued: boolean;
}

function uptimeView(w: UptimeWindow | null): Record<string, unknown> | null {
  return w ? { boot_id: w.bootId, from_uptime_ms: w.from, until_uptime_ms: w.until } : null;
}

/** Builds the statements that persist one decision (and, for suspected_fall, a provisional alert and an
 * emergency-buzzer command) together with the source events' fusion links. Reads the open alert for
 * deduplication first; the alerts.dedup_key UNIQUE constraint catches a concurrent duplicate, which aborts
 * the batch so the caller can re-plan. */
export async function planDecision(
  ctx: Ctx,
  args: {
    recipientId: string;
    deviceId: string;
    timezone: string;
    trigger: TriggerInfo | null;
    vision: VisionEvidence;
    imu: ImuEvidence;
    outcome: FusionOutcome;
    /** An alert raised earlier in the same batch for this device: deduplicate to it. */
    knownAlertId?: string | null;
  },
): Promise<DecisionPlan> {
  const { recipientId, deviceId, outcome, trigger, vision, imu } = args;
  const policy = ctx.config.fusionPolicy;
  const now = ctx.clock.now();
  const db = ctx.env.DB;
  const decisionId = newId("fdc");
  const observedAt = trigger?.at ?? vision.observedFrom ?? now;
  const summary = decisionSummaryVi(outcome, observedAt, args.timezone);
  const dedupKey = trigger ? `trigger:${trigger.eventId}` : `capture:${vision.capturePk ?? decisionId}`;

  let alertDecision: "raise" | "deduplicated" | "none" = "none";
  let alertId: string | null = null;
  const statements: D1PreparedStatement[] = [];
  const after: D1PreparedStatement[] = [];

  if (outcome.raiseAlert) {
    const windowStart = iso(addSeconds(now, -policy.alert_dedup_window_seconds));
    const open = args.knownAlertId
      ? { alert_id: args.knownAlertId }
      : await db
          .prepare(
            `SELECT alert_id FROM alerts WHERE device_id = ?1 AND kind = 'suspected_fall' AND status IN ('open', 'acknowledged', 'in_progress')
             AND triggered_at >= ?2 ORDER BY triggered_at DESC LIMIT 1`,
          )
          .bind(deviceId, windowStart)
          .first<{ alert_id: string }>();
    if (open) {
      alertDecision = "deduplicated";
      alertId = open.alert_id;
      after.push(db.prepare(`UPDATE alerts SET duplicate_count = duplicate_count + 1, last_duplicate_at = ?1 WHERE alert_id = ?2`).bind(iso(now), alertId));
    } else {
      alertDecision = "raise";
      alertId = newId("alr");
      const bucket = Math.floor(now.getTime() / 1000 / policy.alert_dedup_window_seconds);
      after.push(
        db
          .prepare(
            `INSERT INTO alerts (alert_id, recipient_id, device_id, kind, fusion_decision_id, dedup_key, status, severity, summary_vi,
               policy_version, observed_at, triggered_at)
             VALUES (?1, ?2, ?3, 'suspected_fall', ?4, ?5, 'open', 'warning', ?6, ?7, ?8, ?9)`,
          )
          .bind(alertId, recipientId, deviceId, decisionId, `${deviceId}:suspected_fall:${bucket}`, summary, policy.policy_version, iso(observedAt), iso(now)),
      );
      if (policy.device_buzzer_on_alert) after.push(...emergencyBuzzerStatements(ctx, { deviceId, recipientId, alertId }));
      after.push(auditStatement(ctx, { actorType: "system", actorId: null, action: "alert.raise", targetType: "alert", targetId: alertId, recipientId }));
    }
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO fusion_decisions (decision_id, recipient_id, device_id, capture_pk, trigger_event_id, vision_event_id, dedup_key, policy_version,
           case_code, status, alert_decision, alert_id, observed_at, explanation_json, decided_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
      )
      .bind(
        decisionId,
        recipientId,
        deviceId,
        vision.capturePk,
        trigger?.eventId ?? null,
        vision.eventId,
        dedupKey,
        policy.policy_version,
        outcome.caseCode,
        outcome.status,
        alertDecision,
        alertId,
        iso(observedAt),
        JSON.stringify({
          summary_vi: summary,
          reasons: outcome.reasons,
          clock_basis: "same_boot_uptime_ms",
          policy: {
            alignment_tolerance_ms: policy.alignment_tolerance_ms,
            imu_search_margin_ms: policy.imu_search_margin_ms,
            imu_min_coverage_ratio: policy.imu_min_coverage_ratio,
            imu_max_gap_ms: policy.imu_max_gap_ms,
            single_source_alerts: "never",
          },
          trigger: trigger
            ? {
                event_id: trigger.eventId,
                trigger_id: trigger.triggerId,
                trigger_type: trigger.triggerType,
                boot_id: trigger.bootId,
                uptime_ms: trigger.uptimeMs,
                at: iso(trigger.at),
                role: "starts_decision_only_not_evidence",
              }
            : null,
          vision: {
            state: vision.state,
            event_id: vision.eventId,
            missing_reason: vision.missingReason,
            classification: vision.classification,
            calibration_status: vision.calibrationStatus,
            aggregate_score: vision.aggregateScore,
            score_semantics: vision.aggregateScore === null ? null : "uncalibrated_logit_not_probability",
            rule_version: vision.ruleVersion,
            window: uptimeView(vision.window),
            observed_from: vision.observedFrom ? iso(vision.observedFrom) : null,
            observed_until: vision.observedUntil ? iso(vision.observedUntil) : null,
          },
          imu: {
            state: imu.state,
            aligned: imu.aligned,
            window: uptimeView(imu.window),
            coverage: imu.coverage,
            features: imu.features,
            features_note: "computed by the backend from raw samples; not body angle, posture or a validated fall measure",
            match_uptime_ms: imu.matchUptimeMs,
            rule_version: imu.ruleVersion,
            calibration: imu.calibration,
            batch_ids: imu.batchIds.slice(0, 20),
            reasons: imu.reasons,
          },
          verification_required: true,
        }),
        iso(now),
      ),
    ...after,
  );

  const alertStatus = alertDecision === "raise" ? "raised" : alertDecision === "deduplicated" ? "deduplicated" : "none";
  for (const eventId of [trigger?.eventId, vision.eventId]) {
    if (!eventId) continue;
    statements.push(
      db
        .prepare(
          `UPDATE events SET fusion_status = CASE WHEN fusion_status = 'pending' THEN 'decided' ELSE fusion_status END,
             fusion_decision_id = ?1, alert_status = ?2, alert_id = ?3 WHERE event_id = ?4`,
        )
        .bind(decisionId, alertStatus, alertId, eventId),
    );
  }
  statements.push(bumpStreamStatement(ctx, recipientId));
  return { statements, decisionId, alertId, alertCreated: alertDecision === "raise", commandsQueued: alertDecision === "raise" && policy.device_buzzer_on_alert };
}
