import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DAILY_REPORT, reportSummary } from "./content";
import { DailyReportCard } from "./DailyReport";

describe("Tổng quan hôm nay (báo cáo ngày mẫu)", () => {
  it("có tiêu đề, nhãn ví dụ báo cáo và nhãn mô tả AI chưa xác nhận, không ngụ ý nguồn trực tiếp", () => {
    const { container } = render(<DailyReportCard headingId="r-title" />);
    expect(screen.getByRole("heading", { level: 3, name: "Tổng quan hôm nay" })).toHaveAttribute("id", "r-title");
    expect(screen.getByText("Ví dụ báo cáo")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Cập nhật|nguồn:|trực tiếp|mô phỏng/i);
    expect(container.textContent).toContain("Mô tả do AI tạo, chưa được con người xác nhận.");
  });

  it("dòng thời gian đúng thứ tự thời gian, ít sự kiện, mỗi sự kiện có giờ, tên, mô tả và trạng thái bằng chữ", () => {
    render(<DailyReportCard headingId="r-title" />);
    const list = within(screen.getByRole("region", { name: DAILY_REPORT.timelineLabel })).getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items.length).toBe(DAILY_REPORT.events.length);
    expect(items.length).toBeLessThanOrEqual(5);
    const times = DAILY_REPORT.events.map((e) => e.time);
    expect([...times].sort()).toEqual(times);
    items.forEach((li, i) => {
      const e = DAILY_REPORT.events[i]!;
      expect(li.textContent).toContain(e.time);
      expect(li.textContent).toContain(e.title);
      expect(li.textContent).toContain(e.note);
      expect(li.textContent).toContain(DAILY_REPORT.statusLabels[e.status]);
    });
  });

  it("phân biệt 'đã tiếp nhận' với 'đã xử lý' và 'không quan sát được' với 'chưa uống thuốc'", () => {
    const { container } = render(<DailyReportCard headingId="r-title" />);
    const text = container.textContent ?? "";
    expect(text).toContain("đã tiếp nhận");
    expect(text).toContain("chưa đóng");
    expect(text).not.toMatch(/đã xử lý|đã giải quyết/i);
    expect(text).toContain("Điều đó không có nghĩa là chưa uống thuốc");
  });

  it("không bịa số liệu hay kết luận: không phần trăm, độ chính xác, điểm số, chẩn đoán, 'an toàn' hay 'bình thường'", () => {
    const { container } = render(<DailyReportCard headingId="r-title" />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/%|độ chính xác|chính xác|confidence|điểm|chẩn đoán|an toàn|bình thường|khỏe|sức khỏe|nhịp tim|SpO2|ECG/i);
    // Báo cáo chỉ có văn bản: không nhắc tới ảnh, video hay camera (so khớp theo từ: "cảnh báo" không chứa từ "ảnh").
    expect(text).not.toMatch(/(^|[^\p{L}])(ảnh|video|khung hình|camera)(?![\p{L}])/iu);
  });

  it("tóm tắt cho người chăm sóc được đếm từ chính danh sách sự kiện", () => {
    const lines = reportSummary(DAILY_REPORT.events);
    const alerts = DAILY_REPORT.events.filter((e) => e.status === "alert").length;
    const gaps = DAILY_REPORT.events.filter((e) => e.status === "unobserved");
    expect(lines[0]).toContain(`${alerts} cảnh báo đang mở`);
    expect(lines[1]).toContain(`${gaps.length} mốc nhắc chưa có quan sát`);
    for (const g of gaps) expect(lines[1]).toContain(g.time);
    expect(lines.join(" ").length).toBeLessThan(220);
    render(<DailyReportCard headingId="r-title" />);
    for (const l of lines) expect(screen.getByText(l)).toBeInTheDocument();
    // Dữ liệu đổi thì tóm tắt đổi theo.
    expect(reportSummary([{ time: "09:00", status: "note" }])).toEqual(["Không có cảnh báo đang mở."]);
  });
});
