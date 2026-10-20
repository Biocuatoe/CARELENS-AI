/** Pure logic: media parsing, cadence, window plans, drink aggregation, fusion rules, time zones. */
import { describe, expect, it } from "vitest";
import { checkCadence } from "../src/captures";
import { ConfigError, DEFAULT_FUSION_POLICY, ipInCidrs, loadConfig, type Env, type FusionPolicy } from "../src/env";
import { decide, evaluateImu, type ImuEvidence, type ImuSample, type ImuWindowData, type TriggerInfo, type VisionEvidence, type VisionState } from "../src/fusion";
import { inspectJpeg, inspectMp3, inspectWav, unpackFrames } from "../src/media";
import { LAME_16K_MONO, LAME_16K_MONO_TAGGED, mp3, mp3Frame } from "./audio";
import { dueOccurrences } from "../src/reminders";
import { latestDueReportDate, validateReportOutput, type ReportInput } from "../src/reports";
import { localDayPeriod, zonedToUtc } from "../src/util";
import { aggregateDrink, clusterLiftFrames, normalizeVision, windowPlan, VisionResultRejected } from "../src/vision";
import { IMU_TEST_RULE, b64ToBytes, drinkRequest, imuSamples, jpegFrame, pack, visionResult } from "./helpers";
import { GRAY_160x120_B64 } from "./jpeg-fixtures";
import { VisionResultV1 } from "../src/contracts";

