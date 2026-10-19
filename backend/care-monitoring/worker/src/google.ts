/**
 * Google sign-in: OpenID Connect authorization code flow with PKCE, verified on the server.
 *
 *   browser ──GET /api/app/v1/auth/google/start──▶ Worker: new state, nonce, PKCE verifier, browser-binding cookie
 *           ◀── 302 accounts.google.com (scope "openid email" only) ──
 *   Google ──302 /api/app/v1/auth/google/callback?code&state──▶ Worker:
 *       state single-use, unexpired and bound to this browser's cookie; code exchanged server-to-server with the
 *       client secret and the PKCE verifier; ID token checked (RS256 signature against Google's JWKS, issuer, audience,
 *       expiry, nonce, verified e-mail); identity looked up in the owner's allowlist (google_identities).
 *   Worker ──302 <GOOGLE_POST_LOGIN_URL>#code=<single-use exchange code>──▶ web app
 *   web app ──POST /api/app/v1/session/exchange {code}──▶ the application's own session (same as password sign-in)
 *
 * A Google account that is not in the allowlist gets nothing. The browser only ever supplies state and a code; it
 * never tells the server who it is. Redirect targets are fixed settings, never request input. Authorization codes,
 * tokens, the client secret and profile data are never logged.
 */
import { z } from "zod";
import { auditStatement, authFailure, clientIp, type Ctx } from "./context";
import type { GoogleSettings } from "./env";
import { HttpError, json, readJson } from "./http";
import { issueSession } from "./session";
import { addSeconds, iso, randomToken, sha256Hex } from "./util";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
export const STATE_TTL_SECONDS = 600;
export const EXCHANGE_TTL_SECONDS = 60;
const COOKIE = "cl_oauth";
const COOKIE_PATH = "/api/app/v1/auth/google";
const CLOCK_SKEW_SECONDS = 120;

/** Reasons put in the fragment of the redirect back to the web app (no detail, nothing sensitive). */
export type GoogleFailure = "google_denied" | "google_state" | "google_exchange" | "google_token" | "google_unauthorized" | "google_unavailable";

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromB64url(text: string): Uint8Array {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function settings(ctx: Ctx): GoogleSettings {
  if (ctx.config.googleConfigError) throw new HttpError(503, "misconfigured", "Service misconfigured", ctx.config.googleConfigError);
  const g = ctx.config.google;
  if (!g) throw new HttpError(503, "google_not_configured", "Google sign-in is not configured", "The owner has not configured Google sign-in on this server.");
  return g;
}

function doFetch(ctx: Ctx): typeof fetch {
  return ctx.outboundFetch ?? fetch;
}

/** GET /auth/google/config: lets the login page show an honest message instead of redirecting into a dead end. */
export async function googleConfig(ctx: Ctx): Promise<Response> {
  if (ctx.config.googleConfigError) throw new HttpError(503, "misconfigured", "Service misconfigured", ctx.config.googleConfigError);
  return json({ enabled: ctx.config.google !== null });
}

async function spendBudget(ctx: Ctx): Promise<void> {
  const limiter = ctx.env.AUTH_FAILURE_LIMITER;
  if (!limiter) return;
  const { success } = await limiter.limit({ key: `login:${clientIp(ctx.request) || "unknown"}` });
  if (!success) throw new HttpError(429, "too_many_attempts", "Too many requests", "Too many sign-in attempts from this network. Try again in a minute.", { "retry-after": "60" });
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

function bindingCookie(ctx: Ctx, value: string, maxAge: number): string {
  const secure = new URL(ctx.config.google?.redirectUri ?? ctx.request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=${maxAge}${secure}`;
}

/** GET /auth/google/start */
export async function googleStart(ctx: Ctx): Promise<Response> {
  const g = settings(ctx);
  await spendBudget(ctx);
  // The cookie is host-only, so the flow must start on the very host Google will send the user back to.
  if (ctx.url.origin !== new URL(g.redirectUri).origin) {
    throw new HttpError(400, "redirect_origin_mismatch", "Wrong origin", "Start Google sign-in on the same origin as GOOGLE_REDIRECT_URI.");
  }
  const state = randomToken("st");
  const nonce = randomToken("nn");
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const binding = randomToken("bd");
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const now = ctx.clock.now();
  await ctx.env.DB.prepare(
    `INSERT INTO oauth_states (state_sha256, binding_sha256, nonce, code_verifier, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(await sha256Hex(state), await sha256Hex(binding), nonce, verifier, iso(now), iso(addSeconds(now, STATE_TTL_SECONDS)))
    .run();
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: g.redirectUri,
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return new Response(null, { status: 302, headers: { location: url.toString(), "cache-control": "no-store", "set-cookie": bindingCookie(ctx, binding, STATE_TTL_SECONDS) } });
}

function backToApp(ctx: Ctx, fragment: Record<string, string>): Response {
  const g = ctx.config.google;
  const target = new URL(g?.postLoginUrl ?? ctx.url.origin);
  target.hash = new URLSearchParams(fragment).toString();
  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), "cache-control": "no-store", "set-cookie": bindingCookie(ctx, "", 0), "referrer-policy": "no-referrer" },
  });
}

