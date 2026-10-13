import { createContext, useContext, type ReactNode } from "react";
import type { DataAdapter, DemoControls } from "./adapter";
import { DemoAdapter } from "./demo/demoAdapter";
import { ApiError } from "./errors";

export type DataMode = "demo" | "http";

export function resolveDataMode(): DataMode {
  const mode = import.meta.env.VITE_DATA_MODE;
  return mode === "http" ? "http" : "demo";
}

/**
 * Chế độ http chưa có API (M1). Mọi lời gọi báo lỗi rõ ràng thay vì âm thầm dùng dữ liệu demo.
 */
function createUnavailableAdapter(): DataAdapter {
  const fail = () =>
    Promise.reject(new ApiError(503, "api_unavailable", "Chưa có API nghiệp vụ. Chế độ http sẽ khả dụng từ mốc M1."));
  return new Proxy({ mode: "http" } as DataAdapter, {
    get(target, prop) {
      if (prop === "mode") return target.mode;
      if (prop === "subscribe") {
        return (_id: string, handlers: { onClose: (r: "error") => void }) => {
          queueMicrotask(() => handlers.onClose("error"));
          return () => undefined;
        };
      }
      return fail;
    },
  });
}

export function createDataAdapter(mode: DataMode = resolveDataMode()): {
  adapter: DataAdapter;
  demo: DemoControls | null;
} {
  if (mode === "http") return { adapter: createUnavailableAdapter(), demo: null };
  const demo = new DemoAdapter();
  return { adapter: demo, demo };
}

const AdapterContext = createContext<{ adapter: DataAdapter; demo: DemoControls | null } | null>(null);

export function AdapterProvider({
  value,
  children,
}: {
  value: { adapter: DataAdapter; demo: DemoControls | null };
  children: ReactNode;
}) {
  return <AdapterContext.Provider value={value}>{children}</AdapterContext.Provider>;
}

export function useAdapter(): DataAdapter {
  const ctx = useContext(AdapterContext);
  if (!ctx) throw new Error("useAdapter phải nằm trong AdapterProvider");
  return ctx.adapter;
}

export function useDemoControls(): DemoControls | null {
  const ctx = useContext(AdapterContext);
  if (!ctx) throw new Error("useDemoControls phải nằm trong AdapterProvider");
  return ctx.demo;
}
