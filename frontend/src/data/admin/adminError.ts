/** Errors of the admin API client. Own file so the response parsers (adminModels.ts) and the client can both use it without a cycle. */

export type AdminErrorCode =
  | "unauthenticated" // 401: no/expired/revoked session, or a bad one-time code
  | "forbidden" // 403
  | "rate_limited" // 429
  | "not_configured" // 503 admin_signin_not_configured / admin_not_configured / google_not_configured
  | "misconfigured" // 503 misconfigured
  | "bad_request" // 400/413/415/422
  | "not_found" // 404: the thing is gone, or an older server does not have this API yet
  | "conflict" // 409
  | "unavailable" // network failure or other 5xx
  | "timeout" // no answer within the client time limit: the outcome of a mutation is unknown
  | "origin_blocked" // server answers but refuses this page's origin (CORS)
  | "no_backend" // this build has no VITE_API_BASE_URL
  | "invalid_response"; // 2xx with a body that does not match the contract

/** Deliberately not an ApiError: the viewer's `isAuthError` must not treat an admin failure as the viewer's session ending. */
export class AdminApiError extends Error {
  readonly status: number;
  readonly code: AdminErrorCode;
  /** The server's machine-readable problem code (e.g. "schedule_in_past"), for logic only; never shown to the user. */
  readonly problem: string | null;
  constructor(status: number, code: AdminErrorCode, message: string, problem: string | null = null) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.problem = problem;
  }
}

export const isAdminApiError = (error: unknown): error is AdminApiError => error instanceof AdminApiError;
/** 401 and 403 both end the admin session on the client; the server stays the authority. */
export const isAdminAuthFailure = (error: unknown): boolean => isAdminApiError(error) && (error.code === "unauthenticated" || error.code === "forbidden");
