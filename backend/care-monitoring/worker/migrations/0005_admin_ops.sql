-- Admin operations (dashboard, messages, reminders). Additive only: no existing table is rewritten, no CHECK is changed.
-- Deploy order matters: apply this migration BEFORE the Worker version that reads reminder_schedules.paused_at (the minute cron
-- selects it), otherwise the reminder step of the cron fails until the column exists.

-- An admin can pause a reminder without cancelling it. NULL = running. A paused schedule is skipped by the cron
-- (queueDueReminders) and queues nothing; status stays 'active' so resuming needs no new row.
ALTER TABLE reminder_schedules ADD COLUMN paused_at TEXT;

-- Per-device time-range reads of the admin activity report (half-open UTC interval per local day).
CREATE INDEX idx_events_device_time ON events (device_id, observed_at);
CREATE INDEX idx_commands_device_time ON device_commands (device_id, created_at);
-- Admin mutation throttle (rows of one actor in the last minute) and the audit history page.
CREATE INDEX idx_audit_actor_at ON audit_log (actor_id, at);
