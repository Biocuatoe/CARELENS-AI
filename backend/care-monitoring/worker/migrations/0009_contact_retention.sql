-- Retention of contact / purchase requests (A44, owner-approved 2026-11-06). Additive only; touches contact_requests only.
--   handling_status  open | closed. Spam is never stored (rejected before D1), so there is no spam state.
--   updated_at       last handling activity: creation, or an operator action (close, reopen / activity). Notification
--                    attempts do NOT change it. An open request with no update for 12 months is closed by the cron.
--   closed_at        when the request was closed (by an operator or automatically); never derived from updated_at.
--   close_reason     operator | inactivity
--   purge_after      closed_at + 180 days, fixed at closure; the cron deletes the row (with its notification record,
--                    which lives on the same row) once purge_after has passed. Reopening clears it.
ALTER TABLE contact_requests ADD COLUMN handling_status TEXT NOT NULL DEFAULT 'open' CHECK (handling_status IN ('open', 'closed'));
ALTER TABLE contact_requests ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE contact_requests ADD COLUMN closed_at TEXT;
ALTER TABLE contact_requests ADD COLUMN close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN ('operator', 'inactivity'));
ALTER TABLE contact_requests ADD COLUMN purge_after TEXT;
UPDATE contact_requests SET updated_at = created_at WHERE updated_at = '';
CREATE INDEX contact_requests_open_activity ON contact_requests (handling_status, updated_at);
CREATE INDEX contact_requests_purge ON contact_requests (handling_status, purge_after);
