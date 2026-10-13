import { useEffect, useState, type ReactNode } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdapterProvider, createDataAdapter } from "../data";
import { isAccessError, isAuthError } from "../data/errors";
import { AuthProvider, useAuth } from "./auth";

type Listener = () => void;
const authFailureListeners = new Set<Listener>();
const emitAuthFailure = () => authFailureListeners.forEach((l) => l());

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: (error) => isAuthError(error) && emitAuthFailure() }),
    mutationCache: new MutationCache({ onError: (error) => isAuthError(error) && emitAuthFailure() }),
    defaultOptions: {
      queries: {
        // Không cache dữ liệu sức khỏe lâu; không retry lỗi quyền hoặc phiên.
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => !isAuthError(error) && !isAccessError(error) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}

function AuthFailureBridge() {
  const { markExpired } = useAuth();
  useEffect(() => {
    authFailureListeners.add(markExpired);
    return () => {
      authFailureListeners.delete(markExpired);
    };
  }, [markExpired]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [data] = useState(() => createDataAdapter());
  return (
    <AdapterProvider value={data}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthFailureBridge />
          {children}
        </AuthProvider>
      </QueryClientProvider>
    </AdapterProvider>
  );
}
