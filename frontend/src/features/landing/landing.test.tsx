import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { BEATS } from "../../lib/hardware3d";
import { AppProviders } from "../../app/providers";
import { LandingPage } from "./LandingPage";
import { CONTACT, MEDICATION, NAV_ITEMS, SECTION_IDS, TAGLINE, TEAM } from "./content";
import { slotState } from "./medication";

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

  it("liên hệ: hai nhóm khách hàng, ba bước trong cùng phần, không còn nhóm doanh nghiệp, không có địa chỉ hay giá bịa", async () => {
    const user = userEvent.setup();
    const { container } = renderLanding();
    const section = container.querySelector(`#${SECTION_IDS.contact}`)! as HTMLElement;
    expect(section).toHaveAttribute("data-tone", "light");
    expect(within(section).getByRole("heading", { level: 2, name: "Liên hệ với chúng tôi" })).toBeInTheDocument();
    const groups = within(within(section).getByRole("group", { name: "Chọn nhóm khách hàng" })).getAllByRole("button");
    expect(groups.map((b) => b.textContent)).toEqual(CONTACT.groups.map((g) => `${g.title}${g.why}`));
    expect(section.textContent).not.toMatch(/Doanh nghiệp/);
    // Chưa chọn gì thì chưa có biểu mẫu.
    expect(within(section).queryByRole("button", { name: CONTACT.submit })).toBeNull();
    await user.click(groups[1]!);
    await user.click(within(section).getByRole("button", { name: /Báo giá \/ đặt mua/ }));
    expect(within(section).getByRole("heading", { level: 3, name: CONTACT.formTitle.facility_purchase })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: CONTACT.submit })).toBeEnabled();
    expect(section.querySelector('a[href^="mailto:"], a[href^="tel:"]')).toBeNull();
    expect(section.textContent).not.toMatch(/\d[\d.,]*\s?(đ|₫|VND|VNĐ)/);
  });

  it("đội ngũ: thay hẳn phần quy trình, đủ năm thành viên, đúng tên, vai trò và ảnh, CEO ở giữa trên màn rộng", () => {
    const { container } = renderLanding();
    expect(container.querySelector("#quy-trinh")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Từ cảm biến đến người chăm sóc/ })).not.toBeInTheDocument();
    expect(NAV_ITEMS.map((n) => n.label)).not.toContain("Quy trình");
    // Chỉ một phần đội ngũ.
    expect(container.querySelectorAll(`#${SECTION_IDS.team}`)).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2, name: "Đội ngũ của chúng tôi" })).toHaveLength(1);
    const team = container.querySelector(`#${SECTION_IDS.team}`)! as HTMLElement;
    expect(within(team).getByRole("heading", { level: 2, name: "Đội ngũ của chúng tôi" })).toBeInTheDocument();
    const expected: Record<string, { name: string; file: string }> = {
      CTO: { name: "Đinh Hoàng Phương", file: "Đinh Hoàng Phương - CTO.jpg" },
      CMO: { name: "Nguyễn Hải Yến", file: "Nguyễn Hải Yến - CMO.JPG" },
      CEO: { name: "Lê Đức Hùng", file: "Lê Đức Hùng - CEO.jpg" },
      CSO: { name: "Vũ Bình Dương", file: "Vũ Bình Dương - CSO.jpg" },
      COO: { name: "Vũ Hữu Trí", file: "Vũ Hữu Trí - COO.jpg" },
    };
    const items = Array.from(team.querySelectorAll<HTMLElement>("li[data-role]"));
    expect(items).toHaveLength(5);
    for (const li of items) {
      const role = li.dataset.role!;
      const want = expected[role]!;
      expect(li.textContent).toContain(want.name);
      expect(li.textContent).toContain(role);
      const img = li.querySelector("img")!;
      expect(img.getAttribute("alt")).toBe(`${want.name}, ${role}`);
      // Ảnh phải là đúng tệp trong members/ (URL do Vite sinh giữ tên tệp ở chế độ dev), không phải ảnh khác.
      expect(decodeURIComponent(img.getAttribute("src") ?? "").normalize("NFC")).toContain(want.file);
    }
    // Thứ tự màn rộng (cột 1–5): Phương | Yến | Hùng (CEO) | Dương | Trí.
    const slotOf = (li: HTMLElement) => Number(li.style.getPropertyValue("--slot"));
    const byCol = [...items].sort((a, b) => slotOf(a) - slotOf(b)).map((li) => li.dataset.role);
    expect(byCol).toEqual(["CTO", "CMO", "CEO", "CSO", "COO"]);
    expect(byCol[2]).toBe("CEO");
    expect(TEAM.core.map((m) => m.role)).toEqual(byCol);
  });

  it("chuyên gia đồng hành: đúng hai thẻ, đúng tên, vai trò và ảnh; không có lời trích chưa duyệt", () => {
    const { container } = renderLanding();
    const team = container.querySelector(`#${SECTION_IDS.team}`)! as HTMLElement;
    expect(within(team).getByRole("heading", { level: 3, name: "Chuyên gia đồng hành" })).toBeInTheDocument();
    const cards = Array.from(team.querySelectorAll<HTMLElement>("li[data-expert]"));
    expect(cards).toHaveLength(2);
    const want: Record<string, { name: string; file: string }> = {
      "chu-huy-anh": { name: "ThS. Chu Huy Anh", file: "ThS Chu Huy Anh - Chuyên gia.jpg" },
      "ha-manh-hung": { name: "TS. Hà Mạnh Hùng", file: "Tiến sĩ Hà Mạnh Hùng - Chuyên gia.jpg" },
    };
    for (const li of cards) {
      const w = want[li.dataset.expert!]!;
      expect(li.textContent).toContain(w.name);
      expect(li.textContent).toContain("Chuyên gia");
      const img = li.querySelector("img")!;
      expect(img.getAttribute("alt")).toBe(`${w.name}, Chuyên gia`);
      expect(decodeURIComponent(img.getAttribute("src") ?? "").normalize("NFC")).toContain(w.file);
    }
    // Lời đề xuất chưa được duyệt không xuất hiện ở trang công khai và không có lời trích đã duyệt nào.
    expect(team.querySelector("blockquote")).toBeNull();
    expect(team.textContent).not.toMatch(/Giá trị của CareLens AI không chỉ|Một giải pháp AI trong lĩnh vực chăm sóc/);
    expect(TEAM.experts.every((e) => e.quote === undefined)).toBe(true);
  });

  it("lời chuyên gia nháp chỉ hiện ở chế độ xem nháp, gắn đúng thẻ và có nhãn chưa xác nhận", async () => {
    window.history.pushState({}, "", "/?team-quotes=draft");
    try {
      const { container } = renderLanding();
      const team = container.querySelector(`#${SECTION_IDS.team}`)! as HTMLElement;
      await within(team).findAllByRole("blockquote");
      const byExpert = (id: string) => team.querySelector(`li[data-expert="${id}"]`)!;
      expect(byExpert("chu-huy-anh").querySelector("blockquote")!.textContent).toMatch(/^Giá trị của CareLens AI/);
      expect(byExpert("ha-manh-hung").querySelector("blockquote")!.textContent).toMatch(/^Một giải pháp AI/);
      for (const f of Array.from(team.querySelectorAll("figure"))) {
        expect(f.getAttribute("data-quote-state")).toBe("draft");
        expect(f.textContent).toContain("chưa được chuyên gia xác nhận");
      }
    } finally {
      window.history.pushState({}, "", "/");
    }
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
