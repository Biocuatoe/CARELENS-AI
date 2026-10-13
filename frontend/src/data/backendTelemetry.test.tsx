import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { DataAdapter } from "./adapter";
import type { SignalQuality } from "./contracts";
import { DemoAdapter } from "./demo/demoAdapter";
import { AdapterProvider } from "./index";
import { useBackendDeviceHistory } from "./backendTelemetry";

/** Mirror of the internal HubStateFromBackend type from demoAdapter.ts */
interface HubStateFromBackend {
  id: string;
  recipient_id: string;
  online: boolean;
  last_seen_at: string | null;
  last_seen_ms: number | null;
  signal: "connected" | "offline";
  latest_data: {
    kind: "heart_rate" | "spo2";
    value: number | null;
    unit: "bpm" | "%" | null;
    quality: SignalQuality | null;
    observed_at: string;
    summary: string | null;
  } | null;
  battery: number | null;
}

function makeWrapper() {
  const adapter = new DemoAdapter();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AdapterProvider value={{ adapter: adapter as unknown as DataAdapter, demo: null }}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </AdapterProvider>
    );
  }
  return { adapter, Wrapper };
}

/**
 * Drive SSE into the demoAdapter by calling the public mergeBackendDevices()
 * method directly and then emitting the device.updated hint that the SSE
 * handler would normally emit. This simulates what happens when the SSE
 * state_update handler processes a backend payload.
 */
function deliverHr(adapter: DemoAdapter, value: number, observedAt: string) {
  const hub: HubStateFromBackend = {
    id: "d_core_liveshowcase",
    recipient_id: "r_liveshowcase",
    online: true,
    last_seen_at: observedAt,
    last_seen_ms: null,
    signal: "connected",
    battery: null,
    latest_data: {
      kind: "heart_rate",
      value,
      unit: "bpm",
      quality: "good" as SignalQuality,
      observed_at: observedAt,
      summary: null,
    },
  };
  adapter.mergeBackendDevices({ d_core_liveshowcase: hub }, { seedMeasurements: false });
}

function deliverSpo2(adapter: DemoAdapter, value: number, observedAt: string) {
  const hub: HubStateFromBackend = {
    id: "d_core_liveshowcase",
    recipient_id: "r_liveshowcase",
    online: true,
    last_seen_at: observedAt,
    last_seen_ms: null,
    signal: "connected",
    battery: null,
    latest_data: {
      kind: "spo2",
      value,
      unit: "%",
      quality: "good" as SignalQuality,
      observed_at: observedAt,
      summary: null,
    },
  };
  adapter.mergeBackendDevices({ d_core_liveshowcase: hub }, { seedMeasurements: false });
}

function deliverInvalidHr(adapter: DemoAdapter, value: number, observedAt: string) {
  const hub: HubStateFromBackend = {
    id: "d_core_liveshowcase",
    recipient_id: "r_liveshowcase",
    online: true,
    last_seen_at: observedAt,
    last_seen_ms: null,
    signal: "connected",
    battery: null,
    latest_data: {
      kind: "heart_rate",
      value,
      unit: "bpm",
      quality: "good" as SignalQuality,
      observed_at: observedAt,
      summary: null,
    },
  };
  adapter.mergeBackendDevices({ d_core_liveshowcase: hub }, { seedMeasurements: false });
}

