/**
 * Operator access to contact / purchase requests (A44), behind the existing admin gate (`adminOnly`: an admin `clm_`
 * session or the legacy static operator token). No public route reads, changes or deletes a stored request.
 *
 *   GET    /api/admin/v1/contact-requests                 list + counts, NO customer data (ids, states, timestamps, codes)
 *   GET    /api/admin/v1/contact-requests/:id             one request including what the customer typed (audited)
 *   POST   /api/admin/v1/contact-requests/:id/close       closed by the team: deleted 180 days later (audited)
 *   POST   /api/admin/v1/contact-requests/:id/reopen      reopen a closed request, or record activity on an open one (audited)
 *   DELETE /api/admin/v1/contact-requests/:id             erase now, after a verified data-subject request (audited)
 *
 * Audit entries carry the reference id, the action and states only, never customer data.
 */
import { adminActorId, auditStatement, type Ctx } from "./context";
import { badRequest, decodeCursor, encodeCursor, json, limitParam, notFound } from "./http";
import { CONTACT_CATEGORIES, purgeAfter } from "./contact";
import { iso } from "./util";

const NOTIFICATION_STATUSES = ["not_configured", "pending", "sending", "sent", "failed", "abandoned"] as const;
const HANDLING_STATUSES = ["open", "closed"] as const;
const REFERENCE = /^CL-\d{6}-[0-9A-HJKMNP-TV-Z]{8}$/;

const COLUMNS = `request_id, category, customer_group, created_at, updated_at, handling_status, closed_at, close_reason, purge_after,
  consent_at, privacy_notice_version, notification_status, notification_attempts, notification_last_attempt_at, notification_sent_at, notification_error`;

interface Row {
  request_id: string;
  category: (typeof CONTACT_CATEGORIES)[number];
  customer_group: string;
  created_at: string;
  updated_at: string;
  handling_status: (typeof HANDLING_STATUSES)[number];
  closed_at: string | null;
  close_reason: string | null;
  purge_after: string | null;
  consent_at: string;
  privacy_notice_version: string;
  notification_status: (typeof NOTIFICATION_STATUSES)[number];
  notification_attempts: number;
  notification_last_attempt_at: string | null;
  notification_sent_at: string | null;
  notification_error: string | null;
}

/** No customer data: only what an operator needs to find requests that need attention. */
function summary(r: Row) {
  return {
    request_id: r.request_id,
    category: r.category,
    customer_group: r.customer_group,
    created_at: r.created_at,
    updated_at: r.updated_at,
    handling: { status: r.handling_status, closed_at: r.closed_at, close_reason: r.close_reason, purge_after: r.purge_after },
    consent: { consent_at: r.consent_at, privacy_notice_version: r.privacy_notice_version },
    notification: {
      status: r.notification_status,
      attempts: r.notification_attempts,
      last_attempt_at: r.notification_last_attempt_at,
      sent_at: r.notification_sent_at,
      error: r.notification_error,
      // An interrupted attempt that may have been delivered; never retried outside the provider's idempotency window.
      outcome_unknown: r.notification_error === "outcome_unknown",
      // Permanently not notified: the team learns about it only from this list.
      needs_operator: r.notification_status === "abandoned",
    },
  };
}

function reference(id: string): string {
  if (!REFERENCE.test(id)) throw notFound("No such contact request.");
  return id;
}

function audit(ctx: Ctx, action: string, id: string, detail: Record<string, unknown>) {
  return auditStatement(ctx, { actorType: "admin", actorId: adminActorId(ctx), action, targetType: "contact_request", targetId: id, detail });
}

async function load(ctx: Ctx, id: string, withPayload = false): Promise<(Row & { payload_json?: string }) | null> {
  return ctx.env.DB.prepare(`SELECT ${COLUMNS}${withPayload ? ", payload_json" : ""} FROM contact_requests WHERE request_id = ?1`)
    .bind(id)
    .first<Row & { payload_json?: string }>();
}

