/**
 * Public contact, consultation and purchase requests from the landing page (A43).
 *
 *   POST /api/public/v1/contact-requests   one route, four categories (discriminated by `category`)
 *
 * Order of work: origin check → per-IP limits → strict validation and normalisation → D1 insert (dedup in the same
 * statement) → notification e-mail through Resend. A request is stored before any e-mail is attempted, so a provider
 * failure never loses it; the response reports the real notification outcome and the maintenance cron retries.
 * This is a purchase *request*: no prices, stock, payment or order confirmation exist anywhere here.
 * Logs carry the request id, category and status codes only, never what the customer typed.
 */
import { z } from "zod";
import type { ContactMailSettings } from "./env";
import { clientIp, type Ctx } from "./context";
import { HttpError, forbidden, json, readJson } from "./http";
import { addSeconds, canonicalJson, iso, localParts, sha256Hex } from "./util";

export const CONTACT_CATEGORIES = ["individual_consultation", "individual_purchase", "facility_consultation", "facility_purchase"] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

/* ---------------------------------------------------------------- validation */

// C0/C1 control characters except tab and newline; zero-width and bidi overrides that could disguise text in the e-mail.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

/** Single line: NFC, controls and newlines removed, whitespace collapsed, trimmed. */
const clean = (s: string) => s.normalize("NFC").replace(/\r\n?/g, "\n").replace(CONTROL, "").replace(/\s+/g, " ").trim();
/** Multi-line: keeps at most two consecutive line breaks. */
const cleanMulti = (s: string) =>
  s
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const blankToNull = (v: unknown) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v);

const line = (max: number) => z.string().max(max * 2).transform(clean).pipe(z.string().min(1).max(max));
const optLine = (max: number) => z.preprocess(blankToNull, z.string().max(max * 2).transform(clean).pipe(z.string().max(max)).nullable()).default(null);
const multi = (max: number) => z.string().max(max * 2).transform(cleanMulti).pipe(z.string().min(1).max(max));
const optMulti = (max: number) => z.preprocess(blankToNull, z.string().max(max * 2).transform(cleanMulti).pipe(z.string().max(max)).nullable()).default(null);

export const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[^\s@<>()[\]\\,;:"'.]{2,}$/;
const email = z
  .string()
  .max(400)
  .transform((s) => clean(s).toLowerCase())
  .pipe(z.string().max(254).regex(EMAIL_PATTERN));

/** Vietnamese and international numbers: optional +, digits and separators, 8-15 digits in total. */
export function phoneOk(s: string): boolean {
  if (!/^\+?[0-9 ().-]{8,24}$/.test(s)) return false;
  const digits = s.replace(/\D/g, "").length;
  return digits >= 8 && digits <= 15;
}
const phone = z
  .string()
  .max(64)
  .transform(clean)
  .pipe(z.string().refine(phoneOk, "invalid phone"));
const optEnum = <T extends readonly [string, ...string[]]>(values: T) => z.preprocess(blankToNull, z.enum(values).nullable()).default(null);
const count = (max: number) => z.preprocess((v) => (typeof v === "string" && /^\d{1,6}$/.test(v.trim()) ? Number(v) : v), z.number().int().min(1).max(max));
const optCount = (max: number) => z.preprocess((v) => (typeof v === "string" && /^\d{1,6}$/.test(v.trim()) ? Number(v) : blankToNull(v)), z.number().int().min(1).max(max).nullable()).default(null);

export const RELATIONSHIPS = ["self", "parent", "grandparent", "other_family", "other"] as const;
export const INTERESTS = ["incident_alerts", "reminders", "daily_summary", "setup_and_use", "privacy", "pricing_and_purchase"] as const;
export const FACILITY_TYPES = ["nursing_home", "hospital", "clinic", "home_care", "rehabilitation", "other"] as const;
export const TIMELINES = ["within_1_month", "1_3_months", "3_6_months", "over_6_months", "undecided"] as const;

/** Version of the privacy notice + consent wording the form showed (frontend CONTACT.privacyNoticeVersion). Changing the
 * wording of CONTACT.privacy or CONTACT.labels.consent means adding a new version here and in the frontend. */
export const PRIVACY_NOTICE_VERSIONS = ["contact-notice-2026-11-06"] as const;

const common = {
  /** Explicit consent to be contacted about this request (Decree 13/2023 style). Must be literally true. */
  consent: z.literal(true),
  privacy_notice_version: z.enum(PRIVACY_NOTICE_VERSIONS),
  /** Honeypot: hidden from people, filled by naive bots. */
  website: z.string().max(500).optional(),
};

const IndividualConsultation = z
  .object({
    category: z.literal("individual_consultation"),
    full_name: line(120),
    phone,
    email,
    relationship: optEnum(RELATIONSHIPS),
    interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).default([]),
    message: multi(2000),
    ...common,
  })
  .strict();

