/**
 * Administrative provisioning (admin bearer token; its SHA-256 is the ADMIN_TOKEN_SHA256 secret).
 * Credentials are random 256-bit tokens returned exactly once; only their SHA-256 is stored.
 * Device, agent and caregiver credentials can never call these routes.
 */
import { z } from "zod";
import { adminActorId, auditStatement, type Ctx } from "./context";
import { conflict, json, notFound, readJson } from "./http";
import { closeUserStreams } from "./realtime";
import { hashChosenSecret, legacyDigest } from "./password";
import { loginSecret } from "./session";
import { LoginId } from "./contracts";
import { addSeconds, iso, newId, randomToken, sha256Hex } from "./util";

const Id = z.string().min(3).max(64).regex(/^[A-Za-z0-9._:-]+$/);

const RecipientCreate = z
  .object({ recipient_id: Id.nullable(), display_label: z.string().min(1).max(80), timezone: z.string().min(1).max(64) })
  .strict();
const DeviceCreate = z.object({ device_id: Id, recipient_id: Id, label: z.string().min(1).max(80) }).strict();
const AgentCreate = z.object({ label: z.string().min(1).max(80) }).strict();
const CaregiverCreate = z.object({ display_name: z.string().min(1).max(80), token_expires_in_days: z.number().int().min(1).max(730).nullable() }).strict();
const GrantCreate = z.object({ user_id: Id, recipient_id: Id, role: z.enum(["caregiver", "viewer"]) }).strict();
/** `login_id` is the current field, `login_email` its earlier name. `password` is optional: absent = the server generates one. */
const LoginCreate = z
  .object({ login_id: LoginId.optional(), login_email: LoginId.optional(), password: z.string().min(5).max(128).optional() })
  .strict()
  .refine((body) => (body.login_id ?? body.login_email) !== undefined, { message: "login_id is required", path: ["login_id"] });

function audit(ctx: Ctx, action: string, targetType: string, targetId: string, recipientId: string | null = null) {
  return auditStatement(ctx, { actorType: "admin", actorId: adminActorId(ctx), action, targetType, targetId, recipientId });
}

function uniqueConflict(err: unknown, what: string): never {
  if (err instanceof Error && /UNIQUE|constraint/i.test(err.message)) throw conflict("already_exists", `${what} already exists or violates a constraint.`);
  throw err;
}

export async function createRecipient(ctx: Ctx): Promise<Response> {
  const body = await readJson(ctx.request, RecipientCreate);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: body.timezone });
  } catch {
    throw conflict("invalid_timezone", "timezone must be an IANA time zone.");
  }
  const id = body.recipient_id ?? newId("rcp");
  const now = iso(ctx.clock.now());
  try {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(`INSERT INTO care_recipients (recipient_id, display_label, timezone, created_at) VALUES (?1, ?2, ?3, ?4)`).bind(id, body.display_label, body.timezone, now),
      ctx.env.DB.prepare(`INSERT INTO recipient_streams (recipient_id, seq, updated_at) VALUES (?1, 0, ?2)`).bind(id, now),
      audit(ctx, "recipient.create", "recipient", id, id),
    ]);
  } catch (err) {
    uniqueConflict(err, "Recipient");
  }
  return json({ recipient_id: id, display_label: body.display_label, timezone: body.timezone }, 201);
}

export async function listRecipients(ctx: Ctx): Promise<Response> {
  const rows = await ctx.env.DB.prepare(`SELECT recipient_id, display_label, timezone, status, created_at FROM care_recipients ORDER BY created_at`).all();
  return json({ items: rows.results });
}

