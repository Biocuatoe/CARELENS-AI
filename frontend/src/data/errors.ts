/** Lỗi theo hình dạng application/problem+json (ARCHITECTURE §6.6). */
export type ApiErrorCode =
  | "unauthenticated"
  | "session_expired"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "auth_unavailable"
  | "api_unavailable"
  | "internal";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly requestId: string;
  readonly fieldErrors: Record<string, string> | undefined;
  readonly current: unknown;

  constructor(
    status: number,
    code: ApiErrorCode,
    detail: string,
    options: { fieldErrors?: Record<string, string>; current?: unknown } = {},
  ) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = `req_${Math.random().toString(36).slice(2, 10)}`;
    this.fieldErrors = options.fieldErrors;
    this.current = options.current;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAuthError(error: unknown): boolean {
  return isApiError(error) && (error.code === "unauthenticated" || error.code === "session_expired");
}

export function isAccessError(error: unknown): boolean {
  return isApiError(error) && (error.status === 403 || error.status === 404);
}

export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  return "Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.";
}