describe("JPEG inspection", () => {
  it("reads dimensions of a real JPEG and of a COM-tagged copy", () => {
    expect(inspectJpeg(jpegFrame(0))).toEqual({ width: 320, height: 240 });
    expect(inspectJpeg(b64ToBytes(GRAY_160x120_B64))).toEqual({ width: 160, height: 120 });
  });
  it("rejects non-JPEG, truncated and header-only data", () => {
    expect(inspectJpeg(new TextEncoder().encode("not a jpeg at all"))).toBeNull();
    const f = jpegFrame(1);
    expect(inspectJpeg(f.subarray(0, f.length - 10))).toBeNull(); // no EOI
    expect(inspectJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull(); // no frame header
  });
  it("tolerates zero padding after EOI", () => {
    const f = jpegFrame(2);
    const padded = new Uint8Array(f.length + 3);
    padded.set(f);
    expect(inspectJpeg(padded)).toEqual({ width: 320, height: 240 });
  });
});

describe("frame packing", () => {
  it("round-trips the Vision package body format", () => {
    const frames = [jpegFrame(0), jpegFrame(1)];
    const out = unpackFrames(pack(frames), 8);
    expect(Array.isArray(out) && out.length).toBe(2);
  });
  it("reports truncated prefixes, zero-length and oversize frames", () => {
    expect(unpackFrames(new Uint8Array([1, 0]), 8)).toContain("truncated");
    expect(unpackFrames(new Uint8Array([0, 0, 0, 0]), 8)).toContain("length 0");
    const big = new Uint8Array(8);
    new DataView(big.buffer).setUint32(0, 300_000, true);
    expect(unpackFrames(big, 8)).toContain("outside");
    expect(unpackFrames(pack([jpegFrame(0), jpegFrame(1)]), 1)).toContain("more than 1");
  });
});

describe("MP3 contract (ADR-025)", () => {
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  it("reads real LAME output exactly as the firmware does (frames, samples, duration)", () => {
    expect(inspectMp3(LAME_16K_MONO)).toEqual({
      mpegVersion: 2,
      sampleRateHz: 16000,
      channels: 1,
      frames: 30,
      pcmFrames: 30 * 576,
      durationMs: 1080, // the firmware host test reports the same 1080 ms for this file
      minKbps: 32,
      maxKbps: 32,
      hasId3v2: false,
      hasTailTag: false,
      hasVbrHeader: false,
    });
    expect(inspectMp3(LAME_16K_MONO_TAGGED)).toMatchObject({ frames: 30, durationMs: 1080, hasId3v2: true, hasTailTag: true });
  });
  it("accepts every rate family and layout, CBR or mixed bitrates, and zero padding at the end", () => {
    for (const rate of [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]) {
      for (const channels of [1, 2] as const) expect(inspectMp3(mp3({ rate, channels })), `${rate}/${channels}`).toMatchObject({ sampleRateHz: rate, channels });
    }
    const vbr = cat(mp3({ rate: 44100, kbps: 128, seconds: 0.5 }), mp3({ rate: 44100, kbps: 320, seconds: 0.5 }));
    expect(inspectMp3(vbr)).toMatchObject({ minKbps: 128, maxKbps: 320 });
    expect(inspectMp3(cat(LAME_16K_MONO, new Uint8Array(300)))).toMatchObject({ durationMs: 1080 });
  });
  it("treats a Xing/Info frame as metadata, not audio", () => {
    const info = mp3Frame(44100, 2, 128).bytes;
    info.set(new TextEncoder().encode("Info"), 4 + 32);
    const plain = inspectMp3(mp3({ rate: 44100, channels: 2 })) as { frames: number };
    expect(inspectMp3(cat(info, mp3({ rate: 44100, channels: 2 })))).toMatchObject({ hasVbrHeader: true, frames: plain.frames });
  });
  it("refuses with the firmware's codes: no frames, wrong layer, free format, reserved values, splices, truncation, trailing data", () => {
    expect(inspectMp3(new Uint8Array(2))).toBe("mp3_too_short");
    expect(inspectMp3(new TextEncoder().encode("RIFF....WAVEfmt "))).toBe("mp3_no_frame");
    expect(inspectMp3(cat(mp3Frame(44100, 2, 128, 2).bytes, mp3Frame(44100, 2, 128, 2).bytes))).toBe("mp3_not_layer3");
    expect(inspectMp3(new Uint8Array([0xff, 0xfb, 0x00, 0x00, 0, 0, 0, 0]))).toBe("mp3_free_format");
    expect(inspectMp3(new Uint8Array([0xff, 0xeb, 0x90, 0x00, 0, 0, 0, 0]))).toBe("mp3_bad_header");
    expect(inspectMp3(cat(mp3({ rate: 16000 }), mp3({ rate: 22050 })))).toBe("mp3_format_changed");
    expect(inspectMp3(cat(mp3({ rate: 44100, channels: 1 }), mp3({ rate: 44100, channels: 2 })))).toBe("mp3_format_changed");
    expect(inspectMp3(LAME_16K_MONO.subarray(0, LAME_16K_MONO.length - 40))).toBe("mp3_truncated_frame");
    expect(inspectMp3(cat(LAME_16K_MONO, new TextEncoder().encode("junkjunk")))).toBe("mp3_trailing_data");
    expect(inspectMp3(cat(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]), LAME_16K_MONO))).toBe("mp3_bad_id3");
  });
  it("applies the contract's duration and sample-rate limits after the walk", () => {
    expect(inspectMp3(mp3({ seconds: 0.3 }))).toMatch(/^duration /);
    expect(inspectMp3(mp3({ seconds: 61 }))).toMatch(/^duration /);
    expect(inspectMp3(mp3({ rate: 44100 }), [16000])).toMatch(/^sample rate 44100 Hz/);
  });
});

describe("WAV contract (legacy recordings)", () => {
  function wav(rate: number, channels: number, bits: number, seconds: number): Uint8Array {
    const data = Math.round(rate * seconds) * channels * (bits / 8);
    const buf = new Uint8Array(44 + data);
    const v = new DataView(buf.buffer);
    const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    s(0, "RIFF");
    v.setUint32(4, 36 + data, true);
    s(8, "WAVE");
    s(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, channels, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * channels * (bits / 8), true);
    v.setUint16(32, channels * (bits / 8), true);
    v.setUint16(34, bits, true);
    s(36, "data");
    v.setUint32(40, data, true);
    return buf;
  }
  it("accepts mono 16-bit PCM and reports its duration", () => {
    expect(inspectWav(wav(16000, 1, 16, 2))).toEqual({ sampleRateHz: 16000, channels: 1, bitsPerSample: 16, durationMs: 2000 });
  });
  it("accepts only the sample rates of the device profile", () => {
    expect(typeof inspectWav(wav(8000, 1, 16, 2), [16000])).toBe("string");
    expect(inspectWav(wav(16000, 1, 16, 2), [16000])).toMatchObject({ sampleRateHz: 16000 });
  });
  it("rejects stereo, 8-bit, odd sample rates and too long or too short audio", () => {
    expect(inspectWav(wav(16000, 2, 16, 1))).toBe("audio must be mono");
    expect(inspectWav(wav(16000, 1, 8, 1))).toBe("audio must be 16-bit");
    expect(typeof inspectWav(wav(44100, 1, 16, 1))).toBe("string");
    expect(typeof inspectWav(wav(8000, 1, 16, 61))).toBe("string");
    expect(typeof inspectWav(wav(8000, 1, 16, 0.2))).toBe("string");
  });
});

