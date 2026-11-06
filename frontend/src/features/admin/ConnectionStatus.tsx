import { StatusLabel } from "../../design-system/feedback";
import { formatDateTime } from "../../lib/time";
import { formatElapsed, liveConnection, useNow, type ConnectionInput } from "./connection";
import { CONNECTION_LABELS } from "./labels";

export const CONNECTION_TICK_MS = 5000;

/** Online / connection uncertain / offline from the last authenticated request, recomputed every few seconds. */
export function ConnectionStatus({ input }: { input: ConnectionInput }) {
  const now = useNow(CONNECTION_TICK_MS);
  // A reply that arrived after the last tick must not make the contact look younger than it is.
  const { state, ageSeconds } = liveConnection(input, Math.max(now, input.receivedAtMs));
  const info = CONNECTION_LABELS[state];
  return (
    <>
      <StatusLabel tone={info.tone}>{info.label}</StatusLabel>
      <span className="mt-1 block text-xs">
        {input.lastSeenAt
          ? `Liên lạc gần nhất: ${formatDateTime(input.lastSeenAt)} (giờ Việt Nam, UTC+7)${ageSeconds !== null ? ` · cách đây ${formatElapsed(ageSeconds)}` : ""}`
          : "Chưa từng liên lạc"}
      </span>
    </>
  );
}
