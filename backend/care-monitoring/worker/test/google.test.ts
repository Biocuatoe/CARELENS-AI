/**
 * Google sign-in (OIDC authorization code + PKCE). Google itself is replaced by a fake injected through
 * `outboundFetch`: it owns a real RSA key pair, publishes it as a JWKS, and signs real RS256 ID tokens, so the
 * Worker's signature, issuer, audience, expiry, nonce and state checks run for real. No Google account is contacted.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetGoogleKeyCache } from "../src/google";
import { ADMIN_TOKEN, TestClock, freshDb, harness, ok, problemCode, provision, type Harness, type World } from "./helpers";

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "test-only-client-secret";
const REDIRECT = "https://cm.test/api/app/v1/auth/google/callback";
const APP = "https://app.example.test/login";
const GOOGLE_ENV = { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_REDIRECT_URI: REDIRECT, GOOGLE_POST_LOGIN_URL: APP };
const SHARED_EMAIL = "giamkhao.test@example.invalid";

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
  email?: string | null;
  emailVerified?: boolean;
  iss?: string;
  aud?: string;
  exp?: number;
  nonce?: string;
  key?: CryptoKey;
}

async function idToken(clock: TestClock, nonce: string, o: TokenOptions = {}): Promise<string> {
  const now = Math.floor(clock.t / 1000);
  const header = b64urlJson({ alg: "RS256", kid: "test-kid", typ: "JWT" });
  const claims: Record<string, unknown> = {
    iss: o.iss ?? "https://accounts.google.com",
    aud: o.aud ?? CLIENT_ID,
    sub: o.sub ?? "google-sub-1",
    iat: now,
    exp: o.exp ?? now + 3600,
    nonce: o.nonce ?? nonce,
    email_verified: o.emailVerified ?? true,
  };
  if (o.email !== null) claims.email = o.email ?? SHARED_EMAIL;
  const payload = b64urlJson(claims);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", o.key ?? signingKey, enc.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}

interface FakeGoogle {
  fetch: typeof fetch;
  tokenRequests: Array<Record<string, string>>;
  /** What the next token exchange answers; set per test. */
  next: { status: number; tokenOptions: TokenOptions; omitIdToken?: boolean };
  /** nonce and code_challenge of the most recent authorize redirect (what a real Google would remember). */
  lastAuth: { nonce: string; challenge: string; method: string } | null;
}

function fakeGoogle(clock: TestClock): FakeGoogle {
  const g: FakeGoogle = {
    tokenRequests: [],
    next: { status: 200, tokenOptions: {} },
    lastAuth: null,
    fetch: async (input, init) => {
      const url = String(input);
      if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [{ ...jwk, kid: "test-kid", use: "sig", alg: "RS256" }] });
      if (url === "https://oauth2.googleapis.com/token") {
        const form = Object.fromEntries(new URLSearchParams(String(init?.body))) as Record<string, string>;
        g.tokenRequests.push(form);
        if (g.next.status !== 200) return Response.json({ error: "invalid_grant" }, { status: g.next.status });
        // PKCE: the verifier must hash to the challenge sent in the authorize request.
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(form.code_verifier ?? "")));
        if (b64url(digest) !== g.lastAuth?.challenge) return Response.json({ error: "invalid_grant", error_description: "pkce" }, { status: 400 });
        if (form.client_secret !== CLIENT_SECRET || form.client_id !== CLIENT_ID || form.redirect_uri !== REDIRECT || form.grant_type !== "authorization_code" || form.code !== "good-code") {
          return Response.json({ error: "invalid_client" }, { status: 401 });
        }
        return Response.json(g.next.omitIdToken ? {} : { id_token: await idToken(clock, g.lastAuth?.nonce ?? "", g.next.tokenOptions), token_type: "Bearer" });
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

async function startFlow(env: Record<string, string> = GOOGLE_ENV): Promise<{ state: string; cookie: string; response: Response }> {
  const res = await h.call("GET", "/api/app/v1/auth/google/start", { envOverrides: env });
  const location = res.headers.get("location");
  expect(res.status, await res.clone().text()).toBe(302);
  const auth = new URL(location!);
  google.lastAuth = { nonce: auth.searchParams.get("nonce")!, challenge: auth.searchParams.get("code_challenge")!, method: auth.searchParams.get("code_challenge_method")! };
  const cookie = /cl_oauth=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1]!;
  return { state: auth.searchParams.get("state")!, cookie, response: res };
}

