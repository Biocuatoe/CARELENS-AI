import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminAuth } from "../../app/adminAuth";
import { isAdminApiError, type AdminApiError, type AdminClient } from "../../data/admin/adminClient";

export type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string; error: AdminApiError | null };

export function errorMessage(error: unknown, fallback = "Đã xảy ra lỗi. Vui lòng thử lại."): string {
  return isAdminApiError(error) ? error.message : fallback;
}

/**
 * Loads admin data with the current session. `key` names the parameters of the request (device, date…): when it changes, the old
 * result is not shown for the new request, it is "loading" until the new one arrives, and a late reply to an old key is dropped.
 * A 401/403 ends the admin session inside `run`, and the route guard then leaves the page; any other failure is an error state
 * with a retry, never an empty list.
 */
export function useAdminLoad<T>(load: (client: AdminClient, token: string) => Promise<T>, key: string): { state: Load<T>; reload: () => void; refresh: () => void } {
  const { run } = useAdminAuth();
  const [result, setResult] = useState<{ key: string; outcome: { ok: true; data: T } | { ok: false; error: unknown } } | null>(null);
  const latest = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const start = useCallback(
    (forKey: string) => {
      const mine = ++latest.current;
      run((client, token) => loadRef.current(client, token))
        .then((data) => {
          if (latest.current === mine) setResult({ key: forKey, outcome: { ok: true, data } });
        })
        .catch((error: unknown) => {
          if (latest.current === mine) setResult({ key: forKey, outcome: { ok: false, error } });
        });
    },
    [run],
  );

  // Replies still in flight when the key changes or the page unmounts are dropped.
  const invalidate = useCallback(() => {
    latest.current++;
  }, []);
  useEffect(() => {
    start(key);
    return invalidate;
  }, [key, start, invalidate]);

  const reload = useCallback(() => {
    setResult(null);
    start(key);
  }, [key, start]);

  /** Fetches again without blanking the screen: the previous result stays until the new one (or an error) replaces it. */
  const refresh = useCallback(() => start(key), [key, start]);

  if (!result || result.key !== key) return { state: { status: "loading" }, reload, refresh };
  if (result.outcome.ok) return { state: { status: "ready", data: result.outcome.data }, reload, refresh };
  const error = result.outcome.error;
  return { state: { status: "error", message: errorMessage(error, "Không tải được dữ liệu."), error: isAdminApiError(error) ? error : null }, reload, refresh };
}
