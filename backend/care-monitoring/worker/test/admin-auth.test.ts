/**
 * Admin identity, sessions and authorization (Phase B). Google is replaced by a fake injected through `outboundFetch`: it
 * owns a real RSA key pair, publishes a JWKS and signs real RS256 ID tokens, so the Worker's signature, issuer, audience,
 * expiry, nonce and state checks run for real. No Google account and no production credential is involved; every e-mail,
 * subject and token below is synthetic.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetGoogleKeyCache } from "../src/google";
import { ADMIN_TOKEN, TestClock, freshDb, harness, ok, problemCode, provision, type Harness, type World } from "./helpers";

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "test-only-client-secret";
const REDIRECT = "https://cm.test/api/app/v1/auth/google/callback";
const APP = "https://app.example.test/login";
const GOOGLE_ENV = { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_REDIRECT_URI: REDIRECT, GOOGLE_POST_LOGIN_URL: APP };
const OWNER = "owner.test@example.invalid";
const OTHER_OWNER = "second.owner.test@example.invalid";
const STRANGER = "stranger.test@example.invalid";
const ADMIN_ENV = { ...GOOGLE_ENV, ADMIN_BOOTSTRAP_EMAILS: OWNER };
const OPEN_ENV = { ...ADMIN_ENV, GOOGLE_OPEN_VIEWER_RECIPIENT_ID: "rcp-open-showcase" };

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const b64urlJson = (value: unknown) => b64url(enc.encode(JSON.stringify(value)));

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let jwk: JsonWebKey;

beforeAll(async () => {
  const gen = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
  const pair = await gen();
  signingKey = pair.privateKey;
  jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  otherKey = (await gen()).privateKey;
});

interface TokenOptions {
  sub?: string;
  email?: string;
  emailVerified?: boolean;
  iss?: string;
  aud?: string;
  exp?: number;
  nonce?: string;
  key?: CryptoKey;
}

async function idToken(clock: TestClock, nonce: string, o: TokenOptions): Promise<string> {
  const now = Math.floor(clock.t / 1000);
  const header = b64urlJson({ alg: "RS256", kid: "test-kid", typ: "JWT" });
  const payload = b64urlJson({
    iss: o.iss ?? "https://accounts.google.com",
    aud: o.aud ?? CLIENT_ID,
    sub: o.sub ?? "admin-sub-1",
    iat: now,
    exp: o.exp ?? now + 3600,
    nonce: o.nonce ?? nonce,
    email_verified: o.emailVerified ?? true,
    email: o.email ?? OWNER,
  });
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", o.key ?? signingKey, enc.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}

interface FakeGoogle {
  fetch: typeof fetch;
  next: TokenOptions;
  lastAuth: { nonce: string; challenge: string } | null;
}

function fakeGoogle(clock: TestClock): FakeGoogle {
  const g: FakeGoogle = {
    next: {},
    lastAuth: null,
    fetch: async (input, init) => {
      const url = String(input);
      if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [{ ...jwk, kid: "test-kid", use: "sig", alg: "RS256" }] });
      if (url === "https://oauth2.googleapis.com/token") {
        const form = Object.fromEntries(new URLSearchParams(String(init?.body))) as Record<string, string>;
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(form.code_verifier ?? "")));
        if (b64url(digest) !== g.lastAuth?.challenge || form.code !== "good-code" || form.client_secret !== CLIENT_SECRET) return Response.json({ error: "invalid_grant" }, { status: 400 });
        return Response.json({ id_token: await idToken(clock, g.lastAuth?.nonce ?? "", g.next), token_type: "Bearer" });
      }
      throw new Error(`unexpected outbound fetch ${url}`);
    },
  };
  return g;
}

let h: Harness;
let w: World;
let google: FakeGoogle;
let clock: TestClock;
let testNumber = 0;

async function start(mode: "admin" | "viewer" | null, env: Record<string, string> = ADMIN_ENV): Promise<{ state: string; cookie: string; res: Response }> {
  const res = await h.call("GET", `/api/app/v1/auth/google/start${mode ? `?mode=${mode}` : ""}`, { envOverrides: env });
  expect(res.status, await res.clone().text()).toBe(302);
  const auth = new URL(res.headers.get("location")!);
  google.lastAuth = { nonce: auth.searchParams.get("nonce")!, challenge: auth.searchParams.get("code_challenge")! };
  return { state: auth.searchParams.get("state")!, cookie: /cl_oauth=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1]!, res };
}

async function callback(state: string, cookie: string | null, env: Record<string, string> = ADMIN_ENV, extra = ""): Promise<{ location: URL; fragment: URLSearchParams }> {
  const res = await h.call("GET", `/api/app/v1/auth/google/callback?code=good-code&state=${encodeURIComponent(state)}${extra}`, {
    envOverrides: env,
    headers: cookie ? { cookie: `cl_oauth=${cookie}` } : {},
  });
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("location")!);
  return { location, fragment: new URLSearchParams(location.hash.slice(1)) };
}

interface AdminLogin {
  token: string;
  admin: { admin_id: string; role: string };
  expires_at: string;
}

/** The whole admin round trip: start → Google → callback → exchange. */
async function adminSignIn(email = OWNER, sub = "admin-sub-1", env: Record<string, string> = ADMIN_ENV): Promise<AdminLogin> {
  google.next = { email, sub };
  const s = await start("admin", env);
  const back = await callback(s.state, s.cookie, env);
  const code = back.fragment.get("admin_code");
  expect(code, `callback said ${back.fragment.toString()}`).toMatch(/^cax_/);
  return ok<AdminLogin>(await h.call("POST", "/api/admin/v1/session/exchange", { json: { code }, envOverrides: env }), 201);
}

