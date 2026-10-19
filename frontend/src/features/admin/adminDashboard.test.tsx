import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, makeBackend, mountSignedIn, mount, loginHeading, probe, problem, type Call, type Handler } from "./testKit";

vi.mock("../../lib/navigation", () => ({ startFullPageNavigation: vi.fn() }));

/**
 * The dashboard pages (devices, daily report, audio messages, reminders, agents, audit) against a fake Worker at the `fetch`
 * layer. Every payload is synthetic. These tests show that each control calls the documented endpoint with the documented body,
 * that errors are shown as errors (never as an empty or healthy state), and that nothing is called "played" without the device's
 * own report. They do not show that a real Worker, a real ESP32 or real Google behave this way.
 */

const device = (over: Record<string, unknown> = {}) => ({
  device_id: "esp32-test-1",
  recipient_id: "rcp-test",
  kind: "esp32_s3_cam",
  label: "Thiết bị thử 1",
  status: "active",
  firmware_version: "fw-test-0",
  created_at: "2026-10-18T02:00:00.000Z",
  revoked_at: null,
  credential: { state: "active", version: 3 },
  last_seen_at: "2026-10-19T02:59:00.000Z",
  last_contact_age_seconds: 60,
  connected: true,
  online_window_seconds: 180,
  last_boot_id: "boot-1",
  heartbeat: { at: "2026-10-19T02:59:00.000Z", status: { camera: "ok", imu: "error", speaker: "ok", wifi_rssi_dbm: -61, free_heap_bytes: 120000, last_error: null } },
  last_capture: { captured_at: "2026-10-19T02:58:00.000Z", status: "processed", failure_code: null, source_mode: "simulated" },
  last_event: { observed_at: "2026-10-19T02:58:30.000Z", event_type: "fall_check", classification: "uncalibrated_output", verification_status: "unverified", source_mode: "simulated" },
  last_inference_at: "2026-10-19T02:58:40.000Z",
  commands: { active: { queued: 1 }, last_24h: { completed: 2 } },
  has_simulated_records_7d: true,
  ...over,
});
const devicesBody = (items: unknown[] = [device()]) => ({ items, server_time: "2026-10-19T03:00:00.000Z", simulated_sources: "accepted" });

const command = (over: Record<string, unknown> = {}) => ({
  command_id: "cmd_1",
  device_id: "esp32-test-1",
  command_type: "play_voice_message",
  status: "queued",
  status_reason: null,
  played_confirmed_by_device: false,
  payload: { voice: { voice_message_id: "vm_1", version: 1 } },
  not_before: "2026-10-19T03:00:00.000Z",
  expires_at: "2026-10-19T03:05:00.000Z",
  delivery_attempts: 0,
  created_at: "2026-10-19T03:00:00.000Z",
  delivered_at: null,
  accepted_at: null,
  started_at: null,
  finished_at: null,
  cancel_requested_at: null,
  created_by: "admin:adm_test",
  ...over,
});
const voiceItem = { voice_message_id: "vm_1", title: "Nhắc uống nước", status: "active", created_by: "admin:adm_test", created_at: "2026-10-19T02:00:00.000Z", audio: { version: 1, sample_rate_hz: 16000, duration_ms: 2000, byte_size: 64044 } };

const reminder = (over: Record<string, unknown> = {}) => ({
  reminder_id: "rem_1",
  device_id: "esp32-test-1",
  kind: "water",
  label: "Uống một cốc nước",
  voice_message_id: null,
  times_local: ["10:05"],
  days_of_week: [1],
  timezone: "Asia/Ho_Chi_Minh",
  start_date: "2026-10-19",
  end_date: "2026-10-19",
  deadline_minutes: 15,
  status: "active",
  paused_at: null,
  version: 1,
  schedule_kind: "once",
  state: "scheduled",
  next_occurrence_at: "2026-10-19T03:05:00.000Z",
  window_open: false,
  last_dispatch: null,
  ...over,
});

const ok = (body: unknown, status = 200) => () => json(status, body);
const base = (extra: Record<string, Handler> = {}) =>
  makeBackend({
    "GET /api/admin/v1/devices": ok(devicesBody()),
    "GET /api/admin/v1/devices/esp32-test-1": ok({ device: device(), last_boot: null, server_time: "2026-10-19T03:00:00.000Z" }),
    "GET /api/admin/v1/devices/esp32-test-1/commands": ok({ items: [], next_cursor: null }),
    "GET /api/admin/v1/devices/esp32-test-1/voice-messages": ok({ items: [voiceItem] }),
    "GET /api/admin/v1/devices/esp32-test-1/reminders": ok({ items: [], timezone: "Asia/Ho_Chi_Minh", server_time: "2026-10-19T03:00:00.000Z" }),
    ...extra,
  });
