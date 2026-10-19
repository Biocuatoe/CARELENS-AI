/** HTTP plumbing: problem+json errors, bounded body reading, JSON responses, CORS. */
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail: string,
    readonly headers: Record<string, string> = {},
    readonly extra: Record<string, unknown> = {},
  ) {
    super(`${status} ${code}: ${detail}`);
  }
}

export function problem(err: HttpError, requestId: string): Response {
  return new Response(
    JSON.stringify({
      type: `urn:carelens:problem:${err.code}`,
      title: err.title,
      status: err.status,
      detail: err.detail,
      code: err.code,
      request_id: requestId,
      ...err.extra,
    }),
    { status: err.status, headers: { "content-type": "application/problem+json", ...err.headers } },
  );
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export const badRequest = (code: string, detail: string, extra: Record<string, unknown> = {}) =>
  new HttpError(400, code, "Bad request", detail, {}, extra);
export const invalid = (code: string, detail: string, extra: Record<string, unknown> = {}) =>
  new HttpError(422, code, "Invalid payload", detail, {}, extra);
export const notFound = (detail = "Not found") => new HttpError(404, "not_found", "Not found", detail);
export const conflict = (code: string, detail: string, extra: Record<string, unknown> = {}) =>
  new HttpError(409, code, "Conflict", detail, {}, extra);
export const forbidden = (code: string, detail: string) => new HttpError(403, code, "Forbidden", detail);
export const unauthorized = () =>
  new HttpError(401, "invalid_credential", "Invalid credential", "A valid bearer token is required.", {
    "www-authenticate": "Bearer",
  });
export const unavailable = (code: string, detail: string) => new HttpError(503, code, "Service unavailable", detail);

/** Reads at most `limit` bytes. Rejects a declared or actual larger body with 413 before buffering it. */
export async function readBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0) throw badRequest("invalid_content_length", "Content-Length is not a number.");
    if (n > limit) throw new HttpError(413, "payload_too_large", "Payload too large", `Body exceeds ${limit} bytes.`);
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new HttpError(413, "payload_too_large", "Payload too large", `Body exceeds ${limit} bytes.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T, limit = 64 * 1024): Promise<z.infer<T>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Unsupported media type", "Content-Type must be application/json.");
  }
  const bytes = await readBody(request, limit);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw badRequest("invalid_json", "Body is not valid UTF-8 JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "body"))].sort();
    throw invalid("invalid_payload", `Invalid fields: ${fields.join(", ")}`, { fields });
  }
  return parsed.data;
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type, Idempotency-Key, Last-Event-ID",
    "access-control-expose-headers": "X-Request-ID",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

export function withHeaders(response: Response, headers: Record<string, string>): Response {
  // A 101 WebSocket response or an SSE stream must keep its body object; copy headers onto a new Response.
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

/** Cursor = base64url of [sort key, id]. Opaque to clients. */
export function encodeCursor(key: string, id: string): string {
  return btoa(JSON.stringify([key, id])).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeCursor(cursor: string | null): [string, string] | null {
  if (!cursor) return null;
  try {
    const padded = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const value = JSON.parse(atob(padded)) as unknown;
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string") {
      return [value[0], value[1]];
    }
  } catch {
    /* fall through */
  }
  throw badRequest("invalid_cursor", "cursor is malformed.");
}

export function limitParam(url: URL, fallback = 50, max = 200): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) throw badRequest("invalid_limit", `limit must be an integer in [1, ${max}].`);
  return n;
}
