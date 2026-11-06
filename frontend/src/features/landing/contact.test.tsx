import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ContactSubmitError, submitContactRequest, type ContactSubmitResult } from "../../data/contact/contactClient";
import { ContactSection } from "./ContactSection";
import { CONTACT } from "./content";
import { EMPTY_VALUES, buildPayload, phoneOk, validate } from "./contactForm";

type Submit = typeof submitContactRequest;

function setup(submit: Submit = vi.fn<Submit>()) {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ContactSection submit={submit} />
    </MemoryRouter>,
  );
  const pickGroup = (title: string) => user.click(within(screen.getByRole("group", { name: "Chọn nhóm khách hàng" })).getByRole("button", { name: new RegExp(title) }));
  const pickAction = (title: string) => user.click(within(screen.getByRole("group", { name: "Chọn nhu cầu" })).getByRole("button", { name: new RegExp(title.replace("/", "\\/")) }));
  const field = (label: RegExp) => screen.getByLabelText(label);
  return { user, pickGroup, pickAction, field, submit };
}

const result = (over: Partial<ContactSubmitResult> = {}): ContactSubmitResult => ({
  request_id: "CL-261104-7KQ3MZAB",
  category: "individual_consultation",
  received_at: "2026-11-04T03:00:00.000Z",
  duplicate: false,
  notification: { status: "sent" },
  ...over,
});

async function fillIndividualContact(s: ReturnType<typeof setup>) {
  await s.user.type(s.field(/^Họ và tên/), "Nguyễn Văn Thử");
  await s.user.type(s.field(/^Số điện thoại\b(?! người nhận)/), "0900 000 001");
  await s.user.type(s.field(/^Email/), "thu@example.invalid");
}

