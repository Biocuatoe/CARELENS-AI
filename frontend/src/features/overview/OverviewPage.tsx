import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { BellOff, Bot, CalendarClock, ChevronRight, Cpu, MailPlus, NotebookPen, Settings2, UserRound } from "lucide-react";
import { useAdapter } from "../../data";
import { qk } from "../../data/queryKeys";
import { DemoBadge, TelegramBadge, Notice, StatusLabel } from "../../design-system/feedback";
import { buttonClasses, IconWell, SoftSurface } from "../../design-system/primitives";
import { formatDate, formatDateTime, formatSmart } from "../../lib/time";
import {
  AiObservation,
  AlertStackRow,
  MeasurementFigure,
  PageHeader,
  ProductTag,
  QueryState,
  SectionTitle,
  SourceFreshness,
} from "../common/components";
import { HISTORY_TYPE_LABELS, QUALITY_LABELS, QUALITY_TONE } from "../common/labels";
import { useRecipient } from "../common/recipient";
import { useDemoBadgeLabel } from "../../app/auth";

export function OverviewPage() {
  const adapter = useAdapter();
  const { recipient, recipientId, can, enrolled } = useRecipient();
  const demoBadgeLabel = useDemoBadgeLabel();
  const overview = useQuery({
    queryKey: qk.overview(recipientId),
    queryFn: () => adapter.getOverview(recipientId),
    enabled: can("data.read"),
  });

  if (!can("data.read")) {
    return (
      <>
        <PageHeader title={recipient.displayName} />
        <Notice title="Không có quyền xem dữ liệu chăm sóc">
          Vai trò của bạn cho phép thao tác với thiết bị nhưng không cho phép xem sự kiện, chỉ số hoặc cảnh báo.{" "}
          <Link to={`/people/${recipientId}/devices`} className="font-bold underline underline-offset-4">
            Xem thiết bị
          </Link>
        </Notice>
      </>
    );
  }

  const setupIncomplete = recipient.enrollments.filter((e) => e.status === "setup_incomplete");

  return (
    <>
      {/* 1. Hồ sơ đang xem và độ mới của từng nguồn */}
      <PageHeader
        title={recipient.displayName}
        eyebrow={recipient.sourceMode === "simulated" ? <DemoBadge label={demoBadgeLabel} /> : null}
        description={<p>{recipient.householdName}</p>}
      />

      <section aria-labelledby="sources-title" className="mb-8">
        <h2 id="sources-title" className="sr-only">
          Trạng thái nguồn dữ liệu
        </h2>
        <div className="grid gap-6 md:grid-cols-2">
          {recipient.sources.map((s) => (
            <SoftSurface key={s.product} padding="sm" className="p-5">
              <SourceFreshness source={s} compact />
            </SoftSurface>
          ))}
        </div>
        {/* Chỉ hiển thị khi có dữ liệu từ Telegram/command */}
        {overview.data?.backendUpdatedAt ? (
          <p className="mt-2 text-sm text-fg-muted">
            Cập nhật từ lệnh gần nhất: {formatDateTime(overview.data.backendUpdatedAt)}
          </p>
        ) : null}
      </section>

      <QueryState query={overview}>
        {(data) => (
          <div className="flex flex-col gap-8">
            {/* 2. Cảnh báo cần xử lý */}
            <SoftSurface as="section" aria-labelledby="open-alerts-title">
              <SectionTitle
                id="open-alerts-title"
                action={
                  <Link to={`/people/${recipientId}/alerts`} className={buttonClasses({ size: "sm" })}>
                    Tất cả cảnh báo
                    <ChevronRight className="size-4" aria-hidden />
                  </Link>
                }
              >
                Cảnh báo cần xử lý
              </SectionTitle>
              {data.openAlerts.length === 0 ? (
                <div className="flex flex-col gap-3 rounded-control p-5 shadow-inset-sm sm:flex-row sm:items-center">
                  <IconWell size="sm">
                    <BellOff />
                  </IconWell>
                  <div>
                    <p className="font-bold">Không có cảnh báo đang mở</p>
                    <p className="text-sm">
                      Điều này không có nghĩa người thân chắc chắn an toàn. Kiểm tra trạng thái kết nối của từng nguồn ở trên.
                    </p>
                  </div>
                </div>
              ) : (
                <ul className="flex flex-col gap-3 sm:gap-4">
                  {data.openAlerts.map((a) => (
                    <AlertStackRow key={a.id} alert={a} recipientId={recipientId} cta={a.status === "open" ? "Xem và xử lý" : "Xem chi tiết"} />
                  ))}
                </ul>
              )}
            </SoftSurface>

            {/* 3. Tóm tắt từng module */}
            <div className="grid gap-8 lg:grid-cols-2">
              {enrolled("carelens") ? (
                <SoftSurface as="section" aria-labelledby="cl-summary">
                  <SectionTitle
                    id="cl-summary"
                    action={
                      <Link to={`/people/${recipientId}/carelens`} className={buttonClasses({ size: "sm" })}>
                        Mở CareLens
                      </Link>
                    }
                  >
                    <ProductTag product="carelens" className="text-lg [&_svg]:size-5" />
                  </SectionTitle>
                  {data.latestEvent ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold">Sự kiện gần nhất · {formatSmart(data.latestEvent.observedAt)}</p>
                        {data.latestEvent.sourceMode === "telegram" ? (
                          <TelegramBadge />
                        ) : data.latestEvent.sourceMode === "simulated" ? (
                          <DemoBadge label={demoBadgeLabel} />
                        ) : null}
                      </div>
                      <AiObservation event={data.latestEvent} />
                    </div>
                  ) : (
                    <p>Chưa nhận sự kiện CareLens nào. Không có dữ liệu khác với không phát hiện bất thường.</p>
                  )}
                </SoftSurface>
              ) : null}

              {enrolled("ecopatch") ? (
                <SoftSurface as="section" aria-labelledby="ep-summary">
                  <SectionTitle
                    id="ep-summary"
                    action={
                      <Link to={`/people/${recipientId}/ecopatch`} className={buttonClasses({ size: "sm" })}>
                        Mở EcoPatch
                      </Link>
                    }
                  >
                    <ProductTag product="ecopatch" className="text-lg [&_svg]:size-5" />
                  </SectionTitle>
                  {data.latestMeasurement ? (
                    <div className="flex flex-col gap-4">
                      <MeasurementFigure
                        label="Nhịp tim gần nhất"
                        value={data.latestMeasurement.value}
                        unit={data.latestMeasurement.unit}
                        observedAt={data.latestMeasurement.observedAt}
                      />
                      <div className="flex flex-wrap gap-2">
                        <StatusLabel tone={QUALITY_TONE[data.latestMeasurement.quality]}>
                          {QUALITY_LABELS[data.latestMeasurement.quality]}
                        </StatusLabel>
                        {data.latestMeasurement.sourceMode === "simulated" ? <DemoBadge label={demoBadgeLabel} /> : null}
                      </div>
                      <p className="text-sm">Giá trị chỉ để minh họa giao diện, không phải kết luận y khoa.</p>
                    </div>
                  ) : (
                    <p>Chưa nhận phép đo EcoPatch nào.</p>
                  )}
                </SoftSurface>
              ) : null}
            </div>

            {/* 4. Việc sắp tới */}
            <SoftSurface as="section" aria-labelledby="tasks-title">
              <SectionTitle id="tasks-title">Việc cần làm</SectionTitle>
              <ul className="flex flex-col gap-4">
                {setupIncomplete.map((e) => (
                  <li key={e.product} className="flex flex-col gap-3 rounded-control p-4 shadow-inset-sm sm:flex-row sm:items-center sm:p-5">
                    <IconWell size="sm">
                      <Settings2 />
                    </IconWell>
                    <p className="flex-1">
                      <span className="font-bold">
                        <ProductTag product={e.product} className="inline-flex" />
                      </span>{" "}
                      chưa hoàn tất thiết lập. Chưa có thiết bị gửi dữ liệu.
                    </p>
                    <Link to={`/people/${recipientId}/devices`} className={buttonClasses({ size: "sm", className: "w-full sm:w-auto" })}>
                      Ghép thiết bị
                    </Link>
                  </li>
                ))}
                {enrolled("ecopatch") ? (
                  <li className="flex flex-col gap-3 rounded-control p-4 shadow-inset-sm sm:flex-row sm:items-center sm:p-5">
                    <IconWell size="sm">
                      <CalendarClock />
                    </IconWell>
                    <p className="flex-1">
                      {data.activePatch ? (
                        data.activePatch.expectedReplaceAt ? (
                          <>
                            <span className="font-bold">Thay miếng dán EcoPatch</span> dự kiến ngày {formatDate(data.activePatch.expectedReplaceAt)}.
                          </>
                        ) : (
                          <>
                            <span className="font-bold">Miếng dán EcoPatch:</span> Chưa đặt lịch thay. Bắt đầu ngày {formatDate(data.activePatch.startedAt)}.
                          </>
                        )
                      ) : (
                        <>
                          <span className="font-bold">Miếng dán EcoPatch:</span> chưa ghi nhận phiên miếng dán đang dùng.
                        </>
                      )}
                    </p>
                    <Link to={`/people/${recipientId}/devices`} className={buttonClasses({ size: "sm", className: "w-full sm:w-auto" })}>
                      Xem thiết bị
                    </Link>
                  </li>
                ) : null}
                {data.pendingInvitationCount ? (
                  <li className="flex flex-col gap-3 rounded-control p-4 shadow-inset-sm sm:flex-row sm:items-center sm:p-5">
                    <IconWell size="sm">
                      <MailPlus />
                    </IconWell>
                    <p className="flex-1">{data.pendingInvitationCount} lời mời truy cập đang chờ chấp nhận.</p>
                    <Link to={`/people/${recipientId}/sharing`} className={buttonClasses({ size: "sm", className: "w-full sm:w-auto" })}>
                      Xem quyền truy cập
                    </Link>
                  </li>
                ) : null}
                {!enrolled("ecopatch") && setupIncomplete.length === 0 && !data.pendingInvitationCount ? (
                  <li className="rounded-control p-4 shadow-inset-sm">Không có việc nào được lên lịch.</li>
                ) : null}
              </ul>
            </SoftSurface>

            {/* 5. Nhật ký gần đây */}
            <SoftSurface as="section" aria-labelledby="recent-title">
              <SectionTitle
                id="recent-title"
                action={
                  <Link to={`/people/${recipientId}/history`} className={buttonClasses({ size: "sm" })}>
                    Xem lịch sử
                  </Link>
                }
              >
                Hoạt động gần đây
              </SectionTitle>
              {data.recent.length === 0 ? (
                <p>Chưa có hoạt động nào.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {data.recent.map((item) => (
                    <li key={item.id} className="flex gap-3 rounded-control p-4 shadow-inset-sm">
                      <IconWell size="sm">
                        {item.type === "note" ? <NotebookPen /> : item.origin === "ai" ? <Bot /> : item.origin === "human" ? <UserRound /> : <Cpu />}
                      </IconWell>
                      <div className="min-w-0">
                        <p className="text-sm font-bold">
                          {HISTORY_TYPE_LABELS[item.type]} · <time dateTime={item.at}>{formatDateTime(item.at)}</time>
                          {item.actorName ? ` · ${item.actorName}` : ""}
                          {item.origin === "ai" ? " · Nhận định AI chưa xác nhận" : ""}
                        </p>
                        <p className="font-medium">{item.title}</p>
                        {item.detail ? <p className="text-sm">{item.detail}</p> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </SoftSurface>
          </div>
        )}
      </QueryState>
    </>
  );
}
