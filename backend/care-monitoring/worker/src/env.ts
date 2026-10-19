/**
 * Bindings and configuration. Every value that changes behaviour is read here and validated once per
 * request, so a misconfigured deployment fails loudly (GET /ready reports it) instead of guessing.
 */
import { z } from "zod";
import type { RealtimeHub } from "./realtime";

export interface Env {
  DB: D1Database;
  /** Private bucket for camera chunks. Objects live minutes, never longer than MEDIA_MAX_AGE_SECONDS. */
  MEDIA: R2Bucket;
  /** Private bucket for caregiver-recorded voice messages (retained until deleted by a caregiver). */
  AUDIO: R2Bucket;
  REALTIME: DurableObjectNamespace<RealtimeHub>;
  /** Optional Workers Rate Limiting bindings. Missing binding = no per-location limiter. */
  AUTH_FAILURE_LIMITER?: RateLimit;
  DEVICE_LIMITER?: RateLimit;

  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
  /** SHA-256 hex digest of the admin bearer token (secret). Unset: admin API answers 503. */
  ADMIN_TOKEN_SHA256?: string;
  ACCEPT_SIMULATED_SOURCES?: string;
  MEDIA_MAX_AGE_SECONDS?: string;
  UPLOAD_SESSION_TTL_SECONDS?: string;
  MAX_CAPTURE_AGE_SECONDS?: string;
  FRAMES_PER_CHUNK?: string;
  CADENCE_TOLERANCE_MS?: string;
  MAX_NORMAL_CAPTURES_PER_HOUR?: string;
  MAX_TRIGGERED_CAPTURES_PER_HOUR?: string;
  DEVICE_ONLINE_WINDOW_SECONDS?: string;
  REPORT_TIMEZONE?: string;
  DAILY_REPORT_LOCAL_TIME?: string;
  FUSION_POLICY_JSON?: string;
  LEGACY_STREAM_RECIPIENT_ID?: string;
  LEGACY_STREAM_DEVICE_ID?: string;
  LEGACY_STREAM_ALLOWED_IPS?: string;
  SSE_MAX_LIFETIME_SECONDS?: string;
  EMERGENCY_COMMAND_TTL_SECONDS?: string;
  IMU_RAW_RETENTION_HOURS?: string;
  IMU_MAX_BATCH_AGE_SECONDS?: string;
  IMU_STORAGE_SOFT_LIMIT_MB?: string;
  SESSION_TTL_HOURS?: string;
  LOGIN_PBKDF2_ITERATIONS?: string;
  /** Google sign-in (all four must be set to enable it). GOOGLE_CLIENT_SECRET is a secret: `wrangler secret put`, never a var. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Exact redirect URI registered in Google Cloud Console: <worker origin>/api/app/v1/auth/google/callback. */
  GOOGLE_REDIRECT_URI?: string;
  /** Where the browser returns after Google: the web app's login page. Fixed here, never taken from the request. */
  GOOGLE_POST_LOGIN_URL?: string;
  /** Optional open-viewer mode: any verified Google account becomes a read-only viewer of this one showcase recipient
   * (created empty if missing). Empty = only identities on the owner's allowlist (google_identities) may sign in. */
  GOOGLE_OPEN_VIEWER_RECIPIENT_ID?: string;
  /** "enabled" (default) or "disabled": whether POST /api/app/v1/session accepts owner-issued passwords. */
  PASSWORD_SIGN_IN?: string;
  DEVICE_AUDIO_SAMPLE_RATES?: string;
}

/** A configured rule that turns a fall-check aggregate score into a candidate. There is no default:
 * the shipped model is NOT_CALIBRATED and the backend never invents a threshold (AGENTS.md §6). */
