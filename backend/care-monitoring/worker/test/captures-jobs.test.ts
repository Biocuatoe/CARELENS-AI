/** Capture upload validation, durable jobs (claim, lease, retry, idempotency) and media deletion. */
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureFixture,
  claim,
  complete,
  dbFirst,
  freshDb,
  harness,
  jpegFrame,
  manifestNow,
  mediaObjects,
  ok,
  pack,
  problemCode,
  provision,
  uploadCapture,
  visionResult,
  type Harness,
  type World,
} from "./helpers";
import { b64ToBytes } from "./helpers";
import { GRAY_160x120_B64 } from "./jpeg-fixtures";

let h: Harness;
let w: World;
const NOW = "2026-10-19T03:00:00.000Z";
const CAPTURED = "2026-10-19T02:59:55.000Z";

beforeEach(async () => {
  await freshDb();
  h = harness();
  h.clock.set(NOW);
  w = await provision(h);
});

async function create(fx: Awaited<ReturnType<typeof captureFixture>>) {
  return h.call("POST", "/api/device/v1/captures", { token: w.deviceToken, json: manifestNow(h, fx) });
}

async function putChunk(captureId: string, index: number, body: Uint8Array) {
  return h.call("PUT", `/api/device/v1/captures/${captureId}/chunks/${index}`, { token: w.deviceToken, body, headers: { "content-type": "application/octet-stream" } });
}

