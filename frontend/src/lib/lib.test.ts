import { describe, expect, it } from "vitest";
import type { Measurement } from "../data/contracts";
import { splitSegments } from "../features/ecopatch/TrendChart";
import { safeReturnTo } from "../features/auth/LoginPage";
import { escapeCsvCell, toCsv } from "./csv";
import { formatRelative, fromLocalInputValue, toLocalInputValue } from "./time";

describe("csv", () => {
  it("chặn formula injection", () => {
    expect(escapeCsvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(escapeCsvCell("+1")).toBe("'+1");
    expect(escapeCsvCell("@cmd")).toBe("'@cmd");
    expect(escapeCsvCell(-5)).toBe("-5");
  });
  it("escape dấu phẩy, ngoặc kép và xuống dòng", () => {
    expect(toCsv([["a,b", 'c"d', "e\nf"]])).toBe('"a,b","c""d","e\nf"');
  });
});

describe("time", () => {
  it("đổi qua lại giá trị datetime-local theo UTC+7", () => {
    const iso = "2026-09-14T08:30:00.000Z";
    expect(toLocalInputValue(iso)).toBe("2026-09-14T15:30");
    expect(fromLocalInputValue("2026-09-14T15:30")).toBe(iso);
  });
  it("không có dữ liệu thì nói rõ", () => {
    expect(formatRelative(null)).toBe("chưa từng nhận dữ liệu");
  });
  it("thời điểm tương lai được đánh dấu để kiểm tra đồng hồ thiết bị", () => {
    expect(formatRelative("2030-01-01T00:00:00Z", Date.parse("2026-01-01T00:00:00Z"))).toContain("tương lai");
  });
});

describe("biểu đồ", () => {
  const m = (minute: number): Measurement => ({
    id: String(minute),
    sourceRecordId: String(minute),
    deviceId: "d",
    metric: "heart_rate",
    value: 70,
    unit: "bpm",
    quality: "good",
    observedAt: new Date(Date.UTC(2026, 8, 14, 0, minute)).toISOString(),
    receivedAt: new Date(Date.UTC(2026, 8, 14, 0, minute)).toISOString(),
    sourceMode: "simulated",
  });
  it("tách đoạn tại khoảng mất dữ liệu, không nối đường qua khoảng trống", () => {
    const segments = splitSegments([m(0), m(10), m(20), m(200), m(210)], 30 * 60_000);
    expect(segments.map((s) => s.length)).toEqual([3, 2]);
  });
});

describe("đăng nhập", () => {
  it("chỉ chấp nhận đường dẫn quay về nội bộ", () => {
    expect(safeReturnTo("/people/r_an/overview")).toBe("/people/r_an/overview");
    expect(safeReturnTo("//evil.example")).toBeNull();
    expect(safeReturnTo("https://evil.example")).toBeNull();
    expect(safeReturnTo("/login?x=1")).toBeNull();
  });
});
