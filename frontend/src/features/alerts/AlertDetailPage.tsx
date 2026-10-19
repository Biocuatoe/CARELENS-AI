import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BellRing, Bot, CircleCheck, Clock, Hand, Play, UserRound } from "lucide-react";
import { useAdapter } from "../../data";
import type { AlertActionInput, AlertDetail, ReviewOutcome } from "../../data/contracts";
import { errorMessage, isApiError } from "../../data/errors";
import { qk } from "../../data/queryKeys";
import { DemoBadge, InlineError, Notice, StatusLabel } from "../../design-system/feedback";
import { buttonClasses, Choice, IconWell, InsetTextarea, SoftButton, SoftSurface } from "../../design-system/primitives";
import { formatDateTime, formatRelative } from "../../lib/time";
import {
  AiObservation,
  AlertStatusLabel,
  PageHeader,
  ProductTag,
  QueryState,
  SectionTitle,
  SeverityLabel,
} from "../common/components";
import { ACTION_LABELS, ALERT_STATUS_LABELS, CONNECTION_LABELS, OUTCOME_LABELS } from "../common/labels";
import { useRecipient } from "../common/recipient";
import { useDemoBadgeLabel } from "../../app/auth";

export function AlertDetailPage() {
  const { alertId = "" } = useParams();
  const adapter = useAdapter();
  const { recipientId, can } = useRecipient();
  const demoBadgeLabel = useDemoBadgeLabel();
  const detail = useQuery({ queryKey: qk.alert(recipientId, alertId), queryFn: () => adapter.getAlert(recipientId, alertId) });

  return (
    <>
      <Link to={`/people/${recipientId}/alerts`} className={buttonClasses({ size: "sm", className: "mb-6" })}>
        <ArrowLeft className="size-4" aria-hidden />
        Danh sách cảnh báo
      </Link>
      <QueryState query={detail}>
        {(data) => (
          <>
            <PageHeader
              title={data.alert.summary}
              eyebrow={
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityLabel severity={data.alert.severity} />
                  <AlertStatusLabel status={data.alert.status} />
                  {data.alert.sourceMode === "simulated" ? <DemoBadge label={demoBadgeLabel} /> : null}
                </div>
              }
            />
            {/* Mobile: thông tin → xử lý → kết quả → nhật ký. Desktop: cột phải cố định cho xử lý. */}
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[auto_auto_1fr]">
              <div className="lg:col-start-1 lg:row-start-1">
                <FactsPanel data={data} />
              </div>
              <div className="lg:sticky lg:top-28 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
                {can("alerts.act") ? (
                  <ProcessingPanel data={data} recipientId={recipientId} alertId={alertId} />
                ) : (
                  <SoftSurface>
                    <Notice title="Chỉ xem">Bạn có quyền xem cảnh báo này nhưng không có quyền tiếp nhận hoặc xử lý.</Notice>
                  </SoftSurface>
                )}
              </div>
              <div className="lg:col-start-1 lg:row-start-2">
                <OutcomePanel data={data} />
              </div>
              <div className="lg:col-start-1 lg:row-start-3">
                <AuditPanel data={data} />
              </div>
            </div>
          </>
        )}
      </QueryState>
    </>
  );
}

function FactsPanel({ data }: { data: AlertDetail }) {
  const { alert, event, device } = data;
  return (
    <SoftSurface as="section" aria-labelledby="facts-title">
      <SectionTitle id="facts-title">Thông tin sự kiện</SectionTitle>
      <dl className="mb-6 grid gap-4 sm:grid-cols-2">
        <Fact label="Nguồn" value={<ProductTag product={alert.product} />} />
        <Fact label="Thời điểm ghi nhận" value={`${formatDateTime(alert.observedAt)} (${formatRelative(alert.observedAt)})`} />
        <Fact label="Thời điểm tạo cảnh báo" value={formatDateTime(alert.createdAt)} />
        <Fact label="Quy tắc cảnh báo" value={`${alert.ruleVersion} · quy tắc demo, không phải ngưỡng y khoa`} />
        <Fact
          label="Thiết bị"
          value={device ? `${device.label} · ${device.serialMasked}` : "Không có thông tin thiết bị"}
        />
        <Fact
          label="Kết nối thiết bị hiện tại"
          value={device ? `${CONNECTION_LABELS[device.connection]} · tín hiệu gần nhất ${formatRelative(device.lastSeenAt)}` : "Không có dữ liệu"}
        />
      </dl>
      {alert.kind === "care_event" ? (
        <>
          <h3 className="mb-3 inline-flex items-center gap-2 font-bold">
            <Bot className="size-5 text-accent" aria-hidden />
            Nhận định gốc của AI
          </h3>
          <AiObservation event={event} summary={alert.summary} />
        </>
      ) : (
        <Notice title="Cảnh báo trạng thái thiết bị">
          Cảnh báo này sinh từ trạng thái kết nối hoặc tín hiệu của thiết bị, không phải nhận định sức khỏe.
        </Notice>
      )}
    </SoftSurface>
  );
}

