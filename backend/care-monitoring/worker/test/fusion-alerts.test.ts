/** Sensor fusion end to end through the device and agent APIs: raw IMU + vision alignment on the device
 * clock, the immediate alert path, and caregiver review. All data is synthetic and test-only. */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_TOKEN,
  BOOT_EPOCH,
  TEST_BOOT,
  TEST_TRIAL_POLICY,
  captureFixture,
  claim,
  complete,
  dbAll,
  dbFirst,
  deviceClock,
  freshDb,
  harness,
  heartbeat,
  imuBatch,
  imuEvent,
  imuSamples,
  manifestNow,
  ok,
  problemCode,
  provision,
  sendImu,
  uploadCapture,
  uptimeOf,
  visionResult,
  type Harness,
  type World,
} from "./helpers";

let h: Harness;
let w: World;
const CAPTURED = "2026-10-19T02:59:55.000Z"; // 40-frame burst until 02:59:59.875
const TRIGGER_AT = "2026-10-19T02:59:56.500Z";
const IMPACT_IN = "2026-10-19T02:59:57.000Z";

async function setup(policy: string | null) {
  await freshDb();
  h = harness(undefined, policy ? { FUSION_POLICY_JSON: policy } : {});
  h.clock.set("2026-10-19T03:00:00.000Z");
  w = await provision(h);
}

async function triggeredCapture(id: string, triggerId: string, capturedAt = CAPTURED, opts: { skipChunks?: number[]; complete?: boolean } = {}) {
  const fx = await captureFixture({ deviceId: w.deviceId, captureId: id, mode: "triggered", triggerId, capturedAt });
  return uploadCapture(h, w.deviceToken, fx, opts);
}

async function processVision(id: string, frameCount: 24 | 40, scores: number[]) {
  const job = await claim(h, w.agentToken, ["vision"]);
  expect(job?.payload.capture_id).toBe(id);
  return ok<{ decision_ids: string[]; alert_ids: string[]; fusion_pending: boolean; imu_state: string }>(
    await complete(h, w.agentToken, job!, visionResult({ captureId: id, frameCount, scores })),
  );
}

async function postImu(triggerId: string, triggeredAt = TRIGGER_AT, captureId: string | null = null) {
  return ok<{ fusion: string; event_id: string }>(
    await h.call("POST", "/api/device/v1/imu-events", { token: w.deviceToken, json: imuEvent(h, { deviceId: w.deviceId, triggerId, triggeredAt, captureId }) }),
    201,
  );
}

/** Raw IMU around the default burst; `impacts` are ISO instants of synthetic spikes. */
const imu = (impacts: string[] = [], from = "2026-10-19T02:59:50.000Z", until = "2026-10-19T03:00:00.000Z", firstSeq = 0) =>
  sendImu(h, w.deviceToken, w.deviceId, { from, until, impacts, firstSeq });

const decisions = () => dbAll<{ status: string; case_code: string; alert_decision: string; explanation_json: string }>(`SELECT status, case_code, alert_decision, explanation_json FROM fusion_decisions ORDER BY decided_at`);

