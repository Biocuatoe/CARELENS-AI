/** Contact-request retention and operator access (A44, owner-approved 2026-11-06): retention dates, automatic closure of
 * inactive requests, deletion 180 days after closure, overlapping cron runs, admin-only access without customer data in
 * lists, audited reads and erasure, and no customer data on public endpoints. Synthetic identities only. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSED_RETENTION_DAYS, MAX_NOTIFICATION_ATTEMPTS, PRIVACY_NOTICE_VERSIONS, RETENTION_BATCH, inactivityCutoff, purgeAfter } from "../src/contact";
import type { Env } from "../src/env";
import { ADMIN_TOKEN, dbAll, dbFirst, freshDb, harness, ok, provision, type Harness } from "./helpers";

const ORIGIN = "http://localhost:5173";
const NOTICE = PRIVACY_NOTICE_VERSIONS[0];
const DAY = 86_400;
const PII = ["Người Thử Lưu Giữ", "luugiu@example.invalid", "0900 000 077", "Số 9 Đường Lưu Giữ"];
const person = {
  category: "individual_purchase",
  full_name: "Người Thử Lưu Giữ",
  phone: "0900 000 077",
  email: "luugiu@example.invalid",
  quantity: 1,
  recipient_name: "Người Thử Lưu Giữ",
  recipient_phone: "0900 000 077",
  delivery_address: "Số 9 Đường Lưu Giữ",
  message: "Xin chào CareLens AI",
  consent: true,
  privacy_notice_version: NOTICE,
};
const MAIL: Partial<Env> = { CONTACT_NOTIFICATION_TO: "owner@example.invalid", CONTACT_FROM_EMAIL: "CareLens AI <lienhe@example.invalid>", RESEND_API_KEY: "re_test_FAKEKEY_retention" };

let seq = 0;
async function store(h: Harness): Promise<string> {
  seq++;
  const res = await h.call("POST", "/api/public/v1/contact-requests", { json: { ...person, message: `${person.message} #${seq}` }, headers: { origin: ORIGIN }, ip: `192.0.2.${seq % 250}` });
  return (await ok<{ request_id: string }>(res, 201)).request_id;
}
const asAdmin = (h: Harness, method: string, path: string) => h.call(method, path, { token: ADMIN_TOKEN });
interface State {
  handling_status: string;
  updated_at: string;
  closed_at: string | null;
  close_reason: string | null;
  purge_after: string | null;
}
const state = (id: string) => dbFirst<State>(`SELECT handling_status, updated_at, closed_at, close_reason, purge_after FROM contact_requests WHERE request_id = ?1`, id);
const count = async (table: string) => (await dbFirst<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;
const at = (h: Harness) => new Date(h.clock.t).toISOString();

beforeEach(async () => {
  await freshDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("contact retention: dates", () => {
  it("deletes 180 days after closure and closes after 12 calendar months without an update", () => {
    expect(CLOSED_RETENTION_DAYS).toBe(180);
    expect(purgeAfter(new Date("2026-11-06T00:00:00.000Z")).toISOString()).toBe("2027-05-05T00:00:00.000Z");
    expect(purgeAfter(new Date("2027-12-31T23:59:59.000Z")).toISOString()).toBe("2028-06-28T23:59:59.000Z");
    expect(inactivityCutoff(new Date("2026-11-06T10:00:00.000Z")).toISOString()).toBe("2025-11-06T10:00:00.000Z");
    expect(inactivityCutoff(new Date("2026-03-31T00:00:00.000Z")).toISOString()).toBe("2025-03-31T00:00:00.000Z");
    // 29 Feb has no counterpart a year earlier: it rolls forward to 1 Mar.
    expect(inactivityCutoff(new Date("2028-02-29T12:00:00.000Z")).toISOString()).toBe("2027-03-01T12:00:00.000Z");
  });

  it("only the current privacy-notice version is accepted (frontend CONTACT.privacyNoticeVersion)", async () => {
    expect(PRIVACY_NOTICE_VERSIONS).toEqual(["contact-notice-2026-11-06"]);
    const h = harness();
    const res = await h.call("POST", "/api/public/v1/contact-requests", { json: { ...person, privacy_notice_version: "contact-notice-2026-11-04" }, headers: { origin: ORIGIN }, ip: "192.0.2.251" });
    expect(res.status).toBe(422);
    const id = await store(h);
    expect(await dbFirst(`SELECT privacy_notice_version, consent_at, created_at, updated_at FROM contact_requests WHERE request_id = ?1`, id)).toEqual({
      privacy_notice_version: NOTICE,
      consent_at: "2026-10-19T03:00:00.000Z",
      created_at: "2026-10-19T03:00:00.000Z",
      updated_at: "2026-10-19T03:00:00.000Z",
    });
  });
});

describe("contact retention: automatic closure and deletion", () => {
  it("closes an open request after 12 months without an update, then deletes it 180 days after that closure", async () => {
    const h = harness();
    const old = await store(h);
    h.clock.advance(30 * DAY);
    const newer = await store(h);
    // One second before the 12-month mark: still open.
    h.clock.set("2027-10-19T02:59:59.000Z");
    await h.cron("* * * * *");
    expect((await state(old))!.handling_status).toBe("open");
    h.clock.set("2027-10-19T03:00:01.000Z");
    await h.cron("* * * * *");
    const closedAt = at(h);
    expect(await state(old)).toMatchObject({ handling_status: "closed", close_reason: "inactivity", closed_at: closedAt, purge_after: purgeAfter(new Date(closedAt)).toISOString(), updated_at: "2026-10-19T03:00:00.000Z" });
    expect((await state(newer))!.handling_status).toBe("open");
    // Deleted at closed_at + 180 days, not a second earlier; the notification record goes with the row.
    h.clock.set(new Date(Date.parse(closedAt) + CLOSED_RETENTION_DAYS * DAY * 1000 - 1000).toISOString());
    await h.cron("* * * * *");
    expect(await state(old)).not.toBeNull();
    h.clock.advance(1);
    await h.cron("* * * * *");
    expect(await state(old)).toBeNull();
    expect(await dbFirst(`SELECT request_id FROM contact_requests WHERE request_id = ?1`, old)).toBeNull();
    // The newer request was closed for inactivity in the meantime (its own 12 months passed) but is not due yet.
    expect((await state(newer))!.handling_status).toBe("closed");
  });

  it("an operator close is deleted 180 days after closed_at; repeating close keeps the dates; reopening cancels deletion", async () => {
    const h = harness();
    const a = await store(h);
    const b = await store(h);
    h.clock.advance(10 * DAY);
    const closed = await ok<{ handling: { closed_at: string; purge_after: string; close_reason: string }; changed: boolean }>(await asAdmin(h, "POST", `/api/admin/v1/contact-requests/${a}/close`));
    expect(closed).toMatchObject({ changed: true, handling: { close_reason: "operator", closed_at: at(h), purge_after: purgeAfter(h.clock.now()).toISOString() } });
    await ok(await asAdmin(h, "POST", `/api/admin/v1/contact-requests/${b}/close`));
    h.clock.advance(DAY);
    const again = await ok<{ handling: { closed_at: string }; changed: boolean }>(await asAdmin(h, "POST", `/api/admin/v1/contact-requests/${a}/close`));
    expect(again).toMatchObject({ changed: false, handling: { closed_at: closed.handling.closed_at } });
    await ok(await asAdmin(h, "POST", `/api/admin/v1/contact-requests/${b}/reopen`));
    expect(await state(b)).toMatchObject({ handling_status: "open", closed_at: null, close_reason: null, purge_after: null, updated_at: at(h) });
    h.clock.set(closed.handling.purge_after);
    await h.cron("* * * * *");
    expect(await state(a)).toBeNull();
    expect((await state(b))!.handling_status).toBe("open");
  });

  it("recording activity on an open request restarts the 12-month period", async () => {
    const h = harness();
    const id = await store(h);
    h.clock.set("2027-09-01T00:00:00.000Z");
    await ok(await asAdmin(h, "POST", `/api/admin/v1/contact-requests/${id}/reopen`));
    h.clock.set("2027-10-20T00:00:00.000Z");
    await h.cron("* * * * *");
    expect((await state(id))!.handling_status).toBe("open");
    h.clock.set("2028-09-01T00:00:01.000Z");
    await h.cron("* * * * *");
    expect((await state(id))!.close_reason).toBe("inactivity");
  });

  it("never touches monitoring, device or audit data", async () => {
    const h = harness();
    await provision(h);
    await store(h);
    // `jobs` is left out of the equality: the same cron run legitimately creates daily-report jobs (reports.ts). It may only grow.
    const tables = ["care_recipients", "devices", "caregivers", "caregiver_tokens", "grants", "agents", "events", "alerts", "device_commands", "audit_log"];
    const before = await Promise.all(tables.map(count));
    const jobsBefore = await count("jobs");
    h.clock.set("2028-12-31T00:00:00.000Z");
    await h.cron("* * * * *");
    h.clock.set("2029-12-31T00:00:00.000Z");
    await h.cron("* * * * *");
    expect(await count("contact_requests")).toBe(0);
    expect(await Promise.all(tables.map(count))).toEqual(before);
    expect(await count("jobs")).toBeGreaterThanOrEqual(jobsBefore);
  });
});

describe("contact retention: overlapping and bounded maintenance", () => {
  it("overlapping cron runs close each request once and delete each once, without errors", async () => {
    const h = harness();
    const ids = [await store(h), await store(h), await store(h), await store(h)];
    const errors = vi.spyOn(console, "error");
    h.clock.set("2027-11-01T00:00:00.000Z");
    await Promise.all([h.cron("* * * * *"), h.cron("* * * * *"), h.cron("* * * * *")]);
    const states = await Promise.all(ids.map(state));
    expect(new Set(states.map((s) => s!.closed_at))).toEqual(new Set(["2027-11-01T00:00:00.000Z"]));
    expect(states.every((s) => s!.close_reason === "inactivity")).toBe(true);
    h.clock.set("2028-05-01T00:00:00.000Z");
    await Promise.all([h.cron("* * * * *"), h.cron("* * * * *"), h.cron("* * * * *")]);
    await h.cron("* * * * *");
    expect(await count("contact_requests")).toBe(0);
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/contact_retention_error|contact_retry_error/);
  });

  it("closes and deletes at most RETENTION_BATCH rows per run; a backlog drains over the next runs", async () => {
    const h = harness();
    const total = RETENTION_BATCH + 5;
    const db = h.env.DB;
    const insert = db.prepare(
      `INSERT INTO contact_requests (request_id, category, customer_group, payload_json, dedup_sha256, ip_day_sha256, created_at, consent_at, privacy_notice_version,
         notification_status, updated_at) VALUES (?1, 'individual_consultation', 'individual', '{}', ?2, '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?3, 'not_configured', '2026-01-01T00:00:00.000Z')`,
    );
    await db.batch(Array.from({ length: total }, (_, i) => insert.bind(`CL-260101-${String(i).padStart(8, "0")}`, `dedup-${i}`, NOTICE)));
    h.clock.set("2027-06-01T00:00:00.000Z");
    await h.cron("* * * * *");
    expect(await dbAll(`SELECT handling_status, COUNT(*) AS n FROM contact_requests GROUP BY handling_status ORDER BY handling_status`)).toEqual([
      { handling_status: "closed", n: RETENTION_BATCH },
      { handling_status: "open", n: 5 },
    ]);
    h.clock.advance(60);
    await h.cron("* * * * *");
    expect(await count("contact_requests")).toBe(total);
    h.clock.set("2028-01-01T00:00:00.000Z");
    await h.cron("* * * * *");
    expect(await count("contact_requests")).toBe(5);
    await h.cron("* * * * *");
    expect(await count("contact_requests")).toBe(0);
  });
});

describe("contact requests: operator access", () => {
  it("every operator route requires the admin credential; a caregiver token is not enough", async () => {
    const h = harness();
    const world = await provision(h);
    const id = await store(h);
    const routes: Array<[string, string]> = [
      ["GET", "/api/admin/v1/contact-requests"],
      ["GET", `/api/admin/v1/contact-requests/${id}`],
      ["POST", `/api/admin/v1/contact-requests/${id}/close`],
      ["POST", `/api/admin/v1/contact-requests/${id}/reopen`],
      ["DELETE", `/api/admin/v1/contact-requests/${id}`],
    ];
    for (const [method, path] of routes) {
      for (const token of [null, world.caregiverToken, "not-a-token"]) {
        const res = await h.call(method, path, { token });
        expect(res.status, `${method} ${path} with ${token ? "wrong" : "no"} token`).toBe(401);
        expect(await res.text()).not.toContain("luugiu@example.invalid");
      }
    }
    expect(await state(id)).toMatchObject({ handling_status: "open" });
    // No public route reads or deletes a stored request by its reference.
    for (const method of ["GET", "DELETE"]) {
      const res = await h.call(method, `/api/public/v1/contact-requests/${id}`, { headers: { origin: ORIGIN } });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    expect(await state(id)).not.toBeNull();
  });

  it("lists permanently failed and ambiguous notifications for the operator, without customer data", async () => {
    const network = (async () => {
      throw new TypeError("network down");
    }) as typeof fetch;
    const h = harness(undefined, MAIL, { outboundFetch: network });
    const failed = await store(h);
    const interrupted = await store(h);
    // `handled`: stored while mail was off and closed by the team before mail came back, so it is never notified.
    const handled = await store(harness(h.clock));
    await ok(await asAdmin(h, "POST", `/api/admin/v1/contact-requests/${handled}/close`));
    // `interrupted`: an attempt cut off on its last allowed try (may have been delivered).
    await h.env.DB.prepare(`UPDATE contact_requests SET notification_status = 'sending', notification_attempts = ?2, notification_error = NULL WHERE request_id = ?1`)
      .bind(interrupted, MAX_NOTIFICATION_ATTEMPTS)
      .run();
    for (let i = 0; i < 8; i++) {
      h.clock.advance(3601);
      await h.cron("* * * * *");
    }
    const list = await ok<{ items: Array<{ request_id: string; notification: Record<string, unknown> }>; counts: { notification: Record<string, number>; handling: Record<string, number> }; notifications: string }>(
      await asAdmin(h, "GET", "/api/admin/v1/contact-requests?notification_status=abandoned"),
    );
    expect(list.notifications).toBe("configured");
    expect(new Set(list.items.map((i) => i.request_id))).toEqual(new Set([failed, interrupted]));
    expect(list.items.find((i) => i.request_id === failed)!.notification).toMatchObject({ status: "abandoned", error: "network_error", needs_operator: true, outcome_unknown: false, attempts: MAX_NOTIFICATION_ATTEMPTS });
    expect(list.items.find((i) => i.request_id === interrupted)!.notification).toMatchObject({ status: "abandoned", error: "outcome_unknown", outcome_unknown: true, needs_operator: true });
    expect(list.counts.notification).toMatchObject({ abandoned: 2, not_configured: 1 });
    expect(list.counts.handling).toEqual({ open: 2, closed: 1 });
    const all = await asAdmin(h, "GET", "/api/admin/v1/contact-requests");
    const text = await all.text();
    expect(text).toContain(handled);
    for (const value of PII) expect(text).not.toContain(value);
    expect(text).not.toContain("payload");
    expect((await asAdmin(h, "GET", "/api/admin/v1/contact-requests?notification_status=bogus")).status).toBe(400);
  });

  it("detail shows the customer's data to the operator and audits the read without copying the data", async () => {
    const h = harness();
    const id = await store(h);
    const detail = await ok<{ payload: Record<string, unknown>; consent: Record<string, unknown> }>(await asAdmin(h, "GET", `/api/admin/v1/contact-requests/${id}`));
    expect(detail.payload).toMatchObject({ full_name: "Người Thử Lưu Giữ", email: "luugiu@example.invalid" });
    expect(detail.consent).toEqual({ consent_at: "2026-10-19T03:00:00.000Z", privacy_notice_version: NOTICE });
    const audit = await dbAll<{ action: string; target_id: string; detail_json: string | null }>(`SELECT action, target_id, detail_json FROM audit_log WHERE target_type = 'contact_request'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "contact_request.view", target_id: id });
    for (const value of PII) expect(JSON.stringify(audit)).not.toContain(value);
    expect((await asAdmin(h, "GET", "/api/admin/v1/contact-requests/CL-000000-AAAAAAAA")).status).toBe(404);
    expect((await asAdmin(h, "GET", "/api/admin/v1/contact-requests/not-a-reference")).status).toBe(404);
  });

  it("erasure on a verified request deletes the row now, is audited without customer data, and says what it does not cover", async () => {
    const h = harness();
    const id = await store(h);
    const other = await store(h);
    const res = await ok<{ erased: boolean; not_covered: string[] }>(await asAdmin(h, "DELETE", `/api/admin/v1/contact-requests/${id}`));
    expect(res.erased).toBe(true);
    expect(res.not_covered).toEqual(["email_copies", "d1_time_travel_history", "provider_logs"]);
    expect(await state(id)).toBeNull();
    expect(await state(other)).not.toBeNull();
    expect((await asAdmin(h, "DELETE", `/api/admin/v1/contact-requests/${id}`)).status).toBe(404);
    const audit = await dbAll<{ action: string; detail_json: string }>(`SELECT action, detail_json FROM audit_log WHERE target_id = ?1`, id);
    expect(audit.map((a) => a.action)).toEqual(["contact_request.erase"]);
    for (const value of PII) expect(JSON.stringify(audit)).not.toContain(value);
  });
});

describe("contact requests: public endpoints carry no customer data", () => {
  it("/ready and /health after submissions report only whether notifications are configured", async () => {
    const h = harness(undefined, MAIL, { outboundFetch: (async () => new Response(JSON.stringify({ id: "msg_fake" }), { status: 200 })) as typeof fetch });
    const ids = [await store(h), await store(h)];
    for (const path of ["/ready", "/health"]) {
      const text = await (await h.call("GET", path)).text();
      for (const value of [...PII, ...ids, "owner@example.invalid", "lienhe@example.invalid", "re_test_FAKEKEY_retention"]) expect(text, `${path} leaks ${value}`).not.toContain(value);
    }
    expect(await (await h.call("GET", "/ready")).text()).toContain(`"contact_notifications":"configured"`);
  });
});