describe("useBackendDeviceHistory — BPM chart accumulation", () => {
  it("TEST 1: one valid BPM sample → one chart point", async () => {
    const { adapter, Wrapper } = makeWrapper();
    await adapter.enterDemo("u_liveshowcase");
    const t0 = new Date("2026-09-22T10:00:00.000Z").toISOString();
    deliverHr(adapter, 72, t0);
    const { result } = renderHook(() => useBackendDeviceHistory("r_liveshowcase"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.hrItems.length).toBe(1));
    expect(result.current.hrItems[0]?.value).toBe(72);
    expect(result.current.hrItems[0]?.observedAt).toBe(t0);
  });

  it("TEST 2: three valid BPM samples with different timestamps → three points, chronological", async () => {
    const { adapter, Wrapper } = makeWrapper();
    await adapter.enterDemo("u_liveshowcase");
    const t1 = "2026-09-22T10:00:00.000Z";
    const t2 = "2026-09-22T10:00:01.000Z";
    const t3 = "2026-09-22T10:00:02.000Z";
    deliverHr(adapter, 72, t1);
    const { result, rerender } = renderHook(() => useBackendDeviceHistory("r_liveshowcase"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.hrItems.length).toBe(1));
    deliverHr(adapter, 73, t2);
    rerender();
    await waitFor(() => expect(result.current.hrItems.length).toBe(2));
    deliverHr(adapter, 74, t3);
    rerender();
    await waitFor(() => expect(result.current.hrItems.length).toBe(3));
    expect(result.current.hrItems.map((m) => m.value)).toEqual([72, 73, 74]);
    expect(result.current.hrItems.map((m) => m.observedAt)).toEqual([t1, t2, t3]);
  });

  it("TEST 3: same timestamp repeated because of rerender → still one point", async () => {
    const { adapter, Wrapper } = makeWrapper();
    await adapter.enterDemo("u_liveshowcase");
    const t1 = "2026-09-22T10:00:00.000Z";
    deliverHr(adapter, 72, t1);
    const { result } = renderHook(() => useBackendDeviceHistory("r_liveshowcase"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.hrItems.length).toBe(1));
    for (let i = 0; i < 3; i++) {
      deliverHr(adapter, 72, t1);
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.hrItems.length).toBe(1);
  });

  it("TEST 4: same value repeated with NEW timestamps → still accumulates (does not collapse)", async () => {
    const { adapter, Wrapper } = makeWrapper();
    await adapter.enterDemo("u_liveshowcase");
    const { result, rerender } = renderHook(() => useBackendDeviceHistory("r_liveshowcase"), { wrapper: Wrapper });
    for (let i = 0; i < 5; i++) {
      const t = new Date(Date.UTC(2026, 8, 22, 10, 0, i)).toISOString();
      deliverHr(adapter, 72, t);
      rerender();
    }
    await waitFor(() => expect(result.current.hrItems.length).toBe(5));
    expect(result.current.hrItems.every((m) => m.value === 72)).toBe(true);
  });

  it("TEST 4b: 101 valid BPM samples → 100 retained, oldest removed", async () => {
    const { adapter, Wrapper } = makeWrapper();
    await adapter.enterDemo("u_liveshowcase");
    const { result, rerender } = renderHook(() => useBackendDeviceHistory("r_liveshowcase"), { wrapper: Wrapper });
    for (let i = 0; i < 101; i++) {
      const t = new Date(Date.UTC(2026, 8, 22, 10, 0, 0, i)).toISOString();
      deliverHr(adapter, 72, t);
      rerender();
    }
    await waitFor(() => expect(result.current.hrItems.length).toBe(100));
    const last = result.current.hrItems[99];
    expect(last?.observedAt).toBe(new Date(Date.UTC(2026, 8, 22, 10, 0, 0, 100)).toISOString());
  });

  it("TEST 5: invalid BPM (0) → no new point", async () => {
    const { adapter, Wrapper } = makeWrapper();
    await adapter.enterDemo("u_liveshowcase");
    const t = "2026-09-22T10:00:00.000Z";
    deliverHr(adapter, 72, t);
    const { result } = renderHook(() => useBackendDeviceHistory("r_liveshowcase"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.hrItems.length).toBe(1));

    deliverInvalidHr(adapter, 0, t);
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.hrItems.length).toBe(1);
  });

  it("TEST 8: React rerender preserves history", async () => {
    const { adapter, Wrapper } = makeWrapper();
    await adapter.enterDemo("u_liveshowcase");
    const t1 = "2026-09-22T10:00:00.000Z";
    const t2 = "2026-09-22T10:00:01.000Z";
    deliverHr(adapter, 72, t1);
    const { result, rerender } = renderHook(() => useBackendDeviceHistory("r_liveshowcase"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.hrItems.length).toBe(1));
    deliverHr(adapter, 73, t2);
    rerender();
    await waitFor(() => expect(result.current.hrItems.length).toBe(2));
    rerender();
    rerender();
    expect(result.current.hrItems.length).toBe(2);
  });
});

describe("useBackendDeviceHistory — SpO2", () => {
  it("TEST 6: three valid SpO2 samples → three chart points", async () => {
    const { adapter, Wrapper } = makeWrapper();
    await adapter.enterDemo("u_liveshowcase");
    const { result, rerender } = renderHook(() => useBackendDeviceHistory("r_liveshowcase"), { wrapper: Wrapper });
    for (let i = 0; i < 3; i++) {
      const t = new Date(Date.UTC(2026, 8, 22, 10, 0, i)).toISOString();
      deliverSpo2(adapter, 98, t);
      rerender();
    }
    await waitFor(() => expect(result.current.spo2Items.length).toBe(3));
    expect(result.current.spo2Items.map((m) => m.value)).toEqual([98, 98, 98]);
  });

  it("TEST 7: invalid SpO2 (0) → no fake point", async () => {
    const { adapter, Wrapper } = makeWrapper();
    await adapter.enterDemo("u_liveshowcase");
    const t = "2026-09-22T10:00:00.000Z";
    deliverSpo2(adapter, 98, t);
    const { result } = renderHook(() => useBackendDeviceHistory("r_liveshowcase"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.spo2Items.length).toBe(1));
    deliverInvalidHr(adapter, 0, t);
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.spo2Items.length).toBe(1);
  });
});

describe("useBackendDeviceHistory — persona isolation", () => {
  it("TEST 10: static personas (u_minh) get empty arrays", async () => {
    const adapter = new DemoAdapter();
    await adapter.enterDemo("u_minh");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AdapterProvider value={{ adapter: adapter as unknown as DataAdapter, demo: null }}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </AdapterProvider>
    );
    }
    const { result } = renderHook(() => useBackendDeviceHistory("r_minh"), { wrapper: Wrapper });
    expect(result.current.hrItems.length).toBe(0);
    expect(result.current.spo2Items.length).toBe(0);
    expect(result.current.isLiveshowcase).toBe(false);
  });

  it("TEST 11: u_liveshowcase is dynamic and receives telemetry", async () => {
    const { adapter, Wrapper } = makeWrapper();
    await adapter.enterDemo("u_liveshowcase");
    const t = "2026-09-22T10:00:00.000Z";
    deliverHr(adapter, 72, t);
    const { result } = renderHook(() => useBackendDeviceHistory("r_liveshowcase"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLiveshowcase).toBe(true));
    await waitFor(() => expect(result.current.hrItems.length).toBe(1));
  });
});
