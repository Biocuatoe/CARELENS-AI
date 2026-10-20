import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { AdminApiError, AdminClient, isAdminAuthFailure, type AdminProfile } from "../data/admin/adminClient";
import { xhrUploader } from "../data/admin/xhrUpload";
import { InlineError, LoadingState } from "../design-system/feedback";
import { SoftButton } from "../design-system/primitives";

export type AdminSignedOutReason = "expired" | "forbidden" | "logout" | "logout_unconfirmed" | null;

export type AdminAuthState =
  | { status: "signed_out"; reason: AdminSignedOutReason }
  /** A session exists but the server has not yet confirmed it with GET /api/admin/v1/me. Nothing privileged renders. */
  | { status: "verifying" }
  | { status: "signed_in"; profile: AdminProfile }
  /** The session could not be confirmed because the server was unreachable or answered with an error (not 401/403). */
  | { status: "unverified"; error: AdminApiError };

interface AdminAuthContextValue {
  state: AdminAuthState;
  /** The API client, for calls that need no session (the sign-in page checks whether the server can sign anyone in). */
  client: AdminClient;
  /** Trades the one-time code from the Google callback for a session and confirms it with /me. Throws AdminApiError. */
  signInWithCode: (code: string) => Promise<void>;
  /** Asks the server who this session is. `maxAgeMs` skips the call when it was confirmed that recently. Throws AdminApiError. */
  verify: (options?: { maxAgeMs?: number }) => Promise<void>;
  signOut: () => Promise<void>;
  /** Runs an admin API call with the current session. A 401/403 ends the session here, so no page has to remember to. */
  run: <T>(call: (client: AdminClient, token: string) => Promise<T>) => Promise<T>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

/** Longest setTimeout delay browsers accept (a signed 32-bit millisecond count). */
const MAX_TIMER_MS = 2_147_000_000;

/**
 * Admin session, deliberately separate from the viewer's AuthProvider, adapter and QueryClient: a different token kind
 * (clm_), a different state machine, and failures that cannot log the viewer out. The bearer token lives only in a ref in
 * this component: not in React state, web storage, a URL, or any log. A reload therefore signs the admin out, by design.
 * The server is the only authority: "signed_in" exists only after GET /api/admin/v1/me has confirmed the session.
 */
export function AdminAuthProvider({ children, client }: { children: ReactNode; client?: AdminClient }) {
  // The app's own client uploads recordings with byte progress (XMLHttpRequest); an injected client is used as given.
  const api = useMemo(() => client ?? new AdminClient(undefined, undefined, undefined, typeof XMLHttpRequest === "undefined" ? null : xhrUploader()), [client]);
  const tokenRef = useRef<string | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const verifiedAt = useRef(0);
  const [state, setState] = useState<AdminAuthState>({ status: "signed_out", reason: null });

  const endSession = useCallback((reason: AdminSignedOutReason) => {
    tokenRef.current = null;
    inflight.current = null;
    verifiedAt.current = 0;
    setState({ status: "signed_out", reason });
  }, []);

  const verify = useCallback(
    async (options: { maxAgeMs?: number } = {}): Promise<void> => {
      const token = tokenRef.current;
      if (!token) return;
      if (options.maxAgeMs !== undefined && Date.now() - verifiedAt.current < options.maxAgeMs) return;
      if (inflight.current) return inflight.current;
      const attempt = (async () => {
        try {
          const profile = await api.me(token);
          if (tokenRef.current !== token) return; // signed out while the call was in flight
          verifiedAt.current = Date.now();
          setState({ status: "signed_in", profile });
        } catch (error) {
          if (tokenRef.current !== token) return;
          if (isAdminAuthFailure(error)) {
            endSession((error as AdminApiError).code === "forbidden" ? "forbidden" : "expired");
          } else if (error instanceof AdminApiError) {
            // Keep the session (it may still be good) but do not claim it is confirmed.
            setState((prev) => (prev.status === "signed_in" ? prev : { status: "unverified", error }));
          }
          throw error;
        } finally {
          if (tokenRef.current === token) inflight.current = null;
        }
      })();
      inflight.current = attempt;
      return attempt;
    },
    [api, endSession],
  );

  const signInWithCode = useCallback(
    async (code: string): Promise<void> => {
      const exchange = await api.exchangeCode(code);
      tokenRef.current = exchange.token;
      verifiedAt.current = 0;
      setState({ status: "verifying" });
      await verify();
    },
    [api, verify],
  );

  const signOut = useCallback(async (): Promise<void> => {
    const token = tokenRef.current;
    // Cleared first: the interface never keeps an admin on screen waiting for the network.
    endSession("logout");
    if (!token) return;
    const confirmed = await api.logout(token);
    if (!confirmed) setState((prev) => (prev.status === "signed_out" ? { status: "signed_out", reason: "logout_unconfirmed" } : prev));
  }, [api, endSession]);

  const run = useCallback(
    async <T,>(call: (client: AdminClient, token: string) => Promise<T>): Promise<T> => {
      const token = tokenRef.current;
      if (!token) throw new AdminApiError(401, "unauthenticated", "Chưa đăng nhập quản trị.");
      try {
        return await call(api, token);
      } catch (error) {
        if (tokenRef.current === token && isAdminAuthFailure(error)) endSession((error as AdminApiError).code === "forbidden" ? "forbidden" : "expired");
        throw error;
      }
    },
    [api, endSession],
  );

  // The server's expiry time, as a courtesy: the interface leaves the admin area at that moment instead of at the next failed call.
  const expiresAt = state.status === "signed_in" ? state.profile.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) return;
    const remaining = Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timer = setTimeout(() => endSession("expired"), Math.min(Math.max(remaining, 0), MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [expiresAt, endSession]);

  const value = useMemo(() => ({ state, client: api, signInWithCode, verify, signOut, run }), [state, api, signInWithCode, verify, signOut, run]);
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth phải nằm trong AdminAuthProvider");
  return ctx;
}

/** Only an in-app path under /admin (never the login page itself) is an acceptable place to return to. */
export function safeAdminReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith("/admin") || value.startsWith("//") || value.includes("\\")) return null;
  if (value === "/admin/login" || value.startsWith("/admin/login?") || value.startsWith("/admin/login/")) return null;
  return value;
}

