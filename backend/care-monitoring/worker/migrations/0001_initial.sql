-- care-monitoring D1 schema, version 1.
-- Not yet applied to any remote database (2026-10-19), so it was revised in place before the first
-- deploy. Once `wrangler d1 migrations apply --remote` has run, never edit this file: add 0002_*.sql.
-- Times are UTC ISO-8601 strings produced by Date.prototype.toISOString() ("YYYY-MM-DDTHH:MM:SS.sssZ"),
-- so lexical order equals time order. Device evidence additionally keeps the device's monotonic clock
-- (boot_id + uptime_ms), which is what fusion aligns on; the UTC values of device evidence are server
-- estimates (see device_boots). Image/video bytes are never stored here: camera frames live only in the
-- private MEDIA R2 bucket for a short time (see capture_sessions.media_expires_at).

-- Never holds rows. A batch inserts `0` into it when a precondition fails, which violates the CHECK
-- and rolls the whole D1 batch (an implicit transaction) back. Used for lease and state guards.
CREATE TABLE tx_guard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

CREATE TABLE care_recipients (
  recipient_id TEXT PRIMARY KEY,
  display_label TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL
);

-- One device belongs to one recipient for its whole life. Moving hardware to another person means
-- revoking this device_id and provisioning a new one, so recipient attribution never changes in place.
CREATE TABLE devices (
  device_id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  kind TEXT NOT NULL DEFAULT 'esp32_s3_cam' CHECK (kind IN ('esp32_s3_cam')),
  label TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  credential_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  firmware_version TEXT,
  last_seen_at TEXT,
  last_boot_id TEXT,
  last_heartbeat_at TEXT,
  last_heartbeat_json TEXT,          -- device self-report (component states, RSSI, heap); no secrets
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_devices_recipient ON devices (recipient_id);

-- One row per device boot. epoch_ms estimates the UTC instant of uptime 0 as the minimum over the boot of
-- (server receive time - uptime_ms reported in the request). Network latency only ever makes a sample
-- larger, so the minimum converges on the true epoch plus the smallest one-way latency seen.
CREATE TABLE device_boots (
  device_id TEXT NOT NULL REFERENCES devices (device_id),
  boot_id TEXT NOT NULL,
  epoch_ms INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  max_uptime_ms INTEGER NOT NULL,
  observations INTEGER NOT NULL DEFAULT 1,
  wall_clock_synced INTEGER NOT NULL DEFAULT 0,
  wall_offset_ms INTEGER,            -- device wall clock - server receive time, last synced report
  PRIMARY KEY (device_id, boot_id)
);

CREATE TABLE device_presence (
  device_id TEXT NOT NULL REFERENCES devices (device_id),
  hour_utc TEXT NOT NULL,            -- "YYYY-MM-DDTHH"
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (device_id, hour_utc)
);

CREATE TABLE agents (
  agent_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_seen_at TEXT,
  last_reported_json TEXT,           -- versions/capabilities the agent reported, no secrets
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

-- login_email/login_secret_sha256: optional web sign-in. The secret is a server-generated random string
-- of at least 100 bits (never chosen by a person), so a plain SHA-256 is sufficient and fits the 10 ms CPU
-- budget of Workers Free; a slow password hash is only needed for human-chosen passwords.
CREATE TABLE caregivers (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  login_email TEXT UNIQUE,
  login_secret_sha256 TEXT,
  login_updated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE caregiver_tokens (
  token_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES caregivers (user_id),
  kind TEXT NOT NULL DEFAULT 'api' CHECK (kind IN ('api', 'session')),
  token_sha256 TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX idx_caregiver_tokens_user ON caregiver_tokens (user_id, revoked_at);

-- Single-use, 60-second tickets that let a browser EventSource (which cannot send headers) open the
-- /api/demo/stream adapter for one recipient the signed-in user may read.
CREATE TABLE stream_tickets (
  ticket_sha256 TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES caregivers (user_id),
  token_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_stream_tickets_expiry ON stream_tickets (expires_at);

CREATE TABLE grants (
  grant_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES caregivers (user_id),
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  role TEXT NOT NULL CHECK (role IN ('caregiver', 'viewer')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX uq_grants_active ON grants (user_id, recipient_id) WHERE revoked_at IS NULL;

-- Upload session of one burst. manifest_json holds per-frame metadata only (sequence, time offset,
-- size, sha256); never pixels. Chunks are R2 objects media/<capture_pk>/chunk-<i>; the keys are derived
-- from capture_pk and chunk_count, so every object of a capture can be deleted without listing.
CREATE TABLE capture_sessions (
  capture_pk TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (device_id),
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  capture_id TEXT NOT NULL,
  source_mode TEXT NOT NULL CHECK (source_mode IN ('device', 'simulated')),
  mode TEXT NOT NULL CHECK (mode IN ('normal', 'triggered')),
  boot_id TEXT NOT NULL,
  first_uptime_ms INTEGER NOT NULL,  -- frame 0, device monotonic clock
  last_uptime_ms INTEGER NOT NULL,   -- last frame
  captured_at TEXT NOT NULL,         -- server estimate of frame 0 (device_boots.epoch_ms + first_uptime_ms)
  captured_until TEXT NOT NULL,
  frame_count INTEGER NOT NULL CHECK (frame_count IN (24, 40)),
  frame_width INTEGER NOT NULL,
  frame_height INTEGER NOT NULL,
  frames_per_chunk INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  chunks_received INTEGER NOT NULL DEFAULT 0,      -- bit i set = chunk i stored and validated
  manifest_json TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  trigger_id TEXT,
  trigger_frame_index INTEGER,
  cadence_status TEXT NOT NULL CHECK (cadence_status IN ('ok', 'out_of_tolerance', 'gap')),
  validation_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('receiving', 'uploaded', 'processing', 'processed', 'failed', 'expired')),
  failure_code TEXT,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  uploaded_at TEXT,
  finished_at TEXT,
  media_expires_at TEXT NOT NULL,
  media_deleted_at TEXT,
  media_delete_attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE (device_id, capture_id)
);
CREATE INDEX idx_captures_media_pending ON capture_sessions (media_expires_at) WHERE media_deleted_at IS NULL;
CREATE INDEX idx_captures_device_received ON capture_sessions (device_id, received_at);
CREATE INDEX idx_captures_device_time ON capture_sessions (device_id, captured_at);
CREATE INDEX idx_captures_recipient_time ON capture_sessions (recipient_id, captured_at);
CREATE INDEX idx_captures_device_uptime ON capture_sessions (device_id, boot_id, first_uptime_ms);

-- Raw MPU6050 samples exactly as the device reported them (units fixed by imu-batch.v1: g, deg/s,
-- ms since boot), kept for IMU_RAW_RETENTION_HOURS for fusion and investigation. validation_json holds
-- data-quality flags only (gaps, rate mismatch, saturation, sequence gaps); nothing here is a classification.
CREATE TABLE imu_batches (
  batch_pk TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (device_id),
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  source_mode TEXT NOT NULL CHECK (source_mode IN ('device', 'simulated')),
  boot_id TEXT NOT NULL,
  batch_seq INTEGER NOT NULL,
  sensor TEXT NOT NULL CHECK (sensor IN ('mpu6050')),
  sample_rate_hz REAL NOT NULL,
  accel_range_g INTEGER NOT NULL,
  gyro_range_dps INTEGER NOT NULL,
  first_uptime_ms INTEGER NOT NULL,
  last_uptime_ms INTEGER NOT NULL,
  start_at TEXT NOT NULL,            -- server estimates
  end_at TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  samples_json TEXT NOT NULL,        -- {"uptime_ms":[...],"ax":[...],...,"gz":[...]}
  seq_gap_before INTEGER NOT NULL DEFAULT 0,
  validation_json TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (device_id, boot_id, batch_seq)
);
CREATE INDEX idx_imu_batches_window ON imu_batches (device_id, boot_id, first_uptime_ms);
CREATE INDEX idx_imu_batches_retention ON imu_batches (end_at);

-- Normalized evidence: one row per model check of a capture or per IMU trigger.
CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  device_id TEXT NOT NULL REFERENCES devices (device_id),
  capture_pk TEXT REFERENCES capture_sessions (capture_pk),
  capture_id TEXT,
  trigger_id TEXT,
  source_record_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('fall_check', 'drink_check', 'imu_trigger')),
  boot_id TEXT,
  uptime_from_ms INTEGER,            -- device monotonic window of the evidence (same boot as boot_id)
  uptime_until_ms INTEGER,
  observed_at TEXT NOT NULL,
  observed_until TEXT,
  received_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('vision_model', 'imu_sensor')),
  source_mode TEXT NOT NULL CHECK (source_mode IN ('device', 'simulated')),
  model_name TEXT,
  model_version TEXT,
  model_score REAL,
  score_kind TEXT,
  label TEXT,
  calibration_status TEXT NOT NULL CHECK (calibration_status IN ('not_calibrated', 'calibrated', 'uncalibrated_trial', 'not_applicable')),
  classification TEXT NOT NULL CHECK (classification IN (
    'uncalibrated_output', 'fall_candidate', 'below_candidate_rule', 'not_enough_data',
    'drinking_water_observed', 'medicine_observed', 'none_observed', 'cross_window_review',
    'imu_trigger_reported')),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'dismissed')),
  evidence_json TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('recorded', 'skipped')),
  fusion_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (fusion_status IN ('not_applicable', 'pending', 'decided')),
  fusion_decision_id TEXT,
  alert_status TEXT NOT NULL DEFAULT 'none' CHECK (alert_status IN ('none', 'raised', 'deduplicated')),
  alert_id TEXT,
  summary_vi TEXT NOT NULL,
  UNIQUE (device_id, source_record_id)
);
CREATE INDEX idx_events_recipient_time ON events (recipient_id, observed_at, event_id);
CREATE INDEX idx_events_device_type_time ON events (device_id, event_type, observed_at);
CREATE INDEX idx_events_fusion_pending ON events (fusion_status, received_at) WHERE fusion_status = 'pending';
CREATE INDEX idx_events_device_uptime ON events (device_id, boot_id, uptime_from_ms);

