/** Daily reports: schedule, idempotency, deterministic input, LLM output validation, priority vs vision. */
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_TOKEN, captureFixture, claim, complete, dbAll, dbFirst, freshDb, harness, ok, problemCode, provision, uploadCapture, visionResult, type Harness, type World } from "./helpers";

let h: Harness;
let w: World;

beforeEach(async () => {
  await freshDb();
  h = harness();
  h.clock.set("2026-10-18T03:00:00.000Z"); // 10:00 local on 2026-10-18
  w = await provision(h);
  // Recipients are created "now"; move the clock so 2026-10-18 is a full past day.
  await h.env.DB.prepare(`UPDATE care_recipients SET created_at = '2026-10-17T00:00:00.000Z'`).run();
});

function reportResult(job: Record<string, any>, over: Record<string, unknown> = {}) {
  const input = job.payload.input;
  const ids = input.notable_events.map((e: { event_id: string }) => e.event_id);
  return {
    schema_version: "daily-report-result.v1",
    idempotency_key: `report-${job.job_id}`,
    input_snapshot_sha256: job.payload.input_snapshot_sha256,
    report: {
      schema_version: "daily-report-llm.v1",
      summary_vi: `Ngày ${input.report_date}: ${input.stats.captures_normal.analysed} lần chụp được phân tích. Mô hình ngã chưa hiệu chỉnh.`,
      notable_events: [],
      unverified_items: [],
      data_gaps: input.data_gaps.slice(0, 1).map((g: { gap_id: string }) => ({ gap_id: g.gap_id, note_vi: "Không có liên lạc thiết bị." })),
      source_event_ids: ids.slice(0, 0),
      ...over,
    },
    model: { name: "qwen3:4b-instruct-2507-q4_K_M", digest: "0edcdef34593", runtime: "ollama" },
    inference: { eval_count: 120, prompt_eval_count: 900, total_duration_ms: 4200, attempts: 1 },
  };
}

