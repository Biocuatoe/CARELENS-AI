/**
 * Server-side checks and normalization of Vision results reported by the Local AI Agent.
 *
 * The local package (carelens_models_v1_20261018) is a fall check (R3D-18 + 3 C3 heads, 16/24 frames per
 * request) and a drink/medicine check (YOLO11n + rule v12, 1–24 frames per request). It is NOT
 * calibrated: /v1/fall-check returns threshold=null, alert=null, status="NOT_CALIBRATED", and its score
 * is an uncalibrated logit. Nothing here turns that score into a probability or applies the package's
 * video-demo threshold; a candidate exists only when a configured, owner-approved rule says so.
 *
 * The backend re-derives every aggregate from the per-request outputs and rejects a result whose window
 * plan or aggregates disagree, so an agent bug cannot silently change what is stored.
 */
import type { VisionCandidateRuleConfig } from "./env";
import type { VisionResult } from "./contracts";

export const PACKAGE_UNCALIBRATED = new Set(["NOT_CALIBRATED", "UNCALIBRATED"]);

/** Request windows for a capture. 24 frames: one request. 40 frames: three overlapping 24-frame
 * requests (0–23, 8–31, 16–39); /v1/fall-check rejects 40 frames in one request. */
export function windowPlan(frameCount: number): Array<[number, number]> {
  if (frameCount === 24) return [[0, 23]];
  if (frameCount === 40) return [
    [0, 23],
    [8, 31],
    [16, 39],
  ];
  throw new Error(`no window plan for ${frameCount} frames`);
}

export type FallAggregation = "single_request.v1" | "max_request_score_overlapping.v1";

export function fallAggregationFor(frameCount: number): FallAggregation {
  return frameCount === 24 ? "single_request.v1" : "max_request_score_overlapping.v1";
}

/** Drink aggregation tolerance: lift frames this close (absolute index) are one physical observation. */
export const LIFT_CLUSTER_FRAMES = 4;

export function clusterLiftFrames(frames: number[]): number[] {
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  const out: number[] = [];
  for (const f of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || f - last > LIFT_CLUSTER_FRAMES) out.push(f);
  }
  return out;
}

export interface DrinkAggregate {
  label: "uong_nuoc" | "uong_thuoc" | "khong";
  crossWindowReview: boolean;
  distinctLiftFrames: number[];
}

/** drink_capture_aggregate.v1. The package rule decides per request; this layer only combines requests:
 * - label precedence uong_thuoc > uong_nuoc > khong (each label is the package's own per-request label);
 * - cross_window_review: the blister was handled in one request and a cup lift was seen in another, but
 *   no single request produced uong_thuoc. That pairing is NOT a package label; it is flagged for review;
 * - lift frames are mapped to absolute capture indices and clustered so an overlapping frame range is not
 *   counted as a second drink. */
export function aggregateDrink(requests: VisionResult["drink"]["requests"]): DrinkAggregate {
  const labels = requests.map((r) => r.label);
  const label = labels.includes("uong_thuoc") ? "uong_thuoc" : labels.includes("uong_nuoc") ? "uong_nuoc" : "khong";
  const handled = requests.some((r) => r.evidence.medicine_handled === true);
  const lifted = requests.some((r) => r.evidence.cup_lifted_to_face);
  const lifts = requests.flatMap((r) => (r.evidence.lift_frame === null ? [] : [r.frame_start + r.evidence.lift_frame]));
  return { label, crossWindowReview: label !== "uong_thuoc" && handled && lifted, distinctLiftFrames: clusterLiftFrames(lifts) };
}

export class VisionResultRejected extends Error {}

export interface NormalizedVision {
  fall: FallEvidence;
  drink: DrinkEvidence;
}

export interface FallEvidence {
  processed: boolean;
  classification: "uncalibrated_output" | "fall_candidate" | "below_candidate_rule" | "not_enough_data";
  calibrationStatus: "not_calibrated" | "calibrated" | "uncalibrated_trial";
  aggregateScore: number | null;
  ruleVersion: string | null;
  summaryVi: string;
  evidence: Record<string, unknown>;
}

export interface DrinkEvidence {
  processed: boolean;
  classification: "drinking_water_observed" | "medicine_observed" | "none_observed" | "cross_window_review" | "not_enough_data";
  label: string | null;
  summaryVi: string;
  evidence: Record<string, unknown>;
}