const IndividualPurchase = z
  .object({
    category: z.literal("individual_purchase"),
    full_name: line(120),
    phone,
    email,
    /** Free text: the repo has no approved product catalog, so no SKU or configuration list is offered (A43). */
    product_interest: optLine(200),
    quantity: count(20),
    recipient_name: line(120),
    recipient_phone: phone,
    delivery_address: line(300),
    delivery_notes: optMulti(500),
    message: optMulti(2000),
    ...common,
  })
  .strict();

const FacilityConsultation = z
  .object({
    category: z.literal("facility_consultation"),
    organization: line(200),
    full_name: line(120),
    email,
    phone,
    message: multi(2000),
    facility_type: optEnum(FACILITY_TYPES),
    job_title: optLine(120),
    address: optLine(300),
    care_recipients_estimate: optCount(100_000),
    timeline: optEnum(TIMELINES),
    ...common,
  })
  .strict();

const FacilityPurchase = z
  .object({
    category: z.literal("facility_purchase"),
    organization: line(200),
    full_name: line(120),
    email,
    phone,
    address: line(300),
    device_quantity: count(10_000),
    job_title: optLine(120),
    timeline: optEnum(TIMELINES),
    integration_requirements: optMulti(1000),
    message: optMulti(2000),
    ...common,
  })
  .strict();

export const ContactRequestV1 = z.discriminatedUnion("category", [IndividualConsultation, IndividualPurchase, FacilityConsultation, FacilityPurchase]);
export type ContactRequest = z.infer<typeof ContactRequestV1>;
/** What is stored as payload_json and mailed: the submission without the consent record and the honeypot. */
export type ContactPayload = Omit<ContactRequest, "consent" | "website" | "privacy_notice_version">;

const GROUP: Record<ContactCategory, "individual" | "facility"> = {
  individual_consultation: "individual",
  individual_purchase: "individual",
  facility_consultation: "facility",
  facility_purchase: "facility",
};

/* ---------------------------------------------------------------- labels (e-mail) */

