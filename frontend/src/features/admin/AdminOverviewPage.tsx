import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Cpu, History, KeyRound, ListChecks, RefreshCw, Server, Volume2 } from "lucide-react";
import { useAdminAuth } from "../../app/adminAuth";
import { isAdminApiError, type OpsAgent, type OpsDevice, type OpsStatus } from "../../data/admin/adminClient";
import { EmptyState, InlineError, LoadingState, Notice, StatusLabel } from "../../design-system/feedback";
import { SoftButton } from "../../design-system/primitives";
import { formatDateTime } from "../../lib/time";
import { AuditList } from "./AdminAuditPage";
import { Card, Row, dash, formatAge } from "./AdminParts";
import { COMMAND_STATUS_LABELS, COMPONENT_LABELS, IMU_INGEST_LABELS, JOB_KIND_LABELS, ROW_STATUS_LABELS } from "./labels";
import { useAdminLoad } from "./useAdminLoad";

type Load = { status: "loading" } | { status: "ready"; data: OpsStatus } | { status: "error"; message: string };

function SystemStatus({ data }: { data: OpsStatus }) {
  const mb = data.storage.d1SizeBytes === null ? dash : `${(data.storage.d1SizeBytes / 1_000_000).toFixed(1)} MB`;
  return (
    <dl>
      <Row label="Giờ máy chủ">{formatDateTime(data.serverTime)}</Row>
      <Row label="Dung lượng cơ sở dữ liệu D1">{mb}</Row>
      <Row label="IMU thô">{data.storage.imuIngest ? (IMU_INGEST_LABELS[data.storage.imuIngest] ?? data.storage.imuIngest) : dash}</Row>
      <Row label="Việc đang chờ">
        {data.queue.length === 0 ? "Không có việc chờ" : data.queue.map((q) => `${JOB_KIND_LABELS[q.kind] ?? q.kind}: ${q.waiting}`).join("; ")}
      </Row>
      <Row label="Việc lỗi, hết hạn hoặc chờ thử lại (24 giờ)">{data.failures24h}</Row>
      <Row label="Lần suy luận thành công gần nhất">
        {data.lastInference.length === 0
          ? "Chưa có"
          : data.lastInference.map((r) => `${JOB_KIND_LABELS[r.kind] ?? r.kind}: ${formatDateTime(r.completedAt)}`).join("; ")}
      </Row>
      <Row label="Phiên bản quy tắc hợp nhất">{data.fusion.policyVersion ?? dash}</Row>
      <Row label="Cảnh báo nghi ngã">
        {data.fusion.suspectedFallPossible === null ? dash : data.fusion.suspectedFallPossible ? "Có quy tắc đã cấu hình" : "Chưa bật: chưa có quy tắc nào được duyệt"}
      </Row>
    </dl>
  );
}

