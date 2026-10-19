/**
 * Family voice messages: caregiver-recorded audio kept in the private AUDIO bucket.
 *
 * Format contract (media.ts AUDIO_CONTRACT): RIFF/WAVE PCM, mono, 16-bit, a sample rate from the device
 * profile DEVICE_AUDIO_SAMPLE_RATES (default 16 kHz), 0.5–60 s, ≤ 2.2 MB, uploaded as the raw request body.
 * Convert other recordings first, e.g. `ffmpeg -i in.m4a -ac 1 -ar 16000 -sample_fmt s16 out.wav`. Each upload or replacement is a new immutable
 * version; commands pin the version they play. Caregivers with voice.manage upload/replace/delete,
 * anyone with data.read can list and listen; a device can fetch audio only through an active command.
 * Recordings are kept until a caregiver deletes them (retention policy D08 is still open).
 */
import { auditStatement, bumpStreamStatement, requireRecipient, type CaregiverPrincipal, type Ctx } from "./context";
import { HttpError, badRequest, invalid, json, notFound, readBody } from "./http";
import { AUDIO_CONTRACT, inspectWav } from "./media";
import { iso, newId, sha256Hex } from "./util";

interface AssetRow {
  asset_id: string;
  recipient_id: string;
  title: string;
  current_version: number;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  asset_id: string;
  version: number;
  r2_key: string;
  content_type: string;
  sample_rate_hz: number;
  channels: number;
  bits_per_sample: number;
  duration_ms: number;
  byte_size: number;
  sha256: string;
  uploaded_by: string;
  uploaded_at: string;
}

function titleParam(ctx: Ctx, required: boolean): string | null {
  const title = ctx.url.searchParams.get("title");
  if (title === null || title.trim() === "") {
    if (required) throw badRequest("title_required", "Query parameter title is required.");
    return null;
  }
  if (title.length > 120) throw badRequest("title_too_long", "title must be at most 120 characters.");
  return title.trim();
}

async function readAudio(ctx: Ctx): Promise<{ bytes: Uint8Array; info: Exclude<ReturnType<typeof inspectWav>, string>; sha: string }> {
  const type = (ctx.request.headers.get("content-type") ?? "").toLowerCase();
  if (type !== "audio/wav" && type !== "audio/x-wav" && type !== "audio/wave") {
    throw new HttpError(415, "unsupported_media_type", "Unsupported media type", "Content-Type must be audio/wav (PCM WAV).");
  }
  const bytes = await readBody(ctx.request, AUDIO_CONTRACT.maxBytes);
  const info = inspectWav(bytes, ctx.config.deviceAudioSampleRates);
  if (typeof info === "string") throw invalid("invalid_audio", info);
  return { bytes, info, sha: await sha256Hex(bytes) };
}

function view(a: AssetRow, v: VersionRow | null): Record<string, unknown> {
  return {
    voice_message_id: a.asset_id,
    title: a.title,
    status: a.status,
    current_version: a.current_version,
    created_by: a.created_by,
    created_at: a.created_at,
    updated_at: a.updated_at,
    audio: v
      ? {
          version: v.version,
          content_type: v.content_type,
          sample_rate_hz: v.sample_rate_hz,
          channels: v.channels,
          bits_per_sample: v.bits_per_sample,
          duration_ms: v.duration_ms,
          byte_size: v.byte_size,
          sha256: v.sha256,
          uploaded_at: v.uploaded_at,
        }
      : null,
  };
}

