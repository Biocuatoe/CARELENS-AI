/**
 * Caregiver alert handling and human review of fusion decisions.
 *
 * Alert state machine: open → acknowledged → in_progress → resolved, plus acknowledged → resolved.
 * Transitions use optimistic concurrency (expected_version); a mismatch answers 409 with the current
 * state. Resolving requires review_outcome (confirmed | false_alarm | uncertain) and a note. Only a
 * caregiver review sets a decision to verified or dismissed; the system never does.
 */
import { AlertActionV1, DecisionReviewV1 } from "./contracts";
import { auditStatement, bumpStreamStatement, guardStatement, isGuardFailure, requireRecipient, type CaregiverPrincipal, type Ctx } from "./context";
import { conflict, decodeCursor, encodeCursor, invalid, json, limitParam, notFound, readJson } from "./http";
import { notifyRecipient } from "./realtime";
import { iso, newId } from "./util";

interface AlertRow {
  alert_id: string;
  recipient_id: string;
  device_id: string;
  kind: string;
  fusion_decision_id: string;
  status: "open" | "acknowledged" | "in_progress" | "resolved";
  severity: string;
  verification_required: number;
  summary_vi: string;
  policy_version: string;
  observed_at: string;
  triggered_at: string;
  version: number;
  duplicate_count: number;
  last_duplicate_at: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  review_outcome: string | null;
  review_note: string | null;
}

const TRANSITIONS: Record<string, { from: AlertRow["status"][]; to: AlertRow["status"] }> = {
  acknowledge: { from: ["open"], to: "acknowledged" },
  start: { from: ["acknowledged"], to: "in_progress" },
  resolve: { from: ["acknowledged", "in_progress"], to: "resolved" },
};

export function alertView(a: AlertRow): Record<string, unknown> {
  return {
    alert_id: a.alert_id,
    device_id: a.device_id,
    kind: a.kind,
    status: a.status,
    severity: a.severity,
    provisional: true,
    verification_required: a.verification_required === 1,
    summary_vi: a.summary_vi,
    fusion_decision_id: a.fusion_decision_id,
    policy_version: a.policy_version,
    observed_at: a.observed_at,
    triggered_at: a.triggered_at,
    version: a.version,
    duplicate_count: a.duplicate_count,
    acknowledged_by: a.acknowledged_by,
    acknowledged_at: a.acknowledged_at,
    resolved_by: a.resolved_by,
    resolved_at: a.resolved_at,
    review_outcome: a.review_outcome,
    review_note: a.review_note,
  };
}

export async function listAlerts(ctx: Ctx, user: CaregiverPrincipal, recipientId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  const limit = limitParam(ctx.url);
  const cursor = decodeCursor(ctx.url.searchParams.get("cursor"));
  const status = ctx.url.searchParams.get("status");
  if (status && !["open", "acknowledged", "in_progress", "resolved"].includes(status)) throw invalid("invalid_status", "Unknown status filter.");
  const rows = await ctx.env.DB.prepare(
    `SELECT * FROM alerts WHERE recipient_id = ?1 AND (?2 IS NULL OR status = ?2)
       AND (?3 IS NULL OR triggered_at < ?3 OR (triggered_at = ?3 AND alert_id < ?4))
     ORDER BY triggered_at DESC, alert_id DESC LIMIT ?5`,
  )
    .bind(recipientId, status, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1)
    .all<AlertRow>();
  const items = rows.results.slice(0, limit);
  const last = items[items.length - 1];
  return json({ items: items.map(alertView), next_cursor: rows.results.length > limit && last ? encodeCursor(last.triggered_at, last.alert_id) : null });
}

export async function getAlert(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, alertId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  const alert = await ctx.env.DB.prepare(`SELECT * FROM alerts WHERE alert_id = ?1 AND recipient_id = ?2`).bind(alertId, recipientId).first<AlertRow>();
  if (!alert) throw notFound("Alert not found.");
  const [decision, actions] = await ctx.env.DB.batch([
    ctx.env.DB.prepare(`SELECT * FROM fusion_decisions WHERE decision_id = ?1`).bind(alert.fusion_decision_id),
    ctx.env.DB.prepare(`SELECT action, actor_id, from_status, to_status, review_outcome, note, created_at FROM alert_actions WHERE alert_id = ?1 ORDER BY created_at`).bind(alertId),
  ]);
  const d = decision?.results?.[0] as Record<string, unknown> | undefined;
  return json({
    alert: alertView(alert),
    decision: d ? { ...d, explanation: JSON.parse(String(d.explanation_json)), explanation_json: undefined } : null,
    actions: actions?.results ?? [],
  });
}

