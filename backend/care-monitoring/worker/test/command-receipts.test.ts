/** ADR-022: the `received` report, size-based delivery and download deadlines, accepted-before-started for audio,
 * reboot handling, and the compatibility of rows written before migration 0006. */
import { beforeEach, describe, expect, it } from "vitest";
import { dbAll, dbFirst, deviceClock, freshDb, harness, heartbeat, mp3Heartbeat, ok, provision, type Harness, type World } from "./helpers";
import { LAME_16K_MONO, insertLegacyWav } from "./audio";

let h: Harness;
let w: World;
const R = () => `/api/app/v1/recipients/${w.recipientId}`;
const NEW_BOOT = "boot-test-0002";

/** The deadlines below follow the byte size whatever the codec. Most cases use a legacy WAV recording (44 + 32 000 B per
 * second, exact sizes); `mp3` uploads a real MP3 instead. */
async function voiceCommand(key: string, seconds = 1, expires = 600, mp3 = false) {
  let voiceId: string;
  if (mp3) {
    await ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: mp3Heartbeat(h, w.deviceId) }));
    const vm = await ok<{ voice_message: { voice_message_id: string } }>(
      await h.call("POST", `${R()}/voice-messages?title=${encodeURIComponent("Bản thử")}`, { token: w.caregiverToken, body: LAME_16K_MONO, headers: { "content-type": "audio/mpeg" } }),
      201,
    );
    voiceId = vm.voice_message.voice_message_id;
  } else {
    voiceId = (await insertLegacyWav(w.recipientId, "Bản thử", seconds)).assetId;
  }
  const created = await ok<{ command: { command_id: string } }>(
    await h.call("POST", `${R()}/devices/${w.deviceId}/commands`, {
      token: w.caregiverToken,
      json: { command_type: "play_voice_message", voice_message_id: voiceId, idempotency_key: key, expires_in_seconds: expires },
    }),
    201,
  );
  return created.command.command_id;
}

async function next(): Promise<{ command_id: string; delivery_attempt: number } | null> {
  const res = await h.call("GET", "/api/device/v1/commands/next", { token: w.deviceToken });
  if (res.status === 204) return null;
  return ((await res.json()) as { command: { command_id: string; delivery_attempt: number } | null }).command;
}

/** A status report built by a device that booted `uptime` ms ago with boot id `boot`. */
async function status(id: string, s: string, reason: string | null = null, boot?: string) {
  const clock = boot ? deviceClock(h, boot, h.clock.t - 4000) : deviceClock(h);
  return h.call("POST", `/api/device/v1/commands/${id}/status`, {
    token: w.deviceToken,
    json: { schema_version: "command-status.v2", device_id: w.deviceId, clock, status: s, reason_code: reason, detail: null },
  });
}

async function beat(boot: string) {
  return ok(await h.call("POST", "/api/device/v1/heartbeat", { token: w.deviceToken, json: heartbeat(h, w.deviceId, deviceClock(h, boot, h.clock.t - 3000)) }));
}

type Row = { status: string; status_reason: string | null; received_at: string | null; device_boot_id: string | null; ack_deadline_at: string | null; delivery_attempts: number };
const row = (id: string) =>
  dbFirst<Row>(`SELECT status, status_reason, received_at, device_boot_id, ack_deadline_at, delivery_attempts FROM device_commands WHERE command_id = ?1`, id);
const timeline = async (id: string) =>
  (await dbAll<{ status: string; reason: string | null; actor_type: string }>(`SELECT status, reason, actor_type FROM device_command_events WHERE command_id = ?1 ORDER BY seq`, id)).map(
    (e) => `${e.status}:${e.actor_type}${e.reason ? `:${e.reason}` : ""}`,
  );

async function reminderCommand(): Promise<string> {
  await ok(
    await h.call("POST", `${R()}/reminders`, {
      token: w.caregiverToken,
      json: {
        device_id: w.deviceId,
        kind: "water",
        label: "Nhắc thử",
        voice_message_id: null,
        times_local: ["08:05"],
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        timezone: "Asia/Ho_Chi_Minh",
        start_date: "2026-10-01",
        end_date: null,
        deadline_minutes: 30,
      },
    }),
    201,
  );
  h.clock.set("2026-10-19T01:05:30.000Z");
  await h.cron("* * * * *");
  return (await dbFirst<{ command_id: string }>(`SELECT command_id FROM device_commands WHERE command_type = 'reminder'`))!.command_id;
}

beforeEach(async () => {
  await freshDb();
  h = harness();
  h.clock.set("2026-10-19T01:00:00.000Z");
  w = await provision(h);
});