describe("cadence", () => {
  const nominal = Array.from({ length: 24 }, (_, i) => i * 125);
  it("accepts nominal 8 fps", () => expect(checkCadence(nominal, 40).status).toBe("ok"));
  it("flags jitter beyond tolerance", () => {
    const o = [...nominal];
    o[5] = (o[5] as number) + 50;
    expect(checkCadence(o, 40).status).toBe("out_of_tolerance");
  });
  it("detects a missing frame as a gap", () => {
    const o = nominal.map((t, i) => (i >= 10 ? t + 125 : t));
    const r = checkCadence(o, 40);
    expect(r.status).toBe("gap");
    expect(r.maxIntervalMs).toBe(250);
  });
});

describe("window plan and aggregation", () => {
  it("uses one 24-frame request, or three overlapping ones for 40 frames", () => {
    expect(windowPlan(24)).toEqual([[0, 23]]);
    expect(windowPlan(40)).toEqual([
      [0, 23],
      [8, 31],
      [16, 39],
    ]);
    expect(() => windowPlan(16)).toThrow();
  });
  it("does not count one lift seen in overlapping windows twice", () => {
    expect(clusterLiftFrames([20, 20, 21, 30])).toEqual([20, 30]);
    const o = Array.from({ length: 40 }, (_, i) => i * 125);
    const agg = aggregateDrink([drinkRequest(0, 23, o, "uong_nuoc", 20), drinkRequest(8, 31, o, "uong_nuoc", 12), drinkRequest(16, 39, o, "uong_nuoc", 4)] as never);
    expect(agg).toEqual({ label: "uong_nuoc", crossWindowReview: false, distinctLiftFrames: [20] });
  });
  it("flags medicine handled in one window and a lift in another for review, without inventing uong_thuoc", () => {
    const o = Array.from({ length: 40 }, (_, i) => i * 125);
    const agg = aggregateDrink([drinkRequest(0, 23, o, "khong", null, true), drinkRequest(8, 31, o, "khong"), drinkRequest(16, 39, o, "uong_nuoc", 18)] as never);
    expect(agg.label).toBe("uong_nuoc");
    expect(agg.crossWindowReview).toBe(true);
  });
});

