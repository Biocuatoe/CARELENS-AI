/**
 * care-monitoring: CareLens AI cloud backend on Cloudflare Workers (D1 + R2 + one Durable Object class).
 *
 *   /health, /ready                          liveness; readiness with honest capability report
 *   /api/device/v1/*                         ESP32 (device bearer): captures, raw IMU batches, triggers, commands, heartbeat
 *   /api/agent/v1/*                          Local AI Agent (agent bearer): job claim/lease/media/complete, hint stream
 *   /api/app/v1/session, stream-tickets      web sign-in (owner-issued credential or Google) and single-use stream tickets
 *   /api/app/v1/*                            caregivers and viewers (bearer + per-recipient grants)
 *   /api/admin/v1/*                          provisioning and operations status (admin bearer)
 *   /api/demo/stream|state|command           adapter for the frontend's Live Demo (ticket or dev allowlist)
 *
 * Inference never runs here: the agent on the home PC pulls jobs over outbound HTTPS.
 */
import * as admin from "./admin";
import * as comms from "./adminComms";
import * as ops from "./adminOps";
import * as alerts from "./alerts";
import * as app from "./app";
import * as captures from "./captures";
import * as commands from "./commands";
import { observeClock } from "./clock";
import { adminMe, authenticateAdmin, exchangeAdminSession, logoutAdmin } from "./adminAuth";
import { authenticateAgent, authenticateCaregiver, authenticateDevice, type Ctx } from "./context";
import { DeviceHeartbeatV2 } from "./contracts";
import { ConfigError, loadConfig, type Env } from "./env";
import { HttpError, corsHeaders, forbidden, json, notFound, problem, readJson, withHeaders } from "./http";
import { ingestImuBatch, ingestImuEvent, listImu } from "./imu";
import * as jobs from "./jobs";
import * as google from "./google";
import * as legacy from "./legacy";
import { DAILY_REPORT_CRON, runMaintenance } from "./maintenance";
import * as reminders from "./reminders";
import * as reports from "./reports";
import * as session from "./session";
import { iso, systemClock, type Clock } from "./util";
import * as voice from "./voice";

export { RealtimeHub } from "./realtime";

type Handler = (ctx: Ctx, params: string[], cors: Record<string, string>) => Promise<Response>;
interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const SEG = "([A-Za-z0-9._:-]{1,128})";
const routes: Route[] = [];
function route(method: string, path: string, handler: Handler): void {
  routes.push({ method, pattern: new RegExp(`^${path.replaceAll(":id", SEG)}$`), handler });
}

/* ---------------- health */
route("GET", "/health", async () => json({ status: "ok", service: "care-monitoring" }));
route("GET", "/ready", async (ctx) => readiness(ctx));

/* ---------------- legacy adapter for the protected frontend */
route("GET", "/api/demo/stream", (ctx, _p, cors) => legacy.legacyStream(ctx, cors));
route("GET", "/api/demo/state", (ctx) => legacy.legacyState(ctx));
route("POST", "/api/demo/command", async () => legacy.legacyCommand());

/* ---------------- device */
const device = (fn: (ctx: Ctx, d: Awaited<ReturnType<typeof authenticateDevice>>, p: string[]) => Promise<Response>): Handler => async (ctx, p) =>
  fn(ctx, await authenticateDevice(ctx), p);