function DeviceRegistry({ devices }: { devices: OpsDevice[] }) {
  if (devices.length === 0) {
    return (
      <EmptyState icon={<Cpu />} title="Chưa có thiết bị nào được đăng ký">
        <p>Máy chủ báo danh sách thiết bị trống. Việc đăng ký thiết bị chưa có trong giao diện này.</p>
      </EmptyState>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">Thiết bị đã đăng ký, chỉ xem</caption>
        <thead>
          <tr className="border-b border-ink/20">
            <th scope="col" className="py-2 pr-4">Thiết bị</th>
            <th scope="col" className="py-2 pr-4">Hồ sơ</th>
            <th scope="col" className="py-2 pr-4">Trạng thái</th>
            <th scope="col" className="py-2 pr-4">Liên lạc gần nhất</th>
            <th scope="col" className="py-2">Sức khỏe do thiết bị tự báo</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.deviceId} className="border-b border-ink/10 align-top last:border-b-0">
              <th scope="row" className="py-3 pr-4 font-bold">
                {d.deviceId}
                <span className="block text-xs font-normal">{d.firmwareVersion ?? "chưa báo phiên bản firmware"}</span>
              </th>
              <td className="py-3 pr-4">{d.recipientId || dash}</td>
              <td className="py-3 pr-4">{ROW_STATUS_LABELS[d.status] ?? d.status}</td>
              <td className="py-3 pr-4">
                <StatusLabel tone={d.connected ? "neutral" : "inactive"}>{d.connected ? "Có liên lạc gần đây" : "Không có liên lạc gần đây"}</StatusLabel>
                <span className="mt-1 block text-xs">{d.lastSeenAt ? `${formatDateTime(d.lastSeenAt)} (${formatAge(d.lastContactAgeSeconds)})` : "Chưa từng liên lạc"}</span>
              </td>
              <td className="py-3">
                {d.health ? (
                  <ul className="text-xs">
                    <li>Camera: {COMPONENT_LABELS[d.health.camera ?? ""] ?? dash}</li>
                    <li>IMU: {COMPONENT_LABELS[d.health.imu ?? ""] ?? dash}</li>
                    <li>Loa: {COMPONENT_LABELS[d.health.speaker ?? ""] ?? dash}</li>
                    <li>Wi-Fi: {d.health.wifiRssiDbm === null ? dash : `${d.health.wifiRssiDbm} dBm`}</li>
                    {d.health.lastError ? <li>Lỗi gần nhất: {d.health.lastError}</li> : null}
                  </ul>
                ) : (
                  <span className="text-xs">Chưa nhận heartbeat nào</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgentList({ agents }: { agents: OpsAgent[] }) {
  if (agents.length === 0) {
    return (
      <EmptyState icon={<Server />} title="Chưa có agent nào được đăng ký">
        <p>Không có Local AI Agent nào nối với máy chủ này, nên chưa có suy luận hình ảnh.</p>
      </EmptyState>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {agents.map((a) => (
        <li key={a.agentId} className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-surface p-4 shadow-inset-sm">
          <div className="min-w-0">
            <p className="font-bold">{a.label}</p>
            <p className="text-xs">{a.agentId} · {ROW_STATUS_LABELS[a.status] ?? a.status}</p>
            <p className="text-xs">{a.lastSeenAt ? `Liên lạc gần nhất: ${formatDateTime(a.lastSeenAt)}` : "Chưa từng liên lạc"}{a.hasReport ? " · đã gửi báo cáo phiên bản" : ""}</p>
          </div>
          <StatusLabel tone={a.connected ? "neutral" : "inactive"}>{a.connected ? "Đang kết nối" : "Không kết nối"}</StatusLabel>
        </li>
      ))}
    </ul>
  );
}

/** What this server can and cannot do for the dashboard, from GET /capabilities. A 404 means the Worker predates the dashboard API. */
function ServerCapabilities() {
  const { state, reload } = useAdminLoad((client, token) => client.capabilities(token), "capabilities");
  if (state.status === "loading") return <p>Đang tải…</p>;
  if (state.status === "error") {
    return (
      <InlineError title={state.error?.code === "not_found" ? "Máy chủ chưa có API bảng điều khiển" : "Không đọc được khả năng của máy chủ"} onRetry={reload}>
        {state.message}
      </InlineError>
    );
  }
  const c = state.data;
  return (
    <dl>
      <Row label="Chuyển văn bản thành giọng nói">{c.tts.available ? "Có" : "Không có"}</Row>
      <Row label="Âm thanh gửi được">WAV PCM 16-bit mono, {c.audio.sampleRatesHz.join(" / ")} Hz</Row>
      <Row label="Múi giờ nhắc lịch và báo cáo">{c.reminders.timezone ?? dash}</Row>
      <Row label="Phát trên loa thiết bị thật">{c.devicePlayback === "not_verified_with_hardware" ? "Chưa kiểm chứng với phần cứng" : (c.devicePlayback ?? "Không có thông tin")}</Row>
    </dl>
  );
}

/** Commands per device from the registry endpoint: counts the server holds, never an estimate. */
function CommandOverview() {
  const { state, reload } = useAdminLoad((client, token) => client.devices(token), "devices");
  if (state.status === "loading") return <p>Đang tải…</p>;
  if (state.status === "error") {
    return (
      <InlineError title="Không tải được lệnh theo thiết bị" onRetry={reload}>
        {state.message}
      </InlineError>
    );
  }
  const rows = state.data.items;
  if (rows.length === 0) return <p>Chưa có thiết bị nào được đăng ký nên chưa có lệnh.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((d) => {
        const entries = [...Object.entries(d.commands.active), ...Object.entries(d.commands.last24h)];
        return (
          <li key={d.deviceId} className="rounded-control bg-surface p-3 shadow-inset-sm">
            <Link to={`/admin/devices/${encodeURIComponent(d.deviceId)}`} className="font-bold underline">
              {d.label}
            </Link>
            <p className="text-xs">
              {entries.length === 0
                ? "Không có lệnh đang mở và không có lệnh trong 24 giờ qua."
                : entries.map(([status, n]) => `${COMMAND_STATUS_LABELS[status as keyof typeof COMMAND_STATUS_LABELS]?.label ?? status}: ${n}`).join("; ")}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function RecentAudit() {
  const { state, reload } = useAdminLoad((client, token) => client.audit(token, { limit: 5 }), "audit-recent");
  if (state.status === "loading") return <p>Đang tải…</p>;
  if (state.status === "error") {
    return (
      <InlineError title="Không tải được nhật ký quản trị" onRetry={reload}>
        {state.message}
      </InlineError>
    );
  }
  if (state.data.items.length === 0) return <p>Chưa có thao tác quản trị nào được ghi.</p>;
  return (
    <>
      <AuditList items={state.data.items} />
      <Link to="/admin/audit" className="min-h-11 py-2 font-bold underline">
        Xem toàn bộ nhật ký
      </Link>
    </>
  );
}

/**
 * Tổng quan quản trị. Chỉ hiển thị thứ máy chủ thực sự trả về qua GET /api/admin/v1/status (chỉ đọc); phần chưa có API được ghi rõ
 * là chưa khả dụng, không có số liệu giả hay trạng thái mặc định nào được dựng sẵn.
 */
export function AdminOverviewPage() {
  const { run } = useAdminAuth();
  const [load, setLoad] = useState<Load>({ status: "loading" });

  const fetchStatus = useCallback(() => {
    // A 401/403 ends the admin session inside `run`, and the route guard then leaves this page.
    run((client, token) => client.status(token))
      .then((data) => setLoad({ status: "ready", data }))
      .catch((error: unknown) => setLoad({ status: "error", message: isAdminApiError(error) ? error.message : "Không tải được trạng thái hệ thống." }));
  }, [run]);
  const refresh = () => {
    setLoad({ status: "loading" });
    fetchStatus();
  };

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl leading-tight font-extrabold tracking-tight">Tổng quan quản trị</h1>
        <SoftButton size="sm" variant="secondary" onClick={refresh} disabled={load.status === "loading"}>
          <RefreshCw className="size-4" aria-hidden />
          Làm mới
        </SoftButton>
      </div>

      {load.status === "loading" ? <LoadingState label="Đang tải trạng thái hệ thống…" /> : null}
      {load.status === "error" ? (
        <InlineError title="Không tải được trạng thái hệ thống" onRetry={refresh}>
          {load.message}
        </InlineError>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card icon={<Server aria-hidden />} title="Trạng thái hệ thống">
          {load.status === "ready" ? <SystemStatus data={load.data} /> : <p>{load.status === "loading" ? "Đang tải…" : "Chưa có dữ liệu do lỗi tải ở trên."}</p>}
        </Card>

        <Card icon={<Server aria-hidden />} title="Agent cục bộ">
          {load.status === "ready" ? <AgentList agents={load.data.agents} /> : <p>{load.status === "loading" ? "Đang tải…" : "Chưa có dữ liệu do lỗi tải ở trên."}</p>}
        </Card>
      </div>

      <Card icon={<Cpu aria-hidden />} title="Sổ thiết bị">
        {load.status === "ready" ? <DeviceRegistry devices={load.data.devices} /> : <p>{load.status === "loading" ? "Đang tải…" : "Chưa có dữ liệu do lỗi tải ở trên."}</p>}
        <Notice icon={<KeyRound aria-hidden />} title="Cấp phát chưa có ở giai đoạn này">
          Đăng ký thiết bị, hiện và xoay thông tin xác thực, thu hồi, và mời hoặc phân quyền quản trị viên sẽ được thêm ở giai đoạn sau. Hiện danh sách chỉ để xem; chi tiết từng thiết bị ở mục Thiết bị.
        </Notice>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card icon={<ListChecks aria-hidden />} title="Lệnh gửi thiết bị">
          <CommandOverview />
        </Card>
        <Card icon={<Volume2 aria-hidden />} title="Khả năng của máy chủ">
          <ServerCapabilities />
        </Card>
      </div>

      <Card icon={<History aria-hidden />} title="Hoạt động quản trị gần đây">
        <RecentAudit />
      </Card>
    </div>
  );
}