describe("vision normalization", () => {
  const capture = (count: 24 | 40) => ({
    capture_id: "c1",
    mode: (count === 24 ? "normal" : "triggered") as "normal" | "triggered",
    frame_count: count,
    offsets: Array.from({ length: count }, (_, i) => i * 125),
  });

  it("keeps the uncalibrated package output as uncalibrated_output, never a candidate", () => {
    const r = VisionResultV1.parse(visionResult({ captureId: "c1", frameCount: 24, scores: [9.5] }));
    const n = normalizeVision(r, capture(24), null);
    expect(n.fall.classification).toBe("uncalibrated_output");
    expect(n.fall.calibrationStatus).toBe("not_calibrated");
    expect(n.fall.evidence.score_semantics).toBe("uncalibrated_logit_higher_is_more_fall_like");
  });
  it("applies an explicitly configured rule and labels a trial rule as such", () => {
    const rule = {
      rule_version: "r",
      model_version: "carelens_models_v1_20261018",
      capture_modes: ["triggered" as const],
      aggregations: ["max_request_score_overlapping.v1" as const],
      min_score: 0.5,
      calibration: "uncalibrated_trial" as const,
      approved_by: "x",
      approved_at: "y",
      evidence_ref: "z",
    };
    const r = VisionResultV1.parse(visionResult({ captureId: "c1", frameCount: 40, scores: [-1, 0.7, 0.1] }));
    const n = normalizeVision(r, capture(40), rule);
    expect([n.fall.classification, n.fall.calibrationStatus, n.fall.aggregateScore]).toEqual(["fall_candidate", "uncalibrated_trial", 0.7]);
    // The same rule does not apply to 24-frame captures it was not declared for.
    const r24 = VisionResultV1.parse(visionResult({ captureId: "c1", frameCount: 24, scores: [3] }));
    expect(normalizeVision(r24, capture(24), rule).fall.classification).toBe("uncalibrated_output");
  });
  it("rejects results that break the window plan, the times or the aggregate", () => {
    const wrongAgg = visionResult({ captureId: "c1", frameCount: 40, scores: [1, 2, 3] });
    (wrongAgg.fall as { aggregate_score: number }).aggregate_score = 1;
    expect(() => normalizeVision(VisionResultV1.parse(wrongAgg), capture(40), null)).toThrow(VisionResultRejected);
    const wrongPlan = visionResult({ captureId: "c1", frameCount: 40 });
    (wrongPlan.fall as { requests: Array<{ frame_start: number }> }).requests[1]!.frame_start = 4;
    expect(() => normalizeVision(VisionResultV1.parse(wrongPlan), capture(40), null)).toThrow(VisionResultRejected);
    expect(() => normalizeVision(VisionResultV1.parse(visionResult({ captureId: "other", frameCount: 24 })), capture(24), null)).toThrow(VisionResultRejected);
  });
  it("records skipped checks as not_enough_data", () => {
    const n = normalizeVision(VisionResultV1.parse(visionResult({ captureId: "c1", frameCount: 24, fallStatus: "skipped" })), capture(24), null);
    expect([n.fall.processed, n.fall.classification]).toEqual([false, "not_enough_data"]);
  });
});

