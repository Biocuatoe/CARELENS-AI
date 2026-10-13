import { useLayoutEffect } from "react";

const KEY = "hwScrollY";

/**
 * Nhớ vị trí cuộn của trang trong `history.state` (không dùng web storage). Trình duyệt tự khôi phục vị trí cuộn khi tải lại,
 * nhưng trang này dựng muộn (route tải lười) nên lúc đó tài liệu còn quá ngắn và vị trí bị cắt về 0. Cảnh cuộn cần đúng vị trí
 * ngay từ khung hình đầu, nên tự đặt lại trước khi cảnh đọc tiến trình.
 */
export function useScrollMemory() {
  useLayoutEffect(() => {
    const saved = (window.history.state as Record<string, unknown> | null)?.[KEY];
    if (typeof saved === "number" && saved > 0) window.scrollTo(0, saved);

    let timer = 0;
    const save = () => {
      window.clearTimeout(timer);
      // Trình duyệt giới hạn số lần replaceState, nên chỉ ghi khi đã ngừng cuộn.
      timer = window.setTimeout(() => {
        window.history.replaceState({ ...(window.history.state as object | null), [KEY]: Math.round(window.scrollY) }, "");
      }, 150);
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      window.removeEventListener("scroll", save);
      window.clearTimeout(timer);
    };
  }, []);
}