async function fail(ctx: Ctx, reason: GoogleFailure, detail?: Record<string, unknown>): Promise<Response> {
  await auditStatement(ctx, { actorType: "system", actorId: null, action: "session.google_login", outcome: "denied", detail: { reason, ...(detail ?? {}) } }).run();
  return backToApp(ctx, { error: reason });
}

/* ------------------------------------------------------------------ ID token */

interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 3_600_000;

async function loadJwks(ctx: Ctx, force: boolean): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await doFetch(ctx)(JWKS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys)) throw new Error("jwks malformed");
  jwksCache = { keys: body.keys, fetchedAt: Date.now() };
  return jwksCache.keys;
}

/** Test hook: forget the cached key set. */
export function resetGoogleKeyCache(): void {
  jwksCache = null;
}

const IdClaims = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  azp: z.string().optional(),
  sub: z.string().min(1),
  exp: z.number(),
  iat: z.number().optional(),
  nonce: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional(),
});

export interface VerifiedIdentity {
  sub: string;
  email: string;
}

/** Throws on anything wrong with the token; returns only the verified subject and e-mail. */
export async function verifyIdToken(ctx: Ctx, idToken: string, expectedNonce: string, g: GoogleSettings): Promise<VerifiedIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("not a JWT");
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(new TextDecoder().decode(fromB64url(h))) as { alg?: string; kid?: string };
  if (header.alg !== "RS256" || !header.kid) throw new Error("unsupported alg");
  let jwk = (await loadJwks(ctx, false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await loadJwks(ctx, true)).find((k) => k.kid === header.kid);
  if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) throw new Error("unknown signing key");
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!valid) throw new Error("bad signature");
  const claims = IdClaims.parse(JSON.parse(new TextDecoder().decode(fromB64url(p))));
  const nowSec = Math.floor(ctx.clock.now().getTime() / 1000);
  if (!ISSUERS.includes(claims.iss)) throw new Error("bad issuer");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(g.clientId)) throw new Error("bad audience");
  if (audiences.length > 1 && claims.azp !== g.clientId) throw new Error("bad authorized party");
  if (claims.exp + CLOCK_SKEW_SECONDS < nowSec) throw new Error("expired");
  if (claims.iat !== undefined && claims.iat - CLOCK_SKEW_SECONDS > nowSec) throw new Error("issued in the future");
  if (claims.nonce !== expectedNonce) throw new Error("nonce mismatch");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new Error("e-mail not verified");
  const email = claims.email?.trim().toLowerCase();
  if (!email) throw new Error("no e-mail");
  return { sub: claims.sub, email };
}

/* ------------------------------------------------------------------ callback */