describe("fusion rules v2 (pure)", () => {
  const BOOT = "boot-unit-0001";
  const core = { bootId: BOOT, from: 60_000, until: 64_875 }; // one 40-frame burst on the device clock
  const p = (over: Partial<FusionPolicy> = {}): FusionPolicy => ({ ...DEFAULT_FUSION_POLICY, ...over });
  const withRule = p({ imu_candidate_rule: IMU_TEST_RULE });
  const data = (samples: ImuSample[], bootId = BOOT): ImuWindowData => ({ bootId, samples, nominalRateHz: 100, batchIds: ["imu_b1"] });
  const quietWindow = () => imuSamples(core.from - 12_000, core.until + 12_000, 100);
  const impactAt = (t: number) => imuSamples(core.from - 12_000, core.until + 12_000, 100, [t]);

  it("evaluates raw IMU coverage, sensor faults and the approved rule", () => {
    expect(evaluateImu(null, core, withRule).state).toBe("missing");
    expect(evaluateImu(data(quietWindow(), "another-boot"), core, withRule).state).toBe("missing");
    const holey = quietWindow().filter((s) => s.t < core.from + 1000 || s.t > core.from + 2000);
    const partial = evaluateImu(data(holey), core, withRule);
    expect(partial.state).toBe("insufficient_coverage");
    expect(partial.coverage?.max_gap_ms).toBeGreaterThan(900);
    const frozen = quietWindow().map((s) => ({ ...s, ax: 0.01, ay: 0.02, az: 0.98, gx: 0.5, gy: 0.4, gz: 0.3 }));
    expect(evaluateImu(data(frozen), core, withRule).state).toBe("sensor_fault");
    const unconfigured = evaluateImu(data(impactAt(core.from + 2000)), core, p());
    expect(unconfigured.state).toBe("rule_not_configured");
    expect(unconfigured.features?.peak_accel_magnitude_g).toBeGreaterThan(2);
    expect(evaluateImu(data(quietWindow()), core, withRule).state).toBe("below_rule");
    const inside = evaluateImu(data(impactAt(core.from + 2000)), core, withRule);
    expect([inside.state, inside.aligned, inside.matchUptimeMs]).toEqual(["candidate", true, core.from + 2000]);
    // Within tolerance (3 s) before the burst still aligns; 8 s before does not.
    expect(evaluateImu(data(impactAt(core.from - 2000)), core, withRule).aligned).toBe(true);
    const outside = evaluateImu(data(impactAt(core.from - 8000)), core, withRule);
    expect([outside.state, outside.aligned]).toEqual(["candidate", false]);
  });

  const vision = (state: VisionState, over: Partial<VisionEvidence> = {}): VisionEvidence => ({
    state,
    eventId: "v1",
    capturePk: "cap1",
    classification: state === "candidate" ? "fall_candidate" : state === "below_rule" ? "below_candidate_rule" : state === "uncalibrated" ? "uncalibrated_output" : "not_enough_data",
    calibrationStatus: state === "uncalibrated" ? "not_calibrated" : "uncalibrated_trial",
    aggregateScore: 1,
    ruleVersion: "r",
    window: core,
    observedFrom: new Date("2026-10-19T03:00:00.000Z"),
    observedUntil: new Date("2026-10-19T03:00:04.875Z"),
    missingReason: null,
    ...over,
  });
  const imu = (state: ImuEvidence["state"], aligned: boolean | null = null): ImuEvidence => ({
    state,
    aligned,
    window: core,
    coverage: null,
    features: null,
    matchUptimeMs: null,
    ruleVersion: "imu-test",
    calibration: "uncalibrated_trial",
    batchIds: [],
    reasons: [],
  });
  const trigger: TriggerInfo = { eventId: "t1", triggerId: "trg", triggerType: "impact", bootId: BOOT, uptimeMs: core.from + 1500, at: new Date("2026-10-19T03:00:01.500Z") };
  const pol = p({ imu_candidate_rule: IMU_TEST_RULE });

  it.each([
    ["candidate", "candidate", true, "aligned_candidates", "suspected_fall"],
    ["candidate", "candidate", false, "candidates_not_aligned", "needs_review"],
    ["candidate", "below_rule", null, "conflicting_evidence", "needs_review"],
    ["below_rule", "candidate", true, "conflicting_evidence", "needs_review"],
    ["uncalibrated", "candidate", true, "vision_rule_not_configured", "needs_review"],
    ["candidate", "rule_not_configured", null, "imu_rule_not_configured", "needs_review"],
    ["uncalibrated", "rule_not_configured", null, "rules_not_configured", "needs_review"],
    ["below_rule", "below_rule", null, "both_below_rules", "no_fall_detected"],
    ["missing", "candidate", true, "vision_missing", "not_enough_data"],
    ["candidate", "missing", null, "imu_missing", "not_enough_data"],
    ["candidate", "insufficient_coverage", null, "imu_insufficient_coverage", "not_enough_data"],
    ["failed", "candidate", true, "vision_processing_failed", "processing_failed"],
    ["candidate", "sensor_fault", null, "imu_sensor_fault", "processing_failed"],
  ] as const)("vision %s + imu %s (aligned %s) → %s / %s", (v, i, aligned, caseCode, status) => {
    const out = decide(pol, { trigger, vision: vision(v), imu: imu(i, aligned) });
    expect(out).toMatchObject({ caseCode, status, raiseAlert: status === "suspected_fall" });
  });

  it("never raises an alert from one source, whatever the firmware reports", () => {
    for (const i of ["candidate", "below_rule", "rule_not_configured", "missing", "insufficient_coverage", "sensor_fault"] as const) {
      for (const v of ["below_rule", "uncalibrated", "missing", "failed"] as const) {
        expect(decide(pol, { trigger, vision: vision(v), imu: imu(i, true) })?.raiseAlert ?? false).toBe(false);
      }
    }
    for (const v of ["candidate", "below_rule", "uncalibrated", "missing", "failed"] as const) {
      expect(decide(pol, { trigger, vision: vision(v), imu: imu("rule_not_configured") })?.raiseAlert ?? false).toBe(false);
    }
  });

  it("starts a decision only on a firmware trigger or a candidate", () => {
    expect(decide(pol, { trigger: null, vision: vision("uncalibrated"), imu: imu("rule_not_configured") })).toBeNull();
    expect(decide(pol, { trigger: null, vision: vision("below_rule"), imu: imu("below_rule") })).toBeNull();
    expect(decide(pol, { trigger: null, vision: vision("candidate"), imu: imu("missing") })?.status).toBe("not_enough_data");
    expect(decide(pol, { trigger: null, vision: vision("missing"), imu: imu("candidate", true) })?.status).toBe("not_enough_data");
  });

  it("records whether the firmware trigger fell inside the burst, without using it as evidence", () => {
    const late = { ...trigger, uptimeMs: core.until + 9000 };
    const out = decide(pol, { trigger: late, vision: vision("candidate"), imu: imu("candidate", true) });
    expect(out?.status).toBe("suspected_fall");
    expect(out?.reasons).toContain("firmware_trigger_outside_burst_window");
  });
});

