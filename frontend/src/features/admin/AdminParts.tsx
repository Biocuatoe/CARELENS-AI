import type { ReactNode } from "react";
import { DemoBadge } from "../../design-system/feedback";
import { SoftSurface } from "../../design-system/primitives";
import { cn } from "../../design-system/cn";

/** A titled card of the admin area. */
export function Card({ icon, title, children, className }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <SoftSurface as="section" aria-label={title} className={cn("flex flex-col gap-4", className)}>
      <h2 className="flex items-center gap-3 font-display text-xl font-bold [&_svg]:size-5 [&_svg]:text-accent">
        {icon}
        {title}
      </h2>
      {children}
    </SoftSurface>
  );
}

/** One label/value line of a definition list. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-ink/10 py-2 last:border-b-0">
      <dt>{label}</dt>
      <dd className="font-bold">{children}</dd>
    </div>
  );
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-display text-3xl leading-tight font-extrabold tracking-tight">{children}</h1>
      {actions}
    </div>
  );
}

/** Marks records that the test harness produced. Real-looking data must never be mistaken for it, nor the other way round. */
export function SimulatedBadge({ label = "Dữ liệu mô phỏng" }: { label?: string }) {
  return <DemoBadge label={label} />;
}

export const dash = "—";

export function formatAge(seconds: number | null): string {
  if (seconds === null) return "chưa từng liên lạc";
  if (seconds < 60) return `${seconds} giây trước`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} giờ trước`;
  return `${Math.floor(seconds / 86_400)} ngày trước`;
}