export const SUBJECTS: Record<ContactCategory, string> = {
  individual_consultation: "[CareLens AI] Yêu cầu tư vấn cá nhân mới",
  individual_purchase: "[CareLens AI] Yêu cầu đặt mua thiết bị mới",
  facility_consultation: "[CareLens AI] Yêu cầu tư vấn triển khai cơ sở",
  facility_purchase: "[CareLens AI] Yêu cầu báo giá / đặt mua từ tổ chức",
};
const CATEGORY_LABEL: Record<ContactCategory, string> = {
  individual_consultation: "Tư vấn sản phẩm",
  individual_purchase: "Yêu cầu đặt mua",
  facility_consultation: "Tư vấn triển khai",
  facility_purchase: "Báo giá / đặt mua",
};
const GROUP_LABEL = { individual: "Cá nhân và gia đình", facility: "Cơ sở chăm sóc y tế" } as const;
const ENUM_LABEL: Record<string, string> = {
  self: "Bản thân",
  parent: "Cha hoặc mẹ",
  grandparent: "Ông hoặc bà",
  other_family: "Người thân khác trong gia đình",
  other: "Khác",
  incident_alerts: "Cảnh báo khi có sự cố",
  reminders: "Nhắc uống nước, uống thuốc",
  daily_summary: "Tóm tắt hằng ngày cho người thân",
  setup_and_use: "Lắp đặt và sử dụng thiết bị",
  privacy: "Quyền riêng tư và dữ liệu",
  pricing_and_purchase: "Chi phí và cách đặt mua",
  nursing_home: "Viện dưỡng lão / trung tâm dưỡng lão",
  hospital: "Bệnh viện",
  clinic: "Phòng khám",
  home_care: "Dịch vụ chăm sóc tại nhà",
  rehabilitation: "Cơ sở phục hồi chức năng",
  within_1_month: "Trong 1 tháng",
  "1_3_months": "1–3 tháng",
  "3_6_months": "3–6 tháng",
  over_6_months: "Trên 6 tháng",
  undecided: "Chưa xác định",
};
const FIELD_LABEL: Record<string, string> = {
  organization: "Cơ sở / tổ chức",
  full_name: "Họ và tên",
  job_title: "Chức danh",
  phone: "Số điện thoại",
  email: "Email",
  relationship: "Quan hệ với người được chăm sóc",
  interests: "Quan tâm chính",
  product_interest: "Sản phẩm / cấu hình quan tâm",
  quantity: "Số lượng",
  recipient_name: "Người nhận",
  recipient_phone: "Số điện thoại người nhận",
  delivery_address: "Địa chỉ giao hàng",
  delivery_notes: "Ghi chú giao hàng",
  facility_type: "Loại cơ sở",
  address: "Địa chỉ cơ sở",
  care_recipients_estimate: "Số người được chăm sóc (ước tính)",
  device_quantity: "Số lượng thiết bị (ước tính)",
  timeline: "Thời gian dự kiến triển khai",
  integration_requirements: "Yêu cầu lắp đặt / tích hợp",
  message: "Lời nhắn",
};
const FIELD_ORDER = Object.keys(FIELD_LABEL);

function displayValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length ? value.map((v) => ENUM_LABEL[String(v)] ?? String(v)).join(", ") : null;
  if (typeof value === "number") return String(value);
  const s = String(value);
  return ENUM_LABEL[s] ?? s;
}

export function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export interface ContactEmail {
  subject: string;
  html: string;
  text: string;
  replyTo: string | null;
}

