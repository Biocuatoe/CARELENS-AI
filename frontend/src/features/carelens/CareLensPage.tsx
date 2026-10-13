import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronRight, Clock, Filter, ScanEye, ShieldCheck } from "lucide-react";
import { useAdapter } from "../../data";
import type { CareEventCategory, EventQuery, Severity, TimeRange } from "../../data/contracts";
import { errorMessage } from "../../data/errors";
import { qk } from "../../data/queryKeys";
import { DemoBadge, TelegramBadge, EmptyState, InlineError, SkeletonRows } from "../../design-system/feedback";
import { Drawer, SoftTabs } from "../../design-system/overlays";
import { buttonClasses, InsetSelect, SoftButton, SoftSurface } from "../../design-system/primitives";
import { formatDateTime, formatSmart, TIMEZONE_LABEL } from "../../lib/time";
import {
  AiObservation,
  AlertStatusLabel,
  PageHeader,
  QueryState,
  SectionTitle,
  SeverityLabel,
  SourceFreshness,
  alertPath,
} from "../common/components";
import { CATEGORY_LABELS, RANGE_LABELS, SEVERITY_LABELS } from "../common/labels";
import { useRecipient } from "../common/recipient";
import { useDemoBadgeLabel } from "../../app/auth";

const RANGES: TimeRange[] = ["24h", "7d", "30d"];

