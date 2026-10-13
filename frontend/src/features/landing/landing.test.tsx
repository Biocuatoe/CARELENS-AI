import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { BEATS } from "../../lib/hardware3d";
import { AppProviders } from "../../app/providers";
import { LandingPage } from "./LandingPage";
import { CONTACT, MEDICATION, NAV_ITEMS, SECTION_IDS, TAGLINE, TEAM } from "./content";
import { slotState } from "./medication";
import { contactMailto } from "./ContactSection";

beforeAll(() => {
  // jsdom không có matchMedia: cảnh 3D (không có WebGL trong jsdom) đọc chế độ giảm chuyển động và kích thước màn hình.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

function renderLanding() {
  return render(
    <AppProviders>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("Landing CareLens AI", () => {
  it("có đủ các phần theo thứ tự và mọi liên kết neo trỏ tới phần tử có thật", async () => {
    const { container } = renderLanding();
    expect(screen.getByRole("heading", { level: 1, name: /nhìn thấy nhiều hơn/ })).toBeInTheDocument();
    // Cảnh 3D tải lười: chờ tới khi phần tử neo của nó xuất hiện.
    await screen.findByTestId("hardware-story");
    const order = Object.values(SECTION_IDS);
    const found = order.map((id) => {
      const el = container.querySelector(`#${id}`);
      expect(el, id).not.toBeNull();
      return el!;
    });
    for (let i = 1; i < found.length; i++) {
      expect(found[i - 1]!.compareDocumentPosition(found[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `${order[i - 1]} → ${order[i]}`).toBeTruthy();
    }
    for (const a of Array.from(container.querySelectorAll("a"))) {
      const href = a.getAttribute("href") ?? "";
      expect(href, a.textContent ?? "").not.toBe("#");
      expect(href, a.textContent ?? "").not.toBe("");
      if (href.startsWith("#")) expect(container.querySelector(href), href).not.toBeNull();
    }
    for (const item of NAV_ITEMS) expect(container.querySelector(`#${item.id}`), item.label).not.toBeNull();
  });

  it("dùng đúng khẩu hiệu và nói rõ đó không phải cam kết kỹ thuật", () => {
    const { container } = renderLanding();
    const text = container.textContent ?? "";
    expect(text).toContain(TAGLINE.join(" "));
    expect(text).toMatch(/không phải cam kết kỹ thuật/);
    expect(text).toMatch(/chưa được kiểm chứng lâm sàng/);
  });

  it("không có số liệu, chứng nhận, lời chứng thực hay kết quả y khoa bịa", () => {
    const { container } = renderLanding();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\d+\s?%/);
    expect(text).not.toMatch(/độ chính xác \d|độ nhạy \d|đã được kiểm chứng lâm sàng|được chứng nhận|FDA|ISO ?\d/i);
    expect(text).not.toMatch(/khách hàng (nói|chia sẻ)|đánh giá \d|5 sao|giá từ|chỉ từ \d/i);
    expect(text).not.toMatch(/đảm bảo an toàn|bảo vệ tuyệt đối|không bao giờ lưu|hoàn toàn riêng tư/i);
  });

  it("không còn nhãn trạng thái dở dang, chú thích mô hình hay gạch đầu dòng chú thích; chỉ nhãn \"Ví dụ\" ở nơi có dữ liệu mẫu", () => {
    const { container } = renderLanding();
    const text = container.textContent ?? "";
    expect(text).toContain("Ví dụ");
    expect(text).not.toMatch(/mô phỏng|khái niệm|trước thương mại|Quy trình khái niệm|Đang hoạt động|Đang hoàn thiện|Đang hoàn thành|Ước lượng|chưa xác minh|mô hình minh hoạ/i);
    // Hai gạch đầu dòng chú thích dưới phần mở đầu của hai tình huống đã bỏ.
    expect(text).not.toMatch(/Chưa công bố số liệu về độ nhạy|không phải chẩn đoán\.|Hiện chưa nhận diện thuốc|Không thay thế lời dặn/);
  });

  it("luồng dữ liệu nhất quán: camera và cảm biến → hub → máy chủ đám mây CareLens AI; không còn nói dữ liệu chỉ ở mạng nội bộ", () => {
    const { container } = renderLanding();
    const text = container.textContent ?? "";
    expect(text).toContain("máy chủ đám mây CareLens AI");
    expect(text).toMatch(/Hub chuyển/);
    expect(text).not.toMatch(/mạng nội bộ|không lên đám mây|không rời hub|chỉ được xử lý ở hub|dừng ở hub|chỉ đi tới hub/i);
  });

  it("không còn phần liệt kê lại chín linh kiện sau cảnh 3D; danh sách thay thế do chính cảnh 3D cung cấp", async () => {
    const { container } = renderLanding();
    await screen.findByTestId("hardware-story");
    expect(container.querySelector("#linh-kien")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Chín chi tiết/ })).not.toBeInTheDocument();
    expect(NAV_ITEMS.map((n) => n.label)).not.toContain("Linh kiện");
    // Không có WebGL (jsdom): cảnh 3D tự hiện danh sách tám nhịp giới thiệu cho người dùng không xem được cảnh.
    const list = await screen.findByTestId("static-labels");
    expect(within(list).getAllByRole("heading", { level: 4 })).toHaveLength(BEATS.length);
  });

  it("liên hệ: ba nhóm người liên hệ, nút chính luôn dùng được, chọn nhóm đổi nội dung, không có địa chỉ bịa", async () => {
    const user = userEvent.setup();
    const { container } = renderLanding();
    const section = container.querySelector(`#${SECTION_IDS.contact}`)! as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2, name: "Liên hệ với chúng tôi" })).toBeInTheDocument();
    const group = within(section).getByRole("group", { name: "Chọn nhóm liên hệ" });
    const options = within(group).getAllByRole("button");
    expect(options).toHaveLength(3);
    options.forEach((o, i) => {
      expect(o.textContent).toContain(CONTACT.audiences[i]!.title);
      expect(o.textContent).toContain(CONTACT.audiences[i]!.why);
    });
    expect(options[0]).toHaveAttribute("aria-pressed", "true");
    // Chưa có địa chỉ chính thức: nút chính là sao chép nội dung (dùng được, không bị tắt) kèm lời nói rõ trang không tự gửi.
    const primary = within(section).getByRole("button", { name: CONTACT.copy });
    expect(primary).toBeEnabled();
    expect(section.textContent).toContain("Trang này không tự gửi tin nhắn");
    expect(section.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(section.querySelector('a[href^="tel:"]')).toBeNull();
    // Chọn nhóm khác thì nội dung gợi ý đổi theo.
    await user.click(options[1]!);
    expect(options[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("contact-draft").textContent).toContain("doanh nghiệp chúng tôi");
    await user.click(options[2]!);
    expect(screen.getByTestId("contact-draft").textContent).toContain("cơ sở chúng tôi");
    // Nút "Gặp đội ngũ" dẫn tới phần đội ngũ có thật.
    const toTeam = within(section).getByRole("link", { name: CONTACT.team });
    expect(toTeam).toHaveAttribute("href", `#${SECTION_IDS.team}`);
    expect(container.querySelector(`#${SECTION_IDS.team}`)).not.toBeNull();
  });

  it("liên hệ: chỉ khi có địa chỉ chính thức mới soạn thư, theo từng nhóm; không có địa chỉ thì không có liên kết thư", () => {
    for (const a of CONTACT.audiences) {
      expect(contactMailto(undefined, a)).toBeNull();
      expect(contactMailto("  ", a)).toBeNull();
      const href = contactMailto("lienhe@example.org", a)!;
      expect(href.startsWith("mailto:lienhe@example.org?subject=")).toBe(true);
      expect(decodeURIComponent(href)).toContain(a.title);
      expect(decodeURIComponent(href)).toContain(a.draft.split("\n")[0]);
    }
  });

  it("đội ngũ: thay hẳn phần quy trình, đủ năm thành viên, đúng tên và vai trò theo tệp ảnh, CEO ở giữa trên màn rộng", () => {
    const { container } = renderLanding();
    expect(container.querySelector("#quy-trinh")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Từ cảm biến đến người chăm sóc/ })).not.toBeInTheDocument();
    expect(NAV_ITEMS.map((n) => n.label)).not.toContain("Quy trình");
    const team = container.querySelector(`#${SECTION_IDS.team}`)! as HTMLElement;
    expect(within(team).getByRole("heading", { level: 2, name: "Đội ngũ của chúng tôi" })).toBeInTheDocument();
    const expected: Record<string, string> = {
      CEO: "Lê Đức Hùng",
      CTO: "Đinh Hoàng Phương",
      CMO: "Nguyễn Hải Yến",
      CSO: "Vũ Bình Dương",
      COO: "Vũ Hữu Trí",
    };
    const items = Array.from(team.querySelectorAll<HTMLElement>("li[data-role]"));
    expect(items).toHaveLength(5);
    for (const li of items) {
      const role = li.dataset.role!;
      expect(li.textContent).toContain(expected[role]!);
      expect(li.textContent).toContain(role);
      const img = li.querySelector("img")!;
      expect(img.getAttribute("alt")).toBe(`${expected[role]}, ${role}`);
      expect(img.getAttribute("src")).toBeTruthy();
    }
    // Thứ tự màn rộng (cột 1–5): CEO đúng cột giữa, hai người mỗi bên.
    const slotOf = (li: HTMLElement) => Number(li.style.getPropertyValue("--slot"));
    const byCol = [...items].sort((a, b) => slotOf(a) - slotOf(b)).map((li) => li.dataset.role);
    expect(byCol).toEqual([...TEAM.desktopOrder]);
    expect(byCol[2]).toBe("CEO");
  });

  it("không còn lời tự nhận là phần quy trình khái niệm hay giai đoạn trước thương mại, và không có giá hay gói dịch vụ", () => {
    const { container } = renderLanding();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/trước thương mại|quy trình khái niệm|Dữ liệu mô phỏng|giai đoạn thử nghiệm/i);
    expect(text).not.toMatch(/\d[\d.,]*\s?(đồng|VND|USD|\$|₫)|gói (cơ bản|nâng cao|premium)|bảng giá/i);
  });

  it("tình huống an toàn: chuyển bước, chỉ tiếp nhận được ở bước cuối và không đóng sự kiện", async () => {
    const user = userEvent.setup();
    renderLanding();
    const group = screen.getByRole("group", { name: /Ví dụ tình huống/ });
    const steps = within(group).getAllByRole("button");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveAttribute("aria-pressed", "true");
    await user.click(steps[2]!);
    expect(steps[2]).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Tiếp nhận kiểm tra" }));
    expect(screen.getByText("Đã tiếp nhận · Chưa có kết quả kiểm tra")).toBeInTheDocument();
    expect(screen.queryByText("Đã xử lý")).not.toBeInTheDocument();
    // Đổi bước thì đặt lại.
    await user.click(steps[1]!);
    expect(screen.queryByText("Đã tiếp nhận · Chưa có kết quả kiểm tra")).not.toBeInTheDocument();
  });

  it("hỗ trợ dùng thuốc: không bao giờ kết luận đã hay chưa uống, thanh trượt đổi trạng thái từng lịch", () => {
    const { container } = renderLanding();
    expect(container.textContent).toContain("Không quan sát được không có nghĩa là chưa uống thuốc.");
    const slider = screen.getByRole("slider", { name: "Giờ trong ngày" });
    fireEvent.change(slider, { target: { value: String(14 * 60 + 35) } });
    expect(slider).toHaveAttribute("aria-valuetext", "14:35");
    expect(screen.getByText(MEDICATION.states.missed.label)).toBeInTheDocument();
    expect(screen.queryByText(/chưa uống$|đã uống$/)).not.toBeInTheDocument();
    fireEvent.change(slider, { target: { value: String(7 * 60) } });
    expect(screen.getAllByText(MEDICATION.states.waiting.label)).toHaveLength(3);
  });
});

describe("slotState", () => {
  const [morning, noon] = MEDICATION.slots;
  it("chờ, mở, đã quan sát, chưa ghi nhận", () => {
    expect(slotState(noon!, 12 * 60)).toBe("waiting");
    expect(slotState(noon!, 13 * 60)).toBe("open");
    expect(slotState(noon!, 13 * 60 + MEDICATION.windowMinutes)).toBe("open");
    expect(slotState(noon!, 13 * 60 + MEDICATION.windowMinutes + 1)).toBe("missed");
    expect(slotState(morning!, 8 * 60 + 5)).toBe("open");
    expect(slotState(morning!, 8 * 60 + 12)).toBe("observed");
    expect(slotState(morning!, 23 * 60)).toBe("observed");
  });
});
