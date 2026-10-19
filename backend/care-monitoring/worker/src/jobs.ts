/**
 * Durable job queue for the Local AI Agent (vision inference, daily reports).
 *
 * - Claim is one UPDATE … WHERE job_id = (SELECT … LIMIT 1) RETURNING statement. D1 executes writes
 *   serially, so a job can never be leased twice. Expired leases are recovered in the same batch.
 * - A lease is a random token; media download, lease renewal, completion and failure must present it.
 * - Retries back off 5 s / 15 s / 45 s; a vision job can never outlive its media (expires_at).
 * - Completion stores events, fusion decisions, alerts and commands and marks the job completed in one
 *   D1 batch (a transaction). A repeated completion with the same idempotency key returns the stored
 *   outcome; a different result for a completed job is rejected (409).
 * - Camera media is deleted right after a successful completion or a terminal failure.
 */
import { CaptureSessionV2, DailyReportResultV1, JobFailureV1, VisionResultV1, type CaptureSession } from "./contracts";
import { deleteCaptureMedia, frameOffsets, mediaKeys, type CaptureRow } from "./captures";
import { auditStatement, bumpStreamStatement, guardStatement, isGuardFailure, type AgentPrincipal, type Ctx } from "./context";
import {
  captureWindow,
  decideFailedCapture,
  imuEvidenceFor,
  imuFinal,
  imuWaitOver,
  isDesignated,
  pendingTriggersFor,
  recipientTimezone,
  triggerInfo,
  tryDecideTrigger,
  visionStateOf,
} from "./decisions";
import { decide, planDecision, type VisionEvidence } from "./fusion";
import { HttpError, badRequest, conflict, invalid, json, notFound, readBody, readJson } from "./http";
import { notifyRecipient } from "./realtime";
import { buildReportInput, validateReportOutput, type ReportInput, type ReportRow } from "./reports";
import { canonicalJson, iso, newId, randomToken, sha256Hex } from "./util";
import { VisionResultRejected, normalizeVision } from "./vision";
import { z } from "zod";