/** Builds the notification. Every customer value is escaped; the template has no links, images or remote content. */
export function buildContactEmail(requestId: string, createdAt: string, payload: ContactPayload, timezone: string): ContactEmail {
  const category = payload.category;
  const p = localParts(new Date(createdAt), timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)} (${timezone})`;
  const record = payload as unknown as Record<string, unknown>;
  const rows: Array<[string, string]> = [
    ["Mã yêu cầu", requestId],
    ["Thời điểm gửi", `${local} · ${createdAt}`],
    ["Nhóm khách hàng", GROUP_LABEL[GROUP[category]]],
    ["Loại yêu cầu", CATEGORY_LABEL[category]],
  ];
  for (const key of FIELD_ORDER) {
    if (key === "message") continue;
    const v = displayValue(record[key]);
    if (v !== null) rows.push([FIELD_LABEL[key] as string, v]);
  }
  const message = typeof record.message === "string" && record.message ? record.message : null;

  const text = [
    SUBJECTS[category],
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Lời nhắn:",
    message ?? "(không có)",
    "",
    "Đây là yêu cầu, chưa phải đơn hàng đã xác nhận. Trả lời thư này để phản hồi trực tiếp khách hàng.",
  ].join("\n");

  const td = "padding:8px 12px;border-bottom:1px solid #e3e6e3;vertical-align:top;font-size:14px;line-height:1.5;";
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(SUBJECTS[category])}</title></head>
<body style="margin:0;padding:24px;background:#f2f0e9;font-family:Arial,Helvetica,sans-serif;color:#26363e;">
<div style="max-width:640px;margin:0 auto;background:#fafbf8;border:1px solid #dcdfdb;border-radius:12px;padding:24px;">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#245f5a;">CareLens AI · ${escapeHtml(GROUP_LABEL[GROUP[category]])}</p>
<h1 style="margin:0 0 16px;font-size:20px;color:#14232d;">${escapeHtml(CATEGORY_LABEL[category])} · ${escapeHtml(requestId)}</h1>
<table role="presentation" style="width:100%;border-collapse:collapse;">
${rows.map(([k, v]) => `<tr><th scope="row" style="${td}text-align:left;width:38%;color:#4b5a61;font-weight:600;">${escapeHtml(k)}</th><td style="${td}white-space:pre-wrap;">${escapeHtml(v)}</td></tr>`).join("\n")}
</table>
<h2 style="margin:20px 0 8px;font-size:15px;color:#14232d;">Lời nhắn</h2>
<div style="white-space:pre-wrap;font-size:14px;line-height:1.6;padding:12px;background:#f2f0e9;border-radius:8px;">${message ? escapeHtml(message) : "(không có)"}</div>
<p style="margin:20px 0 0;font-size:12px;color:#4b5a61;">Đây là yêu cầu, chưa phải đơn hàng đã xác nhận. Trả lời thư này để phản hồi trực tiếp khách hàng.</p>
</div></body></html>`;
  return { subject: SUBJECTS[category], html, text, replyTo: EMAIL_PATTERN.test(payload.email) ? payload.email : null };
}

/* ---------------------------------------------------------------- provider */

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type SendOutcome = { ok: true; providerId: string | null } | { ok: false; error: string };

/** Sends through Resend. The idempotency key makes a retry after a lost response not produce a second e-mail.
 * Only the HTTP status and the provider's error *name* are kept; the provider's message may echo addresses. */
