import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "../data/contracts";
import { useAdapter } from "../data";
import { isAuthError } from "../data/errors";

type AuthState =
  | { status: "loading"; session: null }
  | { status: "signed_out"; session: null; reason: "expired" | "logout" | null }
  | { status: "signed_in"; session: Session };

interface AuthContextValue {
  state: AuthState;
  login: (username: string, password: string) => Promise<Session>;
  completeGoogleSignIn: (code: string) => Promise<Session>;
  logout: () => Promise<void>;
  markExpired: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Phiên chỉ nằm trong bộ nhớ của adapter (cookie httpOnly ở chế độ http theo ADR-006).
 * Không lưu cờ đăng nhập hoặc token vào web storage.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading", session: null });

  useEffect(() => {
    let cancelled = false;
    adapter
      .getSession()
      .then((session) => !cancelled && setState({ status: "signed_in", session }))
      .catch(() => !cancelled && setState({ status: "signed_out", session: null, reason: null }));
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  const login = useCallback(
    async (username: string, password: string) => {
      const session = await adapter.login({ username, password });
      queryClient.clear();
      setState({ status: "signed_in", session });
      return session;
    },
    [adapter, queryClient],
  );

  const completeGoogleSignIn = useCallback(
    async (code: string) => {
      const session = await adapter.completeGoogleSignIn(code);
      queryClient.clear();
      setState({ status: "signed_in", session });
      return session;
    },
    [adapter, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await adapter.logout();
    } finally {
      queryClient.clear();
      setState({ status: "signed_out", session: null, reason: "logout" });
    }
  }, [adapter, queryClient]);

  const markExpired = useCallback(() => {
    queryClient.clear();
    setState((prev) => (prev.status === "signed_in" ? { status: "signed_out", session: null, reason: "expired" } : prev));
  }, [queryClient]);

  const value = useMemo(() => ({ state, login, completeGoogleSignIn, logout, markExpired }), [state, login, completeGoogleSignIn, logout, markExpired]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải nằm trong AuthProvider");
  return ctx;
}

export function useSession(): Session {
  const { state } = useAuth();
  if (state.status !== "signed_in") throw new Error("Chưa đăng nhập");
  return state.session;
}

/** Nhãn cạnh các mục hiển thị trong bản Demo trực tiếp (hồ sơ duy nhất của tài khoản dùng chung). */
export function useDemoBadgeLabel(): string {
  return "Demo trực tiếp";
}

export { isAuthError };