function versionStatement(ctx: Ctx, assetId: string, version: number, key: string, info: Exclude<ReturnType<typeof inspectWav>, string>, size: number, sha: string, by: string): D1PreparedStatement {
  return ctx.env.DB.prepare(
    `INSERT INTO audio_asset_versions (asset_id, version, r2_key, content_type, sample_rate_hz, channels, bits_per_sample, duration_ms, byte_size, sha256, uploaded_by, uploaded_at)
     VALUES (?1, ?2, ?3, 'audio/wav', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
  ).bind(assetId, version, key, info.sampleRateHz, info.channels, info.bitsPerSample, info.durationMs, size, sha, by, iso(ctx.clock.now()));
}

/** Who stores a recording. `createdBy` is written to audio_assets/audio_asset_versions (free text: a caregiver user id, or
 * "admin:<admin_id>"); `actorType`/`actorId` go to the audit log. */
export interface VoiceActor {
  actorType: "admin" | "caregiver";
  actorId: string;
  createdBy: string;
  auditDetail?: Record<string, unknown>;
}

export async function uploadVoice(ctx: Ctx, user: CaregiverPrincipal, recipientId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "voice.manage");
  return storeVoice(ctx, { actorType: "caregiver", actorId: user.userId, createdBy: user.userId }, recipientId);
}

/** Validates (WAV contract) and stores a new recording of a recipient. Authorization is the caller's job. */
export async function storeVoice(ctx: Ctx, actor: VoiceActor, recipientId: string): Promise<Response> {
  const title = titleParam(ctx, true) as string;
  const { bytes, info, sha } = await readAudio(ctx);
  const assetId = newId("vm");
  const key = `voice/${recipientId}/${assetId}/v1.wav`;
  await ctx.env.AUDIO.put(key, bytes, { httpMetadata: { contentType: "audio/wav" }, customMetadata: { asset_id: assetId, version: "1" } });
  const now = iso(ctx.clock.now());
  try {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `INSERT INTO audio_assets (asset_id, recipient_id, title, current_version, status, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, 1, 'active', ?4, ?5, ?5)`,
      ).bind(assetId, recipientId, title, actor.createdBy, now),
      versionStatement(ctx, assetId, 1, key, info, bytes.byteLength, sha, actor.createdBy),
      auditStatement(ctx, { actorType: actor.actorType, actorId: actor.actorId, action: "voice.upload", targetType: "voice_message", targetId: assetId, recipientId, detail: actor.auditDetail }),
      bumpStreamStatement(ctx, recipientId),
    ]);
  } catch (err) {
    await ctx.env.AUDIO.delete(key);
    throw err;
  }
  const asset = await ctx.env.DB.prepare(`SELECT * FROM audio_assets WHERE asset_id = ?1`).bind(assetId).first<AssetRow>();
  const version = await ctx.env.DB.prepare(`SELECT * FROM audio_asset_versions WHERE asset_id = ?1 AND version = 1`).bind(assetId).first<VersionRow>();
  return json({ voice_message: asset ? view(asset, version) : null }, 201);
}

export async function replaceVoice(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, assetId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "voice.manage");
  const asset = await ctx.env.DB.prepare(`SELECT * FROM audio_assets WHERE asset_id = ?1 AND recipient_id = ?2 AND status = 'active'`).bind(assetId, recipientId).first<AssetRow>();
  if (!asset) throw notFound("Voice message not found.");
  const title = titleParam(ctx, false);
  const { bytes, info, sha } = await readAudio(ctx);
  const version = asset.current_version + 1;
  const key = `voice/${recipientId}/${assetId}/v${version}.wav`;
  await ctx.env.AUDIO.put(key, bytes, { httpMetadata: { contentType: "audio/wav" }, customMetadata: { asset_id: assetId, version: String(version) } });
  const now = iso(ctx.clock.now());
  const res = await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE audio_assets SET current_version = ?1, title = COALESCE(?2, title), updated_at = ?3 WHERE asset_id = ?4 AND current_version = ?5 AND status = 'active'`).bind(
      version,
      title,
      now,
      assetId,
      asset.current_version,
    ),
    versionStatement(ctx, assetId, version, key, info, bytes.byteLength, sha, user.userId),
    auditStatement(ctx, { actorType: "caregiver", actorId: user.userId, action: "voice.replace", targetType: "voice_message", targetId: assetId, recipientId }),
  ]).catch(async (err: unknown) => {
    await ctx.env.AUDIO.delete(key);
    throw err;
  });
  if ((res[0]?.meta?.changes ?? 0) === 0) {
    await ctx.env.AUDIO.delete(key);
    throw new HttpError(409, "version_conflict", "Conflict", "The voice message changed concurrently.");
  }
  const updated = await ctx.env.DB.prepare(`SELECT * FROM audio_assets WHERE asset_id = ?1`).bind(assetId).first<AssetRow>();
  const v = await ctx.env.DB.prepare(`SELECT * FROM audio_asset_versions WHERE asset_id = ?1 AND version = ?2`).bind(assetId, version).first<VersionRow>();
  return json({ voice_message: updated ? view(updated, v) : null });
}

export async function listVoice(ctx: Ctx, user: CaregiverPrincipal, recipientId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  return listVoiceOf(ctx, recipientId);
}

