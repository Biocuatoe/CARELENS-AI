/**
 * MPU6050 ingest: raw sample batches (imu-batch.v1) and firmware trigger reports (imu-event.v2).
 *
 * Raw batches are stored exactly as reported (g, °/s, ms since boot) for IMU_RAW_RETENTION_HOURS. The
 * backend validates structure and plausibility and records data-quality flags (sampling gaps, rate
 * mismatch, saturation, missing or late batches); it never edits, resamples or invents samples. A trigger
 * report records that the firmware's own rule fired; it can start a fusion decision but is never evidence.
 */
import { assertSourceMode } from "./captures";
import { observeClock, uptimeToDate } from "./clock";
import { ImuBatchV1, ImuEventV2, type ImuBatch } from "./contracts";
import { auditStatement, bumpStreamStatement, requireRecipient, type CaregiverPrincipal, type Ctx, type DevicePrincipal } from "./context";
import { reevaluateForImu, tryDecideTrigger, type TriggerEventRow } from "./decisions";
import { HttpError, badRequest, conflict, forbidden, invalid, json, readJson } from "./http";
import { notifyRecipient } from "./realtime";
import { canonicalJson, iso, newId, sha256Hex } from "./util";

const AXES = ["ax", "ay", "az", "gx", "gy", "gz"] as const;
/** A single batch may span at most this long (1000 samples at ≥ 10 Hz fit easily). */
const MAX_BATCH_SPAN_MS = 120_000;
/** Ten minutes at 100 Hz in 1-second batches; keeps one response bounded. */
const MAX_LIST_BATCHES = 600;

export interface BatchCheck {
  issues: string[];
  medianIntervalMs: number | null;
}

/** Structural and plausibility checks of one batch. Throws (422) on data that cannot be real sensor output;
 * returns flags for storable-but-suspicious data. */
export function checkBatch(b: ImuBatch): BatchCheck {
  const s = b.samples;
  const n = s.uptime_ms.length;
  for (const axis of AXES) if (s[axis].length !== n) throw invalid("imu_length_mismatch", `samples.${axis} must have ${n} values like samples.uptime_ms.`);
  for (let i = 1; i < n; i++) {
    if ((s.uptime_ms[i] as number) <= (s.uptime_ms[i - 1] as number)) throw invalid("imu_timing", `samples.uptime_ms must strictly increase (index ${i}).`);
  }
  const first = s.uptime_ms[0] as number;
  const last = s.uptime_ms[n - 1] as number;
  if (last > b.clock.uptime_ms) throw invalid("imu_timing", "samples cannot be later than clock.uptime_ms (the time the request was built).");
  if (last - first > MAX_BATCH_SPAN_MS) throw invalid("imu_timing", `a batch may span at most ${MAX_BATCH_SPAN_MS} ms.`);
  const accelLimit = b.accel_range_g * 1.05;
  const gyroLimit = b.gyro_range_dps * 1.05;
  for (const axis of ["ax", "ay", "az"] as const) if (s[axis].some((v) => Math.abs(v) > accelLimit)) throw invalid("imu_out_of_range", `samples.${axis} exceeds ±${b.accel_range_g} g.`);
  for (const axis of ["gx", "gy", "gz"] as const) if (s[axis].some((v) => Math.abs(v) > gyroLimit)) throw invalid("imu_out_of_range", `samples.${axis} exceeds ±${b.gyro_range_dps} °/s.`);

  const issues: string[] = [];
  let median: number | null = null;
  if (n >= 2) {
    const intervals = s.uptime_ms.slice(1).map((t, i) => t - (s.uptime_ms[i] as number)).sort((a, z) => a - z);
    median = intervals[Math.floor(intervals.length / 2)] ?? null;
    const expected = 1000 / b.sample_rate_hz;
    if (median !== null && Math.abs(median - expected) > expected * 0.2) issues.push(`median interval ${median} ms disagrees with sample_rate_hz ${b.sample_rate_hz}`);
    const gaps = intervals.filter((d) => d > expected * 3).length;
    if (gaps > 0) issues.push(`${gaps} sampling gap(s) longer than 3 sample periods`);
  }
  const saturated = (["ax", "ay", "az"] as const).some((axis) => s[axis].some((v) => Math.abs(v) >= b.accel_range_g));
  if (saturated) issues.push("accelerometer reached its configured range (values may be clipped)");
  return { issues, medianIntervalMs: median };
}