describe("received report (ADR-022)", () => {
  it("keeps the command delivered, is recorded once, stops redelivery and shows in the timeline", async () => {
    const id = await voiceCommand("rcv-000001");
    expect((await next())?.command_id).toBe(id);
    const first = await ok<{ duplicate: boolean; command: { status: string; received_at: string | null; download_deadline_at: string | null } }>(await status(id, "received"));
    expect(first.duplicate).toBe(false);
    expect(first.command).toMatchObject({ status: "delivered", received_at: "2026-10-19T01:00:00.000Z", download_deadline_at: "2026-10-19T01:00:33.000Z" });
    expect((await ok<{ duplicate: boolean }>(await status(id, "received"))).duplicate).toBe(true);
    expect(await row(id)).toMatchObject({ status: "delivered", device_boot_id: "boot-test-0001", delivery_attempts: 1 });
    h.clock.advance(31);
    expect(await next()).toBeNull(); // not handed out again: the device said it has it
    expect((await row(id))?.delivery_attempts).toBe(1);
    await ok(await status(id, "accepted"));
    await ok(await status(id, "started"));
    await ok(await status(id, "completed"));
    expect((await ok<{ duplicate: boolean }>(await status(id, "received"))).duplicate).toBe(true); // late receipt is harmless
    expect(await timeline(id)).toEqual(["queued:system", "delivered:system", "received:device", "accepted:device", "started:device", "completed:device"]);
  });

  it("fails a received command with download_timeout when it is not accepted in time, and closes its audio", async () => {
    const id = await voiceCommand("rcv-000002"); // 32 044 B: 30 s + ceil(32 044 / 16 000) = 33 s
    await next();
    await ok(await status(id, "received"));
    h.clock.advance(32);
    expect((await h.call("GET", `/api/device/v1/commands/${id}/audio`, { token: w.deviceToken })).status).toBe(200); // still inside the deadline
    h.clock.advance(2);
    expect(await next()).toBeNull();
    expect(await row(id)).toMatchObject({ status: "failed", status_reason: "download_timeout" });
    expect((await h.call("GET", `/api/device/v1/commands/${id}/audio`, { token: w.deviceToken })).status).toBe(404);
    const late = await status(id, "accepted");
    expect(late.status).toBe(409);
    expect(((await late.json()) as { stop_playback: boolean }).stop_playback).toBe(true);
    const view = await ok<{ command: { played_confirmed_by_device: boolean; status_reason: string } }>(await h.call("GET", `${R()}/commands/${id}`, { token: w.viewerToken }));
    expect(view.command).toMatchObject({ played_confirmed_by_device: false, status_reason: "download_timeout" });
  });

  it("caps the download deadline at the command's own expiry", async () => {
    const id = await voiceCommand("rcv-000003", 60, 60); // 1 920 044 B would allow 151 s, but the command expires after 60 s
    await next();
    const r = await ok<{ command: { download_deadline_at: string } }>(await status(id, "received"));
    expect(r.command.download_deadline_at).toBe("2026-10-19T01:01:00.000Z");
    h.clock.advance(61);
    await next();
    expect((await row(id))?.status).toBe("expired");
  });

  it("refuses a receipt for a command that already ended, telling the device to stop", async () => {
    const id = await voiceCommand("rcv-000004", 1, 30);
    await next();
    h.clock.advance(31);
    const res = await status(id, "received");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ current_status: "expired", stop_playback: true });
  });
});

describe("delivery deadlines without a receipt", () => {
  it("gives a large recording a size-based deadline before it is handed out again", async () => {
    const id = await voiceCommand("ack-000001", 60); // 1 920 044 B → 30 s + 121 s = 151 s
    expect((await next())?.command_id).toBe(id);
    expect((await row(id))?.ack_deadline_at).toBe("2026-10-19T01:02:31.000Z");
    h.clock.advance(31);
    expect(await next()).toBeNull(); // still downloading, not redelivered after the old fixed 30 s
    expect(await row(id)).toMatchObject({ status: "delivered", delivery_attempts: 1 });
    h.clock.advance(121);
    const again = await next();
    expect(again).toMatchObject({ command_id: id, delivery_attempt: 2 });
  });

  it("sizes the deadline of an MP3 by its own (small) byte size", async () => {
    const id = await voiceCommand("ack-mp3-001", 1, 600, true);
    expect((await next())?.command_id).toBe(id);
    // 4 320 B: 30 s + ceil(4 320 / 16 000) = 31 s
    expect((await row(id))?.ack_deadline_at).toBe("2026-10-19T01:00:31.000Z");
  });

  it("keeps the fixed 30 s for commands without audio", async () => {
    const id = await reminderCommand();
    expect((await next())?.command_id).toBe(id);
    expect((await row(id))?.ack_deadline_at).toBe("2026-10-19T01:06:00.000Z");
    h.clock.advance(31);
    expect(await next()).toMatchObject({ command_id: id, delivery_attempt: 2 });
  });

  it("treats rows written before migration 0006 (no ack deadline) with the 30 s rule", async () => {
    const id = await voiceCommand("ack-000002", 60);
    await next();
    await h.env.DB.prepare(`UPDATE device_commands SET ack_deadline_at = NULL WHERE command_id = ?1`).bind(id).run();
    h.clock.advance(31);
    expect(await next()).toMatchObject({ command_id: id, delivery_attempt: 2 });
  });

  it("never hands two commands to concurrent polls", async () => {
    await voiceCommand("ack-000003");
    await voiceCommand("ack-000004");
    const polls = await Promise.all([next(), next(), next()]);
    expect(polls.filter(Boolean)).toHaveLength(1);
    expect(await dbAll(`SELECT command_id FROM device_commands WHERE status = 'delivered'`)).toHaveLength(1);
  });
});

