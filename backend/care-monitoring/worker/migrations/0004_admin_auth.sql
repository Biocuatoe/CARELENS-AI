-- Admin identity and sessions (Phase B). See src/adminAuth.ts. Additive only: no existing table is rewritten.

-- One row per person who may use the admin API. Identity is a verified Google account:
--   email      lower-cased verified e-mail (the allowlist key; never taken from the browser)
--   google_sub Google's stable subject id, bound at the first successful admin sign-in; from then on the same e-mail
--              must present the same subject, so a recycled address cannot take the seat over
--   role       'owner' = listed in ADMIN_BOOTSTRAP_EMAILS (the trust root: the row is honoured only while the e-mail
--              is still in that secret, so rotating the secret revokes it); 'admin' = added by an owner later
-- Rows are created by the Worker on a verified sign-in of a bootstrap e-mail, never by a request body.
CREATE TABLE admins (
  admin_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  google_sub TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by TEXT REFERENCES admins (admin_id),
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

-- Admin sessions are a separate table and token prefix (clm_) from caregiver/viewer sessions (caregiver_tokens, clc_),
-- so one kind of token can never be presented as the other. Only the SHA-256 of the token is stored.
-- auth_at is when Google authenticated the person; later step-up checks ("signed in recently") read it.
CREATE TABLE admin_sessions (
  token_id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins (admin_id),
  token_sha256 TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  auth_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX idx_admin_sessions_admin ON admin_sessions (admin_id, revoked_at);

-- Single-use, 60-second code that carries a verified admin Google sign-in from the callback redirect to
-- POST /api/admin/v1/session/exchange. Same idea as login_exchanges, kept apart so a viewer code is never an admin code.
CREATE TABLE admin_login_exchanges (
  code_sha256 TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins (admin_id),
  auth_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Which flow started the OAuth state. The callback reads it from here, never from the request, so a state created for
-- the viewer flow cannot finish as an admin sign-in (or the reverse). Existing rows are viewer flows.
ALTER TABLE oauth_states ADD COLUMN purpose TEXT NOT NULL DEFAULT 'viewer' CHECK (purpose IN ('viewer', 'admin'));