export async function createDevice(ctx: Ctx): Promise<Response> {
  const body = await readJson(ctx.request, DeviceCreate);
  const token = randomToken("cld");
  try {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(`INSERT INTO devices (device_id, recipient_id, label, token_sha256, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(
        body.device_id,
        body.recipient_id,
        body.label,
        await sha256Hex(token),
        iso(ctx.clock.now()),
      ),
      audit(ctx, "device.create", "device", body.device_id, body.recipient_id),
    ]);
  } catch (err) {
    uniqueConflict(err, "Device (or unknown recipient)");
  }
  return json({ device_id: body.device_id, recipient_id: body.recipient_id, token, token_note: "Shown once. Store it in the device's secure storage; only its SHA-256 is kept." }, 201);
}

export async function rotateDeviceToken(ctx: Ctx, deviceId: string): Promise<Response> {
  const token = randomToken("cld");
  const res = await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE devices SET token_sha256 = ?1, credential_version = credential_version + 1 WHERE device_id = ?2 AND status = 'active'`).bind(await sha256Hex(token), deviceId),
    audit(ctx, "device.rotate_token", "device", deviceId),
  ]);
  if ((res[0]?.meta?.changes ?? 0) === 0) throw notFound("Active device not found.");
  return json({ device_id: deviceId, token, token_note: "Shown once. The previous token stopped working." });
}

export async function revokeDevice(ctx: Ctx, deviceId: string): Promise<Response> {
  const now = iso(ctx.clock.now());
  const res = await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE devices SET status = 'revoked', revoked_at = ?1 WHERE device_id = ?2 AND status = 'active'`).bind(now, deviceId),
    ctx.env.DB.prepare(`UPDATE device_commands SET status = 'cancelled', status_reason = 'device_revoked', finished_at = ?1, updated_at = ?1 WHERE device_id = ?2 AND status IN ('queued', 'delivered')`).bind(now, deviceId),
    audit(ctx, "device.revoke", "device", deviceId),
  ]);
  if ((res[0]?.meta?.changes ?? 0) === 0) throw notFound("Active device not found.");
  return json({ device_id: deviceId, status: "revoked" });
}

export async function createAgent(ctx: Ctx): Promise<Response> {
  const body = await readJson(ctx.request, AgentCreate);
  const id = newId("agt");
  const token = randomToken("cla");
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`INSERT INTO agents (agent_id, label, token_sha256, created_at) VALUES (?1, ?2, ?3, ?4)`).bind(id, body.label, await sha256Hex(token), iso(ctx.clock.now())),
    audit(ctx, "agent.create", "agent", id),
  ]);
  return json({ agent_id: id, token, token_note: "Shown once. Put it in the local agent's environment file (CARELENS_AGENT_TOKEN)." }, 201);
}

export async function revokeAgent(ctx: Ctx, agentId: string): Promise<Response> {
  const now = iso(ctx.clock.now());
  const res = await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE agents SET status = 'revoked', revoked_at = ?1 WHERE agent_id = ?2 AND status = 'active'`).bind(now, agentId),
    audit(ctx, "agent.revoke", "agent", agentId),
  ]);
  if ((res[0]?.meta?.changes ?? 0) === 0) throw notFound("Active agent not found.");
  return json({ agent_id: agentId, status: "revoked" });
}

export async function createCaregiver(ctx: Ctx): Promise<Response> {
  const body = await readJson(ctx.request, CaregiverCreate);
  const userId = newId("usr");
  const tokenId = newId("tok");
  const token = randomToken("clc");
  const now = ctx.clock.now();
  const expires = body.token_expires_in_days ? iso(new Date(now.getTime() + body.token_expires_in_days * 86_400_000)) : null;
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`INSERT INTO caregivers (user_id, display_name, created_at) VALUES (?1, ?2, ?3)`).bind(userId, body.display_name, iso(now)),
    ctx.env.DB.prepare(`INSERT INTO caregiver_tokens (token_id, user_id, token_sha256, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(
      tokenId,
      userId,
      await sha256Hex(token),
      iso(now),
      expires,
    ),
    audit(ctx, "caregiver.create", "caregiver", userId),
  ]);
  return json({ user_id: userId, token_id: tokenId, token, expires_at: expires, token_note: "Shown once." }, 201);
}

export async function revokeCaregiverToken(ctx: Ctx, tokenId: string): Promise<Response> {
  const now = iso(ctx.clock.now());
  const row = await ctx.env.DB.prepare(`UPDATE caregiver_tokens SET revoked_at = ?1 WHERE token_id = ?2 AND revoked_at IS NULL RETURNING user_id`).bind(now, tokenId).first<{ user_id: string }>();
  if (!row) throw notFound("Active token not found.");
  await audit(ctx, "caregiver.revoke_token", "caregiver_token", tokenId).run();
  const grants = await ctx.env.DB.prepare(`SELECT recipient_id FROM grants WHERE user_id = ?1 AND revoked_at IS NULL`).bind(row.user_id).all<{ recipient_id: string }>();
  ctx.exec.waitUntil(closeUserStreams(ctx.env, grants.results.map((g) => g.recipient_id), row.user_id));
  return json({ token_id: tokenId, status: "revoked" });
}

export async function createGrant(ctx: Ctx): Promise<Response> {
  const body = await readJson(ctx.request, GrantCreate);
  const id = newId("grt");
  try {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(`INSERT INTO grants (grant_id, user_id, recipient_id, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(id, body.user_id, body.recipient_id, body.role, iso(ctx.clock.now())),
      audit(ctx, "grant.create", "grant", id, body.recipient_id),
    ]);
  } catch (err) {
    uniqueConflict(err, "Active grant (or unknown user/recipient)");
  }
  return json({ grant_id: id, ...body }, 201);
}

