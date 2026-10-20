-- Speaker volume chosen in the admin dashboard and delivered to the device in the heartbeat response (config.speaker_volume).
-- Additive only. NULL = the server sets nothing and the device keeps its own (provisioned) volume. The device reports the
-- volume it actually applies in its next heartbeat (status.speaker_volume, stored with last_heartbeat_json), so the dashboard
-- can show "set" and "applied" separately. The range is a conservative limit for the 8 ohm / 1 W speaker, not a measurement.
ALTER TABLE devices ADD COLUMN speaker_volume REAL CHECK (speaker_volume IS NULL OR (speaker_volume >= 0.05 AND speaker_volume <= 0.7));
ALTER TABLE devices ADD COLUMN speaker_volume_set_at TEXT;
ALTER TABLE devices ADD COLUMN speaker_volume_set_by TEXT;