const writes = (backend: ReturnType<typeof makeBackend>) => backend.adminCalls().filter((c) => c.method !== "GET" && c.path !== "/api/admin/v1/session/exchange");
const find = (backend: ReturnType<typeof makeBackend>, key: string): Call[] => backend.calls.filter((c) => `${c.method} ${c.path}` === key);

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:synthetic-preview"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("navigation and protection", () => {
  it("offers every dashboard section from the layout, and keeps the current one marked", async () => {
    await mountSignedIn("/admin/devices", base());
    const nav = await screen.findByRole("navigation", { name: "Khu quản trị" });
    for (const name of ["Tổng quan", "Thiết bị", "Báo cáo ngày", "Gửi âm thanh", "Nhắc lịch", "Agent", "Nhật ký"]) expect(within(nav).getByRole("link", { name })).toBeVisible();
    expect(within(nav).getByRole("link", { name: "Thiết bị" })).toHaveAttribute("aria-current", "page");
  });

  it("sends a visitor without an admin session from any dashboard page to the login, calling no admin endpoint", async () => {
    for (const path of ["/admin/devices", "/admin/devices/esp32-test-1", "/admin/reports", "/admin/messages", "/admin/reminders", "/admin/agents", "/admin/audit"]) {
      const backend = base();
      const { router } = await mount(path, backend);
      expect(await loginHeading()).toBeVisible();
      expect(router.state.location.pathname).toBe("/admin/login");
      expect(backend.adminCalls()).toEqual([]);
      expect(probe()).toBe("viewer:signed_out admin:signed_out");
      (await import("@testing-library/react")).cleanup();
    }
  });

  it("ends the admin session when a dashboard call is answered with 401", async () => {
    const backend = base({ "GET /api/admin/v1/devices": () => problem(401, "invalid_credential") });
    const { router } = await mountSignedIn("/admin/devices", backend);
    expect(await loginHeading()).toBeVisible();
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/login"));
    expect(probe()).toBe("viewer:signed_out admin:signed_out");
  });
});

