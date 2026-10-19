import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ADMIN_TOKEN, CODE, VIEWER_TOKEN, json, makeBackend, mount, overviewHeading, loginHeading, probe, problem, profileBody, readyBody, statusBody } from "./testKit";

vi.mock("../../lib/navigation", () => ({ startFullPageNavigation: vi.fn() }));
import { startFullPageNavigation } from "../../lib/navigation";

/** The admin login and the overview against the shared fake Worker (see testKit.tsx). Browser side only. */
const googleButton = () => screen.findByRole("button", { name: "Đăng nhập quản trị bằng Google" });

beforeEach(() => vi.mocked(startFullPageNavigation).mockClear());
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("admin login", () => {
  it("starts the real admin Google flow with a full-page navigation to the server's mode=admin URL", async () => {
    const backend = makeBackend();
    await mount("/admin/login", backend);
    const button = await googleButton();
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(startFullPageNavigation).toHaveBeenCalledTimes(1);
    expect(startFullPageNavigation).toHaveBeenCalledWith("https://api.test/api/app/v1/auth/google/start?mode=admin");
    // Starting the flow touches no admin endpoint and holds no session.
    expect(backend.adminCalls()).toEqual([]);
    expect(probe()).toBe("viewer:signed_out admin:signed_out");
  });

  it("exchanges the one-time code once, removes it from the address bar, and only then shows the admin area", async () => {
    const backend = makeBackend();
    await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
    expect(await overviewHeading()).toBeVisible();

    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("cax_");
    const order = backend.adminCalls().map((c) => `${c.method} ${c.path}`);
    expect(order.slice(0, 2)).toEqual(["POST /api/admin/v1/session/exchange", "GET /api/admin/v1/me"]);
    const exchange = backend.adminCalls()[0]!;
    expect(exchange.body).toEqual({ code: CODE });
    expect(exchange.auth).toBeNull(); // the code is a ticket, not a credential
    expect(backend.count("POST /api/admin/v1/session/exchange")).toBe(1);
    // Everything after the exchange carries the session; /me ran before anything privileged rendered.
    expect(backend.adminCalls().slice(1).every((c) => c.auth === `Bearer ${ADMIN_TOKEN}`)).toBe(true);
    expect(probe()).toBe("viewer:signed_out admin:signed_in");
    // The session is never written to web storage or the address bar.
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toMatch(/clm_|cax_/);
    expect(document.body.textContent).not.toContain(ADMIN_TOKEN);
  });

  it("shows the identity and role exactly as the server reported them, never a role of its own", async () => {
    const backend = makeBackend({ "GET /api/admin/v1/me": () => json(200, profileBody({ role: "admin", email: "ops@example.invalid" })) });
    await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
    await overviewHeading();
    const banner = screen.getByLabelText("Tài khoản quản trị đang đăng nhập");
    expect(within(banner).getByText("ops@example.invalid")).toBeVisible();
    expect(within(banner).getByText("Quản trị viên")).toBeVisible();
    expect(within(banner).queryByText("Chủ sở hữu")).toBeNull();
  });

  it("removes a failed or foreign callback fragment from the address bar too, and never exchanges what it does not recognise", async () => {
    const backend = makeBackend();
    await mount("/admin/login", backend, { hash: "#code=clx_a-viewer-exchange-code&junk=1" });
    expect(await screen.findByText("Mã đăng nhập không hợp lệ. Vui lòng đăng nhập lại bằng Google.")).toBeVisible();
    expect(window.location.hash).toBe("");
    expect(backend.adminCalls()).toEqual([]);
    expect(backend.count("POST /api/app/v1/session/exchange")).toBe(0);
  });

  it.each([
    ["google_denied", "Bạn đã hủy đăng nhập bằng Google."],
    ["google_unauthorized", "Tài khoản Google này không có quyền quản trị CareLens AI."],
    ["google_state", "Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn."],
    ["google_token", "Không hoàn tất được đăng nhập Google."],
    ["something_unexpected", "Không hoàn tất được đăng nhập Google."],
  ])("reports the callback error %s without an exchange and with a clean address bar", async (reason, message) => {
    const backend = makeBackend();
    await mount("/admin/login", backend, { hash: `#error=${reason}` });
    expect(await screen.findByText(new RegExp(message))).toBeVisible();
    expect(window.location.hash).toBe("");
    expect(backend.adminCalls()).toEqual([]);
    expect(probe()).toBe("viewer:signed_out admin:signed_out");
    // A fresh attempt is one click away.
    expect(await googleButton()).toBeInTheDocument();
  });

  it.each([
    ["an expired, used or unknown code", () => problem(401, "invalid_credential"), "Mã đăng nhập đã hết hạn hoặc đã được dùng"],
    ["rate limiting", () => problem(429, "too_many_attempts"), "Có quá nhiều lần thử"],
    ["sign-in switched off", () => problem(503, "admin_signin_not_configured"), "Đăng nhập quản trị chưa được bật"],
    ["a server error", () => problem(500, "internal_error"), "Máy chủ không xử lý được yêu cầu"],
    ["an unreachable server", () => new TypeError("Failed to fetch"), "Không kết nối được máy chủ CareLens"],
  ])("handles %s on the exchange: clear message, no session, no /me, nothing leaked", async (_name, reply, message) => {
    const backend = makeBackend({ "POST /api/admin/v1/session/exchange": reply, "GET /health": () => new TypeError("down") });
    await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
    expect(await screen.findByText(new RegExp(message))).toBeVisible();
    expect(window.location.href).not.toContain("cax_");
    expect(backend.count("GET /api/admin/v1/me")).toBe(0);
    expect(probe()).toBe("viewer:signed_out admin:signed_out");
    expect(document.body.textContent).not.toContain("server detail the UI must not show");
    expect(backend.count("POST /api/admin/v1/session/exchange")).toBe(1); // the single-use code is never retried
  });

  it("refuses to enter when the server then rejects the new session at /me", async () => {
    for (const [status, shown] of [[401, "Phiên quản trị không hợp lệ hoặc đã hết hạn"], [403, "không có quyền quản trị"]] as const) {
      const backend = makeBackend({ "GET /api/admin/v1/me": () => problem(status, "invalid_credential") });
      await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
      await waitFor(() => expect(document.body.textContent).toMatch(new RegExp(shown)));
      expect(screen.queryByRole("heading", { name: "Tổng quan quản trị" })).toBeNull();
      expect(backend.count("GET /api/admin/v1/status")).toBe(0);
      expect(probe()).toBe("viewer:signed_out admin:signed_out");
      cleanup();
    }
  });

  it("keeps an unconfirmed session out of the admin area and lets the person retry the confirmation", async () => {
    let attempts = 0;
    const backend = makeBackend({ "GET /api/admin/v1/me": () => (++attempts === 1 ? problem(503, "unavailable") : json(200, profileBody())) });
    await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
    const retry = await screen.findByRole("button", { name: "Thử xác minh lại" });
    expect(probe()).toBe("viewer:signed_out admin:unverified");
    expect(screen.queryByRole("heading", { name: "Tổng quan quản trị" })).toBeNull();
    await userEvent.click(retry);
    expect(await overviewHeading()).toBeVisible();
    expect(backend.count("POST /api/admin/v1/session/exchange")).toBe(1); // retry reuses the session, not the spent code
  });

  it.each([
    ["not configured", { status: "ready", capabilities: { google_signin: "configured", admin_signin: "not_configured" } }, "Đăng nhập quản trị chưa được bật trên máy chủ này."],
    ["misconfigured", { status: "ready", capabilities: { google_signin: "configured", admin_signin: "misconfigured" } }, "Cấu hình đăng nhập trên máy chủ chưa đúng. Người vận hành cần kiểm tra."],
    ["Google off", { status: "ready", capabilities: { google_signin: "not_configured", admin_signin: "configured" } }, "Đăng nhập bằng Google chưa được cấu hình trên máy chủ này."],
    ["an older server", readyBody(""), "Máy chủ này chưa hỗ trợ đăng nhập quản trị."],
  ])("disables the button and says why when the server reports admin sign-in as %s", async (_name, body, message) => {
    await mount("/admin/login", makeBackend({ "GET /ready": () => json(200, body) }));
    expect(await screen.findByText(message)).toBeVisible();
    expect(await googleButton()).toBeDisabled();
  });

  it("offers a retry when the readiness check itself fails", async () => {
    let first = true;
    const backend = makeBackend({ "GET /ready": () => (first ? ((first = false), new TypeError("Failed to fetch")) : json(200, readyBody())), "GET /health": () => new TypeError("down") });
    await mount("/admin/login", backend);
    expect(await screen.findByText(/Không kết nối được máy chủ CareLens/)).toBeVisible();
    expect(await googleButton()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(async () => expect(await googleButton()).toBeEnabled());
  });
});

describe("protected /admin", () => {
  it("sends an unauthenticated visitor to the admin login without calling any admin endpoint", async () => {
    const backend = makeBackend();
    const { router } = await mount("/admin", backend);
    expect(await loginHeading()).toBeVisible();
    expect(router.state.location.pathname).toBe("/admin/login");
    expect(backend.adminCalls()).toEqual([]);
  });

  it("does not let a signed-in viewer into /admin, and never sends the viewer's token to an admin endpoint", async () => {
    const backend = makeBackend();
    const { router, adapter } = await mount("/admin", backend, { viewerLogin: true });
    expect(adapter.hasBackendSession()).toBe(true);
    expect(await loginHeading()).toBeVisible();
    expect(router.state.location.pathname).toBe("/admin/login");
    expect(backend.adminCalls()).toEqual([]);
    expect(backend.calls.some((c) => c.path.startsWith("/api/admin/") && c.auth === `Bearer ${VIEWER_TOKEN}`)).toBe(false);
    expect(probe()).toBe("viewer:signed_in admin:signed_out"); // the viewer is still a viewer, and not an admin
    // Asking again by URL changes nothing.
    await act(async () => {
      await router.navigate("/admin/anything");
    });
    expect(await loginHeading()).toBeVisible();
    expect(backend.adminCalls()).toEqual([]);
  });

  it("reaches the admin area only through an admin session, and leaves the viewer session as it was", async () => {
    const backend = makeBackend();
    const { router, adapter } = await mount("/admin/login", backend, { hash: `#admin_code=${CODE}`, viewerLogin: true });
    await overviewHeading();
    expect(probe()).toBe("viewer:signed_in admin:signed_in");
    // Signing the admin out ends only the admin session.
    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    expect(await loginHeading()).toBeVisible();
    expect(probe()).toBe("viewer:signed_in admin:signed_out");
    expect(adapter.hasBackendSession()).toBe(true);
    expect(backend.calls.find((c) => c.method === "DELETE" && c.path === "/api/admin/v1/session")?.auth).toBe(`Bearer ${ADMIN_TOKEN}`);
    expect(backend.count("DELETE /api/app/v1/session")).toBe(0);
    expect(router.state.location.pathname).toBe("/admin/login");
  });

  it("confirms the session with /me again when /admin is entered later, but not twice right after sign-in", async () => {
    const backend = makeBackend();
    const { router } = await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
    await overviewHeading();
    expect(backend.count("GET /api/admin/v1/me")).toBe(1);
    // A minute later the confirmation is stale. Going through the login route unmounts the guard; coming back re-enters it.
    const realNow = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(realNow + 60_000);
    try {
      await act(async () => {
        await router.navigate("/admin/login");
      });
      await waitFor(() => expect(backend.count("GET /api/admin/v1/me")).toBe(2));
      expect(await overviewHeading()).toBeVisible();
    } finally {
      clock.mockRestore();
    }
  });

  it("signs out and returns to the login with an explanation when the server answers 401 to an admin call", async () => {
    const backend = makeBackend({ "GET /api/admin/v1/status": () => problem(401, "invalid_credential") });
    const { router } = await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
    expect(await loginHeading()).toBeVisible();
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/login"));
    expect(await screen.findByText(/Phiên quản trị đã hết hạn hoặc không còn hợp lệ/)).toBeVisible();
    expect(probe()).toBe("viewer:signed_out admin:signed_out");
    // The expired session is gone: asking for /admin again goes back to the login and sends nothing.
    const before = backend.adminCalls().length;
    await act(async () => {
      await router.navigate("/admin");
    });
    expect(await loginHeading()).toBeVisible();
    expect(backend.adminCalls().length).toBe(before);
  });

  it("treats a 403 from an admin call as the end of the admin session", async () => {
    const backend = makeBackend({ "GET /api/admin/v1/status": () => problem(403, "forbidden") });
    await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
    expect(await screen.findByText("Máy chủ từ chối quyền quản trị của tài khoản này.")).toBeVisible();
    expect(probe()).toBe("viewer:signed_out admin:signed_out");
  });

  it("leaves the admin area at the session's expiry time without waiting for a failed call", async () => {
    const backend = makeBackend({ "GET /api/admin/v1/me": () => json(200, profileBody({}, 150)) });
    await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
    expect(await screen.findByText(/Phiên quản trị đã hết hạn hoặc không còn hợp lệ/, undefined, { timeout: 3000 })).toBeVisible();
    expect(probe()).toBe("viewer:signed_out admin:signed_out");
    expect(backend.count("GET /api/admin/v1/me")).toBe(1);
  });

  it("logs out through the admin endpoint and clears the session even when the server cannot confirm it", async () => {
    const backend = makeBackend({ "DELETE /api/admin/v1/session": () => new TypeError("Failed to fetch"), "GET /health": () => new TypeError("down") });
    const { router } = await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
    await overviewHeading();
    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    expect(await screen.findByText(/máy chủ chưa xác nhận việc kết thúc phiên/)).toBeVisible();
    expect(probe()).toBe("viewer:signed_out admin:signed_out");
    // Cleared locally regardless: nothing more is sent with the old token.
    const before = backend.adminCalls().length;
    await act(async () => {
      await router.navigate("/admin");
    });
    expect(await loginHeading()).toBeVisible();
    expect(backend.adminCalls().length).toBe(before);
  });
});

describe("admin overview", () => {
  it("shows what the server reported and states plainly what is not available, without invented data", async () => {
    const backend = makeBackend();
    await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
    await overviewHeading();
    expect(await screen.findByText("Chưa có thiết bị nào được đăng ký")).toBeVisible();
    expect(screen.getByText("Chưa có agent nào được đăng ký")).toBeVisible();
    expect(await screen.findByText("Chưa có thao tác quản trị nào được ghi.")).toBeVisible();
    expect(screen.getByText("Không có")).toBeVisible(); // text-to-speech
    expect(screen.getByText("Chưa kiểm chứng với phần cứng")).toBeVisible();
    expect(screen.getByText("Cấp phát chưa có ở giai đoạn này")).toBeVisible();
    expect(screen.getByText("Chưa bật: chưa có quy tắc nào được duyệt")).toBeVisible();
    // No provisioning controls exist yet.
    expect(screen.queryByRole("button", { name: /đăng ký thiết bị|cấp|xoay|thu hồi|mời/i })).toBeNull();
    // Only read endpoints were called for data: nothing wrote anything.
    const calls = backend.adminCalls().map((c) => `${c.method} ${c.path}`);
    expect(calls.slice(0, 2)).toEqual(["POST /api/admin/v1/session/exchange", "GET /api/admin/v1/me"]);
    expect(calls.slice(2).sort()).toEqual(["GET /api/admin/v1/audit", "GET /api/admin/v1/capabilities", "GET /api/admin/v1/devices", "GET /api/admin/v1/status"]);
  });

  it("lists the devices and agents the server reported, with times and health as reported", async () => {
    const backend = makeBackend({
      "GET /api/admin/v1/status": () =>
        json(
          200,
          statusBody({
            devices: [{ device_id: "esp32-test", recipient_id: "rcp-test", status: "active", firmware_version: "fw-test-0", last_seen_at: "2026-10-19T02:59:00.000Z", last_contact_age_seconds: 60, connected: true, heartbeat_status: { camera: "ok", imu: "error", speaker: "disabled", wifi_rssi_dbm: -61, last_error: "imu_i2c_timeout" } }],
            agents: [{ agent_id: "agt_test", label: "PC thử", status: "active", last_seen_at: null, connected: false, reported: null }],
          }),
        ),
    });
    await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
    const table = await screen.findByRole("table", { name: "Thiết bị đã đăng ký, chỉ xem" });
    expect(within(table).getByText("esp32-test")).toBeVisible();
    expect(within(table).getByText("fw-test-0")).toBeVisible();
    expect(within(table).getByText("Có liên lạc gần đây")).toBeVisible();
    expect(within(table).getByText("IMU: lỗi")).toBeVisible();
    expect(within(table).getByText("Lỗi gần nhất: imu_i2c_timeout")).toBeVisible();
    expect(screen.getByText("PC thử")).toBeVisible();
    expect(screen.getByText("Không kết nối")).toBeVisible();
    expect(screen.getByText("Chưa từng liên lạc")).toBeVisible();
  });

  it("shows a status failure as an error with a retry, never as an empty or healthy system", async () => {
    let fail = true;
    const backend = makeBackend({ "GET /api/admin/v1/status": () => (fail ? problem(500, "internal_error") : json(200, statusBody())) });
    await mount("/admin/login", backend, { hash: `#admin_code=${CODE}` });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Không tải được trạng thái hệ thống")).toBeVisible();
    expect(screen.queryByText("Chưa có thiết bị nào được đăng ký")).toBeNull();
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Chưa có thiết bị nào được đăng ký")).toBeVisible();
    expect(probe()).toBe("viewer:signed_out admin:signed_in"); // a transient failure does not end the session
  });
});

describe("viewer login is unchanged", () => {
  it("still renders the viewer form and Google button and talks to no admin endpoint", async () => {
    const backend = makeBackend();
    await mount("/login", backend);
    expect(await screen.findByRole("heading", { level: 1, name: "Đăng nhập" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: /^Tài khoản/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Đăng nhập bằng Google" })).toBeVisible();
    await waitFor(() => expect(backend.count("GET /api/app/v1/auth/google/config")).toBeGreaterThan(0));
    expect(backend.adminCalls()).toEqual([]);
    expect(backend.count("GET /ready")).toBe(0);
  });

  it("does not exchange an admin code on the viewer page, and leaves the viewer fragment contract alone", async () => {
    const backend = makeBackend({ "POST /api/app/v1/session/exchange": () => problem(401, "invalid_credential") });
    await mount("/login", backend, { hash: "#code=clx_viewer-exchange-code" });
    await waitFor(() => expect(backend.count("POST /api/app/v1/session/exchange")).toBe(1));
    expect(backend.adminCalls()).toEqual([]);
    expect(window.location.hash).toBe("");
  });
});