const VisionCandidateRule = z
  .object({
    rule_version: z.string().min(1).max(64),
    model_version: z.string().min(1).max(128),
    capture_modes: z.array(z.enum(["normal", "triggered"])).min(1),
    aggregations: z.array(z.enum(["single_request.v1", "max_request_score_overlapping.v1"])).min(1),
    min_score: z.number().finite(),
    calibration: z.enum(["calibrated", "uncalibrated_trial"]),
    approved_by: z.string().min(1).max(128),
    approved_at: z.string().min(1).max(64),
    evidence_ref: z.string().min(1).max(256),
  })
  .strict();

/** A configured rule over raw accelerometer/gyroscope samples, evaluated by the backend (never by the
 * firmware). Each non-null condition must hold somewhere in the window. No default: there is no validated
 * IMU threshold for this device, its mounting or its wearer. */
const ImuCandidateRule = z
  .object({
    rule_version: z.string().min(1).max(64),
    min_peak_accel_g: z.number().finite().min(0).max(16).nullable(),
    max_min_accel_g: z.number().finite().min(0).max(16).nullable(),
    min_peak_gyro_dps: z.number().finite().min(0).max(2000).nullable(),
    calibration: z.enum(["calibrated", "uncalibrated_trial"]),
    approved_by: z.string().min(1).max(128),
    approved_at: z.string().min(1).max(64),
    evidence_ref: z.string().min(1).max(256),
  })
  .strict()
  .refine((r) => r.min_peak_accel_g !== null || r.max_min_accel_g !== null || r.min_peak_gyro_dps !== null, "at least one condition is required");

/** fusion-rules.v2. Decisions need time-aligned raw IMU and vision evidence from the same device boot.
 * There are no single-source alert switches: an IMU trigger or a vision score alone can never raise an
 * alert. The time and coverage parameters are engineering defaults for data quality, not medical
 * thresholds, and must be validated with recordings from the real device (D11). */
export const FusionPolicySchema = z
  .object({
    policy_version: z.string().min(1).max(64),
    /** A firmware trigger and a burst belong together when linked by id or within this many seconds. */
    correlation_window_seconds: z.number().int().min(1).max(120),
    /** How long a trigger waits for its burst before it is decided with vision missing. */
    imu_decision_grace_seconds: z.number().int().min(10).max(1800),
    /** How long after a burst ends the decision waits for raw IMU batches covering it. */
    imu_wait_seconds: z.number().int().min(5).max(1800),
    /** Raw IMU and vision evidence align when the IMU match lies within the burst ± this tolerance. */
    alignment_tolerance_ms: z.number().int().min(0).max(30_000),
    /** IMU samples are searched this far around the burst to tell "not aligned" from "absent". */
    imu_search_margin_ms: z.number().int().min(0).max(60_000),
    imu_min_coverage_ratio: z.number().min(0.1).max(1),
    imu_max_gap_ms: z.number().int().min(10).max(10_000),
    vision_candidate_rule: VisionCandidateRule.nullable(),
    imu_candidate_rule: ImuCandidateRule.nullable(),
    alert_dedup_window_seconds: z.number().int().min(10).max(3600),
    device_buzzer_on_alert: z.boolean(),
  })
  .strict();
export type FusionPolicy = z.infer<typeof FusionPolicySchema>;
export type VisionCandidateRuleConfig = z.infer<typeof VisionCandidateRule>;
export type ImuCandidateRuleConfig = z.infer<typeof ImuCandidateRule>;

export const DEFAULT_FUSION_POLICY: FusionPolicy = {
  policy_version: "fusion-rules.v2",
  correlation_window_seconds: 10,
  imu_decision_grace_seconds: 120,
  imu_wait_seconds: 60,
  alignment_tolerance_ms: 3000,
  imu_search_margin_ms: 10_000,
  imu_min_coverage_ratio: 0.8,
  imu_max_gap_ms: 500,
  vision_candidate_rule: null,
  imu_candidate_rule: null,
  alert_dedup_window_seconds: 120,
  device_buzzer_on_alert: true,
};

/** WAV sample rates the device firmware is expected to play (DEVICE_AUDIO_SAMPLE_RATES). */
export const SUPPORTED_AUDIO_SAMPLE_RATES = [8000, 16000, 22050, 24000] as const;