CREATE TABLE fusion_decisions (
  decision_id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  device_id TEXT NOT NULL REFERENCES devices (device_id),
  capture_pk TEXT REFERENCES capture_sessions (capture_pk),
  trigger_event_id TEXT REFERENCES events (event_id),
  vision_event_id TEXT REFERENCES events (event_id),
  dedup_key TEXT NOT NULL UNIQUE,
  policy_version TEXT NOT NULL,
  case_code TEXT NOT NULL,
  -- System outcome only. 'no_fall_detected' requires both owner-approved rules to be below threshold and
  -- is never shown as "safe"; human verification lives in verification_status.
  status TEXT NOT NULL CHECK (status IN ('suspected_fall', 'needs_review', 'not_enough_data', 'no_fall_detected', 'processing_failed')),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'dismissed')),
  alert_decision TEXT NOT NULL CHECK (alert_decision IN ('raise', 'deduplicated', 'none')),
  alert_id TEXT,
  observed_at TEXT NOT NULL,
  explanation_json TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  verified_by TEXT,
  verified_at TEXT,
  verification_note TEXT
);
CREATE INDEX idx_fusion_recipient_time ON fusion_decisions (recipient_id, observed_at, decision_id);

CREATE TABLE alerts (
  alert_id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  device_id TEXT NOT NULL REFERENCES devices (device_id),
  kind TEXT NOT NULL CHECK (kind IN ('suspected_fall')),
  fusion_decision_id TEXT NOT NULL REFERENCES fusion_decisions (decision_id),
  dedup_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'in_progress', 'resolved')),
  severity TEXT NOT NULL CHECK (severity IN ('warning')),
  verification_required INTEGER NOT NULL DEFAULT 1 CHECK (verification_required = 1),
  summary_vi TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  last_duplicate_at TEXT,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  review_outcome TEXT CHECK (review_outcome IN ('confirmed', 'false_alarm', 'uncertain')),
  review_note TEXT
);
CREATE INDEX idx_alerts_recipient_time ON alerts (recipient_id, triggered_at, alert_id);
CREATE INDEX idx_alerts_device_open ON alerts (device_id, kind, status, triggered_at);

