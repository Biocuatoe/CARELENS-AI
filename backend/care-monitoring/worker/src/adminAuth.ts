/**
 * Admin identity, sessions and authorization (Phase B). Admin is a third kind of person, separate from caregivers/viewers
 * (caregiver_tokens, clc_) and from devices and agents:
 *
 *   - Sign in is Google only, through the same server-side OIDC flow as the viewers (google.ts) but started with
 *     `?mode=admin`. The purpose is stored with the OAuth state and read back from the database in the callback, so a
 *     viewer state cannot finish as an admin sign-in and the browser cannot choose the outcome.
 *   - Who may be an admin is decided by the server: the verified Google e-mail must be listed in the ADMIN_BOOTSTRAP_EMAILS
 *     secret (role `owner`) or be an active row of `admins` (role `admin`, added later by an owner). The Google `sub` is
 *     bound at the first sign-in. With no valid bootstrap list, admin sign-in is off.
 *   - The callback hands the browser a single-use 60-second code (`cax_…`, fragment `#admin_code=`); the web app trades it at
 *     POST /api/admin/v1/session/exchange for a `clm_` bearer session that lives in memory only. Only its SHA-256 is stored.
 *   - Every admin request re-reads the session and the admin row: revoked, expired, unknown, disabled, and owners who are
 *     no longer in the bootstrap secret are refused. Roles never come from the request.
 *
 * The legacy static operator token (ADMIN_TOKEN_SHA256) still works when it is configured; production leaves it unset.
 */
import { z } from "zod";
import { adminActorId, auditStatement, authFailure, bearerToken, type AdminPrincipal, type Ctx } from "./context";
import { HttpError, json, readJson, unavailable } from "./http";
import { spendLoginBudget } from "./session";
import { addSeconds, iso, newId, randomToken, sha256Hex, timingSafeEqualHex } from "./util";

export const ADMIN_EXCHANGE_TTL_SECONDS = 60;
const SESSION_PREFIX = "clm_";
const LAST_USED_THROTTLE_SECONDS = 300;

type AdminRole = "owner" | "admin";
interface AdminRow {
  admin_id: string;
  email: string;
  google_sub: string | null;
  role: AdminRole;
  status: string;
}

/** An admin may act only while active; an owner only while still named in the bootstrap secret (rotating it revokes owners). */
function eligible(ctx: Ctx, admin: { email: string; role: AdminRole; status: string }): boolean {
  if (admin.status !== "active") return false;
  return admin.role !== "owner" || ctx.config.adminBootstrapEmails.includes(admin.email);
}

/** Fails closed when admin Google sign-in cannot work: a malformed or empty ADMIN_BOOTSTRAP_EMAILS. */
export function requireAdminSignInConfigured(ctx: Ctx): void {
  if (ctx.config.adminConfigError) throw new HttpError(503, "misconfigured", "Service misconfigured", ctx.config.adminConfigError);
  if (ctx.config.adminBootstrapEmails.length === 0) {
    throw unavailable("admin_signin_not_configured", "Admin sign-in is off: ADMIN_BOOTSTRAP_EMAILS is not set on this server.");
  }
}

/* ------------------------------------------------------------------ authorization */

/**
 * The admin gate for every /api/admin/v1 route except sign-in. Accepts a `clm_` admin session, or the legacy static token
 * when ADMIN_TOKEN_SHA256 is configured. Sets ctx.admin so audit entries name the actor.
 */
export async function authenticateAdmin(ctx: Ctx): Promise<AdminPrincipal> {
  const token = bearerToken(ctx.request);
  let principal: AdminPrincipal;
  if (token?.startsWith(SESSION_PREFIX)) {
    principal = await authenticateAdminSession(ctx, token);
  } else {
    const digest = ctx.config.adminTokenSha256;
    if (!digest) {
      // Something is configured for admin sign-in: unknown callers are simply unauthorized. Nothing configured: say so.
      if (ctx.config.adminBootstrapEmails.length > 0 || ctx.config.adminConfigError) return authFailure(ctx);
      throw unavailable("admin_not_configured", "Neither ADMIN_BOOTSTRAP_EMAILS nor ADMIN_TOKEN_SHA256 is set.");
    }
    if (!token) return authFailure(ctx);
    if (!timingSafeEqualHex(await sha256Hex(token), digest)) return authFailure(ctx);
    principal = { type: "admin", method: "static_token", adminId: null };
  }
  ctx.admin = principal;
  return principal;
}