export async function revokeGrant(ctx: Ctx, grantId: string): Promise<Response> {
  const row = await ctx.env.DB.prepare(`UPDATE grants SET revoked_at = ?1 WHERE grant_id = ?2 AND revoked_at IS NULL RETURNING user_id, recipient_id`)
    .bind(iso(ctx.clock.now()), grantId)
    .first<{ user_id: string; recipient_id: string }>();
  if (!row) throw notFound("Active grant not found.");
  await audit(ctx, "grant.revoke", "grant", grantId, row.recipient_id).run();
  ctx.exec.waitUntil(closeUserStreams(ctx.env, [row.recipient_id], row.user_id));
  return json({ grant_id: grantId, status: "revoked" });
}

export async function retryReport(ctx: Ctx, reportId: string): Promise<Response> {
  const now = iso(ctx.clock.now());
  const res = await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE daily_reports SET status = 'pending', failure_code = NULL, updated_at = ?1 WHERE report_id = ?2 AND status = 'failed'`).bind(now, reportId),
    ctx.env.DB.prepare(
      `UPDATE jobs SET status = 'queued', attempts = 0, next_attempt_at = ?1, last_error_code = NULL, last_error_detail = NULL, updated_at = ?1
       WHERE report_id = ?2 AND status = 'failed' AND EXISTS (SELECT 1 FROM daily_reports WHERE report_id = ?2 AND status = 'pending')`,
    ).bind(now, reportId),
    audit(ctx, "report.retry", "daily_report", reportId),
  ]);
  if ((res[0]?.meta?.changes ?? 0) === 0) throw notFound("No failed report with this id.");
  return json({ report_id: reportId, status: "pending" });
}

/** Issues (or rotates) the web sign-in of a caregiver or viewer. The password is shown once; rotating it
 * revokes every session of that user and closes their streams. */
export async function setLoginCredential(ctx: Ctx, userId: string): Promise<Response> {
  const body = await readJson(ctx.request, LoginCreate);
  const loginId = (body.login_id ?? body.login_email)!;
  const chosen = body.password !== undefined;
  const password = body.password ?? loginSecret();
  const stored = chosen ? await hashChosenSecret(password, ctx.config.loginPbkdf2Iterations) : await legacyDigest(password);
  const now = iso(ctx.clock.now());
  let res: D1Result[];
  try {
    res = await ctx.env.DB.batch([
      ctx.env.DB.prepare(`UPDATE caregivers SET login_email = ?1, login_secret_sha256 = ?2, login_updated_at = ?3 WHERE user_id = ?4 AND status = 'active'`).bind(
        loginId,
        stored,
        now,
        userId,
      ),
      ctx.env.DB.prepare(`UPDATE caregiver_tokens SET revoked_at = ?1 WHERE user_id = ?2 AND kind = 'session' AND revoked_at IS NULL`).bind(now, userId),
      audit(ctx, "caregiver.set_login", "caregiver", userId),
    ]);
  } catch (err) {
    uniqueConflict(err, "login_email");
  }
  if ((res[0]?.meta?.changes ?? 0) === 0) throw notFound("Active caregiver not found.");
  const grants = await ctx.env.DB.prepare(`SELECT recipient_id FROM grants WHERE user_id = ?1 AND revoked_at IS NULL`).bind(userId).all<{ recipient_id: string }>();
  ctx.exec.waitUntil(closeUserStreams(ctx.env, grants.results.map((g) => g.recipient_id), userId));
  return json(
    chosen
      ? { user_id: userId, login_id: loginId, login_email: loginId, password_note: "The chosen password is stored only as a salted PBKDF2 hash and is not returned." }
      : { user_id: userId, login_id: loginId, login_email: loginId, password, password_note: "Shown once. Give it to the person over a private channel; only its SHA-256 is kept." },
    201,
  );
}

const GoogleAuthorize = z.object({ email: z.string().trim().toLowerCase().min(3).max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/) }).strict();

/** Authorizes one Google identity (by verified e-mail) to sign in as this existing caregiver/viewer account. The Google
 * subject id is bound at its first sign-in. This is the only way a Google account gets access. */
export async function authorizeGoogleIdentity(ctx: Ctx, userId: string): Promise<Response> {
  const body = await readJson(ctx.request, GoogleAuthorize);
  const now = iso(ctx.clock.now());
  const user = await ctx.env.DB.prepare(`SELECT 1 AS ok FROM caregivers WHERE user_id = ?1 AND status = 'active'`).bind(userId).first();
  if (!user) throw notFound("Active caregiver not found.");
  const existing = await ctx.env.DB.prepare(`SELECT user_id FROM google_identities WHERE email = ?1`).bind(body.email).first<{ user_id: string }>();
  if (existing && existing.user_id !== userId) throw conflict("already_exists", "This Google identity is already authorized for another account; revoke it first.");
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`INSERT INTO google_identities (email, user_id, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (email) DO NOTHING`).bind(body.email, userId, now),
    audit(ctx, "google.authorize", "caregiver", userId),
  ]);
  return json({ user_id: userId, google_email: body.email, status: existing ? "already_authorized" : "authorized" }, 201);
}

/** Removes a Google identity from the allowlist. Existing sessions of the account are left alone (other judges keep theirs). */
export async function revokeGoogleIdentity(ctx: Ctx): Promise<Response> {
  const body = await readJson(ctx.request, GoogleAuthorize);
  const res = await ctx.env.DB.batch([
    ctx.env.DB.prepare(`DELETE FROM google_identities WHERE email = ?1`).bind(body.email),
    audit(ctx, "google.revoke", "google_identity", "google_identity"),
  ]);
  if ((res[0]?.meta?.changes ?? 0) === 0) throw notFound("Google identity not found.");
  return json({ google_email: body.email, status: "revoked" });
}

const AGENT_STALE_SECONDS = 180;

/** Operational view for the owner: queue depth and age, failure categories, device contact, last
 * successful local inference, agent health. Counts and timestamps only; no health payloads. */
export async function opsStatus(ctx: Ctx): Promise<Response> {
  const now = ctx.clock.now();
  const dayAgo = iso(addSeconds(now, -86_400));
  const db = ctx.env.DB;
  const [jobs, queue, failures, lastDone, captures, agents, devices, imu, commands, decisions] = await db.batch([
    db.prepare(`SELECT kind, status, COUNT(*) AS n FROM jobs GROUP BY kind, status`),
    db.prepare(
      `SELECT kind, COUNT(*) AS waiting, MIN(created_at) AS oldest_created_at FROM jobs
       WHERE status IN ('queued', 'retry_pending') AND (expires_at IS NULL OR expires_at > ?1) GROUP BY kind`,
    ).bind(iso(now)),
    db.prepare(`SELECT kind, status, COALESCE(last_error_code, 'none') AS error_code, COUNT(*) AS n FROM jobs WHERE status IN ('failed', 'expired', 'retry_pending') AND updated_at >= ?1 GROUP BY kind, status, error_code`).bind(dayAgo),
    db.prepare(`SELECT kind, MAX(completed_at) AS last_completed_at FROM jobs WHERE status = 'completed' GROUP BY kind`),
    db.prepare(`SELECT status, COUNT(*) AS n, SUM(CASE WHEN media_deleted_at IS NULL THEN 1 ELSE 0 END) AS media_present FROM capture_sessions GROUP BY status`),
    db.prepare(`SELECT agent_id, label, status, last_seen_at, last_reported_json FROM agents ORDER BY created_at`),
    db.prepare(`SELECT device_id, recipient_id, status, firmware_version, last_seen_at, last_heartbeat_at, last_heartbeat_json, last_boot_id FROM devices ORDER BY created_at`),
    // end_at is indexed (retention); received_at is not and would scan every retained batch.
    db
      .prepare(`SELECT device_id, COUNT(*) AS batches, SUM(sample_count) AS samples, MAX(end_at) AS last_sample_at, SUM(seq_gap_before) AS missing_batches FROM imu_batches WHERE end_at >= ?1 GROUP BY device_id`)
      .bind(dayAgo),
    db.prepare(`SELECT command_type, status, COUNT(*) AS n FROM device_commands WHERE created_at >= ?1 GROUP BY command_type, status`).bind(dayAgo),
    db.prepare(`SELECT status, case_code, COUNT(*) AS n FROM fusion_decisions WHERE decided_at >= ?1 GROUP BY status, case_code`).bind(dayAgo),
  ]);
  const ageSeconds = (at: string | null) => (at ? Math.round((now.getTime() - new Date(at).getTime()) / 1000) : null);
  const policy = ctx.config.fusionPolicy;
  const dbBytes = jobs?.meta?.size_after ?? null;
  const imuLimitBytes = ctx.config.imuStorageSoftLimitMb * 1_000_000;
  return json({
    server_time: iso(now),
    storage: {
      d1_size_bytes: dbBytes,
      imu_storage_soft_limit_bytes: imuLimitBytes,
      imu_ingest: imuLimitBytes === 0 || (dbBytes ?? 0) > imuLimitBytes ? "refusing_storage_budget" : "accepting",
      imu_raw_retention_hours: ctx.config.imuRawRetentionHours,
    },
    jobs: jobs?.results ?? [],
    queue: ((queue?.results ?? []) as Array<{ kind: string; waiting: number; oldest_created_at: string | null }>).map((q) => ({ ...q, oldest_age_seconds: ageSeconds(q.oldest_created_at) })),
    failures_24h: failures?.results ?? [],
    last_successful_inference: lastDone?.results ?? [],
    captures: captures?.results ?? [],
    agents: ((agents?.results ?? []) as Array<{ agent_id: string; label: string; status: string; last_seen_at: string | null; last_reported_json: string | null }>).map((a) => {
      let reported: unknown = null;
      try {
        reported = a.last_reported_json ? JSON.parse(a.last_reported_json) : null;
      } catch {
        reported = "unparseable";
      }
      const age = ageSeconds(a.last_seen_at);
      return { agent_id: a.agent_id, label: a.label, status: a.status, last_seen_at: a.last_seen_at, connected: age !== null && age <= AGENT_STALE_SECONDS, reported };
    }),
    devices: ((devices?.results ?? []) as Array<Record<string, unknown> & { last_seen_at: string | null; last_heartbeat_json: string | null }>).map(({ last_heartbeat_json, ...d }) => ({
      ...d,
      last_contact_age_seconds: ageSeconds(d.last_seen_at),
      connected: d.last_seen_at !== null && (ageSeconds(d.last_seen_at) ?? Infinity) <= ctx.config.deviceOnlineWindowSeconds,
      heartbeat_status: last_heartbeat_json ? JSON.parse(last_heartbeat_json) : null,
    })),
    imu_24h: imu?.results ?? [],
    commands_24h: commands?.results ?? [],
    decisions_24h: decisions?.results ?? [],
    fusion: {
      policy_version: policy.policy_version,
      vision_candidate_rule: policy.vision_candidate_rule ? `${policy.vision_candidate_rule.rule_version}:${policy.vision_candidate_rule.calibration}` : null,
      imu_candidate_rule: policy.imu_candidate_rule ? `${policy.imu_candidate_rule.rule_version}:${policy.imu_candidate_rule.calibration}` : null,
      suspected_fall_possible: policy.vision_candidate_rule !== null && policy.imu_candidate_rule !== null,
    },
  });
}
