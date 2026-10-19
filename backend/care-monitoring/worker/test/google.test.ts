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

async function callback(state: string, cookie: string | null, code = "good-code", extra = ""): Promise<{ status: number; fragment: URLSearchParams; location: string }> {
  const res = await h.call("GET", `/api/app/v1/auth/google/callback?code=${code}&state=${encodeURIComponent(state)}${extra}`, {
    envOverrides: GOOGLE_ENV,
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