export interface Config {
  environment: string;
  allowedOrigins: string[];
  adminTokenSha256: string | null;
  acceptSimulatedSources: boolean;
  mediaMaxAgeSeconds: number;
  uploadSessionTtlSeconds: number;
  maxCaptureAgeSeconds: number;
  framesPerChunk: number;
  cadenceToleranceMs: number;
  maxNormalCapturesPerHour: number;
  maxTriggeredCapturesPerHour: number;
  deviceOnlineWindowSeconds: number;
  reportTimezone: string;
  dailyReportLocalTime: { hour: number; minute: number };
  fusionPolicy: FusionPolicy;
  legacyStreamRecipientId: string | null;
  legacyStreamDeviceId: string | null;
  legacyStreamAllowedCidrs: string[];
  sseMaxLifetimeSeconds: number;
  emergencyCommandTtlSeconds: number;
  imuRawRetentionHours: number;
  imuMaxBatchAgeSeconds: number;
  /** Raw IMU batches are refused (507) while the D1 database is larger than this (MB = 10^6 bytes); 0 refuses all. */
  imuStorageSoftLimitMb: number;
  sessionTtlHours: number;
  /** PBKDF2 iterations for newly stored owner-chosen passwords (existing hashes keep their own count). */
  loginPbkdf2Iterations: number;
  /** null unless client id, secret, redirect URI and post-login URL are all present and well-formed. */
  google: GoogleSettings | null;
  /** Set when the Google settings are half-filled or malformed. Only the Google routes fail on it; the rest of the API is unaffected. */
  googleConfigError: string | null;
  /** false when PASSWORD_SIGN_IN=disabled: owner-issued passwords are refused and the login page hides the form. */
  passwordSignIn: boolean;
  deviceAudioSampleRates: number[];
}

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLoginUrl: string;
  /** Showcase recipient that every verified Google account may read (viewer role only); null = allowlist only. */
  openViewerRecipientId: string | null;
}

export class ConfigError extends Error {}