/**
 * Route guard for /admin. This is a convenience, not security: every admin API call is authorized by the server. It renders
 * the admin area only after the server has confirmed the session, and it asks again on every entry. A viewer session cannot
 * satisfy it: it looks only at the admin state.
 */
export function RequireAdmin() {
  const { state, verify, signOut } = useAdminAuth();
  const location = useLocation();
  const entered = useRef(false);

  useEffect(() => {
    if (entered.current) return;
    entered.current = true;
    // Re-confirm on entry unless the session was confirmed a moment ago (right after sign-in).
    void verify({ maxAgeMs: 10_000 }).catch(() => undefined);
  }, [verify]);

  if (state.status === "signed_out") {
    const params = new URLSearchParams();
    if (state.reason && state.reason !== "logout") params.set("reason", state.reason);
    const here = `${location.pathname}${location.search}`;
    if (state.reason !== "logout" && here !== "/admin" && safeAdminReturnTo(here)) params.set("returnTo", here);
    const query = params.toString();
    return <Navigate to={`/admin/login${query ? `?${query}` : ""}`} replace />;
  }
  if (state.status === "verifying") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface">
        <LoadingState label="Đang xác minh phiên quản trị với máy chủ…" />
      </div>
    );
  }
  if (state.status === "unverified") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface px-4">
        <div className="flex w-full max-w-lg flex-col gap-4">
          <InlineError title="Chưa xác minh được phiên quản trị" onRetry={() => void verify().catch(() => undefined)}>
            {state.error.message}
          </InlineError>
          <SoftButton variant="secondary" onClick={() => void signOut()}>
            Hủy phiên và quay về đăng nhập
          </SoftButton>
        </div>
      </div>
    );
  }
  return <Outlet />;
}