describe("default policy (no approved rules: the model is NOT_CALIBRATED)", () => {
  beforeEach(() => setup(null));

  it("trigger + burst + raw IMU → needs_review (rules not configured), no alert, no buzzer", async () => {
    await postImu("trg-1");
    await imu([IMPACT_IN]);
    await triggeredCapture("cap-1", "trg-1");
    const done = await processVision("cap-1", 40, [5, 6, 7]); // high logits still mean nothing without calibration
    expect(done.alert_ids).toEqual([]);
    const [d] = await decisions();
    expect([d?.status, d?.case_code, d?.alert_decision]).toEqual(["needs_review", "rules_not_configured", "none"]);
    const explanation = JSON.parse(d!.explanation_json);
    expect(explanation.imu.state).toBe("rule_not_configured");
    expect(explanation.imu.features.peak_accel_magnitude_g).toBeGreaterThan(2);
    expect(explanation.trigger.role).toBe("starts_decision_only_not_evidence");
    expect(explanation.vision.score_semantics).toBe("uncalibrated_logit_not_probability");
    expect(await dbAll(`SELECT * FROM alerts`)).toHaveLength(0);
    expect(await dbAll(`SELECT * FROM device_commands`)).toHaveLength(0);
  });

  it("a routine burst creates evidence events but no decision, even with raw IMU", async () => {
    await imu([IMPACT_IN]);
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "n-1", capturedAt: CAPTURED });
    await uploadCapture(h, w.deviceToken, fx);
    await processVision("n-1", 24, [9]);
    expect(await dbAll(`SELECT * FROM fusion_decisions`)).toHaveLength(0);
    expect(await dbAll(`SELECT * FROM events WHERE event_type IN ('fall_check', 'drink_check')`)).toHaveLength(2);
  });

  it("a trigger without any burst waits for its grace period, then records not_enough_data (vision missing)", async () => {
    expect((await postImu("trg-alone")).fusion).toBe("waiting");
    h.clock.advance(60);
    await h.cron("* * * * *");
    expect(await dbAll(`SELECT * FROM fusion_decisions`)).toHaveLength(0);
    h.clock.advance(70);
    await h.cron("* * * * *");
    const [d] = await decisions();
    expect([d?.status, d?.case_code]).toEqual(["not_enough_data", "vision_missing"]);
    expect(d?.explanation_json).toContain("no_capture_received");
  });

  it("a processed burst without raw IMU waits for IMU, then records not_enough_data (imu missing)", async () => {
    await postImu("trg-noimu");
    await triggeredCapture("cap-noimu", "trg-noimu");
    const done = await processVision("cap-noimu", 40, [1, 1, 1]);
    expect(done.fusion_pending).toBe(true);
    expect(done.imu_state).toBe("missing");
    expect(await dbAll(`SELECT * FROM fusion_decisions`)).toHaveLength(0);
    h.clock.advance(125);
    await h.cron("* * * * *");
    const [d] = await decisions();
    expect([d?.status, d?.case_code]).toEqual(["not_enough_data", "imu_missing"]);
  });

  it("a routine burst overlapping the trigger does not pre-empt the burst recorded for it", async () => {
    // Regression (found by the real-model e2e run): a normal burst a few seconds earlier closed the trigger.
    await imu();
    const normal = await captureFixture({ deviceId: w.deviceId, captureId: "n-before", capturedAt: "2026-10-19T02:59:50.000Z" });
    await uploadCapture(h, w.deviceToken, normal);
    await processVision("n-before", 24, [0]);
    expect((await postImu("trg-d", TRIGGER_AT, "cap-d")).fusion).toBe("waiting");
    await triggeredCapture("cap-d", "trg-d");
    await processVision("cap-d", 40, [1, 2, 3]);
    const rows = await dbAll<{ capture_pk: string; case_code: string }>(`SELECT capture_pk, case_code FROM fusion_decisions`);
    expect(rows).toHaveLength(1);
    const cap = await dbFirst<{ capture_pk: string }>(`SELECT capture_pk FROM capture_sessions WHERE capture_id = 'cap-d'`);
    expect(rows[0]).toEqual({ capture_pk: cap?.capture_pk, case_code: "rules_not_configured" });
  });

  it("a terminally failed vision job decides the trigger as processing_failed", async () => {
    await postImu("trg-f");
    await triggeredCapture("cap-f", "trg-f");
    const job = await claim(h, w.agentToken, ["vision"]);
    await ok(await h.call("POST", `/api/agent/v1/jobs/${job!.job_id}/fail`, { token: w.agentToken, json: { lease_token: job!.lease_token, error_code: "vision_unavailable", retryable: false, detail: null } }));
    const [d] = await decisions();
    expect([d?.status, d?.case_code]).toEqual(["processing_failed", "vision_processing_failed"]);
    expect(d?.explanation_json).toContain("capture_failed:vision_unavailable");
  });

  it("a partial upload expires and its trigger is decided as processing_failed", async () => {
    await postImu("trg-part", TRIGGER_AT, "cap-part");
    await triggeredCapture("cap-part", "trg-part", CAPTURED, { skipChunks: [2], complete: false });
    const res = await h.call("POST", "/api/device/v1/captures/cap-part/complete", { token: w.deviceToken });
    expect(await problemCode(res)).toBe("chunks_missing");
    h.clock.advance(125);
    await h.cron("* * * * *");
    const cap = await dbFirst<{ status: string; failure_code: string; media_deleted_at: string | null }>(`SELECT status, failure_code, media_deleted_at FROM capture_sessions`);
    expect([cap?.status, cap?.failure_code, cap?.media_deleted_at !== null]).toEqual(["expired", "upload_incomplete", true]);
    const [d] = await decisions();
    expect([d?.status, d?.case_code]).toEqual(["processing_failed", "vision_processing_failed"]);
  });
});

