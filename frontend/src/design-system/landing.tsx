import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Primitive riêng của landing CareLens AI (A19): nút và nhãn trạng thái dùng chung giữa trang landing và cảnh 3D.
 * Màu lấy từ token palette; teal chỉ xuất hiện ở tương tác và nhấn có nghĩa.
 */
export type Tone = "dark" | "light";

type ButtonVariant = "primary" | "secondary";

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold whitespace-nowrap transition-[background-color,color,border-color,transform] duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Tone, Record<ButtonVariant, string>> = {
  dark: {
    primary: "bg-signal text-midnight hover:bg-mint",
    secondary: "border border-ivory/35 text-ivory hover:border-signal hover:text-mint",
  },
  light: {
    primary: "bg-teal-deep text-paper hover:bg-midnight",
    secondary: "border border-ink/30 text-ink hover:border-teal-deep hover:text-teal-deep",
  },
};

/** Màu nút theo tông; dùng chung cho nút landing và nút của ứng dụng (`buttonClasses`). */
export const buttonVariantClasses = variants;

export function landingButtonClasses({ variant = "primary", tone = "dark", className }: { variant?: ButtonVariant; tone?: Tone; className?: string } = {}) {
  return cn(base, variants[tone][variant], className);
}

/** Trạng thái thực tế của một khả năng. Luôn có chữ, không chỉ dựa vào màu. */
export type CapabilityKind = "simulated";

export const CAPABILITY_LABEL: Record<CapabilityKind, string> = {
  simulated: "Ví dụ",
};

const kindStyle: Record<Tone, Record<CapabilityKind, string>> = {
  dark: {
    simulated: "border-ivory/45 bg-ivory/10 text-ivory",
  },
  light: {
    simulated: "border-ink/50 bg-ink/5 text-ink",
  },
};

function KindGlyph({ kind }: { kind: CapabilityKind }) {
  // Hình nửa đầy: phân biệt được cả khi không thấy màu.
  void kind;
  return <span aria-hidden className="size-2 rounded-full border border-current bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]" />;
}

export function CapabilityTag({ kind, tone = "dark", className, children }: { kind: CapabilityKind; tone?: Tone; className?: string; children?: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] font-medium tracking-[0.08em] whitespace-nowrap uppercase",
        kindStyle[tone][kind],
        className,
      )}
    >
      <KindGlyph kind={kind} />
      {children ?? CAPABILITY_LABEL[kind]}
    </span>
  );
}

/** Nhãn kỹ thuật nhỏ (mức xác minh kích thước, mã linh kiện…). */
export function MonoTag({ tone = "dark", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] tracking-[0.06em] whitespace-nowrap uppercase",
        tone === "dark" ? "border-ivory/30 text-ivory/80" : "border-ink/35 text-ink/80",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Dòng nhãn nhỏ phía trên tiêu đề phần. */
export function Eyebrow({ tone = "light", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <p className={cn("font-mono text-xs font-medium tracking-[0.18em] uppercase", tone === "dark" ? "text-signal" : "text-teal-deep", className)}>{children}</p>
  );
}