export async function sendViaResend(doFetch: typeof fetch, mail: ContactMailSettings, requestId: string, email: ContactEmail): Promise<SendOutcome> {
  let res: Response;
  try {
    res = await doFetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${mail.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `contact-${requestId}`,
        "user-agent": "care-monitoring-worker",
      },
      body: JSON.stringify({
        from: mail.from,
        to: mail.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        tags: [{ name: "kind", value: "contact_request" }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError") ? "timeout" : "network_error" };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (res.ok) {
    const id = body && typeof body === "object" && typeof (body as { id?: unknown }).id === "string" ? (body as { id: string }).id : null;
    return { ok: true, providerId: id && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null };
  }
  const name = body && typeof body === "object" && typeof (body as { name?: unknown }).name === "string" ? (body as { name: string }).name : "";
  return { ok: false, error: `http_${res.status}${/^[a-z_]{1,48}$/.test(name) ? `:${name}` : ""}` };
}

/* ---------------------------------------------------------------- persistence + notification */

/** Crockford base32 without I, L, O, U. Reference shown to the customer, e.g. CL-261104-7KQ3MZ. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function referenceId(now: Date, timezone: string): string {
  const p = localParts(now, timezone);
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let tail = "";
  for (const b of bytes) tail += ALPHABET[b & 31];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `CL-${String(p.year).slice(2)}${pad(p.month)}${pad(p.day)}-${tail}`;
}

export const MAX_NOTIFICATION_ATTEMPTS = 6;
const DEDUP_WINDOW_SECONDS = 24 * 3600;
/** Resend keeps an idempotency key for 24 h. Every attempt happens after created_at, so while created_at is less than
 * 23 h old any earlier attempt is still inside the window and a retry with the same key cannot produce a second e-mail.
 * After that, a request that already had an attempt (possibly accepted) is not retried. */
const IDEMPOTENCY_SAFE_SECONDS = 23 * 3600;
/** A 'sending' row older than this was interrupted (the provider call itself times out after 10 s). */
const STALE_SENDING_SECONDS = 300;
/** The per-network hash is only needed for the one-hour submission count; it is cleared after this. */
const RATE_KEY_KEEP_SECONDS = 2 * 3600;
/** A request never attempted (stored before mail was configured) is still sent up to this age. */
const SEND_WINDOW_SECONDS = 30 * 86_400;

interface StoredRow {
  request_id: string;
  category: ContactCategory;
  payload_json: string;
  created_at: string;
  notification_status: string;
  notification_attempts: number;
  notification_last_attempt_at: string | null;
}

/** Claims the row for one send, sends, records the outcome. The claim is a compare-and-set on the status *and* the attempt
 * count that were read, so of several concurrent callers (request handler, overlapping cron runs) exactly one sends,
 * including for an interrupted 'sending' row whose status alone would match every caller. */
async function notify(ctx: Ctx, row: Pick<StoredRow, "request_id" | "payload_json" | "created_at" | "notification_status" | "notification_attempts">): Promise<string> {
  const mail = ctx.config.contactMail;
  if (!mail) return "not_configured";
  const db = ctx.env.DB;
  const now = iso(ctx.clock.now());
  const claimed = await db
    .prepare(
      `UPDATE contact_requests SET notification_status = 'sending', notification_attempts = notification_attempts + 1, notification_last_attempt_at = ?1,
         notification_error = NULL
       WHERE request_id = ?2 AND notification_status = ?3 AND notification_attempts = ?4 RETURNING notification_attempts`,
    )
    .bind(now, row.request_id, row.notification_status, row.notification_attempts)
    .first<{ notification_attempts: number }>();
  if (!claimed) return "sending";
  const payload = JSON.parse(row.payload_json) as ContactPayload;
  const outcome = await sendViaResend(ctx.outboundFetch ?? fetch, mail, row.request_id, buildContactEmail(row.request_id, row.created_at, payload, ctx.config.reportTimezone));
  const status = outcome.ok ? "sent" : claimed.notification_attempts >= MAX_NOTIFICATION_ATTEMPTS ? "abandoned" : "failed";
  await db
    .prepare(
      `UPDATE contact_requests SET notification_status = ?1, notification_sent_at = ?2, notification_provider_id = ?3, notification_error = ?4
       WHERE request_id = ?5 AND notification_status = 'sending' AND notification_attempts = ?6`,
    )
    .bind(status, outcome.ok ? iso(ctx.clock.now()) : null, outcome.ok ? outcome.providerId : null, outcome.ok ? null : outcome.error, row.request_id, claimed.notification_attempts)
    .run();
  console.log(JSON.stringify({ msg: "contact_notification", request_id: row.request_id, status, attempt: claimed.notification_attempts, error: outcome.ok ? null : outcome.error }));
  return status;
}

function publicStatus(status: string): "sent" | "pending" | "failed" | "not_configured" {
  if (status === "sent") return "sent";
  if (status === "not_configured") return "not_configured";
  if (status === "pending" || status === "sending") return "pending";
  return "failed";
}

function allowedOrigin(ctx: Ctx): boolean {
  const origin = ctx.request.headers.get("origin");
  return origin !== null && ctx.config.allowedOrigins.includes(origin);
}

/** POST /api/public/v1/contact-requests */
export async function submitContactRequest(ctx: Ctx): Promise<Response> {
  // Browser-only form: a request must come from the web app's origin (CORS alone would not stop a non-browser client).
  if (!allowedOrigin(ctx)) throw forbidden("origin_not_allowed", "Submissions are accepted from the CareLens AI website only.");

  const ip = clientIp(ctx.request) || "unknown";
  const limiter = ctx.env.CONTACT_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key: `contact:${ip}` });
    if (!success) throw new HttpError(429, "too_many_requests", "Too many requests", "Too many submissions from this network. Please try again in a few minutes.", { "retry-after": "60" });
  }

  const body = await readJson(ctx.request, ContactRequestV1, 16 * 1024);
  if (body.website && body.website.trim() !== "") {
    console.log(JSON.stringify({ msg: "contact_rejected", request_id: ctx.requestId, reason: "honeypot" }));
    throw new HttpError(400, "submission_rejected", "Submission rejected", "The submission could not be accepted.");
  }
  const { consent: _consent, website: _website, privacy_notice_version: noticeVersion, ...payload } = body;
  void _consent;
  void _website;

  const now = ctx.clock.now();
  const nowIso = iso(now);
  const db = ctx.env.DB;
  const ipDay = await sha256Hex(`contact:${ip}:${nowIso.slice(0, 10)}`);
  const dedup = await sha256Hex(canonicalJson(payload));

  const recent = await db
    .prepare(`SELECT COUNT(*) AS n FROM contact_requests WHERE ip_day_sha256 = ?1 AND created_at >= ?2`)
    .bind(ipDay, iso(addSeconds(now, -3600)))
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= ctx.config.contactMaxPerHour) {
    throw new HttpError(429, "too_many_requests", "Too many requests", "Too many submissions from this network. Please try again later.", { "retry-after": "900" });
  }

  const initialStatus = ctx.config.contactMail ? "pending" : "not_configured";
  const dedupSince = iso(addSeconds(now, -DEDUP_WINDOW_SECONDS));
  let inserted: StoredRow | null = null;
  const payloadJson = JSON.stringify(payload);
  try {
    for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
      // Insert unless the same submission arrived in the last 24 h (one statement, so a double click cannot store two rows).
      inserted = await db
        .prepare(
          `INSERT INTO contact_requests (request_id, category, customer_group, payload_json, dedup_sha256, ip_day_sha256, created_at, notification_status,
             consent_at, privacy_notice_version, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7, ?10, ?7
           WHERE NOT EXISTS (SELECT 1 FROM contact_requests WHERE dedup_sha256 = ?5 AND created_at >= ?9)
           ON CONFLICT (request_id) DO NOTHING
           RETURNING request_id, category, payload_json, created_at, notification_status, notification_attempts, notification_last_attempt_at`,
        )
        .bind(referenceId(now, ctx.config.reportTimezone), payload.category, GROUP[payload.category], payloadJson, dedup, ipDay, nowIso, initialStatus, dedupSince, noticeVersion)
        .first<StoredRow>();
      if (!inserted) {
        const existing = await db
          .prepare(`SELECT request_id, created_at, notification_status FROM contact_requests WHERE dedup_sha256 = ?1 AND created_at >= ?2 ORDER BY created_at DESC LIMIT 1`)
          .bind(dedup, dedupSince)
          .first<{ request_id: string; created_at: string; notification_status: string }>();
        if (existing) {
          console.log(JSON.stringify({ msg: "contact_duplicate", request_id: existing.request_id, category: payload.category }));
          return json({ request_id: existing.request_id, category: payload.category, received_at: existing.created_at, duplicate: true, notification: { status: publicStatus(existing.notification_status) } });
        }
      }
    }
  } catch (err) {
    console.error(JSON.stringify({ msg: "contact_store_failed", request_id: ctx.requestId, error: err instanceof Error ? err.name : "unknown" }));
    throw new HttpError(503, "submission_not_stored", "Submission not stored", "The request could not be saved. Please try again.");
  }
  if (!inserted) throw new HttpError(503, "submission_not_stored", "Submission not stored", "The request could not be saved. Please try again.");

  console.log(JSON.stringify({ msg: "contact_stored", request_id: inserted.request_id, category: inserted.category }));
  let status = inserted.notification_status;
  if (ctx.config.contactMail) {
    try {
      status = await notify(ctx, inserted);
    } catch (err) {
      // The row is stored; a failure while recording the outcome leaves it for the cron (stale 'sending' is retried).
      console.error(JSON.stringify({ msg: "contact_notification_error", request_id: inserted.request_id, error: err instanceof Error ? err.name : "unknown" }));
      status = "failed";
    }
  }
  return json(
    { request_id: inserted.request_id, category: inserted.category, received_at: inserted.created_at, duplicate: false, notification: { status: publicStatus(status) } },
    201,
  );
}

