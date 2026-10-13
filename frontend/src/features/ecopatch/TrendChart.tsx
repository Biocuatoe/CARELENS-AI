import { useId, useMemo } from "react";
import type { Measurement } from "../../data/contracts";
import { formatDateTime, formatTime, TIMEZONE_LABEL } from "../../lib/time";

/** Tách chuỗi đo thành các đoạn liên tục; khoảng cách lớn hơn ngưỡng là khoảng mất dữ liệu (không nối đường). */
export function splitSegments(items: Measurement[], gapThresholdMs: number): Measurement[][] {
  const segments: Measurement[][] = [];
  let current: Measurement[] = [];
  let prev: number | null = null;
  for (const m of items) {
    const t = new Date(m.observedAt).getTime();
    if (prev !== null && t - prev > gapThresholdMs) {
      if (current.length) segments.push(current);
      current = [];
    }
    current.push(m);
    prev = t;
  }
  if (current.length) segments.push(current);
  return segments;
}

export function TrendChart({
  items,
  from,
  to,
  unit,
  label,
  expectedIntervalMinutes,
  placeholder = false,
  yDomain,
}: {
  items: Measurement[];
  from: string;
  to: string;
  unit: string;
  label: string;
  expectedIntervalMinutes: number;
  /** Khi true, render placeholder thay vì biểu đồ thật (AGENTS.md §6 — không bịa số BPM). */
  placeholder?: boolean;
  /** Cố định domain trục Y, ví dụ [90, 100] cho SpO₂. Bỏ qua để tự tính từ dữ liệu. */
  yDomain?: [number, number];
}) {
  const titleId = useId();
  const descId = useId();
  const width = 720;
  const height = 260;
  const pad = { top: 32, right: 16, bottom: 36, left: 48 };
  const x0 = new Date(from).getTime();
  const x1 = new Date(to).getTime();
  const gapMs = expectedIntervalMinutes * 3 * 60_000;

  // Hooks must be called unconditionally — placeholder check comes after.
  const { segments, yMin, yMax, gaps } = useMemo(() => {
    const values = items.map((m) => m.value);
    const min = yDomain
      ? yDomain[0]
      : values.length
        ? Math.floor((Math.min(...values) - 5) / 5) * 5
        : 50;
    const max = yDomain
      ? yDomain[1]
      : values.length
        ? Math.ceil((Math.max(...values) + 5) / 5) * 5
        : 100;
    const segs = splitSegments(items, gapMs);
    const gapRanges: Array<[number, number]> = [];
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1]!.at(-1)!;
      const b = segs[i]![0]!;
      gapRanges.push([new Date(a.observedAt).getTime(), new Date(b.observedAt).getTime()]);
    }
    return { segments: segs, yMin: min, yMax: max, gaps: gapRanges };
  }, [items, gapMs, yDomain]);

  const sx = (t: number) => pad.left + ((t - x0) / Math.max(1, x1 - x0)) * (width - pad.left - pad.right);
  const sy = (v: number) => pad.top + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * (height - pad.top - pad.bottom);
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);
  const xTicks = Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);
  const multiDay = x1 - x0 > 30 * 3_600_000;

  if (placeholder) {
    return (
      <figure className="flex flex-col gap-3">
        <div
          className="flex min-h-[260px] items-center justify-center rounded-control p-6 shadow-inset-sm"
          aria-label="Biểu đồ nhịp tim — chưa có dữ liệu"
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-base font-medium text-fg-muted">Biểu đồ nhịp tim</p>
            <p className="text-sm text-fg-muted">Chưa có dữ liệu — sẽ được cập nhật bằng module thật</p>
          </div>
        </div>
        <p className="text-sm text-fg-muted">Dữ liệu mô phỏng</p>
      </figure>
    );
  }

  return (
    <figure className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-control p-3 shadow-inset-sm" tabIndex={0} aria-label="Biểu đồ nhịp tim. Vuốt ngang để xem đầy đủ trên màn hình nhỏ.">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="h-auto w-[45rem] min-w-[45rem] text-fg sm:w-full sm:min-w-[32rem]"
        >
          <title id={titleId}>{label}</title>
          <desc id={descId}>
            {items.length} phép đo từ {formatDateTime(from)} đến {formatDateTime(to)}, đơn vị {unit}. {gaps.length} khoảng mất dữ liệu được để trống.
          </desc>
          {gaps.map(([a, b], i) => (
            <g key={i}>
              <rect x={sx(a)} y={pad.top} width={Math.max(2, sx(b) - sx(a))} height={height - pad.top - pad.bottom} className="fill-fg/10" />
            </g>
          ))}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={width - pad.right} y1={sy(v)} y2={sy(v)} className="stroke-fg/15" strokeDasharray="4 4" />
              <text x={pad.left - 8} y={sy(v) + 4} textAnchor="end" className="fill-fg text-[12px]">
                {Math.round(v)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={sx(t)} y={height - 12} textAnchor="middle" className="fill-fg text-[12px]">
              {multiDay ? new Date(t).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : formatTime(new Date(t).toISOString())}
            </text>
          ))}
          <text x={pad.left - 8} y={14} textAnchor="end" className="fill-fg text-[12px] font-bold">
            {unit}
          </text>
          {segments.map((seg, i) =>
            seg.length === 1 ? (
              <circle key={i} cx={sx(new Date(seg[0]!.observedAt).getTime())} cy={sy(seg[0]!.value)} r={3} className="fill-accent" />
            ) : (
              <polyline
                key={i}
                fill="none"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="stroke-accent"
                points={seg.map((m) => `${sx(new Date(m.observedAt).getTime())},${sy(m.value)}`).join(" ")}
              />
            ),
          )}
          {items
            .filter((m) => m.quality === "poor")
            .map((m) => (
              <circle key={m.id} cx={sx(new Date(m.observedAt).getTime())} cy={sy(m.value)} r={4} className="fill-surface stroke-fg" strokeWidth={1.5} />
            ))}
        </svg>
      </div>
      <p className="sm:hidden text-sm font-medium">Vuốt ngang để xem đầy đủ biểu đồ và mốc thời gian.</p>
      <figcaption className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-1 w-6 rounded-full bg-accent" /> {label} ({unit})
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="inline-block size-3 rounded-full border-2 border-fg bg-surface" /> Tín hiệu kém
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-6 bg-fg/10" /> Khoảng mất dữ liệu (không nối đường)
        </span>
        <span>{TIMEZONE_LABEL}</span>
      </figcaption>
    </figure>
  );
}
