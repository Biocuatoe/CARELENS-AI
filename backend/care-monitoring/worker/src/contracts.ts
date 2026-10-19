/**
 * Input contracts at the trust boundaries (device, local agent, caregiver). These zod schemas are the
 * single source: `npm run contracts:generate` writes them as JSON Schema 2020-12 into
 * contracts/carelens/, and a test fails when the committed files drift.
 *
 * Device contracts are the adapter's proposal and have NOT been verified against real ESP32 firmware.
 * This module must only import zod (scripts/generate-contracts.ts runs it directly under Node).
 */
import { z } from "zod";

const Instant = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/, "RFC 3339 instant with offset");
const DeviceId = z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/);
const RecordId = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "lowercase hex SHA-256");
const SourceMode = z.enum(["device", "simulated"]);
/** Device monotonic time: milliseconds since this boot (64-bit esp_timer_get_time() / 1000, never the
 * 32-bit millis() that wraps after 49.7 days). Comparable only within one boot_id. */
const UptimeMs = z.number().int().min(0).max(1e12);

/* ------------------------------------------------------------------ device → backend */

export const DeviceClock = z
  .object({
    boot_id: z
      .string()
      .min(8)
      .max(64)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .describe("Random identifier the firmware generates at every boot. All uptime_ms values are relative to this boot."),
    uptime_ms: UptimeMs.describe("Device monotonic clock when this request body was built."),
    wall_clock_synced: z.boolean().describe("true only after SNTP synchronisation succeeded in this boot."),
    wall_time: Instant.nullable().describe("Device wall clock at uptime_ms when synced; diagnostics only, never used to order evidence."),
  })
  .strict()
  .describe(
    "Clock block of every device request. The backend maps uptime to server time per boot (received_at − uptime_ms, minimum over the boot); evidence from the same boot is aligned on uptime_ms directly.",
  );
export type DeviceClockT = z.infer<typeof DeviceClock>;

export const CaptureFrameMeta = z
  .object({
    seq: z.number().int().min(0).max(39),
    uptime_ms: UptimeMs.describe("Device monotonic time the frame was captured."),
    size_bytes: z.number().int().min(4).max(200_000),
    sha256: Sha256,
  })
  .strict();

export const CaptureSessionV2 = z
  .object({
    schema_version: z.literal("capture-session.v2"),
    source_mode: SourceMode,
    device_id: DeviceId,
    capture_id: RecordId.describe("Burst (segment) identifier, unique per device. A burst never spans a camera-off interval."),
    mode: z.enum(["normal", "triggered"]),
    clock: DeviceClock,
    frame_count: z.union([z.literal(24), z.literal(40)]),
    nominal_fps: z.literal(8),
    content_type: z.literal("image/jpeg"),
    frame_width: z.number().int().min(16).max(640),
    frame_height: z.number().int().min(16).max(480),
    frames: z.array(CaptureFrameMeta).min(24).max(40),
    trigger_id: RecordId.nullable(),
    trigger_frame_index: z.number().int().min(0).max(39).nullable(),
    firmware_version: z.string().min(1).max(64).nullable(),
  })
  .strict()
  .describe(
    "One camera burst announced before its JPEG chunks are uploaded. Adapter proposal; not yet verified against ESP32 firmware.",
  );
export type CaptureSession = z.infer<typeof CaptureSessionV2>;

const Finite = z.number().finite();
const AccelRangeG = z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]);
const GyroRangeDps = z.union([z.literal(250), z.literal(500), z.literal(1000), z.literal(2000)]);
export const IMU_MAX_SAMPLES_PER_BATCH = 1000;
const ImuColumn = z.array(Finite).min(1).max(IMU_MAX_SAMPLES_PER_BATCH);

