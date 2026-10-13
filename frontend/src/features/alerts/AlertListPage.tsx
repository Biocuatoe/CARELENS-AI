import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BellOff, ChevronRight, Filter, RefreshCw } from "lucide-react";
import { useAdapter } from "../../data";
import type { AlertQuery, AlertStatus, Product, TimeRange } from "../../data/contracts";
import { errorMessage } from "../../data/errors";
import { qk } from "../../data/queryKeys";
import { markAlertListSeen, usePendingAlertChanges } from "../../data/stream";
import { DemoBadge, EmptyState, InlineError, Notice, SkeletonRows } from "../../design-system/feedback";
import { buttonClasses, InsetSelect, SoftButton, SoftSurface } from "../../design-system/primitives";
import { formatDateTime, TIMEZONE_LABEL } from "../../lib/time";
import { AlertStackRow, AlertStatusLabel, PageHeader, ProductTag, SeverityLabel, alertPath } from "../common/components";
import { ALERT_STATUS_LABELS, PRODUCT_LABELS, RANGE_LABELS } from "../common/labels";
import { useRecipient } from "../common/recipient";
import { useDemoBadgeLabel } from "../../app/auth";

const DEFAULT_FILTERS: Omit<AlertQuery, "cursor"> = { product: "all", status: "active", range: "30d", assignee: "all" };

