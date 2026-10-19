/**
 * Test harness. Everything here is synthetic and test-only: identifiers are obviously fake, images are
 * uniform gray JPEGs, sensor values carry no clinical meaning. Production code never imports this file.
 */
import { applyD1Migrations, createExecutionContext, createScheduledController, reset, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { createApp, type AppOptions } from "../src/index";
import type { Env } from "../src/env";
import type { ImuSample } from "../src/fusion";
import { GRAY_320x240_B64 } from "./jpeg-fixtures";

export const ADMIN_TOKEN = "test-admin-token-0123456789abcdef";

/** Synthetic device boot: uptime 0 happened at BOOT_EPOCH. Requests built "now" carry uptime = now − epoch,
 * so the backend's epoch estimate (min of receive time − uptime) equals BOOT_EPOCH exactly in tests. */
export const TEST_BOOT = "boot-test-0001";
export const BOOT_EPOCH = Date.parse("2026-10-10T00:00:00.000Z");

export function uptimeOf(isoOrMs: string | number, epoch = BOOT_EPOCH): number {
  return (typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs)) - epoch;
}

export function deviceClock(h: { clock: { t: number } }, bootId = TEST_BOOT, epoch = BOOT_EPOCH): Record<string, unknown> {
  return { boot_id: bootId, uptime_ms: h.clock.t - epoch, wall_clock_synced: false, wall_time: null };
}

/** Controllable clock shared by the app instance under test. */
export class TestClock {
  constructor(public t: number = Date.parse("2026-10-19T03:00:00.000Z")) {}
  now(): Date {
    return new Date(this.t);
  }
  set(iso: string): void {
    this.t = Date.parse(iso);
  }
  advance(seconds: number): void {
    this.t += seconds * 1000;
  }
}

export interface Harness {
  clock: TestClock;
  env: Env;
  call(method: string, path: string, opts?: CallOptions): Promise<Response>;
  cron(cron: string): Promise<void>;
}

export interface CallOptions {
  token?: string | null;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  ip?: string;
  envOverrides?: Partial<Env>;
}

