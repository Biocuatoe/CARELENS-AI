import { describe, expect, it } from "vitest";
import { formatElapsed, liveConnection } from "./connection";

const policy = { onlineMaxAgeSeconds: 60, offlineAfterSeconds: 180, heartbeatIntervalSeconds: 60 };
const at = (iso: string) => Date.parse(iso);

describe("liveConnection", () => {
  const base = {
    lastSeenAt: "2026-10-19T02:59:30.000Z",
    serverTime: "2026-10-19T03:00:00.000Z",
    receivedAtMs: at("2026-10-19T03:00:00.000Z"),
    policy,
    serverState: "online",
  };

  it("ages the last contact on the server's clock after the reply arrived", () => {
    expect(liveConnection(base, at("2026-10-19T03:00:00.000Z"))).toEqual({
      state: "online",
      ageSeconds: 30,
    });
    expect(liveConnection(base, at("2026-10-19T03:00:30.000Z"))).toEqual({
      state: "online",
      ageSeconds: 60,
    });
    expect(liveConnection(base, at("2026-10-19T03:00:31.000Z"))).toEqual({
      state: "stale",
      ageSeconds: 61,
    });
    expect(liveConnection(base, at("2026-10-19T03:02:30.000Z"))).toEqual({
      state: "stale",
      ageSeconds: 180,
    });
    expect(liveConnection(base, at("2026-10-19T03:02:31.000Z"))).toEqual({
      state: "offline",
      ageSeconds: 181,
    });
  });

  it("does not let a skewed browser clock change the age: only time elapsed since the reply counts", () => {
    const skewed = { ...base, receivedAtMs: at("2026-10-19T05:00:00.000Z") }; // browser 2 h ahead of the server
    expect(liveConnection(skewed, at("2026-10-19T05:00:10.000Z"))).toEqual({
      state: "online",
      ageSeconds: 40,
    });
  });

  it("never invents thresholds: without a policy it shows the server's state, and no contact is 'never seen'", () => {
    expect(
      liveConnection(
        { ...base, policy: null, serverState: "stale" },
        at("2026-10-19T03:10:00.000Z"),
      ).state,
    ).toBe("stale");
    expect(
      liveConnection({ ...base, policy: null, serverState: null }, at("2026-10-19T03:00:00.000Z"))
        .state,
    ).toBe("unknown");
    expect(liveConnection({ ...base, lastSeenAt: null }, at("2026-10-19T03:00:00.000Z"))).toEqual({
      state: "never_seen",
      ageSeconds: null,
    });
  });

  it("formats the elapsed time", () => {
    expect(formatElapsed(45)).toBe("45 giây");
    expect(formatElapsed(143)).toBe("2 phút 23 giây");
    expect(formatElapsed(7260)).toBe("2 giờ 1 phút");
  });
});
