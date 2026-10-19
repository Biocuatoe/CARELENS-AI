/**
 * Cron work. "* * * * *" runs maintenance; "15 17 * * *" (00:15 Asia/Ho_Chi_Minh) creates daily
 * report jobs. Every step is idempotent and bounded so one run stays within the Workers Free limit of
 * 50 D1 queries per invocation; leftovers are picked up a minute later.
 */
import { deleteCaptureMedia, type CaptureRow } from "./captures";
import { commandHousekeepingStatements } from "./commands";
import type { Ctx } from "./context";
import { decideOverdue } from "./decisions";
import { finalizeTerminalVisionJobs, recoveryStatements } from "./jobs";
import { queueDueReminders } from "./reminders";
import { ensureDailyReportJobs } from "./reports";
import { addSeconds, iso } from "./util";

export const DAILY_REPORT_CRON = "15 17 * * *";
export const MAINTENANCE_CRON = "* * * * *";

export interface MaintenanceResult {
  expired_uploads: number;
  media_deleted: number;
  finalized_vision_jobs: number;
  decisions_made: number;
  reminders_queued: number;
  report_jobs_created: number;
  imu_batches_purged: number;
  stream_tickets_purged: number;
}

/** Retention: raw IMU older than IMU_RAW_RETENTION_HOURS and used/expired stream tickets. Bounded per run. */
async function purgeExpired(ctx: Ctx): Promise<{ imu: number; tickets: number }> {
  const now = ctx.clock.now();
  const db = ctx.env.DB;
  const [imu, tickets] = await db.batch([
    db
      .prepare(`DELETE FROM imu_batches WHERE batch_pk IN (SELECT batch_pk FROM imu_batches WHERE end_at < ?1 ORDER BY end_at LIMIT 500)`)
      .bind(iso(addSeconds(now, -ctx.config.imuRawRetentionHours * 3600))),
    db.prepare(`DELETE FROM stream_tickets WHERE ticket_sha256 IN (SELECT ticket_sha256 FROM stream_tickets WHERE expires_at < ?1 LIMIT 500)`).bind(iso(addSeconds(now, -3600))),
    db.prepare(`DELETE FROM oauth_states WHERE state_sha256 IN (SELECT state_sha256 FROM oauth_states WHERE expires_at < ?1 LIMIT 500)`).bind(iso(addSeconds(now, -3600))),
    db.prepare(`DELETE FROM login_exchanges WHERE code_sha256 IN (SELECT code_sha256 FROM login_exchanges WHERE expires_at < ?1 LIMIT 500)`).bind(iso(addSeconds(now, -3600))),
  ]);
  return { imu: imu?.meta?.changes ?? 0, tickets: tickets?.meta?.changes ?? 0 };
}

/** Captures whose media must go now: upload window over without complete, or media lifetime over. */
async function expireMedia(ctx: Ctx): Promise<{ expiredUploads: number; deleted: number }> {
  const now = ctx.clock.now();
  const db = ctx.env.DB;
  const uploadCutoff = iso(addSeconds(now, -ctx.config.uploadSessionTtlSeconds));
  const [incomplete, overdue] = await db.batch([
    db
      .prepare(
        `UPDATE capture_sessions SET status = 'expired', failure_code = 'upload_incomplete', finished_at = ?1
         WHERE status = 'receiving' AND received_at <= ?2 RETURNING capture_pk, chunk_count`,
      )
      .bind(iso(now), uploadCutoff),
    db
      .prepare(
        `UPDATE capture_sessions SET status = CASE WHEN status IN ('uploaded', 'processing', 'receiving') THEN 'expired' ELSE status END,
           failure_code = CASE WHEN status IN ('uploaded', 'processing', 'receiving') THEN 'media_expired_before_analysis' ELSE failure_code END,
           finished_at = COALESCE(finished_at, ?1)
         WHERE media_deleted_at IS NULL AND media_expires_at <= ?1 RETURNING capture_pk, chunk_count`,
      )
      .bind(iso(now)),
  ]);
  const toDelete = new Map<string, Pick<CaptureRow, "capture_pk" | "chunk_count">>();
  for (const r of [...(incomplete?.results ?? []), ...(overdue?.results ?? [])] as Array<Pick<CaptureRow, "capture_pk" | "chunk_count">>) toDelete.set(r.capture_pk, r);
  // Earlier deletions that failed (R2 error) on finished captures.
  const retry = await db
    .prepare(`SELECT capture_pk, chunk_count FROM capture_sessions WHERE media_deleted_at IS NULL AND status IN ('processed', 'failed', 'expired') LIMIT 10`)
    .all<Pick<CaptureRow, "capture_pk" | "chunk_count">>();
  for (const r of retry.results) toDelete.set(r.capture_pk, r);
  let deleted = 0;
  for (const c of [...toDelete.values()].slice(0, 15)) if (await deleteCaptureMedia(ctx, c)) deleted++;
  // Jobs of captures that just expired can no longer run.
  await db
    .prepare(
      `UPDATE jobs SET status = 'expired', last_error_code = 'media_expired', updated_at = ?1
       WHERE kind = 'vision' AND status IN ('queued', 'retry_pending', 'processing')
         AND capture_pk IN (SELECT capture_pk FROM capture_sessions WHERE status = 'expired')`,
    )
    .bind(iso(now))
    .run();
  return { expiredUploads: incomplete?.results?.length ?? 0, deleted };
}

export async function runMaintenance(ctx: Ctx, opts: { includeReports: boolean }): Promise<MaintenanceResult> {
  await ctx.env.DB.batch([...recoveryStatements(ctx), ...commandHousekeepingStatements(ctx, null)]);
  const media = await expireMedia(ctx);
  const finalized = await finalizeTerminalVisionJobs(ctx);
  const decided = await decideOverdue(ctx);
  const reminders = await queueDueReminders(ctx);
  const reports = opts.includeReports ? await ensureDailyReportJobs(ctx) : 0;
  const purged = await purgeExpired(ctx);
  return {
    expired_uploads: media.expiredUploads,
    media_deleted: media.deleted,
    finalized_vision_jobs: finalized,
    decisions_made: decided,
    reminders_queued: reminders,
    report_jobs_created: reports,
    imu_batches_purged: purged.imu,
    stream_tickets_purged: purged.tickets,
  };
}
