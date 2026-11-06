/** Public contact / purchase-request form (A43): strict validation, D1 persistence, dedup, rate limits, honest notification
 * status, the e-mail payload sent to the provider (a fake fetch, nothing leaves the test) and secret hygiene.
 * Synthetic identities only (example.invalid / 0900 000 xxx). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_NOTIFICATION_ATTEMPTS, PRIVACY_NOTICE_VERSIONS, RESEND_ENDPOINT, buildContactEmail, escapeHtml, phoneOk, type ContactPayload } from "../src/contact";
import type { Env } from "../src/env";
import { freshDb, harness, ok, problemCode, type Harness } from "./helpers";

const ORIGIN = "http://localhost:5173";
const NOTICE = PRIVACY_NOTICE_VERSIONS[0];
const FAKE_KEY = "re_test_FAKEKEY_0123456789";
const MAIL: Partial<Env> = { CONTACT_NOTIFICATION_TO: "owner@example.invalid", CONTACT_FROM_EMAIL: "CareLens AI <lienhe@example.invalid>", RESEND_API_KEY: FAKE_KEY };

const individualConsultation = {
  category: "individual_consultation",
  full_name: "Nguyễn Văn Thử",
  phone: "0900 000 001",
  email: "Khach.Thu@Example.invalid",
  relationship: "parent",
  interests: ["reminders", "setup_and_use"],
  message: "Xin chào CareLens AI, tôi muốn tìm hiểu về giải pháp.",
  consent: true,
  privacy_notice_version: NOTICE,
  website: "",
};
const individualPurchase = {
  category: "individual_purchase",
  full_name: "Trần Thị Thử",
  phone: "+84 900 000 002",
  email: "mua@example.invalid",
  product_interest: "",
  quantity: 2,
  recipient_name: "Người Nhận Thử",
  recipient_phone: "0900000003",
  delivery_address: "Số 1 Đường Thử, Quận Thử, TP Thử",
  delivery_notes: "Giao giờ hành chính",
  message: "Xin chào CareLens AI, tôi muốn đăng ký yêu cầu đặt mua thiết bị.",
  consent: true,
  privacy_notice_version: NOTICE,
};
const facilityConsultation = {
  category: "facility_consultation",
  organization: "Trung tâm Dưỡng lão Thử",
  full_name: "Lê Văn Thử",
  email: "lienhe@coso.example.invalid",
  phone: "028 0000 0004",
  message: "Chúng tôi muốn trao đổi về khả năng triển khai thử nghiệm.",
  facility_type: "nursing_home",
  job_title: "Giám đốc",
  address: null,
  care_recipients_estimate: "40",
  timeline: "1_3_months",
  consent: true,
  privacy_notice_version: NOTICE,
};
const facilityPurchase = {
  category: "facility_purchase",
  organization: "Phòng khám Thử",
  full_name: "Phạm Thị Thử",
  email: "muasam@coso.example.invalid",
  phone: "0900000005",
  address: "Số 2 Đường Thử, TP Thử",
  device_quantity: 25,
  timeline: "undecided",
  integration_requirements: "Cần hướng dẫn lắp đặt",
  message: "",
  consent: true,
  privacy_notice_version: NOTICE,
};

let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter % 250}`;

function submit(h: Harness, json: unknown, opts: { ip?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  return h.call("POST", "/api/public/v1/contact-requests", { json, headers, ip: opts.ip ?? nextIp() });
}

interface Row {
  request_id: string;
  category: string;
  customer_group: string;
  payload_json: string;
  notification_status: string;
  notification_attempts: number;
  notification_provider_id: string | null;
  notification_error: string | null;
}
const row = (h: Harness, id: string) => h.env.DB.prepare(`SELECT * FROM contact_requests WHERE request_id = ?1`).bind(id).first<Row>();
const countRows = async (h: Harness) => (await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM contact_requests`).first<{ n: number }>())?.n ?? 0;

interface Sent {
  url: string;
  headers: Headers;
  body: { from: string; to: string[]; subject: string; html: string; text: string; reply_to?: string };
}
function fakeProvider(responses: Array<Response | Error>) {
  const sent: Sent[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Sent["body"] });
    const next = responses.length > 1 ? responses.shift()! : responses[0]!;
    if (next instanceof Error) throw next;
    return next.clone();
  }) as typeof fetch;
  return { sent, impl };
}
const accepted = () => new Response(JSON.stringify({ id: "msg_fake_0001" }), { status: 200, headers: { "content-type": "application/json" } });
const rejected = () => new Response(JSON.stringify({ name: "validation_error", message: "The owner@example.invalid domain is not verified" }), { status: 403, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  await freshDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("contact requests: validation and persistence", () => {
  it("accepts all four categories, stores each with its category and group, and reports notifications as not configured", async () => {
    const h = harness();
    const cases = [
      [individualConsultation, "individual"],
      [individualPurchase, "individual"],
      [facilityConsultation, "facility"],
      [facilityPurchase, "facility"],
    ] as const;
    for (const [payload, group] of cases) {
      const res = await submit(h, payload);
      const body = await ok<{ request_id: string; category: string; received_at: string; duplicate: boolean; notification: { status: string } }>(res, 201);
      expect(body.request_id).toMatch(/^CL-\d{6}-[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(body).toMatchObject({ category: payload.category, duplicate: false, notification: { status: "not_configured" }, received_at: "2026-10-19T03:00:00.000Z" });
      const stored = (await row(h, body.request_id))!;
      expect(stored).toMatchObject({ category: payload.category, customer_group: group, notification_status: "not_configured", notification_attempts: 0 });
      // Consent record: when and under which notice wording; kept outside the payload (and outside the e-mail).
      expect(stored).toMatchObject({ consent_at: "2026-10-19T03:00:00.000Z", privacy_notice_version: NOTICE });
      const p = JSON.parse(stored.payload_json) as Record<string, unknown>;
      expect(p).not.toHaveProperty("consent");
      expect(p).not.toHaveProperty("website");
      expect(p).not.toHaveProperty("privacy_notice_version");
    }
    expect(await countRows(h)).toBe(4);
  });

  it("requires a known privacy-notice version with the consent", async () => {
    const h = harness();
    for (const version of [undefined, "contact-notice-1999-01-01"]) {
      const res = await submit(h, { ...individualConsultation, privacy_notice_version: version });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { fields: string[] }).fields).toContain("privacy_notice_version");
    }
    expect(await countRows(h)).toBe(0);
  });

  it("clears the per-network hash once the hourly count no longer needs it", async () => {
    const h = harness();
    const { request_id } = await ok<{ request_id: string }>(await submit(h, individualConsultation), 201);
    const hash = async () => (await h.env.DB.prepare(`SELECT ip_day_sha256 AS v FROM contact_requests WHERE request_id = ?1`).bind(request_id).first<{ v: string }>())!.v;
    h.clock.advance(3600);
    await h.cron("* * * * *");
    expect(await hash()).toMatch(/^[0-9a-f]{64}$/);
    h.clock.advance(3601);
    await h.cron("* * * * *");
    expect(await hash()).toBe("");
  });

  it("normalises values on the server: lower-cased e-mail, trimmed single lines, numeric strings, blanks to null", async () => {
    const h = harness();
    const res = await submit(h, { ...facilityConsultation, full_name: "  Lê   Văn\nThử ", email: " LienHe@Coso.Example.invalid ", job_title: "   " });
    const { request_id } = await ok<{ request_id: string }>(res, 201);
    const p = JSON.parse((await row(h, request_id))!.payload_json) as Record<string, unknown>;
    expect(p).toMatchObject({ full_name: "Lê Văn Thử", email: "lienhe@coso.example.invalid", job_title: null, address: null, care_recipients_estimate: 40 });
  });

  it.each([
    ["missing required field", { ...individualConsultation, phone: undefined }, "phone"],
    ["bad e-mail", { ...individualConsultation, email: "khong-phai-email" }, "email"],
    ["bad phone", { ...individualConsultation, phone: "12ab" }, "phone"],
    ["too few phone digits", { ...individualConsultation, phone: "0900 00" }, "phone"],
    ["consent not given", { ...individualConsultation, consent: false }, "consent"],
    ["unknown field", { ...individualConsultation, diagnosis: "x" }, "body"],
    ["over-long name", { ...individualConsultation, full_name: "a".repeat(121) }, "full_name"],
    ["empty required message", { ...facilityConsultation, message: "   " }, "message"],
    ["quantity out of range", { ...individualPurchase, quantity: 0 }, "quantity"],
    ["device quantity not an integer", { ...facilityPurchase, device_quantity: 2.5 }, "device_quantity"],
    ["unknown enum", { ...individualConsultation, relationship: "neighbour" }, "relationship"],
    ["unknown category", { ...individualConsultation, category: "enterprise_inquiry" }, "category"],
    ["purchase without delivery address", { ...individualPurchase, delivery_address: "" }, "delivery_address"],
    ["facility purchase without organisation address", { ...facilityPurchase, address: "" }, "address"],
  ])("rejects %s with 422 and names the field", async (_name, payload, field) => {
    const h = harness();
    const res = await submit(h, payload);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; fields: string[] };
    expect(body.code).toBe("invalid_payload");
    expect(body.fields.join(",")).toContain(field);
    expect(await countRows(h)).toBe(0);
  });

  it("rejects non-JSON, oversized bodies and requests without the website's origin", async () => {
    const h = harness();
    const ip = nextIp();
    const text = await h.call("POST", "/api/public/v1/contact-requests", { body: "x", headers: { origin: ORIGIN, "content-type": "text/plain" }, ip });
    expect(text.status).toBe(415);
    const big = await submit(h, { ...individualConsultation, message: "a".repeat(17_000) });
    expect(big.status).toBe(413);
    expect(await problemCode(await submit(h, individualConsultation, { origin: null }))).toBe("origin_not_allowed");
    expect(await problemCode(await submit(h, individualConsultation, { origin: "https://evil.example" }))).toBe("origin_not_allowed");
    expect(await countRows(h)).toBe(0);
  });

  it("rejects a filled honeypot without storing anything", async () => {
    const h = harness();
    const res = await submit(h, { ...individualConsultation, website: "http://spam.example" });
    expect(res.status).toBe(400);
    expect(await problemCode(res)).toBe("submission_rejected");
    expect(await countRows(h)).toBe(0);
  });

  it("answers an identical resubmission within 24 h with the same reference instead of a second row", async () => {
    const h = harness();
    const first = await ok<{ request_id: string }>(await submit(h, individualPurchase), 201);
    h.clock.advance(30);
    const again = await submit(h, individualPurchase);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ request_id: first.request_id, duplicate: true });
    expect(await countRows(h)).toBe(1);
    // A changed submission is a new request; the same one after 24 h is stored again.
    await ok(await submit(h, { ...individualPurchase, quantity: 3 }), 201);
    h.clock.advance(24 * 3600 + 1);
    await ok(await submit(h, individualPurchase), 201);
    expect(await countRows(h)).toBe(3);
  });

  it("limits submissions per network per hour (CONTACT_MAX_PER_HOUR)", async () => {
    const h = harness(undefined, { CONTACT_MAX_PER_HOUR: "2" });
    const ip = nextIp();
    await ok(await submit(h, individualConsultation, { ip }), 201);
    h.clock.advance(61);
    await ok(await submit(h, { ...individualConsultation, message: "Lần hai" }, { ip }), 201);
    h.clock.advance(61);
    const third = await submit(h, { ...individualConsultation, message: "Lần ba" }, { ip });
    expect(third.status).toBe(429);
    expect(await problemCode(third)).toBe("too_many_requests");
    // Another network is unaffected; the first one may submit again after an hour.
    await ok(await submit(h, { ...individualConsultation, message: "Mạng khác" }), 201);
    h.clock.advance(3600);
    await ok(await submit(h, { ...individualConsultation, message: "Sau một giờ" }, { ip }), 201);
  });

  it("reports a storage failure as an error, never as success", async () => {
    const h = harness();
    await h.env.DB.prepare(`DROP TABLE contact_requests`).run();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await submit(h, individualConsultation);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).not.toBe(201);
    expect(JSON.stringify(err.mock.calls)).not.toContain("Nguyễn Văn Thử");
  });
});

describe("contact requests: e-mail notification", () => {
  it("sends one e-mail with the category subject, all fields, reply-to and an idempotency key, and records it as sent", async () => {
    const provider = fakeProvider([accepted()]);
    const h = harness(undefined, MAIL, { outboundFetch: provider.impl });
    const body = await ok<{ request_id: string; notification: { status: string } }>(await submit(h, facilityPurchase), 201);
    expect(body.notification.status).toBe("sent");
    expect(provider.sent).toHaveLength(1);
    const s = provider.sent[0]!;
    expect(s.url).toBe(RESEND_ENDPOINT);
    expect(s.headers.get("authorization")).toBe(`Bearer ${FAKE_KEY}`);
    expect(s.headers.get("idempotency-key")).toBe(`contact-${body.request_id}`);
    expect(s.body).toMatchObject({ from: "CareLens AI <lienhe@example.invalid>", to: ["owner@example.invalid"], subject: "[CareLens AI] Yêu cầu báo giá / đặt mua từ tổ chức", reply_to: "muasam@coso.example.invalid" });
    for (const part of [body.request_id, "Phòng khám Thử", "Phạm Thị Thử", "0900000005", "Số 2 Đường Thử, TP Thử", "25", "Chưa xác định", "Cần hướng dẫn lắp đặt", "Cơ sở chăm sóc y tế", "Báo giá / đặt mua", "10:00 (Asia/Ho_Chi_Minh)"]) {
      expect(s.body.html).toContain(escapeHtml(part));
      expect(s.body.text).toContain(part);
    }
    expect((await row(h, body.request_id))!).toMatchObject({ notification_status: "sent", notification_attempts: 1, notification_provider_id: "msg_fake_0001", notification_error: null });
  });

  it("uses the right subject for each category", async () => {
    const provider = fakeProvider([accepted()]);
    const h = harness(undefined, MAIL, { outboundFetch: provider.impl });
    for (const p of [individualConsultation, individualPurchase, facilityConsultation, facilityPurchase]) await ok(await submit(h, p), 201);
    expect(provider.sent.map((s) => s.body.subject)).toEqual([
      "[CareLens AI] Yêu cầu tư vấn cá nhân mới",
      "[CareLens AI] Yêu cầu đặt mua thiết bị mới",
      "[CareLens AI] Yêu cầu tư vấn triển khai cơ sở",
      "[CareLens AI] Yêu cầu báo giá / đặt mua từ tổ chức",
    ]);
  });

  it("escapes customer text in the HTML e-mail", () => {
    const payload = { ...individualConsultation, full_name: `<script>alert("x")</script>`, message: `<img src=x onerror=alert(1)>\nDòng 2`, relationship: "parent", interests: [] } as unknown as ContactPayload;
    const mail = buildContactEmail("CL-261019-ABCDEFGH", "2026-10-19T03:00:00.000Z", payload, "Asia/Ho_Chi_Minh");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(mail.text).toContain(`<script>alert("x")</script>`);
  });

  it("keeps the request and reports 'failed' when the provider rejects it; the cron retries and records the later success", async () => {
    const provider = fakeProvider([rejected(), accepted()]);
    const h = harness(undefined, MAIL, { outboundFetch: provider.impl });
    const log = vi.spyOn(console, "log");
    const body = await ok<{ request_id: string; notification: { status: string } }>(await submit(h, individualConsultation), 201);
    expect(body.notification.status).toBe("failed");
    expect((await row(h, body.request_id))!).toMatchObject({ notification_status: "failed", notification_attempts: 1, notification_error: "http_403:validation_error" });
    // The provider's message (which echoes an address) is not stored.
    expect((await row(h, body.request_id))!.notification_error).not.toContain("@");
    // Backoff: not retried within 2 minutes after the first attempt.
    h.clock.advance(61);
    await h.cron("* * * * *");
    expect(provider.sent).toHaveLength(1);
    h.clock.advance(120);
    await h.cron("* * * * *");
    expect(provider.sent).toHaveLength(2);
    expect(provider.sent[1]!.headers.get("idempotency-key")).toBe(`contact-${body.request_id}`);
    expect((await row(h, body.request_id))!).toMatchObject({ notification_status: "sent", notification_attempts: 2 });
    // Logs: ids and codes only.
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(FAKE_KEY);
    expect(logged).not.toContain("khach.thu@example.invalid");
    expect(logged).not.toContain("Nguyễn Văn Thử");
    expect(logged).not.toContain("0900 000 001");
  });

  it("reports network errors as failed and gives up after the maximum number of attempts", async () => {
    const provider = fakeProvider([new TypeError("network down")]);
    const h = harness(undefined, MAIL, { outboundFetch: provider.impl });
    const body = await ok<{ request_id: string; notification: { status: string } }>(await submit(h, individualPurchase), 201);
    expect(body.notification.status).toBe("failed");
    expect((await row(h, body.request_id))!.notification_error).toBe("network_error");
    for (let i = 0; i < 10; i++) {
      h.clock.advance(3601);
      await h.cron("* * * * *");
    }
    expect(provider.sent).toHaveLength(MAX_NOTIFICATION_ATTEMPTS);
    expect((await row(h, body.request_id))!).toMatchObject({ notification_status: "abandoned", notification_attempts: MAX_NOTIFICATION_ATTEMPTS });
  });

  it("sends requests stored before mail was configured once it is", async () => {
    const unconfigured = harness();
    const { request_id } = await ok<{ request_id: string }>(await submit(unconfigured, facilityConsultation), 201);
    const provider = fakeProvider([accepted()]);
    const configured = harness(unconfigured.clock, MAIL, { outboundFetch: provider.impl });
    configured.clock.advance(120);
    await configured.cron("* * * * *");
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.body.subject).toBe("[CareLens AI] Yêu cầu tư vấn triển khai cơ sở");
    expect((await row(configured, request_id))!.notification_status).toBe("sent");
  });

  it("never returns the API key, and /ready only says whether notifications are configured", async () => {
    const provider = fakeProvider([accepted()]);
    const h = harness(undefined, MAIL, { outboundFetch: provider.impl });
    const res = await submit(h, individualConsultation);
    expect(await res.text()).not.toContain(FAKE_KEY);
    const ready = await (await h.call("GET", "/ready")).text();
    expect(ready).toContain(`"contact_notifications":"configured"`);
    expect(ready).not.toContain(FAKE_KEY);
    expect(ready).not.toContain("owner@example.invalid");
    const off = await (await harness().call("GET", "/ready")).text();
    expect(off).toContain(`"contact_notifications":"not_configured"`);
    const bad = await (await harness(undefined, { ...MAIL, CONTACT_FROM_EMAIL: "not an address" }).call("GET", "/ready")).text();
    expect(bad).toContain(`"contact_notifications":"misconfigured"`);
    expect(bad).not.toContain("not an address");
  });

  it("a malformed mail setting still stores the request (notification not configured)", async () => {
    const h = harness(undefined, { ...MAIL, CONTACT_NOTIFICATION_TO: "x" });
    const body = await ok<{ notification: { status: string } }>(await submit(h, individualConsultation), 201);
    expect(body.notification.status).toBe("not_configured");
  });
});

/** Behaves like Resend's idempotency (docs: a key is kept 24 h; the same key and payload returns the original response
 * without sending again). `delivered` counts e-mails that would really have left the provider. */