function int(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be an integer in [${min}, ${max}]`);
  return n;
}

function googleConfig(env: Env): { google: GoogleSettings | null; googleConfigError: string | null } {
  try {
    return { google: googleSettings(env), googleConfigError: null };
  } catch (err) {
    if (err instanceof ConfigError) return { google: null, googleConfigError: err.message };
    throw err;
  }
}

/** Google sign-in is off unless fully configured; a half-configured or malformed setup is reported by the Google routes. */
function googleSettings(env: Env): GoogleSettings | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim() ?? "";
  const postLoginUrl = env.GOOGLE_POST_LOGIN_URL?.trim() ?? "";
  // No client id and no secret = Google sign-in is off (the two URLs alone, e.g. copied from the example file, change nothing).
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret || !redirectUri || !postLoginUrl) throw new ConfigError("Google sign-in needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and GOOGLE_POST_LOGIN_URL together.");
  for (const [name, value] of [["GOOGLE_REDIRECT_URI", redirectUri], ["GOOGLE_POST_LOGIN_URL", postLoginUrl]] as const) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ConfigError(`${name} is not a valid URL.`);
    }
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new ConfigError(`${name} must be https (http only for localhost).`);
    if (url.hash || url.username || url.password) throw new ConfigError(`${name} must not contain credentials or a fragment.`);
  }
  const openViewerRecipientId = env.GOOGLE_OPEN_VIEWER_RECIPIENT_ID?.trim() ?? "";
  if (openViewerRecipientId && !/^[A-Za-z0-9._:-]{3,64}$/.test(openViewerRecipientId)) {
    throw new ConfigError("GOOGLE_OPEN_VIEWER_RECIPIENT_ID must be 3-64 characters of A-Z a-z 0-9 . _ : -");
  }
  return { clientId, clientSecret, redirectUri, postLoginUrl, openViewerRecipientId: openViewerRecipientId || null };
}

function passwordSignIn(value: string | undefined): boolean {
  const v = (value ?? "").trim() || "enabled";
  if (v !== "enabled" && v !== "disabled") throw new ConfigError('PASSWORD_SIGN_IN must be "enabled" or "disabled"');
  return v === "enabled";
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function timezoneOk(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function loadConfig(env: Env): Config {
  const adminDigest = (env.ADMIN_TOKEN_SHA256 ?? "").trim().toLowerCase();
  if (adminDigest && !/^[0-9a-f]{64}$/.test(adminDigest)) throw new ConfigError("ADMIN_TOKEN_SHA256 must be 64 hex characters");

  const reportTimezone = (env.REPORT_TIMEZONE ?? "Asia/Ho_Chi_Minh").trim();
  if (!timezoneOk(reportTimezone)) throw new ConfigError("REPORT_TIMEZONE is not a valid IANA time zone");

  const time = (env.DAILY_REPORT_LOCAL_TIME ?? "00:15").trim();
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) throw new ConfigError("DAILY_REPORT_LOCAL_TIME must be HH:MM");

  let fusionPolicy = DEFAULT_FUSION_POLICY;
  if (env.FUSION_POLICY_JSON && env.FUSION_POLICY_JSON.trim()) {
    let raw: unknown;
    try {
      raw = JSON.parse(env.FUSION_POLICY_JSON);
    } catch {
      throw new ConfigError("FUSION_POLICY_JSON is not valid JSON");
    }
    const parsed = FusionPolicySchema.safeParse(raw);
    if (!parsed.success) throw new ConfigError(`FUSION_POLICY_JSON invalid: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    fusionPolicy = parsed.data;
  }

  const cidrs = list(env.LEGACY_STREAM_ALLOWED_IPS);
  for (const c of cidrs) if (!parseCidr(c)) throw new ConfigError(`LEGACY_STREAM_ALLOWED_IPS has an invalid entry: ${c}`);

  const rates = list(env.DEVICE_AUDIO_SAMPLE_RATES || "16000").map(Number);
  if (rates.length === 0 || rates.some((r) => !(SUPPORTED_AUDIO_SAMPLE_RATES as readonly number[]).includes(r))) {
    throw new ConfigError(`DEVICE_AUDIO_SAMPLE_RATES must list values from ${SUPPORTED_AUDIO_SAMPLE_RATES.join(", ")}`);
  }

  return {
    environment: (env.ENVIRONMENT ?? "production").trim(),
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    adminTokenSha256: adminDigest || null,
    acceptSimulatedSources: (env.ACCEPT_SIMULATED_SOURCES ?? "false").trim() === "true",
    mediaMaxAgeSeconds: int(env.MEDIA_MAX_AGE_SECONDS, 900, 60, 3600, "MEDIA_MAX_AGE_SECONDS"),
    uploadSessionTtlSeconds: int(env.UPLOAD_SESSION_TTL_SECONDS, 120, 15, 900, "UPLOAD_SESSION_TTL_SECONDS"),
    maxCaptureAgeSeconds: int(env.MAX_CAPTURE_AGE_SECONDS, 600, 30, 3600, "MAX_CAPTURE_AGE_SECONDS"),
    // ≥ 2 keeps a 40-frame capture at ≤ 20 chunks, inside the 31-bit chunk bitmask.
    framesPerChunk: int(env.FRAMES_PER_CHUNK, 8, 2, 24, "FRAMES_PER_CHUNK"),
    cadenceToleranceMs: int(env.CADENCE_TOLERANCE_MS, 40, 0, 120, "CADENCE_TOLERANCE_MS"),
    maxNormalCapturesPerHour: int(env.MAX_NORMAL_CAPTURES_PER_HOUR, 60, 0, 3600, "MAX_NORMAL_CAPTURES_PER_HOUR"),
    maxTriggeredCapturesPerHour: int(env.MAX_TRIGGERED_CAPTURES_PER_HOUR, 20, 0, 3600, "MAX_TRIGGERED_CAPTURES_PER_HOUR"),
    deviceOnlineWindowSeconds: int(env.DEVICE_ONLINE_WINDOW_SECONDS, 180, 30, 3600, "DEVICE_ONLINE_WINDOW_SECONDS"),
    reportTimezone,
    dailyReportLocalTime: { hour: Number(m[1]), minute: Number(m[2]) },
    fusionPolicy,
    legacyStreamRecipientId: (env.LEGACY_STREAM_RECIPIENT_ID ?? "").trim() || null,
    legacyStreamDeviceId: (env.LEGACY_STREAM_DEVICE_ID ?? "").trim() || null,
    legacyStreamAllowedCidrs: cidrs,
    sseMaxLifetimeSeconds: int(env.SSE_MAX_LIFETIME_SECONDS, 300, 30, 3600, "SSE_MAX_LIFETIME_SECONDS"),
    emergencyCommandTtlSeconds: int(env.EMERGENCY_COMMAND_TTL_SECONDS, 300, 30, 3600, "EMERGENCY_COMMAND_TTL_SECONDS"),
    imuRawRetentionHours: int(env.IMU_RAW_RETENTION_HOURS, 72, 1, 720, "IMU_RAW_RETENTION_HOURS"),
    imuMaxBatchAgeSeconds: int(env.IMU_MAX_BATCH_AGE_SECONDS, 3600, 60, 86_400, "IMU_MAX_BATCH_AGE_SECONDS"),
    // 400 leaves 100 MB of the Workers Free 500 MB D1 database for events, decisions, alerts and commands.
    imuStorageSoftLimitMb: int(env.IMU_STORAGE_SOFT_LIMIT_MB, 400, 0, 10_000, "IMU_STORAGE_SOFT_LIMIT_MB"),
    sessionTtlHours: int(env.SESSION_TTL_HOURS, 12, 1, 168, "SESSION_TTL_HOURS"),
    loginPbkdf2Iterations: int(env.LOGIN_PBKDF2_ITERATIONS, 100_000, 1_000, 100_000, "LOGIN_PBKDF2_ITERATIONS"),
    ...googleConfig(env),
    passwordSignIn: passwordSignIn(env.PASSWORD_SIGN_IN),
    deviceAudioSampleRates: [...new Set(rates)].sort((a, b) => a - b),
  };
}