route("POST", "/api/device/v1/heartbeat", device(async (ctx, d) => {
  const body = await readJson(ctx.request, DeviceHeartbeatV2, 4 * 1024);
  if (body.device_id !== d.deviceId) throw forbidden("device_mismatch", "device_id does not match the credential.");
  const boot = await observeClock(ctx, d.deviceId, body.clock);
  // A heartbeat from a new boot settles the commands the device held before it restarted (ADR-022).
  await commands.settleRebootedCommands(ctx, d.deviceId, body.clock.boot_id, null);
  const now = iso(ctx.clock.now());
  const [, pending, settings] = await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `UPDATE devices SET firmware_version = COALESCE(?1, firmware_version), last_boot_id = ?2, last_heartbeat_at = ?3, last_heartbeat_json = ?4 WHERE device_id = ?5`,
    ).bind(body.firmware_version, body.clock.boot_id, now, JSON.stringify({ ...body.status, clock_issues: boot.issues }), d.deviceId),
    ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM device_commands WHERE device_id = ?1 AND status = 'queued' AND not_before <= ?2 AND expires_at > ?2`).bind(d.deviceId, now),
    ctx.env.DB.prepare(`SELECT speaker_volume FROM devices WHERE device_id = ?1`).bind(d.deviceId),
  ]);
  return json({
    server_time: now,
    pending_commands: (pending?.results?.[0] as { n: number } | undefined)?.n ?? 0,
    clock: { boot_id: boot.bootId, estimated_boot_epoch: iso(new Date(boot.epochMs)), issues: boot.issues },
    // Settings the admin chose for this device; null = keep the device's own value. The device reports what it applied.
    config: {
      speaker_volume: (settings?.results?.[0] as { speaker_volume: number | null } | undefined)?.speaker_volume ?? null,
      // ADR-025: ask the firmware to list the codecs it plays (status.audio_codecs). Firmware that does not know the flag
      // ignores it and is treated as WAV-only.
      report_audio_codecs: true,
    },
  });
}));
route("POST", "/api/device/v1/captures", device((ctx, d) => captures.createCapture(ctx, d)));
route("GET", "/api/device/v1/captures/:id", device((ctx, d, p) => captures.getCapture(ctx, d, p[0] as string)));
route("PUT", "/api/device/v1/captures/:id/chunks/(\\d{1,2})", device((ctx, d, p) => captures.uploadChunk(ctx, d, p[0] as string, p[1] as string)));
route("POST", "/api/device/v1/captures/:id/complete", device((ctx, d, p) => captures.completeCapture(ctx, d, p[0] as string)));
route("POST", "/api/device/v1/imu-batches", device((ctx, d) => ingestImuBatch(ctx, d)));
route("POST", "/api/device/v1/imu-events", device((ctx, d) => ingestImuEvent(ctx, d)));
route("GET", "/api/device/v1/commands/next", device((ctx, d) => commands.deviceNextCommand(ctx, d)));
route("POST", "/api/device/v1/commands/:id/status", device((ctx, d, p) => commands.deviceCommandStatus(ctx, d, p[0] as string)));
route("GET", "/api/device/v1/commands/:id/audio", device((ctx, d, p) => commands.deviceCommandAudio(ctx, d, p[0] as string)));

/* ---------------- local agent */
const agent = (fn: (ctx: Ctx, a: Awaited<ReturnType<typeof authenticateAgent>>, p: string[]) => Promise<Response>): Handler => async (ctx, p) =>
  fn(ctx, await authenticateAgent(ctx), p);
route("POST", "/api/agent/v1/heartbeat", agent(async (ctx, a) => {
  const raw = await ctx.request.text();
  if (raw.length > 4096) throw new HttpError(413, "payload_too_large", "Payload too large", "Heartbeat must be under 4 KB.");
  await ctx.env.DB.prepare(`UPDATE agents SET last_seen_at = ?1, last_reported_json = ?2 WHERE agent_id = ?3`).bind(iso(ctx.clock.now()), raw || null, a.agentId).run();
  return json({ server_time: iso(ctx.clock.now()) });
}));
route("POST", "/api/agent/v1/jobs/claim", agent((ctx, a) => jobs.claimJob(ctx, a)));
route("GET", "/api/agent/v1/jobs/:id/media/(\\d{1,2})", agent((ctx, a, p) => jobs.jobMedia(ctx, a, p[0] as string, p[1] as string)));
route("POST", "/api/agent/v1/jobs/:id/lease", agent((ctx, a, p) => jobs.renewLease(ctx, a, p[0] as string)));
route("POST", "/api/agent/v1/jobs/:id/release", agent((ctx, a, p) => jobs.releaseJob(ctx, a, p[0] as string)));
route("POST", "/api/agent/v1/jobs/:id/complete", agent((ctx, a, p) => jobs.completeJob(ctx, a, p[0] as string)));
route("POST", "/api/agent/v1/jobs/:id/fail", agent((ctx, a, p) => jobs.failJob(ctx, a, p[0] as string)));
route("GET", "/api/agent/v1/events", agent((ctx) => app.agentStream(ctx)));

/* ---------------- caregivers */
const user = (fn: (ctx: Ctx, u: Awaited<ReturnType<typeof authenticateCaregiver>>, p: string[], cors: Record<string, string>) => Promise<Response>): Handler => async (
  ctx,
  p,
  cors,
) => fn(ctx, await authenticateCaregiver(ctx), p, cors);
const R = "/api/app/v1/recipients/:id";
route("POST", "/api/app/v1/session", (ctx) => session.login(ctx));
route("DELETE", "/api/app/v1/session", user((ctx, u) => session.logout(ctx, u)));
route("POST", "/api/app/v1/session/exchange", (ctx) => google.exchangeSession(ctx));
route("GET", "/api/app/v1/auth/google/config", (ctx) => google.googleConfig(ctx));
route("GET", "/api/app/v1/auth/google/start", (ctx) => google.googleStart(ctx));
route("GET", "/api/app/v1/auth/google/callback", (ctx) => google.googleCallback(ctx));
route("POST", "/api/app/v1/stream-tickets", user((ctx, u) => session.createStreamTicket(ctx, u)));
route("GET", "/api/app/v1/me", user((ctx, u) => app.me(ctx, u)));
route("GET", `${R}/events`, user((ctx, u, p) => app.listEvents(ctx, u, p[0] as string)));
route("GET", `${R}/devices`, user((ctx, u, p) => app.listDevices(ctx, u, p[0] as string)));
route("GET", `${R}/imu-samples`, user((ctx, u, p) => listImu(ctx, u, p[0] as string)));
route("GET", `${R}/stream`, user((ctx, u, p, cors) => app.recipientStream(ctx, u, p[0] as string, cors)));
route("GET", `${R}/fusion-decisions`, user((ctx, u, p) => alerts.listDecisions(ctx, u, p[0] as string)));
route("POST", `${R}/fusion-decisions/:id/review`, user((ctx, u, p) => alerts.reviewDecision(ctx, u, p[0] as string, p[1] as string)));
route("GET", `${R}/alerts`, user((ctx, u, p) => alerts.listAlerts(ctx, u, p[0] as string)));
route("GET", `${R}/alerts/:id`, user((ctx, u, p) => alerts.getAlert(ctx, u, p[0] as string, p[1] as string)));
route("POST", `${R}/alerts/:id/actions`, user((ctx, u, p) => alerts.actOnAlert(ctx, u, p[0] as string, p[1] as string)));
route("GET", `${R}/daily-reports`, user((ctx, u, p) => reports.listReports(ctx, u, p[0] as string)));
route("GET", `${R}/daily-reports/(\\d{4}-\\d{2}-\\d{2})`, user((ctx, u, p) => reports.getReport(ctx, u, p[0] as string, p[1] as string)));
route("GET", `${R}/reminders`, user((ctx, u, p) => reminders.listReminders(ctx, u, p[0] as string)));
route("POST", `${R}/reminders`, user((ctx, u, p) => reminders.createReminder(ctx, u, p[0] as string)));
route("PATCH", `${R}/reminders/:id`, user((ctx, u, p) => reminders.updateReminder(ctx, u, p[0] as string, p[1] as string)));
route("DELETE", `${R}/reminders/:id`, user((ctx, u, p) => reminders.cancelReminder(ctx, u, p[0] as string, p[1] as string)));
route("GET", `${R}/voice-messages`, user((ctx, u, p) => voice.listVoice(ctx, u, p[0] as string)));
route("POST", `${R}/voice-messages`, user((ctx, u, p) => voice.uploadVoice(ctx, u, p[0] as string)));
route("GET", `${R}/voice-messages/:id/audio`, user((ctx, u, p) => voice.getVoiceAudio(ctx, u, p[0] as string, p[1] as string)));
route("PUT", `${R}/voice-messages/:id/audio`, user((ctx, u, p) => voice.replaceVoice(ctx, u, p[0] as string, p[1] as string)));
route("DELETE", `${R}/voice-messages/:id`, user((ctx, u, p) => voice.deleteVoice(ctx, u, p[0] as string, p[1] as string)));
route("GET", `${R}/devices/:id/commands`, user((ctx, u, p) => commands.caregiverListCommands(ctx, u, p[0] as string, p[1] as string)));
route("POST", `${R}/devices/:id/commands`, user((ctx, u, p) => commands.caregiverCreateCommand(ctx, u, p[0] as string, p[1] as string)));
route("GET", `${R}/commands/:id`, user((ctx, u, p) => commands.caregiverCommandTimeline(ctx, u, p[0] as string, p[1] as string)));
route("POST", `${R}/commands/:id/cancel`, user((ctx, u, p) => commands.caregiverCancelCommand(ctx, u, p[0] as string, p[1] as string)));

/* ---------------- admin */
const adminOnly = (fn: (ctx: Ctx, p: string[]) => Promise<Response>): Handler => async (ctx, p) => {
  await authenticateAdmin(ctx); // also sets ctx.admin, which attributes the audit entries of this request
  return fn(ctx, p);
};
// Sign-in for the admin API: the single-use code from the Google callback (GET /api/app/v1/auth/google/start?mode=admin) becomes a session.
route("POST", "/api/admin/v1/session/exchange", (ctx) => exchangeAdminSession(ctx));
route("DELETE", "/api/admin/v1/session", async (ctx) => logoutAdmin(ctx, await authenticateAdmin(ctx)));
route("GET", "/api/admin/v1/me", async (ctx) => adminMe(await authenticateAdmin(ctx)));
route("POST", "/api/admin/v1/recipients", adminOnly((ctx) => admin.createRecipient(ctx)));
route("GET", "/api/admin/v1/recipients", adminOnly((ctx) => admin.listRecipients(ctx)));
route("POST", "/api/admin/v1/devices", adminOnly((ctx) => admin.createDevice(ctx)));
route("POST", "/api/admin/v1/devices/:id/rotate-token", adminOnly((ctx, p) => admin.rotateDeviceToken(ctx, p[0] as string)));
route("POST", "/api/admin/v1/devices/:id/revoke", adminOnly((ctx, p) => admin.revokeDevice(ctx, p[0] as string)));
route("POST", "/api/admin/v1/agents", adminOnly((ctx) => admin.createAgent(ctx)));
route("POST", "/api/admin/v1/agents/:id/revoke", adminOnly((ctx, p) => admin.revokeAgent(ctx, p[0] as string)));
route("POST", "/api/admin/v1/caregivers", adminOnly((ctx) => admin.createCaregiver(ctx)));
route("POST", "/api/admin/v1/caregivers/:id/login", adminOnly((ctx, p) => admin.setLoginCredential(ctx, p[0] as string)));
route("POST", "/api/admin/v1/caregivers/:id/google", adminOnly((ctx, p) => admin.authorizeGoogleIdentity(ctx, p[0] as string)));
route("POST", "/api/admin/v1/google/revoke", adminOnly((ctx) => admin.revokeGoogleIdentity(ctx)));
route("POST", "/api/admin/v1/caregiver-tokens/:id/revoke", adminOnly((ctx, p) => admin.revokeCaregiverToken(ctx, p[0] as string)));
route("POST", "/api/admin/v1/grants", adminOnly((ctx) => admin.createGrant(ctx)));
route("POST", "/api/admin/v1/grants/:id/revoke", adminOnly((ctx, p) => admin.revokeGrant(ctx, p[0] as string)));
route("POST", "/api/admin/v1/daily-reports/:id/retry", adminOnly((ctx, p) => admin.retryReport(ctx, p[0] as string)));
route("GET", "/api/admin/v1/status", adminOnly((ctx) => admin.opsStatus(ctx)));
// Dashboard reads and device messaging (docs/API_CONTRACT.md "Admin dashboard"). Reuses the device protocol; no new device route.
route("GET", "/api/admin/v1/capabilities", adminOnly(async (ctx) => comms.capabilities(ctx)));
route("GET", "/api/admin/v1/devices", adminOnly((ctx) => ops.listDevices(ctx)));
route("GET", "/api/admin/v1/devices/:id", adminOnly((ctx, p) => ops.getDevice(ctx, p[0] as string)));
route("GET", "/api/admin/v1/devices/:id/activity", adminOnly((ctx, p) => ops.deviceActivity(ctx, p[0] as string)));
route("GET", "/api/admin/v1/devices/:id/voice-messages", adminOnly((ctx, p) => comms.adminListVoice(ctx, p[0] as string)));
route("POST", "/api/admin/v1/devices/:id/voice-messages", adminOnly((ctx, p) => comms.adminUploadVoice(ctx, p[0] as string)));
route("GET", "/api/admin/v1/voice-messages/:id/audio", adminOnly((ctx, p) => comms.adminVoiceAudio(ctx, p[0] as string)));
route("POST", "/api/admin/v1/devices/:id/voice-commands", adminOnly((ctx, p) => comms.adminCreateVoiceCommand(ctx, p[0] as string)));
route("PUT", "/api/admin/v1/devices/:id/speaker-volume", adminOnly((ctx, p) => comms.adminSetSpeakerVolume(ctx, p[0] as string)));
route("GET", "/api/admin/v1/devices/:id/commands", adminOnly((ctx, p) => comms.adminListCommands(ctx, p[0] as string)));
route("GET", "/api/admin/v1/commands/:id", adminOnly((ctx, p) => comms.adminCommandTimeline(ctx, p[0] as string)));
route("POST", "/api/admin/v1/commands/:id/cancel", adminOnly((ctx, p) => comms.adminCancelCommand(ctx, p[0] as string)));
route("GET", "/api/admin/v1/devices/:id/reminders", adminOnly((ctx, p) => comms.adminListReminders(ctx, p[0] as string)));
route("POST", "/api/admin/v1/devices/:id/reminders", adminOnly((ctx, p) => comms.adminCreateReminder(ctx, p[0] as string)));
route("POST", "/api/admin/v1/reminders/:id/(pause|resume|cancel)", adminOnly((ctx, p) => comms.adminChangeReminder(ctx, p[0] as string, p[1] as "pause" | "resume" | "cancel")));
route("GET", "/api/admin/v1/audit", adminOnly((ctx) => ops.listAudit(ctx)));

async function readiness(ctx: Ctx): Promise<Response> {
  const checks: Record<string, string> = {};
  try {
    const row = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM d1_migrations`).first<{ n: number }>();
    checks.d1 = row && row.n > 0 ? "ok" : "migrations_missing";
  } catch {
    checks.d1 = "unavailable_or_migrations_missing";
  }
  checks.media_bucket = ctx.env.MEDIA ? "bound" : "missing";
  checks.audio_bucket = ctx.env.AUDIO ? "bound" : "missing";
  checks.realtime = ctx.env.REALTIME ? "bound" : "missing";
  const ready = checks.d1 === "ok" && Object.values(checks).every((v) => v === "ok" || v === "bound");
  const policy = ctx.config.fusionPolicy;
  const vRule = policy.vision_candidate_rule;
  const iRule = policy.imu_candidate_rule;
  return json(
    {
      status: ready ? "ready" : "not_ready",
      checks,
      capabilities: {
        admin_api: ctx.config.adminTokenSha256 ? "configured" : "not_configured",
        admin_signin: ctx.config.adminConfigError ? "misconfigured" : ctx.config.adminBootstrapEmails.length > 0 ? "configured" : "not_configured",
        google_signin: ctx.config.google ? "configured" : ctx.config.googleConfigError ? "misconfigured" : "not_configured",
        google_access: ctx.config.google ? (ctx.config.google.openViewerRecipientId ? "open_viewer_read_only" : "allowlist") : "none",
        password_sign_in: ctx.config.passwordSignIn ? "enabled" : "disabled",
        vision_fall_rule: vRule ? `${vRule.rule_version}:${vRule.calibration}` : "not_configured_model_not_calibrated",
        imu_fall_rule: iRule ? `${iRule.rule_version}:${iRule.calibration}` : "not_configured",
        alerts: vRule && iRule ? "provisional_suspected_fall_needs_aligned_vision_and_raw_imu" : "none_until_both_rules_are_approved",
        single_source_alerts: "never",
        web_sign_in: "owner_issued_credentials",
        legacy_stream_access: ctx.config.legacyStreamRecipientId && ctx.config.legacyStreamAllowedCidrs.length ? "stream_ticket_or_dev_ip_allowlist" : "stream_ticket",
        cors_origins: ctx.config.allowedOrigins.length,
        simulated_sources: ctx.config.acceptSimulatedSources ? "accepted" : "rejected",
        device_audio_sample_rates_hz: ctx.config.deviceAudioSampleRates,
        imu_raw_retention_hours: ctx.config.imuRawRetentionHours,
        esp32_firmware: "not_verified_with_hardware",
      },
      fusion_policy_version: ctx.config.fusionPolicy.policy_version,
      report_schedule: { timezone: ctx.config.reportTimezone, local_time: `${String(ctx.config.dailyReportLocalTime.hour).padStart(2, "0")}:${String(ctx.config.dailyReportLocalTime.minute).padStart(2, "0")}` },
    },
    ready ? 200 : 503,
  );
}