export const ImuBatchV1 = z
  .object({
    schema_version: z.literal("imu-batch.v1"),
    source_mode: SourceMode,
    device_id: DeviceId,
    clock: DeviceClock,
    batch_seq: z.number().int().min(0).max(2_147_483_647).describe("Increases by 1 per batch within a boot; restarts at 0 after a reboot."),
    sensor: z.literal("mpu6050"),
    sample_rate_hz: z.number().min(10).max(1000).describe("Configured nominal output data rate."),
    accel_range_g: AccelRangeG,
    gyro_range_dps: GyroRangeDps,
    units: z.object({ time: z.literal("ms_since_boot"), accel: z.literal("g"), gyro: z.literal("deg_per_s") }).strict(),
    samples: z
      .object({
        uptime_ms: z.array(UptimeMs).min(1).max(IMU_MAX_SAMPLES_PER_BATCH),
        ax: ImuColumn,
        ay: ImuColumn,
        az: ImuColumn,
        gx: ImuColumn,
        gy: ImuColumn,
        gz: ImuColumn,
      })
      .strict()
      .describe("Raw accelerometer (g) and gyroscope (°/s) readings, columnar, one timestamp per sample. Not orientation, posture or body angle."),
  })
  .strict()
  .describe("A batch of raw MPU6050 samples. Adapter proposal; not yet verified against ESP32 firmware.");
export type ImuBatch = z.infer<typeof ImuBatchV1>;

export const ImuEventV2 = z
  .object({
    schema_version: z.literal("imu-event.v2"),
    source_mode: SourceMode,
    device_id: DeviceId,
    clock: DeviceClock,
    trigger: z
      .object({
        trigger_id: RecordId,
        trigger_type: z.enum(["impact", "free_fall", "orientation_change", "other"]),
        triggered_uptime_ms: UptimeMs,
        firmware_rule_version: z.string().min(1).max(64),
        capture_id: RecordId.nullable().describe("Burst the firmware started for this trigger, if any."),
        device_metrics: z
          .record(z.string().regex(/^[a-z0-9_]{1,40}$/), Finite)
          .nullable()
          .describe("Values the firmware computed (e.g. peak magnitude). Device-derived, unvalidated; never used for decisions."),
      })
      .strict(),
  })
  .strict()
  .describe(
    "Firmware report that its own MPU6050 rule fired. It may start a burst and a fusion decision, but it is never fall evidence by itself: the raw samples arrive as imu-batch.v1. Adapter proposal; not yet verified against ESP32 firmware.",
  );
export type ImuEvent = z.infer<typeof ImuEventV2>;

const ComponentState = z.enum(["ok", "error", "disabled", "unknown"]);

export const DeviceHeartbeatV2 = z
  .object({
    schema_version: z.literal("device-heartbeat.v2"),
    device_id: DeviceId,
    clock: DeviceClock,
    firmware_version: z.string().min(1).max(64).nullable(),
    status: z
      .object({
        camera: ComponentState,
        imu: ComponentState,
        speaker: ComponentState,
        wifi_rssi_dbm: z.number().int().min(-127).max(0).nullable(),
        free_heap_bytes: z.number().int().min(0).nullable(),
        last_error: z.string().max(120).regex(/^[a-z0-9_:.-]*$/).nullable().describe("Short error code, never free text or secrets."),
      })
      .strict(),
  })
  .strict()
  .describe("Periodic device self-report. Also refines the backend's estimate of this boot's clock.");

export const COMMAND_REASON_CODES = [
  "expired_on_device",
  "unsupported_command",
  "audio_download_failed",
  "audio_integrity_failed",
  "audio_format_unsupported",
  "playback_error",
  "preempted_by_higher_priority",
  "busy",
  "cancel_requested",
  "other",
] as const;

export const CommandStatusV2 = z
  .object({
    schema_version: z.literal("command-status.v2"),
    device_id: DeviceId,
    clock: DeviceClock,
    status: z.enum(["accepted", "started", "completed", "failed", "rejected", "cancelled"]),
    reason_code: z.enum(COMMAND_REASON_CODES).nullable(),
    detail: z.string().max(200).nullable(),
  })
  .strict()
  .describe(
    "Device acknowledgement of a delivered command: accepted (stored, audio verified), started (sound began), completed (played to the end), failed/rejected (reason_code required), cancelled (only after the backend asked). Playback is recorded as done only from this report.",
  );

