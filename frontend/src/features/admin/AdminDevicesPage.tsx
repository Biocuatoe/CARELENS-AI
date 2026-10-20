import { Link, useParams } from "react-router";
import { ArrowLeft, Cpu, ListChecks, RefreshCw, Wifi } from "lucide-react";
import { COMMAND_STATUSES, type AdminDevice } from "../../data/admin/adminClient";
import { EmptyState, InlineError, LoadingState, Notice, StatusLabel } from "../../design-system/feedback";
import { SoftButton } from "../../design-system/primitives";
import { formatDateTime } from "../../lib/time";
import { Card, PageTitle, Row, SimulatedBadge, dash, formatAge } from "./AdminParts";
import { COMMAND_STATUS_LABELS, COMMAND_TYPE_LABELS, COMPONENT_LABELS, GENERIC_STATUS_LABELS, REASON_LABELS, ROW_STATUS_LABELS, commandStateLabel } from "./labels";
import { SpeakerVolumeCard } from "./SpeakerVolumeCard";
import { useAdminLoad } from "./useAdminLoad";

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

function Contact({ device }: { device: AdminDevice }) {
  return (
    <>
      <StatusLabel tone={device.connected ? "neutral" : "inactive"}>{device.connected ? "Có liên lạc gần đây" : "Không có liên lạc gần đây"}</StatusLabel>
      <span className="mt-1 block text-xs">{device.lastSeenAt ? `${formatDateTime(device.lastSeenAt)} (${formatAge(device.lastContactAgeSeconds)})` : "Chưa từng liên lạc"}</span>
    </>
  );
}

