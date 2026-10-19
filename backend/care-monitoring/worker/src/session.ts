/**
 * Web sign-in for caregivers and showcase viewers (judges), without weakening the API.
 *
 * - The owner issues a login credential with the admin API: an account identifier (e-mail or plain user name)
 *   plus either a server-generated secret of 100 bits (SHA-256 storage is sufficient) or an owner-chosen password
 *   (stored with salted PBKDF2, see password.ts).
 * - POST /api/app/v1/session exchanges it for a short-lived caregiver session token (SESSION_TTL_HOURS,
 *   stored hashed). The browser keeps it in memory only. Authorization stays per recipient: a judge gets a
 *   `viewer` grant (read-only), a family caregiver a `caregiver` grant.
 * - Every sign-in creates its own session, so one shared judge account works in many browsers at once;
 *   logging out ends only that session. Re-issuing the credential (admin login) ends all of them.
 * - POST /api/app/v1/stream-tickets mints a single-use, 60-second ticket for GET /api/demo/stream?ticket=…,
 *   because a browser EventSource cannot send an Authorization header. The ticket never grants more than
 *   data.read on one recipient and dies on first use.
 */
import { LoginRequestV1, StreamTicketRequestV1 } from "./contracts";
import { auditStatement, authFailure, clientIp, permissionsOf, requireRecipient, type CaregiverPrincipal, type Ctx } from "./context";
import { HttpError, json, readJson, unauthorized } from "./http";
import { verifyLoginSecret } from "./password";
import { addSeconds, iso, newId, randomToken, sha256Hex } from "./util";

export const STREAM_TICKET_TTL_SECONDS = 60;
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/** 20 characters of Crockford base32 = 100 bits, grouped for reading aloud: xxxxx-xxxxx-xxxxx-xxxxx. */
export function loginSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = [...bytes].map((b) => CROCKFORD[b & 31]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-");
}

/** Every sign-in attempt, right or wrong, spends the per-IP budget before the credential is checked, so a
 * correct guess cannot get through once the budget is spent. Its own key keeps it apart from other failed
 * authentications; with the AUTH_FAILURE_LIMITER setting (20 per 60 s) a panel of judges behind one venue
 * NAT still signs in. */
async function spendLoginBudget(ctx: Ctx): Promise<void> {
  const limiter = ctx.env.AUTH_FAILURE_LIMITER;
  if (!limiter) return;
  const { success } = await limiter.limit({ key: `login:${clientIp(ctx.request) || "unknown"}` });
  if (!success) throw new HttpError(429, "too_many_attempts", "Too many requests", "Too many sign-in attempts from this network. Try again in a minute.", { "retry-after": "60" });
}

export async function login(ctx: Ctx): Promise<Response> {
  // Checked before any credential lookup: with PASSWORD_SIGN_IN=disabled no password is ever compared.
  if (!ctx.config.passwordSignIn) throw new HttpError(403, "password_sign_in_disabled", "Password sign-in is disabled", "This server accepts Google sign-in only.");
  await spendLoginBudget(ctx);
  const body = await readJson(ctx.request, LoginRequestV1, 4 * 1024);
  const row = await ctx.env.DB.prepare(`SELECT user_id, display_name, status, login_secret_sha256 FROM caregivers WHERE login_email = ?1`)
    .bind(body.username ?? body.email)
    .first<{ user_id: string; display_name: string; status: string; login_secret_sha256: string | null }>();
  const matches = await verifyLoginSecret(row?.login_secret_sha256 ?? null, body.password, ctx.config.loginPbkdf2Iterations);
  if (!row || !matches || row.status !== "active") {
    await auditStatement(ctx, { actorType: "caregiver", actorId: null, action: "session.login", outcome: "denied" }).run();
    return authFailure(ctx);
  }
  return issueSession(ctx, row, "session.login");
}