describe("trial rules for vision and raw IMU (test values, no clinical meaning)", () => {
  beforeEach(() => setup(TEST_TRIAL_POLICY));

  it("aligned raw IMU + vision candidates raise a provisional alert and an emergency buzzer immediately, without any LLM", async () => {
    expect((await postImu("trg-a")).fusion).toBe("waiting");
    await imu([IMPACT_IN]);
    await triggeredCapture("cap-a", "trg-a");
    const done = await processVision("cap-a", 40, [-0.5, 0.4, 0.1]);
    expect(done.alert_ids).toHaveLength(1);
    const alert = await dbFirst<{ status: string; summary_vi: string; severity: string }>(`SELECT status, summary_vi, severity FROM alerts`);
    expect(alert?.status).toBe("open");
    expect(alert?.summary_vi).toContain("cần người chăm sóc xác minh");
    expect(alert?.summary_vi).toContain("ngưỡng thử");
    const decision = await dbFirst<{ status: string; case_code: string; verification_status: string }>(`SELECT status, case_code, verification_status FROM fusion_decisions`);
    expect(decision).toEqual({ status: "suspected_fall", case_code: "aligned_candidates", verification_status: "unverified" });
    const cmd = await dbFirst<{ command_type: string; priority: number; payload_json: string; status: string }>(`SELECT command_type, priority, payload_json, status FROM device_commands`);
    expect([cmd?.command_type, cmd?.priority, cmd?.status]).toEqual(["emergency_buzzer", 100, "queued"]);
    expect(JSON.parse(cmd!.payload_json)).toMatchObject({ pattern: "repeat_beep", duration_ms: 30000 });
    expect(await dbAll(`SELECT * FROM jobs WHERE kind = 'daily_report'`)).toHaveLength(0);
    expect(await dbAll(`SELECT * FROM fusion_decisions WHERE verification_status != 'unverified'`)).toHaveLength(0);
  });

  it("decides when the raw IMU arrives after the vision result", async () => {
    await postImu("trg-late");
    await triggeredCapture("cap-late", "trg-late");
    const done = await processVision("cap-late", 40, [1, 1, 1]);
    expect(done.fusion_pending).toBe(true);
    expect(await dbAll(`SELECT * FROM fusion_decisions`)).toHaveLength(0);
    await imu([IMPACT_IN]);
    expect((await dbFirst<{ case_code: string }>(`SELECT case_code FROM fusion_decisions`))?.case_code).toBe("aligned_candidates");
    expect(await dbAll(`SELECT * FROM alerts`)).toHaveLength(1);
  });

  it("an IMU match 8 s before the burst is not aligned → needs_review, no alert", async () => {
    await postImu("trg-mis");
    await imu(["2026-10-19T02:59:47.000Z"], "2026-10-19T02:59:44.000Z");
    await triggeredCapture("cap-mis", "trg-mis");
    await processVision("cap-mis", 40, [1, 1, 1]);
    const [d] = await decisions();
    expect([d?.status, d?.case_code]).toEqual(["needs_review", "candidates_not_aligned"]);
    expect(await dbAll(`SELECT * FROM alerts`)).toHaveLength(0);
  });

  it("a vision candidate with quiet raw IMU is conflicting evidence, not an alert", async () => {
    await imu();
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "n-v", capturedAt: CAPTURED });
    await uploadCapture(h, w.deviceToken, fx);
    const done = await processVision("n-v", 24, [0.8]);
    expect(done.alert_ids).toEqual([]);
    const [d] = await decisions();
    expect([d?.status, d?.case_code]).toEqual(["needs_review", "conflicting_evidence"]);
  });

  it("an IMU candidate whose burst failed to process is processing_failed, never an alert", async () => {
    await imu(["2026-10-19T02:59:56.000Z"]);
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "n-fail", capturedAt: CAPTURED });
    await uploadCapture(h, w.deviceToken, fx);
    const job = await claim(h, w.agentToken, ["vision"]);
    await ok(await h.call("POST", `/api/agent/v1/jobs/${job!.job_id}/fail`, { token: w.agentToken, json: { lease_token: job!.lease_token, error_code: "vision_unavailable", retryable: false, detail: null } }));
    const [d] = await decisions();
    expect([d?.status, d?.case_code]).toEqual(["processing_failed", "vision_processing_failed"]);
    expect(await dbAll(`SELECT * FROM alerts`)).toHaveLength(0);
  });

  it("raw IMU with holes inside the burst is not enough data once the IMU wait is over", async () => {
    await postImu("trg-hole");
    await imu([], "2026-10-19T02:59:50.000Z", "2026-10-19T02:59:56.000Z");
    await imu([], "2026-10-19T02:59:58.000Z", "2026-10-19T03:00:00.000Z", 10);
    await triggeredCapture("cap-hole", "trg-hole");
    expect((await processVision("cap-hole", 40, [1, 1, 1])).imu_state).toBe("insufficient_coverage");
    h.clock.advance(125);
    await h.cron("* * * * *");
    const [d] = await decisions();
    expect([d?.status, d?.case_code]).toEqual(["not_enough_data", "imu_insufficient_coverage"]);
    expect(await dbAll(`SELECT * FROM alerts`)).toHaveLength(0);
  });

  it("aligns on the device clock despite a wrong wall clock and network latency, and refines the boot epoch", async () => {
    // First request: 800 ms of latency and a wall clock two hours off.
    const late = { ...deviceClock(h), uptime_ms: h.clock.t - BOOT_EPOCH - 800, wall_clock_synced: true, wall_time: new Date(h.clock.t + 7_200_000).toISOString() };
    await ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: heartbeat(h, w.deviceId, late) }));
    expect((await dbFirst<{ epoch_ms: number }>(`SELECT epoch_ms FROM device_boots`))?.epoch_ms).toBe(BOOT_EPOCH + 800);
    await postImu("trg-clk");
    await imu([IMPACT_IN]);
    await triggeredCapture("cap-clk", "trg-clk");
    await processVision("cap-clk", 40, [1, 1, 1]);
    expect((await dbFirst<{ case_code: string }>(`SELECT case_code FROM fusion_decisions`))?.case_code).toBe("aligned_candidates");
    // Later zero-latency requests pulled the estimate back to the true epoch.
    expect((await dbFirst<{ epoch_ms: number; wall_offset_ms: number }>(`SELECT epoch_ms, wall_offset_ms FROM device_boots`))?.epoch_ms).toBe(BOOT_EPOCH);
    const hb = await dbFirst<{ last_heartbeat_json: string }>(`SELECT last_heartbeat_json FROM devices WHERE device_id = ?1`, w.deviceId);
    expect(hb?.last_heartbeat_json).toContain("wall clock differs");
  });

  it("never fuses raw IMU from another boot of the device", async () => {
    await postImu("trg-boot");
    await sendImu(h, w.deviceToken, w.deviceId, { from: "2026-10-19T02:59:50.000Z", until: "2026-10-19T03:00:00.000Z", impacts: [IMPACT_IN], bootId: "boot-test-0002" });
    await triggeredCapture("cap-boot", "trg-boot");
    expect((await processVision("cap-boot", 40, [1, 1, 1])).imu_state).toBe("missing");
    h.clock.advance(125);
    await h.cron("* * * * *");
    expect((await dbFirst<{ case_code: string }>(`SELECT case_code FROM fusion_decisions`))?.case_code).toBe("imu_missing");
  });

  it("deduplicates repeated incidents into one open alert and one buzzer", async () => {
    await imu([IMPACT_IN]);
    await postImu("trg-d1");
    await triggeredCapture("cap-d1", "trg-d1");
    await processVision("cap-d1", 40, [1, 1, 1]);
    h.clock.advance(31);
    // A second incident 30 s later, inside the dedup window, with its own spike and burst.
    await sendImu(h, w.deviceToken, w.deviceId, { from: "2026-10-19T03:00:20.000Z", until: "2026-10-19T03:00:31.000Z", impacts: ["2026-10-19T03:00:27.000Z"], firstSeq: 11, bootId: TEST_BOOT });
    await postImu("trg-d2", "2026-10-19T03:00:26.500Z");
    await triggeredCapture("cap-d2", "trg-d2", "2026-10-19T03:00:25.000Z");
    const second = await processVision("cap-d2", 40, [1, 1, 1]);
    expect(second.alert_ids).toEqual([]);
    expect(await dbAll<{ duplicate_count: number }>(`SELECT duplicate_count FROM alerts`)).toEqual([{ duplicate_count: 1 }]);
    expect(await dbAll(`SELECT * FROM device_commands WHERE command_type = 'emergency_buzzer'`)).toHaveLength(1);
    expect((await dbFirst<{ alert_decision: string }>(`SELECT alert_decision FROM fusion_decisions ORDER BY decided_at DESC LIMIT 1`))?.alert_decision).toBe("deduplicated");
  });

  it("caregiver workflow: acknowledge, resolve with outcome and note, review the decision; conflicts are 409", async () => {
    await postImu("trg-w");
    await imu([IMPACT_IN]);
    await triggeredCapture("cap-w", "trg-w");
    const { alert_ids, decision_ids } = await processVision("cap-w", 40, [1, 1, 1]);
    const base = `/api/app/v1/recipients/${w.recipientId}`;
    const act = (body: Record<string, unknown>) => h.call("POST", `${base}/alerts/${alert_ids[0]}/actions`, { token: w.caregiverToken, json: { review_outcome: null, note: null, ...body } });

    const [a1, a2] = await Promise.all([act({ action: "acknowledge", expected_version: 1 }), act({ action: "acknowledge", expected_version: 1 })]);
    expect([a1.status, a2.status].sort()).toEqual([200, 409]);
    expect(await problemCode(await act({ action: "start", expected_version: 1 }))).toBe("alert_state_conflict");
    expect(await problemCode(await act({ action: "resolve", expected_version: 2, review_outcome: "confirmed", note: "" }))).toBe("resolution_incomplete");
    const resolved = await ok<{ alert: { status: string; review_outcome: string } }>(await act({ action: "resolve", expected_version: 2, review_outcome: "confirmed", note: "Đã đến kiểm tra trực tiếp." }));
    expect([resolved.alert.status, resolved.alert.review_outcome]).toEqual(["resolved", "confirmed"]);

    const review = (verification: string) => h.call("POST", `${base}/fusion-decisions/${decision_ids[0]}/review`, { token: w.caregiverToken, json: { verification, note: "Kiểm tra trực tiếp." } });
    expect((await ok<{ verification_status: string }>(await review("verified"))).verification_status).toBe("verified");
    expect((await review("dismissed")).status).toBe(409);
    expect((await ok<{ duplicate: boolean }>(await review("verified"))).duplicate).toBe(true);
    const audit = await dbAll<{ action: string }>(`SELECT action FROM audit_log WHERE actor_type = 'caregiver'`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["alert.acknowledge", "alert.resolve", "decision.verified"]));
  });
});