/* ------------------------------------------------------------------ local agent → backend */

const FallRequest = z
  .object({
    frame_start: z.number().int().min(0).max(39),
    frame_end: z.number().int().min(0).max(39),
    t_start_ms: z.number().int().min(0),
    t_end_ms: z.number().int().min(0),
    score: Finite.describe("Uncalibrated logit from /v1/fall-check. Not a probability."),
    window_logits: z.array(z.array(Finite).min(1).max(8)).min(1).max(8),
    windows: z.number().int().min(1).max(8),
    threshold: Finite.nullable(),
    alert: z.boolean().nullable(),
    status: z.string().min(1).max(40),
  })
  .strict();

const DrinkEvidence = z
  .object({
    frames: z.number().int().min(1).max(24),
    cup_frames: z.number().int().min(0).max(24),
    medicine_frames: z.number().int().min(0).max(24),
    near_face_frames: z.number().int().min(0).max(24),
    lift_frame: z.number().int().min(0).max(23).nullable(),
    cup_lifted_to_face: z.boolean(),
    medicine_handled: z.boolean().optional(),
  })
  .strict();

const DrinkRequest = z
  .object({
    frame_start: z.number().int().min(0).max(39),
    frame_end: z.number().int().min(0).max(39),
    t_start_ms: z.number().int().min(0),
    t_end_ms: z.number().int().min(0),
    label: z.enum(["uong_nuoc", "uong_thuoc", "khong"]),
    evidence: DrinkEvidence,
    status: z.string().min(1).max(40),
  })
  .strict();

const CheckStatus = z.enum(["completed", "skipped", "failed"]);

export const VisionResultV1 = z
  .object({
    schema_version: z.literal("vision-result.v1"),
    idempotency_key: z.string().min(8).max(128),
    capture_id: RecordId,
    package_version: z.string().min(1).max(128),
    vision_health: z.object({ fall_heads: z.number().int().min(0), drink: z.boolean() }).strict(),
    input_validation: z
      .object({
        frame_count: z.number().int(),
        jpeg_ok: z.boolean(),
        cadence_status: z.enum(["ok", "out_of_tolerance", "gap"]),
        min_interval_ms: z.number().int().nullable(),
        max_interval_ms: z.number().int().nullable(),
        issues: z.array(z.string().max(200)).max(50),
      })
      .strict(),
    fall: z
      .object({
        status: CheckStatus,
        reason: z.string().max(200).nullable(),
        aggregation: z.enum(["single_request.v1", "max_request_score_overlapping.v1"]).nullable(),
        aggregate_score: Finite.nullable(),
        requests: z.array(FallRequest).max(3),
      })
      .strict(),
    drink: z
      .object({
        status: CheckStatus,
        reason: z.string().max(200).nullable(),
        aggregation: z.literal("drink_capture_aggregate.v1").nullable(),
        aggregate_label: z.enum(["uong_nuoc", "uong_thuoc", "khong"]).nullable(),
        cross_window_review: z.boolean(),
        distinct_lift_frames: z.array(z.number().int().min(0).max(39)).max(40),
        requests: z.array(DrinkRequest).max(3),
      })
      .strict(),
  })
  .strict()
  .describe("Normalized outputs of the local Vision package for one capture. Numbers and labels only: no frames, boxes or timings.");
export type VisionResult = z.infer<typeof VisionResultV1>;

const GapRef = z.object({ gap_id: z.string().min(1).max(32), note_vi: z.string().min(1).max(300) }).strict();
const EventNote = z.object({ event_id: z.string().min(1).max(80), note_vi: z.string().min(1).max(300) }).strict();

export const DailyReportLlmV1 = z
  .object({
    schema_version: z.literal("daily-report-llm.v1"),
    summary_vi: z.string().min(1).max(2000),
    notable_events: z.array(EventNote).max(40),
    unverified_items: z.array(EventNote).max(40),
    data_gaps: z.array(GapRef).max(24),
    source_event_ids: z.array(z.string().min(1).max(80)).max(200),
  })
  .strict()
  .describe("Structured output the local LLM must return for a daily report. Validated before it is stored.");