export function CareLensPage() {
  const adapter = useAdapter();
  const { recipient, recipientId } = useRecipient();
  const demoBadgeLabel = useDemoBadgeLabel();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<TimeRange>("7d");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [category, setCategory] = useState<CareEventCategory | "all">("all");
  const source = recipient.sources.find((s) => s.product === "carelens");
  const filters: Omit<EventQuery, "cursor"> = { range, severity, category };
  const filtered = severity !== "all" || category !== "all";

  const events = useInfiniteQuery({
    queryKey: qk.events(recipientId, filters),
    queryFn: ({ pageParam }) => adapter.listEvents(recipientId, { ...filters, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const selectedId = params.get("event");
  const closeDetail = () => {
    const next = new URLSearchParams(params);
    next.delete("event");
    setParams(next, { replace: true });
  };

  const items = events.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title="CareLens"
        eyebrow={<DemoBadge label={demoBadgeLabel} />}
        description="Sự kiện chăm sóc do AI tại hub trong nhà ghi nhận. Giao diện chỉ hiển thị mô tả dạng văn bản, không có hình ảnh hay video."
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SoftSurface as="section" aria-labelledby="timeline-title" className="order-2 lg:order-1">
          <SectionTitle id="timeline-title">Dòng thời gian sự kiện</SectionTitle>

          <form
            role="search"
            aria-label="Lọc sự kiện"
            className="mb-6 flex flex-col gap-4"
            onSubmit={(e) => e.preventDefault()}
          >
            <div className="flex flex-col gap-2">
              <span className="inline-flex items-center gap-2 font-medium">
                <Filter className="size-4 text-accent" aria-hidden />
                Khoảng thời gian
              </span>
              <SoftTabs label="Khoảng thời gian" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: RANGE_LABELS[r] }))} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <InsetSelect label="Mức độ" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | "all")}>
                <option value="all">Tất cả mức độ</option>
                {(Object.keys(SEVERITY_LABELS) as Severity[]).map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABELS[s]}
                  </option>
                ))}
              </InsetSelect>
              <InsetSelect label="Loại sự kiện" value={category} onChange={(e) => setCategory(e.target.value as CareEventCategory | "all")}>
                <option value="all">Tất cả loại</option>
                {(Object.keys(CATEGORY_LABELS) as CareEventCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </InsetSelect>
            </div>
            <p className="text-sm">Thời gian hiển thị theo {TIMEZONE_LABEL}.</p>
          </form>

          {events.isPending ? (
            <SkeletonRows rows={4} />
          ) : events.isError ? (
            <InlineError onRetry={() => void events.refetch()}>{errorMessage(events.error)}</InlineError>
          ) : items.length === 0 ? (
            filtered ? (
              <EmptyState icon={<Filter />} title="Không có sự kiện khớp bộ lọc">
                <p>Thử bỏ bớt điều kiện lọc hoặc mở rộng khoảng thời gian.</p>
                <SoftButton
                  className="mt-4"
                  onClick={() => {
                    setSeverity("all");
                    setCategory("all");
                  }}
                >
                  Bỏ lọc
                </SoftButton>
              </EmptyState>
            ) : (
              <EmptyState icon={<ScanEye />} title={`Không có sự kiện trong ${RANGE_LABELS[range]} qua`}>
                <p>Không có dữ liệu khác với không phát hiện bất thường. Kiểm tra trạng thái hub bên cạnh.</p>
              </EmptyState>
            )
          ) : (
            <>
              <ol className="flex flex-col gap-4" aria-live="polite">
                {items.map((event) => (
                  <li key={event.id} className="flex flex-col gap-3 rounded-control p-4 shadow-inset-sm md:flex-row md:items-center">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityLabel severity={event.severity} />
                        <span className="text-sm font-bold">{CATEGORY_LABELS[event.category]}</span>
                        {event.sourceMode === "telegram" ? (
                          <TelegramBadge />
                        ) : event.sourceMode === "simulated" ? (
                          <DemoBadge label={demoBadgeLabel} />
                        ) : null}
                      </div>
                      <p className="font-medium">{event.summary}</p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-4" aria-hidden />
                          <time dateTime={event.observedAt}>{formatSmart(event.observedAt)}</time>
                        </span>
                        <span>{event.careLevel !== null ? `Điểm AI ${event.careLevel}/10` : "Không có điểm AI"}</span>
                        <span>{event.alertId ? "Đã tạo cảnh báo" : "Không tạo cảnh báo theo quy tắc"}</span>
                      </p>
                    </div>
                    <SoftButton
                      size="sm"
                      className="self-start md:self-center"
                      onClick={() => {
                        const next = new URLSearchParams(params);
                        next.set("event", event.id);
                        setParams(next);
                      }}
                    >
                      Xem chi tiết
                      <ChevronRight className="size-4" aria-hidden />
                    </SoftButton>
                  </li>
                ))}
              </ol>
              {events.hasNextPage ? (
                <SoftButton className="mt-6" loading={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
                  Tải thêm sự kiện
                </SoftButton>
              ) : (
                <p className="mt-6 text-sm">Đã hiển thị tất cả sự kiện trong khoảng thời gian đã chọn.</p>
              )}
            </>
          )}
        </SoftSurface>

        <aside aria-labelledby="hub-status-title" className="order-1 flex flex-col gap-6 lg:order-2">
          <SoftSurface>
            <h2 id="hub-status-title" className="mb-4 text-lg font-bold">
              Trạng thái hub
            </h2>
            {source ? <SourceFreshness source={source} compact /> : <p>Không có thông tin nguồn.</p>}
            <dl className="mt-4 grid gap-1 text-sm">
              <div className="flex flex-wrap gap-x-1.5">
                <dt>Dịch vụ AI tại hub:</dt>
                <dd className="font-medium">Nguồn chưa cung cấp trạng thái</dd>
              </div>
            </dl>
            {source?.state === "local_unavailable" ? (
              <p className="mt-4 text-sm">
                Hub chỉ truy cập được trong mạng gia đình. Ứng dụng không tải lịch sử lên cloud để hiển thị đầy đủ.
              </p>
            ) : null}
          </SoftSurface>
          <SoftSurface padding="sm" className="p-5">
            <p className="flex items-start gap-3 text-sm">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
              Theo thiết kế, hình ảnh được xử lý tại hub trong nhà. Ứng dụng không lưu, không nhận và không hiển thị hình ảnh hay video.
            </p>
          </SoftSurface>
        </aside>
      </div>

      <EventDetailDrawer recipientId={recipientId} eventId={selectedId} onClose={closeDetail} demoBadgeLabel={demoBadgeLabel} />
    </>
  );
}

function EventDetailDrawer({ recipientId, eventId, onClose, demoBadgeLabel }: { recipientId: string; eventId: string | null; onClose: () => void; demoBadgeLabel: string }) {
  const adapter = useAdapter();
  const event = useQuery({
    queryKey: qk.event(recipientId, eventId ?? "none"),
    queryFn: () => adapter.getEvent(recipientId, eventId!),
    enabled: Boolean(eventId),
  });
  const alertQuery = useQuery({
    queryKey: qk.alert(recipientId, event.data?.alertId ?? "none"),
    queryFn: () => adapter.getAlert(recipientId, event.data!.alertId!),
    enabled: Boolean(event.data?.alertId),
  });

  return (
    <Drawer open={Boolean(eventId)} onClose={onClose} title="Chi tiết sự kiện CareLens" description={<DemoBadge label={demoBadgeLabel} />}>
      <QueryState query={event}>
        {(e) => (
          <>
            <AiObservation event={e} />
            <dl className="grid gap-3 rounded-control p-4 shadow-inset-sm sm:grid-cols-2">
              <Fact label="Thời điểm ghi nhận" value={formatDateTime(e.observedAt)} />
              <Fact label="Thời điểm ứng dụng nhận" value={formatDateTime(e.receivedAt)} />
              <Fact label="Mức độ" value={SEVERITY_LABELS[e.severity]} />
              <Fact label="Loại sự kiện" value={CATEGORY_LABELS[e.category]} />
              <Fact label="Phiên bản mô hình" value={e.modelVersion} />
              <Fact label="Phiên bản quy tắc" value={e.ruleVersion} />
              <Fact label="Nguồn" value={e.sourceMode === "simulated" ? "Adapter mô phỏng" : e.deviceId} />
              <Fact label="Mã bản ghi nguồn" value={e.sourceRecordId} />
            </dl>
            <div className="flex flex-col gap-3">
              <h3 className="font-bold">Xử lý của người chăm sóc</h3>
              {e.alertId ? (
                alertQuery.data ? (
                  <div className="flex flex-col gap-3">
                    <AlertStatusLabel status={alertQuery.data.alert.status} />
                    <Link to={alertPath(recipientId, e.alertId)} className={buttonClasses({ variant: "primary", className: "self-start" })}>
                      Mở cảnh báo
                    </Link>
                  </div>
                ) : (
                  <p>Đang tải trạng thái cảnh báo…</p>
                )
              ) : (
                <p>Sự kiện không đạt quy tắc tạo cảnh báo ({e.ruleVersion}). Không có thao tác xử lý.</p>
              )}
            </div>
          </>
        )}
      </QueryState>
    </Drawer>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-sm">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}
