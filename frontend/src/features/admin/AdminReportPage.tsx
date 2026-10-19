import { useMemo, useState } from "react";
import { CalendarDays, Download, ListChecks } from "lucide-react";
import type { ActivityEntry, ActivityReport, AdminDevice } from "../../data/admin/adminClient";
import { EmptyState, InlineError, LoadingState, Notice, StatusLabel } from "../../design-system/feedback";
import { InsetField, InsetSelect, SoftButton } from "../../design-system/primitives";
import { formatDateTime, formatTimeSeconds, localDateKey } from "../../lib/time";
import { Card, SimulatedBadge } from "./AdminParts";
import { DeviceScope } from "./DeviceScope";
import { activityCsv } from "./csv";
import { ENTRY_KIND_LABELS, GENERIC_STATUS_LABELS, SOURCE_LABELS, SOURCE_MODE_LABELS, SOURCE_STATE_LABELS } from "./labels";
import { useAdminLoad } from "./useAdminLoad";

/** Primitive detail fields as "name: value" text. Objects and nulls are skipped: nothing is invented to fill a gap. */
function detailPairs(detail: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(detail).flatMap(([k, v]): Array<[string, string]> => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? [[k, String(v)]] : []));
}

function Coverage({ report }: { report: ActivityReport }) {
  const names = Object.keys(report.sources);
  return (
    <Card icon={<ListChecks aria-hidden />} title="Nguồn dữ liệu của ngày này">
      <p>Mỗi nguồn cho biết nó đầy đủ, bị cắt bớt, chỉ giữ một phần, hay hoàn toàn không được lưu. “Không có dòng nào” chỉ có nghĩa là không có bản ghi khi nguồn ở trạng thái đầy đủ.</p>
      <ul className="flex flex-col gap-3">
        {names.map((name) => {
          const s = report.sources[name]!;
          const info = SOURCE_STATE_LABELS[s.status] ?? { label: s.status, tone: "unknown" as const };
          return (
            <li key={name} className="rounded-control bg-surface p-3 shadow-inset-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">{SOURCE_LABELS[name] ?? name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-sm">{s.status === "not_stored" ? "—" : `${s.count} bản ghi`}</span>
                  <StatusLabel tone={info.tone}>{info.label}</StatusLabel>
                </span>
              </div>
              {s.note ? <p className="mt-1 text-xs">{s.note}</p> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Timeline({ entries }: { entries: ActivityEntry[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {entries.map((e, i) => {
        const pairs = detailPairs(e.detail);
        return (
          <li key={`${e.at}-${e.source}-${e.refId ?? i}`} className="rounded-control bg-surface p-3 shadow-inset-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold">
                  <time dateTime={e.at}>{formatTimeSeconds(e.at)}</time> · {ENTRY_KIND_LABELS[e.kind] ?? e.kind}
                </p>
                <p className="text-xs">
                  {SOURCE_LABELS[e.source] ?? e.source}
                  {e.status ? ` · ${GENERIC_STATUS_LABELS[e.status] ?? e.status}` : ""}
                  {e.refId ? ` · ${e.refId}` : ""}
                </p>
              </div>
              {e.sourceMode === "simulated" || e.sourceMode === "mixed" ? <SimulatedBadge label={SOURCE_MODE_LABELS[e.sourceMode]} /> : null}
            </div>
            {pairs.length > 0 ? (
              <details className="mt-2">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">Chi tiết</summary>
                <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                  {pairs.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2 border-b border-ink/10 py-1">
                      <dt>{k}</dt>
                      <dd className="font-mono break-all">{v}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function download(report: ActivityReport): void {
  const blob = new Blob([activityCsv(report.entries)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `carelens-${report.deviceId}-${report.date}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Report({ device }: { device: AdminDevice }) {
  const today = useMemo(() => localDateKey(), []);
  const [date, setDate] = useState(today);
  const [source, setSource] = useState("");
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const { state, reload } = useAdminLoad((client, token) => (validDate ? client.activity(token, device.deviceId, date) : Promise.reject(new Error("invalid date"))), `activity|${device.deviceId}|${date}`);

  const shown = state.status === "ready" ? state.data.entries.filter((e) => source === "" || e.source === source) : [];
  return (
    <>
      <Card icon={<CalendarDays aria-hidden />} title="Chọn ngày">
        <div className="flex flex-wrap items-end gap-4">
          <InsetField label="Ngày (giờ Việt Nam)" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} wrapperClassName="min-w-48" hint="Ngày lịch theo giờ Việt Nam (UTC+7), từ 00:00 đến hết 23:59." />
          <InsetSelect label="Nguồn" value={source} onChange={(e) => setSource(e.target.value)} wrapperClassName="min-w-56">
            <option value="">Tất cả nguồn</option>
            {state.status === "ready"
              ? Object.keys(state.data.sources)
                  .filter((n) => state.data.sources[n]!.status !== "not_stored")
                  .map((n) => (
                    <option key={n} value={n}>
                      {SOURCE_LABELS[n] ?? n}
                    </option>
                  ))
              : null}
          </InsetSelect>
          <SoftButton variant="secondary" onClick={() => state.status === "ready" && download(state.data)} disabled={state.status !== "ready" || state.data.entries.length === 0}>
            <Download className="size-4" aria-hidden />
            Tải CSV
          </SoftButton>
        </div>
        {device.hasSimulatedRecords ? <SimulatedBadge label="Thiết bị này có dữ liệu mô phỏng trong 7 ngày qua" /> : null}
      </Card>

      {!validDate ? (
        <InlineError title="Ngày không hợp lệ">Chọn một ngày trong lịch.</InlineError>
      ) : state.status === "loading" ? (
        <LoadingState label="Đang tải báo cáo…" />
      ) : state.status === "error" ? (
        <InlineError title="Không tải được báo cáo" onRetry={reload}>
          {state.message} Đây là lỗi tải, không có nghĩa là ngày này không có hoạt động.
        </InlineError>
      ) : (
        <>
          <Notice title={`Ngày ${state.data.date} theo ${state.data.timezone}`}>
            Khoảng thời gian: {formatDateTime(state.data.periodStart)} đến trước {formatDateTime(state.data.periodEnd)} (nửa mở [bắt đầu, kết thúc)). Tạo lúc {formatDateTime(state.data.generatedAt)}.
            {state.data.inFuture ? " Ngày này chưa tới nên chưa thể có bản ghi." : ""}
          </Notice>
          <Coverage report={state.data} />
          <Card icon={<ListChecks aria-hidden />} title={`Dòng thời gian (${shown.length}${source ? ` / ${state.data.entries.length}` : ""})`}>
            {shown.length === 0 ? (
              <EmptyState icon={<ListChecks />} title={source ? "Không có bản ghi của nguồn này" : "Không có bản ghi nào trong ngày này"}>
                <p>Danh sách trống chỉ có nghĩa là các nguồn ở trạng thái “Đầy đủ” không có bản ghi; hãy xem các nguồn bị cắt bớt, chỉ một phần hoặc không được lưu ở trên.</p>
              </EmptyState>
            ) : (
              <Timeline entries={shown} />
            )}
          </Card>
        </>
      )}
    </>
  );
}

export function AdminReportPage() {
  return (
    <DeviceScope title="Báo cáo hoạt động theo ngày" intro="Các bản ghi thật mà máy chủ đã lưu cho thiết bị, theo thứ tự thời gian. Báo cáo không chứa hình ảnh, đường dẫn tới ảnh hay credential.">
      {(device) => <Report device={device} />}
    </DeviceScope>
  );
}