describe("time zones and schedules", () => {
  const release = { hour: 0, minute: 15 };
  it("00:15 Asia/Ho_Chi_Minh is 17:15 UTC of the previous day", () => {
    expect(zonedToUtc("2026-10-20", "00:15", "Asia/Ho_Chi_Minh").toISOString()).toBe("2026-10-19T17:15:00.000Z");
    expect(localDayPeriod("2026-10-19", "Asia/Ho_Chi_Minh")).toEqual({ start: new Date("2026-10-18T17:00:00.000Z"), end: new Date("2026-10-19T17:00:00.000Z") });
  });
  it("reports the previous local day from the release time on", () => {
    expect(latestDueReportDate(new Date("2026-10-19T17:14:59.000Z"), "Asia/Ho_Chi_Minh", release)).toBe("2026-10-18");
    expect(latestDueReportDate(new Date("2026-10-19T17:15:00.000Z"), "Asia/Ho_Chi_Minh", release)).toBe("2026-10-19");
    expect(latestDueReportDate(new Date("2026-10-19T23:00:00.000Z"), "Asia/Ho_Chi_Minh", release)).toBe("2026-10-19");
  });
  it("handles a DST zone correctly (day of 23 hours)", () => {
    const p = localDayPeriod("2026-03-29", "Europe/Berlin");
    expect((p.end.getTime() - p.start.getTime()) / 3_600_000).toBe(23);
  });
  it("finds reminder occurrences inside their delivery window only", () => {
    const r = { times_local_json: '["08:00","23:50"]', days_of_week_json: "[1,2,3,4,5,6,7]", timezone: "Asia/Ho_Chi_Minh", start_date: "2026-10-01", end_date: null, deadline_minutes: 30 };
    expect(dueOccurrences(r, new Date("2026-10-19T01:10:00.000Z")).map((d) => d.toISOString())).toEqual(["2026-10-19T01:00:00.000Z"]);
    expect(dueOccurrences(r, new Date("2026-10-19T01:31:00.000Z"))).toEqual([]);
    // 23:50 local on the 19th is still deliverable at 00:10 local on the 20th.
    expect(dueOccurrences(r, new Date("2026-10-19T17:10:00.000Z")).map((d) => d.toISOString())).toEqual(["2026-10-19T16:50:00.000Z"]);
    expect(dueOccurrences({ ...r, days_of_week_json: "[2]" }, new Date("2026-10-19T01:10:00.000Z"))).toEqual([]); // 2026-10-19 is a Monday
  });
});