function DeviceList() {
  const { state, reload } = useAdminLoad((client, token) => client.devices(token), "devices");
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        actions={
          <SoftButton size="sm" variant="secondary" onClick={reload} disabled={state.status === "loading"}>
            <RefreshCw className="size-4" aria-hidden />
            Làm mới
          </SoftButton>
        }
      >
        Thiết bị
      </PageTitle>
      {state.status === "loading" ? <LoadingState label="Đang tải danh sách thiết bị…" /> : null}
      {state.status === "error" ? (
        <InlineError title="Không tải được danh sách thiết bị" onRetry={reload}>
          {state.message}
        </InlineError>
      ) : null}
      {state.status === "ready" && state.data.items.length === 0 ? (
        <EmptyState icon={<Cpu />} title="Chưa có thiết bị nào được đăng ký">
          <p>Máy chủ báo sổ thiết bị trống. Đăng ký thiết bị và cấp credential chưa có trong giao diện này.</p>
        </EmptyState>
      ) : null}
      {state.status === "ready" && state.data.items.length > 0 ? (
        <Card icon={<Cpu aria-hidden />} title="Sổ thiết bị">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <caption className="sr-only">Thiết bị đã đăng ký</caption>
              <thead>
                <tr className="border-b border-ink/20">
                  <th scope="col" className="py-2 pr-4">Thiết bị</th>
                  <th scope="col" className="py-2 pr-4">Trạng thái</th>
                  <th scope="col" className="py-2 pr-4">Liên lạc gần nhất</th>
                  <th scope="col" className="py-2 pr-4">Lệnh đang mở</th>
                  <th scope="col" className="py-2">Ghi chú dữ liệu</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((d) => (
                  <tr key={d.deviceId} className="border-b border-ink/10 align-top last:border-b-0">
                    <th scope="row" className="py-3 pr-4 font-bold">
                      <Link to={`/admin/devices/${encodeURIComponent(d.deviceId)}`} className="underline">
                        {d.label}
                      </Link>
                      <span className="block text-xs font-normal">{d.deviceId}</span>
                    </th>
                    <td className="py-3 pr-4">
                      {ROW_STATUS_LABELS[d.status] ?? d.status}
                      <span className="block text-xs">{d.firmwareVersion ?? "chưa báo phiên bản firmware"}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <Contact device={d} />
                    </td>
                    <td className="py-3 pr-4">{sum(d.commands.active)}</td>
                    <td className="py-3">{d.hasSimulatedRecords ? <SimulatedBadge label="Có dữ liệu mô phỏng (7 ngày)" /> : <span className="text-xs">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.data.simulatedSources === "accepted" ? (
            <Notice title="Máy chủ này nhận dữ liệu mô phỏng">Cấu hình ACCEPT_SIMULATED_SOURCES đang bật: chỉ phù hợp cho môi trường thử, không phải triển khai thật.</Notice>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function CommandHistory({ deviceId }: { deviceId: string }) {
  const { state, reload } = useAdminLoad((client, token) => client.commands(token, deviceId), `commands|${deviceId}`);
  if (state.status === "loading") return <LoadingState label="Đang tải lệnh gần đây…" />;
  if (state.status === "error")
    return (
      <InlineError title="Không tải được danh sách lệnh" onRetry={reload}>
        {state.message}
      </InlineError>
    );
  if (state.data.items.length === 0) return <p>Chưa có lệnh nào được tạo cho thiết bị này.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {state.data.items.map((c) => {
        const info = commandStateLabel(c);
        return (
          <li key={c.commandId} className="rounded-control bg-surface p-3 shadow-inset-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold">{COMMAND_TYPE_LABELS[c.commandType] ?? c.commandType}</span>
              <StatusLabel tone={info.tone}>{info.label}</StatusLabel>
            </div>
            <p className="text-xs">
              {c.commandId} · tạo {formatDateTime(c.createdAt)}
              {c.statusReason ? ` · ${REASON_LABELS[c.statusReason] ?? c.statusReason}` : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function DeviceDetail({ deviceId }: { deviceId: string }) {
  const { state, reload, refresh } = useAdminLoad((client, token) => client.device(token, deviceId), `device|${deviceId}`);
  const caps = useAdminLoad((client, token) => client.capabilities(token), "capabilities");
  const back = (
    <Link to="/admin/devices" className="inline-flex min-h-11 items-center gap-2 font-bold underline">
      <ArrowLeft className="size-4" aria-hidden />
      Tất cả thiết bị
    </Link>
  );
  if (state.status === "loading") return <div className="flex flex-col gap-4">{back}<LoadingState label="Đang tải thiết bị…" /></div>;
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <InlineError title="Không tải được thiết bị" onRetry={reload}>
          {state.message}
        </InlineError>
      </div>
    );
  }
  const d = state.data;
  const q = `?device=${encodeURIComponent(d.deviceId)}`;
  const hb = d.heartbeat;
  const component = (v: string | null) => (v === null ? "không báo" : (COMPONENT_LABELS[v] ?? v));
  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageTitle actions={d.hasSimulatedRecords ? <SimulatedBadge label="Có dữ liệu mô phỏng (7 ngày)" /> : undefined}>{d.label}</PageTitle>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card icon={<Cpu aria-hidden />} title="Đăng ký và credential">
          <dl>
            <Row label="Mã thiết bị">{d.deviceId}</Row>
            <Row label="Hồ sơ gắn với thiết bị">{d.recipientId || dash}</Row>
            <Row label="Trạng thái đăng ký">{ROW_STATUS_LABELS[d.status] ?? d.status}</Row>
            <Row label="Credential">
              {d.credential.state === "active" ? "Đang hiệu lực" : d.credential.state === "revoked" ? "Đã thu hồi" : "Không rõ"}
              {d.credential.version !== null ? ` (phiên bản ${d.credential.version})` : ""}
            </Row>
            <Row label="Đăng ký lúc">{formatDateTime(d.createdAt)}</Row>
            {d.revokedAt ? <Row label="Thu hồi lúc">{formatDateTime(d.revokedAt)}</Row> : null}
          </dl>
          <p className="text-xs">Giao diện không hiện và không thể lấy lại credential; máy chủ chỉ giữ giá trị băm của nó.</p>
        </Card>

        <Card icon={<Wifi aria-hidden />} title="Kết nối và firmware">
          <dl>
            <Row label="Liên lạc">
              <Contact device={d} />
            </Row>
            <Row label="Cửa sổ coi là còn liên lạc">{d.onlineWindowSeconds === null ? dash : `${d.onlineWindowSeconds} giây`}</Row>
            <Row label="Phiên bản firmware">{d.firmwareVersion ?? "chưa báo"}</Row>
          </dl>
          {hb ? (
            <>
              <h3 className="font-bold">Sức khỏe do thiết bị tự báo lúc {formatDateTime(hb.at)}</h3>
              <dl>
                <Row label="Camera">{component(hb.camera)}</Row>
                <Row label="IMU">{component(hb.imu)}</Row>
                <Row label="Loa">{component(hb.speaker)}</Row>
                <Row label="Wi-Fi">{hb.wifiRssiDbm === null ? "không báo" : `${hb.wifiRssiDbm} dBm`}</Row>
                <Row label="Bộ nhớ trống">{hb.freeHeapBytes === null ? "không báo" : `${Math.round(hb.freeHeapBytes / 1024)} KB`}</Row>
                {hb.lastError ? <Row label="Lỗi gần nhất">{hb.lastError}</Row> : null}
              </dl>
              <p className="text-xs">Đây là lời tự báo của firmware, máy chủ không kiểm chứng. Chưa có thiết bị thật nào được kiểm thử với hệ thống này.</p>
            </>
          ) : (
            <p>Chưa nhận heartbeat nào từ thiết bị này.</p>
          )}
        </Card>

        <SpeakerVolumeCard device={d} caps={caps.state.status === "ready" ? caps.state.data : null} onChanged={refresh} />

        <Card icon={<ListChecks aria-hidden />} title="Hoạt động gần nhất">
          <dl>
            <Row label="Lần chụp gần nhất">
              {d.lastCapture ? `${formatDateTime(d.lastCapture.capturedAt)} · ${GENERIC_STATUS_LABELS[d.lastCapture.status ?? ""] ?? d.lastCapture.status ?? "không rõ"}` : "Chưa có"}
            </Row>
            <Row label="Suy luận thành công gần nhất">{d.lastInferenceAt ? formatDateTime(d.lastInferenceAt) : "Chưa có"}</Row>
            <Row label="Sự kiện gần nhất">{d.lastEvent ? `${formatDateTime(d.lastEvent.observedAt)} · ${d.lastEvent.eventType ?? "không rõ"}` : "Chưa có"}</Row>
          </dl>
          {d.lastCapture?.sourceMode === "simulated" || d.lastEvent?.sourceMode === "simulated" ? <SimulatedBadge /> : null}
          <div className="flex flex-wrap gap-3">
            <Link to={`/admin/reports${q}`} className="min-h-11 py-2 font-bold underline">Báo cáo theo ngày</Link>
            <Link to={`/admin/messages${q}`} className="min-h-11 py-2 font-bold underline">Gửi âm thanh</Link>
            <Link to={`/admin/reminders${q}`} className="min-h-11 py-2 font-bold underline">Nhắc lịch</Link>
          </div>
        </Card>

        <Card icon={<ListChecks aria-hidden />} title="Lệnh gửi thiết bị">
          <dl>
            {COMMAND_STATUSES.filter((s) => (d.commands.active[s] ?? 0) > 0 || (d.commands.last24h[s] ?? 0) > 0).map((s) => (
              <Row key={s} label={COMMAND_STATUS_LABELS[s].label}>
                {d.commands.active[s] ?? d.commands.last24h[s]}
                {d.commands.active[s] === undefined ? " (24 giờ qua)" : ""}
              </Row>
            ))}
          </dl>
          {sum(d.commands.active) + sum(d.commands.last24h) === 0 ? <p>Không có lệnh đang mở và không có lệnh nào trong 24 giờ qua.</p> : null}
          <CommandHistory deviceId={d.deviceId} />
        </Card>
      </div>
    </div>
  );
}

export function AdminDevicesPage() {
  const { deviceId } = useParams();
  return deviceId ? <DeviceDetail deviceId={deviceId} /> : <DeviceList />;
}
