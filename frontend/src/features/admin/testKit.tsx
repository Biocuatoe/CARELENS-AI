import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { routes } from "../../app/router";
import { AdminAuthProvider, useAdminAuth } from "../../app/adminAuth";
import { AuthProvider, useAuth } from "../../app/auth";
import { AdminClient } from "../../data/admin/adminClient";
import { DemoAdapter } from "../../data/demo/demoAdapter";
import { AdapterProvider } from "../../data";
import type { DataAdapter } from "../../data/adapter";
import { vi } from "vitest";

/**
 * Shared harness of the admin UI tests: a fake Worker at the `fetch` layer, the real router, providers, pages and client.
 * Everything is synthetic (e-mails end in .invalid, tokens are obvious fakes). It proves the browser side only: it says nothing
 * about real Google, the production Worker or its database. A test file that mounts pages must itself
 * `vi.mock("../../lib/navigation")` (vi.mock is hoisted per file).
 */
export const BASE = "https://api.test";
export const ADMIN_TOKEN = "clm_synthetic-admin-session-not-real";
export const VIEWER_TOKEN = "clc_synthetic-viewer-session-not-real";
export const CODE = "cax_synthetic-one-time-code-123";

export interface Call {
  method: string;
  path: string;
  /** The query string including the leading "?", or "". */
  search: string;
  auth: string | null;
  body: unknown;
  contentType: string | null;
}
export type Handler = (call: Call) => Response | Error | Promise<Response | Error>;

export const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const problem = (status: number, code: string) => json(status, { type: `urn:carelens:problem:${code}`, status, code, detail: "server detail the UI must not show", request_id: "r" });

export const profileBody = (over: Record<string, unknown> = {}, expiresInMs = 3_600_000) => ({
  auth_method: "session",
  admin_id: "adm_test",
  email: "owner@example.invalid",
  role: "owner",
  session: { expires_at: new Date(Date.now() + expiresInMs).toISOString(), authenticated_at: new Date().toISOString() },
  ...over,
});
export const exchangeBody = { token: ADMIN_TOKEN, token_type: "Bearer", expires_at: "2099-01-01T00:00:00.000Z", storage: "memory_only", admin: { admin_id: "adm_test", role: "owner" } };
export const readyBody = (admin = "configured") => ({ status: "ready", capabilities: { google_signin: "configured", ...(admin ? { admin_signin: admin } : {}) } });
export const capabilitiesBody = {
  tts: { available: false, reason: "no_text_to_speech_service", note: "Máy chủ không có dịch vụ chuyển văn bản thành giọng nói." },
  audio: {
    content_type: "audio/mpeg",
    codec: "mp3",
    sample_rates_hz: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000],
    channels: [1, 2],
    min_duration_ms: 500,
    max_duration_ms: 60000,
    max_bytes: 2000000,
    device_requirement: "audio_codecs_reports_mp3",
    legacy_wav: { upload: "refused", playback: "supported", sample_rates_hz: [16000], max_bytes: 2200000 },
  },
  commands: { voice_expiry_seconds: { min: 30, max: 3600 } },
  reminders: { timezone: "Asia/Ho_Chi_Minh", scheduler: "cloudflare_cron_every_minute", execution_evidence: "x" },
  device_playback: "not_verified_with_hardware",
};
export const statusBody = (over: Record<string, unknown> = {}) => ({
  server_time: "2026-10-19T03:00:00.000Z",
  storage: { d1_size_bytes: 2_500_000, imu_ingest: "accepting" },
  queue: [],
  failures_24h: [],
  last_successful_inference: [],
  fusion: { policy_version: "fusion-rules.v2", suspected_fall_possible: false },
  agents: [],
  devices: [],
  ...over,
});

export function makeBackend(overrides: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  const handlers: Record<string, Handler> = {
    "GET /ready": () => json(200, readyBody()),
    "POST /api/admin/v1/session/exchange": () => json(201, exchangeBody),
    "GET /api/admin/v1/me": () => json(200, profileBody()),
    "GET /api/admin/v1/status": () => json(200, statusBody()),
    "GET /api/admin/v1/capabilities": () => json(200, capabilitiesBody),
    "GET /api/admin/v1/devices": () => json(200, { items: [], server_time: "2026-10-19T03:00:00.000Z", simulated_sources: "rejected" }),
    "GET /api/admin/v1/audit": () => json(200, { items: [], next_cursor: null }),
    "DELETE /api/admin/v1/session": () => new Response(null, { status: 204 }),
    "GET /api/app/v1/auth/google/config": () => json(200, { enabled: true, access: "open_viewer", password_sign_in: true }),
    "POST /api/app/v1/session": () => json(201, { token: VIEWER_TOKEN, expires_at: "2099-01-01T00:00:00.000Z", user: { user_id: "usr_1", display_name: "Người xem thử" }, recipients: [{ recipient_id: "rcp-test", role: "viewer", permissions: ["data.read"] }] }),
    "DELETE /api/app/v1/session": () => new Response(null, { status: 204 }),
    ...overrides,
  };
  const impl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = { method: init.method ?? "GET", path: url.pathname, search: url.search, auth: headers.authorization ?? null, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body ? init.body : undefined, contentType: headers["content-type"] ?? null };
    calls.push(call);
    const handler = handlers[`${call.method} ${call.path}`];
    const out = handler ? await handler(call) : new Response(null, { status: 404 });
    if (out instanceof Error) throw out;
    return out;
  };
  const count = (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key).length;
  return { calls, impl: impl as unknown as typeof fetch, count, adminCalls: () => calls.filter((c) => c.path.startsWith("/api/admin/")) };
}

function Probe() {
  const viewer = useAuth().state.status;
  const admin = useAdminAuth().state.status;
  return <output data-testid="probe">{`viewer:${viewer} admin:${admin}`}</output>;
}

export async function mount(path: string, backend: ReturnType<typeof makeBackend>, options: { hash?: string; viewerLogin?: boolean } = {}) {
  vi.stubGlobal("fetch", backend.impl);
  window.history.replaceState(null, "", `${path}${options.hash ?? ""}`);
  const adapter = new DemoAdapter({ latencyMs: [0, 0], apiBase: BASE });
  if (options.viewerLogin) await adapter.login({ username: "viewer.test", password: "synthetic" });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AdapterProvider value={{ adapter: adapter as unknown as DataAdapter, demo: null }}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthProvider>
          <AdminAuthProvider client={new AdminClient(BASE)}>
            <Probe />
            <RouterProvider router={router} />
          </AdminAuthProvider>
        </AuthProvider>
      </QueryClientProvider>
    </AdapterProvider>,
  );
  return { router, adapter };
}


export const probe = () => screen.getByTestId("probe").textContent;
export const loginHeading = () => screen.findByRole("heading", { level: 1, name: "Đăng nhập quản trị" });
export const overviewHeading = () => screen.findByRole("heading", { level: 1, name: "Tổng quan quản trị" });

/** Signs in through the real fragment flow and lands on the page at `target`. */
export async function mountSignedIn(target: string, backend: ReturnType<typeof makeBackend>) {
  const mounted = await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
  await overviewHeading();
  if (target !== "/admin") {
    const { act } = await import("@testing-library/react");
    await act(async () => {
      await mounted.router.navigate(target);
    });
  }
  return mounted;
}
