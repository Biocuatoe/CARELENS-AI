import { cn } from "../../design-system/cn";

/** Dấu hiệu thương hiệu: vòng ống kính và chấm tâm, vẽ bằng SVG nên sắc nét ở mọi kích thước. */
export function LensMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="2.4" className="fill-signal" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-display text-lg font-extrabold tracking-tight", className)}>
      <LensMark />
      <span>
        CareLens <span className="font-medium opacity-75">AI</span>
      </span>
    </span>
  );
}