CREATE TABLE alert_actions (
  action_id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES alerts (alert_id),
  action TEXT NOT NULL CHECK (action IN ('acknowledge', 'start', 'resolve')),
  actor_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  review_outcome TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_alert_actions_alert ON alert_actions (alert_id, created_at);

CREATE TABLE daily_reports (
  report_id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  report_date TEXT NOT NULL,          -- local calendar date YYYY-MM-DD in `timezone`
  timezone TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  stats_json TEXT,
  input_snapshot_sha256 TEXT,
  llm_report_json TEXT,
  model_name TEXT,
  model_digest TEXT,
  inference_json TEXT,
  generated_at TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (recipient_id, report_date)
);

-- Durable work queue for the Local AI Agent. Claims are single UPDATE ... RETURNING statements
-- (D1 serializes writes), so two agents can never hold the same lease.
CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('vision', 'daily_report')),
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  device_id TEXT REFERENCES devices (device_id),
  capture_pk TEXT REFERENCES capture_sessions (capture_pk),
  report_id TEXT REFERENCES daily_reports (report_id),
  idempotency_key TEXT NOT NULL UNIQUE,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'retry_pending', 'expired')),
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  next_attempt_at TEXT NOT NULL,
  expires_at TEXT,
  lease_token TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  last_error_detail TEXT,
  result_idempotency_key TEXT,
  result_sha256 TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_jobs_claim ON jobs (status, kind, priority DESC, next_attempt_at, created_at);