/** GET /auth/google/callback */
export async function googleCallback(ctx: Ctx): Promise<Response> {
  const g = settings(ctx);
  const params = ctx.url.searchParams;
  if (params.get("error")) return fail(ctx, "google_denied");
  const code = params.get("code");
  const state = params.get("state");
  const binding = cookieValue(ctx.request, COOKIE);
  if (!code || !state || !binding || code.length > 2048 || state.length > 256) return fail(ctx, "google_state");
  try {
    await spendBudget(ctx);
  } catch (err) {
    if (err instanceof HttpError) return fail(ctx, "google_unavailable", { why: "rate_limited" });
    throw err;
  }

  const now = iso(ctx.clock.now());
  const row = await ctx.env.DB.prepare(
    `UPDATE oauth_states SET used_at = ?1 WHERE state_sha256 = ?2 AND binding_sha256 = ?3 AND used_at IS NULL AND expires_at > ?1 RETURNING nonce, code_verifier`,
  )
    .bind(now, await sha256Hex(state), await sha256Hex(binding))
    .first<{ nonce: string; code_verifier: string }>();
  if (!row) return fail(ctx, "google_state");

  let idToken: string;
  try {
    const res = await doFetch(ctx)(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: g.clientId,
        client_secret: g.clientSecret,
        redirect_uri: g.redirectUri,
        grant_type: "authorization_code",
        code_verifier: row.code_verifier,
      }).toString(),
    });
    if (!res.ok) return fail(ctx, "google_exchange", { http: res.status });
    const body = (await res.json()) as { id_token?: string };
    if (typeof body.id_token !== "string") return fail(ctx, "google_exchange", { why: "no_id_token" });
    idToken = body.id_token;
  } catch {
    return fail(ctx, "google_unavailable", { why: "token_endpoint" });
  }

  let identity: VerifiedIdentity;
  try {
    identity = await verifyIdToken(ctx, idToken, row.nonce, g);
  } catch (err) {
    // Only the failed check is recorded, never the token or its claims.
    return fail(ctx, "google_token", { check: err instanceof Error ? err.message.slice(0, 40) : "invalid" });
  }

  const owner = await ctx.env.DB.prepare(
    `SELECT i.user_id, i.google_sub, c.status FROM google_identities i JOIN caregivers c ON c.user_id = i.user_id WHERE i.email = ?1`,
  )
    .bind(identity.email)
    .first<{ user_id: string; google_sub: string | null; status: string }>();
  if (!owner || owner.status !== "active" || (owner.google_sub !== null && owner.google_sub !== identity.sub)) {
    return fail(ctx, "google_unauthorized");
  }

  const exchange = randomToken("clx");
  const nowDate = ctx.clock.now();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE google_identities SET google_sub = ?1, last_login_at = ?2 WHERE email = ?3 AND (google_sub IS NULL OR google_sub = ?1)`).bind(identity.sub, iso(nowDate), identity.email),
    ctx.env.DB.prepare(`INSERT INTO login_exchanges (code_sha256, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)`).bind(
      await sha256Hex(exchange),
      owner.user_id,
      iso(nowDate),
      iso(addSeconds(nowDate, EXCHANGE_TTL_SECONDS)),
    ),
  ]);
  return backToApp(ctx, { code: exchange });
}

/* ------------------------------------------------------------------ exchange */

const ExchangeRequest = z.object({ code: z.string().min(8).max(200) }).strict();

/** POST /session/exchange: turns the single-use code into the application's own session. */
export async function exchangeSession(ctx: Ctx): Promise<Response> {
  await spendBudget(ctx);
  const body = await readJson(ctx.request, ExchangeRequest, 2 * 1024);
  const now = iso(ctx.clock.now());
  const row = await ctx.env.DB.prepare(
    `UPDATE login_exchanges SET used_at = ?1 WHERE code_sha256 = ?2 AND used_at IS NULL AND expires_at > ?1
       AND EXISTS (SELECT 1 FROM caregivers c WHERE c.user_id = login_exchanges.user_id AND c.status = 'active')
     RETURNING user_id`,
  )
    .bind(now, await sha256Hex(body.code))
    .first<{ user_id: string }>();
  if (!row) return authFailure(ctx);
  const user = await ctx.env.DB.prepare(`SELECT user_id, display_name FROM caregivers WHERE user_id = ?1`).bind(row.user_id).first<{ user_id: string; display_name: string }>();
  if (!user) return authFailure(ctx);
  return issueSession(ctx, user, "session.google_login");
}