function sameRange(requests: Array<{ frame_start: number; frame_end: number }>, plan: Array<[number, number]>): boolean {
  return requests.length === plan.length && requests.every((r, i) => r.frame_start === plan[i]?.[0] && r.frame_end === plan[i]?.[1]);
}

function checkTimes(
  requests: Array<{ frame_start: number; frame_end: number; t_start_ms: number; t_end_ms: number }>,
  offsets: number[],
): boolean {
  return requests.every((r) => r.t_start_ms === offsets[r.frame_start] && r.t_end_ms === offsets[r.frame_end]);
}

/** Validates a vision-result.v1 against the capture and re-derives its aggregates. */
export function normalizeVision(
  result: VisionResult,
  capture: { capture_id: string; mode: "normal" | "triggered"; frame_count: number; offsets: number[] },
  rule: VisionCandidateRuleConfig | null,
): NormalizedVision {
  if (result.capture_id !== capture.capture_id) throw new VisionResultRejected("capture_id does not match the job");
  if (result.input_validation.frame_count !== capture.frame_count) throw new VisionResultRejected("frame_count does not match the capture");
  const plan = windowPlan(capture.frame_count);
  const offsets = capture.offsets;

  /* ---------------- fall */
  let fall: FallEvidence;
  const f = result.fall;
  if (f.status === "completed") {
    if (!sameRange(f.requests, plan)) throw new VisionResultRejected("fall requests do not follow the window plan");
    if (!checkTimes(f.requests, offsets)) throw new VisionResultRejected("fall request times do not match the capture manifest");
    const expectedAggregation = fallAggregationFor(capture.frame_count);
    const max = Math.max(...f.requests.map((r) => r.score));
    if (f.aggregation !== expectedAggregation) throw new VisionResultRejected("unexpected fall aggregation");
    if (f.aggregate_score === null || Math.abs(f.aggregate_score - max) > 1e-9) throw new VisionResultRejected("fall aggregate_score is not the max request score");
    for (const r of f.requests) {
      if (r.window_logits.some((head) => head.length !== r.windows)) throw new VisionResultRejected("window_logits shape does not match windows");
    }
    const packageCalibrated = f.requests.every((r) => r.threshold !== null && r.alert !== null && !PACKAGE_UNCALIBRATED.has(r.status.toUpperCase()));
    const ruleApplies =
      rule !== null &&
      rule.model_version === result.package_version &&
      rule.capture_modes.includes(capture.mode) &&
      rule.aggregations.includes(expectedAggregation);

    let classification: FallEvidence["classification"];
    let calibrationStatus: FallEvidence["calibrationStatus"];
    let ruleVersion: string | null = null;
    if (packageCalibrated) {
      classification = f.requests.some((r) => r.alert === true) ? "fall_candidate" : "below_candidate_rule";
      calibrationStatus = "calibrated";
      ruleVersion = "package-decision.v1";
    } else if (ruleApplies && rule) {
      classification = max >= rule.min_score ? "fall_candidate" : "below_candidate_rule";
      calibrationStatus = rule.calibration;
      ruleVersion = rule.rule_version;
    } else {
      classification = "uncalibrated_output";
      calibrationStatus = "not_calibrated";
    }
    const summaryVi =
      classification === "fall_candidate"
        ? `Mô hình hình ảnh ghi nhận dấu hiệu giống ngã theo quy tắc ${ruleVersion}${calibrationStatus === "uncalibrated_trial" ? " (ngưỡng thử, chưa hiệu chỉnh)" : ""}. Chưa được người chăm sóc xác minh.`
        : classification === "below_candidate_rule"
          ? `Đã kiểm tra nghi ngã; điểm mô hình thấp hơn quy tắc ${ruleVersion}. Không phải xác nhận an toàn.`
          : "Đã chạy kiểm tra nghi ngã. Mô hình chưa hiệu chỉnh trên thiết bị nên chưa kết luận.";
    fall = {
      processed: true,
      classification,
      calibrationStatus,
      aggregateScore: max,
      ruleVersion,
      summaryVi,
      evidence: {
        score_semantics: "uncalibrated_logit_higher_is_more_fall_like",
        aggregation: expectedAggregation,
        aggregate_score: max,
        requests: f.requests.map((r) => ({
          frame_start: r.frame_start,
          frame_end: r.frame_end,
          t_start_ms: r.t_start_ms,
          t_end_ms: r.t_end_ms,
          score: r.score,
          window_logits: r.window_logits,
          windows: r.windows,
          package_threshold: r.threshold,
          package_alert: r.alert,
          package_status: r.status,
        })),
        candidate_rule: ruleApplies && rule ? { rule_version: rule.rule_version, min_score: rule.min_score, calibration: rule.calibration } : null,
        rule_version: ruleVersion,
        package_calibrated: packageCalibrated,
        input_validation: result.input_validation,
      },
    };
  } else {
    if (f.requests.length !== 0) throw new VisionResultRejected("fall requests present although fall.status is not completed");
    fall = {
      processed: false,
      classification: "not_enough_data",
      calibrationStatus: "not_calibrated",
      aggregateScore: null,
      ruleVersion: null,
      summaryVi: `Không chạy được kiểm tra nghi ngã cho lần chụp này (${f.reason ?? f.status}). Không có dữ liệu để kết luận.`,
      evidence: { status: f.status, reason: f.reason, input_validation: result.input_validation },
    };
  }

  /* ---------------- drink */
  let drink: DrinkEvidence;
  const d = result.drink;
  if (d.status === "completed") {
    if (!sameRange(d.requests, plan)) throw new VisionResultRejected("drink requests do not follow the window plan");
    if (!checkTimes(d.requests, offsets)) throw new VisionResultRejected("drink request times do not match the capture manifest");
    for (const r of d.requests) if (r.evidence.frames !== r.frame_end - r.frame_start + 1) throw new VisionResultRejected("drink evidence.frames mismatch");
    const agg = aggregateDrink(d.requests);
    if (
      d.aggregation !== "drink_capture_aggregate.v1" ||
      d.aggregate_label !== agg.label ||
      d.cross_window_review !== agg.crossWindowReview ||
      JSON.stringify(d.distinct_lift_frames) !== JSON.stringify(agg.distinctLiftFrames)
    ) {
      throw new VisionResultRejected("drink aggregate does not match drink_capture_aggregate.v1");
    }
    const classification =
      agg.label === "uong_thuoc"
        ? "medicine_observed"
        : agg.label === "uong_nuoc"
          ? "drinking_water_observed"
          : agg.crossWindowReview
            ? "cross_window_review"
            : "none_observed";
    const summaryVi = {
      medicine_observed: "Mô hình nhận diện ghi nhận có thể đã uống thuốc. Đây là quan sát AI chưa xác nhận, không phải xác nhận uống thuốc.",
      drinking_water_observed: "Mô hình nhận diện ghi nhận có thể đã uống nước. Quan sát AI chưa xác nhận.",
      cross_window_review: "Thấy vỉ thuốc được cầm và cốc được nâng ở hai đoạn khác nhau của lần chụp; mô hình không gán nhãn uống thuốc. Cần người xem lại.",
      none_observed: "Mô hình không nhận ra việc uống nước hay uống thuốc trong lần chụp này.",
    }[classification];
    drink = {
      processed: true,
      classification,
      label: agg.label,
      summaryVi,
      evidence: {
        aggregation: "drink_capture_aggregate.v1",
        aggregate_label: agg.label,
        cross_window_review: agg.crossWindowReview,
        distinct_lift_frames: agg.distinctLiftFrames,
        lift_cluster_frames: LIFT_CLUSTER_FRAMES,
        requests: d.requests.map((r) => ({
          frame_start: r.frame_start,
          frame_end: r.frame_end,
          t_start_ms: r.t_start_ms,
          t_end_ms: r.t_end_ms,
          label: r.label,
          evidence: r.evidence,
          package_status: r.status,
        })),
        detector_output_is_not_verified_action: true,
      },
    };
  } else {
    if (d.requests.length !== 0) throw new VisionResultRejected("drink requests present although drink.status is not completed");
    drink = {
      processed: false,
      classification: "not_enough_data",
      label: null,
      summaryVi: `Không chạy được nhận diện uống nước/thuốc cho lần chụp này (${d.reason ?? d.status}).`,
      evidence: { status: d.status, reason: d.reason },
    };
  }
  return { fall, drink };
}
