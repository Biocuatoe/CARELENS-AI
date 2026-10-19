/** Per-request context, principals, authorization and audit. */
import type { Config, Env } from "./env";
import { HttpError, forbidden, notFound, unauthorized } from "./http";
import { addSeconds, iso, newId, sha256Hex, type Clock } from "./util";

export interface Ctx {
  env: Env;
  config: Config;
  clock: Clock;
  requestId: string;
  request: Request;
  url: URL;
  exec: ExecutionContext;
  /** Outbound fetch (Google token and key endpoints). Defaults to the global fetch; tests inject a fake. */
  outboundFetch?: typeof fetch;
  /** Set by authenticateAdmin on admin routes so audit entries name the person who acted. */
  admin?: AdminPrincipal;
}

export interface DevicePrincipal {
  type: "device";
  deviceId: string;
  recipientId: string;
}
export interface AgentPrincipal {
  type: "agent";
  agentId: string;
}
export interface CaregiverPrincipal {
  type: "caregiver";
  userId: string;
  tokenId: string;
}
/** An admin API caller: a signed-in person (Google, clm_ session) or the legacy static operator token. */
export type AdminPrincipal =
  | { type: "admin"; method: "session"; adminId: string; email: string; role: "owner" | "admin"; tokenId: string; expiresAt: string; authenticatedAt: string }
  | { type: "admin"; method: "static_token"; adminId: null };

export type Permission =
  | "data.read"
  | "alerts.act"
  | "events.verify"
  | "reminders.manage"
  | "voice.manage"
  | "devices.command";

const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  caregiver: ["data.read", "alerts.act", "events.verify", "reminders.manage", "voice.manage", "devices.command"],
  viewer: ["data.read"],
};

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "";
}

function bearer(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return m ? (m[1] ?? null) : null;
}

/** Counts a failed authentication against the per-IP limiter; answers 429 once the budget is spent. */
export async function authFailure(ctx: Ctx): Promise<never> {
  const limiter = ctx.env.AUTH_FAILURE_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key: `auth:${clientIp(ctx.request) || "unknown"}` });
    if (!success) throw new HttpError(429, "too_many_failures", "Too many requests", "Too many failed authentications.", { "retry-after": "60" });
  }
  throw unauthorized();
}

async function tokenDigest(ctx: Ctx, prefix: string): Promise<string> {
  const token = bearer(ctx.request);
  if (!token || !token.startsWith(`${prefix}_`) || token.length > 256) return authFailure(ctx);
  return sha256Hex(token);
}

export async function authenticateDevice(ctx: Ctx): Promise<DevicePrincipal> {
  const digest = await tokenDigest(ctx, "cld");
  const row = await ctx.env.DB.prepare(
    `SELECT d.device_id, d.recipient_id FROM devices d JOIN care_recipients r ON r.recipient_id = d.recipient_id
     WHERE d.token_sha256 = ? AND d.status = 'active' AND r.status = 'active'`,
  )
    .bind(digest)
    .first<{ device_id: string; recipient_id: string }>();
  if (!row) return authFailure(ctx);
  const limiter = ctx.env.DEVICE_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key: `device:${row.device_id}` });
    if (!success) throw new HttpError(429, "rate_limited", "Too many requests", "Device request rate exceeded.", { "retry-after": "10" });
  }
  ctx.exec.waitUntil(touchDevice(ctx, row.device_id));
  return { type: "device", deviceId: row.device_id, recipientId: row.recipient_id };
}

/** Records connectivity: last_seen_at and an hourly presence row (used for data-gap reporting).
 * Writes are throttled to one per 30 s per device to stay inside the D1 free write budget. */