export interface AppOptions {
  clock?: Clock;
  /** Replaces the global fetch for calls to Google (tests only). */
  outboundFetch?: typeof fetch;
}

export function createApp(options: AppOptions = {}) {
  const clock = options.clock ?? systemClock;

  async function fetch(request: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const requestId = crypto.randomUUID().replaceAll("-", "");
    const url = new URL(request.url);
    let cors: Record<string, string> = {};
    try {
      const config = loadConfig(env);
      cors = corsHeaders(request.headers.get("origin"), config.allowedOrigins);
      if (request.method === "OPTIONS") return new Response(null, { status: cors["access-control-allow-origin"] ? 204 : 403, headers: cors });
      const ctx: Ctx = { env, config, clock, requestId, request, url, exec, outboundFetch: options.outboundFetch };
      for (const r of routes) {
        const m = r.pattern.exec(url.pathname);
        if (!m) continue;
        if (r.method !== request.method) continue;
        const response = await r.handler(ctx, m.slice(1), cors);
        return withHeaders(response, { ...cors, "x-request-id": requestId });
      }
      const pathMatches = routes.some((r) => r.pattern.test(url.pathname));
      if (pathMatches) throw new HttpError(405, "method_not_allowed", "Method not allowed", `${request.method} is not allowed here.`);
      throw notFound("No such route.");
    } catch (err) {
      if (err instanceof HttpError) return withHeaders(problem(err, requestId), { ...cors, "x-request-id": requestId });
      if (err instanceof ConfigError) {
        console.error(JSON.stringify({ msg: "config_error", request_id: requestId, error: err.message }));
        return withHeaders(problem(new HttpError(503, "misconfigured", "Service misconfigured", err.message), requestId), cors);
      }
      // Never echo internals or request bodies; log the error class and request id only.
      console.error(JSON.stringify({ msg: "unhandled_error", request_id: requestId, path: url.pathname, error: err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "unknown" }));
      return withHeaders(problem(new HttpError(500, "internal_error", "Internal error", "Unexpected server error."), requestId), cors);
    }
  }

  async function scheduled(controller: ScheduledController, env: Env, exec: ExecutionContext): Promise<void> {
    const config = loadConfig(env);
    const ctx: Ctx = {
      env,
      config,
      clock,
      requestId: `cron-${controller.scheduledTime}`,
      request: new Request("https://cron.internal/"),
      url: new URL("https://cron.internal/"),
      exec,
    };
    const daily = controller.cron === DAILY_REPORT_CRON;
    const minute = clock.now().getUTCMinutes();
    const result = await runMaintenance(ctx, { includeReports: daily || minute % 10 === 0 });
    console.log(JSON.stringify({ msg: "cron", cron: controller.cron, ...result }));
  }

  return { fetch, scheduled };
}

const worker = createApp();
export default { fetch: worker.fetch, scheduled: worker.scheduled } satisfies ExportedHandler<Env>;
