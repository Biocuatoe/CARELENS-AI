/**
 * Client for the public contact / purchase-request endpoint of the care-monitoring Worker (A43):
 * POST {API}/api/public/v1/contact-requests. No auth, nothing stored in the browser.
 * The server validates everything again; this module only maps its answers to typed results and errors.
 */

export type ContactCategory = "individual_consultation" | "individual_purchase" | "facility_consultation" | "facility_purchase";

/** Notification outcome as reported by the server. Only "sent" means the provider accepted the e-mail. */
export type ContactNotificationStatus = "sent" | "pending" | "failed" | "not_configured";

export interface ContactSubmitResult {
  request_id: string;
  category: ContactCategory;
  received_at: string;
  /** true when the same submission was already stored in the last 24 h; request_id is that earlier request. */
  duplicate: boolean;
  notification: { status: ContactNotificationStatus };
}

export type ContactErrorKind = "no_backend" | "network" | "timeout" | "invalid" | "rate_limited" | "rejected" | "server";

export class ContactSubmitError extends Error {
  constructor(
    readonly kind: ContactErrorKind,
    /** Field names the server rejected (422), e.g. ["email", "phone"]. */
    readonly fields: string[] = [],
  ) {
    super(kind);
    this.name = "ContactSubmitError";
  }
}

/** Same resolution as the Live Demo (src/data/demo/demoAdapter.ts resolveApiBase), kept separate so the landing bundle does
 * not pull in the demo adapter: VITE_API_BASE_URL, else the local backend in development, else no backend. */
export const CONTACT_API_BASE: string | null = (() => {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return import.meta.env.DEV ? "http://127.0.0.1:8787" : null;
})();

export const CONTACT_PATH = "/api/public/v1/contact-requests";

function isResult(v: unknown): v is ContactSubmitResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  const n = r.notification as Record<string, unknown> | undefined;
  return typeof r.request_id === "string" && typeof r.received_at === "string" && typeof r.duplicate === "boolean" && !!n && typeof n.status === "string";
}

export async function submitContactRequest(
  payload: Record<string, unknown>,
  opts: { apiBase?: string | null; signal?: AbortSignal; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ContactSubmitResult> {
  const apiBase = opts.apiBase !== undefined ? opts.apiBase : CONTACT_API_BASE;
  if (!apiBase) throw new ContactSubmitError("no_backend");
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? 20_000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  let res: Response;
  try {
    res = await doFetch(`${apiBase}${CONTACT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      credentials: "omit",
    });
  } catch {
    throw new ContactSubmitError(timedOut ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (res.ok) {
    if (isResult(body)) return body;
    throw new ContactSubmitError("server");
  }
  if (res.status === 422) {
    const fields = Array.isArray((body as { fields?: unknown } | null)?.fields) ? ((body as { fields: unknown[] }).fields.filter((f) => typeof f === "string") as string[]) : [];
    throw new ContactSubmitError("invalid", fields);
  }
  if (res.status === 429) throw new ContactSubmitError("rate_limited");
  if (res.status === 400 || res.status === 403) throw new ContactSubmitError("rejected");
  throw new ContactSubmitError("server");
}