const count = async (sql: string, ...binds: unknown[]) => (await h.env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

describe("admin Google sign-in and sessions", () => {
  beforeEach(async () => {
    await freshDb();
    clock = new TestClock();
    google = fakeGoogle(clock);
    h = harness(clock, {}, { outboundFetch: google.fetch });
    // Each test gets its own client address: the sign-in rate limiter counts in real time, not in TestClock time.
    const call = h.call.bind(h);
    const ip = `198.51.100.${++testNumber}`;
    h.call = (method, path, opts = {}) => call(method, path, { ip, ...opts });
    resetGoogleKeyCache();
    w = await provision(h);
  });

  /* ---------------------------------------------------------------- the valid path */

  it("signs a bootstrap owner in and issues a distinct admin session that is stored only as a hash", async () => {
    google.next = { email: OWNER, sub: "admin-sub-1" };
    const s = await start("admin");
    const back = await callback(s.state, s.cookie);
    // Back to the fixed admin page on the app's own origin; only a single-use code travels, never a session or ID token.
    expect(back.location.origin + back.location.pathname).toBe("https://app.example.test/admin/login");
    expect(back.fragment.get("admin_code")).toMatch(/^cax_/);
    expect(back.fragment.has("code")).toBe(false);
    expect(back.location.toString()).not.toMatch(/clm_|clc_|eyJ|good-code/);

    const login = await ok<AdminLogin & { token_type: string; storage: string }>(
      await h.call("POST", "/api/admin/v1/session/exchange", { json: { code: back.fragment.get("admin_code") }, envOverrides: ADMIN_ENV }),
      201,
    );
    expect(login.token).toMatch(/^clm_/);
    expect(login.storage).toBe("memory_only");
    expect(login.admin.role).toBe("owner");
    expect(Date.parse(login.expires_at) - clock.t).toBe(120 * 60 * 1000); // default ADMIN_SESSION_TTL_MINUTES

    const row = await h.env.DB.prepare(`SELECT token_sha256 FROM admin_sessions WHERE admin_id = ?1`).bind(login.admin.admin_id).first<{ token_sha256: string }>();
    expect(row?.token_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.token_sha256).not.toContain(login.token);
    const admin = await h.env.DB.prepare(`SELECT email, google_sub, role, status FROM admins WHERE admin_id = ?1`).bind(login.admin.admin_id).first();
    expect(admin).toEqual({ email: OWNER, google_sub: "admin-sub-1", role: "owner", status: "active" });
  });

  it("returns only the minimum profile from GET /api/admin/v1/me", async () => {
    const login = await adminSignIn();
    const me = await ok<Record<string, unknown>>(await h.call("GET", "/api/admin/v1/me", { token: login.token, envOverrides: ADMIN_ENV }));
    expect(me).toEqual({
      auth_method: "session",
      admin_id: login.admin.admin_id,
      email: OWNER,
      role: "owner",
      session: { expires_at: login.expires_at, authenticated_at: new Date(clock.t).toISOString() },
    });
    const text = JSON.stringify(me);
    expect(text).not.toMatch(/clm_|token|google_sub|admin-sub-1|secret/i);
  });

  it("matches the bootstrap list case-insensitively and ignores separators and blanks", async () => {
    const env = { ...ADMIN_ENV, ADMIN_BOOTSTRAP_EMAILS: ` ${OTHER_OWNER.toUpperCase()} ;\n Owner.Test@Example.INVALID,, ` };
    google.next = { email: "OWNER.TEST@example.invalid", sub: "admin-sub-1" };
    const login = await adminSignIn("OWNER.TEST@example.invalid", "admin-sub-1", env);
    expect(login.admin.role).toBe("owner");
    expect(await count(`SELECT COUNT(*) AS n FROM admins WHERE email = ?1`, OWNER)).toBe(1);
  });

  it("keeps sessions independent: logging one out leaves the other", async () => {
    const a = await adminSignIn();
    const b = await adminSignIn();
    expect(a.token).not.toBe(b.token);
    expect(a.admin.admin_id).toBe(b.admin.admin_id);
    expect((await h.call("DELETE", "/api/admin/v1/session", { token: a.token, envOverrides: ADMIN_ENV })).status).toBe(204);
    expect((await h.call("GET", "/api/admin/v1/me", { token: a.token, envOverrides: ADMIN_ENV })).status).toBe(401);
    expect((await h.call("GET", "/api/admin/v1/me", { token: b.token, envOverrides: ADMIN_ENV })).status).toBe(200);
  });

  it("honours ADMIN_SESSION_TTL_MINUTES and refuses an out-of-range value", async () => {
    const env = { ...ADMIN_ENV, ADMIN_SESSION_TTL_MINUTES: "15" };
    const login = await adminSignIn(OWNER, "admin-sub-1", env);
    expect(Date.parse(login.expires_at) - clock.t).toBe(15 * 60 * 1000);
    const bad = await h.call("GET", "/health", { envOverrides: { ADMIN_SESSION_TTL_MINUTES: "5" } });
    expect(bad.status).toBe(503);
  });

  /* ---------------------------------------------------------------- sessions that must be refused */

  it("refuses missing, malformed, unknown, oversized, expired and revoked admin sessions", async () => {
    const login = await adminSignIn();
    const me = (token: string | null) => h.call("GET", "/api/admin/v1/me", { token, envOverrides: ADMIN_ENV });
    expect((await me(null)).status).toBe(401);
    expect((await me("clm_")).status).toBe(401);
    expect((await me("clm_not-a-real-session")).status).toBe(401);
    expect((await me(`clm_${"a".repeat(400)}`)).status).toBe(401);
    expect((await me("Bearer")).status).toBe(401);
    expect(await problemCode(await me("clm_unknown"))).toBe("invalid_credential");

    expect((await me(login.token)).status).toBe(200);
    clock.advance(120 * 60 + 1);
    expect((await me(login.token)).status).toBe(401);

    const second = await adminSignIn();
    await h.call("DELETE", "/api/admin/v1/session", { token: second.token, envOverrides: ADMIN_ENV });
    expect((await me(second.token)).status).toBe(401);
  });

  it("re-checks the admin on every request: a disabled admin, or an owner dropped from the bootstrap secret, is out at once", async () => {
    const login = await adminSignIn();
    const me = (env: Record<string, string>) => h.call("GET", "/api/admin/v1/me", { token: login.token, envOverrides: env });
    expect((await me(ADMIN_ENV)).status).toBe(200);
    // Rotating the secret to another owner revokes this one without touching the database.
    expect((await me({ ...ADMIN_ENV, ADMIN_BOOTSTRAP_EMAILS: OTHER_OWNER })).status).toBe(401);
    // An empty or malformed secret fails closed too.
    expect((await me({ ...ADMIN_ENV, ADMIN_BOOTSTRAP_EMAILS: "" })).status).toBe(401);
    expect((await me({ ...ADMIN_ENV, ADMIN_BOOTSTRAP_EMAILS: "not an email" })).status).toBe(401);
    expect((await me(ADMIN_ENV)).status).toBe(200);
    await h.env.DB.prepare(`UPDATE admins SET status = 'disabled' WHERE admin_id = ?1`).bind(login.admin.admin_id).run();
    expect((await me(ADMIN_ENV)).status).toBe(401);
    // And a disabled admin cannot sign in again, even though the e-mail is still in the bootstrap list.
    google.next = { email: OWNER, sub: "admin-sub-1" };
    const s = await start("admin");
    expect((await callback(s.state, s.cookie)).fragment.get("error")).toBe("google_unauthorized");
  });

  it("does not let a code or session outlive a change of eligibility between the callback and the exchange", async () => {
    google.next = { email: OWNER, sub: "admin-sub-1" };
    const s = await start("admin");
    const code = (await callback(s.state, s.cookie)).fragment.get("admin_code");
    const res = await h.call("POST", "/api/admin/v1/session/exchange", { json: { code }, envOverrides: { ...ADMIN_ENV, ADMIN_BOOTSTRAP_EMAILS: OTHER_OWNER } });
    expect(res.status).toBe(401);
    expect(await count(`SELECT COUNT(*) AS n FROM admin_sessions`)).toBe(0);
  });

  it("makes the exchange code single-use, short-lived and unusable without admin sign-in configured", async () => {
    google.next = { email: OWNER, sub: "admin-sub-1" };
    const s = await start("admin");
    const code = (await callback(s.state, s.cookie)).fragment.get("admin_code");
    expect((await h.call("POST", "/api/admin/v1/session/exchange", { json: { code }, envOverrides: ADMIN_ENV })).status).toBe(201);
    expect((await h.call("POST", "/api/admin/v1/session/exchange", { json: { code }, envOverrides: ADMIN_ENV })).status).toBe(401);

    const s2 = await start("admin");
    const code2 = (await callback(s2.state, s2.cookie)).fragment.get("admin_code");
    clock.advance(61);
    expect((await h.call("POST", "/api/admin/v1/session/exchange", { json: { code: code2 }, envOverrides: ADMIN_ENV })).status).toBe(401);

    const res = await h.call("POST", "/api/admin/v1/session/exchange", { json: { code: "cax_whatever-12345" }, envOverrides: { ...ADMIN_ENV, ADMIN_BOOTSTRAP_EMAILS: "" } });
    expect(res.status).toBe(503);
    expect(await problemCode(res)).toBe("admin_signin_not_configured");
  });

  /* ---------------------------------------------------------------- who may be admin */

  it("never makes a verified but non-allowlisted Google identity an admin, even with open-viewer access turned on", async () => {
    google.next = { email: STRANGER, sub: "stranger-sub" };
    const s = await start("admin", OPEN_ENV);
    const back = await callback(s.state, s.cookie, OPEN_ENV);
    expect(back.location.pathname).toBe("/admin/login");
    expect(back.fragment.get("error")).toBe("google_unauthorized");
    expect(back.fragment.has("admin_code")).toBe(false);
    expect(await count(`SELECT COUNT(*) AS n FROM admins`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM admin_login_exchanges`)).toBe(0);
    // The same person is still welcome as a read-only viewer through the viewer flow.
    google.next = { email: STRANGER, sub: "stranger-sub" };
    const v = await start(null, OPEN_ENV);
    expect((await callback(v.state, v.cookie, OPEN_ENV)).fragment.get("code")).toMatch(/^clx_/);
    expect(await count(`SELECT COUNT(*) AS n FROM admins`)).toBe(0);
    const audit = await h.env.DB.prepare(`SELECT outcome, detail_json FROM audit_log WHERE action = 'admin.google_login' AND outcome = 'denied'`).first<{ detail_json: string }>();
    expect(JSON.parse(audit!.detail_json)).toEqual({ reason: "google_unauthorized", why: "not_allowlisted" });
  });

  it("binds the Google subject at the first admin sign-in and refuses the same e-mail with another subject", async () => {
    await adminSignIn(OWNER, "admin-sub-1");
    google.next = { email: OWNER, sub: "someone-else-sub" };
    const s = await start("admin");
    const back = await callback(s.state, s.cookie);
    expect(back.fragment.get("error")).toBe("google_unauthorized");
    expect(await count(`SELECT COUNT(*) AS n FROM admin_login_exchanges`)).toBe(1); // only the first sign-in's
    const audit = await h.env.DB.prepare(`SELECT detail_json FROM audit_log WHERE action = 'admin.google_login' AND outcome = 'denied'`).first<{ detail_json: string }>();
    expect(JSON.parse(audit!.detail_json).why).toBe("subject_mismatch");
  });

  it("refuses a second admin row that would reuse an already bound Google subject", async () => {
    const env = { ...ADMIN_ENV, ADMIN_BOOTSTRAP_EMAILS: `${OWNER},${OTHER_OWNER}` };
    await adminSignIn(OWNER, "shared-sub", env);
    google.next = { email: OTHER_OWNER, sub: "shared-sub" };
    const s = await start("admin", env);
    expect((await callback(s.state, s.cookie, env)).fragment.get("error")).toBe("google_unauthorized");
  });

  it("fails closed without valid bootstrap configuration: no flow starts, nothing is stored", async () => {
    for (const value of ["", "   ", "not-an-email", `${OWNER},broken@`, Array.from({ length: 11 }, (_, i) => `a${i}@example.invalid`).join(",")]) {
      const res = await h.call("GET", "/api/app/v1/auth/google/start?mode=admin", { envOverrides: { ...ADMIN_ENV, ADMIN_BOOTSTRAP_EMAILS: value } });
      expect(res.status, `value ${JSON.stringify(value)}`).toBe(503);
      expect(["admin_signin_not_configured", "misconfigured"]).toContain(await problemCode(res));
    }
    expect(await count(`SELECT COUNT(*) AS n FROM oauth_states`)).toBe(0);
    // A malformed list never repeats what the owner typed.
    const bad = await h.call("GET", "/api/app/v1/auth/google/start?mode=admin", { envOverrides: { ...ADMIN_ENV, ADMIN_BOOTSTRAP_EMAILS: "secret-looking@" } });
    expect(await bad.text()).not.toContain("secret-looking");
    // The viewer flow is not affected by a broken admin list.
    const viewer = await h.call("GET", "/api/app/v1/auth/google/start", { envOverrides: { ...ADMIN_ENV, ADMIN_BOOTSTRAP_EMAILS: "not-an-email" } });
    expect(viewer.status).toBe(302);
  });

  it("denies a callback when the bootstrap list was emptied after the flow started", async () => {
    google.next = { email: OWNER, sub: "admin-sub-1" };
    const s = await start("admin");
    const back = await callback(s.state, s.cookie, { ...ADMIN_ENV, ADMIN_BOOTSTRAP_EMAILS: "" });
    expect(back.fragment.get("error")).toBe("google_unauthorized");
    expect(await count(`SELECT COUNT(*) AS n FROM admins`)).toBe(0);
  });

  /* ---------------------------------------------------------------- OAuth checks still apply to the admin flow */

  it.each([
    ["a signature from another key", { key: "other" }],
    ["another audience", { aud: "someone-elses-client.apps.googleusercontent.com" }],
    ["another issuer", { iss: "https://evil.example.test" }],
    ["an expired token", { exp: 1 }],
    ["a replayed nonce", { nonce: "nn_other" }],
    ["an unverified e-mail", { emailVerified: false }],
  ] as const)("rejects an admin ID token with %s and creates no admin", async (_name, override) => {
    google.next = { email: OWNER, sub: "admin-sub-1", ...("key" in override ? { key: otherKey } : override) };
    const s = await start("admin");
    const back = await callback(s.state, s.cookie);
    expect(back.fragment.get("error")).toBe("google_token");
    expect(back.location.pathname).toBe("/admin/login");
    expect(await count(`SELECT COUNT(*) AS n FROM admins`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM admin_login_exchanges`)).toBe(0);
  });

  it("validates state for the admin flow: unknown, missing cookie, another browser and replay are refused", async () => {
    google.next = { email: OWNER, sub: "admin-sub-1" };
    const s = await start("admin");
    expect((await callback("st_unknown", s.cookie)).fragment.get("error")).toBe("google_state");
    const noCookie = await callback(s.state, null);
    expect(noCookie.fragment.get("error")).toBe("google_state");
    expect(noCookie.location.pathname).toBe("/admin/login"); // the page is chosen from the stored purpose
    expect((await callback(s.state, "bd_someone_elses_cookie")).fragment.get("error")).toBe("google_state");
    expect((await callback(s.state, s.cookie)).fragment.get("admin_code")).toMatch(/^cax_/);
    expect((await callback(s.state, s.cookie)).fragment.get("error")).toBe("google_state");
    const expired = await start("admin");
    clock.advance(601);
    expect((await callback(expired.state, expired.cookie)).fragment.get("error")).toBe("google_state");
  });

  it("keeps the flow purpose server-side: a viewer state cannot finish as admin, an admin state cannot finish as viewer", async () => {
    // Viewer flow completed with a forged `mode=admin` on the callback: still a viewer result, no admin anywhere.
    google.next = { email: OWNER, sub: "admin-sub-1" };
    const v = await start(null, OPEN_ENV);
    const viewerBack = await callback(v.state, v.cookie, OPEN_ENV, "&mode=admin&purpose=admin&role=admin");
    expect(viewerBack.location.pathname).toBe("/login");
    expect(viewerBack.fragment.get("code")).toMatch(/^clx_/);
    expect(viewerBack.fragment.has("admin_code")).toBe(false);
    expect(await count(`SELECT COUNT(*) AS n FROM admins`)).toBe(0);
    // The stored purposes are what the callback used.
    expect(await count(`SELECT COUNT(*) AS n FROM oauth_states WHERE purpose = 'viewer'`)).toBe(1);

    // Admin flow: the result is an admin code on the admin page, never a viewer code, whatever else the callback carries.
    google.next = { email: OWNER, sub: "admin-sub-1" };
    const a = await start("admin", OPEN_ENV);
    const adminBack = await callback(a.state, a.cookie, OPEN_ENV, "&mode=viewer");
    expect(adminBack.location.pathname).toBe("/admin/login");
    expect(adminBack.fragment.get("admin_code")).toMatch(/^cax_/);
    expect(adminBack.fragment.has("code")).toBe(false);
    expect(await count(`SELECT COUNT(*) AS n FROM oauth_states WHERE purpose = 'admin'`)).toBe(1);
  });

  it("does not let viewer and admin exchange codes cross over", async () => {
    google.next = { email: OWNER, sub: "admin-sub-1" };
    const v = await start(null, OPEN_ENV);
    const viewerCode = (await callback(v.state, v.cookie, OPEN_ENV)).fragment.get("code");
    const a = await start("admin", OPEN_ENV);
    const adminCode = (await callback(a.state, a.cookie, OPEN_ENV)).fragment.get("admin_code");
    expect((await h.call("POST", "/api/admin/v1/session/exchange", { json: { code: viewerCode }, envOverrides: OPEN_ENV })).status).toBe(401);
    expect((await h.call("POST", "/api/app/v1/session/exchange", { json: { code: adminCode }, envOverrides: OPEN_ENV })).status).toBe(401);
    // Each code still works where it belongs (neither failed attempt consumed it).
    expect((await h.call("POST", "/api/admin/v1/session/exchange", { json: { code: adminCode }, envOverrides: OPEN_ENV })).status).toBe(201);
    expect((await h.call("POST", "/api/app/v1/session/exchange", { json: { code: viewerCode }, envOverrides: OPEN_ENV })).status).toBe(201);
  });

  it("rejects an unknown mode instead of treating it as a viewer sign-in", async () => {
    for (const mode of ["owner", "ADMIN", "", "admin,viewer"]) {
      const res = await h.call("GET", `/api/app/v1/auth/google/start?mode=${encodeURIComponent(mode)}`, { envOverrides: ADMIN_ENV });
      expect(res.status, `mode ${JSON.stringify(mode)}`).toBe(400);
      expect(await problemCode(res)).toBe("invalid_mode");
    }
    expect(await count(`SELECT COUNT(*) AS n FROM oauth_states`)).toBe(0);
  });

  /* ---------------------------------------------------------------- the three principals stay apart */

  it("rejects viewer, caregiver, device and agent credentials on admin routes", async () => {
    const o = { envOverrides: ADMIN_ENV };
    for (const [name, token] of [
      ["caregiver", w.caregiverToken],
      ["viewer", w.viewerToken],
      ["device", w.deviceToken],
      ["agent", w.agentToken],
    ] as const) {
      expect((await h.call("GET", "/api/admin/v1/me", { token, ...o })).status, `${name} on /me`).toBe(401);
      expect((await h.call("GET", "/api/admin/v1/status", { token, ...o })).status, `${name} on /status`).toBe(401);
      expect((await h.call("POST", "/api/admin/v1/recipients", { token, json: { recipient_id: null, display_label: "x", timezone: "Asia/Ho_Chi_Minh" }, ...o })).status, `${name} on POST /recipients`).toBe(401);
    }
    expect(await count(`SELECT COUNT(*) AS n FROM care_recipients WHERE display_label = 'x'`)).toBe(0);
  });

  it("rejects a Google viewer session on admin routes", async () => {
    google.next = { email: STRANGER, sub: "stranger-sub" };
    const v = await start(null, OPEN_ENV);
    const code = (await callback(v.state, v.cookie, OPEN_ENV)).fragment.get("code");
    const viewer = await ok<{ token: string }>(await h.call("POST", "/api/app/v1/session/exchange", { json: { code }, envOverrides: OPEN_ENV }), 201);
    expect((await h.call("GET", "/api/app/v1/me", { token: viewer.token, envOverrides: OPEN_ENV })).status).toBe(200);
    expect((await h.call("GET", "/api/admin/v1/me", { token: viewer.token, envOverrides: OPEN_ENV })).status).toBe(401);
    expect((await h.call("GET", "/api/admin/v1/status", { token: viewer.token, envOverrides: OPEN_ENV })).status).toBe(401);
  });

  it("rejects an admin session on viewer, device and agent routes", async () => {
    const login = await adminSignIn();
    const o = { token: login.token, envOverrides: ADMIN_ENV };
    expect((await h.call("GET", "/api/app/v1/me", o)).status).toBe(401);
    expect((await h.call("GET", `/api/app/v1/recipients/${w.recipientId}/events`, o)).status).toBe(401);
    expect((await h.call("POST", "/api/app/v1/stream-tickets", { ...o, json: { recipient_id: w.recipientId } })).status).toBe(401);
    expect((await h.call("DELETE", "/api/app/v1/session", o)).status).toBe(401);
    expect((await h.call("POST", "/api/device/v1/heartbeat", { ...o, json: {} })).status).toBe(401);
    expect((await h.call("POST", "/api/agent/v1/jobs/claim", o)).status).toBe(401);
    // The admin session survived all of that.
    expect((await h.call("GET", "/api/admin/v1/me", o)).status).toBe(200);
  });

  it("gives no admin rights for anything the browser sends: parameters, headers, body fields", async () => {
    google.next = { email: STRANGER, sub: "stranger-sub" };
    const v = await start(null, OPEN_ENV);
    const code = (await callback(v.state, v.cookie, OPEN_ENV)).fragment.get("code");
    const viewer = await ok<{ token: string }>(await h.call("POST", "/api/app/v1/session/exchange", { json: { code }, envOverrides: OPEN_ENV }), 201);
    for (const path of ["/api/admin/v1/me?role=owner&admin=true&admin_id=adm_x", "/api/admin/v1/me?mode=admin"]) {
      const res = await h.call("GET", path, {
        token: viewer.token,
        headers: { "x-admin": "true", "x-role": "owner", "x-admin-id": "adm_x", cookie: "admin=true; role=owner" },
        envOverrides: OPEN_ENV,
      });
      expect(res.status, path).toBe(401);
    }
    // Extra fields in the exchange body are rejected (strict schema), so there is no place to claim a role.
    const extra = await h.call("POST", "/api/admin/v1/session/exchange", { json: { code: "cax_whatever-12345", role: "owner" }, envOverrides: ADMIN_ENV });
    expect(extra.status).toBe(422);
    expect(await count(`SELECT COUNT(*) AS n FROM admins`)).toBe(0);
  });

  it("answers 401 to unauthenticated callers once admin sign-in is configured, and 503 only when nothing is configured", async () => {
    const configured = await h.call("GET", "/api/admin/v1/me", { envOverrides: ADMIN_ENV });
    expect(configured.status).toBe(401);
    const nothing = await h.call("GET", "/api/admin/v1/me", { envOverrides: { ADMIN_TOKEN_SHA256: "", ADMIN_BOOTSTRAP_EMAILS: "" } });
    expect(nothing.status).toBe(503);
    expect(await problemCode(nothing)).toBe("admin_not_configured");
  });

  it("keeps the legacy static operator token working where configured and reports it honestly on /me", async () => {
    const me = await ok<Record<string, unknown>>(await h.call("GET", "/api/admin/v1/me", { token: ADMIN_TOKEN }));
    expect(me).toEqual({ auth_method: "static_token", admin_id: null, role: null });
    expect((await h.call("GET", "/api/admin/v1/recipients", { token: ADMIN_TOKEN })).status).toBe(200);
    expect((await h.call("GET", "/api/admin/v1/me", { token: `${ADMIN_TOKEN}x` })).status).toBe(401);
    // It has no session to end.
    expect((await h.call("DELETE", "/api/admin/v1/session", { token: ADMIN_TOKEN })).status).toBe(400);
  });

  /* ---------------------------------------------------------------- audit */

  it("attributes admin operations to the signed-in admin, keeps the legacy actor for the static token, and logs no secrets", async () => {
    const login = await adminSignIn();
    const create = (token: string, id: string) =>
      h.call("POST", "/api/admin/v1/recipients", { token, json: { recipient_id: id, display_label: "Hồ sơ thử", timezone: "Asia/Ho_Chi_Minh" }, envOverrides: ADMIN_ENV });
    expect((await create(login.token, "rcp-by-session")).status).toBe(201);
    expect((await create(ADMIN_TOKEN, "rcp-by-token")).status).toBe(201);
    const actors = await h.env.DB.prepare(`SELECT target_id, actor_type, actor_id FROM audit_log WHERE action = 'recipient.create' AND target_id LIKE 'rcp-by-%' ORDER BY target_id`).all();
    expect(actors.results).toEqual([
      { target_id: "rcp-by-session", actor_type: "admin", actor_id: login.admin.admin_id },
      { target_id: "rcp-by-token", actor_type: "admin", actor_id: "admin" },
    ]);
    const trail = await h.env.DB.prepare(`SELECT action, actor_id, outcome FROM audit_log WHERE actor_id = ?1 ORDER BY at, action`).bind(login.admin.admin_id).all();
    expect((trail.results as Array<{ action: string }>).map((r) => r.action)).toEqual(expect.arrayContaining(["admin.google_login", "admin.session_create", "recipient.create"]));
    await h.call("DELETE", "/api/admin/v1/session", { token: login.token, envOverrides: ADMIN_ENV });
    expect(await count(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admin.session_revoke' AND actor_id = ?1`, login.admin.admin_id)).toBe(1);

    const all = await h.env.DB.prepare(`SELECT group_concat(coalesce(actor_id, '') || coalesce(target_id, '') || coalesce(detail_json, ''), ' ') AS everything FROM audit_log`).first<{ everything: string }>();
    expect(all?.everything ?? "").not.toMatch(/clm_|cax_|eyJ|good-code|test-only-client-secret|example\.invalid|admin-sub-1/);
  });

  /* ---------------------------------------------------------------- viewer flow and readiness */

  it("leaves the viewer Google sign-in as it was, with admin sign-in configured next to it", async () => {
    await h.env.DB.prepare(`INSERT INTO google_identities (email, user_id, created_at) VALUES (?1, ?2, ?3)`).bind(STRANGER, w.viewerUserId, new Date(clock.t).toISOString()).run();
    google.next = { email: STRANGER, sub: "stranger-sub" };
    const v = await start(null);
    const back = await callback(v.state, v.cookie);
    expect(back.location.origin + back.location.pathname).toBe(APP);
    const code = back.fragment.get("code");
    expect(code).toMatch(/^clx_/);
    const login = await ok<{ token: string; recipients: Array<{ role: string; permissions: string[] }> }>(await h.call("POST", "/api/app/v1/session/exchange", { json: { code }, envOverrides: ADMIN_ENV }), 201);
    expect(login.recipients).toEqual([expect.objectContaining({ role: "viewer", permissions: ["data.read"] })]);
    // An explicit mode=viewer is the same flow.
    google.next = { email: STRANGER, sub: "stranger-sub" };
    const explicit = await start("viewer");
    expect((await callback(explicit.state, explicit.cookie)).fragment.get("code")).toMatch(/^clx_/);
    // The public config endpoint says nothing about admin sign-in.
    const cfg = await ok<Record<string, unknown>>(await h.call("GET", "/api/app/v1/auth/google/config", { envOverrides: ADMIN_ENV }));
    expect(JSON.stringify(cfg)).not.toMatch(/admin|bootstrap|example\.invalid/i);
  });

  it("reports admin sign-in readiness without revealing the list", async () => {
    const caps = async (env: Record<string, string>) => (await ok<{ capabilities: Record<string, string> }>(await h.call("GET", "/ready", { envOverrides: env }))).capabilities.admin_signin;
    expect(await caps({ ADMIN_BOOTSTRAP_EMAILS: "" })).toBe("not_configured");
    expect(await caps({ ADMIN_BOOTSTRAP_EMAILS: OWNER })).toBe("configured");
    expect(await caps({ ADMIN_BOOTSTRAP_EMAILS: "garbage" })).toBe("misconfigured");
    const text = await (await h.call("GET", "/ready", { envOverrides: { ADMIN_BOOTSTRAP_EMAILS: OWNER } })).text();
    expect(text).not.toContain("example.invalid");
  });

  /* ---------------------------------------------------------------- schema and housekeeping */

  it("migration 0004: pre-existing OAuth states stay viewer flows, and the constraints hold", async () => {
    const now = new Date(clock.t).toISOString();
    // A row written the way 0002 code wrote it (no purpose column named) becomes a viewer state.
    await h.env.DB.prepare(`INSERT INTO oauth_states (state_sha256, binding_sha256, nonce, code_verifier, created_at, expires_at) VALUES ('s1', 'b1', 'n', 'v', ?1, ?1)`).bind(now).run();
    expect((await h.env.DB.prepare(`SELECT purpose FROM oauth_states WHERE state_sha256 = 's1'`).first<{ purpose: string }>())?.purpose).toBe("viewer");
    await expect(h.env.DB.prepare(`INSERT INTO oauth_states (state_sha256, binding_sha256, nonce, code_verifier, created_at, expires_at, purpose) VALUES ('s2', 'b', 'n', 'v', ?1, ?1, 'owner')`).bind(now).run()).rejects.toThrow();
    // Admin e-mails are stored lower-case, roles and statuses are closed sets, and a subject belongs to one admin.
    const insert = (id: string, email: string, role: string, status: string, sub: string | null) =>
      h.env.DB.prepare(`INSERT INTO admins (admin_id, email, google_sub, role, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(id, email, sub, role, status, now).run();
    await expect(insert("a1", "Mixed@Case.invalid", "owner", "active", null)).rejects.toThrow();
    await expect(insert("a2", "ok@example.invalid", "superuser", "active", null)).rejects.toThrow();
    await expect(insert("a3", "ok@example.invalid", "owner", "frozen", null)).rejects.toThrow();
    await insert("a4", "one@example.invalid", "owner", "active", "sub-x");
    await insert("a5", "two@example.invalid", "admin", "active", null);
    await insert("a6", "three@example.invalid", "admin", "active", null); // NULL subjects may repeat
    await expect(insert("a7", "four@example.invalid", "admin", "active", "sub-x")).rejects.toThrow();
    // Sessions and exchange codes need a real admin.
    await expect(h.env.DB.prepare(`INSERT INTO admin_sessions (token_id, admin_id, token_sha256, created_at, expires_at, auth_at) VALUES ('t', 'nobody', 'h', ?1, ?1, ?1)`).bind(now).run()).rejects.toThrow();
  });

  it("purges stale admin exchange codes and long-finished admin sessions, and keeps live ones", async () => {
    const login = await adminSignIn();
    google.next = { email: OWNER, sub: "admin-sub-1" };
    const s = await start("admin");
    await callback(s.state, s.cookie); // leaves one unused exchange code
    expect(await count(`SELECT COUNT(*) AS n FROM admin_login_exchanges`)).toBe(2);
    clock.advance(2 * 3600); // codes are 2 h old; the session ended 0 h ago
    await h.cron("* * * * *");
    expect(await count(`SELECT COUNT(*) AS n FROM admin_login_exchanges`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM admin_sessions WHERE admin_id = ?1`, login.admin.admin_id)).toBe(1);
    clock.advance(8 * 86_400);
    await h.cron("* * * * *");
    expect(await count(`SELECT COUNT(*) AS n FROM admin_sessions`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM admins`)).toBe(1); // the person stays; only sessions are purged
  });
});