export async function listVoiceOf(ctx: Ctx, recipientId: string): Promise<Response> {
  const rows = await ctx.env.DB.prepare(
    `SELECT a.*, v.version AS v_version, v.content_type, v.sample_rate_hz, v.channels, v.bits_per_sample, v.duration_ms, v.byte_size, v.sha256, v.uploaded_at, v.r2_key, v.uploaded_by
     FROM audio_assets a JOIN audio_asset_versions v ON v.asset_id = a.asset_id AND v.version = a.current_version
     WHERE a.recipient_id = ?1 AND a.status = 'active' ORDER BY a.created_at DESC LIMIT 200`,
  )
    .bind(recipientId)
    .all<AssetRow & VersionRow & { v_version: number }>();
  return json({
    items: rows.results.map((r) => view(r, { ...r, version: r.v_version })),
    format: { ...AUDIO_CONTRACT, sampleRates: ctx.config.deviceAudioSampleRates },
  });
}

export async function getVoiceAudio(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, assetId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  return voiceAudioOf(ctx, recipientId, assetId);
}

/** The current recording as a private, uncacheable response. `recipientId` null = any recipient (admin preview). */
export async function voiceAudioOf(ctx: Ctx, recipientId: string | null, assetId: string): Promise<Response> {
  const row = await ctx.env.DB.prepare(
    `SELECT v.* FROM audio_assets a JOIN audio_asset_versions v ON v.asset_id = a.asset_id AND v.version = a.current_version
     WHERE a.asset_id = ?1 AND (?2 IS NULL OR a.recipient_id = ?2) AND a.status = 'active'`,
  )
    .bind(assetId, recipientId)
    .first<VersionRow>();
  if (!row) throw notFound("Voice message not found.");
  const object = await ctx.env.AUDIO.get(row.r2_key);
  if (!object) throw new HttpError(410, "audio_missing", "Gone", "Audio object is missing from storage.");
  return new Response(object.body, { headers: { "content-type": "audio/wav", "content-length": String(row.byte_size), "cache-control": "private, no-store" } });
}

export async function deleteVoice(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, assetId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "voice.manage");
  const now = iso(ctx.clock.now());
  const versions = await ctx.env.DB.prepare(
    `SELECT v.r2_key FROM audio_asset_versions v JOIN audio_assets a ON a.asset_id = v.asset_id WHERE a.asset_id = ?1 AND a.recipient_id = ?2 AND a.status = 'active'`,
  )
    .bind(assetId, recipientId)
    .all<{ r2_key: string }>();
  if (versions.results.length === 0) throw notFound("Voice message not found.");
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE audio_assets SET status = 'deleted', deleted_at = ?1, updated_at = ?1 WHERE asset_id = ?2`).bind(now, assetId),
    ctx.env.DB.prepare(`UPDATE audio_asset_versions SET deleted_at = ?1 WHERE asset_id = ?2`).bind(now, assetId),
    ctx.env.DB.prepare(
      `UPDATE device_commands SET status = 'cancelled', status_reason = 'voice_message_deleted', finished_at = ?1, updated_at = ?1
       WHERE recipient_id = ?2 AND status = 'queued' AND json_extract(payload_json, '$.voice.voice_message_id') = ?3`,
    ).bind(now, recipientId, assetId),
    // Already on the device: ask it to stop; the audio route answers 410 from now on.
    ctx.env.DB.prepare(
      `UPDATE device_commands SET cancel_requested_at = COALESCE(cancel_requested_at, ?1), status_reason = 'voice_message_deleted', updated_at = ?1
       WHERE recipient_id = ?2 AND status IN ('delivered', 'accepted', 'started') AND json_extract(payload_json, '$.voice.voice_message_id') = ?3`,
    ).bind(now, recipientId, assetId),
    ctx.env.DB.prepare(`UPDATE reminder_schedules SET voice_message_id = NULL, updated_at = ?1, version = version + 1 WHERE voice_message_id = ?2`).bind(now, assetId),
    auditStatement(ctx, { actorType: "caregiver", actorId: user.userId, action: "voice.delete", targetType: "voice_message", targetId: assetId, recipientId }),
    bumpStreamStatement(ctx, recipientId),
  ]);
  await ctx.env.AUDIO.delete(versions.results.map((v) => v.r2_key));
  return json({ voice_message_id: assetId, status: "deleted" });
}
