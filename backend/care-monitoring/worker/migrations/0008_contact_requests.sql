-- Contact, consultation and purchase requests from the public landing form (A43). Additive only.
-- One row per accepted submission. payload_json holds the normalised fields the customer typed for that category
-- (contact details, organisation, quantities, address, message); nothing medical is asked for and nothing else is kept.
-- Rejected submissions (validation, honeypot, rate limit) and identical resubmissions within 24 h are not stored.
-- ip_day_sha256 = SHA-256("contact:" + client IP + ":" + UTC date), only for the one-hour submission count. An IPv4 hash
-- can be reversed by enumeration, so the maintenance cron clears it ('') two hours after the submission.
-- Consent: a row exists only if the form's consent box was ticked; consent_at is the server time of that submission and
-- privacy_notice_version names the notice + consent wording the form showed.
-- Retention: 0009_contact_retention.sql (A44, owner-approved 2026-11-06).
CREATE TABLE contact_requests (
  request_id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('individual_consultation', 'individual_purchase', 'facility_consultation', 'facility_purchase')),
  customer_group TEXT NOT NULL CHECK (customer_group IN ('individual', 'facility')),
  payload_json TEXT NOT NULL,
  dedup_sha256 TEXT NOT NULL,
  ip_day_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  privacy_notice_version TEXT NOT NULL,
  -- not_configured: stored while mail settings are missing (sent by the cron once configured, within 30 days)
  -- pending: stored, no attempt yet · sending: an attempt is in flight (or was interrupted; the cron re-checks it)
  -- sent: the provider accepted the message (not proof of delivery) · failed: last attempt rejected, unreachable or timed
  -- out, retried by the cron with the same idempotency key · abandoned: retries exhausted, or a retry could no longer be
  -- de-duplicated by the provider (notification_error 'outcome_unknown' = an interrupted attempt may have been delivered).
  notification_status TEXT NOT NULL CHECK (notification_status IN ('not_configured', 'pending', 'sending', 'sent', 'failed', 'abandoned')),
  notification_attempts INTEGER NOT NULL DEFAULT 0,
  notification_last_attempt_at TEXT,
  notification_sent_at TEXT,
  notification_provider_id TEXT,
  notification_error TEXT
);
CREATE INDEX contact_requests_dedup ON contact_requests (dedup_sha256, created_at);
CREATE INDEX contact_requests_ip ON contact_requests (ip_day_sha256, created_at);
CREATE INDEX contact_requests_notification ON contact_requests (notification_status, notification_last_attempt_at);
