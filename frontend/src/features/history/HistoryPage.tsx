import { useState } from "react";
import { Link } from "react-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Cpu, Filter, History as HistoryIcon, NotebookPen, Sticker, UserRound } from "lucide-react";
import { useAdapter } from "../../data";
import type { HistoryItem, HistoryItemType, HistoryQuery, TimeRange } from "../../data/contracts";
import { errorMessage, isApiError } from "../../data/errors";
import { qk } from "../../data/queryKeys";
import { DemoBadge, EmptyState, InlineError, Notice, SkeletonRows } from "../../design-system/feedback";
import { SoftTabs } from "../../design-system/overlays";
import { IconWell, InsetSelect, InsetTextarea, SoftButton, SoftSurface } from "../../design-system/primitives";
import { formatDateTime, TIMEZONE_LABEL } from "../../lib/time";
import { PageHeader, ProductTag, SectionTitle, alertPath } from "../common/components";
import { HISTORY_TYPE_LABELS, RANGE_LABELS } from "../common/labels";
import { useRecipient } from "../common/recipient";
import { useDemoBadgeLabel } from "../../app/auth";

const ORIGIN_LABEL = { ai: "Nhận định AI · chưa xác nhận", human: "Người dùng ghi", system: "Hệ thống ghi" } as const;

function ItemIcon({ item }: { item: HistoryItem }) {
  if (item.type === "note") return <NotebookPen />;
  if (item.type === "patch_change") return <Sticker />;
  if (item.type === "device_assignment") return <Cpu />;
  if (item.origin === "ai") return <Bot />;
  return <UserRound />;
}

export function HistoryPage() {
  const adapter = useAdapter();
  const { recipientId, can } = useRecipient();
  const demoBadgeLabel = useDemoBadgeLabel();
  const [type, setType] = useState<HistoryItemType | "all">("all");
  const [range, setRange] = useState<TimeRange>("7d");
  const filters: Omit<HistoryQuery, "cursor"> = { type, range };

  const history = useInfiniteQuery({
    queryKey: qk.history(recipientId, filters),
    queryFn: ({ pageParam }) => adapter.listHistory(recipientId, { ...filters, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title="Lịch sử"
        eyebrow={<DemoBadge label={demoBadgeLabel} />}
        description="Dòng thời gian chung cho sự kiện, xử lý cảnh báo, ghi chú và thay miếng dán. Ghi chú của con người được tách khỏi mô tả AI."
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <SoftSurface as="section" aria-labelledby="timeline-title" className="order-2 lg:order-1">
          <SectionTitle id="timeline-title">Dòng thời gian</SectionTitle>
          <form role="search" aria-label="Lọc lịch sử" className="mb-6 flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
            <SoftTabs label="Khoảng thời gian" value={range} onChange={setRange} options={(["24h", "7d", "30d"] as TimeRange[]).map((r) => ({ value: r, label: RANGE_LABELS[r] }))} />
            <InsetSelect label="Loại mục" value={type} onChange={(e) => setType(e.target.value as HistoryItemType | "all")} wrapperClassName="sm:max-w-xs">
              <option value="all">Tất cả</option>
              {(Object.keys(HISTORY_TYPE_LABELS) as HistoryItemType[]).map((t) => (
                <option key={t} value={t}>
                  {HISTORY_TYPE_LABELS[t]}
                </option>
              ))}
            </InsetSelect>
            <p className="text-sm">Thời gian theo {TIMEZONE_LABEL}.</p>
          </form>

          {history.isPending ? (
            <SkeletonRows rows={5} />
          ) : history.isError ? (
            <InlineError onRetry={() => void history.refetch()}>{errorMessage(history.error)}</InlineError>
          ) : items.length === 0 ? (
            type !== "all" ? (
              <EmptyState icon={<Filter />} title="Không có mục khớp bộ lọc">
                <SoftButton className="mt-2" onClick={() => setType("all")}>
                  Bỏ lọc
                </SoftButton>
              </EmptyState>
            ) : (
              <EmptyState icon={<HistoryIcon />} title={`Không có hoạt động trong ${RANGE_LABELS[range]} qua`} />
            )
          ) : (
            <>
              <ol className="flex flex-col gap-3">
                {items.map((item) => (
                  <li key={item.id} className="flex gap-3 rounded-control p-4 shadow-inset-sm">
                    <IconWell size="sm">
                      <ItemIcon item={item} />
                    </IconWell>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 text-sm font-bold">
                        <span>{HISTORY_TYPE_LABELS[item.type]}</span>
                        <span aria-hidden>·</span>
                        <time dateTime={item.at}>{formatDateTime(item.at)}</time>
                        {item.product ? (
                          <>
                            <span aria-hidden>·</span>
                            <ProductTag product={item.product} />
                          </>
                        ) : null}
                      </p>
                      <p className="text-sm">
                        {ORIGIN_LABEL[item.origin]}
                        {item.actorName ? ` · ${item.actorName}` : ""}
                      </p>
                      <p className="mt-1 font-medium">{item.title}</p>
                      {item.detail ? <p className="whitespace-pre-line">{item.detail}</p> : null}
                      {item.link?.kind === "alert" ? (
                        <Link to={alertPath(recipientId, item.link.id)} className="mt-2 inline-flex min-h-11 items-center font-bold underline underline-offset-4">
                          Mở cảnh báo liên quan
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
              {history.hasNextPage ? (
                <SoftButton className="mt-6" loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
                  Tải thêm
                </SoftButton>
              ) : null}
            </>
          )}
        </SoftSurface>

        <div className="order-1 lg:order-2">{can("notes.write") ? <NoteForm /> : <Notice>Bạn không có quyền thêm ghi chú chăm sóc.</Notice>}</div>
      </div>
    </>
  );
}

function NoteForm() {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const { recipientId } = useRecipient();
  const [body, setBody] = useState("");
  const [localError, setLocalError] = useState<string | undefined>();
  const [saved, setSaved] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (text: string) => adapter.addNote(recipientId, text),
    onMutate: () => setSaved(null),
    onSuccess: (note) => {
      setBody("");
      setSaved(`Đã lưu ghi chú của ${note.authorName} lúc ${formatDateTime(note.createdAt)}.`);
      void queryClient.invalidateQueries({ queryKey: qk.history(recipientId) });
      void queryClient.invalidateQueries({ queryKey: qk.overview(recipientId) });
    },
  });
  const serverError = isApiError(mutation.error) ? mutation.error.fieldErrors?.body : undefined;

  return (
    <SoftSurface as="section" aria-labelledby="note-title" className="lg:sticky lg:top-28">
      <SectionTitle id="note-title">Thêm ghi chú chăm sóc</SectionTitle>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim().length < 2) {
            setLocalError("Ghi chú cần ít nhất 2 ký tự.");
            return;
          }
          setLocalError(undefined);
          mutation.mutate(body);
        }}
      >
        <InsetTextarea
          label="Nội dung ghi chú"
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
          error={localError ?? serverError}
          hint="Ghi chú là thông tin do con người nhập, hiển thị kèm tên người ghi và thời điểm."
        />
        <div role="status" aria-live="polite" className="empty:hidden">
          {saved ? <Notice>{saved}</Notice> : null}
        </div>
        {mutation.isError && !serverError ? <InlineError title="Chưa lưu được ghi chú">{errorMessage(mutation.error)}</InlineError> : null}
        <SoftButton type="submit" variant="primary" loading={mutation.isPending}>
          Lưu ghi chú
        </SoftButton>
      </form>
    </SoftSurface>
  );
}