export function AlertListPage() {
  const adapter = useAdapter();
  const { recipient, recipientId } = useRecipient();
  const demoBadgeLabel = useDemoBadgeLabel();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const pending = usePendingAlertChanges(recipientId);
  const enrolledProducts = recipient.enrollments.map((e) => e.product);

  const alerts = useInfiniteQuery({
    queryKey: qk.alerts(recipientId, filters),
    queryFn: ({ pageParam }) => adapter.listAlerts(recipientId, { ...filters, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Không tự refetch khi có thay đổi: tránh đổi thứ tự hàng người dùng đang thao tác.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    markAlertListSeen(recipientId);
  }, [recipientId]);

  const items = alerts.data?.pages.flatMap((p) => p.items) ?? [];
  const isFiltered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);
  const update = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => setFilters((f) => ({ ...f, [key]: value }));

  const reload = () => {
    markAlertListSeen(recipientId);
    void alerts.refetch();
  };

  return (
    <>
      <PageHeader title="Cảnh báo" eyebrow={<DemoBadge label={demoBadgeLabel} />} description="Cảnh báo được tạo từ sự kiện theo quy tắc có phiên bản. Tiếp nhận không đồng nghĩa đã xử lý hoặc AI đúng." />

      <SoftSurface as="section" aria-labelledby="alert-list-title">
        <h2 id="alert-list-title" className="sr-only">
          Danh sách cảnh báo
        </h2>
        <form role="search" aria-label="Lọc cảnh báo" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" onSubmit={(e) => e.preventDefault()}>
          <InsetSelect label="Nguồn" value={filters.product} onChange={(e) => update("product", e.target.value as Product | "all")}>
            <option value="all">Tất cả nguồn</option>
            {enrolledProducts.map((p) => (
              <option key={p} value={p}>
                {PRODUCT_LABELS[p]}
              </option>
            ))}
          </InsetSelect>
          <InsetSelect label="Trạng thái xử lý" value={filters.status} onChange={(e) => update("status", e.target.value as AlertQuery["status"])}>
            <option value="active">Chưa đóng</option>
            {(Object.keys(ALERT_STATUS_LABELS) as AlertStatus[]).map((s) => (
              <option key={s} value={s}>
                {ALERT_STATUS_LABELS[s]}
              </option>
            ))}
            <option value="all">Tất cả</option>
          </InsetSelect>
          <InsetSelect label="Thời gian" value={filters.range} onChange={(e) => update("range", e.target.value as TimeRange)}>
            {(["24h", "7d", "30d"] as TimeRange[]).map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]} qua
              </option>
            ))}
          </InsetSelect>
          <InsetSelect label="Người phụ trách" value={filters.assignee} onChange={(e) => update("assignee", e.target.value as AlertQuery["assignee"])}>
            <option value="all">Tất cả</option>
            <option value="me">Tôi phụ trách</option>
            <option value="unassigned">Chưa có người phụ trách</option>
          </InsetSelect>
        </form>

        <div role="status" aria-live="polite">
          {pending > 0 ? (
            <Notice className="mb-6" title="Có cập nhật cảnh báo mới">
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Danh sách chưa tự thay đổi để không làm xáo trộn dòng bạn đang xem.</span>
                <SoftButton size="sm" onClick={reload}>
                  <RefreshCw className="size-4" aria-hidden />
                  Tải lại danh sách
                </SoftButton>
              </div>
            </Notice>
          ) : null}
        </div>

        {alerts.isPending ? (
          <SkeletonRows rows={4} />
        ) : alerts.isError ? (
          <InlineError onRetry={() => void alerts.refetch()}>{errorMessage(alerts.error)}</InlineError>
        ) : items.length === 0 ? (
          isFiltered ? (
            <EmptyState icon={<Filter />} title="Không có cảnh báo khớp bộ lọc">
              <SoftButton className="mt-2" onClick={() => setFilters(DEFAULT_FILTERS)}>
                Đặt lại bộ lọc
              </SoftButton>
            </EmptyState>
          ) : (
            <EmptyState icon={<BellOff />} title="Không có cảnh báo đang mở">
              <p>Không có cảnh báo không có nghĩa là người thân chắc chắn an toàn. Kiểm tra kết nối nguồn ở trang Tổng quan.</p>
            </EmptyState>
          )
        ) : (
          <>
            {/* Bảng từ 1280px (sidebar chiếm chỗ ở 1024px) */}
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full border-separate border-spacing-y-3 text-left">
                <caption className="sr-only">Danh sách cảnh báo, thời gian theo {TIMEZONE_LABEL}</caption>
                <thead>
                  <tr className="text-sm">
                    <th scope="col" className="px-4 font-bold">Thời điểm</th>
                    <th scope="col" className="px-4 font-bold">Nguồn</th>
                    <th scope="col" className="px-4 font-bold">Mô tả</th>
                    <th scope="col" className="px-4 font-bold">Mức độ</th>
                    <th scope="col" className="px-4 font-bold">Trạng thái</th>
                    <th scope="col" className="px-4 font-bold">Phụ trách</th>
                    <th scope="col" className="px-4 font-bold">
                      <span className="sr-only">Thao tác</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} className="shadow-inset-sm [&>td:first-child]:rounded-l-control [&>td:last-child]:rounded-r-control">
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        <time dateTime={a.observedAt}>{formatDateTime(a.observedAt)}</time>
                      </td>
                      <td className="px-4 py-3">
                        <ProductTag product={a.product} />
                      </td>
                      <td className="px-4 py-3 font-medium">{a.summary}</td>
                      <td className="px-4 py-3">
                        <SeverityLabel severity={a.severity} />
                      </td>
                      <td className="px-4 py-3">
                        <AlertStatusLabel status={a.status} />
                      </td>
                      <td className="px-4 py-3 text-sm">{a.assigneeName ?? "Chưa có"}</td>
                      <td className="px-4 py-3 text-right">
                        <Link to={alertPath(recipientId, a.id)} className={buttonClasses({ variant: a.status === "open" ? "primary" : "secondary", size: "sm" })}>
                          Xem chi tiết
                          <span className="sr-only">: {a.summary}</span>
                          <ChevronRight className="size-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Hàng xếp chồng dưới 1280px */}
            <ul className="flex flex-col gap-4 xl:hidden">
              {items.map((a) => (
                <AlertStackRow key={a.id} alert={a} recipientId={recipientId} />
              ))}
            </ul>
            {alerts.hasNextPage ? (
              <SoftButton className="mt-6" loading={alerts.isFetchingNextPage} onClick={() => void alerts.fetchNextPage()}>
                Tải thêm cảnh báo
              </SoftButton>
            ) : (
              <p className="mt-6 text-sm">Đã hiển thị tất cả cảnh báo khớp bộ lọc.</p>
            )}
          </>
        )}
      </SoftSurface>
    </>
  );
}
