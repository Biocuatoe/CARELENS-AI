-- Google sign-in (OpenID Connect, authorization code + PKCE). See src/google.ts.

-- Google identities the owner has authorized, each mapped to one existing caregiver/viewer account.
-- Authorization is an explicit allowlist: an authenticated Google account that is not listed here gets no access.
-- google_sub (Google's stable subject id) is bound at the first successful sign-in; from then on the same e-mail
-- must present the same subject, so a recycled or re-assigned address cannot take over the mapping.
CREATE TABLE google_identities (
  email TEXT PRIMARY KEY CHECK (email = lower(email)),
  user_id TEXT NOT NULL REFERENCES caregivers (user_id),
  google_sub TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX idx_google_identities_user ON google_identities (user_id);

-- One row per started sign-in. state is stored hashed; binding_sha256 is the hash of a random value that only the
-- initiating browser holds (HttpOnly cookie), so a callback replayed from another browser (login CSRF) is refused.
-- nonce and the PKCE code_verifier live here for at most 10 minutes and are never sent to the browser.
CREATE TABLE oauth_states (
  state_sha256 TEXT PRIMARY KEY,
  binding_sha256 TEXT NOT NULL,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Single-use, 60-second code that hands a verified Google sign-in from the callback redirect to the web app's own
-- POST /api/app/v1/session/exchange. The browser never receives a session token in a URL.
CREATE TABLE login_exchanges (
  code_sha256 TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES caregivers (user_id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
