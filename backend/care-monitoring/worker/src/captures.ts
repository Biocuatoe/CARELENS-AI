/**
 * Camera burst upload: manifest → chunks → complete.
 *
 * A capture (burst, segment) is 24 frames (normal) or 40 frames (triggered) at a nominal 8 fps, recorded
 * without a camera-off interval. The device first posts a manifest (per-frame sequence, monotonic capture
 * time, size and SHA-256; no pixels), then PUTs the frames in chunks of FRAMES_PER_CHUNK (default 8) using
 * the Vision package body format, then calls complete. Cadence is only checked inside one burst; frames of
 * different bursts are never joined. Chunks go to the private MEDIA bucket under
 * media/<capture_pk>/chunk-<i>; D1 never sees image bytes. Media is deleted after inference, after terminal
 * failure, or at media_expires_at, whichever comes first.
 */
import { observeClock, uptimeToDate } from "./clock";
import { CaptureSessionV2, type CaptureSession } from "./contracts";
import { auditStatement, bumpStreamStatement, guardStatement, isGuardFailure, type Ctx, type DevicePrincipal } from "./context";
import { HttpError, conflict, forbidden, invalid, json, notFound, readBody, readJson } from "./http";
import { MAX_FRAME_BYTES, MAX_FRAME_HEIGHT, MAX_FRAME_WIDTH, inspectJpeg, unpackFrames } from "./media";
import { notifyAgents } from "./realtime";
import { addSeconds, canonicalJson, iso, newId, sha256Hex } from "./util";
import { windowPlan } from "./vision";

export const NOMINAL_INTERVAL_MS = 125;
/** An interval longer than 1.5 frame periods means at least one frame is missing. */
export const GAP_INTERVAL_MS = 187;
export const VISION_PRIORITY = { triggered: 100, normal: 50 } as const;
const VISION_MAX_ATTEMPTS = 3;

export interface CaptureRow {
  capture_pk: string;
  device_id: string;
  recipient_id: string;
  capture_id: string;
  source_mode: "device" | "simulated";
  mode: "normal" | "triggered";
  boot_id: string;
  first_uptime_ms: number;
  last_uptime_ms: number;
  captured_at: string;
  captured_until: string;
  frame_count: number;
  frame_width: number;
  frame_height: number;
  frames_per_chunk: number;
  chunk_count: number;
  chunks_received: number;
  manifest_json: string;
  manifest_sha256: string;
  trigger_id: string | null;
  trigger_frame_index: number | null;
  cadence_status: "ok" | "out_of_tolerance" | "gap";
  validation_json: string;
  status: "receiving" | "uploaded" | "processing" | "processed" | "failed" | "expired";
  failure_code: string | null;
  total_bytes: number;
  received_at: string;
  uploaded_at: string | null;
  finished_at: string | null;
  media_expires_at: string;
  media_deleted_at: string | null;
}

export function chunkKey(capturePk: string, index: number): string {
  return `media/${capturePk}/chunk-${index}`;
}

export function mediaKeys(capture: Pick<CaptureRow, "capture_pk" | "chunk_count">): string[] {
  return Array.from({ length: capture.chunk_count }, (_, i) => chunkKey(capture.capture_pk, i));
}

export interface CadenceReport {
  status: "ok" | "out_of_tolerance" | "gap";
  minIntervalMs: number;
  maxIntervalMs: number;
  issues: string[];
}

/** Cadence check against the nominal 8 fps (125 ms). Tolerance is configurable (default ±40 ms). */
export function checkCadence(offsets: number[], toleranceMs: number): CadenceReport {
  const intervals = offsets.slice(1).map((t, i) => t - (offsets[i] ?? 0));
  const issues: string[] = [];
  let status: CadenceReport["status"] = "ok";
  intervals.forEach((d, i) => {
    if (d > GAP_INTERVAL_MS) {
      status = "gap";
      issues.push(`gap of ${d} ms between frames ${i} and ${i + 1}`);
    } else if (Math.abs(d - NOMINAL_INTERVAL_MS) > toleranceMs) {
      if (status === "ok") status = "out_of_tolerance";
      issues.push(`interval ${d} ms between frames ${i} and ${i + 1} outside ${NOMINAL_INTERVAL_MS}±${toleranceMs} ms`);
    }
  });
  return { status, minIntervalMs: Math.min(...intervals), maxIntervalMs: Math.max(...intervals), issues: issues.slice(0, 20) };
}

function framesInChunk(row: Pick<CaptureRow, "frame_count" | "frames_per_chunk">, index: number): number {
  return Math.min(row.frames_per_chunk, row.frame_count - index * row.frames_per_chunk);
}