/** Cron: sends notifications that are pending (stored, not yet attempted, e.g. the handler died), were stored before mail was
 * configured, failed, or were left 'sending' by an interrupted attempt. Backoff 2^attempts minutes (max 60); at most `limit`
 * sends per run to stay inside the per-invocation D1 budget. Rows created in the last minute are left to the request handler.
 * A request that already had an attempt is only retried inside the provider's idempotency window (IDEMPOTENCY_SAFE_SECONDS);
 * after it, or when an interrupted attempt was the last one allowed, it is closed as 'abandoned' instead of risking a
 * second e-mail. notification_error then keeps the last known error, or 'outcome_unknown' for an interrupted send.
 * A request never attempted that is older than the 30-day send window is closed as abandoned ('not_sent_expired').
 * Closed requests (A44) are not notified any more: an operator has already handled them. */
export async function retryContactNotifications(ctx: Ctx, limit = 3): Promise<number> {
  if (!ctx.config.contactMail) return 0;
  const now = ctx.clock.now();
  const db = ctx.env.DB;
  const idempotentSince = iso(addSeconds(now, -IDEMPOTENCY_SAFE_SECONDS));
  const staleBefore = iso(addSeconds(now, -STALE_SENDING_SECONDS));
  await db
    .prepare(
      `UPDATE contact_requests SET notification_status = 'abandoned', notification_error = COALESCE(notification_error, 'outcome_unknown')
       WHERE (notification_status = 'failed' AND notification_attempts > 0 AND created_at < ?1)
          OR (notification_status = 'sending' AND notification_last_attempt_at < ?2 AND (notification_attempts >= ?3 OR created_at < ?1))`,
    )
    .bind(idempotentSince, staleBefore, MAX_NOTIFICATION_ATTEMPTS)
    .run();
  await db
    .prepare(
      `UPDATE contact_requests SET notification_status = 'abandoned', notification_error = 'not_sent_expired'
       WHERE notification_status IN ('pending', 'not_configured') AND notification_attempts = 0 AND created_at < ?1`,
    )
    .bind(iso(addSeconds(now, -SEND_WINDOW_SECONDS)))
    .run();
  const rows = await db
    .prepare(
      `SELECT request_id, category, payload_json, created_at, notification_status, notification_attempts, notification_last_attempt_at FROM contact_requests
       WHERE ((notification_status IN ('pending', 'not_configured') AND created_at >= ?1)
           OR (notification_status IN ('failed', 'sending') AND created_at >= ?2))
         AND notification_attempts < ?3 AND created_at < ?4 AND handling_status = 'open'
         AND (notification_last_attempt_at IS NULL OR notification_last_attempt_at < ?4)
       ORDER BY created_at LIMIT 20`,
    )
    .bind(iso(addSeconds(now, -SEND_WINDOW_SECONDS)), idempotentSince, MAX_NOTIFICATION_ATTEMPTS, iso(addSeconds(now, -60)))
    .all<StoredRow>();
  let sent = 0;
  for (const r of rows.results) {
    if (sent >= limit) break;
    const last = r.notification_last_attempt_at ? Date.parse(r.notification_last_attempt_at) : 0;
    const wait = r.notification_status === "sending" ? STALE_SENDING_SECONDS : Math.min(60 * 2 ** r.notification_attempts, 3600);
    if (last && now.getTime() - last < wait * 1000) continue;
    sent++;
    await notify(ctx, r);
  }
  return sent;
}