describe("scheduling", () => {
  it("creates exactly one job per recipient and local day, even across repeated and overlapping cron runs", async () => {
    h.clock.set("2026-10-18T17:14:00.000Z"); // 00:14 local on the 19th: 18th not yet due
    await h.cron("15 17 * * *");
    expect(await dbAll(`SELECT report_date FROM daily_reports WHERE report_date = '2026-10-18'`)).toHaveLength(0);
    h.clock.set("2026-10-18T17:15:00.000Z"); // 00:15 local
    await h.cron("15 17 * * *");
    await h.cron("15 17 * * *");
    await h.cron("* * * * *");
    const rows = await dbAll<{ recipient_id: string; report_date: string; period_start: string; period_end: string }>(
      `SELECT recipient_id, report_date, period_start, period_end FROM daily_reports WHERE report_date = '2026-10-18' ORDER BY recipient_id`,
    );
    expect(rows).toHaveLength(2); // two recipients with devices
    expect(rows[0]).toMatchObject({ period_start: "2026-10-17T17:00:00.000Z", period_end: "2026-10-18T17:00:00.000Z" });
    expect((await dbFirst<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE kind = 'daily_report' AND idempotency_key LIKE '%2026-10-18'`))?.n).toBe(2);
  });

  it("defers report work while urgent vision work is pending", async () => {
    h.clock.set("2026-10-18T17:20:00.000Z");
    await h.cron("15 17 * * *");
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-urgent", mode: "triggered", triggerId: "t-u", capturedAt: "2026-10-18T17:19:55.000Z" });
    await uploadCapture(h, w.deviceToken, fx);
    expect(await claim(h, w.agentToken, ["daily_report"], true)).toBeNull();
    const vision = await claim(h, w.agentToken, ["vision", "daily_report"]);
    expect(vision?.kind).toBe("vision");
    await ok(await complete(h, w.agentToken, vision!, visionResult({ captureId: "cap-urgent", frameCount: 40 })));
    expect((await claim(h, w.agentToken, ["daily_report"], true))?.kind).toBe("daily_report");
  });
});

describe("report input and completion", () => {
  async function dueJob() {
    h.clock.set("2026-10-18T17:20:00.000Z");
    await h.cron("15 17 * * *");
    const job = await claim(h, w.agentToken, ["daily_report"]);
    return job!;
  }

  it("hands the agent deterministic statistics, data gaps and model status, and stores a validated report", async () => {
    // One analysed capture during the day (10:00 local).
    h.clock.set("2026-10-18T03:00:00.000Z");
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-day", capturedAt: "2026-10-18T02:59:55.000Z" });
    await uploadCapture(h, w.deviceToken, fx);
    const v = await claim(h, w.agentToken, ["vision"]);
    await ok(await complete(h, w.agentToken, v!, visionResult({ captureId: "cap-day", frameCount: 24 })));

    let job = await dueJob();
    while (job.payload.input.stats.captures_normal.received === 0) {
      // the other recipient's report came first; finish it so ours is next
      await ok(await complete(h, w.agentToken, job, reportResult(job)));
      job = (await claim(h, w.agentToken, ["daily_report"]))!;
    }
    const input = job.payload.input;
    expect(input.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(input.stats.captures_normal).toEqual({ received: 1, analysed: 1, failed: 0, expired_unanalysed: 0 });
    expect(input.stats.fall_checks.uncalibrated_output).toBe(1);
    expect(input.model_status.fall_check).toContain("NOT_CALIBRATED");
    expect(input.stats.coverage.hours_in_day).toBe(24);
    expect(input.data_gaps.length).toBeGreaterThan(0); // only the 10:00 hour had device contact
    const done = await ok<{ status: string }>(await complete(h, w.agentToken, job, reportResult(job)));
    expect(done.status).toBe("completed");
    const report = await ok<{ report: { status: string; stats: unknown; ai_summary: { label_vi: string }; model: { name: string } } }>(
      await h.call("GET", `/api/app/v1/recipients/${w.recipientId}/daily-reports/2026-10-18`, { token: w.caregiverToken }),
    );
    expect(report.report.status).toBe("completed");
    expect(report.report.ai_summary.label_vi).toContain("chưa được con người xác nhận");
    expect(report.report.model.name).toBe("qwen3:4b-instruct-2507-q4_K_M");
  });

  it("rejects invented numbers, unknown events and stale snapshots; completed only once", async () => {
    const job = await dueJob();
    const invented = await complete(h, w.agentToken, job, reportResult(job, { summary_vi: "Có 17 lần ngã trong ngày." }));
    expect(await problemCode(invented)).toBe("report_rejected");
    const unknown = await complete(h, w.agentToken, job, reportResult(job, { source_event_ids: ["evt_made_up"] }));
    expect(await problemCode(unknown)).toBe("report_rejected");
    const stale = await complete(h, w.agentToken, job, { ...reportResult(job), input_snapshot_sha256: "0".repeat(64) });
    expect(await problemCode(stale)).toBe("snapshot_mismatch");
    const noInference = { ...reportResult(job), inference: { eval_count: 0, prompt_eval_count: 0, total_duration_ms: 0, attempts: 1 } };
    expect((await complete(h, w.agentToken, job, noInference)).status).toBe(422);
    expect((await dbFirst<{ status: string }>(`SELECT status FROM daily_reports WHERE report_id = ?1`, job.payload.report_id))?.status).toBe("pending");
    await ok(await complete(h, w.agentToken, job, reportResult(job)));
    expect((await ok<{ duplicate: boolean }>(await complete(h, w.agentToken, job, reportResult(job)))).duplicate).toBe(true);
  });

  it("marks the report failed after exhausting attempts, and an admin can retry it", async () => {
    let job = await dueJob();
    const reportId = job.payload.report_id;
    for (let i = 0; i < 6; i++) {
      const res = await ok<{ status: string }>(await h.call("POST", `/api/agent/v1/jobs/${job.job_id}/fail`, { token: w.agentToken, json: { lease_token: job.lease_token, error_code: "ollama_unavailable", retryable: true, detail: null } }));
      if (res.status === "failed") break;
      h.clock.advance(60);
      job = (await claim(h, w.agentToken, ["daily_report"]))!;
      while (job.payload.report_id !== reportId) job = (await claim(h, w.agentToken, ["daily_report"]))!;
    }
    expect((await dbFirst<{ status: string; failure_code: string }>(`SELECT status, failure_code FROM daily_reports WHERE report_id = ?1`, reportId))).toEqual({ status: "failed", failure_code: "ollama_unavailable" });
    await ok(await h.call("POST", `/api/admin/v1/daily-reports/${reportId}/retry`, { token: ADMIN_TOKEN }));
    expect((await dbFirst<{ status: string }>(`SELECT status FROM daily_reports WHERE report_id = ?1`, reportId))?.status).toBe("pending");
  });
});
