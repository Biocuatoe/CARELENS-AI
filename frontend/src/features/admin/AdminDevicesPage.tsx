import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Cpu, ListChecks, RefreshCw, Wifi } from "lucide-react";
import { COMMAND_STATUSES, type AdminDevice } from "../../data/admin/adminClient";
import type { RecentCapture, RecentCapturesPage } from "../../data/admin/adminModels";
import {
  EmptyState,
  InlineError,
  LoadingState,
  Notice,
  StatusLabel,
} from "../../design-system/feedback";
import { SoftButton } from "../../design-system/primitives";
import { formatDateTime } from "../../lib/time";
import { Card, PageTitle, Row, SimulatedBadge, dash } from "./AdminParts";
import {
  CAPTURE_MODE_LABELS,
  CAPTURE_STATE_LABELS,
  captureBackpressureText,
  captureCountersText,
  captureEventsText,
  captureQueueText,
  captureReconciles,
  imuUplinkText,
  DRINK_RESULT_LABELS,
  FALL_RESULT_LABELS,
  PROCESSING_STATE_LABELS,
  COMMAND_STATUS_LABELS,
  COMMAND_TYPE_LABELS,
  COMPONENT_LABELS,
  GENERIC_STATUS_LABELS,
  REASON_LABELS,
  RESET_REASON_LABELS,
  ROW_STATUS_LABELS,
  commandStateLabel,
} from "./labels";
import { ConnectionStatus } from "./ConnectionStatus";
import { SpeakerVolumeCard } from "./SpeakerVolumeCard";
import { useAdminLoad, type Load } from "./useAdminLoad";

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

function Contact({ device }: { device: AdminDevice }) {
  return (
    <ConnectionStatus
      input={{
        lastSeenAt: device.lastSeenAt,
        serverTime: device.serverTime,
        receivedAtMs: device.receivedAtMs,
        policy: device.connectionPolicy,
        serverState: device.connectionState,
      }}
    />
  );
}