function OutcomePanel({ data }: { data: AlertDetail }) {
  const { alert } = data;
  return (
    <SoftSurface as="section" aria-labelledby="outcome-title">
      <SectionTitle id="outcome-title">Kết quả kiểm tra của người chăm sóc</SectionTitle>
      {alert.status === "resolved" && alert.reviewOutcome ? (
        <dl className="grid gap-4 rounded-control p-4 shadow-inset-sm sm:grid-cols-2">
          <Fact label="Kết quả" value={<StatusLabel tone="neutral">{OUTCOME_LABELS[alert.reviewOutcome]}</StatusLabel>} />
          <Fact label="Người đóng" value={`${alert.resolvedByName ?? "Không rõ"} · ${formatDateTime(alert.resolvedAt)}`} />
          <div className="sm:col-span-2">
            <dt className="text-sm">Ghi chú xử lý</dt>
            <dd className="font-medium whitespace-pre-line">{alert.resolutionNote}</dd>
          </div>
        </dl>
      ) : (
        <p className="rounded-control p-4 font-medium shadow-inset-sm">
          {alert.status === "open"
            ? "Chưa tiếp nhận · Chưa có kết quả kiểm tra"
            : `${ALERT_STATUS_LABELS[alert.status]}${alert.assigneeName ? ` bởi ${alert.assigneeName}` : ""} · Chưa có kết quả kiểm tra`}
        </p>
      )}
    </SoftSurface>
  );
}

const ACTION_ICONS = {
  acknowledge: <Hand />,
  start: <Play />,
  resolve: <CircleCheck />,
  escalate: <BellRing />,
  reminder: <Clock />,
};