async function touchDevice(ctx: Ctx, deviceId: string): Promise<void> {
  const now = ctx.clock.now();
  const stale = iso(addSeconds(now, -30));
  const hour = iso(now).slice(0, 13);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE devices SET last_seen_at = ?1 WHERE device_id = ?2 AND (last_seen_at IS NULL OR last_seen_at < ?3)`).bind(
      iso(now),
      deviceId,
      stale,
    ),
    ctx.env.DB.prepare(
      `INSERT INTO device_presence (device_id, hour_utc, first_seen_at, last_seen_at, request_count) VALUES (?1, ?2, ?3, ?3, 1)
       ON CONFLICT (device_id, hour_utc) DO UPDATE SET last_seen_at = excluded.last_seen_at, request_count = request_count + 1
       WHERE device_presence.last_seen_at < ?4`,
    ).bind(deviceId, hour, iso(now), stale),
  ]);
}

export async function authenticateAgent(ctx: Ctx): Promise<AgentPrincipal> {
  const digest = await tokenDigest(ctx, "cla");
  const row = await ctx.env.DB.prepare(`SELECT agent_id FROM agents WHERE token_sha256 = ? AND status = 'active'`)
    .bind(digest)
    .first<{ agent_id: string }>();
  if (!row) return authFailure(ctx);
  ctx.exec.waitUntil(
    ctx.env.DB.prepare(`UPDATE agents SET last_seen_at = ?1 WHERE agent_id = ?2 AND (last_seen_at IS NULL OR last_seen_at < ?3)`)
      .bind(iso(ctx.clock.now()), row.agent_id, iso(addSeconds(ctx.clock.now(), -30)))
      .run(),
  );
  return { type: "agent", agentId: row.agent_id };
}

export async function authenticateCaregiver(ctx: Ctx): Promise<CaregiverPrincipal> {
  const digest = await tokenDigest(ctx, "clc");
  const now = iso(ctx.clock.now());
  const row = await ctx.env.DB.prepare(
    `SELECT t.token_id, t.user_id FROM caregiver_tokens t JOIN caregivers c ON c.user_id = t.user_id
     WHERE t.token_sha256 = ?1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?2) AND c.status = 'active'`,
  )
    .bind(digest, now)
    .first<{ token_id: string; user_id: string }>();
  if (!row) return authFailure(ctx);
  // Throttled like device presence: at most one write per token per 5 minutes.
  ctx.exec.waitUntil(
    ctx.env.DB.prepare(`UPDATE caregiver_tokens SET last_used_at = ?1 WHERE token_id = ?2 AND (last_used_at IS NULL OR last_used_at < ?3)`)
      .bind(now, row.token_id, iso(addSeconds(ctx.clock.now(), -300)))
      .run(),
  );
  return { type: "caregiver", userId: row.user_id, tokenId: row.token_id };
}

/** Bearer token of the request, for authenticators that live outside this module (adminAuth.ts). */
export function bearerToken(request: Request): string | null {
  return bearer(request);
}

/** Id recorded as the actor of an admin audit entry: the signed-in admin, or "admin" for the legacy static token. */
export function adminActorId(ctx: Ctx): string {
  return ctx.admin?.adminId ?? "admin";
}

export interface GrantRow {
  grant_id: string;
  role: string;
  recipient_id: string;
}

/** Server-side authorization for every recipient-scoped caregiver route: no active grant → 404 (the
 * recipient's existence is not revealed), grant without the permission → 403. */
export async function requireRecipient(ctx: Ctx, principal: CaregiverPrincipal, recipientId: string, permission: Permission): Promise<GrantRow> {
  const grant = await ctx.env.DB.prepare(
    `SELECT g.grant_id, g.role, g.recipient_id FROM grants g JOIN care_recipients r ON r.recipient_id = g.recipient_id
     WHERE g.user_id = ?1 AND g.recipient_id = ?2 AND g.revoked_at IS NULL AND r.status = 'active'`,
  )
    .bind(principal.userId, recipientId)
    .first<GrantRow>();
  if (!grant) throw notFound("Recipient not found.");
  if (!(ROLE_PERMISSIONS[grant.role] ?? []).includes(permission)) throw forbidden("permission_denied", `Missing permission ${permission}.`);
  return grant;
}

export function permissionsOf(role: string): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export interface AuditEntry {
  actorType: "admin" | "caregiver" | "device" | "agent" | "system";
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  recipientId?: string | null;
  outcome?: "success" | "denied" | "failed";
  detail?: Record<string, unknown>;
}

/** Audit statement for inclusion in a batch. `detail` must never contain tokens, media or samples. */
export function auditStatement(ctx: Ctx, entry: AuditEntry): D1PreparedStatement {
  return ctx.env.DB.prepare(
    `INSERT INTO audit_log (audit_id, at, actor_type, actor_id, action, target_type, target_id, recipient_id, outcome, request_id, detail_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
  ).bind(
    newId("aud"),
    iso(ctx.clock.now()),
    entry.actorType,
    entry.actorId,
    entry.action,
    entry.targetType ?? null,
    entry.targetId ?? null,
    entry.recipientId ?? null,
    entry.outcome ?? "success",
    ctx.requestId,
    entry.detail ? JSON.stringify(entry.detail) : null,
  );
}

export function bumpStreamStatement(ctx: Ctx, recipientId: string): D1PreparedStatement {
  return ctx.env.DB.prepare(
    `INSERT INTO recipient_streams (recipient_id, seq, updated_at) VALUES (?1, 1, ?2)
     ON CONFLICT (recipient_id) DO UPDATE SET seq = seq + 1, updated_at = excluded.updated_at`,
  ).bind(recipientId, iso(ctx.clock.now()));
}

/** Statement that aborts the enclosing batch (rolling it back) unless `existsSql` matches a row. */
export function guardStatement(db: D1Database, existsSql: string, ...binds: unknown[]): D1PreparedStatement {
  return db.prepare(`INSERT INTO tx_guard (ok) SELECT 0 WHERE NOT EXISTS (${existsSql})`).bind(...binds);
}

export function isGuardFailure(err: unknown): boolean {
  return err instanceof Error && /CHECK constraint failed/i.test(err.message) && /ok\s*=\s*1|tx_guard/i.test(err.message);
}