describe("capture upload", () => {
  it("accepts a 24-frame burst in 3 chunks and queues a vision job", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-1", capturedAt: CAPTURED });
    const done = (await uploadCapture(h, w.deviceToken, fx)) as { job: { job_id: string } };
    expect(done.job.job_id).toBeTruthy();
    expect(await mediaObjects()).toHaveLength(3);
    const row = await dbFirst<{ status: string; cadence_status: string }>(`SELECT status, cadence_status FROM capture_sessions WHERE capture_id = 'cap-1'`);
    expect(row).toEqual({ status: "uploaded", cadence_status: "ok" });
    // Nothing image-like lands in D1.
    const manifest = await dbFirst<{ manifest_json: string }>(`SELECT manifest_json FROM capture_sessions WHERE capture_id = 'cap-1'`);
    expect(manifest?.manifest_json).not.toContain("/9j/");
  });

  it("is idempotent for the same manifest and rejects a reused capture_id", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-dup", capturedAt: CAPTURED });
    expect((await create(fx)).status).toBe(201);
    const again = await ok<{ created: boolean }>(await create(fx), 200);
    expect(again.created).toBe(false);
    const frames = fx.manifest.frames as Array<{ uptime_ms: number }>;
    const changed = { ...manifestNow(h, fx), frames: frames.map((f) => ({ ...f, uptime_ms: f.uptime_ms - 1000 })) };
    const res = await h.call("POST", "/api/device/v1/captures", { token: w.deviceToken, json: changed });
    expect(res.status).toBe(409);
    expect(await problemCode(res)).toBe("capture_id_reused");
  });

  it("rejects invalid sequencing, timing, mode/count mismatch, old bursts and inconsistent clocks", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-bad", capturedAt: CAPTURED });
    const m = manifestNow(h, fx);
    const frames = fx.manifest.frames as Array<Record<string, number>>;
    const clock = m.clock as Record<string, unknown>;
    const minus = (ms: number) => frames.map((f) => ({ ...f, uptime_ms: (f.uptime_ms as number) - ms }));
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...m, frames: frames.map((f, i) => ({ ...f, seq: i === 3 ? 2 : f.seq })) }, "invalid_sequence"],
      [{ ...m, frames: frames.map((f, i) => ({ ...f, uptime_ms: i === 4 ? frames[3]!.uptime_ms : f.uptime_ms })) }, "invalid_timing"],
      [{ ...m, clock: { ...clock, uptime_ms: frames[10]!.uptime_ms } }, "invalid_timing"], // frames after the request was built
      [{ ...m, frames: frames.map((f, i) => ({ ...f, uptime_ms: (f.uptime_ms as number) - (i === 0 ? 70_000 : 0) })) }, "invalid_timing"], // spans > 60 s
      [{ ...m, mode: "triggered", trigger_id: "t1" }, "frame_count_mode_mismatch"],
      [{ ...m, frames: minus(20 * 60_000) }, "capture_too_old"],
      [{ ...m, frames: [...frames, { ...frames[0], seq: 24, uptime_ms: (frames[23]!.uptime_ms as number) + 125 }] }, "frame_list_length"],
      [{ ...m, clock: { ...clock, wall_time: "2026-10-19T03:00:00.000Z" } }, "invalid_clock"], // wall time without SNTP sync
    ];
    for (const [manifest, code] of cases) {
      const res = await h.call("POST", "/api/device/v1/captures", { token: w.deviceToken, json: manifest });
      expect(res.status, code).toBe(422);
      expect(await problemCode(res)).toBe(code);
    }
    const local = await h.call("POST", "/api/device/v1/captures", { token: w.deviceToken, json: { ...m, clock: { ...clock, wall_clock_synced: true, wall_time: "2026-10-19T09:59:55" } } });
    expect(local.status).toBe(422); // wall time without offset → rejected
  });

  it("estimates capture time from the device clock and keeps the burst's own monotonic window", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-time", capturedAt: CAPTURED });
    const body = await ok<{ capture: { captured_at: string; captured_until: string; boot_id: string; first_uptime_ms: number } }>(await create(fx), 201);
    expect([body.capture.captured_at, body.capture.captured_until]).toEqual([CAPTURED, "2026-10-19T02:59:57.875Z"]);
    expect(body.capture.boot_id).toBe("boot-test-0001");
    expect(body.capture.first_uptime_ms).toBe((fx.manifest.frames as Array<{ uptime_ms: number }>)[0]!.uptime_ms);
  });

  it("flags cadence gaps instead of hiding them", async () => {
    const offsets = Array.from({ length: 24 }, (_, i) => i * 125 + (i >= 12 ? 250 : 0));
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-gap", capturedAt: CAPTURED, offsets });
    const body = await ok<{ capture: { cadence_status: string; validation: { issues: string[] } } }>(await create(fx), 201);
    expect(body.capture.cadence_status).toBe("gap");
    expect(body.capture.validation.issues[0]).toContain("gap of 375 ms");
  });

  it("validates every frame of a chunk: JPEG, size, hash, dimensions, count", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-chunks", capturedAt: CAPTURED });
    await ok(await create(fx), 201);
    const good = fx.frames.slice(0, 8);
    const notJpeg = [...good];
    notJpeg[2] = new TextEncoder().encode("x".repeat((good[2] as Uint8Array).length));
    const wrongHash = [...good];
    wrongHash[1] = good[2] as Uint8Array;
    const small = b64ToBytes(GRAY_160x120_B64);
    const cases: Array<[Uint8Array, string]> = [
      [pack(good.slice(0, 7)), "invalid_chunk"],
      [pack(notJpeg), "invalid_jpeg"],
      [pack(wrongHash), "frame_hash_mismatch"],
      [pack([...good.slice(0, 7), jpegFrame(99)]), "frame_size_mismatch"],
      [pack([small, ...good.slice(1)]), "frame_size_mismatch"],
    ];
    for (const [body, code] of cases) {
      const res = await putChunk("cap-chunks", 0, body);
      expect(res.status, code).toBe(422);
      expect(await problemCode(res)).toBe(code);
    }
    expect(await mediaObjects()).toHaveLength(0);
    expect((await putChunk("cap-chunks", 3, pack(good))).status).toBe(404); // index beyond chunk_count
  });

  it("rejects frames whose decoded header disagrees with the declared dimensions", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-dims", capturedAt: CAPTURED });
    await ok(await create({ ...fx, manifest: { ...fx.manifest, frame_width: 160, frame_height: 120 } }), 201);
    const res = await putChunk("cap-dims", 0, pack(fx.frames.slice(0, 8)));
    expect(await problemCode(res)).toBe("frame_dimension_mismatch");
    const big = await h.call("POST", "/api/device/v1/captures", { token: w.deviceToken, json: { ...fx.manifest, capture_id: "cap-vga", frame_width: 800, frame_height: 600 } });
    expect(big.status).toBe(422);
  });

  it("rejects a JPEG whose bytes match the manifest but is not a JPEG", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-fake", capturedAt: CAPTURED });
    const fake = new TextEncoder().encode("y".repeat((fx.frames[0] as Uint8Array).length));
    fx.frames[0] = fake;
    const frames = fx.manifest.frames as Array<Record<string, unknown>>;
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", fake));
    frames[0] = { ...frames[0], sha256: [...d].map((b) => b.toString(16).padStart(2, "0")).join("") };
    await ok(await create(fx), 201);
    const res = await putChunk("cap-fake", 0, pack(fx.frames.slice(0, 8)));
    expect(await problemCode(res)).toBe("invalid_jpeg");
  });

  it("refuses to complete with missing chunks and lists them", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-miss", capturedAt: CAPTURED });
    await uploadCapture(h, w.deviceToken, fx, { skipChunks: [1], complete: false });
    const res = await h.call("POST", "/api/device/v1/captures/cap-miss/complete", { token: w.deviceToken });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; missing_chunks: number[] };
    expect([body.code, body.missing_chunks]).toEqual(["chunks_missing", [1]]);
  });

  it("treats a re-sent chunk and a re-sent complete as duplicates", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-re", capturedAt: CAPTURED });
    await uploadCapture(h, w.deviceToken, fx);
    const chunk = await ok<{ duplicate: boolean }>(await putChunk("cap-re", 0, pack(fx.frames.slice(0, 8))));
    expect(chunk.duplicate).toBe(true);
    const again = await ok<{ duplicate: boolean }>(await h.call("POST", "/api/device/v1/captures/cap-re/complete", { token: w.deviceToken }));
    expect(again.duplicate).toBe(true);
    expect((await dbFirst<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE kind = 'vision'`))?.n).toBe(1);
  });

  it("rejects simulated sources when the deployment does not accept them", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-sim", capturedAt: CAPTURED });
    const res = await h.call("POST", "/api/device/v1/captures", { token: w.deviceToken, json: manifestNow(h, fx), envOverrides: { ACCEPT_SIMULATED_SOURCES: "false" } });
    expect(res.status).toBe(403);
    expect(await problemCode(res)).toBe("simulated_source_rejected");
  });

  it("enforces the hourly capture quota", async () => {
    const env = { MAX_NORMAL_CAPTURES_PER_HOUR: "2" };
    for (const id of ["q1", "q2"]) {
      const fx = await captureFixture({ deviceId: w.deviceId, captureId: id, capturedAt: CAPTURED });
      expect((await h.call("POST", "/api/device/v1/captures", { token: w.deviceToken, json: manifestNow(h, fx), envOverrides: env })).status).toBe(201);
    }
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "q3", capturedAt: CAPTURED });
    const res = await h.call("POST", "/api/device/v1/captures", { token: w.deviceToken, json: manifestNow(h, fx), envOverrides: env });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("expires an incomplete upload and deletes its chunks", async () => {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: "cap-stale", capturedAt: CAPTURED });
    await uploadCapture(h, w.deviceToken, fx, { skipChunks: [2], complete: false });
    expect(await mediaObjects()).toHaveLength(2);
    h.clock.advance(121);
    await h.cron("* * * * *");
    expect(await mediaObjects()).toHaveLength(0);
    const row = await dbFirst<{ status: string; failure_code: string; media_deleted_at: string | null }>(`SELECT status, failure_code, media_deleted_at FROM capture_sessions WHERE capture_id = 'cap-stale'`);
    expect(row?.status).toBe("expired");
    expect(row?.failure_code).toBe("upload_incomplete");
    expect(row?.media_deleted_at).not.toBeNull();
    // A chunk arriving after expiry is refused and leaves nothing behind.
    const late = await putChunk("cap-stale", 2, pack(fx.frames.slice(16, 24)));
    expect(late.status).toBe(409);
    expect(await mediaObjects()).toHaveLength(0);
  });
});

describe("jobs", () => {
  async function queued(id: string, mode: "normal" | "triggered" = "normal") {
    const fx = await captureFixture({ deviceId: w.deviceId, captureId: id, capturedAt: CAPTURED, mode, triggerId: mode === "triggered" ? `trg-${id}` : null });
    await uploadCapture(h, w.deviceToken, fx);
    return fx;
  }

  it("claims triggered vision before normal vision before daily reports", async () => {
    await queued("n1");
    await queued("t1", "triggered");
    const first = await claim(h, w.agentToken);
    expect(first?.payload.capture_id).toBe("t1");
    expect(first?.payload.media).toHaveLength(5);
    // Frame times are relative to this burst only, and the IMU context is reported, not delegated.
    expect(first?.payload.frames.map((f: { t_offset_ms: number }) => f.t_offset_ms).slice(0, 3)).toEqual([0, 125, 250]);
    expect(first?.payload.imu_window).toMatchObject({ boot_id: "boot-test-0001", state: "missing", fused_by: "backend" });
    expect(first?.payload.window_plan).toEqual([
      [0, 23],
      [8, 31],
      [16, 39],
    ]);
    const second = await claim(h, w.agentToken);
    expect(second?.payload.capture_id).toBe("n1");
    expect(await claim(h, w.agentToken)).toBeNull();
  });

  it("never hands the same job to two concurrent claimers", async () => {
    await queued("c1");
    const [a, b] = await Promise.all([claim(h, w.agentToken), claim(h, w.agentToken)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("serves media only with the current lease", async () => {
    await queued("m1");
    const job = await claim(h, w.agentToken);
    const path = `/api/agent/v1/jobs/${job?.job_id}/media/0`;
    expect((await h.call("GET", path, { token: w.agentToken })).status).toBe(400);
    expect((await h.call("GET", path, { token: w.agentToken, headers: { "x-lease-token": "lease_wrong-wrong-wrong" } })).status).toBe(409);
    const res = await h.call("GET", path, { token: w.agentToken, headers: { "x-lease-token": job?.lease_token } });
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await h.call("GET", path, { token: w.deviceToken, headers: { "x-lease-token": job?.lease_token } })).status).toBe(401);
  });

  it("completes once, deletes media, and treats a retried completion as a duplicate", async () => {
    await queued("ok1");
    const job = await claim(h, w.agentToken);
    const result = visionResult({ captureId: "ok1", frameCount: 24 });
    const done = await ok<{ media_deleted: boolean; event_ids: string[] }>(await complete(h, w.agentToken, job!, result));
    expect(done.media_deleted).toBe(true);
    expect(await mediaObjects()).toHaveLength(0);
    expect(done.event_ids).toHaveLength(2);
    const dup = await ok<{ duplicate: boolean }>(await complete(h, w.agentToken, job!, result));
    expect(dup.duplicate).toBe(true);
    expect((await dbFirst<{ n: number }>(`SELECT COUNT(*) AS n FROM events`))?.n).toBe(2);
    const different = await complete(h, w.agentToken, job!, visionResult({ captureId: "ok1", frameCount: 24, scores: [2] }));
    expect(different.status).toBe(409);
    expect((await dbFirst<{ status: string }>(`SELECT status FROM capture_sessions WHERE capture_id = 'ok1'`))?.status).toBe("processed");
  });

  it("rejects an inconsistent result without completing the job", async () => {
    await queued("bad1");
    const job = await claim(h, w.agentToken);
    const result = visionResult({ captureId: "bad1", frameCount: 24 });
    (result.fall as { aggregate_score: number }).aggregate_score = 5;
    const res = await complete(h, w.agentToken, job!, result);
    expect(res.status).toBe(422);
    expect(await problemCode(res)).toBe("inconsistent_result");
    expect((await dbFirst<{ status: string }>(`SELECT status FROM jobs WHERE job_id = ?1`, job!.job_id))?.status).toBe("processing");
  });

  it("recovers an expired lease, retries with backoff, and fails after max attempts with media deleted", async () => {
    await queued("lease1");
    const first = await claim(h, w.agentToken);
    h.clock.advance(121); // lease (120 s) expired, agent vanished
    expect(await claim(h, w.agentToken)).toBeNull(); // recovered to retry_pending, backoff 5 s
    const row = await dbFirst<{ status: string; last_error_code: string }>(`SELECT status, last_error_code FROM jobs WHERE job_id = ?1`, first!.job_id);
    expect(row).toEqual({ status: "retry_pending", last_error_code: "lease_expired" });
    h.clock.advance(6);
    const second = await claim(h, w.agentToken);
    expect(second?.attempt).toBe(2);
    // The stale lease can no longer complete.
    expect((await complete(h, w.agentToken, first!, visionResult({ captureId: "lease1", frameCount: 24 }))).status).toBe(409);
    const fail = await h.call("POST", `/api/agent/v1/jobs/${second!.job_id}/fail`, { token: w.agentToken, json: { lease_token: second!.lease_token, error_code: "vision_http_500", retryable: true, detail: null } });
    expect((await ok<{ status: string }>(fail)).status).toBe("retry_pending");
    h.clock.advance(16);
    const third = await claim(h, w.agentToken);
    expect(third?.attempt).toBe(3);
    const last = await h.call("POST", `/api/agent/v1/jobs/${third!.job_id}/fail`, { token: w.agentToken, json: { lease_token: third!.lease_token, error_code: "vision_http_500", retryable: true, detail: null } });
    expect((await ok<{ status: string }>(last)).status).toBe("failed");
    expect(await mediaObjects()).toHaveLength(0);
    const cap = await dbFirst<{ status: string; failure_code: string }>(`SELECT status, failure_code FROM capture_sessions WHERE capture_id = 'lease1'`);
    expect(cap).toEqual({ status: "failed", failure_code: "vision_http_500" });
  });

  it("expires queued work and deletes media when the agent stays offline past the media lifetime", async () => {
    await queued("off1");
    h.clock.advance(901);
    await h.cron("* * * * *");
    expect(await mediaObjects()).toHaveLength(0);
    expect((await dbFirst<{ status: string }>(`SELECT status FROM jobs WHERE kind = 'vision'`))?.status).toBe("expired");
    expect((await dbFirst<{ status: string }>(`SELECT status FROM capture_sessions WHERE capture_id = 'off1'`))?.status).toBe("expired");
    expect(await claim(h, w.agentToken)).toBeNull();
  });

  it("releases a job without counting the attempt", async () => {
    await queued("rel1");
    const job = await claim(h, w.agentToken);
    await ok(await h.call("POST", `/api/agent/v1/jobs/${job!.job_id}/release`, { token: w.agentToken, json: { lease_token: job!.lease_token, reason: "preempted" } }));
    const again = await claim(h, w.agentToken);
    expect(again?.attempt).toBe(1);
  });

  it("renews a lease but never beyond the media lifetime", async () => {
    await queued("ren1");
    const job = await claim(h, w.agentToken);
    const res = await ok<{ lease_expires_at: string }>(await h.call("POST", `/api/agent/v1/jobs/${job!.job_id}/lease`, { token: w.agentToken, json: { lease_token: job!.lease_token, lease_seconds: 900 } }));
    expect(res.lease_expires_at <= job!.expires_at).toBe(true);
  });
});
