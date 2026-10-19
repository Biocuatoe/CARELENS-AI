/** Caregiver read endpoints and the authenticated hint stream (ADR-010: hints only, refetch over REST). */
import { permissionsOf, requireRecipient, type CaregiverPrincipal, type Ctx } from "./context";
import { badRequest, decodeCursor, encodeCursor, json, limitParam } from "./http";
import { sseFrame, sseResponse } from "./realtime";

export async function me(ctx: Ctx, user: CaregiverPrincipal): Promise<Response> {
  const [profile, grants] = await ctx.env.DB.batch([
    ctx.env.DB.prepare(`SELECT user_id, display_name FROM caregivers WHERE user_id = ?1`).bind(user.userId),
    ctx.env.DB.prepare(
      `SELECT g.recipient_id, g.role, r.display_label, r.timezone FROM grants g JOIN care_recipients r ON r.recipient_id = g.recipient_id
       WHERE g.user_id = ?1 AND g.revoked_at IS NULL AND r.status = 'active' ORDER BY r.display_label`,
    ).bind(user.userId),
  ]);
  return json({
    user: profile?.results?.[0] ?? null,
    recipients: ((grants?.results ?? []) as Array<{ recipient_id: string; role: string; display_label: string; timezone: string }>).map((g) => ({
      ...g,
      permissions: permissionsOf(g.role),
    })),
  });
}

const EVENT_TYPES = new Set(["fall_check", "drink_check", "imu_trigger"]);

export async function listEvents(ctx: Ctx, user: CaregiverPrincipal, recipientId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  const limit = limitParam(ctx.url);
  const cursor = decodeCursor(ctx.url.searchParams.get("cursor"));
  const type = ctx.url.searchParams.get("type");
  if (type && !EVENT_TYPES.has(type)) throw badRequest("invalid_type", "Unknown event type.");
  const rows = await ctx.env.DB.prepare(
    `SELECT * FROM events WHERE recipient_id = ?1 AND (?2 IS NULL OR event_type = ?2)
       AND (?3 IS NULL OR observed_at < ?3 OR (observed_at = ?3 AND event_id < ?4))
     ORDER BY observed_at DESC, event_id DESC LIMIT ?5`,
  )
    .bind(recipientId, type, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1)
    .all<Record<string, unknown>>();
  const items = rows.results.slice(0, limit).map((e) => {
    const { evidence_json, ...rest } = e;
    return { ...rest, evidence: JSON.parse(String(evidence_json)), ai_output_unverified: e.source === "vision_model" };
  });
  const last = items[items.length - 1] as { observed_at: string; event_id: string } | undefined;
  return json({ items, next_cursor: rows.results.length > limit && last ? encodeCursor(last.observed_at, last.event_id) : null });
}

export async function listDevices(ctx: Ctx, user: CaregiverPrincipal, recipientId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  const rows = await ctx.env.DB.prepare(
    `SELECT device_id, kind, label, status, firmware_version, last_seen_at, created_at FROM devices WHERE recipient_id = ?1 ORDER BY created_at`,
  )
    .bind(recipientId)
    .all<{ device_id: string; last_seen_at: string | null; status: string }>();
  const now = ctx.clock.now().getTime();
  return json({
    online_window_seconds: ctx.config.deviceOnlineWindowSeconds,
    items: rows.results.map((d) => ({
      ...d,
      connection:
        d.status !== "active"
          ? "revoked"
          : d.last_seen_at === null
            ? "never_seen"
            : now - new Date(d.last_seen_at).getTime() <= ctx.config.deviceOnlineWindowSeconds * 1000
              ? "connected"
              : "disconnected",
    })),
  });
}

export async function recipientStream(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, cors: Record<string, string>): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  const row = await ctx.env.DB.prepare(`SELECT seq FROM recipient_streams WHERE recipient_id = ?1`).bind(recipientId).first<{ seq: number }>();
  const seq = row?.seq ?? 0;
  return sseResponse(ctx.env, {
    channel: `recipient:${recipientId}`,
    params: { view: "hints", recipient: recipientId, user: user.userId },
    initialFrames: [sseFrame(seq, { seq, type: "stream.opened", entity_id: null })],
    lifetimeSeconds: ctx.config.sseMaxLifetimeSeconds,
    headers: cors,
  });
}

export async function agentStream(ctx: Ctx): Promise<Response> {
  return sseResponse(ctx.env, {
    channel: "agents",
    params: { view: "agent" },
    initialFrames: [sseFrame(null, { type: "stream.opened" })],
    lifetimeSeconds: ctx.config.sseMaxLifetimeSeconds,
    headers: {},
  });
}
