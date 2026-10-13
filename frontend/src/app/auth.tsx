import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "../data/contracts";
import { useAdapter, useDemoControls } from "../data";
import { isAuthError } from "../data/errors";

type AuthState =
  | { status: "loading"; session: null }
  | { status: "signed_out"; session: null; reason: "expired" | "logout" | null }
  | { status: "signed_in"; session: Session };

interface AuthContextValue {
  state: AuthState;
  enterDemo: (personaId: string) => Promise<Session>;
  login: (email: string, password: string) => Promise<Session>;
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
  const demo = useDemoControls();
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

  const enterDemo = useCallback(
    async (personaId: string) => {
      if (!demo) throw new Error("Chế độ demo không khả dụng.");
      queryClient.clear();
      // Đặt lại toàn bộ dữ liệu mô phỏng để UI bắt đầu ở trạng thái trống —
      // hub offline, không có sự kiện, không có cảnh báo.
      // Người dùng sẽ trigger sự kiện qua chatbot Telegram.
      demo.reset();
      const session = await demo.enterDemo(personaId);
      setState({ status: "signed_in", session });
      return session;
    },
    [demo, queryClient],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await adapter.login({ email, password });
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

  const value = useMemo(() => ({ state, enterDemo, login, logout, markExpired }), [state, enterDemo, login, logout, markExpired]);
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

/** true khi người dùng đang ở phiên liveshowcase (r_liveshowcase, dữ liệu trống chờ trigger chatbot). */
export function isLiveshowcaseSession(session: Session | null): boolean {
  return session?.user.id === "u_liveshowcase";
}

/** "Liveshowcase" khi đang ở phiên liveshowcase, "Dữ liệu mô phỏng" khi bình thường. */
export function useDemoBadgeLabel(): string {
  const { state } = useAuth();
  return state.status === "signed_in" && isLiveshowcaseSession(state.session) ? "Liveshowcase" : "Dữ liệu mô phỏng";
}

export { isAuthError };