describe("Liên hệ và đặt mua: chọn nhóm, nhu cầu và biểu mẫu", () => {
  it("chỉ có hai nhóm; mỗi nhóm có đúng hai nhu cầu; biểu mẫu chỉ hiện sau khi chọn đủ", async () => {
    const s = setup();
    expect(screen.getByText(CONTACT.placeholderPick)).toBeInTheDocument();
    const groups = within(screen.getByRole("group", { name: "Chọn nhóm khách hàng" })).getAllByRole("button");
    expect(groups).toHaveLength(2);
    await s.pickGroup("Cá nhân và gia đình");
    expect(groups[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(CONTACT.placeholderAction)).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Chọn nhu cầu" })).getAllByRole("button").map((b) => b.textContent)).toEqual(
      CONTACT.actions.individual.map((a) => `${a.title}${a.why}`),
    );
    await s.pickGroup("Cơ sở chăm sóc y tế");
    expect(within(screen.getByRole("group", { name: "Chọn nhu cầu" })).getAllByRole("button").map((b) => b.textContent)).toEqual(
      CONTACT.actions.facility.map((a) => `${a.title}${a.why}`),
    );
  });

  it.each([
    ["Cá nhân và gia đình", "Tư vấn sản phẩm", "individual_consultation", ["Họ và tên", "Số điện thoại", "Email", "Bạn là gì của người được chăm sóc", "Lời nhắn"], ["Địa chỉ giao hàng", "Tên cơ sở / tổ chức", "Số lượng"]],
    ["Cá nhân và gia đình", "Yêu cầu đặt mua", "individual_purchase", ["Họ và tên", "Sản phẩm hoặc cấu hình quan tâm", "Số lượng", "Tên người nhận", "Số điện thoại người nhận", "Địa chỉ giao hàng", "Ghi chú giao hàng"], ["Tên cơ sở / tổ chức", "Bạn là gì của người được chăm sóc"]],
    ["Cơ sở chăm sóc y tế", "Tư vấn triển khai", "facility_consultation", ["Tên cơ sở / tổ chức", "Họ và tên người liên hệ", "Email công việc", "Loại cơ sở", "Chức danh", "Địa chỉ cơ sở", "Số người được chăm sóc (ước tính)", "Thời gian dự kiến triển khai", "Mô tả nhu cầu triển khai"], ["Địa chỉ giao hàng", "Số lượng thiết bị (ước tính)"]],
    ["Cơ sở chăm sóc y tế", "Báo giá / đặt mua", "facility_purchase", ["Tên cơ sở / tổ chức", "Họ và tên người liên hệ", "Email công việc", "Địa chỉ cơ sở", "Số lượng thiết bị (ước tính)", "Yêu cầu lắp đặt hoặc tích hợp"], ["Loại cơ sở", "Địa chỉ giao hàng"]],
  ] as const)("%s · %s: hiện đúng trường và lời nhắn gợi ý", async (group, action, variant, present, absent) => {
    const s = setup();
    await s.pickGroup(group);
    await s.pickAction(action);
    expect(screen.getByRole("heading", { level: 3, name: CONTACT.formTitle[variant] })).toBeInTheDocument();
    for (const label of present) expect(screen.getByLabelText(new RegExp(`^${label.replace(/[()/]/g, "\\$&")}`)), label).toBeInTheDocument();
    for (const label of absent) expect(screen.queryByLabelText(new RegExp(`^${label.replace(/[()/]/g, "\\$&")}`)), label).toBeNull();
    expect(screen.getByRole("textbox", { name: /^(Lời nhắn|Mô tả nhu cầu)/ })).toHaveValue(CONTACT.defaultMessage[variant]);
    // Bắt buộc và không bắt buộc được ghi rõ.
    expect(screen.getByText(CONTACT.requiredNote)).toBeInTheDocument();
    expect(screen.getAllByText(/\(không bắt buộc\)/).length).toBeGreaterThan(0);
  });

  it("lời nhắn gợi ý sửa được và mỗi biểu mẫu giữ lời nhắn riêng khi đổi qua lại", async () => {
    const s = setup();
    await s.pickGroup("Cá nhân và gia đình");
    await s.pickAction("Tư vấn sản phẩm");
    const msg = screen.getByRole("textbox", { name: /^Lời nhắn/ });
    await s.user.clear(msg);
    await s.user.type(msg, "Nội dung tôi tự viết");
    await s.pickAction("Yêu cầu đặt mua");
    expect(screen.getByRole("textbox", { name: /^Lời nhắn \/ yêu cầu thêm/ })).toHaveValue(CONTACT.defaultMessage.individual_purchase);
    await s.pickAction("Tư vấn sản phẩm");
    expect(screen.getByRole("textbox", { name: /^Lời nhắn/ })).toHaveValue("Nội dung tôi tự viết");
  });

  it("đổi nhu cầu hoặc nhóm không xóa thông tin đã nhập; trường dùng chung được giữ", async () => {
    const s = setup();
    await s.pickGroup("Cá nhân và gia đình");
    await s.pickAction("Tư vấn sản phẩm");
    await fillIndividualContact(s);
    await s.pickAction("Yêu cầu đặt mua");
    expect(s.field(/^Họ và tên/)).toHaveValue("Nguyễn Văn Thử");
    expect(s.field(/^Email/)).toHaveValue("thu@example.invalid");
    await s.user.type(s.field(/^Tên người nhận/), "Người Nhận");
    await s.pickGroup("Cơ sở chăm sóc y tế");
    await s.pickAction("Tư vấn triển khai");
    expect(s.field(/^Họ và tên người liên hệ/)).toHaveValue("Nguyễn Văn Thử");
    expect(s.field(/^Email công việc/)).toHaveValue("thu@example.invalid");
    await s.pickGroup("Cá nhân và gia đình");
    await s.pickAction("Yêu cầu đặt mua");
    expect(s.field(/^Tên người nhận/)).toHaveValue("Người Nhận");
  });

  it("kiểm tra trường bắt buộc, định dạng email và số điện thoại trước khi gửi; không gọi máy chủ khi còn lỗi", async () => {
    const s = setup();
    await s.pickGroup("Cá nhân và gia đình");
    await s.pickAction("Yêu cầu đặt mua");
    await s.user.type(s.field(/^Email/), "khong-phai-email");
    await s.user.click(screen.getByRole("button", { name: CONTACT.submit }));
    expect(s.submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Vui lòng kiểm tra lại \d+ mục/);
    expect(s.field(/^Họ và tên/)).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(s.field(/^Họ và tên/)).toHaveFocus());
    expect(s.field(/^Email/)).toHaveAccessibleDescription(CONTACT.errors.email);
    expect(s.field(/^Địa chỉ giao hàng/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(CONTACT.errors.consent)).toBeInTheDocument();
    // Trường không bắt buộc không báo lỗi khi để trống.
    expect(s.field(/^Sản phẩm hoặc cấu hình quan tâm/)).not.toHaveAttribute("aria-invalid");
  });

  it("đang gửi thì khóa biểu mẫu và nút; thành công hiện mã yêu cầu do máy chủ trả và không hứa giá hay giao hàng", async () => {
    let resolve!: (r: ContactSubmitResult) => void;
    const submit = vi.fn<Submit>(() => new Promise((r) => (resolve = r)));
    const s = setup(submit);
    await s.pickGroup("Cá nhân và gia đình");
    await s.pickAction("Yêu cầu đặt mua");
    await fillIndividualContact(s);
    await s.user.type(s.field(/^Tên người nhận/), "Người Nhận");
    await s.user.type(s.field(/^Số điện thoại người nhận/), "0900000003");
    await s.user.type(s.field(/^Địa chỉ giao hàng/), "Số 1 Đường Thử");
    await s.user.click(screen.getByRole("checkbox", { name: /Tôi đồng ý/ }));
    await s.user.click(screen.getByRole("button", { name: CONTACT.submit }));
    const busy = screen.getByRole("button", { name: CONTACT.submitting });
    expect(busy).toBeDisabled();
    expect(s.field(/^Họ và tên/)).toBeDisabled();
    await s.user.click(busy);
    expect(submit).toHaveBeenCalledTimes(1);
    const payload = submit.mock.calls[0]![0];
    expect(payload).toEqual({
      category: "individual_purchase",
      website: "",
      full_name: "Nguyễn Văn Thử",
      phone: "0900 000 001",
      email: "thu@example.invalid",
      product_interest: null,
      quantity: 1,
      recipient_name: "Người Nhận",
      recipient_phone: "0900000003",
      delivery_address: "Số 1 Đường Thử",
      delivery_notes: null,
      message: CONTACT.defaultMessage.individual_purchase,
      consent: true,
      privacy_notice_version: "contact-notice-2026-11-06",
    });
    resolve(result({ category: "individual_purchase" }));
    const done = await screen.findByTestId("contact-success");
    expect(within(done).getByTestId("contact-reference")).toHaveTextContent("CL-261104-7KQ3MZAB");
    expect(done).toHaveTextContent(CONTACT.success.purchase);
    expect(done).toHaveFocus();
    expect(screen.queryByTestId("contact-notification-delayed")).toBeNull();
    expect(done.textContent).not.toMatch(/đã xác nhận đơn|giao trong|₫|VND/);
    // Gửi yêu cầu khác: giữ thông tin liên hệ, bỏ đồng ý, lời nhắn về gợi ý.
    await s.user.click(within(done).getByRole("button", { name: CONTACT.success.again }));
    expect(s.field(/^Họ và tên/)).toHaveValue("Nguyễn Văn Thử");
    expect(screen.getByRole("checkbox", { name: /Tôi đồng ý/ })).not.toBeChecked();
    // Nút vừa bấm đã biến mất: focus về ô đầu của biểu mẫu, không rơi về <body>.
    await waitFor(() => expect(s.field(/^Họ và tên/)).toHaveFocus());
  });

  it.each([
    ["pending", CONTACT.success.notificationPending],
    ["failed", CONTACT.success.notificationPending],
    ["not_configured", CONTACT.success.notificationNotConfigured],
  ] as const)("thông báo email '%s' thì nói rõ yêu cầu đã lưu và email chưa gửi, không giả là đã báo", async (status, text) => {
    const s = setup(vi.fn<Submit>(async () => result({ notification: { status } })));
    await s.pickGroup("Cá nhân và gia đình");
    await s.pickAction("Tư vấn sản phẩm");
    await fillIndividualContact(s);
    await s.user.click(screen.getByRole("checkbox", { name: /Tôi đồng ý/ }));
    await s.user.click(screen.getByRole("button", { name: CONTACT.submit }));
    const note = await screen.findByTestId("contact-notification-delayed");
    expect(note).toHaveTextContent(text);
    expect(screen.getByTestId("contact-success").textContent).not.toMatch(/đã gửi email|đã thông báo|đã báo cho đội ngũ/i);
  });

  it("không câu nào trên màn hình thành công khẳng định email đã tới nơi, kể cả khi máy chủ báo 'sent'", async () => {
    const s = setup(vi.fn<Submit>(async () => result({ notification: { status: "sent" } })));
    await s.pickGroup("Cá nhân và gia đình");
    await s.pickAction("Tư vấn sản phẩm");
    await fillIndividualContact(s);
    await s.user.click(screen.getByRole("checkbox", { name: /Tôi đồng ý/ }));
    await s.user.click(screen.getByRole("button", { name: CONTACT.submit }));
    const done = await screen.findByTestId("contact-success");
    expect(screen.queryByTestId("contact-notification-delayed")).toBeNull();
    expect(done.textContent).not.toMatch(/đã gửi email|email xác nhận đã|đã nhận được email/i);
    expect(done).toHaveTextContent(CONTACT.success.body);
  });

  it("gửi thất bại thì hiện lỗi, giữ nguyên nội dung và cho gửi lại; lỗi 422 của máy chủ đánh dấu đúng trường", async () => {
    const submit = vi
      .fn<Submit>()
      .mockRejectedValueOnce(new ContactSubmitError("network"))
      .mockRejectedValueOnce(new ContactSubmitError("invalid", ["email"]))
      .mockResolvedValueOnce(result());
    const s = setup(submit);
    await s.pickGroup("Cá nhân và gia đình");
    await s.pickAction("Tư vấn sản phẩm");
    await fillIndividualContact(s);
    await s.user.click(screen.getByRole("checkbox", { name: /Tôi đồng ý/ }));
    await s.user.click(screen.getByRole("button", { name: CONTACT.submit }));
    expect(await screen.findByRole("alert")).toHaveTextContent(CONTACT.failure.network);
    expect(s.field(/^Họ và tên/)).toHaveValue("Nguyễn Văn Thử");
    expect(screen.getByRole("button", { name: CONTACT.submit })).toBeEnabled();
    await s.user.click(screen.getByRole("button", { name: CONTACT.submit }));
    expect(await screen.findByText(CONTACT.failure.invalid, { selector: "[role=alert]" })).toBeInTheDocument();
    expect(s.field(/^Email/)).toHaveAttribute("aria-invalid", "true");
    await s.user.click(screen.getByRole("button", { name: CONTACT.submit }));
    expect(await screen.findByTestId("contact-success")).toBeInTheDocument();
  });

  it("yêu cầu trùng: hiện mã của yêu cầu đã lưu", async () => {
    const s = setup(vi.fn<Submit>(async () => result({ duplicate: true })));
    await s.pickGroup("Cá nhân và gia đình");
    await s.pickAction("Tư vấn sản phẩm");
    await fillIndividualContact(s);
    await s.user.click(screen.getByRole("checkbox", { name: /Tôi đồng ý/ }));
    await s.user.click(screen.getByRole("button", { name: CONTACT.submit }));
    expect(await screen.findByTestId("contact-success")).toHaveTextContent(CONTACT.success.duplicate);
  });
});