function idempotentProvider(delayMs = 20) {
  const calls: string[] = [];
  const delivered = new Map<string, string>();
  const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const key = new Headers(init?.headers).get("idempotency-key") ?? "";
    calls.push(key);
    await new Promise((r) => setTimeout(r, delayMs));
    if (!delivered.has(key)) delivered.set(key, `msg_fake_${delivered.size + 1}`);
    return new Response(JSON.stringify({ id: delivered.get(key) }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, delivered, impl };
}
const timeoutError = () => Object.assign(new Error("timed out"), { name: "TimeoutError" });
const setNotification = (h: Harness, id: string, sql: string, ...binds: unknown[]) =>
  h.env.DB.prepare(`UPDATE contact_requests SET ${sql} WHERE request_id = ?1`).bind(id, ...binds).run();

describe("contact requests: notification retry safety", () => {
  it("an interrupted send (provider accepted, outcome not recorded) is retried once with the same key, even when two cron runs overlap", async () => {
    const provider = idempotentProvider();
    const h = harness(undefined, MAIL, { outboundFetch: provider.impl });
    const { request_id } = await ok<{ request_id: string }>(await submit(h, individualConsultation), 201);
    // The Worker died after the provider accepted the e-mail but before D1 recorded it.
    await setNotification(h, request_id, `notification_status = 'sending', notification_sent_at = NULL, notification_provider_id = NULL`);
    h.clock.advance(301);
    await Promise.all([h.cron("* * * * *"), h.cron("* * * * *")]);
    expect(provider.calls).toEqual([`contact-${request_id}`, `contact-${request_id}`]);
    expect(provider.delivered.size).toBe(1);
    expect((await row(h, request_id))!).toMatchObject({ notification_status: "sent", notification_attempts: 2, notification_provider_id: "msg_fake_1" });
  });

  it("overlapping cron runs claim a failed notification only once", async () => {
    const provider = fakeProvider([rejected(), accepted()]);
    const h = harness(undefined, MAIL, { outboundFetch: provider.impl });
    const { request_id } = await ok<{ request_id: string }>(await submit(h, facilityConsultation), 201);
    h.clock.advance(121);
    await Promise.all([h.cron("* * * * *"), h.cron("* * * * *"), h.cron("* * * * *")]);
    expect(provider.sent).toHaveLength(2);
    expect((await row(h, request_id))!).toMatchObject({ notification_status: "sent", notification_attempts: 2 });
  });

  it("after a timeout (outcome unknown) it retries with the same key inside the provider's 24 h window, never after it", async () => {
    const provider = fakeProvider([timeoutError(), accepted()]);
    const h = harness(undefined, MAIL, { outboundFetch: provider.impl });
    const body = await ok<{ request_id: string; notification: { status: string } }>(await submit(h, individualPurchase), 201);
    expect(body.notification.status).toBe("failed");
    expect((await row(h, body.request_id))!.notification_error).toBe("timeout");
    h.clock.advance(121);
    await h.cron("* * * * *");
    expect(provider.sent.map((s) => s.headers.get("idempotency-key"))).toEqual([`contact-${body.request_id}`, `contact-${body.request_id}`]);

    // Same timeout, but the retry only becomes possible a day later (e.g. mail settings removed and restored):
    // a second send could no longer be de-duplicated by the provider, so the request is closed as abandoned instead.
    const late = fakeProvider([timeoutError(), accepted()]);
    const h2 = harness(undefined, MAIL, { outboundFetch: late.impl });
    const second = await ok<{ request_id: string }>(await submit(h2, facilityPurchase), 201);
    h2.clock.advance(23 * 3600 + 1);
    await h2.cron("* * * * *");
    expect(late.sent).toHaveLength(1);
    expect((await row(h2, second.request_id))!).toMatchObject({ notification_status: "abandoned", notification_error: "timeout", notification_attempts: 1 });
  });

  it("a send interrupted on the last allowed attempt ends as abandoned with an unknown outcome, not 'sending' forever", async () => {
    const provider = fakeProvider([accepted()]);
    const h = harness(undefined, MAIL, { outboundFetch: provider.impl });
    const { request_id } = await ok<{ request_id: string }>(await submit(h, individualConsultation), 201);
    await setNotification(h, request_id, `notification_status = 'sending', notification_attempts = ?2, notification_sent_at = NULL`, MAX_NOTIFICATION_ATTEMPTS);
    h.clock.advance(301);
    await h.cron("* * * * *");
    expect(provider.sent).toHaveLength(1);
    expect((await row(h, request_id))!).toMatchObject({ notification_status: "abandoned", notification_error: "outcome_unknown" });
  });

  it("a stored request whose handler died before sending is picked up by the cron after a minute, not sooner", async () => {
    const provider = idempotentProvider();
    const h = harness(undefined, MAIL, { outboundFetch: provider.impl });
    const { request_id } = await ok<{ request_id: string }>(await submit(h, facilityConsultation), 201);
    // The handler stored the row (pending) and died before its own attempt.
    await setNotification(h, request_id, `notification_status = 'pending', notification_attempts = 0, notification_last_attempt_at = NULL, notification_sent_at = NULL`);
    provider.calls.length = 0;
    h.clock.advance(30);
    await h.cron("* * * * *");
    expect(provider.calls).toHaveLength(0);
    h.clock.advance(31);
    await h.cron("* * * * *");
    expect(provider.calls).toHaveLength(1);
    expect((await row(h, request_id))!).toMatchObject({ notification_status: "sent", notification_attempts: 1 });
  });

  it("requests stored before mail was configured are sent later once, as a first attempt", async () => {
    const unconfigured = harness();
    const { request_id } = await ok<{ request_id: string }>(await submit(unconfigured, individualConsultation), 201);
    const provider = idempotentProvider();
    const configured = harness(unconfigured.clock, MAIL, { outboundFetch: provider.impl });
    configured.clock.advance(2 * 86_400);
    await Promise.all([configured.cron("* * * * *"), configured.cron("* * * * *")]);
    await configured.cron("* * * * *");
    expect(provider.calls).toHaveLength(1);
    expect((await row(configured, request_id))!).toMatchObject({ notification_status: "sent", notification_attempts: 1 });
  });
});

describe("contact requests: unit", () => {
  it("phone format", () => {
    for (const good of ["0900000001", "0900 000 001", "+84 90 000 0001", "(028) 3800-0000"]) expect(phoneOk(good), good).toBe(true);
    for (const bad of ["12345", "abc0900000001", "+84 90 000 0001 2345 6789", "09000000x1"]) expect(phoneOk(bad), bad).toBe(false);
  });
});
