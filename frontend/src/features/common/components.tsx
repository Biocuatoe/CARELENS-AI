import type { ReactNode } from "react";
import { Link } from "react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import { Activity, Bot, ChevronRight, Clock, HeartPulse, ScanEye, UserRound } from "lucide-react";
import type { Alert, AlertStatus, CareEvent, ConnectionState, Product, Severity, SourceStatus } from "../../data/contracts";
import { errorMessage, isAccessError } from "../../data/errors";
import { cn } from "../../design-system/cn";
import {
  DemoBadge,
  TelegramBadge,
  ForbiddenState,
  InlineError,
  SkeletonRows,
  StatusLabel,
} from "../../design-system/feedback";
import { IconWell } from "../../design-system/primitives";
import { buttonClasses } from "../../design-system/primitives";
import { formatDateTime, formatRelative, formatSmart } from "../../lib/time";
import {
  AI_SCORE_NOTE,
  AI_UNCONFIRMED,
  ALERT_STATUS_LABELS,
  ALERT_STATUS_TONE,
  CONNECTION_LABELS,
  CONNECTION_TONE,
  PRODUCT_LABELS,
  SEVERITY_LABELS,
  SEVERITY_TONE,
} from "./labels";

/* ------------------------------------------------------------------ Page header */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
        <h1 className="text-2xl font-extrabold md:text-3xl">{title}</h1>
        {description ? <div className="mt-2 max-w-3xl leading-7 text-fg">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, id, action }: { children: ReactNode; id?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 id={id} className="text-lg font-bold md:text-xl">
        {children}
      </h2>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ Query boundary */

export function QueryState<T>({
  query,
  children,
  loading,
  forbidden,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  loading?: ReactNode;
  forbidden?: ReactNode;
}) {
  if (query.isPending) return <>{loading ?? <SkeletonRows />}</>;
  if (query.isError) {
    if (isAccessError(query.error)) return <>{forbidden ?? <ForbiddenState>{errorMessage(query.error)}</ForbiddenState>}</>;
    return (
      <InlineError onRetry={() => void query.refetch()}>
        {errorMessage(query.error)}
      </InlineError>
    );
  }
  return <>{children(query.data)}</>;
}

/* ------------------------------------------------------------------ Product */

export function ProductIcon({ product }: { product: Product }) {
  return product === "carelens" ? <ScanEye aria-hidden /> : <HeartPulse aria-hidden />;
}

export function ProductTag({ product, className }: { product: Product; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-bold text-fg [&_svg]:size-4 [&_svg]:text-accent", className)}>
      <ProductIcon product={product} />
      {PRODUCT_LABELS[product]}
    </span>
  );
}

/* ------------------------------------------------------------------ Source freshness */

export function ConnectionLabel({ state }: { state: ConnectionState }) {
  return <StatusLabel tone={CONNECTION_TONE[state]}>{CONNECTION_LABELS[state].label}</StatusLabel>;
}

/**
 * Trạng thái và độ mới của một nguồn. Luôn tách kết nối khỏi "có bất thường hay không":
 * mất kết nối không bao giờ hiển thị như bình thường.
 */
export function SourceFreshness({ source, compact = false }: { source: SourceStatus; compact?: boolean }) {
  const hasDevice = source.deviceId !== null;
  return (
    <div className={cn("flex flex-col gap-2", compact ? "" : "rounded-control p-4 shadow-inset-sm")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ProductTag product={source.product} />
        {hasDevice ? <ConnectionLabel state={source.state} /> : <StatusLabel tone="unknown">Chưa ghép thiết bị</StatusLabel>}
      </div>
      {hasDevice ? (
        <dl className="grid gap-1 text-sm text-fg">
          <div className="flex flex-wrap gap-x-1.5">
            <dt>Tín hiệu thiết bị gần nhất:</dt>
            <dd className="font-medium">
              {source.lastSeenAt ? `${formatRelative(source.lastSeenAt)} (${formatSmart(source.lastSeenAt)})` : "Không có dữ liệu"}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-1.5">
            <dt>Dữ liệu gần nhất:</dt>
            <dd className="font-medium">
              {source.lastDataAt ? `${formatRelative(source.lastDataAt)} (${formatSmart(source.lastDataAt)})` : "Không có dữ liệu"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-fg">Chưa có thiết bị nên chưa nhận dữ liệu. Không có dữ liệu không có nghĩa là không có bất thường.</p>
      )}
      {!compact && source.sourceMode === "simulated" ? <DemoBadge className="self-start" /> : null}
    </div>
  );
}

export function sourceNeedsAttention(source: SourceStatus): boolean {
  return source.state !== "connected";
}

/* ------------------------------------------------------------------ Alerts */

export function SeverityLabel({ severity }: { severity: Severity }) {
  return <StatusLabel tone={SEVERITY_TONE[severity]}>{SEVERITY_LABELS[severity]}</StatusLabel>;
}

export function AlertStatusLabel({ status }: { status: AlertStatus }) {
  return <StatusLabel tone={ALERT_STATUS_TONE[status]}>{ALERT_STATUS_LABELS[status]}</StatusLabel>;
}

export function alertPath(recipientId: string, alertId: string) {
  return `/people/${recipientId}/alerts/${alertId}`;
}

/** Hàng cảnh báo xếp chồng, dùng ở tổng quan và danh sách cảnh báo trên mobile. */
export function AlertStackRow({ alert, recipientId, cta = "Xem chi tiết" }: { alert: Alert; recipientId: string; cta?: string }) {
  return (
    <li className="flex flex-col gap-3 rounded-control p-4 shadow-inset-sm sm:p-5 md:flex-row md:items-center md:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityLabel severity={alert.severity} />
          <AlertStatusLabel status={alert.status} />
          <ProductTag product={alert.product} />
          {alert.sourceMode === "telegram" ? (
            <TelegramBadge />
          ) : alert.sourceMode === "simulated" ? (
            <DemoBadge />
          ) : null}
        </div>
        <p className="font-medium">{alert.summary}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-4" aria-hidden />
            <time dateTime={alert.observedAt}>{formatSmart(alert.observedAt)}</time>
          </span>
          <span className="inline-flex items-center gap-1">
            <UserRound className="size-4" aria-hidden />
            {alert.assigneeName ? `Phụ trách: ${alert.assigneeName}` : "Chưa có người phụ trách"}
          </span>
          {alert.sourceMode === "simulated" ? <span className="font-medium">· Dữ liệu mô phỏng</span> : null}
        </p>
      </div>
      <Link
        to={alertPath(recipientId, alert.id)}
        className={buttonClasses({ variant: alert.status === "open" ? "primary" : "secondary", size: "sm", className: "w-full self-start md:w-auto md:self-center" })}
      >
        {cta}
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </li>
  );
}

/* ------------------------------------------------------------------ AI observation */

export function AiObservation({ event, summary, careLevel }: { event?: CareEvent | null; summary?: string; careLevel?: number | null }) {
  const text = event?.summary ?? summary ?? "";
  const level = event ? event.careLevel : (careLevel ?? null);
  return (
    <div className="flex flex-col gap-3 rounded-control p-4 shadow-inset-sm">
      <div className="flex items-start gap-3">
        <IconWell size="sm" depth="inset">
          <Bot />
        </IconWell>
        <div className="min-w-0">
          <p className="text-sm font-bold">{AI_UNCONFIRMED}</p>
          <p className="mt-1 text-lg font-medium">{text}</p>
        </div>
      </div>
      {level !== null && level !== undefined ? (
        <p className="text-sm">
          <span className="font-bold">Điểm AI: {level}/10</span> · {AI_SCORE_NOTE}
        </p>
      ) : (
        <p className="text-sm">Nguồn không cung cấp điểm AI.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Measurement */

export function MeasurementFigure({
  value,
  unit,
  observedAt,
  label,
  timeLabel,
}: {
  value: number;
  unit: string;
  observedAt: string;
  label: string;
  /** Ghi đè dòng thời gian, dùng cho bản xem thử có giờ cố định (landing). */
  timeLabel?: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <IconWell>
        <Activity />
      </IconWell>
      <div>
        <p className="text-sm font-bold">{label}</p>
        <p className="font-display text-3xl font-extrabold tracking-tight">
          {value} <span className="text-lg font-bold">{unit}</span>
        </p>
        <p className="text-sm">
          {timeLabel ?? (
            <>
              Đo lúc <time dateTime={observedAt}>{formatDateTime(observedAt)}</time> · {formatRelative(observedAt)}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export function TimestampLine({ label, iso }: { label: string; iso: string | null }) {
  return (
    <p className="text-sm">
      {label}: {iso ? <time dateTime={iso}>{formatDateTime(iso)}</time> : "Không có dữ liệu"}
    </p>
  );
}