describe("contactForm", () => {
  it("số điện thoại", () => {
    for (const ok of ["0900000001", "0900 000 001", "+84 90 000 0001", "(028) 3800-0000"]) expect(phoneOk(ok), ok).toBe(true);
    for (const bad of ["12345", "abc0900000001", "09000000x1", ""]) expect(phoneOk(bad), bad).toBe(false);
  });

  it("số lượng và độ dài theo giới hạn của máy chủ", () => {
    const base = { ...EMPTY_VALUES, organization: "Cơ sở", full_name: "A", email: "a@b.vn", phone: "0900000001", address: "X", consent: true };
    expect(validate("facility_purchase", { ...base, device_quantity: "0" }, "")).toHaveProperty("device_quantity");
    expect(validate("facility_purchase", { ...base, device_quantity: "10001" }, "")).toHaveProperty("device_quantity");
    expect(validate("facility_purchase", { ...base, device_quantity: "2.5" }, "")).toHaveProperty("device_quantity");
    expect(validate("facility_purchase", { ...base, device_quantity: "25" }, "")).toEqual({});
    expect(validate("facility_purchase", { ...base, device_quantity: "25", full_name: "a".repeat(121) }, "")).toHaveProperty("full_name");
    expect(buildPayload("facility_purchase", { ...base, device_quantity: " 25 " }, " ")).toMatchObject({ device_quantity: 25, message: null, job_title: null });
  });
});

