-- ADR-022: device receipt report, size-based delivery deadlines and reboot handling for device commands.
-- Additive only: device_commands is not rebuilt and its status CHECK is unchanged ("received" is a report that leaves
-- the status at 'delivered'). A Worker without this change ignores the three columns; this Worker treats NULL as the
-- previous behaviour (redeliver 30 s after delivered_at).
--   received_at      when the device reported `received` (it stored the command; nothing played yet)
--   device_boot_id   boot of the device's last received/accepted/started report; a different boot later means the
--                    device restarted while holding the command
--   ack_deadline_at  until when the server waits before acting: without a receipt, redelivery (30 s, plus the audio
--                    download allowance for commands with audio); after a receipt, failure with download_timeout
ALTER TABLE device_commands ADD COLUMN received_at TEXT;
ALTER TABLE device_commands ADD COLUMN device_boot_id TEXT;
ALTER TABLE device_commands ADD COLUMN ack_deadline_at TEXT;
CREATE INDEX idx_commands_device_boot ON device_commands (device_id, device_boot_id, status);