async function callback(state: string, cookie: string | null, code = "good-code", extra = "", env: Record<string, string> = GOOGLE_ENV): Promise<{ status: number; fragment: URLSearchParams; location: string }> {
  const res = await h.call("GET", `/api/app/v1/auth/google/callback?code=${code}&state=${encodeURIComponent(state)}${extra}`, {
    envOverrides: env,
    headers: cookie ? { cookie: `cl_oauth=${cookie}` } : {},
  });
  const location = res.headers.get("location") ?? "";
  return { status: res.status, location, fragment: new URLSearchParams(new URL(location, "https://x.test").hash.slice(1)) };
}

async function authorize(email = SHARED_EMAIL, userId = w.viewerUserId): Promise<void> {
  await ok(await h.call("POST", `/api/admin/v1/caregivers/${userId}/google`, { token: ADMIN_TOKEN, json: { email } }), 201);
}

describe("Google sign-in", () => {
  beforeEach(async () => {
    await freshDb();
    clock = new TestClock();
    google = fakeGoogle(clock);
    h = harness(clock, {}, { outboundFetch: google.fetch });
    resetGoogleKeyCache();
    w = await provision(h);
  });

  it("starts with PKCE S256, state, nonce and the minimum scope, and binds the flow to the browser with an HttpOnly cookie", async () => {
    const { response, state } = await startFlow();
    const auth = new URL(response.headers.get("location")!);
    expect(auth.origin + auth.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(auth.searchParams.get("response_type")).toBe("code");
    expect(auth.searchParams.get("scope")).toBe("openid email");
    expect(auth.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(auth.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(state.length).toBeGreaterThan(20);
    expect(auth.searchParams.get("nonce")!.length).toBeGreaterThan(20);
    expect(auth.toString()).not.toContain(CLIENT_SECRET);
    expect(auth.searchParams.has("code_verifier")).toBe(false);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toContain("Path=/api/app/v1/auth/google");
  });

  it("signs an authorized Google identity in and issues the application's own session through a single-use exchange code", async () => {
    await authorize();
    const { state, cookie } = await startFlow();
    const back = await callback(state, cookie);
    expect(back.status).toBe(302);
    expect(back.location.startsWith(`${APP}#`)).toBe(true);
    const code = back.fragment.get("code")!;
    expect(code).toMatch(/^clx_/);
    // No session token, id token or Google code ever travels in the redirect; the client secret only goes to Google.
    expect(back.location).not.toMatch(/clc_|eyJ|good-code/);
    expect(google.tokenRequests).toHaveLength(1);
    expect(google.tokenRequests[0]).toMatchObject({ client_secret: CLIENT_SECRET, grant_type: "authorization_code" });

    const login = await ok<{ token: string; storage: string; recipients: Array<{ role: string; permissions: string[] }> }>(
      await h.call("POST", "/api/app/v1/session/exchange", { json: { code }, envOverrides: GOOGLE_ENV }),
      201,
    );
    expect(login.token).toMatch(/^clc_/);
    expect(login.storage).toBe("memory_only");
    expect(login.recipients).toEqual([expect.objectContaining({ role: "viewer", permissions: ["data.read"] })]);
    expect((await h.call("GET", "/api/app/v1/me", { token: login.token })).status).toBe(200);
    // Read-only account: Google does not widen what the account may do.
    expect((await h.call("POST", `/api/app/v1/recipients/${w.recipientId}/alerts/alr_x/actions`, { token: login.token, json: { action: "acknowledge", expected_version: 1, review_outcome: null, note: null } })).status).toBe(403);
    // The code is single use.
    expect((await h.call("POST", "/api/app/v1/session/exchange", { json: { code }, envOverrides: GOOGLE_ENV })).status).toBe(401);
  });

  it("refuses a Google account the owner has not authorized, without issuing any code", async () => {
    await authorize("someone.else@example.invalid");
    const { state, cookie } = await startFlow();
    const back = await callback(state, cookie);
    expect(back.fragment.get("error")).toBe("google_unauthorized");
    expect(back.fragment.has("code")).toBe(false);
    const rows = await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM login_exchanges`).first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("refuses everyone when the allowlist is empty (no automatic account creation)", async () => {
    const { state, cookie } = await startFlow();
    expect((await callback(state, cookie)).fragment.get("error")).toBe("google_unauthorized");
    const accounts = await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM caregivers`).first<{ n: number }>();
    expect(accounts?.n).toBe(3); // only the ones provisioned by the test world
  });

  it("validates state: unknown, replayed, expired, missing cookie and a different browser (login CSRF) are all refused", async () => {
    await authorize();
    const a = await startFlow();
    expect((await callback("st_unknown", a.cookie)).fragment.get("error")).toBe("google_state");
    expect((await callback(a.state, null)).fragment.get("error")).toBe("google_state");
    expect((await callback(a.state, "bd_someone_elses_cookie")).fragment.get("error")).toBe("google_state");
    // The refused attempts did not consume the state; the right browser still completes once, and only once.
    expect((await callback(a.state, a.cookie)).fragment.get("code")).toMatch(/^clx_/);
    expect((await callback(a.state, a.cookie)).fragment.get("error")).toBe("google_state");

    const b = await startFlow();
    clock.advance(601);
    expect((await callback(b.state, b.cookie)).fragment.get("error")).toBe("google_state");
    expect(google.tokenRequests).toHaveLength(1);
  });

  it("reports a denied consent and a failed code exchange without leaking details", async () => {
    await authorize();
    const a = await startFlow();
    expect((await callback(a.state, a.cookie, "x", "&error=access_denied")).fragment.get("error")).toBe("google_denied");
    google.next = { status: 400, tokenOptions: {} };
    const b = await startFlow();
    const back = await callback(b.state, b.cookie);
    expect(back.fragment.get("error")).toBe("google_exchange");
    expect(back.location).not.toContain("invalid_grant");
    google.next = { status: 200, tokenOptions: {}, omitIdToken: true };
    const c = await startFlow();
    expect((await callback(c.state, c.cookie)).fragment.get("error")).toBe("google_exchange");
    // A wrong authorization code is rejected by Google (and the PKCE check stays with Google).
    google.next = { status: 200, tokenOptions: {} };
    const d = await startFlow();
    expect((await callback(d.state, d.cookie, "forged-code")).fragment.get("error")).toBe("google_exchange");
  });

  it.each([
    ["a signature from another key", { key: undefined as unknown as CryptoKey }],
    ["another audience", { aud: "someone-elses-client.apps.googleusercontent.com" }],
    ["another issuer", { iss: "https://evil.example.test" }],
    ["an expired token", { exp: 1 }],
    ["a replayed nonce", { nonce: "nn_other" }],
    ["an unverified e-mail", { emailVerified: false }],
    ["no e-mail", { email: null }],
  ])("rejects an ID token with %s", async (_name, options) => {
    await authorize();
    const o: TokenOptions = { ...options };
    if (_name === "a signature from another key") o.key = otherKey;
    google.next = { status: 200, tokenOptions: o };
    const { state, cookie } = await startFlow();
    const back = await callback(state, cookie);
    expect(back.fragment.get("error")).toBe("google_token");
    expect(back.fragment.has("code")).toBe(false);
  });

  it("binds the Google subject at first sign-in; the same e-mail with another subject is refused", async () => {
    await authorize();
    const first = await startFlow();
    expect((await callback(first.state, first.cookie)).fragment.get("code")).toMatch(/^clx_/);
    const row = await h.env.DB.prepare(`SELECT google_sub FROM google_identities WHERE email = ?1`).bind(SHARED_EMAIL).first<{ google_sub: string }>();
    expect(row?.google_sub).toBe("google-sub-1");
    google.next = { status: 200, tokenOptions: { sub: "google-sub-2" } };
    const second = await startFlow();
    expect((await callback(second.state, second.cookie)).fragment.get("error")).toBe("google_unauthorized");
  });

  it("matches e-mail case-insensitively and lets the owner revoke an identity", async () => {
    await authorize("GiamKhao.Test@Example.invalid");
    google.next = { status: 200, tokenOptions: { email: "GIAMKHAO.TEST@example.invalid" } };
    const a = await startFlow();
    expect((await callback(a.state, a.cookie)).fragment.get("code")).toMatch(/^clx_/);
    await ok(await h.call("POST", "/api/admin/v1/google/revoke", { token: ADMIN_TOKEN, json: { email: SHARED_EMAIL } }));
    const b = await startFlow();
    expect((await callback(b.state, b.cookie)).fragment.get("error")).toBe("google_unauthorized");
    expect((await h.call("POST", "/api/admin/v1/google/revoke", { token: ADMIN_TOKEN, json: { email: SHARED_EMAIL } })).status).toBe(404);
  });

  it("keeps sessions independent: two Google sign-ins give two sessions and logging one out leaves the other", async () => {
    await authorize();
    const signIn = async () => {
      const f = await startFlow();
      const code = (await callback(f.state, f.cookie)).fragment.get("code")!;
      return ok<{ token: string }>(await h.call("POST", "/api/app/v1/session/exchange", { json: { code }, envOverrides: GOOGLE_ENV }), 201);
    };
    const [a, b] = [await signIn(), await signIn()];
    expect(a.token).not.toBe(b.token);
    expect((await h.call("DELETE", "/api/app/v1/session", { token: a.token })).status).toBe(204);
    expect((await h.call("GET", "/api/app/v1/me", { token: a.token })).status).toBe(401);
    expect((await h.call("GET", "/api/app/v1/me", { token: b.token })).status).toBe(200);
  });

  it("does not let a disabled account in through Google, nor through an exchange code issued earlier", async () => {
    await authorize();
    const f = await startFlow();
    const code = (await callback(f.state, f.cookie)).fragment.get("code")!;
    await h.env.DB.prepare(`UPDATE caregivers SET status = 'disabled' WHERE user_id = ?1`).bind(w.viewerUserId).run();
    expect((await h.call("POST", "/api/app/v1/session/exchange", { json: { code }, envOverrides: GOOGLE_ENV })).status).toBe(401);
    const g = await startFlow();
    expect((await callback(g.state, g.cookie)).fragment.get("error")).toBe("google_unauthorized");
  });

  it("expires the exchange code after 60 seconds", async () => {
    await authorize();
    const f = await startFlow();
    const code = (await callback(f.state, f.cookie)).fragment.get("code")!;
    clock.advance(61);
    expect((await h.call("POST", "/api/app/v1/session/exchange", { json: { code }, envOverrides: GOOGLE_ENV })).status).toBe(401);
  });

  it("is honestly off until fully configured, and a half-configured server fails loudly", async () => {
    // A developer's .dev.vars may configure Google; the "off" case blanks it explicitly.
    const none = { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_REDIRECT_URI: "", GOOGLE_POST_LOGIN_URL: "" };
    const off = await ok<{ enabled: boolean }>(await h.call("GET", "/api/app/v1/auth/google/config", { envOverrides: none }));
    expect(off.enabled).toBe(false);
    const start = await h.call("GET", "/api/app/v1/auth/google/start", { envOverrides: none });
    expect(start.status).toBe(503);
    expect(await problemCode(start)).toBe("google_not_configured");
    expect((await h.call("GET", "/api/app/v1/auth/google/callback?code=a&state=b", { envOverrides: none })).status).toBe(503);
    const on = await ok<{ enabled: boolean }>(await h.call("GET", "/api/app/v1/auth/google/config", { envOverrides: GOOGLE_ENV }));
    expect(on.enabled).toBe(true);
    const partial = await h.call("GET", "/api/app/v1/auth/google/config", { envOverrides: { ...none, GOOGLE_CLIENT_ID: CLIENT_ID } });
    expect(partial.status).toBe(503);
    expect(await problemCode(partial)).toBe("misconfigured");
    // A broken Google setting never takes the rest of the API down.
    expect((await h.call("GET", "/health", { envOverrides: { ...none, GOOGLE_CLIENT_ID: CLIENT_ID } })).status).toBe(200);
    expect((await h.call("GET", "/api/app/v1/me", { token: w.viewerToken, envOverrides: { ...none, GOOGLE_CLIENT_ID: CLIENT_ID } })).status).toBe(200);
    const insecure = await h.call("GET", "/api/app/v1/auth/google/config", { envOverrides: { ...GOOGLE_ENV, GOOGLE_REDIRECT_URI: "http://evil.example.test/cb" } });
    expect(insecure.status).toBe(503);
    // The config endpoint exposes no secrets.
    expect(JSON.stringify(on)).not.toContain(CLIENT_SECRET);
  });

  it("refuses to start on an origin other than the registered redirect URI, so the cookie and the callback agree", async () => {
    const res = await h.call("GET", "/api/app/v1/auth/google/start", { envOverrides: { ...GOOGLE_ENV, GOOGLE_REDIRECT_URI: "https://other.example.test/api/app/v1/auth/google/callback" } });
    expect(res.status).toBe(400);
    expect(await problemCode(res)).toBe("redirect_origin_mismatch");
  });

  it("takes the post-login destination only from configuration, never from the request", async () => {
    await authorize();
    const f = await startFlow();
    const res = await h.call("GET", `/api/app/v1/auth/google/callback?code=good-code&state=${encodeURIComponent(f.state)}&redirect=https://evil.example.test&next=https://evil.example.test`, {
      envOverrides: GOOGLE_ENV,
      headers: { cookie: `cl_oauth=${f.cookie}` },
    });
    expect(new URL(res.headers.get("location")!).origin).toBe("https://app.example.test");
  });

  it("only the owner can authorize or revoke a Google identity", async () => {
    expect((await h.call("POST", `/api/admin/v1/caregivers/${w.viewerUserId}/google`, { token: w.caregiverToken, json: { email: SHARED_EMAIL } })).status).toBe(401);
    expect((await h.call("POST", `/api/admin/v1/caregivers/${w.viewerUserId}/google`, { token: ADMIN_TOKEN, json: { email: "not-an-email" } })).status).toBe(422);
    expect((await h.call("POST", "/api/admin/v1/caregivers/usr_missing/google", { token: ADMIN_TOKEN, json: { email: SHARED_EMAIL } })).status).toBe(404);
    await authorize();
    // The same identity cannot be silently re-pointed at another account.
    expect((await h.call("POST", `/api/admin/v1/caregivers/${w.caregiverId}/google`, { token: ADMIN_TOKEN, json: { email: SHARED_EMAIL } })).status).toBe(409);
  });

  it("does not log or store authorization codes, ID tokens or the client secret", async () => {
    await authorize();
    const f = await startFlow();
    await callback(f.state, f.cookie);
    const audit = await h.env.DB.prepare(`SELECT group_concat(coalesce(detail_json, ''), ' ') AS all_detail FROM audit_log`).first<{ all_detail: string }>();
    expect(audit?.all_detail ?? "").not.toMatch(/good-code|eyJ|test-only-client-secret/);
  });
});

const OPEN_RECIPIENT = "rcp-open-showcase";
const OPEN_ENV = { ...GOOGLE_ENV, GOOGLE_OPEN_VIEWER_RECIPIENT_ID: OPEN_RECIPIENT };

describe("Google sign-in, open-viewer mode (any verified Google account reads the one showcase recipient)", () => {
  beforeEach(async () => {
    await freshDb();
    clock = new TestClock();
    google = fakeGoogle(clock);
    h = harness(clock, {}, { outboundFetch: google.fetch });
    resetGoogleKeyCache();
    w = await provision(h);
  });

  /** Full browser round trip for one Google subject; returns the application session. */
  async function signIn(sub: string, env: Record<string, string> = OPEN_ENV) {
    google.next = { status: 200, tokenOptions: { sub, email: `${sub}@example.invalid` } };
    const f = await startFlow(env);
    const back = await callback(f.state, f.cookie, "good-code", "", env);
    const code = back.fragment.get("code");
    if (!code) return { error: back.fragment.get("error") };
    const session = await ok<{ token: string; user: { user_id: string; display_name: string }; recipients: Array<{ recipient_id: string; role: string; permissions: string[] }> }>(
      await h.call("POST", "/api/app/v1/session/exchange", { json: { code }, envOverrides: env }),
      201,
    );
    return { session };
  }

  it("enrolls a never-seen Google account as a read-only viewer of exactly the showcase recipient, keyed by sub, storing no e-mail", async () => {
    const { session } = await signIn("open-sub-1");
    expect(session!.recipients).toEqual([expect.objectContaining({ recipient_id: OPEN_RECIPIENT, role: "viewer", permissions: ["data.read"] })]);
    expect(session!.user.display_name).toBe("Người xem (Google)");
    // The showcase recipient was created empty: no devices, no events (nothing fabricated).
    const recipient = await h.env.DB.prepare(`SELECT display_label, status FROM care_recipients WHERE recipient_id = ?1`).bind(OPEN_RECIPIENT).first();
    expect(recipient).toEqual({ display_label: "Hồ sơ trình diễn", status: "active" });
    expect((await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM devices WHERE recipient_id = ?1`).bind(OPEN_RECIPIENT).first<{ n: number }>())?.n).toBe(0);
    expect((await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM events WHERE recipient_id = ?1`).bind(OPEN_RECIPIENT).first<{ n: number }>())?.n).toBe(0);
    // Identity = Google subject only; the e-mail is neither a login identifier nor stored anywhere.
    const viewer = await h.env.DB.prepare(`SELECT * FROM google_viewers WHERE google_sub = 'open-sub-1'`).first<Record<string, unknown>>();
    expect(viewer?.user_id).toBe(session!.user.user_id);
    expect(JSON.stringify(viewer)).not.toContain("example.invalid");
    const account = await h.env.DB.prepare(`SELECT login_email, login_secret_sha256 FROM caregivers WHERE user_id = ?1`).bind(session!.user.user_id).first();
    expect(account).toEqual({ login_email: null, login_secret_sha256: null });
    expect((await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM google_identities`).first<{ n: number }>())?.n).toBe(0);
    const audit = await h.env.DB.prepare(`SELECT group_concat(coalesce(detail_json, ''), ' ') AS d FROM audit_log`).first<{ d: string }>();
    expect(audit?.d ?? "").not.toMatch(/example\.invalid|open-sub-1/);
  });

  it("maps the same subject to the same account on every sign-in, and different subjects to different accounts", async () => {
    const a1 = (await signIn("open-sub-1")).session!;
    const a2 = (await signIn("open-sub-1")).session!;
    const b = (await signIn("open-sub-2")).session!;
    expect(a2.user.user_id).toBe(a1.user.user_id);
    expect(b.user.user_id).not.toBe(a1.user.user_id);
    expect((await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM google_viewers`).first<{ n: number }>())?.n).toBe(2);
    expect((await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM grants WHERE recipient_id = ?1`).bind(OPEN_RECIPIENT).first<{ n: number }>())?.n).toBe(2);
    // Independent sessions: one viewer logging out leaves the other session of the same account and other viewers alone.
    expect((await h.call("DELETE", "/api/app/v1/session", { token: a1.token })).status).toBe(204);
    expect((await h.call("GET", "/api/app/v1/me", { token: a1.token })).status).toBe(401);
    expect((await h.call("GET", "/api/app/v1/me", { token: a2.token })).status).toBe(200);
    expect((await h.call("GET", "/api/app/v1/me", { token: b.token })).status).toBe(200);
  });

  it("enforces read-only on the server: every write, command, admin call and any other recipient is refused", async () => {
    const { session } = await signIn("open-sub-1");
    const t = session!.token;
    const R = `/api/app/v1/recipients/${OPEN_RECIPIENT}`;
    // Reads of the showcase recipient work, including a single-use stream ticket.
    expect((await h.call("GET", `${R}/events`, { token: t })).status).toBe(200);
    expect((await h.call("GET", `${R}/alerts`, { token: t })).status).toBe(200);
    expect((await h.call("POST", "/api/app/v1/stream-tickets", { token: t, json: { recipient_id: OPEN_RECIPIENT } })).status).toBe(201);
    // Writes are refused for lack of permission (403), whatever the body.
    for (const [method, path, json] of [
      ["POST", `${R}/alerts/alr_x/actions`, { action: "acknowledge", expected_version: 1, review_outcome: null, note: null }],
      ["POST", `${R}/fusion-decisions/fd_x/review`, {}],
      ["POST", `${R}/devices/esp32-any/commands`, {}],
      ["POST", `${R}/commands/cmd_x/cancel`, {}],
      ["POST", `${R}/reminders`, {}],
      ["PATCH", `${R}/reminders/rem_x`, {}],
      ["DELETE", `${R}/reminders/rem_x`, undefined],
      ["DELETE", `${R}/voice-messages/vm_x`, undefined],
    ] as const) {
      const res = await h.call(method, path, { token: t, ...(json ? { json } : {}) });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await problemCode(res)).toBe("permission_denied");
    }
    // Another recipient, picked by id in the URL or in the ticket request: not found (existence is not revealed).
    expect((await h.call("GET", `/api/app/v1/recipients/${w.recipientId}/events`, { token: t })).status).toBe(404);
    expect((await h.call("GET", `/api/app/v1/recipients/${w.otherRecipientId}/alerts`, { token: t })).status).toBe(404);
    expect((await h.call("POST", "/api/app/v1/stream-tickets", { token: t, json: { recipient_id: w.recipientId } })).status).toBe(404);
    // The session token is not an admin credential.
    expect((await h.call("GET", "/api/admin/v1/status", { token: t })).status).toBe(401);
    expect((await h.call("POST", "/api/admin/v1/grants", { token: t, json: { user_id: session!.user.user_id, recipient_id: w.recipientId, role: "caregiver" } })).status).toBe(401);
  });

  it("ends the viewer session after SESSION_TTL_HOURS", async () => {
    const { session } = await signIn("open-sub-1");
    clock.advance(12 * 3600 + 1);
    expect((await h.call("GET", "/api/app/v1/me", { token: session!.token })).status).toBe(401);
  });

  it("keeps the owner in control: a revoked grant is not recreated, a disabled account stays out, and turning the mode off closes the door", async () => {
    const first = (await signIn("open-sub-1")).session!;
    const grant = await h.env.DB.prepare(`SELECT grant_id FROM grants WHERE user_id = ?1`).bind(first.user.user_id).first<{ grant_id: string }>();
    await ok(await h.call("POST", `/api/admin/v1/grants/${grant!.grant_id}/revoke`, { token: ADMIN_TOKEN }));
    // Signs in, but sees no recipient: the revoked grant is not silently re-created.
    expect((await signIn("open-sub-1")).session!.recipients).toEqual([]);

    const other = (await signIn("open-sub-2")).session!;
    await h.env.DB.prepare(`UPDATE caregivers SET status = 'disabled' WHERE user_id = ?1`).bind(other.user.user_id).run();
    expect((await signIn("open-sub-2")).error).toBe("google_unauthorized");

    // Without GOOGLE_OPEN_VIEWER_RECIPIENT_ID, enrolled viewers and newcomers alike are refused (allowlist only).
    expect((await signIn("open-sub-3", GOOGLE_ENV)).error).toBe("google_unauthorized");
    expect((await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM google_viewers WHERE google_sub = 'open-sub-3'`).first<{ n: number }>())?.n).toBe(0);
  });

  it("never reactivates a showcase recipient the owner deactivated", async () => {
    await signIn("open-sub-1");
    await h.env.DB.prepare(`UPDATE care_recipients SET status = 'inactive' WHERE recipient_id = ?1`).bind(OPEN_RECIPIENT).run();
    const again = (await signIn("open-sub-1")).session!;
    expect(again.recipients).toEqual([]);
    expect((await h.env.DB.prepare(`SELECT status FROM care_recipients WHERE recipient_id = ?1`).bind(OPEN_RECIPIENT).first<{ status: string }>())?.status).toBe("inactive");
  });

  it("does not let an allowlisted e-mail with a foreign subject fall back to open access", async () => {
    await authorize("open-sub-1@example.invalid");
    expect((await signIn("open-sub-1")).session!.recipients).toEqual([expect.objectContaining({ recipient_id: w.recipientId, role: "viewer" })]);
    google.next = { status: 200, tokenOptions: { sub: "intruder-sub", email: "open-sub-1@example.invalid" } };
    const f = await startFlow(OPEN_ENV);
    expect((await callback(f.state, f.cookie, "good-code", "", OPEN_ENV)).fragment.get("error")).toBe("google_unauthorized");
    expect((await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM google_viewers`).first<{ n: number }>())?.n).toBe(0);
  });

  it.each([
    ["a signature from another key", "key"],
    ["another audience", "aud"],
    ["another issuer", "iss"],
    ["an expired token", "exp"],
    ["a replayed nonce", "nonce"],
  ] as const)("still rejects an ID token with %s and creates no account", async (_name, what) => {
    const o: TokenOptions = { sub: "open-sub-bad" };
    if (what === "key") o.key = otherKey;
    if (what === "aud") o.aud = "someone-elses-client.apps.googleusercontent.com";
    if (what === "iss") o.iss = "https://evil.example.test";
    if (what === "exp") o.exp = 1;
    if (what === "nonce") o.nonce = "nn_other";
    google.next = { status: 200, tokenOptions: o };
    const f = await startFlow(OPEN_ENV);
    expect((await callback(f.state, f.cookie, "good-code", "", OPEN_ENV)).fragment.get("error")).toBe("google_token");
    expect((await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM google_viewers`).first<{ n: number }>())?.n).toBe(0);
    expect((await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM care_recipients WHERE recipient_id = ?1`).bind(OPEN_RECIPIENT).first<{ n: number }>())?.n).toBe(0);
  });

  it("still validates state in open mode (no cookie, other browser, replay)", async () => {
    const f = await startFlow(OPEN_ENV);
    expect((await callback(f.state, null, "good-code", "", OPEN_ENV)).fragment.get("error")).toBe("google_state");
    expect((await callback(f.state, "bd_other", "good-code", "", OPEN_ENV)).fragment.get("error")).toBe("google_state");
    expect((await callback(f.state, f.cookie, "good-code", "", OPEN_ENV)).fragment.get("code")).toMatch(/^clx_/);
    expect((await callback(f.state, f.cookie, "good-code", "", OPEN_ENV)).fragment.get("error")).toBe("google_state");
  });

  it("reports the access mode and refuses a malformed showcase id", async () => {
    const cfg = await ok<{ enabled: boolean; access: string; password_sign_in: boolean }>(await h.call("GET", "/api/app/v1/auth/google/config", { envOverrides: OPEN_ENV }));
    expect(cfg).toEqual({ enabled: true, access: "open_viewer", password_sign_in: true });
    const ready = await ok<{ capabilities: Record<string, unknown> }>(await h.call("GET", "/ready", { envOverrides: OPEN_ENV }));
    expect(ready.capabilities).toMatchObject({ google_signin: "configured", google_access: "open_viewer_read_only", password_sign_in: "enabled" });
    const bad = await h.call("GET", "/api/app/v1/auth/google/config", { envOverrides: { ...OPEN_ENV, GOOGLE_OPEN_VIEWER_RECIPIENT_ID: "bad id; drop" } });
    expect(bad.status).toBe(503);
    expect(await problemCode(bad)).toBe("misconfigured");
  });
});

describe("PASSWORD_SIGN_IN=disabled", () => {
  beforeEach(async () => {
    await freshDb();
    clock = new TestClock();
    h = harness(clock);
    w = await provision(h);
  });

  it("refuses passwords before any credential check, and says so to the login page", async () => {
    const issued = await ok<{ password: string }>(await h.call("POST", `/api/admin/v1/caregivers/${w.viewerUserId}/login`, { token: ADMIN_TOKEN, json: { login_id: "viewer.pw@example.invalid" } }), 201);
    const off = { PASSWORD_SIGN_IN: "disabled" };
    const res = await h.call("POST", "/api/app/v1/session", { json: { username: "viewer.pw@example.invalid", password: issued.password }, envOverrides: off });
    expect(res.status).toBe(403);
    expect(await problemCode(res)).toBe("password_sign_in_disabled");
    expect((await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM caregiver_tokens WHERE kind = 'session'`).first<{ n: number }>())?.n).toBe(0);
    const cfg = await ok<{ password_sign_in: boolean }>(await h.call("GET", "/api/app/v1/auth/google/config", { envOverrides: off }));
    expect(cfg.password_sign_in).toBe(false);
    // The same credential works where passwords are enabled (local development, tests).
    expect((await h.call("POST", "/api/app/v1/session", { json: { username: "viewer.pw@example.invalid", password: issued.password } })).status).toBe(201);
    const bad = await h.call("GET", "/health", { envOverrides: { PASSWORD_SIGN_IN: "maybe" } });
    expect(bad.status).toBe(503);
  });
});