describe("devices", () => {
  it("lists the registered devices from the server with their credential-free state and a simulated-data mark", async () => {
    const backend = base();
    await mountSignedIn("/admin/devices", backend);
    const table = await screen.findByRole("table", { name: "Thiết bị đã đăng ký" });
    const row = within(table).getByRole("row", { name: /Thiết bị thử 1/ });
    expect(within(row).getByText("esp32-test-1")).toBeVisible();
    expect(within(row).getByText("fw-test-0")).toBeVisible();
    expect(within(row).getByText("Có liên lạc gần đây")).toBeVisible();
    expect(within(row).getByText("Có dữ liệu mô phỏng (7 ngày)")).toBeVisible();
    expect(screen.getByText("Máy chủ này nhận dữ liệu mô phỏng")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/cld_|token/i);
  });

  it("shows an empty registry as empty, and a failed load as an error with a retry (never as empty)", async () => {
    await mountSignedIn("/admin/devices", base({ "GET /api/admin/v1/devices": ok(devicesBody([])) }));
    expect(await screen.findByText("Chưa có thiết bị nào được đăng ký")).toBeVisible();
    (await import("@testing-library/react")).cleanup();

    let fail = true;
    await mountSignedIn("/admin/devices", base({ "GET /api/admin/v1/devices": () => (fail ? problem(500, "internal_error") : json(200, devicesBody())) }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Không tải được danh sách thiết bị")).toBeVisible();
    expect(screen.queryByText("Chưa có thiết bị nào được đăng ký")).toBeNull();
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("table", { name: "Thiết bị đã đăng ký" })).toBeVisible();
  });

  it("says plainly when the server has no dashboard API yet (404), instead of showing nothing", async () => {
    const backend = base({ "GET /api/admin/v1/devices": () => new Response(null, { status: 404 }) });
    await mountSignedIn("/admin/devices", backend);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/chưa có API này/)).toBeVisible();
  });

  it("shows one device's registration, credential state, self-reported health and commands, and no credential material", async () => {
    const backend = base({ "GET /api/admin/v1/devices/esp32-test-1/commands": ok({ items: [command({ status: "completed", played_confirmed_by_device: true }), command({ command_id: "cmd_2", status: "queued" })], next_cursor: null }) });
    await mountSignedIn("/admin/devices/esp32-test-1", backend);
    expect(await screen.findByRole("heading", { level: 1, name: "Thiết bị thử 1" })).toBeVisible();
    expect(screen.getByText("Đang hiệu lực (phiên bản 3)")).toBeVisible();
    expect(screen.getByText(/Đây là lời tự báo của firmware/)).toBeVisible();
    expect(screen.getByText("IMU")).toBeVisible();
    expect(screen.getByText("lỗi")).toBeVisible(); // the device said imu: error
    expect(screen.getByText(/Giao diện không hiện và không thể lấy lại credential/)).toBeVisible();
    expect((await screen.findAllByText("Thiết bị báo đã phát xong")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Đang chờ thiết bị lấy lệnh").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: "Báo cáo theo ngày" })).toHaveAttribute("href", "/admin/reports?device=esp32-test-1");
    expect(writes(backend)).toEqual([]); // looking changes nothing
  });
});

describe("daily activity report", () => {
  const entry = (at: string, source: string, kind: string, over: Record<string, unknown> = {}) => ({ at, source, kind, ref_id: `${source}-${at}`, source_mode: null, status: null, detail: {}, ...over });
  const reportBody = (over: Record<string, unknown> = {}) => ({
    device: { device_id: "esp32-test-1", recipient_id: "rcp-test", label: "Thiết bị thử 1", status: "active" },
    date: "2026-10-19",
    timezone: "Asia/Ho_Chi_Minh",
    period: { start: "2026-10-18T17:00:00.000Z", end: "2026-10-19T17:00:00.000Z", interval: "[start, end)" },
    generated_at: "2026-10-19T03:00:00.000Z",
    in_future: false,
    sources: {
      events: { status: "ok", count: 1 },
      captures: { status: "truncated", count: 300, note: "Chỉ hiển thị 300 bản ghi đầu tiên của nguồn này trong ngày." },
      heartbeat: { status: "partial", count: 0, note: "Chỉ lưu heartbeat gần nhất của thiết bị, không có lịch sử heartbeat theo ngày." },
      imu: { status: "retention_expired", count: 0, note: "IMU thô chỉ được giữ 72 giờ; ngày này đã quá hạn." },
      agent_connectivity: { status: "not_stored", count: 0, note: "Chỉ lưu thời điểm agent liên lạc gần nhất." },
    },
    entries: [
      entry("2026-10-19T02:58:00.000Z", "captures", "capture", { ref_id: "cap-1", source_mode: "simulated", status: "processed", detail: { frame_count: 24, media_deleted: true } }),
      entry("2026-10-19T02:59:30.000Z", "events", "imu_trigger", { ref_id: "ev-1", source_mode: "simulated", status: "imu_trigger_reported" }),
    ],
    ...over,
  });
  const activityPath = "GET /api/admin/v1/devices/esp32-test-1/activity";

  it("asks for today in Vietnam, not in the browser's zone, and shows the interval it covers", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T17:30:00.000Z")); // 00:30 on the 20th in Asia/Ho_Chi_Minh, still the 19th in UTC
    const backend = base({ [activityPath]: ok(reportBody({ date: "2026-10-20" })) });
    await mountSignedIn("/admin/reports", backend);
    await screen.findByText(/Khoảng thời gian:/);
    const requested = find(backend, activityPath);
    expect(requested).toHaveLength(1);
    expect(requested[0]!.search).toBe("?date=2026-10-20");
    expect(screen.getByLabelText(/Ngày \(giờ Việt Nam\)/)).toHaveValue("2026-10-20");
  });

  it("shows the timeline in order, labels simulated records, and states which sources are partial, cut, expired or not stored", async () => {
    const backend = base({ [activityPath]: ok(reportBody()) });
    await mountSignedIn("/admin/reports", backend);
    expect(await screen.findByText(/Dòng thời gian \(2\)/)).toBeVisible();
    const items = screen.getAllByRole("listitem").filter((li) => li.querySelector("time"));
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Lần chụp");
    expect(items[1]).toHaveTextContent("Firmware báo kích hoạt IMU (không phải kết luận ngã)");
    expect(screen.getAllByText("Dữ liệu mô phỏng").length).toBeGreaterThanOrEqual(2);
    const coverage = screen.getByRole("region", { name: "Nguồn dữ liệu của ngày này" });
    expect(within(coverage).getByText("Bị cắt bớt")).toBeVisible();
    expect(within(coverage).getByText("Chỉ một phần")).toBeVisible();
    expect(within(coverage).getByText("Quá hạn lưu giữ")).toBeVisible();
    expect(within(coverage).getByText("Không được lưu")).toBeVisible();
    expect(screen.getByText(/Khoảng thời gian: .* \(nửa mở \[bắt đầu, kết thúc\)\)/)).toBeVisible();
  });

  it("filters the timeline by source without calling the server again", async () => {
    const backend = base({ [activityPath]: ok(reportBody()) });
    await mountSignedIn("/admin/reports", backend);
    await screen.findByText(/Dòng thời gian \(2\)/);
    await userEvent.selectOptions(screen.getByLabelText("Nguồn"), "events");
    expect(await screen.findByText(/Dòng thời gian \(1 \/ 2\)/)).toBeVisible();
    expect(find(backend, activityPath)).toHaveLength(1);
  });

  it("explains an empty day without calling it quiet, and a failed load as a failure", async () => {
    await mountSignedIn("/admin/reports", base({ [activityPath]: ok(reportBody({ entries: [], sources: { events: { status: "ok", count: 0 }, imu: { status: "partial", count: 0, note: "một phần" } } })) }));
    expect(await screen.findByText("Không có bản ghi nào trong ngày này")).toBeVisible();
    expect(screen.getByText(/Danh sách trống chỉ có nghĩa là các nguồn ở trạng thái/)).toBeVisible();
    (await import("@testing-library/react")).cleanup();

    await mountSignedIn("/admin/reports", base({ [activityPath]: () => problem(500, "internal_error") }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Không tải được báo cáo")).toBeVisible();
    expect(within(alert).getByText(/không có nghĩa là ngày này không có hoạt động/)).toBeVisible();
    expect(screen.queryByText("Không có bản ghi nào trong ngày này")).toBeNull();
  });

  it("loads another day when the date changes and says when a day has not happened yet", async () => {
    const backend = base({
      [activityPath]: (call) => json(200, call.search.includes("2030-01-01") ? reportBody({ date: "2030-01-01", in_future: true, entries: [] }) : reportBody()),
    });
    await mountSignedIn("/admin/reports", backend);
    await screen.findByText(/Dòng thời gian \(2\)/);
    const input = screen.getByLabelText(/Ngày \(giờ Việt Nam\)/);
    fireEvent.change(input, { target: { value: "2030-01-01" } });
    expect(await screen.findByText(/Ngày này chưa tới nên chưa thể có bản ghi/)).toBeVisible();
    expect(find(backend, activityPath).map((c) => c.search)).toContain("?date=2030-01-01");
  });

  it("downloads a CSV of exactly the loaded entries", async () => {
    const backend = base({ [activityPath]: ok(reportBody()) });
    await mountSignedIn("/admin/reports", backend);
    await screen.findByText(/Dòng thời gian \(2\)/);
    const blobs: Blob[] = [];
    vi.mocked(URL.createObjectURL).mockImplementation((b: Blob | MediaSource) => {
      blobs.push(b as Blob);
      return "blob:synthetic-csv";
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await userEvent.click(screen.getByRole("button", { name: "Tải CSV" }));
    expect(click).toHaveBeenCalledTimes(1);
    const text = await blobs[0]!.text();
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(3); // header + 2 entries
    expect(text).toContain("cap-1");
    click.mockRestore();
  });

  it("offers no device to report on when none is registered", async () => {
    await mountSignedIn("/admin/reports", base({ "GET /api/admin/v1/devices": ok(devicesBody([])) }));
    expect(await screen.findByText("Chưa có thiết bị nào được đăng ký")).toBeVisible();
    expect(screen.queryByLabelText(/Ngày/)).toBeNull();
  });
});

describe("audio messages", () => {
  const sendPath = "POST /api/admin/v1/devices/esp32-test-1/voice-commands";

  const chooseRecording = async () => {
    await userEvent.click(await screen.findByRole("radio", { name: /Nhắc uống nước/ }));
  };

  it("says text-to-speech does not exist and offers no text box for a spoken message", async () => {
    await mountSignedIn("/admin/messages", base());
    expect(await screen.findByText("Chuyển văn bản thành giọng nói chưa được hỗ trợ")).toBeVisible();
    expect(screen.getByText(/Máy chủ không có dịch vụ chuyển văn bản thành giọng nói/)).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /nội dung|văn bản|lời nhắn/i })).toBeNull();
    expect(await screen.findByText(/Việc phát trên loa của ESP32 thật chưa được kiểm chứng/)).toBeVisible();
  });

  it("sends nothing until the final confirmation, then sends exactly one command with the confirm flag and an idempotency key", async () => {
    const backend = base({ [sendPath]: () => json(201, { command: command(), created: true }) });
    await mountSignedIn("/admin/messages", backend);
    await chooseRecording();
    await userEvent.selectOptions(screen.getByLabelText("Còn hiệu lực trong"), "900");
    await userEvent.click(screen.getByRole("button", { name: "Gửi tới thiết bị…" }));
    const dialog = await screen.findByRole("dialog", { name: "Xác nhận gửi tới thiết bị thật" });
    expect(within(dialog).getByText(/Thiết bị thử 1 \(esp32-test-1\)/)).toBeVisible();
    expect(find(backend, sendPath)).toHaveLength(0); // opening the dialog sends nothing
    await userEvent.click(within(dialog).getByRole("button", { name: "Không gửi" }));
    expect(find(backend, sendPath)).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Gửi tới thiết bị…" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Xác nhận gửi" }));
    expect(await screen.findByText("Lệnh đã được máy chủ nhận")).toBeVisible();
    const sent = find(backend, sendPath);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ voice_message_id: "vm_1", expires_in_seconds: 900, confirm: true });
    expect((sent[0]!.body as { idempotency_key: string }).idempotency_key.length).toBeGreaterThanOrEqual(8);
    expect(sent[0]!.auth).toMatch(/^Bearer clm_/);
    // The acceptance message says what is and is not known.
    expect(screen.getByText(/chưa có nghĩa là thiết bị đã phát/)).toBeVisible();
  });

  it("does not create two commands when the confirm button is pressed twice", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const backend = base({
      [sendPath]: async () => {
        await gate;
        return json(201, { command: command(), created: true });
      },
    });
    await mountSignedIn("/admin/messages", backend);
    await chooseRecording();
    await userEvent.click(screen.getByRole("button", { name: "Gửi tới thiết bị…" }));
    const confirm = within(await screen.findByRole("dialog")).getByRole("button", { name: "Xác nhận gửi" });
    await userEvent.dblClick(confirm);
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Đang gửi…" })).toBeDisabled());
    await act(async () => release());
    await screen.findByText("Lệnh đã được máy chủ nhận");
    expect(find(backend, sendPath)).toHaveLength(1);
  });

  it("keeps the dialog and shows the reason when the server refuses, without claiming success", async () => {
    const backend = base({ [sendPath]: () => problem(422, "audio_not_playable") });
    await mountSignedIn("/admin/messages", backend);
    await chooseRecording();
    await userEvent.click(screen.getByRole("button", { name: "Gửi tới thiết bị…" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Xác nhận gửi" }));
    expect(await screen.findByText(/không đúng tốc độ lấy mẫu/)).toBeVisible();
    expect(screen.queryByText("Lệnh đã được máy chủ nhận")).toBeNull();
  });

  it("shows each protocol state by what the device really reported, and 'played' only for completed", async () => {
    const statuses = ["queued", "delivered", "accepted", "started", "completed", "failed", "rejected", "cancelled", "expired", "superseded"];
    const items = statuses.map((s, i) => command({ command_id: `cmd_${i}`, status: s, played_confirmed_by_device: s === "completed" }));
    await mountSignedIn("/admin/messages", base({ "GET /api/admin/v1/devices/esp32-test-1/commands": ok({ items, next_cursor: null }) }));
    const list = await screen.findByText("Thiết bị báo đã phát xong");
    expect(list).toBeVisible();
    expect(screen.getAllByText("Thiết bị báo đã phát xong")).toHaveLength(1);
    expect(screen.getAllByText("Thiết bị đã báo phát xong.")).toHaveLength(1);
    expect(screen.getAllByText(/Chưa có xác nhận phát xong từ thiết bị/)).toHaveLength(9);
    for (const label of ["Đang chờ thiết bị lấy lệnh", "Đã giao cho thiết bị, chưa được xác nhận", "Thiết bị đã nhận lệnh", "Thiết bị báo đang phát", "Thiết bị báo lỗi khi phát", "Thiết bị từ chối lệnh", "Đã hủy", "Hết hạn trước khi phát", "Bị lần nhắc sau thay thế"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("never reads 'completed' as played when the flag says otherwise, and treats an unknown status as unknown", async () => {
    const items = [command({ status: "completed", played_confirmed_by_device: false }), command({ command_id: "cmd_x", status: "teleported", played_confirmed_by_device: true })];
    await mountSignedIn("/admin/messages", base({ "GET /api/admin/v1/devices/esp32-test-1/commands": ok({ items, next_cursor: null }) }));
    await screen.findByText("Không rõ trạng thái");
    expect(screen.queryByText("Thiết bị đã báo phát xong.")).toBeNull();
  });

  it("cancels an open command and says the device must still confirm", async () => {
    const backend = base({
      "GET /api/admin/v1/devices/esp32-test-1/commands": ok({ items: [command({ status: "delivered" })], next_cursor: null }),
      "POST /api/admin/v1/commands/cmd_1/cancel": () => json(202, { command: command({ status: "delivered", cancel_requested_at: "2026-10-19T03:01:00.000Z" }), cancel_pending_device_confirmation: true }),
    });
    await mountSignedIn("/admin/messages", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Hủy lệnh" }));
    expect(await screen.findByText(/thiết bị phải xác nhận mới coi là đã dừng/)).toBeVisible();
    expect(find(backend, "POST /api/admin/v1/commands/cmd_1/cancel")).toHaveLength(1);
  });

  it("refuses to send to a revoked device", async () => {
    const revoked = device({ status: "revoked", revoked_at: "2026-10-19T01:00:00.000Z", credential: { state: "revoked", version: 3 } });
    await mountSignedIn("/admin/messages", base({ "GET /api/admin/v1/devices": ok(devicesBody([revoked])) }));
    expect(await screen.findByText("Thiết bị này đã bị thu hồi")).toBeVisible();
    await chooseRecording();
    expect(screen.getByRole("button", { name: "Gửi tới thiết bị…" })).toBeDisabled();
  });

  it("checks a recording before upload and uploads a valid one as audio/wav with the session only", async () => {
    const backend = base({
      "POST /api/admin/v1/devices/esp32-test-1/voice-messages": () => json(201, { voice_message: voiceItem }),
    });
    await mountSignedIn("/admin/messages", backend);
    const input = await screen.findByLabelText(/Tệp âm thanh WAV/);
    await waitFor(() => expect(input).toBeEnabled());
    const wav = (rate: number, channels: number, seconds = 1) => {
      const data = rate * seconds * 2 * channels;
      const buf = new Uint8Array(44 + data);
      const v = new DataView(buf.buffer);
      const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      s(0, "RIFF"); v.setUint32(4, 36 + data, true); s(8, "WAVE"); s(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
      v.setUint16(22, channels, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2 * channels, true); v.setUint16(32, 2 * channels, true); v.setUint16(34, 16, true);
      s(36, "data"); v.setUint32(40, data, true);
      return new File([buf], "a.wav", { type: "audio/wav" });
    };
    await userEvent.upload(input, wav(44100, 1));
    expect(await screen.findByText(/chỉ phát tốc độ lấy mẫu 16000 Hz; tệp này là 44100 Hz/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Tải lên kho riêng tư" })).toBeDisabled();
    await userEvent.upload(input, wav(16000, 2));
    expect(await screen.findByText("Cần âm thanh mono (1 kênh).")).toBeVisible();
    expect(find(backend, "POST /api/admin/v1/devices/esp32-test-1/voice-messages")).toHaveLength(0);

    await userEvent.upload(input, wav(16000, 1, 1));
    await userEvent.type(screen.getByLabelText(/Tên bản ghi/), "Nhắc uống nước");
    await userEvent.click(screen.getByRole("button", { name: "Tải lên kho riêng tư" }));
    expect(await screen.findByText(/Bản ghi nằm trong kho riêng tư; chưa có gì được gửi tới thiết bị/)).toBeVisible();
    const up = find(backend, "POST /api/admin/v1/devices/esp32-test-1/voice-messages");
    expect(up).toHaveLength(1);
    expect(up[0]!.contentType).toBe("audio/wav");
    expect(up[0]!.auth).toMatch(/^Bearer clm_/);
    expect(find(backend, sendPathKey())).toHaveLength(0); // uploading never sends a command
  });
});

const sendPathKey = () => "POST /api/admin/v1/devices/esp32-test-1/voice-commands";

describe("scheduled reminders", () => {
  const listPath = "GET /api/admin/v1/devices/esp32-test-1/reminders";
  const createPath = "POST /api/admin/v1/devices/esp32-test-1/reminders";

  it("lists reminders with the server's state, next occurrence and last delivery, and tells the truth about the scheduler", async () => {
    const items = [
      reminder(),
      reminder({ reminder_id: "rem_2", state: "paused", paused_at: "2026-10-19T03:01:00.000Z", label: "Đã tạm dừng" }),
      reminder({ reminder_id: "rem_3", state: "finished", next_occurrence_at: null, label: "Đã hết", last_dispatch: { command_id: "cmd_9", occurrence_at: "2026-10-18T03:05:00.000Z", status: "expired", status_reason: "deadline_passed", delivery_attempts: 0, finished_at: null, played_confirmed_by_device: false } }),
    ];
    await mountSignedIn("/admin/reminders", base({ [listPath]: ok({ items, timezone: "Asia/Ho_Chi_Minh" }) }));
    expect(await screen.findByText("Uống nước: Uống một cốc nước")).toBeVisible();
    expect(screen.getByText("Đang hẹn giờ")).toBeVisible();
    expect(screen.getAllByText("Tạm dừng").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Đã hết lượt")).toBeVisible();
    expect(screen.getByText(/Hết hạn trước khi phát \(Quá hạn mà thiết bị chưa nhận\)/)).toBeVisible();
    expect(screen.getAllByText(/Chưa có lần nào được giao/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/không dùng bộ hẹn giờ của trình duyệt/)).toBeVisible();
    expect(screen.getByText(/Chưa có thiết bị thật nào xác nhận phát/)).toBeVisible();
  });

  it("creates a one-time reminder only after the confirmation box, with the schedule in Vietnam time and a stable idempotency key", async () => {
    const backend = base({ [createPath]: () => json(201, { reminder: reminder(), created: true }) });
    await mountSignedIn("/admin/reminders", backend);
    await userEvent.type(await screen.findByLabelText(/Nội dung nhắc/), "Uống một cốc nước");
    await userEvent.type(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/), "10:05");
    const submit = screen.getByRole("button", { name: "Tạo nhắc lịch" });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /Tôi xác nhận tạo nhắc lịch này/ }));
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(await screen.findByText(/Máy chủ sẽ tự giao đúng giờ, không cần giữ trang này mở/)).toBeVisible();
    const sent = find(backend, createPath);
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body as { idempotency_key: string; schedule: { local_date: string } };
    expect(body).toMatchObject({ kind: "water", label: "Uống một cốc nước", voice_message_id: null, deadline_minutes: 15, confirm: true, schedule: { type: "once", local_time: "10:05" } });
    expect(body.schedule.local_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.idempotency_key.length).toBeGreaterThanOrEqual(8);
    expect(body).not.toHaveProperty("timezone"); // the zone is the server's, not the browser's
  });

  it("builds a weekly schedule from the chosen days", async () => {
    const backend = base({ [createPath]: () => json(201, { reminder: reminder({ schedule_kind: "recurring" }), created: true }) });
    await mountSignedIn("/admin/reminders", backend);
    await userEvent.type(await screen.findByLabelText(/Nội dung nhắc/), "Uống thuốc buổi sáng");
    await userEvent.selectOptions(screen.getByLabelText("Loại nhắc"), "medication");
    await userEvent.click(screen.getByRole("radio", { name: "Lặp hằng tuần" }));
    for (const day of ["T3", "T4", "T5", "T6", "T7", "CN"]) await userEvent.click(screen.getByRole("checkbox", { name: day }));
    await userEvent.type(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/), "07:30");
    await userEvent.click(screen.getByRole("checkbox", { name: /Tôi xác nhận tạo nhắc lịch này/ }));
    await userEvent.click(screen.getByRole("button", { name: "Tạo nhắc lịch" }));
    await screen.findByText(/Máy chủ sẽ tự giao/);
    expect(find(backend, createPath)[0]!.body).toMatchObject({ kind: "medication", schedule: { type: "weekly", days_of_week: [1], times_local: ["07:30"], end_date: null } });
  });

  it("shows the server's reason when a time is in the past, and creates nothing", async () => {
    const backend = base({ [createPath]: () => problem(422, "schedule_in_past") });
    await mountSignedIn("/admin/reminders", backend);
    await userEvent.type(await screen.findByLabelText(/Nội dung nhắc/), "Uống nước");
    await userEvent.type(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/), "00:01");
    await userEvent.click(screen.getByRole("checkbox", { name: /Tôi xác nhận tạo nhắc lịch này/ }));
    await userEvent.click(screen.getByRole("button", { name: "Tạo nhắc lịch" }));
    expect(await screen.findByText(/Thời điểm đã qua hoặc quá gần/)).toBeVisible();
    expect(screen.queryByText(/Máy chủ sẽ tự giao/)).toBeNull();
  });

  it("pauses, resumes and cancels through the server, cancel needing a second click", async () => {
    let state = "scheduled";
    const backend = base({
      [listPath]: () => json(200, { items: [reminder({ state, paused_at: state === "paused" ? "2026-10-19T03:01:00.000Z" : null })], timezone: "Asia/Ho_Chi_Minh" }),
      "POST /api/admin/v1/reminders/rem_1/pause": () => {
        state = "paused";
        return json(200, { reminder: reminder({ state: "paused" }), duplicate: false });
      },
      "POST /api/admin/v1/reminders/rem_1/resume": () => {
        state = "scheduled";
        return json(200, { reminder: reminder(), duplicate: false });
      },
      "POST /api/admin/v1/reminders/rem_1/cancel": () => {
        state = "cancelled";
        return json(200, { reminder: reminder({ state: "cancelled", status: "cancelled" }), duplicate: false });
      },
    });
    await mountSignedIn("/admin/reminders", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Tạm dừng" }));
    expect(await screen.findByText("Tạm dừng", { selector: "span span" })).toBeVisible();
    await userEvent.click(await screen.findByRole("button", { name: "Tiếp tục" }));
    await screen.findByText("Đang hẹn giờ");
    await userEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(find(backend, "POST /api/admin/v1/reminders/rem_1/cancel")).toHaveLength(0); // first click only asks
    await userEvent.click(screen.getByRole("button", { name: "Xác nhận hủy hẳn" }));
    expect(await screen.findByText("Đã hủy")).toBeVisible();
    expect(find(backend, "POST /api/admin/v1/reminders/rem_1/pause")).toHaveLength(1);
    expect(find(backend, "POST /api/admin/v1/reminders/rem_1/resume")).toHaveLength(1);
    expect(find(backend, "POST /api/admin/v1/reminders/rem_1/cancel")).toHaveLength(1);
  });

  it("shows the empty state, and a load failure as an error", async () => {
    await mountSignedIn("/admin/reminders", base());
    expect(await screen.findByText("Chưa có nhắc lịch nào")).toBeVisible();
    (await import("@testing-library/react")).cleanup();
    await mountSignedIn("/admin/reminders", base({ [listPath]: () => problem(500, "internal_error") }));
    expect(await screen.findByText("Không tải được nhắc lịch")).toBeVisible();
    expect(screen.queryByText("Chưa có nhắc lịch nào")).toBeNull();
  });
});

describe("agents and audit", () => {
  it("shows agents as reported, says the Vision API is not observable, and never invents health", async () => {
    const status = {
      server_time: "2026-10-19T03:00:00.000Z",
      storage: { d1_size_bytes: null, imu_ingest: "accepting" },
      queue: [{ kind: "vision", waiting: 2, oldest_age_seconds: 40 }],
      failures_24h: [{ kind: "vision", status: "failed", error_code: "x", n: 3 }],
      last_successful_inference: [],
      fusion: { policy_version: "fusion-rules.v2", suspected_fall_possible: false },
      agents: [{ agent_id: "agt_1", label: "PC thử", status: "active", last_seen_at: null, connected: false, reported: { package_version: "pkg-test", nested: { a: 1 } } }],
      devices: [],
    };
    await mountSignedIn("/admin/agents", base({ "GET /api/admin/v1/status": ok(status) }));
    expect(await screen.findByText("PC thử")).toBeVisible();
    expect(screen.getByText("Không có liên lạc gần đây")).toBeVisible();
    expect(screen.getByText("pkg-test")).toBeVisible();
    expect(screen.queryByText("nested")).toBeNull();
    expect(screen.getByText(/Trạng thái Vision API riêng:/)).toBeVisible();
    expect(screen.getByText(/Suy luận hình ảnh: 2 \(cũ nhất 40 giây\)/)).toBeVisible();
    expect(screen.getByText("Chưa có")).toBeVisible();
  });

  it("pages through the audit history and applies the action filter on the server", async () => {
    const entry = (n: string, action: string) => ({ audit_id: `aud_${n}`, at: "2026-10-19T03:00:00.000Z", actor_type: "admin", actor_id: "adm_test", action, target_type: "device", target_id: "esp32-test-1", outcome: "success", request_id: "r", detail: null });
    const backend = base({
      "GET /api/admin/v1/audit": (call) => {
        if (call.search.includes("action_prefix=reminder.")) return json(200, { items: [entry("r1", "reminder.cancel")], next_cursor: null });
        if (call.search.includes("cursor=cur1")) return json(200, { items: [entry("b", "reminder.create")], next_cursor: null });
        return json(200, { items: [entry("a", "command.create")], next_cursor: "cur1" });
      },
    });
    await mountSignedIn("/admin/audit", backend);
    expect(await screen.findByText("Tạo lệnh phát âm thanh")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Tải thêm" }));
    expect(await screen.findByText("Tạo nhắc lịch")).toBeVisible();
    expect(screen.getByText("Tạo lệnh phát âm thanh")).toBeVisible(); // earlier rows stay
    expect(screen.queryByRole("button", { name: "Tải thêm" })).toBeNull(); // no next cursor
    await userEvent.selectOptions(screen.getByLabelText("Loại thao tác"), "reminder.");
    expect(await screen.findByText("Hủy nhắc lịch")).toBeVisible();
    expect(screen.queryByText("Tạo lệnh phát âm thanh")).toBeNull();
    expect(find(backend, "GET /api/admin/v1/audit").some((c) => c.search.includes("action_prefix=reminder."))).toBe(true);
  });

  it("shows an audit failure as an error, not as an empty history", async () => {
    await mountSignedIn("/admin/audit", base({ "GET /api/admin/v1/audit": () => problem(500, "internal_error") }));
    expect(await screen.findByText("Không tải được nhật ký")).toBeVisible();
    expect(screen.queryByText("Chưa có thao tác nào khớp")).toBeNull();
  });
});