async function authenticateAdminSession(ctx: Ctx, token: string): Promise<AdminPrincipal> {
  if (token.length > 256) return authFailure(ctx);
  const now = iso(ctx.clock.now());
  const row = await ctx.env.DB.prepare(
    `SELECT s.token_id, s.expires_at, s.auth_at, a.admin_id, a.email, a.role, a.status
       FROM admin_sessions s JOIN admins a ON a.admin_id = s.admin_id
      WHERE s.token_sha256 = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2`,
  )
    .bind(await sha256Hex(token), now)
    .first<{ token_id: string; expires_at: string; auth_at: string; admin_id: string; email: string; role: AdminRole; status: string }>();
  if (!row || !eligible(ctx, row)) return authFailure(ctx);
  // Throttled like the other session kinds: at most one write per session per 5 minutes.
  ctx.exec.waitUntil(
    ctx.env.DB.prepare(`UPDATE admin_sessions SET last_used_at = ?1 WHERE token_id = ?2 AND (last_used_at IS NULL OR last_used_at < ?3)`)
      .bind(now, row.token_id, iso(addSeconds(ctx.clock.now(), -LAST_USED_THROTTLE_SECONDS)))
      .run(),
  );
  return { type: "admin", method: "session", adminId: row.admin_id, email: row.email, role: row.role, tokenId: row.token_id, expiresAt: row.expires_at, authenticatedAt: row.auth_at };
}

/* ------------------------------------------------------------------ sign-in (called by the Google callback) */

export type AdminSignInResult = { ok: true; code: string } | { ok: false; why: string };

/**
 * Decides whether a Google identity that already passed every ID-token check may become an admin, and if so records the
 * subject binding and a single-use exchange code. `why` is an internal reason for the audit log (never the e-mail).
 */
export async function completeAdminSignIn(ctx: Ctx, identity: { sub: string; email: string }): Promise<AdminSignInResult> {
  const bootstrap = ctx.config.adminBootstrapEmails;
  if (bootstrap.length === 0) return { ok: false, why: "admin_not_configured" };
  const db = ctx.env.DB;
  const now = iso(ctx.clock.now());
  const bootstrapped = bootstrap.includes(identity.email);
  const select = () =>
    db.prepare(`SELECT admin_id, email, google_sub, role, status FROM admins WHERE email = ?1`).bind(identity.email).first<AdminRow>();

  let row = await select();
  if (!row) {
    if (!bootstrapped) return { ok: false, why: "not_allowlisted" };
    // First sign-in of a bootstrap owner. Two simultaneous first sign-ins race on the unique e-mail; the loser reads the winner's row.
    await db.prepare(`INSERT OR IGNORE INTO admins (admin_id, email, role, status, created_at) VALUES (?1, ?2, 'owner', 'active', ?3)`).bind(newId("adm"), identity.email, now).run();
    row = await select();
    if (!row) return { ok: false, why: "enrol_failed" };
  }
  if (row.status !== "active") return { ok: false, why: "disabled" };
  if (row.role === "owner" && !bootstrapped) return { ok: false, why: "owner_not_in_bootstrap" };
  if (row.google_sub !== null && row.google_sub !== identity.sub) return { ok: false, why: "subject_mismatch" };

  const role: AdminRole = bootstrapped ? "owner" : row.role;
  try {
    const bound = await db
      .prepare(`UPDATE admins SET google_sub = ?1, role = ?2, last_login_at = ?3 WHERE admin_id = ?4 AND status = 'active' AND (google_sub IS NULL OR google_sub = ?1)`)
      .bind(identity.sub, role, now, row.admin_id)
      .run();
    if ((bound.meta?.changes ?? 0) !== 1) return { ok: false, why: "subject_mismatch" };
  } catch (err) {
    // The same Google subject is already bound to another admin row.
    if (err instanceof Error && /UNIQUE/i.test(err.message)) return { ok: false, why: "subject_conflict" };
    throw err;
  }

  const code = randomToken("cax");
  await db
    .prepare(`INSERT INTO admin_login_exchanges (code_sha256, admin_id, auth_at, created_at, expires_at) VALUES (?1, ?2, ?3, ?3, ?4)`)
    .bind(await sha256Hex(code), row.admin_id, now, iso(addSeconds(ctx.clock.now(), ADMIN_EXCHANGE_TTL_SECONDS)))
    .run();
  await auditStatement(ctx, { actorType: "admin", actorId: row.admin_id, action: "admin.google_login", targetType: "admin", targetId: row.admin_id, detail: { role } }).run();
  return { ok: true, code };
}

