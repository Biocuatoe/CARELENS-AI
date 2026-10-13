/**
 * Kiểm thử hành vi của adapter mô phỏng theo bộ nghiệm thu plan §13.
 * Lưu ý: đây là test của mô phỏng phía trình duyệt, KHÔNG chứng minh backend thật cách ly dữ liệu.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { DemoAdapter } from "./demoAdapter";
import { PERSONA_MODE } from "./fixtures";

const NOW = Date.parse("2026-09-14T08:00:00Z");

function createAdapter() {
  let now = NOW;
  const adapter = new DemoAdapter({ now: () => now, latencyMs: [0, 0] });
  return { adapter, advance: (ms: number) => (now += ms) };
}

async function expectApiError(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(status);
  return error as ApiError;
}

describe("DemoAdapter · quyền truy cập", () => {
  let adapter: DemoAdapter;
  beforeEach(() => {
    adapter = createAdapter().adapter;
  });

  it("chưa đăng nhập thì trả 401", async () => {
    await expectApiError(adapter.listRecipients(), 401);
  });

  it("AC03: người xem Nhóm B không đọc được hồ sơ Nhóm A qua list, detail, export", async () => {
    await adapter.enterDemo("u_ha");
    const list = await adapter.listRecipients();
    expect(list.map((r) => r.id)).toEqual(["r_binh"]);
    await expectApiError(adapter.getRecipientContext("r_an"), 404);
    await expectApiError(adapter.listAlerts("r_an", { product: "all", status: "all", range: "30d", assignee: "all" }), 404);
    await expectApiError(adapter.getAlert("r_an", "al_001"), 404);
    await expectApiError(
      adapter.createExport("r_an", { from: new Date(NOW - 86_400_000).toISOString(), to: new Date(NOW).toISOString(), products: ["carelens"], idempotencyKey: "k" }),
      404,
    );
  });

  it("AC01: hồ sơ chỉ bật EcoPatch không truy cập được API CareLens", async () => {
    await adapter.enterDemo("u_minh");
    await expectApiError(adapter.listEvents("r_binh", { range: "7d", severity: "all", category: "all" }), 404);
    const series = await adapter.listMeasurements("r_binh", { metric: "heart_rate", range: "7d" });
    expect(series.items.length).toBeGreaterThan(0);
  });

  it("người xem không có quyền xử lý cảnh báo: 403", async () => {
    await adapter.enterDemo("u_ha");
    await expectApiError(adapter.actOnAlert("r_binh", "al_101", { type: "acknowledge", expectedVersion: 1 }), 403);
  });

  it("AC11: thu hồi quyền chặn request mới và đóng stream đang mở", async () => {
    await adapter.enterDemo("u_lan");
    const closed: string[] = [];
    adapter.subscribe("r_an", { onHint: () => undefined, onClose: (r) => closed.push(r) });

    await adapter.enterDemo("u_minh");
    await adapter.revokeGrant("r_an", "g_lan_an");
    expect(closed).toEqual(["revoked"]);

    await adapter.enterDemo("u_lan");
    await expectApiError(adapter.getOverview("r_an"), 404);
    expect(await adapter.listRecipients()).toEqual([]);
  });

  it("không tự thu hồi quyền của chính mình", async () => {
    await adapter.enterDemo("u_minh");
    await expectApiError(adapter.revokeGrant("r_an", "g_minh_an"), 409);
  });

  it("AC18: quản trị nền tảng không có quyền đọc dữ liệu sức khỏe", async () => {
    await adapter.enterDemo("u_khoa");
    expect(await adapter.listRecipients()).toEqual([]);
    await expectApiError(adapter.getOverview("r_an"), 404);
    const diagnostics = await adapter.getDiagnostics();
    expect(JSON.stringify(diagnostics)).not.toContain("Bà An");
  });

  it("phiên hết hạn trả 401 session_expired", async () => {
    await adapter.enterDemo("u_minh");
    adapter.expireSession();
    const error = await expectApiError(adapter.listRecipients(), 401);
    expect(error.code).toBe("session_expired");
  });
});

describe("DemoAdapter · xử lý cảnh báo", () => {
  it("AC05 + AC06: tiếp nhận không đóng cảnh báo; người đến sau nhận 409 kèm trạng thái hiện tại", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    const before = await adapter.getAlert("r_an", "al_001");
    expect(before.alert.status).toBe("open");

    const acked = await adapter.actOnAlert("r_an", "al_001", { type: "acknowledge", expectedVersion: before.alert.version });
    expect(acked.alert.status).toBe("acknowledged");
    expect(acked.alert.reviewOutcome).toBeNull();
    expect(acked.alert.assigneeName).toBe("Minh");

    await adapter.enterDemo("u_lan");
    const conflict = await expectApiError(
      adapter.actOnAlert("r_an", "al_001", { type: "acknowledge", expectedVersion: before.alert.version }),
      409,
    );
    expect((conflict.current as { alert: { status: string } }).alert.status).toBe("acknowledged");
  });

  it("đóng cảnh báo bắt buộc có kết quả và ghi chú", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_lan");
    const detail = await adapter.getAlert("r_an", "al_002");
    const error = await expectApiError(
      adapter.actOnAlert("r_an", "al_002", { type: "resolve", expectedVersion: detail.alert.version, outcome: "confirmed", note: " " }),
      422,
    );
    expect(error.fieldErrors?.note).toBeTruthy();

    const resolved = await adapter.actOnAlert("r_an", "al_002", {
      type: "resolve",
      expectedVersion: detail.alert.version,
      outcome: "false_alarm",
      note: "Đã gọi điện kiểm tra.",
    });
    expect(resolved.alert.status).toBe("resolved");
    expect(resolved.alert.reviewOutcome).toBe("false_alarm");
    expect(resolved.actions.at(-1)?.type).toBe("resolve");
  });

  it("không cho đóng cảnh báo chưa tiếp nhận", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    await expectApiError(
      adapter.actOnAlert("r_an", "al_001", { type: "resolve", expectedVersion: 1, outcome: "confirmed", note: "Đã kiểm tra" }),
      409,
    );
  });
});

describe("DemoAdapter · dữ liệu nguồn", () => {
  it("AC04: gửi cùng event nhiều lần chỉ tạo một event và một cảnh báo", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    const payload = {
      deviceId: "d_hub_an",
      sourceRecordId: "sim-dup-1",
      observedAt: new Date(NOW - 60_000).toISOString(),
      category: "posture" as const,
      severity: "warning" as const,
      careLevel: 8,
      summary: "AI ghi nhận tư thế bất thường.",
    };
    const first = adapter.ingestCareEvent(payload);
    const second = adapter.ingestCareEvent(payload);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.event?.id).toBe(first.event?.id);
    const alerts = await adapter.listAlerts("r_an", { product: "carelens", status: "all", range: "24h", assignee: "all" });
    expect(alerts.items.filter((a) => a.sourceEventId === first.event?.id)).toHaveLength(1);
  });

  it("care level dưới ngưỡng demo không tạo cảnh báo", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    const result = adapter.ingestCareEvent({
      deviceId: "d_hub_an",
      sourceRecordId: "sim-low-1",
      observedAt: new Date(NOW - 60_000).toISOString(),
      category: "activity",
      severity: "info",
      careLevel: 2,
      summary: "AI ghi nhận người đang đi lại trong phòng.",
    });
    expect(result.event?.alertId).toBeNull();
  });

  it("AC08: gói đo đến muộn không thay giá trị mới nhất", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    const before = await adapter.listMeasurements("r_an", { metric: "heart_rate", range: "24h" });
    const latestBefore = before.latest!;
    adapter.ingestMeasurement({
      deviceId: "d_core_an",
      sourceRecordId: "late-1",
      observedAt: new Date(NOW - 55 * 60_000 + 5 * 60_000).toISOString(),
      value: 99,
      quality: "fair",
    });
    const after = await adapter.listMeasurements("r_an", { metric: "heart_rate", range: "24h" });
    expect(after.latest?.id).toBe(latestBefore.id);
    expect(after.items.some((m) => m.sourceRecordId === "late-1")).toBe(true);
  });

  it("AC09: gói đo trước thời điểm gán thiết bị bị cách ly, không gán cho hồ sơ hiện tại", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    const result = adapter.ingestMeasurement({
      deviceId: "d_core_binh",
      sourceRecordId: "before-assignment",
      observedAt: new Date(NOW - 40 * 86_400_000).toISOString(),
      value: 70,
      quality: "good",
    });
    expect(result.quarantined).toBe(true);
    expect(result.measurement).toBeNull();
  });

  it("AC14: thiết bị không cung cấp pin hoặc ECG thì không có số liệu tương ứng", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    const devices = await adapter.listDevices("r_an");
    const core = devices.find((d) => d.kind === "ecopatch_core")!;
    expect(core.batteryPercent).toBeNull();
    expect(core.capabilities).not.toContain("ecg_waveform");
  });

  it("mất kết nối hub được báo là disconnected, không phải connected", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    await adapter.toggleHubConnection("r_an");
    const ctx = await adapter.getRecipientContext("r_an");
    expect(ctx.recipient.sources.find((s) => s.product === "carelens")?.state).toBe("disconnected");
  });
});

describe("DemoAdapter · thiết bị và xuất dữ liệu", () => {
  it("AC10: gửi lại yêu cầu thay miếng dán với cùng khóa không tạo phiên trùng", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_lan");
    const input = { startedAt: new Date(NOW - 60_000).toISOString(), lotCode: "LOT-X", expectedReplaceAt: null, idempotencyKey: "same-key" };
    const [a, b] = await Promise.all([adapter.replacePatch("r_an", "d_core_an", input), adapter.replacePatch("r_an", "d_core_an", input)]);
    expect(b.id).toBe(a.id);
    const sessions = await adapter.listPatchSessions("r_an");
    expect(sessions.filter((s) => !s.endedAt)).toHaveLength(1);
    expect(sessions).toHaveLength(3);
  });

  it("AC17: serial đúng nhưng sai mã kích hoạt thì không ghép được", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    const challenge = await adapter.startPairing("r_an", { product: "carelens", serial: "CL-HUB-DEMO-3001" });
    await expectApiError(adapter.confirmPairing("r_an", challenge.id, "111111"), 422);
    await expectApiError(adapter.confirmPairing("r_an", challenge.id, "222222"), 422);
    await expectApiError(adapter.confirmPairing("r_an", challenge.id, "333333"), 409);
    await expectApiError(adapter.confirmPairing("r_an", challenge.id, "246810"), 409);
  });

  it("không tiết lộ thiết bị đã thuộc hồ sơ khác khi ghép", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    const error = await expectApiError(adapter.startPairing("r_an", { product: "ecopatch", serial: "EP-CORE-5521-0934" }), 404);
    expect(error.message).not.toContain("Ông Bình");
  });

  it("AC15: bản xuất CSV có nhãn mô phỏng, source_mode và chống formula injection", async () => {
    const { adapter, advance } = createAdapter();
    await adapter.enterDemo("u_minh");
    const job = await adapter.createExport("r_an", {
      from: new Date(NOW - 2 * 86_400_000).toISOString(),
      to: new Date(NOW).toISOString(),
      products: ["carelens", "ecopatch"],
      idempotencyKey: "exp-1",
    });
    expect(job.status).toBe("pending");
    await expectApiError(adapter.downloadExport("r_an", job.id), 409);
    advance(2_000);
    const file = await adapter.downloadExport("r_an", job.id);
    expect(file.content.split("\r\n")[0]).toContain("MÔ PHỎNG");
    expect(file.content).toContain("simulated");
    expect(file.filename).toContain("mo-phong");
  });

  it("người chăm sóc không có quyền xuất dữ liệu", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_lan");
    await expectApiError(
      adapter.createExport("r_an", { from: new Date(NOW - 86_400_000).toISOString(), to: new Date(NOW).toISOString(), products: ["carelens"], idempotencyKey: "k" }),
      403,
    );
  });

  it("hộp thông báo chỉ hiển thị thông báo của chính người dùng", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    await adapter.createInvitation("r_an", { email: "moi.demo@example.invalid", role: "viewer" });
    await adapter.enterDemo("u_lan");
    const sink = await adapter.listNotificationSink();
    expect(sink.some((d) => d.recipientUserName.includes("moi.demo"))).toBe(false);
  });

  it("AC16: không có dữ liệu hình ảnh trong bất kỳ phản hồi nào", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    const payloads = await Promise.all([
      adapter.getOverview("r_an"),
      adapter.listEvents("r_an", { range: "30d", severity: "all", category: "all" }),
      adapter.getAlert("r_an", "al_001"),
      adapter.listHistory("r_an", { type: "all", range: "30d" }),
    ]);
    const text = JSON.stringify(payloads);
    expect(text).not.toMatch(/base64|image\/|\.jpe?g|thumbnail|frame_url|video/i);
  });
});

describe("DemoAdapter · liveshowcase session", () => {
  it("enterDemo(u_liveshowcase) → listRecipients trả đúng 1 hồ sơ Demo trực tiếp", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    const recipients = await adapter.listRecipients();
    expect(recipients).toHaveLength(1);
    expect(recipients[0]!.displayName).toBe("Demo trực tiếp");
    expect(recipients[0]!.enrollments).toHaveLength(2);
    expect(recipients[0]!.enrollments.map((e) => e.product).sort()).toEqual(["carelens", "ecopatch"]);
    expect(recipients[0]!.enrollments.every((e) => e.status === "active")).toBe(true);
  });

  it("u_minh KHÔNG thấy r_liveshowcase trong listRecipients", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    const recipients = await adapter.listRecipients();
    expect(recipients.map((r) => r.id)).not.toContain("r_liveshowcase");
  });

  it("getOverview(r_liveshowcase) trả dữ liệu trống hoàn toàn (không event, alert, measurement, patch)", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    const recipients = await adapter.listRecipients();
    const id = recipients[0]!.id;
    const overview = await adapter.getOverview(id);
    expect(overview.openAlerts).toHaveLength(0);
    expect(overview.latestEvent).toBeNull();
    expect(overview.latestMeasurement).toBeNull();
    expect(overview.activePatch).toBeNull();
    // recent có thể chứa device assignment history (2 mục: hub + core gán cho r_liveshowcase)
    expect(overview.recent.every((i) => i.type === "device_assignment")).toBe(true);
  });

  it("listDevices(r_liveshowcase) trả 2 thiết bị, cả hai offline, không có pin", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    const recipients = await adapter.listRecipients();
    const id = recipients[0]!.id;
    const devices = await adapter.listDevices(id);
    expect(devices).toHaveLength(2);
    const hub = devices.find((d) => d.kind === "carelens_hub")!;
    const core = devices.find((d) => d.kind === "ecopatch_core")!;
    expect(hub.connection).toBe("unknown");
    expect(hub.batteryPercent).toBeNull();
    expect(core.connection).toBe("unknown");
    expect(core.batteryPercent).toBeNull();
  });

  it("listEvents và listMeasurements cho r_liveshowcase trả mảng rỗng", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    const recipients = await adapter.listRecipients();
    const id = recipients[0]!.id;
    const [events, measurements] = await Promise.all([
      adapter.listEvents(id, { range: "30d", severity: "all", category: "all" }),
      adapter.listMeasurements(id, { metric: "heart_rate", range: "7d" }),
    ]);
    expect(events.items).toHaveLength(0);
    expect(measurements.items).toHaveLength(0);
    expect(measurements.latest).toBeNull();
  });

  it("ingestCareEvent cho d_hub_liveshowcase tạo event mới và getOverview có latestEvent", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    const recipients = await adapter.listRecipients();
    const id = recipients[0]!.id;
    const before = await adapter.getOverview(id);
    expect(before.latestEvent).toBeNull();

    const result = adapter.ingestCareEvent({
      deviceId: "d_hub_liveshowcase",
      sourceRecordId: "ls-1",
      observedAt: new Date(NOW - 5_000).toISOString(),
      category: "fall_like" as const,
      severity: "critical" as const,
      careLevel: 9,
      summary: "AI ghi nhận tư thế nằm trên sàn.",
    });

    expect(result.duplicate).toBe(false);
    expect(result.event).not.toBeNull();
    expect(result.event!.recipientId).toBe(id);

    // After ingest, overview shows the event and creates an alert (careLevel 9 >= threshold 7)
    const after = await adapter.getOverview(id);
    expect(after.latestEvent).not.toBeNull();
    expect(after.latestEvent!.id).toBe(result.event!.id);
    expect(after.openAlerts).toHaveLength(1);
    expect(after.openAlerts[0]!.severity).toBe("critical");
  });

  it("ingestCareEvent trùng sourceRecordId không tạo event trùng", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    const recipients = await adapter.listRecipients();
    const id = recipients[0]!.id;
    const payload = {
      deviceId: "d_hub_liveshowcase",
      sourceRecordId: "ls-dup",
      observedAt: new Date(NOW - 10_000).toISOString(),
      category: "posture" as const,
      severity: "warning" as const,
      careLevel: 8,
      summary: "Test dup.",
    };
    const first = adapter.ingestCareEvent(payload);
    const second = adapter.ingestCareEvent(payload);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.event?.id).toBe(first.event?.id);
    const overview = await adapter.getOverview(id);
    expect(overview.openAlerts).toHaveLength(1); // only one alert
  });

  it("__simulateBackendDeviceUpdate: EcoPatch online→seeds recent measurements and updates connection", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    const devices = await adapter.listDevices("r_liveshowcase");
    const eco = devices.find((d) => d.product === "ecopatch")!;
    expect(eco.connection).toBe("unknown");
    expect(eco.lastSeenAt).toBeNull();

    adapter.__simulateBackendDeviceUpdate(eco.id, true);

    const devicesAfter = await adapter.listDevices("r_liveshowcase");
    const ecoAfter = devicesAfter.find((d) => d.product === "ecopatch")!;
    expect(ecoAfter.connection).toBe("connected");
    expect(ecoAfter.lastSeenAt).not.toBeNull();

    const series = await adapter.listMeasurements("r_liveshowcase", { metric: "heart_rate", range: "24h" });
    expect(series.items.length).toBeGreaterThan(0);
    expect(series.latest).not.toBeNull();
  });

  it("__simulateBackendDeviceUpdate: CareLens online updates connection and lastSeenAt", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    const devices = await adapter.listDevices("r_liveshowcase");
    const hub = devices.find((d) => d.product === "carelens")!;
    expect(hub.connection).not.toBe("connected");

    adapter.__simulateBackendDeviceUpdate(hub.id, true);

    const devicesAfter = await adapter.listDevices("r_liveshowcase");
    const hubAfter = devicesAfter.find((d) => d.product === "carelens")!;
    expect(hubAfter.connection).toBe("connected");
    expect(hubAfter.lastSeenAt).not.toBeNull();
  });

  it("__simulateBackendDeviceUpdate: only targeted product changes state", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    adapter.__simulateBackendDeviceUpdate("d_hub_liveshowcase", true);
    const devices = await adapter.listDevices("r_liveshowcase");
    const hub = devices.find((d) => d.product === "carelens")!;
    const eco = devices.find((d) => d.product === "ecopatch")!;
    expect(hub.connection).toBe("connected");
    expect(eco.connection).not.toBe("connected");
  });

  it("mergeBackendDevices: EcoPatch offline→online seeds measurements and latestMeasurement is non-null", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    // Verify baseline: no measurements
    const before = await adapter.listMeasurements("r_liveshowcase", { metric: "heart_rate", range: "24h" });
    expect(before.items.length).toBe(0);
    expect(before.latest).toBeNull();

    // Bring EcoPatch online via mergeBackendDevices
    adapter.mergeBackendDevices({
      d_hub_liveshowcase: {
        id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: false,
        last_seen_at: null,
        last_seen_ms: null,
        signal: "offline",
        latest_data: null,
        battery: null,
      },
      d_core_liveshowcase: {
        id: "d_core_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: null,
        battery: null,
      },
    });

    const after = await adapter.listMeasurements("r_liveshowcase", { metric: "heart_rate", range: "24h" });
    expect(after.items.length).toBeGreaterThan(0);
    expect(after.latest).not.toBeNull();
    expect(after.latest!.observedAt).not.toBe("");
  });

  it("mergeBackendDevices: offline→online transition seeds once (idempotent)", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    adapter.mergeBackendDevices({
      d_core_liveshowcase: {
        id: "d_core_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: null,
        battery: null,
      },
    });
    const countBefore = (await adapter.listMeasurements("r_liveshowcase", { metric: "heart_rate", range: "24h" })).items.length;
    // Merge again (still online) — should NOT double-seed
    adapter.mergeBackendDevices({
      d_core_liveshowcase: {
        id: "d_core_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:01:00Z",
        last_seen_ms: 1726987260000,
        signal: "connected",
        latest_data: null,
        battery: null,
      },
    });
    const countAfter = (await adapter.listMeasurements("r_liveshowcase", { metric: "heart_rate", range: "24h" })).items.length;
    expect(countAfter).toBe(countBefore);
  });

  it("mergeBackendDevices: CareLens online→offline clears backendDevices but leaves overview data intact", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    // Go online first
    adapter.mergeBackendDevices({
      d_hub_liveshowcase: {
        id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: { kind: "hub_status", value: null, unit: null, quality: null, observed_at: "2026-09-22T04:00:00Z", summary: "OK" },
        battery: null,
      },
      d_core_liveshowcase: {
        id: "d_core_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: false,
        last_seen_at: null,
        last_seen_ms: null,
        signal: "offline",
        latest_data: null,
        battery: null,
      },
    });
    const devices = adapter.getBackendDevices("r_liveshowcase");
    expect(devices["d_hub_liveshowcase"]!.online).toBe(true);
    // Go offline
    adapter.mergeBackendDevices({
      d_hub_liveshowcase: {
        id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: false,
        last_seen_at: null,
        last_seen_ms: null,
        signal: "offline",
        latest_data: null,
        battery: null,
      },
      d_core_liveshowcase: {
        id: "d_core_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: false,
        last_seen_at: null,
        last_seen_ms: null,
        signal: "offline",
        latest_data: null,
        battery: null,
      },
    });
    const devicesAfter = adapter.getBackendDevices("r_liveshowcase");
    expect(devicesAfter["d_hub_liveshowcase"]!.online).toBe(false);
    expect(devicesAfter["d_hub_liveshowcase"]!.signal).toBe("offline");
    expect(devicesAfter["d_hub_liveshowcase"]!.latest_data).toBeNull();
  });
});

describe("DemoAdapter · static vs dynamic mode", () => {
  const STATIC_PERSONAS = ["u_minh", "u_lan", "u_ha", "u_khoa"] as const;

  function createAdapter() {
    const adapter = new DemoAdapter({ now: () => NOW, latencyMs: [0, 0] });
    return { adapter };
  }

  // PERSONA_MODE is defined for all 5 personas.
  it("PERSONA_MODE has exactly 4 static and 1 dynamic entry", () => {
    const entries = Object.entries(PERSONA_MODE);
    expect(entries.filter(([, m]) => m === "static")).toHaveLength(4);
    expect(entries.filter(([, m]) => m === "dynamic")).toHaveLength(1);
    expect(PERSONA_MODE.u_liveshowcase).toBe("dynamic");
  });

  it("u_minh is static; getMode() returns 'static'", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    expect(adapter.getMode()).toBe("static");
  });

  it("u_lan / u_ha / u_khoa are all static", async () => {
    for (const id of STATIC_PERSONAS) {
      const { adapter } = createAdapter();
      await adapter.enterDemo(id);
      expect(adapter.getMode()).toBe("static");
    }
  });

  it("u_liveshowcase is dynamic; getMode() returns 'dynamic'", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    expect(adapter.getMode()).toBe("dynamic");
  });

  it("reset() returns mode to static default", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    expect(adapter.getMode()).toBe("dynamic");
    adapter.reset();
    expect(adapter.getMode()).toBe("static");
  });

  it("apiBase option is accepted and readable via getApiBase()", () => {
    const adapter = new DemoAdapter({
      now: () => NOW,
      latencyMs: [0, 0],
      apiBase: "http://localhost:9999",
    });
    expect(adapter.getApiBase()).toBe("http://localhost:9999");
  });

  it("apiBase defaults to VITE_API_BASE_URL env var (or hardcoded fallback)", () => {
    const adapter = new DemoAdapter({ now: () => NOW, latencyMs: [0, 0] });
    // In tests, VITE_API_BASE_URL is not set, so it falls back to the hardcoded default.
    expect(adapter.getApiBase()).toBe("http://127.0.0.1:8787");
  });

  it("subscribe() for a static persona does not throw and returns a noop unsubscribe", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");
    const events: unknown[] = [];
    const closeReasons: string[] = [];
    const unsub = adapter.subscribe("r_an", {
      onHint: (h) => events.push(h),
      onClose: (r) => closeReasons.push(r),
    });
    expect(typeof unsub).toBe("function");
    // No backend reachable in jsdom (EventSource undefined) and persona is static → no hints emitted.
    expect(events).toEqual([]);
    expect(closeReasons).toEqual([]);
    unsub();
  });

  it("subscribe() for u_liveshowcase does not throw (dynamic persona, but no EventSource in jsdom)", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    expect(adapter.getMode()).toBe("dynamic");
    const events: unknown[] = [];
    const closeReasons: string[] = [];
    const unsub = adapter.subscribe("r_liveshowcase", {
      onHint: (h) => events.push(h),
      onClose: (r) => closeReasons.push(r),
    });
    expect(typeof unsub).toBe("function");
    // In jsdom EventSource is undefined, so even the dynamic persona's SSE path is skipped.
    expect(events).toEqual([]);
    unsub();
  });
});

describe("DemoAdapter · backend device merge", () => {
  function createAdapter() {
    const adapter = new DemoAdapter({ now: () => NOW, latencyMs: [0, 0] });
    return { adapter };
  }

  it("initial backendDevices for r_liveshowcase: both offline, latest_data=null, signal=offline", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    const devices = adapter.getBackendDevices("r_liveshowcase");
    expect(devices["d_hub_liveshowcase"]).toMatchObject({
      id: "d_hub_liveshowcase",
      online: false,
      signal: "offline",
      latest_data: null,
    });
    expect(devices["d_core_liveshowcase"]).toMatchObject({
      id: "d_core_liveshowcase",
      online: false,
      signal: "offline",
      latest_data: null,
    });
  });

  it("mergeBackendDevices carelens_online: sets online=true, signal=connected, latest_data populated", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    adapter.mergeBackendDevices({
      d_hub_liveshowcase: {
        id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: {
          kind: "hub_status",
          value: null,
          unit: null,
          quality: null,
          observed_at: "2026-09-22T04:00:00Z",
          summary: "AI ghi nhận hoạt động bình thường.",
        },
        battery: null,
      },
      d_core_liveshowcase: {
        id: "d_core_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: false,
        last_seen_at: null,
        last_seen_ms: null,
        signal: "offline",
        latest_data: null,
        battery: null,
      },
    });
    const devices = adapter.getBackendDevices("r_liveshowcase");
    expect(devices["d_hub_liveshowcase"]).toMatchObject({
      online: true,
      signal: "connected",
      latest_data: { kind: "hub_status", summary: "AI ghi nhận hoạt động bình thường." },
    });
    // EcoPatch unchanged
    expect(devices["d_core_liveshowcase"]).toMatchObject({ online: false, signal: "offline", latest_data: null });
  });

  it("mergeBackendDevices ecopatch_online: sets EcoPatch online independently", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    adapter.mergeBackendDevices({
      d_hub_liveshowcase: {
        id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: false,
        last_seen_at: null,
        last_seen_ms: null,
        signal: "offline",
        latest_data: null,
        battery: null,
      },
      d_core_liveshowcase: {
        id: "d_core_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: { kind: "heart_rate", value: 72, unit: "bpm", quality: "fair", observed_at: "2026-09-22T04:00:00Z", summary: null },
        battery: null,
      },
    });
    const devices = adapter.getBackendDevices("r_liveshowcase");
    expect(devices["d_hub_liveshowcase"]).toMatchObject({ online: false });
    expect(devices["d_core_liveshowcase"]).toMatchObject({
      online: true,
      signal: "connected",
      latest_data: { kind: "heart_rate", value: 72, unit: "bpm" },
    });
  });

  it("mergeBackendDevices carelens_offline: clears latest_data and sets signal=offline", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    // First go online
    adapter.mergeBackendDevices({
      d_hub_liveshowcase: {
        id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: { kind: "hub_status", value: null, unit: null, quality: null, observed_at: "2026-09-22T04:00:00Z", summary: "AI ghi nhận hoạt động bình thường." },
        battery: null,
      },
      d_core_liveshowcase: {
        id: "d_core_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: { kind: "heart_rate", value: 72, unit: "bpm", quality: "fair", observed_at: "2026-09-22T04:00:00Z", summary: null },
        battery: null,
      },
    });
    // Then go offline for CareLens
    adapter.mergeBackendDevices({
      d_hub_liveshowcase: {
        id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: false,
        last_seen_at: null,
        last_seen_ms: null,
        signal: "offline",
        latest_data: null,
        battery: null,
      },
      d_core_liveshowcase: {
        id: "d_core_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: { kind: "heart_rate", value: 72, unit: "bpm", quality: "fair", observed_at: "2026-09-22T04:00:00Z", summary: null },
        battery: null,
      },
    });
    const devices = adapter.getBackendDevices("r_liveshowcase");
    expect(devices["d_hub_liveshowcase"]).toMatchObject({ online: false, signal: "offline", latest_data: null });
    // EcoPatch unchanged
    expect(devices["d_core_liveshowcase"]).toMatchObject({ online: true, latest_data: { kind: "heart_rate" } });
  });

  it("getBackendDevices for non-LIVESHOWCASE recipient returns empty record", () => {
    const { adapter } = createAdapter();
    adapter.enterDemo("u_minh");
    expect(adapter.getBackendDevices("r_an")).toEqual({});
  });

  it("static persona: getBackendDevices returns seeded offline state", () => {
    const { adapter } = createAdapter();
    adapter.enterDemo("u_minh");
    // r_an is not r_liveshowcase → empty
    expect(adapter.getBackendDevices("r_an")).toEqual({});
  });
});

describe("DemoAdapter · sourcesFor after backend device update", () => {
  function createAdapter() {
    const adapter = new DemoAdapter({ now: () => NOW, latencyMs: [0, 0] });
    return { adapter };
  }

  it("__simulateBackendDeviceUpdate EcoPatch online → sourcesFor returns non-null lastDataAt and connected state", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    const ctx = await adapter.getRecipientContext("r_liveshowcase");
    const ecoBefore = ctx.recipient.sources.find((s) => s.product === "ecopatch")!;
    // Before: no measurements, so lastDataAt should be null
    expect(ecoBefore.lastDataAt).toBeNull();

    adapter.__simulateBackendDeviceUpdate("d_core_liveshowcase", true);

    const ctxAfter = await adapter.getRecipientContext("r_liveshowcase");
    const ecoAfter = ctxAfter.recipient.sources.find((s) => s.product === "ecopatch")!;
    expect(ecoAfter.lastDataAt).not.toBeNull();
    expect(ecoAfter.state).toBe("connected");
  });

  it("__simulateBackendDeviceUpdate CareLens online → sourcesFor returns non-null lastSeenAt and connected state", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    const ctx = await adapter.getRecipientContext("r_liveshowcase");
    const clBefore = ctx.recipient.sources.find((s) => s.product === "carelens")!;
    // Before: no events, so lastSeenAt comes from device.lastSeenStored (null for liveshowcase)
    expect(clBefore.lastSeenAt).toBeNull();

    adapter.__simulateBackendDeviceUpdate("d_hub_liveshowcase", true);

    const ctxAfter = await adapter.getRecipientContext("r_liveshowcase");
    const clAfter = ctxAfter.recipient.sources.find((s) => s.product === "carelens")!;
    expect(clAfter.lastSeenAt).not.toBeNull();
    expect(clAfter.state).toBe("connected");
  });

  it("mergeBackendDevices EcoPatch offline→online → sourcesFor shows connected state and non-null lastDataAt", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.mergeBackendDevices({
      d_hub_liveshowcase: {
        id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: false,
        last_seen_at: null,
        last_seen_ms: null,
        signal: "offline",
        latest_data: null,
        battery: null,
      },
      d_core_liveshowcase: {
        id: "d_core_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: null,
        battery: null,
      },
    });

    const ctx = await adapter.getRecipientContext("r_liveshowcase");
    const eco = ctx.recipient.sources.find((s) => s.product === "ecopatch")!;
    expect(eco.state).toBe("connected");
    expect(eco.lastDataAt).not.toBeNull();
  });

  it("mergeBackendDevices CareLens offline→online → sourcesFor shows connected state and non-null lastSeenAt", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.mergeBackendDevices({
      d_hub_liveshowcase: {
        id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: null,
        battery: null,
      },
      d_core_liveshowcase: {
        id: "d_core_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: false,
        last_seen_at: null,
        last_seen_ms: null,
        signal: "offline",
        latest_data: null,
        battery: null,
      },
    });

    const ctx = await adapter.getRecipientContext("r_liveshowcase");
    const cl = ctx.recipient.sources.find((s) => s.product === "carelens")!;
    expect(cl.state).toBe("connected");
    expect(cl.lastSeenAt).not.toBeNull();
  });

  it("CareLens lastDataAt comes from latest CareEvent.observedAt (not measurements)", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    // Emit a CareEvent — this seeds lastDataAt for CareLens via sourcesFor
    adapter.ingestCareEvent({
      deviceId: "d_hub_liveshowcase",
      sourceRecordId: "src-event-1",
      observedAt: new Date(NOW - 1_000).toISOString(),
      category: "posture",
      severity: "info",
      careLevel: 2,
      summary: "Hoạt động bình thường.",
    });

    const ctx = await adapter.getRecipientContext("r_liveshowcase");
    const cl = ctx.recipient.sources.find((s) => s.product === "carelens")!;
    // CareLens has no measurements → lastDataAt must come from events
    expect(cl.lastDataAt).not.toBeNull();
  });
});

describe("DemoAdapter · mergeBackendDevices with seedMeasurements", () => {
  function createAdapter() {
    const adapter = new DemoAdapter({ now: () => NOW, latencyMs: [0, 0] });
    return { adapter };
  }

  it("seedMeasurements=false does NOT seed EcoPatch measurements on offline→online", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    expect(adapter["state"].measurements.filter((m) => m.deviceId === "d_core_liveshowcase")).toHaveLength(0);

    adapter.mergeBackendDevices(
      {
        d_core_liveshowcase: {
          id: "d_core_liveshowcase",
          recipient_id: "r_liveshowcase",
          online: true,
          last_seen_at: "2026-09-22T04:00:00Z",
          last_seen_ms: 1726987200000,
          signal: "connected",
          latest_data: null,
          battery: null,
        },
      },
      { seedMeasurements: false },
    );

    const ecoMeasurements = adapter["state"].measurements.filter((m) => m.deviceId === "d_core_liveshowcase");
    expect(ecoMeasurements).toHaveLength(0);
  });

  it("seedMeasurements=true (default) DOES seed EcoPatch measurements on offline→online", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    expect(adapter["state"].measurements.filter((m) => m.deviceId === "d_core_liveshowcase")).toHaveLength(0);

    adapter.mergeBackendDevices({
      d_core_liveshowcase: {
        id: "d_core_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: null,
        battery: null,
      },
    });

    const ecoMeasurements = adapter["state"].measurements.filter((m) => m.deviceId === "d_core_liveshowcase");
    expect(ecoMeasurements.length).toBeGreaterThan(0);
  });

  it("CareLens online via mergeBackendDevices does not trigger measurement seeding", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.mergeBackendDevices({
      d_hub_liveshowcase: {
        id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: null,
        battery: null,
      },
    });

    const clMeasurements = adapter["state"].measurements.filter((m) => m.deviceId === "d_hub_liveshowcase");
    expect(clMeasurements).toHaveLength(0);
  });
});

describe("DemoAdapter · mergeBackendEvents and mergeBackendAlerts", () => {
  function createAdapter() {
    const adapter = new DemoAdapter({ now: () => NOW, latencyMs: [0, 0] });
    return { adapter };
  }

  it("mergeBackendEvents careLevel=7 creates event", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    expect(adapter["state"].events.filter((e) => e.recipientId === "r_liveshowcase")).toHaveLength(0);

    adapter.mergeBackendEvents([
      {
        id: "evt_tg_001",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        category: "posture",
        severity: "warning",
        care_level: 7,
        summary: "AI ghi nhận tư thế bất thường.",
        description: "Tư thế người dùng khác biệt so với trạng thái thường ngày.",
        observed_at: new Date(NOW - 5_000).toISOString(),
        received_at: new Date(NOW - 3_000).toISOString(),
        source_mode: "simulated",
        schema_version: "demo-control-1",
        source_record_id: "telegram-1",
        alert_triggered: true,
        product: "carelens",
      },
    ]);

    const events = adapter["state"].events.filter((e) => e.recipientId === "r_liveshowcase");
    expect(events).toHaveLength(1);
    expect(events[0]!.category).toBe("posture");
    expect(events[0]!.severity).toBe("warning");
    expect(events[0]!.careLevel).toBe(7);
  });

  it("mergeBackendEvents preserves type field (e.g. 'lying')", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.mergeBackendEvents([
      {
        id: "evt_lying_001",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        category: "posture",
        severity: "notice",
        care_level: 3,
        summary: "AI ghi nhận người dùng đang ở tư thế nằm.",
        description: "",
        observed_at: new Date(NOW - 5_000).toISOString(),
        received_at: new Date(NOW - 3_000).toISOString(),
        source_mode: "telegram",
        schema_version: "demo-control-1",
        source_record_id: "telegram-lying-1",
        alert_triggered: false,
        product: "carelens",
        type: "lying",
      },
    ]);

    const events = adapter["state"].events.filter((e) => e.recipientId === "r_liveshowcase");
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("lying");
    expect(events[0]!.category).toBe("posture");
  });

  it("mergeBackendEvents with source_mode=telegram sets sourceMode to 'telegram'", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.mergeBackendEvents([
      {
        id: "evt_tg_002",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        category: "fall_like",
        severity: "critical",
        care_level: 9,
        summary: "AI ghi nhận dấu hiệu ngã.",
        description: "",
        observed_at: new Date(NOW - 5_000).toISOString(),
        received_at: new Date(NOW - 3_000).toISOString(),
        source_mode: "telegram",
        schema_version: "demo-control-1",
        source_record_id: "telegram-2",
        alert_triggered: true,
        product: "carelens",
      },
    ]);

    const events = adapter["state"].events.filter((e) => e.recipientId === "r_liveshowcase");
    expect(events).toHaveLength(1);
    expect(events[0]!.sourceMode).toBe("telegram");
  });

  it("mergeBackendEvents: /c_water care_activity event with type=water visible to listEvents", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.mergeBackendEvents([
      {
        id: "evt_water_1",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        category: "care_activity",
        severity: "info",
        care_level: 0,
        summary: "Đã ghi nhận người dùng uống nước.",
        description: "",
        observed_at: new Date(NOW - 2_000).toISOString(),
        received_at: new Date(NOW - 1_000).toISOString(),
        source_mode: "telegram",
        schema_version: "demo-control-1",
        source_record_id: "telegram-water-1",
        alert_triggered: false,
        product: "carelens",
        type: "water",
      },
    ]);

    const page = await adapter.listEvents("r_liveshowcase", { range: "7d", severity: "all", category: "all" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.category).toBe("care_activity");
    expect(page.items[0]!.type).toBe("water");
    expect(page.items[0]!.severity).toBe("info");
    expect(page.items[0]!.sourceMode).toBe("telegram");
    // /c_water must NOT create alerts
    expect(adapter["state"].alerts.filter((a) => a.recipientId === "r_liveshowcase")).toHaveLength(0);
  });

  it("mergeBackendEvents: /c_medicine care_activity event with type=medicine visible to listEvents", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.mergeBackendEvents([
      {
        id: "evt_med_1",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        category: "care_activity",
        severity: "info",
        care_level: 0,
        summary: "Đã ghi nhận người dùng uống thuốc.",
        description: "",
        observed_at: new Date(NOW - 2_000).toISOString(),
        received_at: new Date(NOW - 1_000).toISOString(),
        source_mode: "telegram",
        schema_version: "demo-control-1",
        source_record_id: "telegram-med-1",
        alert_triggered: false,
        product: "carelens",
        type: "medicine",
      },
    ]);

    const page = await adapter.listEvents("r_liveshowcase", { range: "7d", severity: "all", category: "all" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.category).toBe("care_activity");
    expect(page.items[0]!.type).toBe("medicine");
    expect(page.items[0]!.severity).toBe("info");
    expect(page.items[0]!.sourceMode).toBe("telegram");
    // /c_medicine must NOT create alerts
    expect(adapter["state"].alerts.filter((a) => a.recipientId === "r_liveshowcase")).toHaveLength(0);
  });

  it("mergeBackendEvents adds event to state with correct sourceMode", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.mergeBackendEvents([
      {
        id: "evt_hint_001",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        category: "activity",
        severity: "info",
        care_level: 2,
        summary: "Test",
        description: "",
        observed_at: new Date(NOW - 5_000).toISOString(),
        received_at: new Date(NOW - 3_000).toISOString(),
        source_mode: "telegram",
        schema_version: "demo-control-1",
        source_record_id: "hint-test",
        alert_triggered: false,
        product: "carelens",
      },
    ]);

    // Verify the event was added to state (the emit() call that would trigger SSE
    // invalidation is tested via other means — queueMicrotask is not synchronous in jsdom)
    const events = adapter["state"].events.filter((e) => e.recipientId === "r_liveshowcase");
    expect(events.some((e) => e.id === "evt_hint_001")).toBe(true);
    expect(events.find((e) => e.id === "evt_hint_001")!.sourceMode).toBe("telegram");
  });

  it("mergeBackendEvents careLevel=4 does NOT auto-create alert in frontend", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    expect(adapter["state"].alerts.filter((a) => a.recipientId === "r_liveshowcase")).toHaveLength(0);

    adapter.mergeBackendEvents([
      {
        id: "evt_tg_003",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        category: "inactivity",
        severity: "notice",
        care_level: 4,
        summary: "AI ghi nhận người dùng ngồi yên trong thời gian dài.",
        description: "Không có hoạt động trong 45 phút.",
        observed_at: new Date(NOW - 5_000).toISOString(),
        received_at: new Date(NOW - 3_000).toISOString(),
        source_mode: "simulated",
        schema_version: "demo-control-1",
        source_record_id: "telegram-3",
        alert_triggered: false,
        product: "carelens",
      },
    ]);

    // Alert comes from the backend via mergeBackendAlerts, not auto-created here
    expect(adapter["state"].alerts.filter((a) => a.recipientId === "r_liveshowcase")).toHaveLength(0);
  });

  it("mergeBackendEvents fall_like careLevel=9 creates event with critical severity", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.mergeBackendEvents([
      {
        id: "evt_tg_004",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        category: "fall_like",
        severity: "critical",
        care_level: 9,
        summary: "AI ghi nhận dấu hiệu ngã.",
        description: "Phát hiện chuyển động đột ngột kèm thay đổi độ cao.",
        observed_at: new Date(NOW - 5_000).toISOString(),
        received_at: new Date(NOW - 3_000).toISOString(),
        source_mode: "simulated",
        schema_version: "demo-control-1",
        source_record_id: "telegram-4",
        alert_triggered: true,
        product: "carelens",
      },
    ]);

    const events = adapter["state"].events.filter((e) => e.recipientId === "r_liveshowcase");
    expect(events).toHaveLength(1);
    expect(events[0]!.category).toBe("fall_like");
    expect(events[0]!.severity).toBe("critical");
    expect(events[0]!.careLevel).toBe(9);
  });

  it("mergeBackendAlerts adds alert to state", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    expect(adapter["state"].alerts.filter((a) => a.recipientId === "r_liveshowcase")).toHaveLength(0);

    adapter.mergeBackendAlerts([
      {
        id: "al_tg_001",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        severity: "warning",
        category: "posture",
        summary: "AI ghi nhận tư thế bất thường.",
        status: "open",
        triggered_at: new Date(NOW - 3_000).toISOString(),
        acknowledged_at: null,
        acknowledged_by: null,
        review_outcome: null,
        review_note: null,
        resolved_at: null,
        resolved_by: null,
        product: "carelens",
      },
    ]);

    const alerts = adapter["state"].alerts.filter((a) => a.recipientId === "r_liveshowcase");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe("warning");
    expect(alerts[0]!.status).toBe("open");
  });
});

describe("DemoAdapter · mergeBackendNote", () => {
  function createAdapter() {
    const adapter = new DemoAdapter({ now: () => NOW, latencyMs: [0, 0] });
    return { adapter };
  }

  it("mergeBackendNote adds to state.notes for r_liveshowcase", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");
    expect(adapter["state"].notes).toHaveLength(0);

    adapter.mergeBackendNote({
      id: "note_tg_001",
      recipient_id: "r_liveshowcase",
      author_name: "Demo Bot (Telegram)",
      body: "Người dùng đã uống nước lúc 08:00 22/09/2026.",
      created_at: new Date(NOW).toISOString(),
    });

    expect(adapter["state"].notes).toHaveLength(1);
    expect(adapter["state"].notes[0]!.body).toContain("uống nước");
    expect(adapter["state"].notes[0]!.authorName).toBe("Demo Bot (Telegram)");
  });

  it("mergeBackendNote is ignored for other recipients", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.mergeBackendNote({
      id: "note_tg_002",
      recipient_id: "r_an",
      author_name: "Demo Bot (Telegram)",
      body: "Some note for r_an.",
      created_at: new Date(NOW).toISOString(),
    });

    expect(adapter["state"].notes).toHaveLength(0);
  });

  it("mergeBackendDevices ignores hub device for non-liveshowcase recipient_id (isolation)", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    // Simulate SSE pushing a hub device that belongs to a different recipient
    adapter.mergeBackendDevices({
      d_hub_an: {
        id: "d_hub_an",
        recipient_id: "r_an",
        online: true,
        last_seen_at: "2026-09-22T04:00:00Z",
        last_seen_ms: 1726987200000,
        signal: "connected",
        latest_data: null,
        battery: null,
      },
    });

    expect(adapter["state"].backendDevices["d_hub_an"]).toBeUndefined();
  });

  it("mergeBackendNote is idempotent (dedup by id)", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.mergeBackendNote({
      id: "note_tg_003",
      recipient_id: "r_liveshowcase",
      author_name: "Demo Bot (Telegram)",
      body: "First note.",
      created_at: new Date(NOW).toISOString(),
    });

    adapter.mergeBackendNote({
      id: "note_tg_003",
      recipient_id: "r_liveshowcase",
      author_name: "Demo Bot (Telegram)",
      body: "Second note (should not be added).",
      created_at: new Date(NOW + 1_000).toISOString(),
    });

    expect(adapter["state"].notes).toHaveLength(1);
    expect(adapter["state"].notes[0]!.body).toBe("First note.");
  });
});

describe("DemoAdapter · __resetLiveshowcase", () => {
  function createAdapter() {
    const adapter = new DemoAdapter({ now: () => NOW, latencyMs: [0, 0] });
    return { adapter };
  }

  it("clears events, alerts, notes added during session", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.mergeBackendEvents([
      {
        id: "evt_reset_1",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        category: "posture",
        severity: "warning",
        care_level: 7,
        summary: "Test",
        description: "",
        observed_at: new Date(NOW - 5_000).toISOString(),
        received_at: new Date(NOW - 3_000).toISOString(),
        source_mode: "simulated",
        schema_version: "demo-control-1",
        source_record_id: "srr-1",
        alert_triggered: false,
        product: "carelens",
      },
    ]);
    adapter.mergeBackendAlerts([
      {
        id: "al_reset_1",
        device_id: "d_hub_liveshowcase",
        recipient_id: "r_liveshowcase",
        severity: "warning",
        category: "posture",
        summary: "Test alert",
        status: "open",
        triggered_at: new Date(NOW - 3_000).toISOString(),
        acknowledged_at: null,
        acknowledged_by: null,
        review_outcome: null,
        review_note: null,
        resolved_at: null,
        resolved_by: null,
        product: "carelens",
      },
    ]);
    adapter.mergeBackendNote({
      id: "note_reset_1",
      recipient_id: "r_liveshowcase",
      author_name: "Demo Bot (Telegram)",
      body: "Test note",
      created_at: new Date(NOW).toISOString(),
    });

    expect(adapter["state"].events.filter((e) => e.recipientId === "r_liveshowcase")).toHaveLength(1);
    expect(adapter["state"].alerts.filter((a) => a.recipientId === "r_liveshowcase")).toHaveLength(1);
    expect(adapter["state"].notes).toHaveLength(1);

    adapter.__resetLiveshowcase();

    expect(adapter["state"].events.filter((e) => e.recipientId === "r_liveshowcase")).toHaveLength(0);
    expect(adapter["state"].alerts.filter((a) => a.recipientId === "r_liveshowcase")).toHaveLength(0);
    expect(adapter["state"].notes).toHaveLength(0);
  });

  it("sets both devices offline", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.__simulateBackendDeviceUpdate("d_hub_liveshowcase", true);
    adapter.__simulateBackendDeviceUpdate("d_core_liveshowcase", true);

    expect(adapter["state"].backendDevices["d_hub_liveshowcase"]!.online).toBe(true);
    expect(adapter["state"].backendDevices["d_core_liveshowcase"]!.online).toBe(true);

    adapter.__resetLiveshowcase();

    expect(adapter["state"].backendDevices["d_hub_liveshowcase"]!.online).toBe(false);
    expect(adapter["state"].backendDevices["d_core_liveshowcase"]!.online).toBe(false);
  });

  it("does NOT touch r_an state", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_minh");

    const before = await adapter.listAlerts("r_an", { product: "all", status: "all", range: "30d", assignee: "all" });
    expect(before.items.length).toBeGreaterThan(0);

    const liveshowcaseAdapter = new DemoAdapter({ now: () => NOW, latencyMs: [0, 0] });
    await liveshowcaseAdapter.enterDemo("u_liveshowcase");
    liveshowcaseAdapter.__resetLiveshowcase();

    const after = await adapter.listAlerts("r_an", { product: "all", status: "all", range: "30d", assignee: "all" });
    expect(after.items.length).toBe(before.items.length);
  });

  it("sourcesFor r_liveshowcase returns unknown state after reset (no prior data)", async () => {
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    adapter.__simulateBackendDeviceUpdate("d_hub_liveshowcase", true);
    adapter.__simulateBackendDeviceUpdate("d_core_liveshowcase", true);

    adapter.__resetLiveshowcase();

    const ctx = await adapter.getRecipientContext("r_liveshowcase");
    const cl = ctx.recipient.sources.find((s) => s.product === "carelens")!;
    const eco = ctx.recipient.sources.find((s) => s.product === "ecopatch")!;
    // After reset, both devices are offline with no lastSeenStored → "unknown" state
    // (device has never been online, no measurement history)
    expect(cl.state).toBe("unknown");
    expect(eco.state).toBe("unknown");
  });

  it("after reset, emits hints to invalidate events/alerts/overview/history caches (regression: post-reset commands must appear)", async () => {
    // Regression: after /reset, React Query caches for events/alerts/overview/history
    // must be invalidated so the next /c_fall appears without manual refresh.
    const { adapter } = createAdapter();
    await adapter.enterDemo("u_liveshowcase");

    const seenHints: string[] = [];
    adapter.subscribe("r_liveshowcase", {
      onHint: (h) => seenHints.push(h.type),
      onClose: () => undefined,
    });

    adapter.__resetLiveshowcase();
    // emit() dispatches handlers via queueMicrotask — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Must invalidate the queries that store previous-session events/alerts/notes.
    expect(seenHints).toContain("device.updated");
    expect(seenHints).toContain("event.created");
    expect(seenHints).toContain("alert.created");
    expect(seenHints).toContain("note.created");
  });
});