CREATE INDEX idx_jobs_lease ON jobs (status, lease_expires_at) WHERE status = 'processing';
CREATE INDEX idx_jobs_expiry ON jobs (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE job_attempts (
  job_id TEXT NOT NULL REFERENCES jobs (job_id),
  attempt_no INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  ended_at TEXT,
  outcome TEXT CHECK (outcome IN ('completed', 'failed', 'released', 'lease_expired')),
  error_code TEXT,
  -- A released (preempted) claim does not count as an attempt, so attempt_no can repeat; the lease is unique.
  PRIMARY KEY (job_id, lease_token)
);

CREATE TABLE audio_assets (
  asset_id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  title TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_audio_recipient ON audio_assets (recipient_id, status);

CREATE TABLE audio_asset_versions (
  asset_id TEXT NOT NULL REFERENCES audio_assets (asset_id),
  version INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  sample_rate_hz INTEGER NOT NULL,
  channels INTEGER NOT NULL,
  bits_per_sample INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (asset_id, version)
);

CREATE TABLE reminder_schedules (
  reminder_id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  device_id TEXT NOT NULL REFERENCES devices (device_id),
  kind TEXT NOT NULL CHECK (kind IN ('medication', 'water')),
  label TEXT NOT NULL,
  voice_message_id TEXT REFERENCES audio_assets (asset_id),
  times_local_json TEXT NOT NULL,
  days_of_week_json TEXT NOT NULL,
  timezone TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  deadline_minutes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX idx_reminders_active ON reminder_schedules (status, device_id);

-- Lifecycle: queued -> delivered -> accepted -> started -> completed; failed / rejected (device-reported,
-- reason code), expired (deadline passed before the device accepted or finished), cancelled (before
-- delivery, or after the device confirmed a cancel request), superseded (replaced by a newer occurrence of
-- the same reminder). Only device reports move a command to accepted, started, completed, failed or rejected.
CREATE TABLE device_commands (
  command_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (device_id),
  recipient_id TEXT NOT NULL REFERENCES care_recipients (recipient_id),
  command_type TEXT NOT NULL CHECK (command_type IN ('emergency_buzzer', 'reminder', 'play_voice_message')),
  priority INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'delivered', 'accepted', 'started', 'completed', 'failed', 'rejected', 'expired', 'cancelled', 'superseded')),
  idempotency_key TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK (source_type IN ('alert', 'reminder', 'caregiver')),
  source_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  not_before TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  max_delivery_attempts INTEGER NOT NULL,
  delivered_at TEXT,
  accepted_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  cancel_requested_at TEXT,
  superseded_by TEXT,
  status_reason TEXT,                -- machine code (device reason_code or system reason)
  status_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_commands_device_pending ON device_commands (device_id, status, priority DESC, not_before, created_at);
CREATE INDEX idx_commands_expiry ON device_commands (status, expires_at);
CREATE INDEX idx_commands_source ON device_commands (source_type, source_id);
CREATE INDEX idx_commands_recipient_time ON device_commands (recipient_id, created_at);

CREATE TABLE device_command_events (
  command_id TEXT NOT NULL REFERENCES device_commands (command_id),
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('device', 'caregiver', 'system')),
  at TEXT NOT NULL,
  PRIMARY KEY (command_id, seq)
);

-- Per-recipient change counter for SSE ids (Last-Event-ID / last_seq).
CREATE TABLE recipient_streams (
  recipient_id TEXT PRIMARY KEY REFERENCES care_recipients (recipient_id),
  seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Security and configuration audit. Never stores tokens, media, request bodies or sensor samples.
CREATE TABLE audit_log (
  audit_id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'caregiver', 'device', 'agent', 'system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  recipient_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  request_id TEXT,
  detail_json TEXT
);
CREATE INDEX idx_audit_at ON audit_log (at);