/* ------------------------------------------------------------------ routes */

const ExchangeRequest = z.object({ code: z.string().min(8).max(200) }).strict();

/** POST /api/admin/v1/session/exchange: trades the single-use code for the admin's own session. */
export async function exchangeAdminSession(ctx: Ctx): Promise<Response> {
  requireAdminSignInConfigured(ctx);
  await spendLoginBudget(ctx);
  const body = await readJson(ctx.request, ExchangeRequest, 2 * 1024);
  const now = iso(ctx.clock.now());
  const used = await ctx.env.DB.prepare(
    `UPDATE admin_login_exchanges SET used_at = ?1 WHERE code_sha256 = ?2 AND used_at IS NULL AND expires_at > ?1 RETURNING admin_id, auth_at`,
  )
    .bind(now, await sha256Hex(body.code))
    .first<{ admin_id: string; auth_at: string }>();
  if (!used) return authFailure(ctx);
  const admin = await ctx.env.DB.prepare(`SELECT admin_id, email, role, status FROM admins WHERE admin_id = ?1`)
    .bind(used.admin_id)
    .first<{ admin_id: string; email: string; role: AdminRole; status: string }>();
  // Re-checked here: the admin may have been disabled, or removed from the bootstrap secret, since the callback.
  if (!admin || !eligible(ctx, admin)) return authFailure(ctx);

  const token = randomToken("clm");
  const tokenId = newId("ats");
  const expiresAt = iso(addSeconds(ctx.clock.now(), ctx.config.adminSessionTtlMinutes * 60));
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`INSERT INTO admin_sessions (token_id, admin_id, token_sha256, created_at, expires_at, auth_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(
      tokenId,
      admin.admin_id,
      await sha256Hex(token),
      now,
      expiresAt,
      used.auth_at,
    ),
    auditStatement(ctx, { actorType: "admin", actorId: admin.admin_id, action: "admin.session_create", targetType: "admin_session", targetId: tokenId }),
  ]);
  return json({ token, token_type: "Bearer", expires_at: expiresAt, storage: "memory_only", admin: { admin_id: admin.admin_id, role: admin.role } }, 201);
}

/** DELETE /api/admin/v1/session: ends this session only. */
export async function logoutAdmin(ctx: Ctx, admin: AdminPrincipal): Promise<Response> {
  if (admin.method !== "session") throw new HttpError(400, "no_session", "Bad request", "The static operator token has no session to end.");
  const now = iso(ctx.clock.now());
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE admin_sessions SET revoked_at = ?1 WHERE token_id = ?2 AND revoked_at IS NULL`).bind(now, admin.tokenId),
    auditStatement(ctx, { actorType: "admin", actorId: adminActorId(ctx), action: "admin.session_revoke", targetType: "admin_session", targetId: admin.tokenId }),
  ]);
  return new Response(null, { status: 204 });
}

/** GET /api/admin/v1/me: who the server believes the caller is. No tokens, no secrets, no other admins. */
export function adminMe(admin: AdminPrincipal): Response {
  if (admin.method === "static_token") return json({ auth_method: "static_token", admin_id: null, role: null });
  return json({
    auth_method: "session",
    admin_id: admin.adminId,
    email: admin.email,
    role: admin.role,
    session: { expires_at: admin.expiresAt, authenticated_at: admin.authenticatedAt },
  });
}
