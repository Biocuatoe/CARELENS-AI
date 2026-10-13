import type { CSSProperties, Ref } from "react";
import { cn } from "../../design-system/cn";
import { CapabilityTag } from "../../design-system/landing";
import { DAILY_REPORT, reportSummary, type ReportEventStatus } from "./content";

/**
 * Bản báo cáo ngày mẫu ở cuối cảnh 3D. Chữ là HTML thật; mức hiện từng khối là hàm của biến CSS `--r` (0–1) do cảnh đặt theo tiến trình cuộn,
 * nên hiện dần theo thứ tự thời gian, cuộn ngược thì ẩn lại đúng như cũ và không có hoạt ảnh nào chạy theo giờ.
 * Ngoài cảnh (giảm chuyển động, không có WebGL) `--r` luôn bằng 1 và báo cáo nằm trong luồng trang bình thường.
 */

/** Mỗi khối bắt đầu hiện chậm hơn khối trước một nhịp; khối cuối (k = 6) hiện đủ đúng lúc `--r` = 1. */
const STAGGER = 0.09;
const SPAN = 0.46;

/** Độ hiện (0–1) của khối thứ k theo `--r`, viết bằng CSS để mỗi khung hình chỉ cần đổi một biến. */
const q = (k: number) => `clamp(0, calc((var(--r) - ${(k * STAGGER).toFixed(2)}) / ${SPAN}), 1)`;
const rise = (k: number, px = 12): CSSProperties => ({
  opacity: q(k),
  transform: `translateY(calc((1 - ${q(k)}) * ${px}px))`,
});

const statusStyle: Record<ReportEventStatus, string> = {
  // Phân biệt bằng nét viền và chữ, không bằng màu: ghi chú (viền liền), chưa quan sát (viền đứt), cảnh báo đang mở (nền đặc).
  note: "border border-ivory/40 text-ivory/90",
  unobserved: "border border-dashed border-ivory/60 text-ivory",
  alert: "border border-ivory bg-ivory font-bold text-midnight",
};

/**
 * Tiêu đề và nhãn mô phỏng luôn đứng yên ở đầu; phần thân (sự kiện và tóm tắt) nằm trong một vùng cắt. Khi khung thấp hơn nội dung (màn hình thấp),
 * cảnh cuộn thân lên theo tiến trình ở cuối vùng cuộn (biến `--shift`), còn tiêu đề không bao giờ rời khung.
 */
export function DailyReportCard({
  headingId,
  bodyRef,
  bodyInnerRef,
}: {
  headingId: string;
  bodyRef?: Ref<HTMLDivElement>;
  bodyInnerRef?: Ref<HTMLDivElement>;
}) {
  const R = DAILY_REPORT;
  const summary = reportSummary(R.events);
  return (
    <div className="flex max-h-full min-h-0 flex-col gap-5 text-ivory md:gap-6">
      <header
        className="flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-2"
        style={rise(0, 8)}
      >
        <div className="flex flex-col gap-1.5">
          <h3
            id={headingId}
            className="font-display text-2xl leading-tight font-extrabold tracking-tight md:text-3xl"
          >
            {R.heading}
          </h3>
          <p className="font-mono text-[11px] tracking-[0.12em] text-ivory/80 uppercase">
            {R.meta}
          </p>
        </div>
        <CapabilityTag kind="simulated" tone="dark">
          {R.sampleLabel}
        </CapabilityTag>
      </header>

      <div ref={bodyRef} className="min-h-0 shrink overflow-hidden">
        <div
          ref={bodyInnerRef}
          className="flex flex-col gap-5 md:gap-6"
          style={{ transform: "translateY(calc(var(--shift, 0) * -1px))" }}
        >
          <section aria-label={R.timelineLabel} className="relative">
            {/* Trục thời gian: vẽ dần từ trên xuống cùng nhịp các sự kiện. */}
            <span
              aria-hidden
              className="absolute top-2 bottom-2 left-[4.1rem] w-px origin-top bg-ivory/30 sm:left-[4.85rem]"
              style={{ transform: `scaleY(${q(1)})` }}
            />
            <ol className="flex flex-col gap-4 md:gap-5">
              {R.events.map((e, i) => (
                <li
                  key={e.id}
                  className="grid grid-cols-[3rem_1.25rem_minmax(0,1fr)] items-start gap-x-2 sm:grid-cols-[3.5rem_1.25rem_minmax(0,1fr)] sm:gap-x-3"
                  style={rise(i + 1)}
                >
                  <time className="pt-0.5 text-right font-mono text-xs text-ivory/85 sm:text-sm">
                    {e.time}
                  </time>
                  <span aria-hidden className="relative mt-1.5 flex justify-center">
                    <span
                      className={cn(
                        "block size-2.5 rounded-full",
                        e.status === "alert" ? "bg-ivory" : "border border-ivory/80 bg-graphite",
                      )}
                    />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <p className="font-display text-base leading-snug font-bold">{e.title}</p>
                    <p className="text-sm text-ivory/85">{e.note}</p>
                    <p
                      className={cn(
                        "inline-flex min-h-6 w-fit items-center rounded-full px-2.5 text-xs",
                        statusStyle[e.status],
                      )}
                    >
                      {R.statusLabels[e.status]}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section
            className="flex flex-col gap-2 border-t border-ivory/15 pt-4"
            style={rise(R.events.length + 1)}
          >
            <h4 className="font-mono text-[11px] tracking-[0.14em] text-mint uppercase">
              {R.summaryTitle}
            </h4>
            {summary.map((line) => (
              <p key={line} className="text-sm text-ivory/95 md:text-base">
                {line}
              </p>
            ))}
          </section>

          <p className="text-xs text-ivory/75" style={rise(R.events.length + 2, 6)}>
            {R.footnote}
          </p>
        </div>
      </div>
    </div>
  );
}
