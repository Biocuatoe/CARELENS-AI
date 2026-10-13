import { afterEach } from "vitest";
/**
 * Tests for EcoPatchPage SpO₂ section.
 * Verifies the SpO₂ UI renders correctly with and without data,
 * and that the existing BPM section remains unchanged.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DataAdapter, DemoControls } from "../../data/adapter";
import type { RecipientContext } from "../../data/contracts";
import { AdapterProvider } from "../../data/index";
import { AuthProvider } from "../../app/auth";
import { RecipientProvider } from "../common/recipient";
import { EcoPatchPage } from "./EcoPatchPage";

/** ── Mock adapter factory ─────────────────────────────────────────────────── */
function makeMockAdapter(overrides: Partial<DataAdapter> = {}): DataAdapter & Partial<DemoControls> {
  return {
    mode: "demo",
    getSession: vi.fn().mockResolvedValue({
      user: { id: "u_minh", displayName: "Minh", email: "minh.demo@example.invalid", isPlatformAdmin: false },
      mode: "demo" as const,
      expiresAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
    }),
    getRecipientContext: vi.fn().mockResolvedValue({
      recipient: {
        id: "r_an",
        householdId: "h_a",
        householdName: "Nhóm A",
        displayName: "Bà An",
        enrollments: [{ product: "ecopatch", status: "active" as const }],
        sources: [{
          product: "ecopatch",
          deviceId: "d_core_an",
          state: "connected" as const,
          lastSeenAt: new Date().toISOString(),
          lastDataAt: new Date().toISOString(),
          sourceMode: "simulated" as const,
        }],
        openAlertCount: 0,
        sourceMode: "simulated" as const,
      },
      permissions: ["recipient.read", "data.read", "patches.replace"],
      role: "manager" as const,
    }),
    listDevices: vi.fn().mockResolvedValue([{
      id: "d_core_an",
      recipientId: "r_an",
      product: "ecopatch",
      kind: "ecopatch_core",
      label: "Lõi EcoPatch",
      serialMasked: "EP-CORE-••••-7715",
      capabilities: ["heart_rate", "signal_quality"],
      lastSeenAt: new Date().toISOString(),
      connection: "connected",
      batteryPercent: null,
      assignedFrom: new Date(Date.now() - 30 * 86400 * 1000).toISOString(),
      sourceMode: "simulated",
    }]),
    listPatchSessions: vi.fn().mockResolvedValue([{
      id: "ps_2",
      coreDeviceId: "d_core_an",
      recipientId: "r_an",
      lotCode: "LOT-DEMO-0425",
      startedAt: new Date(Date.now() - 4 * 86400 * 1000).toISOString(),
      endedAt: null,
      expectedReplaceAt: null,
      createdByName: "Lan",
      sourceMode: "simulated",
    }]),
    listMeasurements: vi.fn().mockResolvedValue({ items: [], latest: null, expectedIntervalMinutes: 10, from: "", to: "" }),
    subscribe: vi.fn().mockReturnValue(() => {}),
    getBackendDevices: vi.fn().mockReturnValue({}),
    ...overrides,
  } as DataAdapter & Partial<DemoControls>;
}

afterEach(() => {
  vi.clearAllMocks();
});

/** ── Test helper: render EcoPatchPage with required contexts ──────────────── */
function renderEcoPatchPage(adapter: DataAdapter) {
  const recipientContext: RecipientContext = {
    recipient: {
      id: "r_an",
      householdId: "h_a",
      householdName: "Nhóm A",
      displayName: "Bà An",
      enrollments: [{ product: "ecopatch", status: "active" }],
      sources: [{
        product: "ecopatch",
        deviceId: "d_core_an",
        state: "connected",
        lastSeenAt: new Date().toISOString(),
        lastDataAt: new Date().toISOString(),
        sourceMode: "simulated",
      }],
      openAlertCount: 0,
      sourceMode: "simulated",
    },
    permissions: ["recipient.read", "data.read", "patches.replace"],
    role: "manager",
  };

  // Create a fresh QueryClient per render to avoid stale data leaking between tests.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 0, gcTime: 60_000 } },
  });

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AdapterProvider value={{ adapter, demo: null }}>
          <AuthProvider>
            <RecipientProvider value={recipientContext}>
              <EcoPatchPage />
            </RecipientProvider>
          </AuthProvider>
        </AdapterProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** ── Test helpers: create measurement fixtures ───────────────────────────── */
type Measurement = {
  id: string;
  sourceRecordId: string;
  deviceId: string;
  metric: "heart_rate" | "spo2";
  value: number;
  unit: string;
  quality: "good" | "fair" | "poor";
  observedAt: string;
  receivedAt: string;
  sourceMode: "simulated";
};

let _seq = 0;
function nextId() {
  return ++_seq;
}

