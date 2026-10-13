import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { StreamHint } from "./contracts";
import { useAdapter } from "./index";
import { qk } from "./queryKeys";

/**
 * Stream gợi ý thay đổi theo hồ sơ (ADR-010).
 * - Dedup theo seq, reconnect bằng lastSeq.
 * - Danh sách cảnh báo không tự đổi thứ tự: chỉ tăng bộ đếm "có thay đổi" để người dùng chủ động tải lại.
 */

type Listener = () => void;
const pendingAlertChanges = new Map<string, number>();
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

export function markAlertListSeen(recipientId: string) {
  if (pendingAlertChanges.get(recipientId)) {
    pendingAlertChanges.set(recipientId, 0);
    notify();
  }
}

export function usePendingAlertChanges(recipientId: string): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pendingAlertChanges.get(recipientId) ?? 0,
  );
}

export type StreamStatus = "open" | "closed_revoked" | "closed_session" | "closed_error";

export function useRecipientStream(recipientId: string, onStatus?: (status: StreamStatus) => void) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const statusRef = useRef(onStatus);
  useEffect(() => {
    statusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    const report = (status: StreamStatus) => statusRef.current?.(status);
    let lastSeq: number | undefined;
    const seen = new Set<number>();
    let unsubscribe: () => void = () => undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const handleHint = (hint: StreamHint) => {
      if (disposed || hint.recipientId !== recipientId || seen.has(hint.seq)) return;
      seen.add(hint.seq);
      lastSeq = Math.max(lastSeq ?? 0, hint.seq);
      const invalidate = (key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key });
      switch (hint.type) {
        case "alert.created":
        case "alert.updated":
          pendingAlertChanges.set(recipientId, (pendingAlertChanges.get(recipientId) ?? 0) + 1);
          notify();
          invalidate(qk.alert(recipientId, hint.entityId));
          invalidate(qk.overview(recipientId));
          invalidate(qk.context(recipientId));
          invalidate(qk.history(recipientId));
          break;
        case "event.created":
          invalidate(qk.events(recipientId));
          invalidate(qk.overview(recipientId));
          invalidate(qk.context(recipientId));
          invalidate(qk.history(recipientId));
          break;
        case "measurement.created":
          invalidate(qk.measurements(recipientId));
          invalidate(qk.overview(recipientId));
          break;
        case "device.updated":
          invalidate(qk.devices(recipientId));
          invalidate(qk.context(recipientId));
          invalidate(qk.overview(recipientId));
          invalidate(qk.recipients());
          invalidate(qk.backendDevices(recipientId));
          break;
        case "patch.updated":
          invalidate(qk.patches(recipientId));
          invalidate(qk.overview(recipientId));
          invalidate(qk.history(recipientId));
          break;
        case "note.created":
          invalidate(qk.history(recipientId));
          invalidate(qk.overview(recipientId));
          break;
        case "grant.revoked":
          invalidate(qk.access(recipientId));
          break;
      }
    };

    const connect = () => {
      unsubscribe = adapter.subscribe(
        recipientId,
        {
          onHint: handleHint,
          onClose: (reason) => {
            if (disposed) return;
            if (reason === "revoked") {
              report("closed_revoked");
              void queryClient.invalidateQueries({ queryKey: qk.context(recipientId) });
            } else if (reason === "session_expired") {
              report("closed_session");
              void queryClient.invalidateQueries({ queryKey: qk.session() });
            } else {
              report("closed_error");
              retryTimer = setTimeout(connect, 5_000);
            }
          },
        },
        lastSeq,
      );
      report("open");
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe();
    };
  }, [adapter, queryClient, recipientId]);
}