function DeviceList() {
  const { state, reload, refresh } = useAdminLoad(
    (client, token) => client.devices(token),
    "devices",
  );
  usePoll(refresh, DEVICE_POLL_MS);
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        actions={
          <SoftButton
            size="sm"
            variant="secondary"
            onClick={reload}
            disabled={state.status === "loading"}
          >
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
          <p>
            Máy chủ báo sổ thiết bị trống. Đăng ký thiết bị và cấp credential chưa có trong giao
            diện này.
          </p>
        </EmptyState>
      ) : null}
      {state.status === "ready" && state.data.items.length > 0 ? (
        <Card icon={<Cpu aria-hidden />} title="Sổ thiết bị">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <caption className="sr-only">Thiết bị đã đăng ký</caption>
              <thead>
                <tr className="border-b border-ink/20">
                  <th scope="col" className="py-2 pr-4">
                    Thiết bị
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Trạng thái
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Liên lạc gần nhất
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Lệnh đang mở
                  </th>
                  <th scope="col" className="py-2">
                    Ghi chú dữ liệu
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((d) => (
                  <tr key={d.deviceId} className="border-b border-ink/10 align-top last:border-b-0">
                    <th scope="row" className="py-3 pr-4 font-bold">
                      <Link
                        to={`/admin/devices/${encodeURIComponent(d.deviceId)}`}
                        className="underline"
                      >
                        {d.label}
                      </Link>
                      <span className="block text-xs font-normal">{d.deviceId}</span>
                    </th>
                    <td className="py-3 pr-4">
                      {ROW_STATUS_LABELS[d.status] ?? d.status}
                      <span className="block text-xs">
                        {d.firmwareVersion ?? "chưa báo phiên bản firmware"}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <Contact device={d} />
                    </td>
                    <td className="py-3 pr-4">{sum(d.commands.active)}</td>
                    <td className="py-3">
                      {d.hasSimulatedRecords ? (
                        <SimulatedBadge label="Có dữ liệu mô phỏng (7 ngày)" />
                      ) : (
                        <span className="text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.data.simulatedSources === "accepted" ? (
            <Notice title="Máy chủ này nhận dữ liệu mô phỏng">
              Cấu hình ACCEPT_SIMULATED_SOURCES đang bật: chỉ phù hợp cho môi trường thử, không phải
              triển khai thật.
            </Notice>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function CommandHistory({ deviceId }: { deviceId: string }) {
  const { state, reload } = useAdminLoad(
    (client, token) => client.commands(token, deviceId),
    `commands|${deviceId}`,
  );
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
              <span className="font-bold">
                {COMMAND_TYPE_LABELS[c.commandType] ?? c.commandType}
              </span>
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

/** Re-fetches every `ms` while the tab is visible; nothing while it is hidden. */
function usePoll(refresh: () => void, ms: number) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, ms);
    return () => clearInterval(timer);
  }, [refresh, ms]);
}

export const CAPTURES_POLL_MS = 10_000;
export const DEVICE_POLL_MS = 15_000;

function resultLine(c: RecentCapture): string {
  const parts = c.results.map((r) => {
    if (r.eventType === "drink_check")
      return `Uống nước/thuốc: ${DRINK_RESULT_LABELS[r.classification] ?? r.classification}`;
    if (r.eventType === "fall_check") {
      const text = FALL_RESULT_LABELS[r.classification] ?? r.classification;
      return r.modelScore !== null && r.scoreKind === "uncalibrated_logit"
        ? `Ngã: ${text} (điểm thô ${r.modelScore.toFixed(2)}, không phải xác suất)`
        : `Ngã: ${text}`;
    }
    return `${r.eventType}: ${r.classification}`;
  });
  return parts.length > 0 ? parts.join(" · ") : "Chưa có kết quả";
}

function RecentCapturesCard({
  state,
  reload,
}: {
  state: Load<RecentCapturesPage>;
  reload: () => void;
}) {
  return (
    <Card icon={<ListChecks aria-hidden />} title="Lần chụp gần đây">
      <p className="text-sm">
        Tự làm mới mỗi {CAPTURES_POLL_MS / 1000} giây khi trang đang mở. Kết quả là đầu ra của mô
        hình, chưa được người xác nhận; không có cảnh báo nào được tạo từ chúng.
      </p>
      <div>
        <SoftButton
          size="sm"
          variant="secondary"
          onClick={reload}
          disabled={state.status === "loading"}
        >
          <RefreshCw className="size-4" aria-hidden />
          Làm mới
        </SoftButton>
      </div>
      {state.status === "loading" ? <LoadingState label="Đang tải lần chụp…" /> : null}
      {state.status === "error" ? (
        <InlineError title="Không tải được lần chụp" onRetry={reload}>
          {state.message}
        </InlineError>
      ) : null}
      {state.status === "ready" ? (
        <>
          <dl>
            <Row label="Cập nhật lúc">
              {state.data.serverTime ? formatDateTime(state.data.serverTime) : "không rõ"}
            </Row>
            <Row label="Đang chờ agent">
              {state.data.queuedVisionJobs === null
                ? "không rõ"
                : `${state.data.queuedVisionJobs} việc`}
            </Row>
            {state.data.deviceCounters?.capture ? (
              <Row label="Thiết bị tự báo (lần khởi động này)">
                {`${captureCountersText(state.data.deviceCounters.capture)} (burst bỏ trên thiết bị không bao giờ lên máy chủ)`}
              </Row>
            ) : null}
          </dl>
          {state.data.items.length === 0 ? (
            <p>Chưa có lần chụp nào của thiết bị này trên máy chủ.</p>
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Lần chụp gần đây">
              {state.data.items.map((c) => {
                const info = PROCESSING_STATE_LABELS[c.processingState] ?? {
                  label: c.processingState,
                  tone: "unknown" as const,
                };
                return (
                  <li key={c.captureId} className="rounded-control p-3 shadow-inset-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{formatDateTime(c.capturedAt)}</span>
                      <StatusLabel tone={info.tone}>{info.label}</StatusLabel>
                      {c.sourceMode === "simulated" ? <SimulatedBadge /> : null}
                    </div>
                    <p className="text-sm">{resultLine(c)}</p>
                    <p className="text-xs">
                      {[
                        c.captureId,
                        c.frameCount !== null ? `${c.frameCount} khung` : null,
                        c.cadenceStatus ? `nhịp ${c.cadenceStatus}` : null,
                        c.resultAfterMs !== null
                          ? `có kết quả sau ${Math.round(c.resultAfterMs / 1000)} s`
                          : null,
                        c.stateReason ? `lý do ${c.stateReason}` : null,
                        c.mediaDeletedAt
                          ? "ảnh tạm đã xóa"
                          : c.captureStatus === "processed"
                            ? "ảnh tạm chưa xóa"
                            : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </Card>
  );
}

function DeviceDetail({ deviceId }: { deviceId: string }) {
  const { state, reload, refresh } = useAdminLoad(
    (client, token) => client.device(token, deviceId),
    `device|${deviceId}`,
  );
  usePoll(refresh, DEVICE_POLL_MS);
  const captures = useAdminLoad(
    (client, token) => client.recentCaptures(token, deviceId),
    `captures|${deviceId}`,
  );
  usePoll(captures.refresh, CAPTURES_POLL_MS);
  const caps = useAdminLoad((client, token) => client.capabilities(token), "capabilities");
  const back = (
    <Link
      to="/admin/devices"
      className="inline-flex min-h-11 items-center gap-2 font-bold underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Tất cả thiết bị
    </Link>
  );
  if (state.status === "loading")
    return (
      <div className="flex flex-col gap-4">
        {back}
        <LoadingState label="Đang tải thiết bị…" />
      </div>
    );
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
      <PageTitle
        actions={
          d.hasSimulatedRecords ? (
            <SimulatedBadge label="Có dữ liệu mô phỏng (7 ngày)" />
          ) : undefined
        }
      >
        {d.label}
      </PageTitle>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card icon={<Cpu aria-hidden />} title="Đăng ký và credential">
          <dl>
            <Row label="Mã thiết bị">{d.deviceId}</Row>
            <Row label="Hồ sơ gắn với thiết bị">{d.recipientId || dash}</Row>
            <Row label="Trạng thái đăng ký">{ROW_STATUS_LABELS[d.status] ?? d.status}</Row>
            <Row label="Credential">
              {d.credential.state === "active"
                ? "Đang hiệu lực"
                : d.credential.state === "revoked"
                  ? "Đã thu hồi"
                  : "Không rõ"}
              {d.credential.version !== null ? ` (phiên bản ${d.credential.version})` : ""}
            </Row>
            <Row label="Đăng ký lúc">{formatDateTime(d.createdAt)}</Row>
            {d.revokedAt ? <Row label="Thu hồi lúc">{formatDateTime(d.revokedAt)}</Row> : null}
          </dl>
          <p className="text-xs">
            Giao diện không hiện và không thể lấy lại credential; máy chủ chỉ giữ giá trị băm của
            nó.
          </p>
        </Card>

        <Card icon={<Wifi aria-hidden />} title="Kết nối và firmware">
          <dl>
            <Row label="Liên lạc">
              <Contact device={d} />
            </Row>
            <Row label="Quy tắc trạng thái">
              {d.connectionPolicy
                ? `Đang liên lạc khi lần liên lạc cuối cách ≤ ${d.connectionPolicy.onlineMaxAgeSeconds} giây; không chắc chắn tới ${d.connectionPolicy.offlineAfterSeconds} giây; sau đó mất kết nối. Thiết bị gửi heartbeat mỗi ${d.connectionPolicy.heartbeatIntervalSeconds ?? "?"} giây và hỏi máy chủ vài giây một lần; trang tự làm mới mỗi ${DEVICE_POLL_MS / 1000} giây.`
                : d.onlineWindowSeconds === null
                  ? dash
                  : `Có liên lạc trong ${d.onlineWindowSeconds} giây gần nhất`}
            </Row>
            <Row label="Phiên bản firmware">{d.firmwareVersion ?? "chưa báo"}</Row>
          </dl>
          {hb ? (
            <>
              <h3 className="font-bold">Sức khỏe do thiết bị tự báo lúc {formatDateTime(hb.at)}</h3>
              <dl>
                <Row label="Camera">{component(hb.camera)}</Row>
                <Row label="IMU">{component(hb.imu)}</Row>
                <Row label="Loa">{component(hb.speaker)}</Row>
                <Row label="Wi-Fi">
                  {hb.wifiRssiDbm === null ? "không báo" : `${hb.wifiRssiDbm} dBm`}
                </Row>
                <Row label="Bộ nhớ trống">
                  {hb.freeHeapBytes === null
                    ? "không báo"
                    : `${Math.round(hb.freeHeapBytes / 1024)} KB`}
                </Row>
                {hb.lastError ? <Row label="Lỗi gần nhất">{hb.lastError}</Row> : null}
                <Row label="Lý do khởi động lần này">
                  {hb.resetReason
                    ? (RESET_REASON_LABELS[hb.resetReason] ?? hb.resetReason)
                    : "firmware không báo"}
                </Row>
                <Row label="Nhiệt độ chip">
                  {hb.chipTempC === null
                    ? "firmware không báo"
                    : `${hb.chipTempC.toFixed(1)} °C (lõi ESP32-S3, không phải vỏ hộp)`}
                </Row>
                {hb.capture ? (
                  <>
                    <Row label="Chụp tự động">{`${CAPTURE_MODE_LABELS[hb.capture.mode] ?? hb.capture.mode} · ${CAPTURE_STATE_LABELS[hb.capture.state] ?? hb.capture.state}`}</Row>
                    <Row label="Burst trong lần khởi động này">{captureCountersText(hb.capture)}</Row>
                    {hb.capture.queue ? (
                      <>
                        <Row label="Hàng đợi tải lên">
                          {`${captureQueueText(hb.capture.queue)} · ${captureReconciles(hb.capture) ? "số liệu khớp" : "số liệu KHÔNG khớp"}`}
                        </Row>
                        <Row label="Burst do IMU kích hoạt">{captureEventsText(hb.capture.queue)}</Row>
                        <Row label="Chụp chờ tải lên">{captureBackpressureText(hb.capture.queue)}</Row>
                        <Row label="IMU thô lên máy chủ">{imuUplinkText(hb.capture.queue)}</Row>
                      </>
                    ) : null}
                    <Row label="Chu kỳ / tải lên gần nhất">{`${hb.capture.lastCycleMs} ms / ${hb.capture.lastUploadMs} ms`}</Row>
                  </>
                ) : null}
              </dl>
              <p className="text-xs">Đây là lời tự báo của firmware, máy chủ không kiểm chứng.</p>
            </>
          ) : (
            <p>Chưa nhận heartbeat nào từ thiết bị này.</p>
          )}
        </Card>

        <SpeakerVolumeCard
          device={d}
          caps={caps.state.status === "ready" ? caps.state.data : null}
          onChanged={refresh}
        />

        <Card icon={<ListChecks aria-hidden />} title="Hoạt động gần nhất">
          <dl>
            <Row label="Lần chụp gần nhất">
              {d.lastCapture
                ? `${formatDateTime(d.lastCapture.capturedAt)} · ${GENERIC_STATUS_LABELS[d.lastCapture.status ?? ""] ?? d.lastCapture.status ?? "không rõ"}`
                : "Chưa có"}
            </Row>
            <Row label="Suy luận thành công gần nhất">
              {d.lastInferenceAt ? formatDateTime(d.lastInferenceAt) : "Chưa có"}
            </Row>
            <Row label="Sự kiện gần nhất">
              {d.lastEvent
                ? `${formatDateTime(d.lastEvent.observedAt)} · ${d.lastEvent.eventType ?? "không rõ"}`
                : "Chưa có"}
            </Row>
          </dl>
          {d.lastCapture?.sourceMode === "simulated" || d.lastEvent?.sourceMode === "simulated" ? (
            <SimulatedBadge />
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Link to={`/admin/reports${q}`} className="min-h-11 py-2 font-bold underline">
              Báo cáo theo ngày
            </Link>
            <Link to={`/admin/messages${q}`} className="min-h-11 py-2 font-bold underline">
              Gửi âm thanh
            </Link>
            <Link to={`/admin/reminders${q}`} className="min-h-11 py-2 font-bold underline">
              Nhắc lịch
            </Link>
          </div>
        </Card>

        <RecentCapturesCard state={captures.state} reload={captures.reload} />

        <Card icon={<ListChecks aria-hidden />} title="Lệnh gửi thiết bị">
          <dl>
            {COMMAND_STATUSES.filter(
              (s) => (d.commands.active[s] ?? 0) > 0 || (d.commands.last24h[s] ?? 0) > 0,
            ).map((s) => (
              <Row key={s} label={COMMAND_STATUS_LABELS[s].label}>
                {d.commands.active[s] ?? d.commands.last24h[s]}
                {d.commands.active[s] === undefined ? " (24 giờ qua)" : ""}
              </Row>
            ))}
          </dl>
          {sum(d.commands.active) + sum(d.commands.last24h) === 0 ? (
            <p>Không có lệnh đang mở và không có lệnh nào trong 24 giờ qua.</p>
          ) : null}
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