describe("contactClient", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("gửi JSON tới đúng đường dẫn, không gửi cookie, trả kết quả của máy chủ", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(201, result()));
    const r = await submitContactRequest({ category: "individual_consultation" }, { apiBase: "https://api.example", fetchImpl });
    expect(r.request_id).toBe("CL-261104-7KQ3MZAB");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example/api/public/v1/contact-requests");
    expect(init).toMatchObject({ method: "POST", credentials: "omit" });
  });

  it.each([
    [422, { code: "invalid_payload", fields: ["email", 3] }, "invalid", ["email"]],
    [429, { code: "too_many_requests" }, "rate_limited", []],
    [403, { code: "origin_not_allowed" }, "rejected", []],
    [503, { code: "submission_not_stored" }, "server", []],
    [201, { unexpected: true }, "server", []],
  ])("HTTP %i → lỗi %s", async (status, body, kind, fields) => {
    const err = await submitContactRequest({}, { apiBase: "https://api.example", fetchImpl: async () => json(status, body) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContactSubmitError);
    expect(err).toMatchObject({ kind, fields });
  });

  it("không có máy chủ hoặc lỗi mạng", async () => {
    await expect(submitContactRequest({}, { apiBase: null })).rejects.toMatchObject({ kind: "no_backend" });
    await expect(submitContactRequest({}, { apiBase: "https://api.example", fetchImpl: async () => Promise.reject(new TypeError("offline")) })).rejects.toMatchObject({ kind: "network" });
  });
});