describe("daily report output validation", () => {
  const input: ReportInput = {
    schema_version: "daily-report-input.v1",
    report_date: "2026-10-18",
    timezone: "Asia/Ho_Chi_Minh",
    period_start: "2026-10-17T17:00:00.000Z",
    period_end: "2026-10-18T17:00:00.000Z",
    model_status: { fall_check: "x", drink_check: "y" },
    stats: { fall_decisions: { total: 3, unverified: 2 }, coverage: { hours_in_day: 24, hours_with_device_contact: 20 } },
    notable_events: [
      { event_id: "fdc_1", kind: "fall_decision", time_local: "08:15", status: "needs_review", verification_status: "unverified" },
      { event_id: "evt_2", kind: "drink_observation", time_local: "09:40", status: "drinking_water_observed", verification_status: "verified" },
    ],
    notable_events_truncated: false,
    data_gaps: [{ gap_id: "g1", from_local: "02:00", to_local: "06:00", hours: 4 }],
    rules: [],
  };
  const good = {
    schema_version: "daily-report-llm.v1" as const,
    summary_vi: "Ngày 18/10/2026 có 3 quyết định, 2 chưa xác minh. Lúc 08:15 cần xem lại. Thiếu dữ liệu 02:00–06:00 (4 giờ).",
    notable_events: [{ event_id: "fdc_1", note_vi: "Cần xem lại lúc 08:15." }],
    unverified_items: [{ event_id: "fdc_1", note_vi: "Chưa xác minh." }],
    data_gaps: [{ gap_id: "g1", note_vi: "Không có liên lạc thiết bị." }],
    source_event_ids: ["fdc_1"],
  };
  it("accepts output grounded in the input", () => expect(validateReportOutput(good, input)).toEqual([]));
  it("rejects invented events, gaps and numbers", () => {
    expect(validateReportOutput({ ...good, source_event_ids: ["fdc_1", "evt_x"] }, input)[0]).toContain("unknown source_event_id");
    expect(validateReportOutput({ ...good, data_gaps: [{ gap_id: "g9", note_vi: "x" }] }, input)[0]).toContain("unknown gap");
    expect(validateReportOutput({ ...good, summary_vi: "Có 7 lần ngã." }, input)[0]).toContain("numbers not present");
    expect(validateReportOutput({ ...good, unverified_items: [{ event_id: "evt_2", note_vi: "x" }], source_event_ids: ["fdc_1", "evt_2"] }, input)[0]).toContain("not an unverified");
  });
  it("requires cited events to be listed as sources", () => {
    expect(validateReportOutput({ ...good, source_event_ids: [] }, input).join(" ")).toContain("missing from source_event_ids");
  });
});

describe("configuration", () => {
  const base = {} as Env;
  it("defaults to no candidate rules, 16 kHz device audio and the 00:15 Asia/Ho_Chi_Minh schedule", () => {
    const c = loadConfig(base);
    expect(c.fusionPolicy.vision_candidate_rule).toBeNull();
    expect(c.fusionPolicy.imu_candidate_rule).toBeNull();
    expect(c.deviceAudioSampleRates).toEqual([16000]);
    expect(c.reportTimezone).toBe("Asia/Ho_Chi_Minh");
    expect(c.dailyReportLocalTime).toEqual({ hour: 0, minute: 15 });
    expect(c.acceptSimulatedSources).toBe(false);
  });
  it("rejects malformed policies and settings", () => {
    expect(() => loadConfig({ ...base, FUSION_POLICY_JSON: "{" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, FUSION_POLICY_JSON: JSON.stringify({ ...DEFAULT_FUSION_POLICY, extra: 1 }) })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, REPORT_TIMEZONE: "Mars/Base" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, FRAMES_PER_CHUNK: "1" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, ADMIN_TOKEN_SHA256: "plain-token" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, DEVICE_AUDIO_SAMPLE_RATES: "44100" })).toThrow(ConfigError);
  });
  it("has no single-source alert switches and needs at least one IMU condition", () => {
    const legacy = { ...DEFAULT_FUSION_POLICY, alert_on_imu_without_vision_candidate: true };
    expect(() => loadConfig({ ...base, FUSION_POLICY_JSON: JSON.stringify(legacy) })).toThrow(ConfigError);
    const empty = { ...IMU_TEST_RULE, min_peak_accel_g: null, min_peak_gyro_dps: null, max_min_accel_g: null };
    expect(() => loadConfig({ ...base, FUSION_POLICY_JSON: JSON.stringify({ ...DEFAULT_FUSION_POLICY, imu_candidate_rule: empty }) })).toThrow(ConfigError);
    expect(loadConfig({ ...base, FUSION_POLICY_JSON: JSON.stringify({ ...DEFAULT_FUSION_POLICY, imu_candidate_rule: IMU_TEST_RULE }) }).fusionPolicy.imu_candidate_rule?.rule_version).toBe("imu-test-trial");
  });
  it("matches IPv4/IPv6 allowlists", () => {
    expect(ipInCidrs("192.168.1.20", ["192.168.1.0/24"])).toBe(true);
    expect(ipInCidrs("192.168.2.20", ["192.168.1.0/24"])).toBe(false);
    expect(ipInCidrs("2001:db8::5", ["2001:db8::/32"])).toBe(true);
    expect(ipInCidrs("", ["0.0.0.0/0"])).toBe(false);
  });
});