/** IPv4/IPv6 CIDR parsing for the legacy stream allowlist. Returns null when malformed. */
export function parseCidr(cidr: string): { bytes: Uint8Array; prefix: number } | null {
  const [addr, prefixText] = cidr.split("/");
  const bytes = parseIp(addr ?? "");
  if (!bytes) return null;
  const maxPrefix = bytes.length * 8;
  const prefix = prefixText === undefined ? maxPrefix : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return null;
  return { bytes, prefix };
}

export function parseIp(text: string): Uint8Array | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
    const parts = text.split(".").map(Number);
    if (parts.some((p) => p > 255)) return null;
    return Uint8Array.from(parts);
  }
  if (!text.includes(":")) return null;
  const [head, tail, extra] = text.split("::");
  if (extra !== undefined) return null;
  const groups = (s: string | undefined) => (s ? s.split(":") : []);
  const h = groups(head);
  const t = groups(tail);
  const missing = 8 - h.length - t.length;
  if ((tail === undefined && missing !== 0) || missing < 0) return null;
  const all = [...h, ...Array(tail === undefined ? 0 : missing).fill("0"), ...t];
  if (all.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = all[i] ?? "";
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 0xff;
  }
  return out;
}

export function ipInCidrs(ip: string, cidrs: string[]): boolean {
  const addr = parseIp(ip);
  if (!addr) return false;
  for (const c of cidrs) {
    const parsed = parseCidr(c);
    if (!parsed || parsed.bytes.length !== addr.length) continue;
    let ok = true;
    for (let bit = 0; bit < parsed.prefix; bit++) {
      const byte = bit >> 3;
      const mask = 0x80 >> (bit & 7);
      if (((addr[byte] ?? 0) & mask) !== ((parsed.bytes[byte] ?? 0) & mask)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}
