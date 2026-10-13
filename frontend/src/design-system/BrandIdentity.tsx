import { cn } from "./cn";

/** Lockup thương hiệu dùng chung; logo là ảnh, tên thương hiệu vẫn là HTML để sắc nét và dễ đọc. */
export function BrandIdentity({
  iconOnly = false,
  compact = false,
  className,
}: {
  iconOnly?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex min-h-11 items-center gap-2 whitespace-nowrap", className)}
      role={iconOnly ? "img" : undefined}
      aria-label={iconOnly ? "Day1Care" : undefined}
    >
      <img
        src="/brand/day1care-logo.png"
        alt=""
        className={cn("block shrink-0 object-contain", compact ? "size-7" : "size-9")}
      />
      {!iconOnly ? (
        <span className={cn("font-display font-bold tracking-tight", compact ? "text-base" : "text-lg")}>
          Day1Care
        </span>
      ) : null}
    </span>
  );
}