export async function freshDb(): Promise<void> {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

export function harness(clock = new TestClock(), overrides: Partial<Env> = {}, appOptions: Omit<AppOptions, "clock"> = {}): Harness {
  const app = createApp({ clock, ...appOptions });
  const baseEnv = { ...(env as unknown as Env), ...overrides };
  return {
    clock,
    env: baseEnv,
    async call(method, path, opts = {}) {
      const headers: Record<string, string> = { "cf-connecting-ip": opts.ip ?? "203.0.113.10", ...(opts.headers ?? {}) };
      if (opts.token) headers.authorization = `Bearer ${opts.token}`;
      let body = opts.body;
      if (opts.json !== undefined) {
        body = JSON.stringify(opts.json);
        headers["content-type"] = headers["content-type"] ?? "application/json";
      }
      const ctx = createExecutionContext();
      const res = await app.fetch(new Request(`https://cm.test${path}`, { method, headers, body }), { ...baseEnv, ...(opts.envOverrides ?? {}) }, ctx);
      if (!(res.headers.get("content-type") ?? "").startsWith("text/event-stream")) await waitOnExecutionContext(ctx);
      return res;
    },
    async cron(cronExpr) {
      const ctx = createExecutionContext();
      await app.scheduled(createScheduledController({ cron: cronExpr, scheduledTime: clock.t }), baseEnv, ctx);
      await waitOnExecutionContext(ctx);
    },
  };
}

export async function ok<T = Record<string, unknown>>(res: Response, status?: number): Promise<T> {
  const text = await res.text();
  if (status !== undefined ? res.status !== status : res.status >= 400) {
    throw new Error(`unexpected ${res.status}: ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function problemCode(res: Response): Promise<string> {
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  const body = (await res.json()) as { code: string; request_id: string };
  expect(body.request_id).toBeTruthy();
  return body.code;
}

export interface World {
  recipientId: string;
  otherRecipientId: string;
  deviceId: string;
  deviceToken: string;
  otherDeviceToken: string;
  agentToken: string;
  caregiverToken: string;
  viewerToken: string;
  outsiderToken: string;
  caregiverId: string;
  viewerUserId: string;
  grantId: string;
}

let worldCounter = 0;

/** Provisions two recipients, a device each, an agent, a caregiver (grant on recipient A), a viewer
 * (read-only grant on A) and an outsider (grant on B only), all through the admin API. */
export async function provision(h: Harness): Promise<World> {
  const n = ++worldCounter;
  const admin = { token: ADMIN_TOKEN };
  const a = await ok<{ recipient_id: string }>(await h.call("POST", "/api/admin/v1/recipients", { ...admin, json: { recipient_id: `rcp-test-a${n}`, display_label: "Hồ sơ thử A", timezone: "Asia/Ho_Chi_Minh" } }), 201);
  const b = await ok<{ recipient_id: string }>(await h.call("POST", "/api/admin/v1/recipients", { ...admin, json: { recipient_id: `rcp-test-b${n}`, display_label: "Hồ sơ thử B", timezone: "Asia/Ho_Chi_Minh" } }), 201);
  const dev = await ok<{ token: string }>(await h.call("POST", "/api/admin/v1/devices", { ...admin, json: { device_id: `esp32-test-a${n}`, recipient_id: a.recipient_id, label: "Thiết bị thử A" } }), 201);
  const devB = await ok<{ token: string }>(await h.call("POST", "/api/admin/v1/devices", { ...admin, json: { device_id: `esp32-test-b${n}`, recipient_id: b.recipient_id, label: "Thiết bị thử B" } }), 201);
  const agent = await ok<{ token: string }>(await h.call("POST", "/api/admin/v1/agents", { ...admin, json: { label: "agent thử" } }), 201);
  const cg = await ok<{ user_id: string; token: string }>(await h.call("POST", "/api/admin/v1/caregivers", { ...admin, json: { display_name: "Người chăm sóc thử", token_expires_in_days: null } }), 201);
  const viewer = await ok<{ user_id: string; token: string }>(await h.call("POST", "/api/admin/v1/caregivers", { ...admin, json: { display_name: "Người xem thử", token_expires_in_days: null } }), 201);
  const outsider = await ok<{ user_id: string; token: string }>(await h.call("POST", "/api/admin/v1/caregivers", { ...admin, json: { display_name: "Người ngoài thử", token_expires_in_days: null } }), 201);
  const grant = await ok<{ grant_id: string }>(await h.call("POST", "/api/admin/v1/grants", { ...admin, json: { user_id: cg.user_id, recipient_id: a.recipient_id, role: "caregiver" } }), 201);
  await ok(await h.call("POST", "/api/admin/v1/grants", { ...admin, json: { user_id: viewer.user_id, recipient_id: a.recipient_id, role: "viewer" } }), 201);
  await ok(await h.call("POST", "/api/admin/v1/grants", { ...admin, json: { user_id: outsider.user_id, recipient_id: b.recipient_id, role: "caregiver" } }), 201);
  return {
    recipientId: a.recipient_id,
    otherRecipientId: b.recipient_id,
    deviceId: `esp32-test-a${n}`,
    deviceToken: dev.token,
    otherDeviceToken: devB.token,
    agentToken: agent.token,
    caregiverToken: cg.token,
    viewerToken: viewer.token,
    outsiderToken: outsider.token,
    caregiverId: cg.user_id,
    viewerUserId: viewer.user_id,
    grantId: grant.grant_id,
  };
}

/* ------------------------------------------------------------------ media fixtures */

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const BASE_JPEG = b64ToBytes(GRAY_320x240_B64);

/** A distinct valid JPEG per index: a COM segment with the index is inserted after SOI. */
export function jpegFrame(index: number, base: Uint8Array = BASE_JPEG): Uint8Array {
  const text = new TextEncoder().encode(`test-frame-${index}`);
  const com = new Uint8Array([0xff, 0xfe, (text.length + 2) >> 8, (text.length + 2) & 0xff, ...text]);
  const out = new Uint8Array(base.length + com.length);
  out.set(base.subarray(0, 2), 0);
  out.set(com, 2);
  out.set(base.subarray(2), 2 + com.length);
  return out;
}

export function pack(frames: Uint8Array[]): Uint8Array {
  const total = frames.reduce((a, f) => a + 4 + f.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let o = 0;
  for (const f of frames) {
    view.setUint32(o, f.length, true);
    out.set(f, o + 4);
    o += 4 + f.length;
  }
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CaptureFixture {
  manifest: Record<string, unknown>;
  frames: Uint8Array[];
  bootId: string;
  epoch: number;
}

export async function captureFixture(opts: {
  deviceId: string;
  captureId: string;
  mode?: "normal" | "triggered";
  capturedAt: string;
  triggerId?: string | null;
  offsets?: number[];
  sourceMode?: "device" | "simulated";
  bootId?: string;
  epoch?: number;
}): Promise<CaptureFixture> {
  const mode = opts.mode ?? "normal";
  const count = mode === "normal" ? 24 : 40;
  const bootId = opts.bootId ?? TEST_BOOT;
  const epoch = opts.epoch ?? BOOT_EPOCH;
  const frames = Array.from({ length: count }, (_, i) => jpegFrame(i));
  const offsets = opts.offsets ?? frames.map((_, i) => i * 125);
  const t0 = uptimeOf(opts.capturedAt, epoch);
  const metas = await Promise.all(frames.map(async (f, i) => ({ seq: i, uptime_ms: t0 + (offsets[i] as number), size_bytes: f.length, sha256: await sha256(f) })));
  return {
    frames,
    bootId,
    epoch,
    manifest: {
      schema_version: "capture-session.v2",
      source_mode: opts.sourceMode ?? "simulated",
      device_id: opts.deviceId,
      capture_id: opts.captureId,
      mode,
      clock: { boot_id: bootId, uptime_ms: t0 + (offsets[count - 1] as number), wall_clock_synced: false, wall_time: null },
      frame_count: count,
      nominal_fps: 8,
      content_type: "image/jpeg",
      frame_width: 320,
      frame_height: 240,
      frames: metas,
      trigger_id: mode === "triggered" ? (opts.triggerId ?? "trg-test-1") : null,
      trigger_frame_index: mode === "triggered" ? 12 : null,
      firmware_version: "test-fw",
    },
  };
}

/** The manifest as the device would send it now (clock.uptime_ms = request build time). */
export function manifestNow(h: Harness, fx: CaptureFixture): Record<string, unknown> {
  return { ...fx.manifest, clock: deviceClock(h, fx.bootId, fx.epoch) };
}

/** Creates, uploads and completes a capture through the device API. */
export async function uploadCapture(h: Harness, token: string, fx: CaptureFixture, opts: { skipChunks?: number[]; complete?: boolean } = {}): Promise<Record<string, unknown>> {
  const created = await ok<{ upload: { frames_per_chunk: number; chunk_count: number } }>(await h.call("POST", "/api/device/v1/captures", { token, json: manifestNow(h, fx) }));
  const { frames_per_chunk: k, chunk_count: n } = created.upload;
  const captureId = String(fx.manifest.capture_id);
  for (let i = 0; i < n; i++) {
    if (opts.skipChunks?.includes(i)) continue;
    const body = pack(fx.frames.slice(i * k, (i + 1) * k));
    await ok(await h.call("PUT", `/api/device/v1/captures/${captureId}/chunks/${i}`, { token, body, headers: { "content-type": "application/octet-stream" } }));
  }
  if (opts.complete === false) return created;
  return ok(await h.call("POST", `/api/device/v1/captures/${captureId}/complete`, { token }), 202);
}

export function heartbeat(h: Harness, deviceId: string, clock: Record<string, unknown> = deviceClock(h)): Record<string, unknown> {
  return {
    schema_version: "device-heartbeat.v2",
    device_id: deviceId,
    clock,
    firmware_version: "test-fw",
    status: { camera: "ok", imu: "ok", speaker: "ok", wifi_rssi_dbm: -60, free_heap_bytes: 120000, last_error: null },
  };
}

/** Firmware trigger report (imu-event.v2). It is never fall evidence by itself. */
export function imuEvent(h: Harness, opts: { deviceId: string; triggerId: string; triggeredAt: string; captureId?: string | null; bootId?: string }): Record<string, unknown> {
  return {
    schema_version: "imu-event.v2",
    source_mode: "simulated",
    device_id: opts.deviceId,
    clock: deviceClock(h, opts.bootId ?? TEST_BOOT),
    trigger: {
      trigger_id: opts.triggerId,
      trigger_type: "impact",
      triggered_uptime_ms: uptimeOf(opts.triggeredAt),
      firmware_rule_version: "fw-test-rule-0",
      capture_id: opts.captureId ?? null,
      device_metrics: { peak_accel_g: 2.5 },
    },
  };
}

/** Synthetic raw samples on the device clock every 1000/rate ms with small deterministic noise (a frozen
 * signal would be flagged as a sensor fault). `impacts` lists uptimes that carry a synthetic spike; the
 * values have no clinical meaning. */
export function imuSamples(from: number, until: number, rateHz = 100, impacts: number[] = []): ImuSample[] {
  const step = 1000 / rateHz;
  const out: ImuSample[] = [];
  for (let t = from; t <= until; t += step) {
    const n = Math.sin(t / 37) * 0.01;
    out.push(
      impacts.includes(t)
        ? { t, ax: 2.4, ay: 0.3, az: -1.2, gx: 200, gy: 90, gz: 30 }
        : { t, ax: 0.01 + n, ay: 0.02 - n, az: 0.98 + n / 2, gx: 0.5 + n * 10, gy: 0.4 - n * 10, gz: 0.3 + n * 5 },
    );
  }
  return out;
}

export function imuBatch(h: Harness, opts: { deviceId: string; seq: number; samples: ImuSample[]; bootId?: string; sourceMode?: "device" | "simulated"; rateHz?: number }): Record<string, unknown> {
  const s = opts.samples;
  return {
    schema_version: "imu-batch.v1",
    source_mode: opts.sourceMode ?? "simulated",
    device_id: opts.deviceId,
    clock: deviceClock(h, opts.bootId ?? TEST_BOOT),
    batch_seq: opts.seq,
    sensor: "mpu6050",
    sample_rate_hz: opts.rateHz ?? 100,
    accel_range_g: 8,
    gyro_range_dps: 1000,
    units: { time: "ms_since_boot", accel: "g", gyro: "deg_per_s" },
    samples: {
      uptime_ms: s.map((x) => x.t),
      ax: s.map((x) => x.ax),
      ay: s.map((x) => x.ay),
      az: s.map((x) => x.az),
      gx: s.map((x) => x.gx),
      gy: s.map((x) => x.gy),
      gz: s.map((x) => x.gz),
    },
  };
}

/** Sends raw IMU covering [from, until] (ISO instants) in 1-second batches, as firmware would. */
export async function sendImu(h: Harness, token: string, deviceId: string, opts: { from: string; until: string; impacts?: string[]; firstSeq?: number; bootId?: string }): Promise<number> {
  const from = uptimeOf(opts.from);
  const until = uptimeOf(opts.until);
  const all = imuSamples(from, until, 100, (opts.impacts ?? []).map((i) => uptimeOf(i)));
  let seq = opts.firstSeq ?? 0;
  for (let i = 0; i < all.length; i += 100) {
    await ok(await h.call("POST", "/api/device/v1/imu-batches", { token, json: imuBatch(h, { deviceId, seq, samples: all.slice(i, i + 100), bootId: opts.bootId }) }), 201);
    seq++;
  }
  return seq;
}

/** Shape of a /v1/fall-check response as the agent forwards it (numbers synthetic). */
export function fallRequest(start: number, end: number, offsets: number[], score: number): Record<string, unknown> {
  return {
    frame_start: start,
    frame_end: end,
    t_start_ms: offsets[start],
    t_end_ms: offsets[end],
    score,
    window_logits: [
      [score - 1, score],
      [score - 2, score],
      [score - 3, score],
    ],
    windows: 2,
    threshold: null,
    alert: null,
    status: "NOT_CALIBRATED",
  };
}

export function drinkRequest(start: number, end: number, offsets: number[], label = "khong", lift: number | null = null, handled = false): Record<string, unknown> {
  return {
    frame_start: start,
    frame_end: end,
    t_start_ms: offsets[start],
    t_end_ms: offsets[end],
    label,
    evidence: {
      frames: end - start + 1,
      cup_frames: lift === null ? 0 : 6,
      medicine_frames: handled ? 4 : 0,
      near_face_frames: lift === null ? 0 : 2,
      lift_frame: lift,
      cup_lifted_to_face: lift !== null,
      medicine_handled: handled,
    },
    status: "UNCALIBRATED",
  };
}

export function visionResult(opts: {
  captureId: string;
  frameCount: 24 | 40;
  scores?: number[];
  drink?: Array<Record<string, unknown>>;
  aggregateLabel?: string;
  crossWindow?: boolean;
  liftFrames?: number[];
  key?: string;
  fallStatus?: "completed" | "skipped" | "failed";
}): Record<string, unknown> {
  const offsets = Array.from({ length: opts.frameCount }, (_, i) => i * 125);
  const plan = opts.frameCount === 24 ? [[0, 23]] : [[0, 23], [8, 31], [16, 39]];
  const scores = opts.scores ?? plan.map(() => -1.25);
  const fallStatus = opts.fallStatus ?? "completed";
  const fallRequests = fallStatus === "completed" ? plan.map(([s, e], i) => fallRequest(s as number, e as number, offsets, scores[i] as number)) : [];
  const drinkRequests = opts.drink ?? plan.map(([s, e]) => drinkRequest(s as number, e as number, offsets));
  return {
    schema_version: "vision-result.v1",
    idempotency_key: opts.key ?? `result-${opts.captureId}`,
    capture_id: opts.captureId,
    package_version: "carelens_models_v1_20261018",
    vision_health: { fall_heads: 3, drink: true },
    input_validation: { frame_count: opts.frameCount, jpeg_ok: true, cadence_status: "ok", min_interval_ms: 125, max_interval_ms: 125, issues: [] },
    fall: {
      status: fallStatus,
      reason: fallStatus === "completed" ? null : "test_reason",
      aggregation: fallStatus === "completed" ? (opts.frameCount === 24 ? "single_request.v1" : "max_request_score_overlapping.v1") : null,
      aggregate_score: fallStatus === "completed" ? Math.max(...scores) : null,
      requests: fallRequests,
    },
    drink: {
      status: "completed",
      reason: null,
      aggregation: "drink_capture_aggregate.v1",
      aggregate_label: opts.aggregateLabel ?? "khong",
      cross_window_review: opts.crossWindow ?? false,
      distinct_lift_frames: opts.liftFrames ?? [],
      requests: drinkRequests,
    },
  };
}

/** Trial rules for tests only. Values are arbitrary and carry no clinical meaning. */
export const IMU_TEST_RULE = {
  rule_version: "imu-test-trial",
  min_peak_accel_g: 2,
  max_min_accel_g: null,
  min_peak_gyro_dps: 150,
  calibration: "uncalibrated_trial",
  approved_by: "test-suite",
  approved_at: "2026-10-19",
  evidence_ref: "test only; no clinical meaning",
} as const;

export const VISION_TEST_RULE = {
  rule_version: "test-trial-rule",
  model_version: "carelens_models_v1_20261018",
  capture_modes: ["normal", "triggered"],
  aggregations: ["single_request.v1", "max_request_score_overlapping.v1"],
  min_score: 0,
  calibration: "uncalibrated_trial",
  approved_by: "test-suite",
  approved_at: "2026-10-19",
  evidence_ref: "test only",
} as const;

export const TEST_TRIAL_POLICY = JSON.stringify({
  policy_version: "fusion-rules.test",
  correlation_window_seconds: 10,
  imu_decision_grace_seconds: 120,
  imu_wait_seconds: 60,
  alignment_tolerance_ms: 3000,
  imu_search_margin_ms: 10_000,
  imu_min_coverage_ratio: 0.8,
  imu_max_gap_ms: 500,
  vision_candidate_rule: VISION_TEST_RULE,
  imu_candidate_rule: IMU_TEST_RULE,
  alert_dedup_window_seconds: 120,
  device_buzzer_on_alert: true,
});

export async function claim(h: Harness, token: string, kinds: string[] = ["vision", "daily_report"], defer = false): Promise<Record<string, any> | null> {
  const res = await ok<{ job: Record<string, any> | null }>(await h.call("POST", "/api/agent/v1/jobs/claim", { token, json: { kinds, lease_seconds: 120, defer_if_vision_pending: defer } }));
  return res.job;
}

export async function complete(h: Harness, token: string, job: Record<string, any>, result: unknown): Promise<Response> {
  return h.call("POST", `/api/agent/v1/jobs/${job.job_id}/complete`, { token, json: result, headers: { "x-lease-token": job.lease_token } });
}

export async function dbAll<T = Record<string, unknown>>(sql: string, ...binds: unknown[]): Promise<T[]> {
  return (await env.DB.prepare(sql).bind(...binds).all<T>()).results;
}

export async function dbFirst<T = Record<string, unknown>>(sql: string, ...binds: unknown[]): Promise<T | null> {
  return env.DB.prepare(sql).bind(...binds).first<T>();
}

export async function mediaObjects(): Promise<string[]> {
  const list = await env.MEDIA.list();
  return list.objects.map((o) => o.key);
}