export const DailyReportResultV1 = z
  .object({
    schema_version: z.literal("daily-report-result.v1"),
    idempotency_key: z.string().min(8).max(128),
    input_snapshot_sha256: Sha256,
    report: DailyReportLlmV1,
    model: z
      .object({
        name: z.string().min(1).max(128),
        digest: z.string().min(1).max(128),
        runtime: z.literal("ollama"),
      })
      .strict(),
    inference: z
      .object({
        eval_count: z.number().int().min(1),
        prompt_eval_count: z.number().int().min(0),
        total_duration_ms: z.number().min(0),
        attempts: z.number().int().min(1).max(5),
      })
      .strict()
      .describe("Counters reported by the Ollama runtime for the real generation call."),
  })
  .strict();
export type DailyReportResult = z.infer<typeof DailyReportResultV1>;

export const JobFailureV1 = z
  .object({
    lease_token: z.string().min(16).max(128),
    error_code: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
    retryable: z.boolean(),
    detail: z.string().max(500).nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ caregiver → backend */

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ReminderCreateV1 = z
  .object({
    device_id: DeviceId,
    kind: z.enum(["medication", "water"]),
    label: z.string().min(1).max(120),
    voice_message_id: z.string().min(1).max(80).nullable(),
    times_local: z.array(HHMM).min(1).max(12),
    days_of_week: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    timezone: z.string().min(1).max(64),
    start_date: LocalDate,
    end_date: LocalDate.nullable(),
    deadline_minutes: z.number().int().min(1).max(240),
  })
  .strict();

export const ReminderUpdateV1 = ReminderCreateV1.omit({ device_id: true }).partial().extend({ expected_version: z.number().int().min(1) }).strict();

export const AlertActionV1 = z
  .object({
    action: z.enum(["acknowledge", "start", "resolve"]),
    expected_version: z.number().int().min(1),
    review_outcome: z.enum(["confirmed", "false_alarm", "uncertain"]).nullable(),
    note: z.string().max(1000).nullable(),
  })
  .strict();

export const DecisionReviewV1 = z
  .object({
    verification: z.enum(["verified", "dismissed"]),
    note: z.string().min(1).max(1000),
  })
  .strict();

export const CommandCreateV1 = z
  .object({
    command_type: z.literal("play_voice_message"),
    voice_message_id: z.string().min(1).max(80),
    idempotency_key: z.string().min(8).max(128),
    expires_in_seconds: z.number().int().min(30).max(3600),
  })
  .strict();

/** Account identifier of the web sign-in: an e-mail address or a plain user name (letters, digits and . _ @ + -), case-insensitive. */
export const LoginId = z.string().trim().toLowerCase().min(3).max(254).regex(/^[a-z0-9._@+-]+$/);

/** `username` is the current field; `email` is the earlier name of the same field and stays accepted. */
export const LoginRequestV1 = z
  .object({
    username: LoginId.optional(),
    email: LoginId.optional(),
    password: z.string().min(1).max(128),
  })
  .strict()
  .refine((body) => (body.username ?? body.email) !== undefined, { message: "username is required", path: ["username"] });

export const StreamTicketRequestV1 = z.object({ recipient_id: RecordId }).strict();

/** Every contract published under contracts/carelens/. */
export const PUBLISHED_CONTRACTS = {
  "capture-session.v2": CaptureSessionV2,
  "imu-batch.v1": ImuBatchV1,
  "imu-event.v2": ImuEventV2,
  "device-heartbeat.v2": DeviceHeartbeatV2,
  "command-status.v2": CommandStatusV2,
  "vision-result.v1": VisionResultV1,
  "daily-report-llm.v1": DailyReportLlmV1,
  "daily-report-result.v1": DailyReportResultV1,
} as const;