export async function actOnAlert(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, alertId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "alerts.act");
  const body = await readJson(ctx.request, AlertActionV1);
  const t = TRANSITIONS[body.action];
  if (!t) throw invalid("invalid_action", "Unknown action.");
  if (body.action === "resolve" && (!body.review_outcome || !body.note || body.note.trim().length === 0)) {
    throw invalid("resolution_incomplete", "Resolving requires review_outcome and a note.");
  }
  if (body.action !== "resolve" && body.review_outcome !== null) throw invalid("unexpected_review_outcome", "review_outcome is only accepted when resolving.");
  const current = await ctx.env.DB.prepare(`SELECT * FROM alerts WHERE alert_id = ?1 AND recipient_id = ?2`).bind(alertId, recipientId).first<AlertRow>();
  if (!current) throw notFound("Alert not found.");
  if (current.version !== body.expected_version || !t.from.includes(current.status)) {
    throw conflict("alert_state_conflict", `Alert is ${current.status} at version ${current.version}.`, { alert: alertView(current) });
  }
  const now = iso(ctx.clock.now());
  // Every variant references ?1..?7 so the bind list is identical (D1 rejects unused bindings).
  const sets =
    body.action === "acknowledge"
      ? `acknowledged_by = ?1, acknowledged_at = ?2, review_outcome = COALESCE(?6, review_outcome), review_note = COALESCE(?7, review_note)`
      : body.action === "resolve"
        ? `resolved_by = ?1, resolved_at = ?2, review_outcome = ?6, review_note = ?7`
        : `acknowledged_by = COALESCE(acknowledged_by, ?1), acknowledged_at = COALESCE(acknowledged_at, ?2), review_outcome = COALESCE(?6, review_outcome), review_note = COALESCE(?7, review_note)`;
  const db = ctx.env.DB;
  try {
    await db.batch([
      guardStatement(db, `SELECT 1 FROM alerts WHERE alert_id = ?1 AND version = ?2 AND status = ?3`, alertId, body.expected_version, current.status),
      db
        .prepare(`UPDATE alerts SET status = ?3, version = version + 1, ${sets} WHERE alert_id = ?4 AND version = ?5`)
        .bind(user.userId, now, t.to, alertId, body.expected_version, body.review_outcome, body.action === "resolve" ? body.note : null),
      db
        .prepare(`INSERT INTO alert_actions (action_id, alert_id, action, actor_id, from_status, to_status, review_outcome, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
        .bind(newId("aac"), alertId, body.action, user.userId, current.status, t.to, body.review_outcome, body.note, now),
      auditStatement(ctx, { actorType: "caregiver", actorId: user.userId, action: `alert.${body.action}`, targetType: "alert", targetId: alertId, recipientId }),
      bumpStreamStatement(ctx, recipientId),
    ]);
  } catch (err) {
    if (isGuardFailure(err)) {
      const latest = await db.prepare(`SELECT * FROM alerts WHERE alert_id = ?1`).bind(alertId).first<AlertRow>();
      throw conflict("alert_state_conflict", "Alert changed concurrently.", { alert: latest ? alertView(latest) : null });
    }
    throw err;
  }
  ctx.exec.waitUntil(notifyRecipient(ctx.env, recipientId, "alert.updated", alertId));
  const updated = await db.prepare(`SELECT * FROM alerts WHERE alert_id = ?1`).bind(alertId).first<AlertRow>();
  return json({ alert: updated ? alertView(updated) : null });
}

export async function listDecisions(ctx: Ctx, user: CaregiverPrincipal, recipientId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "data.read");
  const limit = limitParam(ctx.url);
  const cursor = decodeCursor(ctx.url.searchParams.get("cursor"));
  const rows = await ctx.env.DB.prepare(
    `SELECT * FROM fusion_decisions WHERE recipient_id = ?1 AND (?2 IS NULL OR observed_at < ?2 OR (observed_at = ?2 AND decision_id < ?3))
     ORDER BY observed_at DESC, decision_id DESC LIMIT ?4`,
  )
    .bind(recipientId, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1)
    .all<Record<string, unknown>>();
  const items = rows.results.slice(0, limit).map((d) => {
    const { explanation_json, ...rest } = d;
    return { ...rest, explanation: JSON.parse(String(explanation_json)) };
  });
  const last = items[items.length - 1] as { observed_at: string; decision_id: string } | undefined;
  return json({ items, next_cursor: rows.results.length > limit && last ? encodeCursor(last.observed_at, last.decision_id) : null });
}

/** Human review: the only way a decision becomes verified (a fall did happen) or dismissed. */
export async function reviewDecision(ctx: Ctx, user: CaregiverPrincipal, recipientId: string, decisionId: string): Promise<Response> {
  await requireRecipient(ctx, user, recipientId, "events.verify");
  const body = await readJson(ctx.request, DecisionReviewV1);
  const now = iso(ctx.clock.now());
  const db = ctx.env.DB;
  const decision = await db
    .prepare(`SELECT decision_id, verification_status, trigger_event_id, vision_event_id FROM fusion_decisions WHERE decision_id = ?1 AND recipient_id = ?2`)
    .bind(decisionId, recipientId)
    .first<{ decision_id: string; verification_status: string; trigger_event_id: string | null; vision_event_id: string | null }>();
  if (!decision) throw notFound("Decision not found.");
  if (decision.verification_status !== "unverified") {
    if (decision.verification_status === body.verification) return json({ decision_id: decisionId, verification_status: body.verification, duplicate: true });
    throw conflict("already_reviewed", `Decision was already ${decision.verification_status}.`, { current_status: decision.verification_status });
  }
  try {
    await db.batch([
      guardStatement(db, `SELECT 1 FROM fusion_decisions WHERE decision_id = ?1 AND verification_status = 'unverified'`, decisionId),
      db
        .prepare(`UPDATE fusion_decisions SET verification_status = ?1, verified_by = ?2, verified_at = ?3, verification_note = ?4 WHERE decision_id = ?5`)
        .bind(body.verification, user.userId, now, body.note, decisionId),
      db
        .prepare(`UPDATE events SET verification_status = ?1 WHERE event_id IN (?2, ?3)`)
        .bind(body.verification, decision.trigger_event_id ?? "", decision.vision_event_id ?? ""),
      auditStatement(ctx, { actorType: "caregiver", actorId: user.userId, action: `decision.${body.verification}`, targetType: "fusion_decision", targetId: decisionId, recipientId }),
      bumpStreamStatement(ctx, recipientId),
    ]);
  } catch (err) {
    if (isGuardFailure(err)) throw conflict("already_reviewed", "Decision was reviewed concurrently.");
    throw err;
  }
  ctx.exec.waitUntil(notifyRecipient(ctx.env, recipientId, "decision.reviewed", decisionId));
  return json({ decision_id: decisionId, verification_status: body.verification, duplicate: false });
}
