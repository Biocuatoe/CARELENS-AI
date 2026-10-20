/** Speaker volume set from the admin dashboard: validated and audited on the server, delivered in the heartbeat response, and
 * shown as "applied" only from the device's own heartbeat report. Synthetic identities only. */
import { beforeEach, describe, expect, it } from "vitest";
import { dbAll, dbFirst, deviceClock, freshDb, harness, heartbeat, ok, problemCode, provision, type Harness, type World } from "./helpers";
import { sha256Hex } from "../src/util";

let h: Harness;
let w: World;
let admin: string;

async function adminSession(): Promise<string> {
  const token = "clm_test-session-volume-0001";
  const at = "2026-10-19T00:00:00.000Z";
  await h.env.DB.batch([
    h.env.DB.prepare(`INSERT INTO admins (admin_id, email, role, status, created_at) VALUES ('adm_vol', 'owner.volume@example.invalid', 'owner', 'active', ?1)`).bind(at),
    h.env.DB.prepare(`INSERT INTO admin_sessions (token_id, admin_id, token_sha256, created_at, expires_at, auth_at) VALUES ('ats_vol', 'adm_vol', ?1, ?2, '2030-01-01T00:00:00.000Z', ?2)`).bind(
      await sha256Hex(token),
      at,
    ),
  ]);
  return token;
}

const setVolume = (body: unknown, token = admin, deviceId = w.deviceId) => h.call("PUT", `/api/admin/v1/devices/${deviceId}/speaker-volume`, { token, json: body });
const beat = (status: Record<string, unknown> = {}) => {
  const hb = heartbeat(h, w.deviceId, deviceClock(h)) as { status: Record<string, unknown> };
  return h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: { ...hb, status: { ...hb.status, ...status } } });
};
const speakerView = async () =>
  (await ok<{ device: { speaker: Record<string, unknown> } }>(await h.call("GET", `/api/admin/v1/devices/${w.deviceId}`, { token: admin }))).device.speaker;

beforeEach(async () => {
  await freshDb();
  h = harness(undefined, { ADMIN_BOOTSTRAP_EMAILS: "owner.volume@example.invalid" });
  h.clock.set("2026-10-19T01:00:00.000Z");
  w = await provision(h);
  admin = await adminSession();
});

describe("speaker volume", () => {
  it("is null until an admin sets it, so a device keeps its own volume", async () => {
    const res = await ok<{ config: { speaker_volume: number | null } }>(await beat());
    expect(res.config).toEqual({ speaker_volume: null, report_audio_codecs: true }); // ADR-025 asks for the codecs too
    expect(await speakerView()).toEqual({ desired_volume: null, desired_set_at: null, reported_volume: null, reported_at: null });
  });

  it("requires confirmation and a value inside the speaker's limit, in steps of 0.05", async () => {
    expect(await problemCode(await setVolume({ volume: 0.4 }))).toBe("invalid_payload");
    for (const volume of [0, 0.01, 0.75, 1, 0.42, Number.NaN]) {
      expect((await setVolume({ volume, confirm: true })).status).toBe(422);
    }
    expect((await setVolume({ volume: 0.4, confirm: true, extra: 1 })).status).toBe(422);
    expect(await dbFirst(`SELECT speaker_volume FROM devices WHERE device_id = ?1`, w.deviceId)).toEqual({ speaker_volume: null });
  });

  it("is admin-only and only for an active device", async () => {
    expect((await setVolume({ volume: 0.4, confirm: true }, w.caregiverToken)).status).toBe(401);
    expect((await setVolume({ volume: 0.4, confirm: true }, admin, "esp32-unknown")).status).toBe(404);
  });

  it("is delivered with the next heartbeat and shown as applied only after the device reports it", async () => {
    const set = await ok<{ speaker: { desired_volume: number; delivery: string } }>(await setVolume({ volume: 0.45, confirm: true }));
    expect(set.speaker).toMatchObject({ desired_volume: 0.45, delivery: "next_heartbeat" });
    const audit = await dbAll<{ action: string; detail_json: string }>(`SELECT action, detail_json FROM audit_log WHERE action = 'device.speaker_volume'`);
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.detail_json)).toEqual({ device_id: w.deviceId, volume: 0.45 });
    expect(await speakerView()).toMatchObject({ desired_volume: 0.45, reported_volume: null });

    // An older firmware ignores config and never reports a volume: the view keeps saying "not reported".
    expect((await ok<{ config: { speaker_volume: number } }>(await beat())).config.speaker_volume).toBe(0.45);
    expect((await speakerView()).reported_volume).toBeNull();

    h.clock.advance(60);
    await ok(await beat({ speaker_volume: 0.45 }));
    expect(await speakerView()).toMatchObject({ desired_volume: 0.45, reported_volume: 0.45, reported_at: "2026-10-19T01:01:00.000Z" });
  });

  it("refuses a reported volume outside 0..1 from the device", async () => {
    expect((await beat({ speaker_volume: 1.5 })).status).toBe(422);
  });
});
