import type { AlertQuery, EventQuery, HistoryQuery, TimeRange } from "./contracts";

/** Mọi dữ liệu theo hồ sơ bắt đầu bằng ["recipient", recipientId] để dọn cache khi đổi hồ sơ (ARCHITECTURE §7.2). */
export const qk = {
  session: () => ["session"] as const,
  recipients: () => ["recipients"] as const,
  households: () => ["households", "managed"] as const,
  notificationSettings: () => ["me", "notification-settings"] as const,
  notificationSink: () => ["me", "notification-sink"] as const,
  diagnostics: () => ["admin", "diagnostics"] as const,

  recipient: (id: string) => ["recipient", id] as const,
  context: (id: string) => ["recipient", id, "context"] as const,
  overview: (id: string) => ["recipient", id, "overview"] as const,
  events: (id: string, q?: Omit<EventQuery, "cursor">) =>
    (q ? ["recipient", id, "events", q] : ["recipient", id, "events"]) as readonly unknown[],
  event: (id: string, eventId: string) => ["recipient", id, "event", eventId] as const,
  measurements: (
    id: string,
    range?: TimeRange,
    metric?: "heart_rate" | "spo2",
  ) =>
    range !== undefined
      ? (["recipient", id, "measurements", metric ?? "heart_rate", range] as const)
      : (["recipient", id, "measurements"] as const),
  alerts: (id: string, q?: Omit<AlertQuery, "cursor">) =>
    (q ? ["recipient", id, "alerts", q] : ["recipient", id, "alerts"]) as readonly unknown[],
  alert: (id: string, alertId: string) => ["recipient", id, "alert", alertId] as const,
  devices: (id: string) => ["recipient", id, "devices"] as const,
  patches: (id: string) => ["recipient", id, "patches"] as const,
  history: (id: string, q?: Omit<HistoryQuery, "cursor">) =>
    (q ? ["recipient", id, "history", q] : ["recipient", id, "history"]) as readonly unknown[],
  report: (id: string, input?: unknown) =>
    (input ? ["recipient", id, "report", input] : ["recipient", id, "report"]) as readonly unknown[],
  exportJob: (id: string, exportId: string) => ["recipient", id, "export", exportId] as const,
  access: (id: string) => ["recipient", id, "access"] as const,
  /** Backend-driven device states from SSE (LIVESHOWCASE only). */
  backendDevices: (id: string) => ["recipient", id, "backend-devices"] as const,
};