export async function ingestImuBatch(ctx: Ctx, device: DevicePrincipal): Promise<Response> {
  const body = await readJson(ctx.request, ImuBatchV1, 256 * 1024);
  if (body.device_id !== device.deviceId) throw forbidden("device_mismatch", "device_id does not match the credential.");
  assertSourceMode(ctx, body.source_mode);
  const check = checkBatch(body);
  const boot = await observeClock(ctx, device.deviceId, body.clock);
  const now = ctx.clock.now();
  const first = body.samples.uptime_ms[0] as number;
  const last = body.samples.uptime_ms[body.samples.uptime_ms.length - 1] as number;
  const endAt = uptimeToDate(boot.epochMs, last);
  if (now.getTime() - endAt.getTime() > ctx.config.imuMaxBatchAgeSeconds * 1000) {
    throw invalid("batch_too_old", `The batch ended more than IMU_MAX_BATCH_AGE_SECONDS (${ctx.config.imuMaxBatchAgeSeconds}) ago.`);
  }
  const contentSha = await sha256Hex(canonicalJson(body.samples));
  const db = ctx.env.DB;
  const [existing, prev] = await db.batch([
    db.prepare(`SELECT batch_pk, content_sha256 FROM imu_batches WHERE device_id = ?1 AND boot_id = ?2 AND batch_seq = ?3`).bind(device.deviceId, body.clock.boot_id, body.batch_seq),
    db.prepare(`SELECT MAX(batch_seq) AS max_seq FROM imu_batches WHERE device_id = ?1 AND boot_id = ?2`).bind(device.deviceId, body.clock.boot_id),
  ]);
  const dup = existing?.results?.[0] as { batch_pk: string; content_sha256: string } | undefined;
  if (dup) {
    if (dup.content_sha256 !== contentSha) throw conflict("batch_seq_reused", "batch_seq was already used in this boot with different samples.");
    return json({ created: false, batch_id: dup.batch_pk });
  }
  // A full D1 database refuses every write, alerts included. Raw IMU is the only bulk writer (100 Hz JSON is
  // hundreds of MB per day), so it is refused first and explicitly, while captures, triggers, decisions, alerts
  // and commands keep working. Retention (IMU_RAW_RETENTION_HOURS) frees space again.
  const limitBytes = ctx.config.imuStorageSoftLimitMb * 1_000_000;
  if (limitBytes === 0 || (existing?.meta?.size_after ?? 0) > limitBytes) {
    throw new HttpError(
      507,
      "imu_storage_budget_exceeded",
      "Insufficient storage",
      "Raw IMU storage is over IMU_STORAGE_SOFT_LIMIT_MB; batches are refused until retention frees space. Captures, triggers and commands are unaffected.",
      { "retry-after": "600" },
    );
  }
  const maxSeq = (prev?.results?.[0] as { max_seq: number | null } | undefined)?.max_seq ?? null;
  const issues = [...check.issues, ...boot.issues];
  let gapBefore = 0;
  if (maxSeq === null && body.batch_seq > 0) issues.push(`first batch seen for this boot has batch_seq ${body.batch_seq}`);
  if (maxSeq !== null && body.batch_seq > maxSeq + 1) {
    gapBefore = body.batch_seq - maxSeq - 1;
    issues.push(`${gapBefore} batch(es) missing before batch_seq ${body.batch_seq}`);
  }
  if (maxSeq !== null && body.batch_seq < maxSeq) issues.push("batch arrived out of order (late retry)");

  const batchPk = newId("imu");
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO imu_batches (batch_pk, device_id, recipient_id, source_mode, boot_id, batch_seq, sensor, sample_rate_hz, accel_range_g, gyro_range_dps,
             first_uptime_ms, last_uptime_ms, start_at, end_at, sample_count, samples_json, seq_gap_before, validation_json, content_sha256, received_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)`,
        )
        .bind(
          batchPk,
          device.deviceId,
          device.recipientId,
          body.source_mode,
          body.clock.boot_id,
          body.batch_seq,
          body.sensor,
          body.sample_rate_hz,
          body.accel_range_g,
          body.gyro_range_dps,
          first,
          last,
          iso(uptimeToDate(boot.epochMs, first)),
          iso(endAt),
          body.samples.uptime_ms.length,
          JSON.stringify(body.samples),
          gapBefore,
          JSON.stringify({ issues, median_interval_ms: check.medianIntervalMs, units: body.units }),
          contentSha,
          iso(now),
        ),
    ]);
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw conflict("batch_seq_reused", "batch_seq was stored concurrently.");
    throw err;
  }
  const decided = await reevaluateForImu(ctx, device.deviceId, body.clock.boot_id, first, last);
  return json({ created: true, batch_id: batchPk, sample_count: body.samples.uptime_ms.length, issues, decisions_made: decided }, 201);
}

export async function ingestImuEvent(ctx: Ctx, device: DevicePrincipal): Promise<Response> {
  const body = await readJson(ctx.request, ImuEventV2, 16 * 1024);
  if (body.device_id !== device.deviceId) throw forbidden("device_mismatch", "device_id does not match the credential.");
  assertSourceMode(ctx, body.source_mode);
  if (body.trigger.triggered_uptime_ms > body.clock.uptime_ms) throw invalid("trigger_timing", "triggered_uptime_ms cannot be later than clock.uptime_ms.");
  const boot = await observeClock(ctx, device.deviceId, body.clock);
  const now = ctx.clock.now();
  const triggeredAt = uptimeToDate(boot.epochMs, body.trigger.triggered_uptime_ms);
  if (now.getTime() - triggeredAt.getTime() > 86_400_000) throw invalid("event_too_old", "The trigger is older than 24 h.");

  const contentSha = await sha256Hex(canonicalJson({ trigger: body.trigger, boot_id: body.clock.boot_id, source_mode: body.source_mode }));
  const sourceRecordId = `imu:${body.trigger.trigger_id}`;
  const existing = await ctx.env.DB.prepare(`SELECT event_id, evidence_json FROM events WHERE device_id = ?1 AND source_record_id = ?2`)
    .bind(device.deviceId, sourceRecordId)
    .first<{ event_id: string; evidence_json: string }>();
  if (existing) {
    const prior = JSON.parse(existing.evidence_json) as { content_sha256?: string };
    if (prior.content_sha256 !== contentSha) throw conflict("trigger_id_reused", "trigger_id was already used with different content.");
    return json({ created: false, event_id: existing.event_id });
  }
  const eventId = newId("evt");
  try {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `INSERT INTO events (event_id, recipient_id, device_id, capture_id, trigger_id, source_record_id, event_type, boot_id, uptime_from_ms, uptime_until_ms,
           observed_at, received_at, source, source_mode, label, calibration_status, classification, evidence_json, processing_status, fusion_status, summary_vi)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'imu_trigger', ?7, ?8, ?8, ?9, ?10, 'imu_sensor', ?11, ?12, 'not_applicable', 'imu_trigger_reported', ?13, 'recorded', 'pending', ?14)`,
      ).bind(
        eventId,
        device.recipientId,
        device.deviceId,
        body.trigger.capture_id,
        body.trigger.trigger_id,
        sourceRecordId,
        body.clock.boot_id,
        body.trigger.triggered_uptime_ms,
        iso(triggeredAt),
        iso(now),
        body.source_mode,
        body.trigger.trigger_type,
        JSON.stringify({
          content_sha256: contentSha,
          trigger_type: body.trigger.trigger_type,
          firmware_rule_version: body.trigger.firmware_rule_version,
          device_metrics: body.trigger.device_metrics,
          device_metrics_note: "computed by firmware; unvalidated and not used for decisions",
          clock_issues: boot.issues,
        }),
        `Thiết bị báo cảm biến chuyển động kích hoạt "${body.trigger.trigger_type}" theo quy tắc firmware ${body.trigger.firmware_rule_version}. Chưa phải kết luận ngã.`,
      ),
      auditStatement(ctx, { actorType: "device", actorId: device.deviceId, action: "imu.trigger", targetType: "event", targetId: eventId, recipientId: device.recipientId }),
      bumpStreamStatement(ctx, device.recipientId),
    ]);
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw conflict("trigger_id_reused", "trigger_id was already used.");
    throw err;
  }
  const row = await ctx.env.DB.prepare(`SELECT * FROM events WHERE event_id = ?1`).bind(eventId).first<TriggerEventRow>();
  const fusion = row ? await tryDecideTrigger(ctx, row, false) : "waiting";
  ctx.exec.waitUntil(notifyRecipient(ctx.env, device.recipientId, "event.created", eventId));
  return json({ created: true, event_id: eventId, fusion }, 201);
}

/** Caregiver investigation: raw samples of one device between two instants (server-estimated time). */
export async function listImu(ctx: Ctx, user: CaregiverPrincipal, recipientId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  const deviceId = ctx.url.searchParams.get("device_id");
  const from = ctx.url.searchParams.get("from");
  const to = ctx.url.searchParams.get("to");
  const f = from ? Date.parse(from) : NaN;
  const t = to ? Date.parse(to) : NaN;
  if (!deviceId || Number.isNaN(f) || Number.isNaN(t) || t <= f) throw badRequest("invalid_range", "device_id, from and to (ISO instants, from < to) are required.");
  if (t - f > 10 * 60_000) throw badRequest("range_too_long", "At most 10 minutes of raw samples per request.");
  const rows = await ctx.env.DB.prepare(
    `SELECT batch_pk, boot_id, batch_seq, sample_rate_hz, accel_range_g, gyro_range_dps, first_uptime_ms, last_uptime_ms, start_at, end_at, sample_count,
            samples_json, seq_gap_before, validation_json, source_mode
     FROM imu_batches WHERE recipient_id = ?1 AND device_id = ?2 AND end_at >= ?3 AND start_at <= ?4 ORDER BY boot_id, first_uptime_ms LIMIT ?5`,
  )
    .bind(recipientId, deviceId, iso(new Date(f)), iso(new Date(t)), MAX_LIST_BATCHES)
    .all<Record<string, unknown>>();
  return json({
    units: { time: "ms_since_boot", accel: "g", gyro: "deg_per_s" },
    time_note: "start_at/end_at are server estimates; uptime_ms is the device's monotonic clock and is only comparable within one boot_id",
    retention_hours: ctx.config.imuRawRetentionHours,
    items: rows.results.map(({ samples_json, validation_json, ...rest }) => ({
      ...rest,
      samples: JSON.parse(String(samples_json)),
      validation: JSON.parse(String(validation_json)),
    })),
  });
}