/** The privacy notice + consent wording each version stands for. Changing the wording without a new version fails here;
 * a new version must also be the one the Worker accepts (PRIVACY_NOTICE_VERSIONS in worker/src/contact.ts). */
const NOTICE_DIGESTS: Record<string, string> = {
  "contact-notice-2026-11-06": "0a47d9f8ec755c563559d779b56381098f0fa5f9b59df834b676320c4b198a83",
};
const noticeDigest = () => createHash("sha256").update(JSON.stringify({ privacy: CONTACT.privacy, consent: CONTACT.labels.consent })).digest("hex");

describe("thông báo quyền riêng tư (A44)", () => {
  it("phiên bản gửi lên khớp nội dung đang hiển thị và là phiên bản duy nhất Worker chấp nhận", () => {
    expect(NOTICE_DIGESTS[CONTACT.privacyNoticeVersion]).toBe(noticeDigest());
    const worker = readFileSync(resolve(process.cwd(), "../backend/care-monitoring/worker/src/contact.ts"), "utf8");
    const accepted = /PRIVACY_NOTICE_VERSIONS = \[([^\]]*)\] as const/.exec(worker)?.[1];
    expect(accepted?.split(",").map((s) => s.trim().replace(/^"|"$/g, ""))).toEqual([CONTACT.privacyNoticeVersion]);
    expect(buildPayload("individual_consultation", EMPTY_VALUES, "")).toMatchObject({ privacy_notice_version: CONTACT.privacyNoticeVersion });
  });

  it("nói rõ mục đích, Resend, thời hạn lưu, cách xem/xóa và không dùng cho quảng cáo; khớp thời hạn của Worker", () => {
    const text = CONTACT.privacy.join(" ");
    expect(text).toMatch(/liên hệ, tư vấn và xử lý yêu cầu/);
    expect(text).toMatch(/Resend/);
    expect(text).toMatch(/không dùng cho quảng cáo/);
    expect(text).toMatch(/xem hoặc xóa thông tin/);
    expect(text).toMatch(/xác minh/);
    const worker = readFileSync(resolve(process.cwd(), "../backend/care-monitoring/worker/src/contact.ts"), "utf8");
    const days = /CLOSED_RETENTION_DAYS = (\d+)/.exec(worker)?.[1];
    const months = /INACTIVITY_CLOSE_MONTHS = (\d+)/.exec(worker)?.[1];
    expect(text).toContain(`sau ${days} ngày`);
    expect(text).toContain(`trong ${months} tháng`);
  });

  it("hiển thị trong phần liên hệ như một danh sách", () => {
    render(
      <MemoryRouter>
        <ContactSection submit={vi.fn<Submit>()} />
      </MemoryRouter>,
    );
    const notice = screen.getByTestId("contact-privacy");
    expect(within(notice).getAllByRole("listitem").map((li) => li.textContent)).toEqual([...CONTACT.privacy]);
  });
});