/** Cron: clears the per-network hash once the one-hour submission count no longer needs it. SHA-256 of an IPv4 address
 * plus a known date can be reversed by enumeration, so keeping it would amount to keeping the address. */
export async function clearContactRateKeys(ctx: Ctx): Promise<number> {
  const res = await ctx.env.DB.prepare(`UPDATE contact_requests SET ip_day_sha256 = '' WHERE ip_day_sha256 <> '' AND created_at < ?1`)
    .bind(iso(addSeconds(ctx.clock.now(), -RATE_KEY_KEEP_SECONDS)))
    .run();
  return res.meta.changes ?? 0;
}

/* ---------------------------------------------------------------- retention (A44, owner-approved 2026-11-06) */

/** Closed requests (by an operator or for inactivity) are deleted this long after closed_at. */
export const CLOSED_RETENTION_DAYS = 180;
/** An open request with no handling update for this many calendar months is closed automatically. */
export const INACTIVITY_CLOSE_MONTHS = 12;
/** Rows closed and rows deleted per cron run (each), so one run stays well inside the D1 per-invocation budget. */
export const RETENTION_BATCH = 100;

/** Open requests last updated before this instant are closed for inactivity: the same UTC instant 12 calendar months
 * earlier. A date that does not exist in the earlier year (29 Feb) rolls forward to 1 Mar, as JavaScript dates do. */
