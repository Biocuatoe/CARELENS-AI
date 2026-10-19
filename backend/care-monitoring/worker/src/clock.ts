/**
 * Device clock handling.
 *
 * Every device request carries `clock = { boot_id, uptime_ms, wall_clock_synced, wall_time }`. The ESP32
 * monotonic clock (uptime) is exact within one boot but says nothing about UTC; its wall clock may be
 * unsynchronised or drift. The backend therefore:
 *
 * - aligns evidence of the same boot on uptime_ms directly (camera frames, raw IMU samples, triggers);
 * - estimates the UTC instant of uptime 0 per boot as min(received_at − uptime_ms) over all requests of
 *   that boot. One-way latency only adds to each sample, so the estimate is late by the smallest latency
 *   seen (typically well under a second) and only ever improves;
 * - never fuses evidence across boots by time, and never orders evidence by the device wall clock (that
 *   value is kept for diagnostics: a large difference from the estimate is flagged).
 */
import type { DeviceClockT } from "./contracts";
import type { Ctx } from "./context";
import { invalid } from "./http";
import { iso, parseInstant } from "./util";

/** Wall-clock disagreements larger than this are flagged (they never change stored times). */
export const WALL_CLOCK_FLAG_MS = 2_000;

export interface BootClock {
  bootId: string;
  /** Estimated UTC epoch (ms) of uptime 0 for this boot, after including this request. */
  epochMs: number;
  issues: string[];
}

/** Records one clock observation and returns the boot's current epoch estimate. One D1 statement. */
export async function observeClock(ctx: Ctx, deviceId: string, clock: DeviceClockT): Promise<BootClock> {
  const now = ctx.clock.now();
  const issues: string[] = [];
  let wallOffset: number | null = null;
  if (clock.wall_time !== null) {
    if (!clock.wall_clock_synced) throw invalid("invalid_clock", "clock.wall_time must be null unless clock.wall_clock_synced is true.");
    const wall = parseInstant(clock.wall_time);
    if (!wall) throw invalid("invalid_clock", "clock.wall_time is not a valid instant.");
    wallOffset = wall.getTime() - now.getTime();
    if (Math.abs(wallOffset) > WALL_CLOCK_FLAG_MS) issues.push(`device wall clock differs from server time by ${wallOffset} ms`);
  }
  const estimate = now.getTime() - clock.uptime_ms;
  const row = await ctx.env.DB.prepare(
    `INSERT INTO device_boots (device_id, boot_id, epoch_ms, first_seen_at, last_seen_at, max_uptime_ms, observations, wall_clock_synced, wall_offset_ms)
     VALUES (?1, ?2, ?3, ?4, ?4, ?5, 1, ?6, ?7)
     ON CONFLICT (device_id, boot_id) DO UPDATE SET
       epoch_ms = MIN(device_boots.epoch_ms, excluded.epoch_ms),
       last_seen_at = excluded.last_seen_at,
       max_uptime_ms = MAX(device_boots.max_uptime_ms, excluded.max_uptime_ms),
       observations = device_boots.observations + 1,
       wall_clock_synced = MAX(device_boots.wall_clock_synced, excluded.wall_clock_synced),
       wall_offset_ms = COALESCE(excluded.wall_offset_ms, device_boots.wall_offset_ms)
     RETURNING epoch_ms`,
  )
    .bind(deviceId, clock.boot_id, estimate, iso(now), clock.uptime_ms, clock.wall_clock_synced ? 1 : 0, wallOffset)
    .first<{ epoch_ms: number }>();
  return { bootId: clock.boot_id, epochMs: row?.epoch_ms ?? estimate, issues };
}

export function uptimeToDate(epochMs: number, uptimeMs: number): Date {
  return new Date(epochMs + uptimeMs);
}
