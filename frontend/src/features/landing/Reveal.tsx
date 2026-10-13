import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../../design-system/cn";

/**
 * Hiện dần khi cuộn tới. Chỉ phần tử nằm dưới màn hình mới được ẩn (bằng thuộc tính DOM, không qua state) sau khi trang đã dựng;
 * không có IntersectionObserver hoặc đã ở trong khung nhìn thì hiện ngay. Giảm chuyển động: luôn hiện, không dịch chuyển.
 */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    el.dataset.reveal = "hidden";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          el.dataset.reveal = "shown";
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      delete el.dataset.reveal;
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-[opacity,transform] duration-700 ease-out data-[reveal=hidden]:translate-y-5 data-[reveal=hidden]:opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none",
        className,
      )}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