function captureView(row: CaptureRow): Record<string, unknown> {
  const received = Array.from({ length: row.chunk_count }, (_, i) => i).filter((i) => (row.chunks_received & (1 << i)) !== 0);
  return {
    capture_id: row.capture_id,
    mode: row.mode,
    status: row.status,
    failure_code: row.failure_code,
    frame_count: row.frame_count,
    boot_id: row.boot_id,
    first_uptime_ms: row.first_uptime_ms,
    last_uptime_ms: row.last_uptime_ms,
    captured_at: row.captured_at,
    captured_until: row.captured_until,
    cadence_status: row.cadence_status,
    validation: JSON.parse(row.validation_json),
    chunks_received: received,
    chunk_count: row.chunk_count,
    received_at: row.received_at,
    uploaded_at: row.uploaded_at,
    finished_at: row.finished_at,
    media_expires_at: row.media_expires_at,
    media_deleted: row.media_deleted_at !== null,
  };
}

function uploadPlan(ctx: Ctx, row: CaptureRow): Record<string, unknown> {
  return {
    frames_per_chunk: row.frames_per_chunk,
    chunk_count: row.chunk_count,
    chunk_path_template: `/api/device/v1/captures/${encodeURIComponent(row.capture_id)}/chunks/{index}`,
    complete_path: `/api/device/v1/captures/${encodeURIComponent(row.capture_id)}/complete`,
    max_chunk_bytes: row.frames_per_chunk * (MAX_FRAME_BYTES + 4),
    body_format: "repeated [uint32 little-endian length][JPEG bytes], frames in sequence order",
    upload_deadline: iso(addSeconds(new Date(row.received_at), ctx.config.uploadSessionTtlSeconds)),
  };
}

export function assertSourceMode(ctx: Ctx, mode: "device" | "simulated"): void {
  if (mode === "simulated" && !ctx.config.acceptSimulatedSources) {
    throw forbidden("simulated_source_rejected", "This deployment does not accept source_mode=simulated.");
  }
}

async function loadCapture(ctx: Ctx, deviceId: string, captureId: string): Promise<CaptureRow> {
  const row = await ctx.env.DB.prepare(`SELECT * FROM capture_sessions WHERE device_id = ?1 AND capture_id = ?2`).bind(deviceId, captureId).first<CaptureRow>();
  if (!row) throw notFound("Capture not found.");
  return row;
}

/** Frame times relative to frame 0, as the Vision package and the agent use them. */
export function frameOffsets(manifest: Pick<CaptureSession, "frames">): number[] {
  const t0 = manifest.frames[0]?.uptime_ms ?? 0;
  return manifest.frames.map((f) => f.uptime_ms - t0);
}

/** A burst never spans more than this (40 frames at 8 fps take 5 s; the rest is slack for slow frames). */
const MAX_BURST_SPAN_MS = 60_000;

