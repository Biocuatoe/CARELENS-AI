/** Thời gian lưu UTC, hiển thị theo múi giờ cấu hình (giả định A01). */
export const DISPLAY_TIMEZONE = "Asia/Ho_Chi_Minh";
export const TIMEZONE_LABEL = "Giờ Việt Nam (UTC+7)";

const dateTimeFmt = new Intl.DateTimeFormat("vi-VN", {
  timeZone: DISPLAY_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const timeFmt = new Intl.DateTimeFormat("vi-VN", {
  timeZone: DISPLAY_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
});

const dateFmt = new Intl.DateTimeFormat("vi-VN", {
  timeZone: DISPLAY_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Không có dữ liệu";
  return dateTimeFmt.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Không có dữ liệu";
  return dateFmt.format(new Date(iso));
}

/** Giờ nếu cùng ngày với `now`, ngược lại ngày + giờ. */
export function formatSmart(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  return dayKeyFmt.format(d) === dayKeyFmt.format(new Date(now)) ? `${formatTime(iso)} hôm nay` : formatDateTime(iso);
}

export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "chưa từng nhận dữ liệu";
  const diffMs = now - new Date(iso).getTime();
  if (diffMs < 0) return "thời điểm trong tương lai (kiểm tra đồng hồ thiết bị)";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

export function rangeToMs(range: "6h" | "24h" | "7d" | "30d"): number {
  switch (range) {
    case "6h":
      return 6 * 3_600_000;
    case "24h":
      return 24 * 3_600_000;
    case "7d":
      return 7 * 86_400_000;
    case "30d":
      return 30 * 86_400_000;
  }
}

/** Giá trị cho <input type="datetime-local"> theo múi giờ hiển thị. */
export function toLocalInputValue(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Ngược lại của toLocalInputValue. Múi giờ hiển thị cố định UTC+7, không có giờ mùa hè. */
export function fromLocalInputValue(value: string): string {
  return new Date(`${value}:00+07:00`).toISOString();
}

export function toDateInputValue(iso: string): string {
  return dayKeyFmt.format(new Date(iso));
}

export function fromDateInputValue(value: string, endOfDay = false): string {
  return new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}+07:00`).toISOString();
}
