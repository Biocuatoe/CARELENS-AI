-- Open-viewer Google sign-in (GOOGLE_OPEN_VIEWER_RECIPIENT_ID, see src/google.ts openViewer).
-- One read-only viewer account per verified Google account, keyed by Google's stable subject id. No e-mail or other
-- profile data is stored. The account's only grant is created by the Worker: role 'viewer' on the configured showcase
-- recipient. Disabling the caregiver row, or revoking its grant, keeps that Google account out for good.
CREATE TABLE google_viewers (
  google_sub TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES caregivers (user_id),
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