describe("accepted before started", () => {
  it("refuses started for a command with audio until the device accepted (verified) it", async () => {
    const id = await voiceCommand("ver-000001");
    await next();
    const early = await status(id, "started");
    expect(early.status).toBe(409);
    const body = (await early.json()) as { code: string; current_status: string; stop_playback: boolean; detail: string };
    expect(body).toMatchObject({ code: "invalid_transition", current_status: "delivered", stop_playback: false });
    expect(body.detail).toContain("accepted");
    await ok(await status(id, "accepted"));
    await ok(await status(id, "started"));
  });

  it("lets a tone-only reminder start directly", async () => {
    const id = await reminderCommand();
    await next();
    await ok(await status(id, "started"));
    await ok(await status(id, "completed"));
  });
});

describe("reboot handling", () => {
  it("puts a received or accepted command back in the queue after a reboot; it is delivered again with the same id", async () => {
    const id = await voiceCommand("rbt-000001");
    await next();
    await ok(await status(id, "received"));
    await ok(await status(id, "accepted"));
    await beat("boot-test-0001"); // same boot: nothing changes
    expect((await row(id))?.status).toBe("accepted");
    await beat(NEW_BOOT);
    expect(await row(id)).toMatchObject({ status: "queued", status_reason: "device_rebooted", received_at: null, device_boot_id: null });
    expect(await next()).toMatchObject({ command_id: id, delivery_attempt: 2 });
    expect(await timeline(id)).toEqual(["queued:system", "delivered:system", "received:device", "accepted:device", "queued:system:device_rebooted", "delivered:system"]);
  });

  it("fails a command that was playing when the device rebooted; it never becomes completed by itself", async () => {
    const id = await voiceCommand("rbt-000002");
    await next();
    await ok(await status(id, "accepted"));
    await ok(await status(id, "started"));
    await beat(NEW_BOOT);
    expect(await row(id)).toMatchObject({ status: "failed", status_reason: "device_rebooted" });
    const view = await ok<{ command: { played_confirmed_by_device: boolean } }>(await h.call("GET", `${R()}/commands/${id}`, { token: w.viewerToken }));
    expect(view.command.played_confirmed_by_device).toBe(false);
    const late = await status(id, "completed", null, NEW_BOOT);
    expect(late.status).toBe(409);
    expect(await next()).toBeNull(); // never replayed
  });

  it("keeps completion evidence the device reports from its new boot before the first heartbeat", async () => {
    const id = await voiceCommand("rbt-000003");
    await next();
    await ok(await status(id, "accepted"));
    await ok(await status(id, "started"));
    // The device finished playing, persisted it, rebooted, and reports completed before its first heartbeat.
    await ok(await status(id, "completed", null, NEW_BOOT));
    await beat(NEW_BOOT);
    expect((await row(id))?.status).toBe("completed");
  });

  it("does not touch commands the device never reported on", async () => {
    const id = await voiceCommand("rbt-000004");
    await next();
    await beat(NEW_BOOT);
    expect(await row(id)).toMatchObject({ status: "delivered", delivery_attempts: 1 });
  });

  it("accepts a device's own device_rebooted failure for a command it was playing", async () => {
    const id = await voiceCommand("rbt-000005");
    await next();
    await ok(await status(id, "accepted"));
    await ok(await status(id, "started"));
    await ok(await status(id, "failed", "device_rebooted", NEW_BOOT));
    expect(await row(id)).toMatchObject({ status: "failed", status_reason: "device_rebooted" });
  });
});