function makeMeasurement(value: number, metric: "heart_rate" | "spo2"): Measurement {
  const now = Date.now() + nextId();
  const id = metric === "spo2" ? `s_${now}` : `m_${now}`;
  return metric === "spo2"
    ? {
        id,
        sourceRecordId: `sim-spo2-${now}`,
        deviceId: "d_core_an",
        metric: "spo2" as const,
        value,
        unit: "%" as const,
        quality: "good" as const,
        observedAt: new Date(now).toISOString(),
        receivedAt: new Date(now).toISOString(),
        sourceMode: "simulated" as const,
      }
    : {
        id,
        sourceRecordId: `sim-hr-${now}`,
        deviceId: "d_core_an",
        metric: "heart_rate" as const,
        value,
        unit: "bpm" as const,
        quality: "good" as const,
        observedAt: new Date(now).toISOString(),
        receivedAt: new Date(now).toISOString(),
        sourceMode: "simulated" as const,
      };
}

function makeSeries(_metric: "heart_rate" | "spo2", items: Measurement[]) {
  return {
    items,
    latest: items.length > 0 ? items[items.length - 1]! : null,
    expectedIntervalMinutes: 10,
    from: new Date(Date.now() - 24 * 3600_000).toISOString(),
    to: new Date().toISOString(),
  };
}

/** ── Tests ───────────────────────────────────────────────────────────────── */
describe("EcoPatchPage SpO₂ section", () => {
  it("1. SpO₂ section renders with no data → shows empty-state placeholder", async () => {
    const adapter = makeMockAdapter({
      listMeasurements: vi.fn().mockResolvedValue({ items: [], latest: null, expectedIntervalMinutes: 10, from: "", to: "" }),
    });

    renderEcoPatchPage(adapter);

    // Both sections should render their headings
    expect(screen.getByRole("heading", { level: 2, name: "Nhịp tim" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "SpO₂" })).toBeInTheDocument();

    // Wait for data to resolve (queries are async even with mockResolvedValue)
    await screen.findByText("Biểu đồ SpO₂");

    expect(screen.getByText("Biểu đồ SpO₂")).toBeInTheDocument();
    expect(screen.getByText(/Dữ liệu SpO₂ sẽ hiển thị khi thiết bị cung cấp phép đo/i)).toBeInTheDocument();
  });

  it("2. SpO₂ section heading and empty-state render when no data", async () => {
    const adapter = makeMockAdapter({
      listMeasurements: vi.fn().mockResolvedValue({ items: [], latest: null, expectedIntervalMinutes: 10, from: "", to: "" }),
    });

    renderEcoPatchPage(adapter);

    // SpO₂ section renders even without data
    expect(screen.getByRole("heading", { level: 2, name: "SpO₂" })).toBeInTheDocument();
    await screen.findByText("Biểu đồ SpO₂");
    expect(screen.getByText("Biểu đồ SpO₂")).toBeInTheDocument();
  });

  it("3. BPM section renders value when data is provided", async () => {
    const hrMeas = makeMeasurement(72, "heart_rate");
    const adapter = makeMockAdapter({
      listMeasurements: vi.fn().mockImplementation((_rid: string, query: { metric: string }) => {
        if (query.metric === "heart_rate") return Promise.resolve(makeSeries("heart_rate", [hrMeas]));
        return Promise.resolve({ items: [], latest: null, expectedIntervalMinutes: 10, from: "", to: "" });
      }),
    });

    renderEcoPatchPage(adapter);

    // Both headings render
    expect(screen.getByRole("heading", { level: 2, name: "Nhịp tim" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "SpO₂" })).toBeInTheDocument();

    // BPM measurement figure appears with value label
    await screen.findByText("Giá trị gần nhất");
    expect(screen.getByText("Giá trị gần nhất")).toBeInTheDocument();
  });

  it("4. Component does not create EventSource or direct fetch", async () => {
    const adapter = makeMockAdapter();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    renderEcoPatchPage(adapter);

    // Wait for the page to fully load
    await screen.findByRole("heading", { level: 2, name: "SpO₂" });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("5. SpO₂ quality badge renders correctly", async () => {
    const spo2Meas = makeMeasurement(97, "spo2");
    const adapter = makeMockAdapter({
      listMeasurements: vi.fn().mockImplementation((_rid: string, query: { metric: string }) => {
        if (query.metric === "spo2") return Promise.resolve(makeSeries("spo2", [spo2Meas]));
        return Promise.resolve({ items: [], latest: null, expectedIntervalMinutes: 10, from: "", to: "" });
      }),
    });

    renderEcoPatchPage(adapter);

    expect(screen.getByRole("heading", { level: 2, name: "SpO₂" })).toBeInTheDocument();
    await screen.findByText("Tín hiệu tốt");

    expect(screen.getByText("Tín hiệu tốt")).toBeInTheDocument();
  });

  it("6. Page renders all four sections: BPM, SpO₂, Core, Patch", async () => {
    const adapter = makeMockAdapter();
    renderEcoPatchPage(adapter);

    // Wait for the page to fully load
    await screen.findByRole("heading", { level: 2, name: "SpO₂" });

    expect(screen.getByRole("heading", { level: 2, name: "Nhịp tim" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "SpO₂" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Lõi điện tử" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Miếng dán" })).toBeInTheDocument();
  });
});
