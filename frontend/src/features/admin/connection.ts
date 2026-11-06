import { useEffect, useState } from "react";

/** Thresholds the server applies (connection_policy). The page never invents its own. */
export interface ConnectionPolicy {
  onlineMaxAgeSeconds: number;
  offlineAfterSeconds: number;
  heartbeatIntervalSeconds: number | null;
}

export type ConnectionState = "online" | "stale" | "offline" | "never_seen" | "unknown";

export interface ConnectionInput {
  lastSeenAt: string | null;
  /** server_time of the response that carried lastSeenAt, and when this browser received it. */
  serverTime: string | null;
  receivedAtMs: number;
  policy: ConnectionPolicy | null;
  /** connection_state the server computed at serverTime (used as is when no policy came with it). */
  serverState: string | null;
}

/**
 * The connection state now, not at the last fetch: the age of the last contact keeps growing between refreshes, measured
 * on the server's clock (server_time + time elapsed since the response arrived), so a skewed browser clock does not
 * shift it. Without a policy from the server the server's own state is shown and not recomputed.
 */
export function liveConnection(
  c: ConnectionInput,
  nowMs: number,
): { state: ConnectionState; ageSeconds: number | null } {
  if (!c.lastSeenAt) return { state: "never_seen", ageSeconds: null };
  const seen = Date.parse(c.lastSeenAt);
  const server = c.serverTime ? Date.parse(c.serverTime) : Number.NaN;
  if (Number.isNaN(seen) || Number.isNaN(server))
    return { state: knownState(c.serverState), ageSeconds: null };
  const ageSeconds = Math.max(
    0,
    Math.round((server + Math.max(0, nowMs - c.receivedAtMs) - seen) / 1000),
  );
  if (!c.policy) return { state: knownState(c.serverState), ageSeconds };
  if (ageSeconds <= c.policy.onlineMaxAgeSeconds) return { state: "online", ageSeconds };
  if (ageSeconds <= c.policy.offlineAfterSeconds) return { state: "stale", ageSeconds };
  return { state: "offline", ageSeconds };
}

function knownState(s: string | null): ConnectionState {
  return s === "online" || s === "stale" || s === "offline" || s === "never_seen" ? s : "unknown";
}

/** "2 phút 5 giây" style elapsed time for the last contact. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} giây`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút ${seconds % 60} giây`;
  if (seconds < 86_400)
    return `${Math.floor(seconds / 3600)} giờ ${Math.floor((seconds % 3600) / 60)} phút`;
  return `${Math.floor(seconds / 86_400)} ngày`;
}

/** Re-renders every `ms` so time-based labels move on their own between data refreshes. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