/** GET /api/admin/v1/contact-requests?notification_status=&handling_status=&limit=&cursor= */
export async function listContactRequests(ctx: Ctx): Promise<Response> {
  const q = ctx.url.searchParams;
  const notification = q.get("notification_status");
  const handling = q.get("handling_status");
  if (notification !== null && !(NOTIFICATION_STATUSES as readonly string[]).includes(notification)) {
    throw badRequest("invalid_notification_status", `notification_status must be one of ${NOTIFICATION_STATUSES.join(", ")}.`);
  }
  if (handling !== null && !(HANDLING_STATUSES as readonly string[]).includes(handling)) throw badRequest("invalid_handling_status", "handling_status must be open or closed.");
  const limit = limitParam(ctx.url, 50, 200);
  const cursor = decodeCursor(q.get("cursor"));
  const db = ctx.env.DB;
  const [rows, counts] = await db.batch([
    db
      .prepare(
        `SELECT ${COLUMNS} FROM contact_requests
         WHERE (?1 IS NULL OR notification_status = ?1) AND (?2 IS NULL OR handling_status = ?2)
           AND (?3 IS NULL OR created_at < ?3 OR (created_at = ?3 AND request_id < ?4))
         ORDER BY created_at DESC, request_id DESC LIMIT ?5`,
      )
      .bind(notification, handling, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1),
    db.prepare(`SELECT notification_status, handling_status, COUNT(*) AS n FROM contact_requests GROUP BY notification_status, handling_status`),
  ]);
  const results = (rows?.results ?? []) as Row[];
  const items = results.slice(0, limit);
  const last = items[items.length - 1];
  const byNotification: Record<string, number> = Object.fromEntries(NOTIFICATION_STATUSES.map((s) => [s, 0]));
  const byHandling: Record<string, number> = { open: 0, closed: 0 };
  for (const c of (counts?.results ?? []) as Array<{ notification_status: string; handling_status: string; n: number }>) {
    byNotification[c.notification_status] = (byNotification[c.notification_status] ?? 0) + c.n;
    byHandling[c.handling_status] = (byHandling[c.handling_status] ?? 0) + c.n;
  }
  return json({
    items: items.map(summary),
    next_cursor: results.length > limit && last ? encodeCursor(last.created_at, last.request_id) : null,
    counts: { notification: byNotification, handling: byHandling },
    notifications: ctx.config.contactMail ? "configured" : ctx.config.contactMailConfigError ? "misconfigured" : "not_configured",
  });
}

/** GET /api/admin/v1/contact-requests/:id — includes the customer's own data (for handling and access requests). */
export async function getContactRequest(ctx: Ctx, rawId: string): Promise<Response> {
  const id = reference(rawId);
  const row = await load(ctx, id, true);
  if (!row) throw notFound("No such contact request.");
  await audit(ctx, "contact_request.view", id, { category: row.category }).run();
  const { payload_json, ...rest } = row;
  return json({ ...summary(rest), payload: payload_json ? (JSON.parse(payload_json) as unknown) : null });
}

/** POST /api/admin/v1/contact-requests/:id/close — idempotent: closing a closed request keeps its original dates. */
export async function closeContactRequest(ctx: Ctx, rawId: string): Promise<Response> {
  const id = reference(rawId);
  const now = ctx.clock.now();
  const changed = await ctx.env.DB.prepare(
    `UPDATE contact_requests SET handling_status = 'closed', closed_at = ?1, close_reason = 'operator', purge_after = ?2, updated_at = ?1
     WHERE request_id = ?3 AND handling_status = 'open' RETURNING ${COLUMNS}`,
  )
    .bind(iso(now), iso(purgeAfter(now)), id)
    .first<Row>();
  if (changed) {
    await audit(ctx, "contact_request.close", id, { purge_after: changed.purge_after }).run();
    return json({ ...summary(changed), changed: true });
  }
  const row = await load(ctx, id);
  if (!row) throw notFound("No such contact request.");
  return json({ ...summary(row), changed: false });
}

/** POST /api/admin/v1/contact-requests/:id/reopen — clears the closure (and its deletion date); on an open request it records
 * handling activity, which restarts the 12-month inactivity period. */
export async function reopenContactRequest(ctx: Ctx, rawId: string): Promise<Response> {
  const id = reference(rawId);
  const before = await load(ctx, id);
  if (!before) throw notFound("No such contact request.");
  const row = await ctx.env.DB.prepare(
    `UPDATE contact_requests SET handling_status = 'open', closed_at = NULL, close_reason = NULL, purge_after = NULL, updated_at = ?1
     WHERE request_id = ?2 RETURNING ${COLUMNS}`,
  )
    .bind(iso(ctx.clock.now()), id)
    .first<Row>();
  if (!row) throw notFound("No such contact request.");
  await audit(ctx, before.handling_status === "closed" ? "contact_request.reopen" : "contact_request.activity", id, {}).run();
  return json(summary(row));
}

/** DELETE /api/admin/v1/contact-requests/:id — erasure after the requester's identity was verified (runbook §17).
 * Deletes the D1 row only; e-mail copies and D1 Time Travel history are handled separately and are not claimed here. */
export async function eraseContactRequest(ctx: Ctx, rawId: string): Promise<Response> {
  const id = reference(rawId);
  const row = await ctx.env.DB.prepare(`DELETE FROM contact_requests WHERE request_id = ?1 RETURNING category, notification_status`)
    .bind(id)
    .first<{ category: string; notification_status: string }>();
  if (!row) throw notFound("No such contact request.");
  await audit(ctx, "contact_request.erase", id, { category: row.category, notification_status: row.notification_status }).run();
  return json({
    request_id: id,
    erased: true,
    // 'sending' at erasure: an e-mail already handed to the provider may still arrive.
    notification_status_at_erasure: row.notification_status,
    not_covered: ["email_copies", "d1_time_travel_history", "provider_logs"],
  });
}