export async function createCapture(ctx: Ctx, device: DevicePrincipal): Promise<Response> {
  const body = await readJson(ctx.request, CaptureSessionV2, 32 * 1024);
  if (body.device_id !== device.deviceId) throw forbidden("device_mismatch", "device_id does not match the credential.");
  assertSourceMode(ctx, body.source_mode);
  const expectedCount = body.mode === "normal" ? 24 : 40;
  if (body.frame_count !== expectedCount) throw invalid("frame_count_mode_mismatch", `mode=${body.mode} requires frame_count=${expectedCount}.`);
  if (body.frames.length !== body.frame_count) throw invalid("frame_list_length", "frames must list exactly frame_count entries.");
  if (body.frames.some((f, i) => f.seq !== i)) throw invalid("invalid_sequence", "frames must have seq 0..frame_count-1 in order, without duplicates or gaps.");
  for (let i = 1; i < body.frames.length; i++) {
    if ((body.frames[i]?.uptime_ms ?? 0) <= (body.frames[i - 1]?.uptime_ms ?? 0)) {
      throw invalid("invalid_timing", `frames[].uptime_ms must strictly increase (frame ${i}).`);
    }
  }
  const firstUptime = body.frames[0]?.uptime_ms ?? 0;
  const lastUptime = body.frames[body.frames.length - 1]?.uptime_ms ?? 0;
  if (lastUptime > body.clock.uptime_ms) throw invalid("invalid_timing", "frames cannot be later than clock.uptime_ms (the time the manifest was built).");
  if (lastUptime - firstUptime > MAX_BURST_SPAN_MS) throw invalid("invalid_timing", `A burst may span at most ${MAX_BURST_SPAN_MS} ms; split longer recordings.`);
  if (body.mode === "triggered" && body.trigger_id === null) throw invalid("trigger_required", "A triggered capture needs trigger_id.");
  if (body.mode === "normal" && (body.trigger_id !== null || body.trigger_frame_index !== null)) {
    throw invalid("trigger_not_allowed", "A normal capture carries no trigger.");
  }
  if (body.trigger_frame_index !== null && body.trigger_frame_index >= body.frame_count) throw invalid("invalid_trigger_frame", "trigger_frame_index is out of range.");
  if (body.frame_width > MAX_FRAME_WIDTH || body.frame_height > MAX_FRAME_HEIGHT) throw invalid("frame_too_large", "Frames must be at most 640×480.");

  const now = ctx.clock.now();
  const boot = await observeClock(ctx, device.deviceId, body.clock);
  const capturedAt = uptimeToDate(boot.epochMs, firstUptime);
  if (now.getTime() - capturedAt.getTime() > ctx.config.maxCaptureAgeSeconds * 1000) throw invalid("capture_too_old", "The burst is older than MAX_CAPTURE_AGE_SECONDS; old media is not accepted.");

  // Idempotency covers what the burst is, not when the request was rebuilt: a retried manifest carries a
  // newer clock.uptime_ms but the same frames.
  const manifestSha = await sha256Hex(canonicalJson({ ...body, clock: { boot_id: body.clock.boot_id } }));
  const existing = await ctx.env.DB.prepare(`SELECT * FROM capture_sessions WHERE device_id = ?1 AND capture_id = ?2`)
    .bind(device.deviceId, body.capture_id)
    .first<CaptureRow>();
  if (existing) {
    if (existing.manifest_sha256 !== manifestSha) throw conflict("capture_id_reused", "capture_id was already used with a different manifest.");
    return json({ created: false, capture: captureView(existing), upload: uploadPlan(ctx, existing) });
  }

  const limit = body.mode === "normal" ? ctx.config.maxNormalCapturesPerHour : ctx.config.maxTriggeredCapturesPerHour;
  const recent = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM capture_sessions WHERE device_id = ?1 AND mode = ?2 AND received_at >= ?3`)
    .bind(device.deviceId, body.mode, iso(addSeconds(now, -3600)))
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= limit) {
    throw new HttpError(429, "capture_quota_exceeded", "Too many captures", `At most ${limit} ${body.mode} captures per hour are accepted.`, { "retry-after": "60" });
  }

  const offsets = frameOffsets(body);
  const cadence = checkCadence(offsets, ctx.config.cadenceToleranceMs);
  const capturePk = newId("cap");
  const framesPerChunk = ctx.config.framesPerChunk;
  const chunkCount = Math.ceil(body.frame_count / framesPerChunk);
  const capturedUntil = uptimeToDate(boot.epochMs, lastUptime);
  const validation = {
    cadence_tolerance_ms: ctx.config.cadenceToleranceMs,
    min_interval_ms: cadence.minIntervalMs,
    max_interval_ms: cadence.maxIntervalMs,
    issues: [...cadence.issues, ...boot.issues],
    time_basis: "captured_at is a server estimate (device boot epoch + frame uptime); frames are ordered by the device monotonic clock",
  };
  try {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `INSERT INTO capture_sessions (capture_pk, device_id, recipient_id, capture_id, source_mode, mode, captured_at, captured_until, frame_count,
           frame_width, frame_height, frames_per_chunk, chunk_count, manifest_json, manifest_sha256, trigger_id, trigger_frame_index, cadence_status,
           validation_json, status, received_at, media_expires_at, boot_id, first_uptime_ms, last_uptime_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, 'receiving', ?20, ?21, ?22, ?23, ?24)`,
      ).bind(
        capturePk,
        device.deviceId,
        device.recipientId,
        body.capture_id,
        body.source_mode,
        body.mode,
        iso(capturedAt),
        iso(capturedUntil),
        body.frame_count,
        body.frame_width,
        body.frame_height,
        framesPerChunk,
        chunkCount,
        JSON.stringify(body),
        manifestSha,
        body.trigger_id,
        body.trigger_frame_index,
        cadence.status,
        JSON.stringify(validation),
        iso(now),
        iso(addSeconds(now, ctx.config.mediaMaxAgeSeconds)),
        body.clock.boot_id,
        firstUptime,
        lastUptime,
      ),
    ]);
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw conflict("capture_id_reused", "capture_id was registered concurrently.");
    throw err;
  }
  const row = await loadCapture(ctx, device.deviceId, body.capture_id);
  return json({ created: true, capture: captureView(row), upload: uploadPlan(ctx, row) }, 201);
}

export async function uploadChunk(ctx: Ctx, device: DevicePrincipal, captureId: string, indexText: string): Promise<Response> {
  if ((ctx.request.headers.get("content-type") ?? "").toLowerCase() !== "application/octet-stream") {
    throw new HttpError(415, "unsupported_media_type", "Unsupported media type", "Content-Type must be application/octet-stream.");
  }
  const row = await loadCapture(ctx, device.deviceId, captureId);
  const index = Number(indexText);
  if (!Number.isInteger(index) || index < 0 || index >= row.chunk_count) throw notFound("Chunk index out of range.");
  const bit = 1 << index;
  if ((row.chunks_received & bit) !== 0) {
    await ctx.request.body?.cancel();
    return json({ duplicate: true, capture: captureView(row) });
  }
  if (row.status !== "receiving") throw conflict("capture_not_receiving", `Capture is ${row.status}.`, { current_status: row.status });
  const expected = framesInChunk(row, index);
  const body = await readBody(ctx.request, expected * (MAX_FRAME_BYTES + 4));
  const frames = unpackFrames(body, expected);
  if (typeof frames === "string") throw invalid("invalid_chunk", frames);
  if (frames.length !== expected) throw invalid("invalid_chunk", `chunk ${index} must contain ${expected} frames, got ${frames.length}.`);

  const manifest = JSON.parse(row.manifest_json) as CaptureSession;
  for (let k = 0; k < frames.length; k++) {
    const seq = index * row.frames_per_chunk + k;
    const meta = manifest.frames[seq];
    const frame = frames[k];
    if (!meta || !frame) throw invalid("invalid_chunk", `frame ${seq} missing.`);
    if (frame.byteLength !== meta.size_bytes) throw invalid("frame_size_mismatch", `frame ${seq} has ${frame.byteLength} bytes, manifest says ${meta.size_bytes}.`);
    const info = inspectJpeg(frame);
    if (!info) throw invalid("invalid_jpeg", `frame ${seq} is not a well-formed JPEG.`);
    if (info.width !== row.frame_width || info.height !== row.frame_height) {
      throw invalid("frame_dimension_mismatch", `frame ${seq} is ${info.width}×${info.height}, manifest says ${row.frame_width}×${row.frame_height}.`);
    }
    if ((await sha256Hex(frame)) !== meta.sha256) throw invalid("frame_hash_mismatch", `frame ${seq} does not match its manifest sha256.`);
  }

  const key = chunkKey(row.capture_pk, index);
  await ctx.env.MEDIA.put(key, body, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { capture_pk: row.capture_pk, chunk: String(index) },
  });
  const updated = await ctx.env.DB.prepare(
    `UPDATE capture_sessions SET chunks_received = chunks_received | ?1, total_bytes = total_bytes + ?2
     WHERE capture_pk = ?3 AND status = 'receiving' AND (chunks_received & ?1) = 0 RETURNING *`,
  )
    .bind(bit, body.byteLength, row.capture_pk)
    .first<CaptureRow>();
  if (!updated) {
    const current = await loadCapture(ctx, device.deviceId, captureId);
    if ((current.chunks_received & bit) !== 0 && current.status !== "expired" && current.status !== "failed") {
      return json({ duplicate: true, capture: captureView(current) });
    }
    // The session ended (expired) while this chunk was in flight: never leave its bytes behind.
    await ctx.env.MEDIA.delete(key);
    throw conflict("capture_not_receiving", `Capture is ${current.status}.`, { current_status: current.status });
  }
  return json({ duplicate: false, capture: captureView(updated) });
}

export async function completeCapture(ctx: Ctx, device: DevicePrincipal, captureId: string): Promise<Response> {
  const row = await loadCapture(ctx, device.deviceId, captureId);
  const jobKey = `vision:${row.capture_pk}`;
  if (row.status !== "receiving") {
    if (row.status === "expired" || row.status === "failed") throw conflict("capture_closed", `Capture is ${row.status}.`, { current_status: row.status });
    const job = await ctx.env.DB.prepare(`SELECT job_id, status FROM jobs WHERE idempotency_key = ?1`).bind(jobKey).first<{ job_id: string; status: string }>();
    return json({ duplicate: true, capture: captureView(row), job: job ?? null });
  }
  const all = (1 << row.chunk_count) - 1;
  if (row.chunks_received !== all) {
    const missing = Array.from({ length: row.chunk_count }, (_, i) => i).filter((i) => (row.chunks_received & (1 << i)) === 0);
    throw conflict("chunks_missing", `Chunks not uploaded yet: ${missing.join(", ")}.`, { missing_chunks: missing });
  }
  const now = ctx.clock.now();
  const manifest = JSON.parse(row.manifest_json) as CaptureSession;
  const jobId = newId("job");
  const offsets = frameOffsets(manifest);
  const payload = {
    capture_id: row.capture_id,
    mode: row.mode,
    frame_count: row.frame_count,
    frame_width: row.frame_width,
    frame_height: row.frame_height,
    nominal_fps: 8,
    captured_at: row.captured_at,
    clock: { boot_id: row.boot_id, first_uptime_ms: row.first_uptime_ms, last_uptime_ms: row.last_uptime_ms },
    frames_per_chunk: row.frames_per_chunk,
    chunk_count: row.chunk_count,
    // t_offset_ms: frame time relative to frame 0 of this burst (the agent never joins bursts).
    frames: manifest.frames.map((f, i) => ({ seq: f.seq, t_offset_ms: offsets[i] ?? 0, size_bytes: f.size_bytes, sha256: f.sha256 })),
    cadence_status: row.cadence_status,
    cadence_tolerance_ms: ctx.config.cadenceToleranceMs,
    checks: ["fall", "drink"],
    window_plan: windowPlan(row.frame_count),
    trigger_frame_index: row.trigger_frame_index,
  };
  try {
    await ctx.env.DB.batch([
      guardStatement(ctx.env.DB, `SELECT 1 FROM capture_sessions WHERE capture_pk = ?1 AND status = 'receiving'`, row.capture_pk),
      ctx.env.DB.prepare(`UPDATE capture_sessions SET status = 'uploaded', uploaded_at = ?1 WHERE capture_pk = ?2`).bind(iso(now), row.capture_pk),
      ctx.env.DB.prepare(
        `INSERT INTO jobs (job_id, kind, recipient_id, device_id, capture_pk, idempotency_key, priority, status, payload_json, max_attempts,
           next_attempt_at, expires_at, created_at, updated_at)
         VALUES (?1, 'vision', ?2, ?3, ?4, ?5, ?6, 'queued', ?7, ?8, ?9, ?10, ?9, ?9)`,
      ).bind(
        jobId,
        row.recipient_id,
        row.device_id,
        row.capture_pk,
        jobKey,
        VISION_PRIORITY[row.mode],
        JSON.stringify(payload),
        VISION_MAX_ATTEMPTS,
        iso(now),
        row.media_expires_at,
      ),
      auditStatement(ctx, { actorType: "device", actorId: device.deviceId, action: "capture.complete", targetType: "capture", targetId: row.capture_pk, recipientId: row.recipient_id, detail: { mode: row.mode, cadence: row.cadence_status } }),
      bumpStreamStatement(ctx, row.recipient_id),
    ]);
  } catch (err) {
    if (isGuardFailure(err)) {
      const current = await loadCapture(ctx, device.deviceId, captureId);
      return json({ duplicate: true, capture: captureView(current), job: null });
    }
    throw err;
  }
  ctx.exec.waitUntil(notifyAgents(ctx.env, { type: "job_available", kind: "vision", priority: VISION_PRIORITY[row.mode] }));
  const updated = await loadCapture(ctx, device.deviceId, captureId);
  return json({ duplicate: false, capture: captureView(updated), job: { job_id: jobId, status: "queued" } }, 202);
}

export async function getCapture(ctx: Ctx, device: DevicePrincipal, captureId: string): Promise<Response> {
  const row = await loadCapture(ctx, device.deviceId, captureId);
  const job = await ctx.env.DB.prepare(`SELECT job_id, status, attempts, last_error_code FROM jobs WHERE capture_pk = ?1`).bind(row.capture_pk).first();
  return json({ capture: captureView(row), job: job ?? null });
}

/** Deletes every R2 object of a capture and records the deletion. Safe to repeat. */
export async function deleteCaptureMedia(ctx: Ctx, capture: Pick<CaptureRow, "capture_pk" | "chunk_count">): Promise<boolean> {
  try {
    await ctx.env.MEDIA.delete(mediaKeys(capture));
    await ctx.env.DB.prepare(`UPDATE capture_sessions SET media_deleted_at = ?1 WHERE capture_pk = ?2 AND media_deleted_at IS NULL`)
      .bind(iso(ctx.clock.now()), capture.capture_pk)
      .run();
    return true;
  } catch (err) {
    await ctx.env.DB.prepare(`UPDATE capture_sessions SET media_delete_attempts = media_delete_attempts + 1 WHERE capture_pk = ?1`).bind(capture.capture_pk).run();
    console.error(JSON.stringify({ msg: "media_delete_failed", capture_pk: capture.capture_pk, error: err instanceof Error ? err.name : "unknown" }));
    return false;
  }
}
