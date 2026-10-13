import type { ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleHelp,
  FlaskConical,
  Info,
  LoaderCircle,
  Lock,
  TriangleAlert,
} from "lucide-react";
import { cn } from "./cn";
import { IconWell, SoftButton } from "./primitives";

/* ------------------------------------------------------------------ Status label */

export type StatusTone = "urgent" | "attention" | "neutral" | "success" | "inactive" | "unknown";

const toneIcon: Record<StatusTone, ReactNode> = {
  urgent: <TriangleAlert aria-hidden />,
  attention: <CircleAlert aria-hidden />,
  neutral: <CircleDot aria-hidden />,
  success: <CircleCheck aria-hidden />,
  inactive: <Info aria-hidden />,
  unknown: <CircleHelp aria-hidden />,
};

/**
 * Nhãn trạng thái. Mức độ diễn đạt bằng chữ + icon + độ đậm, không thêm màu đỏ/hổ phách (ADR-009, plan §6.2).
 * Teal chỉ dùng cho `success` = thao tác thành công, không mang nghĩa "người được chăm sóc bình thường".
 */
export function StatusLabel({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full bg-surface px-3 text-sm text-fg [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "urgent" && "font-bold shadow-extruded-sm [&_svg]:text-accent",
        tone === "attention" && "font-bold shadow-inset-sm [&_svg]:text-accent",
        tone === "neutral" && "font-medium shadow-inset-sm",
        tone === "success" && "font-medium shadow-inset-sm [&_svg]:text-accent-secondary",
        tone === "inactive" && "font-medium shadow-inset-sm",
        tone === "unknown" && "font-medium shadow-inset-sm",
        className,
      )}
    >
      {toneIcon[tone]}
      <span>{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ Demo badge */

export function DemoBadge({ className, compact, label = "Dữ liệu mô phỏng" }: {
  className?: string; compact?: boolean; label?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full bg-surface px-3 text-sm font-bold text-fg shadow-inset-sm [&_svg]:size-4 [&_svg]:text-accent",
        className,
      )}
    >
      <FlaskConical aria-hidden />
      {compact ? <span className="sr-only sm:not-sr-only">{label}</span> : label}
    </span>
  );
}

/** Telegram badge using the same visual style as DemoBadge.
 *  Shows "Telegram" instead of "Dữ liệu mô phỏng". */
export function TelegramBadge({ className, label = "Telegram" }: { className?: string; label?: string }) {
  return (
    <span
      data-tone="telegram"
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full bg-surface px-3 text-sm font-bold text-fg shadow-inset-sm [&_svg]:size-4 [&_svg]:text-accent",
        className,
      )}
    >
      {/* Telegram icon — reuse FlaskConical from DemoBadge to keep same visual weight */}
      <FlaskConical aria-hidden />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ Page states */

export function LoadingState({ label = "Đang tải dữ liệu…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center gap-3 py-8 text-fg", className)}>
      <LoaderCircle className="size-6 animate-spin text-accent" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Đang tải dữ liệu" className="flex flex-col gap-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-control bg-surface shadow-inset-sm" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  decorative = false,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-4 py-8 text-center", className)}>
      {decorative ? (
        <ConcentricDecoration>{icon}</ConcentricDecoration>
      ) : icon ? (
        <IconWell size="lg">{icon}</IconWell>
      ) : null}
      <h3 className="text-lg font-bold">{title}</h3>
      {children ? <div className="max-w-prose text-fg">{children}</div> : null}
      {action}
    </div>
  );
}

export function InlineError({
  title = "Không tải được dữ liệu",
  children,
  onRetry,
  className,
}: {
  title?: string;
  children?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-control bg-surface p-4 shadow-inset-sm sm:flex-row sm:items-center",
        className,
      )}
    >
      <div className="flex flex-1 items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
        <div>
          <p className="font-bold">{title}</p>
          {children ? <div className="text-fg">{children}</div> : null}
        </div>
      </div>
      {onRetry ? (
        <SoftButton size="sm" onClick={onRetry}>
          Thử lại
        </SoftButton>
      ) : null}
    </div>
  );
}

export function Notice({
  icon = <Info aria-hidden />,
  title,
  children,
  className,
  role,
}: {
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
  className?: string;
  role?: "status" | "alert";
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-3 rounded-control bg-surface p-4 shadow-inset-sm [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-accent",
        className,
      )}
    >
      {icon}
      <div className="min-w-0">
        {title ? <p className="font-bold">{title}</p> : null}
        <div className="text-fg">{children}</div>
      </div>
    </div>
  );
}

export function ForbiddenState({ children }: { children?: ReactNode }) {
  return (
    <EmptyState icon={<Lock />} title="Không có quyền truy cập">
      {children ?? "Hồ sơ không tồn tại hoặc bạn không được cấp quyền xem hồ sơ này."}
    </EmptyState>
  );
}

/* ------------------------------------------------------------------ Decoration */

/** Trang trí concentric extruded → inset → extruded. Chỉ dùng ở onboarding và empty state. */
export function ConcentricDecoration({ children }: { children?: ReactNode }) {
  return (
    <div aria-hidden className="group relative flex size-40 items-center justify-center">
      <div className="absolute inset-0 rounded-full bg-surface shadow-extruded transition-transform duration-500 ease-out group-hover:scale-105" />
      <div className="absolute inset-5 rounded-full bg-surface shadow-inset-deep" />
      <div className="relative flex size-16 animate-float items-center justify-center rounded-full bg-surface text-accent shadow-extruded-sm transition-transform duration-500 ease-out group-hover:rotate-180 [&_svg]:size-7">
        {children}
      </div>
    </div>
  );
}