describe("raw IMU ingest", () => {
  beforeEach(() => setup(null));
  const batch = (seq: number, from: string, until: string, over: (b: Record<string, any>) => void = () => undefined) => {
    const b = imuBatch(h, { deviceId: w.deviceId, seq, samples: imuSamples(uptimeOf(from), uptimeOf(until)) }) as Record<string, any>;
    over(b);
    return h.call("POST", "/api/device/v1/imu-batches", { token: w.deviceToken, json: b });
  };

  it("stores raw samples exactly, separate from derived values, and serves them to authorized caregivers only", async () => {
    await ok(await batch(0, "2026-10-19T02:59:58.000Z", "2026-10-19T02:59:58.990Z"), 201);
    const row = await dbFirst<{ samples_json: string; sample_count: number; start_at: string }>(`SELECT samples_json, sample_count, start_at FROM imu_batches`);
    expect(row?.sample_count).toBe(100);
    expect(JSON.parse(row!.samples_json).uptime_ms[0]).toBe(uptimeOf("2026-10-19T02:59:58.000Z"));
    expect(row?.start_at).toBe("2026-10-19T02:59:58.000Z");
    const q = `/api/app/v1/recipients/${w.recipientId}/imu-samples?device_id=${w.deviceId}&from=2026-10-19T02:59:00.000Z&to=2026-10-19T03:00:00.000Z`;
    const viewer = await ok<{ items: Array<{ samples: { ax: number[] } }>; units: Record<string, string> }>(await h.call("GET", q, { token: w.viewerToken }));
    expect(viewer.items[0]?.samples.ax).toHaveLength(100);
    expect(viewer.units).toEqual({ time: "ms_since_boot", accel: "g", gyro: "deg_per_s" });
    expect((await h.call("GET", q, { token: w.outsiderToken })).status).toBe(404);
  });

  it("rejects malformed, implausible and stale batches", async () => {
    const at = ["2026-10-19T02:59:58.000Z", "2026-10-19T02:59:58.990Z"] as const;
    expect(await problemCode(await batch(0, ...at, (b) => b.samples.ay.pop()))).toBe("imu_length_mismatch");
    expect(await problemCode(await batch(0, ...at, (b) => (b.samples.ax[3] = 40)))).toBe("imu_out_of_range");
    expect(await problemCode(await batch(0, ...at, (b) => (b.samples.uptime_ms[5] = b.samples.uptime_ms[4])))).toBe("imu_timing");
    expect(await problemCode(await batch(0, ...at, (b) => (b.clock.uptime_ms = b.samples.uptime_ms[50])))).toBe("imu_timing");
    expect((await batch(0, ...at, (b) => (b.samples.gz[2] = "NaN"))).status).toBe(422);
    expect((await batch(0, ...at, (b) => (b.source_mode = "device"))).status).toBe(201); // ACCEPT_SIMULATED_SOURCES only gates "simulated"
    h.clock.advance(7200);
    expect(await problemCode(await batch(1, ...at))).toBe("batch_too_old");
  });

  it("is idempotent per (boot, batch_seq) and flags sequence gaps and late batches", async () => {
    const first = await ok<{ created: boolean }>(await batch(0, "2026-10-19T02:59:50.000Z", "2026-10-19T02:59:50.990Z"), 201);
    expect(first.created).toBe(true);
    expect((await ok<{ created: boolean }>(await batch(0, "2026-10-19T02:59:50.000Z", "2026-10-19T02:59:50.990Z"), 200)).created).toBe(false);
    expect((await batch(0, "2026-10-19T02:59:51.000Z", "2026-10-19T02:59:51.990Z")).status).toBe(409);
    const gap = await ok<{ issues: string[] }>(await batch(3, "2026-10-19T02:59:53.000Z", "2026-10-19T02:59:53.990Z"), 201);
    expect(gap.issues.join(" ")).toContain("2 batch(es) missing");
    const lateBatch = await ok<{ issues: string[] }>(await batch(1, "2026-10-19T02:59:51.000Z", "2026-10-19T02:59:51.990Z"), 201);
    expect(lateBatch.issues.join(" ")).toContain("out of order");
  });

  it("rejects simulated sources when the deployment does not accept them", async () => {
    const res = await h.call("POST", "/api/device/v1/imu-batches", {
      token: w.deviceToken,
      json: imuBatch(h, { deviceId: w.deviceId, seq: 0, samples: imuSamples(uptimeOf("2026-10-19T02:59:58.000Z"), uptimeOf("2026-10-19T02:59:58.500Z")) }),
      envOverrides: { ACCEPT_SIMULATED_SOURCES: "false" },
    });
    expect(await problemCode(res)).toBe("simulated_source_rejected");
  });

  it("keeps a retried burst manifest idempotent although its clock block is newer", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-retry", capturedAt: CAPTURED });
    await ok(await h.call("POST", "/api/device/v1/captures", { token: w.deviceToken, json: manifestNow(h, fx) }), 201);
    h.clock.advance(2);
    const again = await ok<{ created: boolean }>(await h.call("POST", "/api/device/v1/captures", { token: w.deviceToken, json: manifestNow(h, fx) }), 200);
    expect(again.created).toBe(false);
  });

  it("purges raw IMU after IMU_RAW_RETENTION_HOURS", async () => {
    await ok(await batch(0, "2026-10-19T02:59:58.000Z", "2026-10-19T02:59:58.990Z"), 201);
    h.clock.advance(73 * 3600);
    await h.cron("* * * * *");
    expect(await dbAll(`SELECT * FROM imu_batches`)).toHaveLength(0);
  });

  it("refuses raw IMU explicitly above IMU_STORAGE_SOFT_LIMIT_MB while the rest of the device traffic keeps working", async () => {
    type Status = { storage: { d1_size_bytes: number | null; imu_storage_soft_limit_bytes: number; imu_ingest: string } };
    const before = await ok<Status>(await h.call("GET", "/api/admin/v1/status", { token: ADMIN_TOKEN }));
    expect(before.storage).toMatchObject({ imu_storage_soft_limit_bytes: 400_000_000, imu_ingest: "accepting" });
    expect(before.storage.d1_size_bytes).toBeGreaterThan(0);
    // A limit below the current database size stands in for a nearly full Free-plan database (0 refuses all).
    const full = { IMU_STORAGE_SOFT_LIMIT_MB: "0" };
    const body = imuBatch(h, { deviceId: w.deviceId, seq: 0, samples: imuSamples(uptimeOf("2026-10-19T02:59:58.000Z"), uptimeOf("2026-10-19T02:59:58.990Z")) });
    const refused = await h.call("POST", "/api/device/v1/imu-batches", { token: w.deviceToken, json: body, envOverrides: full });
    expect(refused.status).toBe(507);
    expect(refused.headers.get("retry-after")).toBe("600");
    expect(await problemCode(refused)).toBe("imu_storage_budget_exceeded");
    expect(await dbAll(`SELECT batch_pk FROM imu_batches`)).toHaveLength(0);
    // Triggers and heartbeats are not raw IMU: they are still stored.
    await ok(await h.call("POST", "/api/device/v1/imu-events", { token: w.deviceToken, json: imuEvent(h, { deviceId: w.deviceId, triggerId: "trg-full", triggeredAt: TRIGGER_AT }), envOverrides: full }), 201);
    await ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: heartbeat(h, w.deviceId), envOverrides: full }));
    const during = await ok<Status>(await h.call("GET", "/api/admin/v1/status", { token: ADMIN_TOKEN, envOverrides: full }));
    expect(during.storage.imu_ingest).toBe("refusing_storage_budget");
    // Under the limit again, the same batch is stored.
    expect((await h.call("POST", "/api/device/v1/imu-batches", { token: w.deviceToken, json: body })).status).toBe(201);
  });
});
