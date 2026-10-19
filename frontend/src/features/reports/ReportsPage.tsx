import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet } from "lucide-react";
import { useAdapter } from "../../data";
import type { ExportJob, Product } from "../../data/contracts";
import { errorMessage, isApiError } from "../../data/errors";
import { qk } from "../../data/queryKeys";
import { DemoBadge, InlineError, Notice, StatusLabel } from "../../design-system/feedback";
import { Choice, IconWell, InsetField, SoftButton, SoftSurface } from "../../design-system/primitives";
import { formatDate, formatDateTime, fromDateInputValue, TIMEZONE_LABEL, toDateInputValue } from "../../lib/time";
import { PageHeader, QueryState, SectionTitle } from "../common/components";
import { OUTCOME_LABELS, PRODUCT_LABELS } from "../common/labels";
import { useRecipient } from "../common/recipient";
import { useDemoBadgeLabel } from "../../app/auth";

const DAY = 86_400_000;

export function ReportsPage() {
  const adapter = useAdapter();
  const { recipient, recipientId, can } = useRecipient();
  const demoBadgeLabel = useDemoBadgeLabel();
  const enrolled = recipient.enrollments.map((e) => e.product);
  const [fromDate, setFromDate] = useState(() => toDateInputValue(new Date(Date.now() - 6 * DAY).toISOString()));
  const [toDate, setToDate] = useState(() => toDateInputValue(new Date().toISOString()));
  const [products, setProducts] = useState<Product[]>(enrolled);
  const input = { from: fromDateInputValue(fromDate), to: fromDateInputValue(toDate, true), products };
  const invalidRange = !fromDate || !toDate || input.from >= input.to;

  const report = useQuery({
    queryKey: qk.report(recipientId, input),
    queryFn: () => adapter.getReport(recipientId, input),
    enabled: !invalidRange && products.length > 0,
    placeholderData: (prev) => prev,
  });

  const toggle = (p: Product) => setProducts((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]));

  return (
    <>
      <PageHeader title="Báo cáo" eyebrow={<DemoBadge label={demoBadgeLabel} />} description="Tổng hợp theo kỳ. Mọi số liệu ghi rõ mẫu số và phần dữ liệu còn thiếu." />

      <div className="flex flex-col gap-8">
        <SoftSurface as="section" aria-labelledby="scope-title">
          <SectionTitle id="scope-title">Phạm vi báo cáo</SectionTitle>
          <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
            <div className="grid gap-4 sm:grid-cols-2">
              <InsetField label="Từ ngày" type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} />
              <InsetField
                label="Đến ngày"
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => setToDate(e.target.value)}
                error={invalidRange ? "Ngày bắt đầu phải trước ngày kết thúc." : undefined}
              />
            </div>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 font-medium">Giải pháp đưa vào báo cáo</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {enrolled.map((p) => (
                  <Choice key={p} label={PRODUCT_LABELS[p]} checked={products.includes(p)} onChange={() => toggle(p)} />
                ))}
              </div>
              {products.length === 0 ? <p className="text-sm font-bold">Chọn ít nhất một giải pháp.</p> : null}
            </fieldset>
            <p className="text-sm">Múi giờ: {TIMEZONE_LABEL}</p>
          </form>
        </SoftSurface>

        {products.length > 0 && !invalidRange ? (
          <SoftSurface as="section" aria-labelledby="summary-title" aria-busy={report.isFetching}>
            <SectionTitle id="summary-title">Tổng hợp</SectionTitle>
            <QueryState query={report}>
              {(r) => (
                <div className="flex flex-col gap-6">
                  <p>
                    Từ {formatDate(r.from)} đến {formatDate(r.to)} · {r.products.map((p) => PRODUCT_LABELS[p]).join(", ")} · {r.timezone}
                  </p>
                  <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Stat label="Cảnh báo tạo trong kỳ" value={r.alerts.created} />
                    <Stat label="Cảnh báo tạo trong kỳ còn chưa đóng" value={r.alerts.stillOpen} />
                    <Stat label="Cảnh báo đã đóng trong kỳ" value={r.alerts.resolved} />
                    {r.careEvents !== null ? <Stat label="Sự kiện CareLens ghi nhận" value={r.careEvents} /> : null}
                    {r.patchChanges !== null ? <Stat label="Lần bắt đầu miếng dán mới" value={r.patchChanges} /> : null}
                    {r.measurements ? (
                      <Stat
                        label="Phép đo EcoPatch"
                        value={r.measurements.count}
                        note={`${r.measurements.gapCount} khoảng mất dữ liệu dài hơn ${r.measurements.gapThresholdMinutes} phút`}
                      />
                    ) : null}
                  </dl>
                  <div className="rounded-control p-4 shadow-inset-sm">
                    <h3 className="mb-3 font-bold">Kết quả kiểm tra của người chăm sóc</h3>
                    {r.alerts.resolved === 0 ? (
                      <p>Không có cảnh báo nào được đóng trong kỳ.</p>
                    ) : (
                      <ul className="grid gap-2 sm:grid-cols-3">
                        {(Object.keys(OUTCOME_LABELS) as Array<keyof typeof OUTCOME_LABELS>).map((o) => (
                          <li key={o}>
                            <span className="font-bold">{OUTCOME_LABELS[o]}:</span> {r.alerts.outcomes[o]} / {r.alerts.resolved} cảnh báo đã đóng
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <Notice title="Cách đọc số liệu">
                    Tỷ lệ chỉ tính trên các cảnh báo đã được người chăm sóc đóng. Báo cáo không tính độ nhạy hay độ chính xác của AI vì không có dữ liệu đối chiếu độc lập về các sự kiện bị bỏ sót. Không có điểm sức khỏe tổng hợp.
                  </Notice>
                </div>
              )}
            </QueryState>
          </SoftSurface>
        ) : null}

        <SoftSurface as="section" aria-labelledby="export-title">
          <SectionTitle id="export-title">Xuất dữ liệu CSV</SectionTitle>
          {can("exports.create") ? (
            <ExportPanel key={`${input.from}|${input.to}|${products.join(",")}`} from={input.from} to={input.to} products={products} disabled={invalidRange || products.length === 0} />
          ) : (
            <Notice>Bạn không có quyền xuất dữ liệu của hồ sơ này.</Notice>
          )}
        </SoftSurface>
      </div>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-control p-4 shadow-inset-sm">
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="font-display text-3xl font-extrabold">{value}</dd>
      {note ? <dd className="text-sm">{note}</dd> : null}
    </div>
  );
}

const EXPORT_STATUS = {
  pending: { label: "Đang tạo", tone: "neutral" },
  ready: { label: "Sẵn sàng tải", tone: "success" },
  failed: { label: "Không tạo được", tone: "urgent" },
} as const;

function ExportPanel({ from, to, products, disabled }: { from: string; to: string; products: Product[]; disabled: boolean }) {
  const adapter = useAdapter();
  const { recipientId } = useRecipient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => adapter.createExport(recipientId, { from, to, products, idempotencyKey: crypto.randomUUID() }),
    onSuccess: (job) => {
      setJobId(job.id);
      setDownloadMessage(null);
    },
  });

  const job = useQuery({
    queryKey: qk.exportJob(recipientId, jobId ?? "none"),
    queryFn: () => adapter.getExport(recipientId, jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 700 : false),
  });

  const download = useMutation({
    mutationFn: (exportJob: ExportJob) => adapter.downloadExport(recipientId, exportJob.id),
    onSuccess: ({ filename, content }) => {
      const blob = new Blob([String.fromCharCode(0xfeff), content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setDownloadMessage(`Đã tải ${filename}.`);
    },
  });

  const current = job.data ?? create.data;

  return (
    <div className="flex flex-col gap-4">
      <p>
        Bản xuất gồm sự kiện, cảnh báo và phép đo trong phạm vi đã chọn. Mỗi dòng giữ nguồn, đơn vị, thời điểm UTC và nhãn dữ liệu mô phỏng. Quyền được kiểm tra lại khi tải.
      </p>
      <SoftButton variant="primary" className="self-start" loading={create.isPending} disabled={disabled} onClick={() => create.mutate()}>
        <FileSpreadsheet className="size-5" aria-hidden />
        Tạo bản xuất CSV
      </SoftButton>
      {create.isError ? (
        <InlineError title="Không tạo được bản xuất">
          {isApiError(create.error) && create.error.fieldErrors ? Object.values(create.error.fieldErrors).join(" ") : errorMessage(create.error)}
        </InlineError>
      ) : null}
      {current ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-3 rounded-control p-4 shadow-inset-sm sm:flex-row sm:items-center">
          <IconWell size="sm">
            <FileSpreadsheet />
          </IconWell>
          <div className="min-w-0 flex-1">
            <p className="font-medium break-all">{current.filename}</p>
            <p className="text-sm">
              Tạo lúc {formatDateTime(current.createdAt)} · {current.products.map((p) => PRODUCT_LABELS[p]).join(", ")}
            </p>
            {current.failureReason ? <p className="text-sm font-bold">{current.failureReason}</p> : null}
            {downloadMessage ? <p className="text-sm font-medium">{downloadMessage}</p> : null}
          </div>
          <StatusLabel tone={EXPORT_STATUS[current.status].tone}>{EXPORT_STATUS[current.status].label}</StatusLabel>
          {current.status === "ready" ? (
            <SoftButton size="sm" loading={download.isPending} onClick={() => download.mutate(current)}>
              <Download className="size-4" aria-hidden />
              Tải xuống
            </SoftButton>
          ) : null}
        </div>
      ) : null}
      {download.isError ? <InlineError title="Không tải được">{errorMessage(download.error)}</InlineError> : null}
    </div>
  );
}