export interface JobRow {
  job_id: string;
  kind: "vision" | "daily_report";
  recipient_id: string;
  device_id: string | null;
  capture_pk: string | null;
  report_id: string | null;
  idempotency_key: string;
  priority: number;
  status: "queued" | "processing" | "completed" | "failed" | "retry_pending" | "expired";
  payload_json: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  expires_at: string | null;
  lease_token: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  result_idempotency_key: string | null;
  result_sha256: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const BACKOFF_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ', ?1, CASE WHEN attempts <= 1 THEN '+5 seconds' WHEN attempts = 2 THEN '+15 seconds' ELSE '+45 seconds' END)`;

/** Statements that end expired leases (retry or fail) and expire jobs past their media lifetime. */
export function recoveryStatements(ctx: Ctx): D1PreparedStatement[] {
  const now = iso(ctx.clock.now());
  const db = ctx.env.DB;
  return [
    db
      .prepare(
        `UPDATE job_attempts SET ended_at = ?1, outcome = 'lease_expired', error_code = 'lease_expired'
         WHERE outcome IS NULL AND (job_id, lease_token) IN (SELECT job_id, lease_token FROM jobs WHERE status = 'processing' AND lease_expires_at <= ?1)`,
      )
      .bind(now),
    db
      .prepare(
        `UPDATE jobs SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retry_pending' END,
           next_attempt_at = ${BACKOFF_SQL}, lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
           last_error_code = 'lease_expired', last_error_detail = 'The agent did not finish or renew its lease in time.', updated_at = ?1
         WHERE status = 'processing' AND lease_expires_at <= ?1`,
      )
      .bind(now),
    db
      .prepare(
        `UPDATE jobs SET status = 'expired', last_error_code = COALESCE(last_error_code, 'media_expired'), updated_at = ?1
         WHERE status IN ('queued', 'retry_pending') AND expires_at IS NOT NULL AND expires_at <= ?1`,
      )
      .bind(now),
  ];
}

const ClaimRequest = z
  .object({
    kinds: z.array(z.enum(["vision", "daily_report"])).min(1).max(2),
    lease_seconds: z.number().int().min(30).max(900),
    defer_if_vision_pending: z.boolean(),
  })
  .strict();

export async function claimJob(ctx: Ctx, agent: AgentPrincipal): Promise<Response> {
  const body = await readJson(ctx.request, ClaimRequest);
  const now = ctx.clock.now();
  const leaseToken = randomToken("lease");
  const db = ctx.env.DB;
  const results = await db.batch([
    ...recoveryStatements(ctx),
    db
      .prepare(
        `UPDATE jobs SET status = 'processing', attempts = attempts + 1, lease_token = ?1, lease_owner = ?2, lease_expires_at = ?3, updated_at = ?4
         WHERE job_id = (
           SELECT job_id FROM jobs
           WHERE status IN ('queued', 'retry_pending') AND next_attempt_at <= ?4 AND (expires_at IS NULL OR expires_at > ?4)
             AND kind IN (SELECT value FROM json_each(?5))
             AND NOT (?6 = 1 AND kind = 'daily_report' AND EXISTS (
               SELECT 1 FROM jobs v WHERE v.kind = 'vision' AND v.status IN ('queued', 'retry_pending', 'processing')
                 AND (v.expires_at IS NULL OR v.expires_at > ?4)))
           ORDER BY priority DESC, next_attempt_at, created_at LIMIT 1)
         RETURNING *`,
      )
      .bind(leaseToken, agent.agentId, iso(new Date(now.getTime() + body.lease_seconds * 1000)), iso(now), JSON.stringify(body.kinds), body.defer_if_vision_pending ? 1 : 0),
  ]);
  ctx.exec.waitUntil(finalizeTerminalVisionJobs(ctx));
  const job = (results[results.length - 1]?.results?.[0] ?? null) as JobRow | null;
  if (!job) return json({ job: null, vision_backlog: await visionBacklog(ctx) });

  const follow: D1PreparedStatement[] = [
    db
      .prepare(`INSERT INTO job_attempts (job_id, attempt_no, agent_id, lease_token, claimed_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(job.job_id, job.attempts, agent.agentId, leaseToken, iso(now)),
  ];
  let payload: Record<string, unknown> = JSON.parse(job.payload_json) as Record<string, unknown>;
  if (job.kind === "vision" && job.capture_pk) {
    follow.push(db.prepare(`UPDATE capture_sessions SET status = 'processing' WHERE capture_pk = ?1 AND status = 'uploaded'`).bind(job.capture_pk));
    const chunkCount = Number(payload.chunk_count);
    const perChunk = Number(payload.frames_per_chunk);
    const frameCount = Number(payload.frame_count);
    const clock = payload.clock as { boot_id: string; first_uptime_ms: number; last_uptime_ms: number };
    // Read-only context: fusion with raw IMU runs in the backend; the agent only reports and logs it.
    const imu = await imuEvidenceFor(ctx, job.device_id ?? "", { bootId: clock.boot_id, from: clock.first_uptime_ms, until: clock.last_uptime_ms });
    payload = {
      ...payload,
      media: Array.from({ length: chunkCount }, (_, i) => ({
        chunk_index: i,
        path: `/api/agent/v1/jobs/${job.job_id}/media/${i}`,
        frame_start: i * perChunk,
        frame_end: Math.min(frameCount, (i + 1) * perChunk) - 1,
      })),
      imu_window: {
        boot_id: clock.boot_id,
        from_uptime_ms: clock.first_uptime_ms,
        until_uptime_ms: clock.last_uptime_ms,
        state: imu.state === "missing" || imu.state === "insufficient_coverage" || imu.state === "sensor_fault" ? imu.state : "covered",
        coverage: imu.coverage,
        batches: imu.batchIds.length,
        fused_by: "backend",
      },
    };
  } else if (job.kind === "daily_report" && job.report_id) {
    const report = await db.prepare(`SELECT * FROM daily_reports WHERE report_id = ?1`).bind(job.report_id).first<ReportRow>();
    if (!report) throw new HttpError(500, "report_missing", "Internal error", "Report row is missing.");
    const input = await buildReportInput(ctx, report);
    const snapshotSha = await sha256Hex(canonicalJson(input));
    payload = { report_id: report.report_id, input, input_snapshot_sha256: snapshotSha };
    follow.push(db.prepare(`UPDATE jobs SET payload_json = ?1 WHERE job_id = ?2 AND lease_token = ?3`).bind(JSON.stringify(payload), job.job_id, leaseToken));
  }
  await db.batch(follow);
  return json({
    job: {
      job_id: job.job_id,
      kind: job.kind,
      priority: job.priority,
      attempt: job.attempts,
      max_attempts: job.max_attempts,
      lease_token: leaseToken,
      lease_expires_at: iso(new Date(now.getTime() + body.lease_seconds * 1000)),
      expires_at: job.expires_at,
      payload,
    },
    vision_backlog: await visionBacklog(ctx),
  });
}

async function visionBacklog(ctx: Ctx): Promise<number> {
  const row = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM jobs WHERE kind = 'vision' AND status IN ('queued', 'retry_pending') AND (expires_at IS NULL OR expires_at > ?1)`,
  )
    .bind(iso(ctx.clock.now()))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function leaseHeader(ctx: Ctx): string {
  const token = ctx.request.headers.get("x-lease-token");
  if (!token || token.length < 16 || token.length > 128) throw badRequest("lease_token_required", "X-Lease-Token header is required.");
  return token;
}

async function loadLeasedJob(ctx: Ctx, agent: AgentPrincipal, jobId: string, token: string): Promise<JobRow> {
  const job = await ctx.env.DB.prepare(`SELECT * FROM jobs WHERE job_id = ?1`).bind(jobId).first<JobRow>();
  if (!job) throw notFound("Job not found.");
  if (job.lease_token !== token || job.lease_owner !== agent.agentId) throw conflict("lease_lost", "This lease is no longer held.", { current_status: job.status });
  if (job.status !== "processing") throw conflict("lease_lost", `Job is ${job.status}.`, { current_status: job.status });
  if (job.lease_expires_at && job.lease_expires_at <= iso(ctx.clock.now())) throw conflict("lease_expired", "The lease expired; claim the job again.");
  return job;
}

export async function jobMedia(ctx: Ctx, agent: AgentPrincipal, jobId: string, indexText: string): Promise<Response> {
  const job = await loadLeasedJob(ctx, agent, jobId, leaseHeader(ctx));
  if (job.kind !== "vision" || !job.capture_pk) throw notFound("This job has no media.");
  const capture = await ctx.env.DB.prepare(`SELECT capture_pk, chunk_count, media_deleted_at FROM capture_sessions WHERE capture_pk = ?1`)
    .bind(job.capture_pk)
    .first<{ capture_pk: string; chunk_count: number; media_deleted_at: string | null }>();
  const index = Number(indexText);
  if (!capture || !Number.isInteger(index) || index < 0 || index >= capture.chunk_count) throw notFound("Chunk not found.");
  if (capture.media_deleted_at) throw new HttpError(410, "media_deleted", "Gone", "Media of this capture was already deleted.");
  const key = mediaKeys(capture)[index] ?? "";
  const object = await ctx.env.MEDIA.get(key);
  if (!object) throw new HttpError(410, "media_missing", "Gone", "Chunk is not in storage (expired or deleted).");
  return new Response(object.body, { headers: { "content-type": "application/octet-stream", "content-length": String(object.size), "cache-control": "no-store" } });
}

const LeaseRequest = z.object({ lease_token: z.string().min(16).max(128), lease_seconds: z.number().int().min(30).max(900) }).strict();

export async function renewLease(ctx: Ctx, agent: AgentPrincipal, jobId: string): Promise<Response> {
  const body = await readJson(ctx.request, LeaseRequest);
  const now = ctx.clock.now();
  const job = await loadLeasedJob(ctx, agent, jobId, body.lease_token);
  let until = new Date(now.getTime() + body.lease_seconds * 1000);
  if (job.expires_at && until.toISOString() > job.expires_at) until = new Date(job.expires_at);
  const row = await ctx.env.DB.prepare(`UPDATE jobs SET lease_expires_at = ?1, updated_at = ?2 WHERE job_id = ?3 AND lease_token = ?4 AND status = 'processing' RETURNING lease_expires_at`)
    .bind(iso(until), iso(now), jobId, body.lease_token)
    .first<{ lease_expires_at: string }>();
  if (!row) throw conflict("lease_lost", "This lease is no longer held.");
  return json({ lease_expires_at: row.lease_expires_at });
}

const ReleaseRequest = z.object({ lease_token: z.string().min(16).max(128), reason: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/) }).strict();

/** Gives a job back without counting the attempt (e.g. a daily report preempted by urgent vision work). */
export async function releaseJob(ctx: Ctx, agent: AgentPrincipal, jobId: string): Promise<Response> {
  const body = await readJson(ctx.request, ReleaseRequest);
  const now = iso(ctx.clock.now());
  await loadLeasedJob(ctx, agent, jobId, body.lease_token);
  const db = ctx.env.DB;
  await db.batch([
    guardStatement(db, `SELECT 1 FROM jobs WHERE job_id = ?1 AND lease_token = ?2 AND status = 'processing'`, jobId, body.lease_token),
    db.prepare(`UPDATE job_attempts SET ended_at = ?1, outcome = 'released', error_code = ?2 WHERE job_id = ?3 AND lease_token = ?4`).bind(now, body.reason, jobId, body.lease_token),
    db
      .prepare(
        `UPDATE jobs SET status = 'queued', attempts = MAX(attempts - 1, 0), lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
           next_attempt_at = ?1, updated_at = ?1 WHERE job_id = ?2`,
      )
      .bind(now, jobId),
  ]);
  return json({ status: "queued" });
}

export async function failJob(ctx: Ctx, agent: AgentPrincipal, jobId: string): Promise<Response> {
  const body = await readJson(ctx.request, JobFailureV1);
  const now = iso(ctx.clock.now());
  const job = await loadLeasedJob(ctx, agent, jobId, body.lease_token);
  const db = ctx.env.DB;
  const terminal = !body.retryable || job.attempts >= job.max_attempts;
  await db.batch([
    guardStatement(db, `SELECT 1 FROM jobs WHERE job_id = ?1 AND lease_token = ?2 AND status = 'processing'`, jobId, body.lease_token),
    db.prepare(`UPDATE job_attempts SET ended_at = ?1, outcome = 'failed', error_code = ?2 WHERE job_id = ?3 AND lease_token = ?4`).bind(now, body.error_code, jobId, body.lease_token),
    db
      .prepare(
        `UPDATE jobs SET status = ?2, next_attempt_at = ${BACKOFF_SQL}, lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
           last_error_code = ?3, last_error_detail = ?4, updated_at = ?1 WHERE job_id = ?5`,
      )
      .bind(now, terminal ? "failed" : "retry_pending", body.error_code, body.detail, jobId),
    auditStatement(ctx, { actorType: "agent", actorId: agent.agentId, action: "job.fail", targetType: "job", targetId: jobId, recipientId: job.recipient_id, outcome: "failed", detail: { error_code: body.error_code, terminal } }),
  ]);
  if (terminal) await finalizeTerminalVisionJobs(ctx);
  if (terminal && job.kind === "daily_report" && job.report_id) {
    await db.prepare(`UPDATE daily_reports SET status = 'failed', failure_code = ?1, updated_at = ?2 WHERE report_id = ?3 AND status = 'pending'`).bind(body.error_code, now, job.report_id).run();
  }
  return json({ status: terminal ? "failed" : "retry_pending" });
}

/** Captures whose vision job ended without a result (failed or expired): close the capture, delete its
 * media now (not at media_expires_at), and let pending IMU triggers be decided with vision missing. */
export async function finalizeTerminalVisionJobs(ctx: Ctx): Promise<number> {
  const rows = await ctx.env.DB.prepare(
    `SELECT c.*, j.status AS job_status, j.last_error_code AS job_error FROM capture_sessions c JOIN jobs j ON j.capture_pk = c.capture_pk
     WHERE j.kind = 'vision' AND j.status IN ('failed', 'expired') AND c.status IN ('uploaded', 'processing') LIMIT 20`,
  ).all<CaptureRow & { job_status: string; job_error: string | null }>();
  for (const c of rows.results) {
    const status = c.job_status === "expired" ? "expired" : "failed";
    await ctx.env.DB.prepare(`UPDATE capture_sessions SET status = ?1, failure_code = ?2, finished_at = ?3 WHERE capture_pk = ?4 AND status IN ('uploaded', 'processing')`)
      .bind(status, c.job_error ?? `vision_job_${c.job_status}`, iso(ctx.clock.now()), c.capture_pk)
      .run();
    await deleteCaptureMedia(ctx, c);
    const closed = { ...c, status: status as CaptureRow["status"], failure_code: c.job_error ?? `vision_job_${c.job_status}` };
    const triggers = await pendingTriggersFor(ctx, closed);
    for (const t of triggers) await tryDecideTrigger(ctx, t, false);
    if (triggers.length === 0) await decideFailedCapture(ctx, closed);
    ctx.exec.waitUntil(notifyRecipient(ctx.env, c.recipient_id, "capture.updated", c.capture_pk));
  }
  return rows.results.length;
}

/* ------------------------------------------------------------------ completion */

export async function completeJob(ctx: Ctx, agent: AgentPrincipal, jobId: string): Promise<Response> {
  const token = leaseHeader(ctx);
  if (!(ctx.request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Unsupported media type", "Content-Type must be application/json.");
  }
  const bytes = await readBody(ctx.request, 256 * 1024);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw badRequest("invalid_json", "Body is not valid UTF-8 JSON.");
  }
  const job = await ctx.env.DB.prepare(`SELECT * FROM jobs WHERE job_id = ?1`).bind(jobId).first<JobRow>();
  if (!job) throw notFound("Job not found.");
  const resultSha = await sha256Hex(canonicalJson(raw));
  const key = (raw as { idempotency_key?: unknown })?.idempotency_key;
  if (job.status === "completed") {
    if (typeof key === "string" && key === job.result_idempotency_key) {
      if (resultSha !== job.result_sha256) throw conflict("idempotency_key_reused", "A different result was already stored under this idempotency key.");
      return json({ status: "completed", duplicate: true });
    }
    throw conflict("job_completed", "Job is already completed with another result.");
  }
  await loadLeasedJob(ctx, agent, jobId, token);
  if (job.kind === "vision") {
    const parsed = VisionResultV1.safeParse(raw);
    if (!parsed.success) throw invalid("invalid_result", `Invalid fields: ${[...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ")}`);
    return completeVision(ctx, agent, job, token, parsed.data, resultSha);
  }
  const parsed = DailyReportResultV1.safeParse(raw);
  if (!parsed.success) throw invalid("invalid_result", `Invalid fields: ${[...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ")}`);
  return completeReport(ctx, agent, job, token, parsed.data, resultSha);
}

async function onGuardFailure(ctx: Ctx, jobId: string, key: string, resultSha: string): Promise<Response> {
  const current = await ctx.env.DB.prepare(`SELECT * FROM jobs WHERE job_id = ?1`).bind(jobId).first<JobRow>();
  if (current?.status === "completed" && current.result_idempotency_key === key && current.result_sha256 === resultSha) {
    return json({ status: "completed", duplicate: true });
  }
  throw conflict("lease_lost", "The lease was lost before the result could be stored.", { current_status: current?.status ?? null });
}

function completionStatements(ctx: Ctx, job: JobRow, token: string, key: string, resultSha: string, agentId: string): D1PreparedStatement[] {
  const db = ctx.env.DB;
  const now = iso(ctx.clock.now());
  return [
    db
      .prepare(
        `UPDATE jobs SET status = 'completed', completed_at = ?1, updated_at = ?1, result_idempotency_key = ?2, result_sha256 = ?3,
           lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, last_error_code = NULL, last_error_detail = NULL WHERE job_id = ?4`,
      )
      .bind(now, key, resultSha, job.job_id),
    db.prepare(`UPDATE job_attempts SET ended_at = ?1, outcome = 'completed' WHERE job_id = ?2 AND lease_token = ?3`).bind(now, job.job_id, token),
    auditStatement(ctx, { actorType: "agent", actorId: agentId, action: `job.complete.${job.kind}`, targetType: "job", targetId: job.job_id, recipientId: job.recipient_id }),
  ];
}

async function completeVision(ctx: Ctx, agent: AgentPrincipal, job: JobRow, token: string, result: z.infer<typeof VisionResultV1>, resultSha: string): Promise<Response> {
  const db = ctx.env.DB;
  const capture = await db.prepare(`SELECT * FROM capture_sessions WHERE capture_pk = ?1`).bind(job.capture_pk).first<CaptureRow>();
  if (!capture) throw new HttpError(500, "capture_missing", "Internal error", "Capture row is missing.");
  const manifest = CaptureSessionV2.parse(JSON.parse(capture.manifest_json)) as CaptureSession;
  let normalized;
  try {
    normalized = normalizeVision(
      result,
      { capture_id: capture.capture_id, mode: capture.mode, frame_count: capture.frame_count, offsets: frameOffsets(manifest) },
      ctx.config.fusionPolicy.vision_candidate_rule,
    );
  } catch (err) {
    if (err instanceof VisionResultRejected) throw invalid("inconsistent_result", err.message);
    throw err;
  }
  const policy = ctx.config.fusionPolicy;
  const now = iso(ctx.clock.now());
  const fallId = newId("evt");
  const drinkId = newId("evt");
  const { fall, drink } = normalized;
  const window = captureWindow(capture);

  /* ---- fusion: decide every unit whose evidence is final now; leave the rest pending ---- */
  const vision: VisionEvidence = {
    state: visionStateOf(fall.classification, result.fall.status),
    eventId: fallId,
    capturePk: capture.capture_pk,
    classification: fall.classification,
    calibrationStatus: fall.calibrationStatus,
    aggregateScore: fall.aggregateScore,
    ruleVersion: fall.ruleVersion,
    window,
    observedFrom: new Date(capture.captured_at),
    observedUntil: new Date(capture.captured_until),
    missingReason: fall.processed ? null : `fall_check_${result.fall.status}${result.fall.reason ? `:${result.fall.reason}` : ""}`,
  };
  const imu = await imuEvidenceFor(ctx, capture.device_id, window);
  const imuReady = imuFinal(imu) || imuWaitOver(ctx, capture) || vision.state === "missing" || vision.state === "failed";
  const tz = await recipientTimezone(ctx, capture.recipient_id);
  const triggers = await pendingTriggersFor(ctx, capture);
  const decisionStatements: D1PreparedStatement[] = [];
  const decisions: string[] = [];
  const alerts: string[] = [];
  let knownAlert: string | null = null;
  let fallFusionStatus: "not_applicable" | "pending" = "not_applicable";
  const addPlan = async (trigger: ReturnType<typeof triggerInfo> | null, outcome: NonNullable<ReturnType<typeof decide>>) => {
    const plan = await planDecision(ctx, { recipientId: capture.recipient_id, deviceId: capture.device_id, timezone: tz, trigger, vision, imu, outcome, knownAlertId: knownAlert });
    decisionStatements.push(...plan.statements);
    decisions.push(plan.decisionId);
    if (plan.alertId) {
      if (plan.alertCreated) alerts.push(plan.alertId);
      knownAlert = plan.alertId;
    }
  };
  if (triggers.length > 0) {
    for (const t of triggers) {
      const trigger = triggerInfo(t);
      const outcome = decide(policy, { trigger, vision, imu });
      if (!outcome) continue;
      // A burst not linked to the trigger may only close it early with an alert (see isDesignated); an
      // unfinished raw IMU window keeps the trigger pending (re-evaluated when batches arrive or by cron).
      if (!isDesignated(capture, t) && !outcome.raiseAlert) continue;
      if (!imuReady) continue;
      await addPlan(trigger, outcome);
    }
  } else {
    const outcome = decide(policy, { trigger: null, vision, imu });
    const imuRuleMayStillMatch = policy.imu_candidate_rule !== null && !imuFinal(imu);
    if (outcome && imuReady) await addPlan(null, outcome);
    else if ((outcome || imuRuleMayStillMatch) && !imuReady) fallFusionStatus = "pending";
  }

  const insertEvent = db.prepare(
    `INSERT INTO events (event_id, recipient_id, device_id, capture_pk, capture_id, trigger_id, source_record_id, event_type, boot_id, uptime_from_ms,
       uptime_until_ms, observed_at, observed_until, received_at, source, source_mode, model_name, model_version, model_score, score_kind, label,
       calibration_status, classification, evidence_json, processing_status, fusion_status, summary_vi)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'vision_model', ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)`,
  );
  const statements: D1PreparedStatement[] = [
    guardStatement(db, `SELECT 1 FROM jobs WHERE job_id = ?1 AND lease_token = ?2 AND lease_owner = ?3 AND status = 'processing'`, job.job_id, token, agent.agentId),
    insertEvent.bind(
      fallId, capture.recipient_id, capture.device_id, capture.capture_pk, capture.capture_id, capture.trigger_id, `vision:${capture.capture_id}:fall`,
      "fall_check", capture.boot_id, capture.first_uptime_ms, capture.last_uptime_ms, capture.captured_at, capture.captured_until, now, capture.source_mode,
      "carelens_fall_r3d18_c3x3", result.package_version, fall.aggregateScore, fall.processed ? "uncalibrated_logit" : null, null, fall.calibrationStatus,
      fall.classification, JSON.stringify(fall.evidence), fall.processed ? "recorded" : "skipped", fallFusionStatus, fall.summaryVi,
    ),
    insertEvent.bind(
      drinkId, capture.recipient_id, capture.device_id, capture.capture_pk, capture.capture_id, capture.trigger_id, `vision:${capture.capture_id}:drink`,
      "drink_check", capture.boot_id, capture.first_uptime_ms, capture.last_uptime_ms, capture.captured_at, capture.captured_until, now, capture.source_mode,
      "carelens_drink_yolo11n_v4_rule_v12", result.package_version, null, null, drink.label, "not_calibrated", drink.classification,
      JSON.stringify(drink.evidence), drink.processed ? "recorded" : "skipped", "not_applicable", drink.summaryVi,
    ),
    ...decisionStatements,
    db.prepare(`UPDATE capture_sessions SET status = 'processed', finished_at = ?1 WHERE capture_pk = ?2`).bind(now, capture.capture_pk),
    ...completionStatements(ctx, job, token, result.idempotency_key, resultSha, agent.agentId),
    bumpStreamStatement(ctx, capture.recipient_id),
  ];
  try {
    await db.batch(statements);
  } catch (err) {
    if (isGuardFailure(err)) return onGuardFailure(ctx, job.job_id, result.idempotency_key, resultSha);
    if (err instanceof Error && /UNIQUE/i.test(err.message) && /alerts|fusion_decisions/i.test(err.message)) {
      throw conflict("concurrent_decision", "A concurrent decision or alert was stored for this device; retry the completion.");
    }
    throw err;
  }
  // Path A: the alert is committed; publish it now. The daily report (path B) is never involved.
  ctx.exec.waitUntil(notifyRecipient(ctx.env, capture.recipient_id, alerts.length > 0 ? "alert.created" : "event.created", alerts[0] ?? fallId));
  const mediaDeleted = await deleteCaptureMedia(ctx, capture);
  return json({
    status: "completed",
    duplicate: false,
    event_ids: [fallId, drinkId],
    decision_ids: decisions,
    alert_ids: alerts,
    fusion_pending: fallFusionStatus === "pending" || (triggers.length > 0 && decisions.length === 0),
    imu_state: imu.state,
    media_deleted: mediaDeleted,
  });
}

async function completeReport(
  ctx: Ctx,
  agent: AgentPrincipal,
  job: JobRow,
  token: string,
  result: z.infer<typeof DailyReportResultV1>,
  resultSha: string,
): Promise<Response> {
  const payload = JSON.parse(job.payload_json) as { input?: Record<string, unknown>; input_snapshot_sha256?: string; report_id?: string };
  if (!payload.input || !payload.input_snapshot_sha256) throw conflict("snapshot_missing", "Job has no input snapshot; claim it again.");
  if (result.input_snapshot_sha256 !== payload.input_snapshot_sha256) throw conflict("snapshot_mismatch", "The result was produced from a different input snapshot.");
  const problems = validateReportOutput(result.report, payload.input as unknown as ReportInput);
  if (problems.length > 0) throw invalid("report_rejected", problems.join("; "), { problems });
  const db = ctx.env.DB;
  const now = iso(ctx.clock.now());
  try {
    await db.batch([
      guardStatement(db, `SELECT 1 FROM jobs WHERE job_id = ?1 AND lease_token = ?2 AND lease_owner = ?3 AND status = 'processing'`, job.job_id, token, agent.agentId),
      db
        .prepare(
          `UPDATE daily_reports SET status = 'completed', stats_json = ?1, input_snapshot_sha256 = ?2, llm_report_json = ?3, model_name = ?4, model_digest = ?5,
             inference_json = ?6, generated_at = ?7, failure_code = NULL, updated_at = ?7 WHERE report_id = ?8`,
        )
        .bind(
          JSON.stringify((payload.input as { stats?: unknown }).stats ?? null),
          payload.input_snapshot_sha256,
          JSON.stringify(result.report),
          result.model.name,
          result.model.digest,
          JSON.stringify(result.inference),
          now,
          job.report_id,
        ),
      ...completionStatements(ctx, job, token, result.idempotency_key, resultSha, agent.agentId),
      bumpStreamStatement(ctx, job.recipient_id),
    ]);
  } catch (err) {
    if (isGuardFailure(err)) return onGuardFailure(ctx, job.job_id, result.idempotency_key, resultSha);
    throw err;
  }
  ctx.exec.waitUntil(notifyRecipient(ctx.env, job.recipient_id, "report.completed", job.report_id));
  return json({ status: "completed", duplicate: false, report_id: job.report_id });
}