function AuditPanel({ data }: { data: AlertDetail }) {
  return (
    <SoftSurface as="section" aria-labelledby="audit-title">
      <SectionTitle id="audit-title">Nhật ký xử lý</SectionTitle>
      {data.actions.length === 0 ? (
        <p>Chưa có thao tác nào.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {data.actions.map((a) => (
            <li key={a.id} className="flex gap-3 rounded-control p-4 shadow-inset-sm">
              <IconWell size="sm">
                {ACTION_ICONS[a.type]}
              </IconWell>
              <div className="min-w-0">
                <p className="font-bold">
                  {ACTION_LABELS[a.type]}
                  {a.outcome ? ` · ${OUTCOME_LABELS[a.outcome]}` : ""}
                </p>
                <p className="text-sm">
                  {a.actorKind === "system" ? "Hệ thống" : a.actorName} · <time dateTime={a.at}>{formatDateTime(a.at)}</time>
                </p>
                {a.note ? <p className="mt-1 whitespace-pre-line">{a.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </SoftSurface>
  );
}

function ProcessingPanel({ data, recipientId, alertId }: { data: AlertDetail; recipientId: string; alertId: string }) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null);
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const { alert } = data;

  const mutation = useMutation({
    mutationFn: (input: AlertActionInput) => adapter.actOnAlert(recipientId, alertId, input),
    onMutate: () => {
      setConflict(null);
      setSuccessMessage(null);
      setFieldErrors({});
    },
    onSuccess: (next, input) => {
      queryClient.setQueryData(qk.alert(recipientId, alertId), next);
      void queryClient.invalidateQueries({ queryKey: qk.overview(recipientId) });
      void queryClient.invalidateQueries({ queryKey: qk.context(recipientId) });
      void queryClient.invalidateQueries({ queryKey: qk.history(recipientId) });
      if (input.type === "resolve") {
        setNote("");
        setOutcome(null);
      }
      setSuccessMessage(
        input.type === "acknowledge"
          ? "Đã tiếp nhận · Chưa có kết quả kiểm tra."
          : input.type === "start"
            ? "Đã chuyển sang Đang xử lý."
            : "Đã ghi kết quả và đóng cảnh báo.",
      );
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409) {
        const current = error.current as AlertDetail | undefined;
        if (current) queryClient.setQueryData(qk.alert(recipientId, alertId), current);
        else void queryClient.invalidateQueries({ queryKey: qk.alert(recipientId, alertId) });
        setConflict(error.message);
      } else if (isApiError(error) && error.fieldErrors) {
        setFieldErrors(error.fieldErrors);
        summaryRef.current?.focus();
      }
    },
  });

  const submitResolve = () => {
    const errors: Record<string, string> = {};
    if (!outcome) errors.outcome = "Chọn kết quả kiểm tra.";
    if (note.trim().length < 3) errors.note = "Nhập ghi chú xử lý (ít nhất 3 ký tự).";
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      summaryRef.current?.focus();
      return;
    }
    mutation.mutate({ type: "resolve", expectedVersion: alert.version, outcome: outcome!, note });
  };

  const genericError = mutation.isError && !(isApiError(mutation.error) && (mutation.error.status === 409 || mutation.error.fieldErrors));
  const errorList = Object.values(fieldErrors);

  return (
    <SoftSurface as="section" aria-labelledby="process-title" className="flex flex-col gap-5">
      <h2 id="process-title" className="text-lg font-bold">
        Xử lý cảnh báo
      </h2>
      <div className="flex items-center gap-3 rounded-control p-4 shadow-inset-sm">
        <UserRound className="size-5 text-accent" aria-hidden />
        <p className="font-medium">{alert.assigneeName ? `Phụ trách: ${alert.assigneeName}` : "Chưa có người phụ trách"}</p>
      </div>

      <div role="status" aria-live="polite" className="empty:hidden">
        {successMessage ? <Notice icon={<CircleCheck aria-hidden />}>{successMessage}</Notice> : null}
      </div>
      {conflict ? (
        <Notice role="alert" title="Cảnh báo đã thay đổi">
          {conflict} Ghi chú bạn đã nhập vẫn được giữ.
        </Notice>
      ) : null}
      {genericError ? <InlineError title="Chưa lưu được thao tác">{errorMessage(mutation.error)}</InlineError> : null}

      {alert.status === "open" ? (
        <>
          <p>Tiếp nhận nghĩa là bạn sẽ kiểm tra tình hình. Thao tác này không xác nhận AI đúng và không đóng cảnh báo.</p>
          <SoftButton variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate({ type: "acknowledge", expectedVersion: alert.version })}>
            <Hand className="size-5" aria-hidden />
            Tiếp nhận kiểm tra
          </SoftButton>
        </>
      ) : null}

      {alert.status === "acknowledged" ? (
        <SoftButton loading={mutation.isPending && mutation.variables?.type === "start"} disabled={mutation.isPending} onClick={() => mutation.mutate({ type: "start", expectedVersion: alert.version })}>
          <Play className="size-5" aria-hidden />
          Bắt đầu xử lý
        </SoftButton>
      ) : null}

      {alert.status === "acknowledged" || alert.status === "in_progress" ? (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitResolve();
          }}
        >
          <h3 className="font-bold">Ghi kết quả và đóng</h3>
          {errorList.length ? (
            <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-control p-4 shadow-inset-sm focus:outline-2 focus:outline-accent">
              <p className="font-bold">Cần bổ sung trước khi đóng:</p>
              <ul className="list-disc pl-5">
                {errorList.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div ref={summaryRef} tabIndex={-1} />
          )}
          <fieldset className="flex flex-col gap-3" aria-describedby={fieldErrors.outcome ? "outcome-error" : undefined}>
            <legend className="mb-2 font-medium">
              Kết quả kiểm tra <span aria-hidden className="font-bold">*</span>
              <span className="sr-only"> (bắt buộc)</span>
            </legend>
            {(Object.keys(OUTCOME_LABELS) as ReviewOutcome[]).map((o) => (
              <Choice
                key={o}
                type="radio"
                name="outcome"
                value={o}
                checked={outcome === o}
                onChange={() => setOutcome(o)}
                label={OUTCOME_LABELS[o]}
                description={
                  o === "confirmed"
                    ? "Sự kiện được người chăm sóc xác nhận là có xảy ra."
                    : o === "false_alarm"
                      ? "Sự kiện không xảy ra như mô tả."
                      : "Không đủ thông tin để kết luận."
                }
              />
            ))}
            {fieldErrors.outcome ? (
              <p id="outcome-error" className="text-sm font-bold">
                {fieldErrors.outcome}
              </p>
            ) : null}
          </fieldset>
          <InsetTextarea
            label="Ghi chú xử lý"
            required
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={fieldErrors.note}
            hint="Mô tả ngắn bạn đã kiểm tra và xử lý thế nào. Không nhập thông tin nhạy cảm không cần thiết."
            maxLength={1000}
          />
          <SoftButton type="submit" variant="primary" loading={mutation.isPending && mutation.variables?.type === "resolve"} disabled={mutation.isPending}>
            Ghi kết quả và đóng
          </SoftButton>
        </form>
      ) : null}

      {alert.status === "resolved" ? <p>Cảnh báo đã đóng. Không còn thao tác xử lý.</p> : null}
    </SoftSurface>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}