/** Creates a new session (its own token: sessions of the same account never affect each other) and describes what it may read. */
export async function issueSession(ctx: Ctx, row: { user_id: string; display_name: string }, auditAction: string): Promise<Response> {
  const now = ctx.clock.now();
  const token = randomToken("clc");
  const tokenId = newId("tok");
  const expiresAt = iso(addSeconds(now, ctx.config.sessionTtlHours * 3600));
  const [, , grants] = await ctx.env.DB.batch([
    ctx.env.DB.prepare(`INSERT INTO caregiver_tokens (token_id, user_id, kind, token_sha256, created_at, expires_at) VALUES (?1, ?2, 'session', ?3, ?4, ?5)`).bind(
      tokenId,
      row.user_id,
      await sha256Hex(token),
      iso(now),
      expiresAt,
    ),
    auditStatement(ctx, { actorType: "caregiver", actorId: row.user_id, action: auditAction, targetType: "caregiver_token", targetId: tokenId }),
    ctx.env.DB.prepare(
      `SELECT g.recipient_id, g.role, r.display_label, r.timezone FROM grants g JOIN care_recipients r ON r.recipient_id = g.recipient_id
       WHERE g.user_id = ?1 AND g.revoked_at IS NULL AND r.status = 'active' ORDER BY r.display_label`,
    ).bind(row.user_id),
  ]);
  return json(
    {
      token,
      token_type: "Bearer",
      expires_at: expiresAt,
      storage: "memory_only",
      user: { user_id: row.user_id, display_name: row.display_name },
      recipients: ((grants?.results ?? []) as Array<{ recipient_id: string; role: string; display_label: string; timezone: string }>).map((g) => ({
        ...g,
        permissions: permissionsOf(g.role),
      })),
    },
    201,
  );
}

export async function logout(ctx: Ctx, user: CaregiverPrincipal): Promise<Response> {
  const now = iso(ctx.clock.now());
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE caregiver_tokens SET revoked_at = ?1 WHERE token_id = ?2 AND kind = 'session' AND revoked_at IS NULL`).bind(now, user.tokenId),
    ctx.env.DB.prepare(`UPDATE stream_tickets SET used_at = COALESCE(used_at, ?1) WHERE token_id = ?2`).bind(now, user.tokenId),
    auditStatement(ctx, { actorType: "caregiver", actorId: user.userId, action: "session.logout", targetType: "caregiver_token", targetId: user.tokenId }),
  ]);
  return new Response(null, { status: 204 });
}

export async function createStreamTicket(ctx: Ctx, user: CaregiverPrincipal): Promise<Response> {
  const body = await readJson(ctx.request, StreamTicketRequestV1, 1024);
  await requireRecipient(ctx, user, body.recipient_id, "data.read");
  const ticket = randomToken("cls");
  const now = ctx.clock.now();
  const expiresAt = iso(addSeconds(now, STREAM_TICKET_TTL_SECONDS));
  await ctx.env.DB.prepare(
    `INSERT INTO stream_tickets (ticket_sha256, user_id, token_id, recipient_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(await sha256Hex(ticket), user.userId, user.tokenId, body.recipient_id, iso(now), expiresAt)
    .run();
  return json({ ticket, expires_at: expiresAt, single_use: true, stream_path: "/api/demo/stream" }, 201);
}

export interface TicketGrant {
  userId: string;
  recipientId: string;
}

/** Consumes a ticket atomically and re-checks that the user's token and grant are still active. */
export async function consumeStreamTicket(ctx: Ctx, ticket: string): Promise<TicketGrant> {
  if (!ticket.startsWith("cls_") || ticket.length > 128) return authFailure(ctx);
  const now = iso(ctx.clock.now());
  const row = await ctx.env.DB.prepare(
    `UPDATE stream_tickets SET used_at = ?1
     WHERE ticket_sha256 = ?2 AND used_at IS NULL AND expires_at > ?1
       AND EXISTS (SELECT 1 FROM caregiver_tokens t JOIN caregivers c ON c.user_id = t.user_id
                   WHERE t.token_id = stream_tickets.token_id AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?1) AND c.status = 'active')
     RETURNING user_id, recipient_id`,
  )
    .bind(now, await sha256Hex(ticket))
    .first<{ user_id: string; recipient_id: string }>();
  if (!row) return authFailure(ctx);
  try {
    await requireRecipient(ctx, { type: "caregiver", userId: row.user_id, tokenId: "" }, row.recipient_id, "data.read");
  } catch (err) {
    if (err instanceof HttpError) throw unauthorized();
    throw err;
  }
  return { userId: row.user_id, recipientId: row.recipient_id };
}