export function inactivityCutoff(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - INACTIVITY_CLOSE_MONTHS);
  return d;
}

/** Deletion time of a request closed at `closedAt`: exactly 180 x 24 h later. */
export function purgeAfter(closedAt: Date): Date {
  return addSeconds(closedAt, CLOSED_RETENTION_DAYS * 86_400);
}

/**
 * Cron: closes inactive open requests and deletes closed requests whose purge_after has passed. Both are single
 * statements that re-check their condition on the rows they touch, bounded by RETENTION_BATCH, so overlapping cron runs
 * neither close a row twice nor fail on a row another run already deleted, and a backlog drains over several runs.
 * Only contact_requests is touched; its notification record is part of the same row and goes with it.
 * D1 Time Travel backups and e-mail copies are NOT affected by this (docs/DEPLOYMENT_RUNBOOK.md §17).
 */
export async function applyContactRetention(ctx: Ctx): Promise<{ closed: number; deleted: number }> {
  const now = ctx.clock.now();
  const nowIso = iso(now);
  const db = ctx.env.DB;
  const cutoff = iso(inactivityCutoff(now));
  const closedRes = await db
    .prepare(
      `UPDATE contact_requests SET handling_status = 'closed', closed_at = ?1, close_reason = 'inactivity', purge_after = ?2
       WHERE handling_status = 'open' AND updated_at < ?3
         AND request_id IN (SELECT request_id FROM contact_requests WHERE handling_status = 'open' AND updated_at < ?3 ORDER BY updated_at LIMIT ?4)`,
    )
    .bind(nowIso, iso(purgeAfter(now)), cutoff, RETENTION_BATCH)
    .run();
  const deletedRes = await db
    .prepare(
      `DELETE FROM contact_requests WHERE handling_status = 'closed' AND purge_after IS NOT NULL AND purge_after <= ?1
         AND request_id IN (SELECT request_id FROM contact_requests WHERE handling_status = 'closed' AND purge_after <= ?1 ORDER BY purge_after LIMIT ?2)`,
    )
    .bind(nowIso, RETENTION_BATCH)
    .run();
  const closed = closedRes.meta.changes ?? 0;
  const deleted = deletedRes.meta.changes ?? 0;
  if (closed || deleted) console.log(JSON.stringify({ msg: "contact_retention", closed, deleted }));
  return { closed, deleted };
}
