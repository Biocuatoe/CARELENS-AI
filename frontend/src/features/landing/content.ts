/**
 * Copy landing CareLens AI (A19). Mọi câu nói về năng lực đều gắn với một trong ba trạng thái:
 * đang hoạt động, mô phỏng, khái niệm (`CapabilityKind`). Không có số liệu độ chính xác, chứng nhận, đối tác, giá hay lời chứng thực.
 */

export const SECTION_IDS = {
  device: "thiet-bi",
  scenarios: "tinh-huong",
  activity: "hoat-dong",
  privacy: "rieng-tu",
  team: "doi-ngu",
  contact: "lien-he",
} as const;

export const NAV_ITEMS = [
  { id: SECTION_IDS.device, label: "Thiết bị" },
  { id: SECTION_IDS.scenarios, label: "Tình huống" },
  { id: SECTION_IDS.privacy, label: "Riêng tư" },
  { id: SECTION_IDS.team, label: "Đội ngũ" },
] as const;

export const CTA = {
  explore: "Mở thiết bị ra xem",
  contact: "Liên hệ",
  login: "Đăng nhập",
  app: "Vào ứng dụng",
} as const;

export const TAGLINE = ["SEE MORE.", "STORE LESS.", "CARE BETTER."] as const;

export const HERO = {
  headline: "Một thiết bị đeo nhỏ, để người chăm sóc nhìn thấy nhiều hơn.",
  scrollCue: "Cuộn để mở nắp",
  outro: "Cuộn tiếp để xem tình huống sử dụng",
  taglineNote: "Khẩu hiệu là định hướng sản phẩm, không phải cam kết kỹ thuật.",
} as const;

export const FALL = {
  eyebrow: "Tình huống 01 · An toàn",
  heading: "Khi tư thế thay đổi đột ngột, người chăm sóc biết sớm hơn.",
  body: "Cảm biến chuyển động và camera bổ sung cho nhau để nhận ra khoảnh khắc đáng chú ý như ngã. Hub chuyển sự kiện tới máy chủ đám mây CareLens AI, rồi người chăm sóc nhận mô tả ngắn để kiểm tra.",
  demoLabel: "Ví dụ tình huống: cuộn hoặc chọn từng bước",
  steps: [
    { id: "normal", label: "Bình thường", caption: "Sinh hoạt bình thường. Không có gì đáng chú ý nên không có thông báo." },
    { id: "change", label: "Thay đổi đột ngột", caption: "Tư thế thay đổi đột ngột. Hệ thống cần thêm bằng chứng trước khi tạo sự kiện." },
    { id: "notify", label: "Gửi mô tả", caption: "Hub chuyển sự kiện tới máy chủ đám mây CareLens AI, rồi gửi thông báo văn bản. Người chăm sóc kiểm tra và ghi lại kết quả." },
  ],
  notification: {
    title: "Ví dụ sự kiện chăm sóc",
    body: "Có thể có người nằm trên sàn phòng khách.",
    flag: "Nhận định của AI, chưa được người chăm sóc xác nhận.",
    action: "Tiếp nhận kiểm tra",
  },
  figureLabel: "Minh hoạ 3D: một người lớn tuổi mất thăng bằng và ngã trong phòng khách, thiết bị trên ngực ghi nhận thay đổi. Không phải dữ liệu đo.",
  staticNote: "Trình duyệt này không dựng được cảnh 3D. Ba bước bên dưới mô tả cùng tình huống.",
  acknowledged: "Đã tiếp nhận · Chưa có kết quả kiểm tra",
} as const;

export interface MedSlot {
  id: string;
  label: string;
  scheduled: number;
  /** Phút từ 0h tới thời điểm quan sát (mô phỏng), hoặc null nếu không có quan sát. */
  observed: number | null;
}

export const MEDICATION = {
  eyebrow: "Tình huống 02 · Hỗ trợ dùng thuốc",
  heading: "Nhắc đúng lúc. Hỏi lại khi chưa thấy dấu hiệu.",
  body: "Người chăm sóc đặt lịch; tới giờ, loa có thể nhắc nhẹ. Nếu camera ghi nhận một khoảnh khắc phù hợp, hub tạo ghi chú quan sát. Nếu không, người chăm sóc nhận lời nhắc hỏi lại.",
  rule: "Không quan sát được không có nghĩa là chưa uống thuốc.",
  ruleBody: "Thiết bị chỉ ghi nhận điều nó thấy. Việc xác nhận dùng thuốc luôn do con người quyết định.",
  scene: {
    label: "Các bước quan sát hoạt động",
    figureLabel: "Minh hoạ 3D: một người cầm ly nước ở quầy, camera trên ngực quan sát, khung hình được đóng gói, đi qua hub rồi tới máy chủ đám mây CareLens AI. Không phải dữ liệu đo.",
    steps: [
      { id: "action", label: "Một hành động", caption: "Người đeo thiết bị cầm ly nước ở quầy bếp." },
      { id: "observe", label: "Camera quan sát", caption: "Camera trên ngực thấy bàn tay và chiếc ly trong khung hình." },
      { id: "packet", label: "Thành gói dữ liệu", caption: "Khung hình được đóng băng và thu nhỏ thành một gói dữ liệu." },
      { id: "send", label: "Gửi tới hub", caption: "Gói dữ liệu đi tới hub, trạm trung gian trước khi lên máy chủ đám mây CareLens AI." },
    ],
    deviceLabel: "Camera đeo ngực",
    hubLabel: "Hub trong nhà",
    staticNote: "Trình duyệt này không dựng được cảnh 3D. Các bước bên dưới mô tả cùng quy trình.",
  },
  demoLabel: "Ví dụ một ngày: kéo để đổi giờ",
  windowMinutes: 90,
  slots: [
    { id: "morning", label: "Sáng", scheduled: 8 * 60, observed: 8 * 60 + 12 },
    { id: "noon", label: "Trưa", scheduled: 13 * 60, observed: null },
    { id: "evening", label: "Tối", scheduled: 20 * 60, observed: 20 * 60 + 5 },
  ] satisfies readonly MedSlot[],
  states: {
    waiting: { label: "Chưa tới giờ", note: "Chờ lịch." },
    open: { label: "Đang trong khung giờ", note: "Loa có thể nhắc nhẹ. Hub chờ quan sát." },
    observed: { label: "Có ghi chú quan sát", note: "Người chăm sóc có thể xem lại mô tả và xác nhận." },
    missed: { label: "Chưa ghi nhận quan sát", note: "Nhắc người chăm sóc hỏi lại. Không kết luận đã uống hay chưa." },
  },
} as const;

/** Lời trích chỉ hiển thị khi có đủ người duyệt và ngày duyệt. Bản nháp chưa duyệt nằm ở `teamQuotes.draft.ts`, không ở đây. */
export interface ExpertQuote {
  text: string;
  approvedBy: string;
  approvedAt: string;
}
export interface Expert {
  id: string;
  name: string;
  file: string;
  quote?: ExpertQuote;
}

/**
 * Đội ngũ. Tên và vai trò do chủ dự án cung cấp; `file` là tên tệp ảnh trong `members/` ở gốc dự án (không sao chép, không đổi tên).
 * Không thêm tiểu sử, học vị, cơ quan hay thành tích nào ngoài những gì ghi ở đây.
 */
export const TEAM = {
  eyebrow: "Con người phía sau sản phẩm",
  heading: "Đội ngũ của chúng tôi",
  coreLabel: "Đội ngũ cốt lõi",
  /** Năm thành viên theo thứ tự hàng ngang trên màn rộng: CEO ở chính giữa (vị trí 3), hai người mỗi bên. */
  core: [
    { role: "CTO", name: "Đinh Hoàng Phương", file: "Đinh Hoàng Phương - CTO.jpg" },
    { role: "CMO", name: "Nguyễn Hải Yến", file: "Nguyễn Hải Yến - CMO.JPG" },
    { role: "CEO", name: "Lê Đức Hùng", file: "Lê Đức Hùng - CEO.jpg" },
    { role: "CSO", name: "Vũ Bình Dương", file: "Vũ Bình Dương - CSO.jpg" },
    { role: "COO", name: "Vũ Hữu Trí", file: "Vũ Hữu Trí - COO.jpg" },
  ],
  /** Hai chuyên gia đồng hành, trọng lượng thị giác ngang nhau. Học hàm lấy theo chủ dự án ("TS."); tên tệp ảnh ghi "Tiến sĩ". */
  expertsHeading: "Chuyên gia đồng hành",
  expertsRole: "Chuyên gia",
  experts: [
    { id: "chu-huy-anh", name: "ThS. Chu Huy Anh", file: "ThS Chu Huy Anh - Chuyên gia.jpg" },
    { id: "ha-manh-hung", name: "TS. Hà Mạnh Hùng", file: "Tiến sĩ Hà Mạnh Hùng - Chuyên gia.jpg" },
  ] as readonly Expert[],
} as const;

/**
 * Chương bảo vệ dữ liệu, nối tiếp cảnh quan sát trên cùng khung 3D và dẫn vào phần Riêng tư. Khiên và chuỗi dạng mã băm là hình minh hoạ:
 * repo không có bước băm, mã hoá hay ẩn danh hoá nào. Điều đã áp dụng thật là ứng dụng chỉ nhận mô tả dạng văn bản.
 */
export const SECURITY_SCENE = {
  label: "Các bước bảo vệ dữ liệu",
  chapters: ["Quan sát", "Bảo vệ dữ liệu"],
  figureLabel: "Tiếp theo, từ hub, cũng gói dữ liệu đó đi tới máy chủ đám mây CareLens AI (tấm khiên phía trên hub), tách thành các ô lục giác rồi thu lại thành một chuỗi ký tự ngắn. Đây là hình minh hoạ, không phải bằng chứng kỹ thuật.",
  steps: [
    { id: "shield", label: "Lên máy chủ đám mây", caption: "Hub chuyển dữ liệu liên quan tới máy chủ đám mây CareLens AI." },
    { id: "fragment", label: "Tách thành các phần", caption: "Dữ liệu được tách thành các phần nhỏ hơn." },
    { id: "digest", label: "Chỉ còn bản rút gọn", caption: "Ứng dụng chỉ nhận mô tả dạng văn bản." },
  ],
  note: "Khiên và chuỗi dạng mã băm chỉ là hình minh hoạ, không chứng minh hệ thống băm, mã hoá hay ẩn danh hoá dữ liệu. Riêng việc băm cũng không đủ để bảo đảm an toàn.",
  shieldLabel: "Máy chủ đám mây CareLens AI",
  digestLabel: "Bản rút gọn",
} as const;

/**
 * Bản báo cáo ngày mẫu ở cuối cảnh 3D: dữ liệu minh hoạ cố định, có nhãn. Không có số đo, độ chính xác hay kết luận y khoa; mô tả là của AI và
 * chưa được con người xác nhận; "đã tiếp nhận" khác "đã xử lý". Phần tóm tắt cho người chăm sóc được suy ra từ chính danh sách sự kiện.
 */
export type ReportEventStatus = "note" | "unobserved" | "alert";

export const DAILY_REPORT = {
  heading: "Tổng quan hôm nay",
  meta: "Báo cáo trong ngày",
  sampleLabel: "Ví dụ báo cáo",
  timelineLabel: "Các sự kiện theo thời gian",
  events: [
    { id: "walk", time: "07:05", title: "Đi lại trong nhà", note: "Hub ghi nhận người được chăm sóc đi lại ở phòng khách.", status: "note" },
    { id: "glass", time: "08:20", title: "Cầm ly nước", note: "Hub ghi nhận một lần cầm ly nước ở bếp. Chưa xác nhận đó là việc dùng thuốc.", status: "note" },
    { id: "reminder", time: "12:00", title: "Giờ nhắc dùng thuốc", note: "Chưa quan sát được gì trong khung giờ này. Điều đó không có nghĩa là chưa uống thuốc.", status: "unobserved" },
    { id: "posture", time: "15:40", title: "Tư thế thay đổi đột ngột", note: "Cảnh báo được tạo. Người chăm sóc đã tiếp nhận lúc 15:48, chưa đóng.", status: "alert" },
  ] as ReadonlyArray<{ id: string; time: string; title: string; note: string; status: ReportEventStatus }>,
  statusLabels: { note: "Ghi chú", unobserved: "Chưa có quan sát", alert: "Đang mở · đã tiếp nhận" } as Record<ReportEventStatus, string>,
  summaryTitle: "Dành cho người chăm sóc",
  footnote: "Mô tả do AI tạo, chưa được con người xác nhận.",
} as const;

/** Tóm tắt ngắn cho người chăm sóc, đếm từ danh sách sự kiện nên không bao giờ lệch với dòng thời gian. */
export function reportSummary(events: ReadonlyArray<{ time: string; status: ReportEventStatus }>): string[] {
  const open = events.filter((e) => e.status === "alert").length;
  const gaps = events.filter((e) => e.status === "unobserved");
  const lines: string[] = [];
  lines.push(open > 0 ? `${open} cảnh báo đang mở: đã được tiếp nhận, chưa được đóng.` : "Không có cảnh báo đang mở.");
  if (gaps.length > 0) lines.push(`${gaps.length} mốc nhắc chưa có quan sát (${gaps.map((g) => g.time).join(", ")}). Hãy hỏi lại người được chăm sóc.`);
  return lines;
}

export const PRIVACY = {
  eyebrow: "Riêng tư · phẩm giá · người chăm sóc",
  heading: "Thấy đủ để chăm sóc. Không hơn.",
  principles: [
    {
      id: "privacy",
      title: "Riêng tư theo thiết kế",
      body: "Ứng dụng chỉ nhận mô tả dạng văn bản.",
    },
    {
      id: "dignity",
      title: "Phẩm giá của người được chăm sóc",
      body: "Người được chăm sóc là chủ thể, không phải đối tượng bị giám sát. Thiết bị có công tắc BẬT/TẮT vật lý để họ tự quyết định.",
    },
    {
      id: "awareness",
      title: "Người chăm sóc luôn biết mình đang thấy gì",
      body: "Mỗi người chỉ xem hồ sơ được cấp quyền. Không có dữ liệu khác với không có bất thường; mất kết nối được báo riêng.",
    },
  ],
  shows: { title: "Ứng dụng hiển thị", items: ["Thời điểm và loại sự kiện", "Mức chú ý, ghi là điểm AI, không phải xác suất", "Mô tả ngắn, ghi là chưa được xác nhận", "Trạng thái kết nối và lần cập nhật cuối"] },
  hides: { title: "Ứng dụng không có", items: ["Ảnh, video hoặc khung hình", "Xem camera trực tiếp", "Nhận diện khuôn mặt", "Chẩn đoán hoặc lời khuyên điều trị"] },
  taglineTitle: "Về khẩu hiệu",
  taglineBody: "Thấy điều cần thấy, giữ lại ít dữ liệu nhất có thể, chăm sóc tốt hơn. Bảo đảm về riêng tư chỉ có thể đưa ra sau khi hub và thiết bị được kiểm toán.",
} as const;

/**
 * Liên hệ và yêu cầu đặt mua (A43). Biểu mẫu gửi tới máy chủ CareLens AI (Cloudflare Worker), lưu trong D1 và báo cho đội ngũ qua email.
 * Đây là **yêu cầu**, không phải đơn hàng: không có giá, tồn kho, thời gian giao hay thanh toán. Repo chưa có danh mục sản phẩm đã duyệt,
 * nên ô sản phẩm là chữ tự do, không có mã hay cấu hình bịa ra. Không hỏi thông tin y tế.
 */
export const CONTACT = {
  eyebrow: "Liên hệ và đặt mua",
  heading: "Liên hệ với chúng tôi",
  body: "Gửi yêu cầu tư vấn hoặc đặt mua. Đội ngũ CareLens AI sẽ liên hệ lại để trao đổi và xác nhận thông tin.",
  stepGroup: "Bạn là",
  stepAction: "Bạn cần",
  groups: [
    { id: "individual", title: "Cá nhân và gia đình", why: "Chăm sóc và đồng hành cùng người thân tại nhà." },
    { id: "facility", title: "Cơ sở chăm sóc y tế", why: "Viện dưỡng lão, bệnh viện, phòng khám, dịch vụ chăm sóc." },
  ],
  actions: {
    individual: [
      { id: "individual_consultation", title: "Tư vấn sản phẩm", why: "Tìm hiểu giải pháp có phù hợp với gia đình bạn." },
      { id: "individual_purchase", title: "Yêu cầu đặt mua", why: "Đăng ký mua, đội ngũ liên hệ xác nhận." },
    ],
    facility: [
      { id: "facility_consultation", title: "Tư vấn triển khai", why: "Trao đổi về thử nghiệm, triển khai hoặc hợp tác." },
      { id: "facility_purchase", title: "Báo giá / đặt mua", why: "Nhận báo giá theo số lượng và phương án triển khai." },
    ],
  },
  formTitle: {
    individual_consultation: "Yêu cầu tư vấn sản phẩm",
    individual_purchase: "Yêu cầu đặt mua thiết bị",
    facility_consultation: "Yêu cầu tư vấn triển khai",
    facility_purchase: "Yêu cầu báo giá / đặt mua",
  },
  defaultMessage: {
    individual_consultation:
      "Xin chào CareLens AI, tôi muốn tìm hiểu về giải pháp CareLens AI và cách thiết bị có thể hỗ trợ chăm sóc, theo dõi người thân trong gia đình.",
    individual_purchase:
      "Xin chào CareLens AI, tôi muốn đăng ký yêu cầu đặt mua thiết bị. Mong đội ngũ liên hệ để xác nhận sản phẩm, giá bán và thông tin giao nhận.",
    facility_consultation:
      "Xin chào CareLens AI, chúng tôi đại diện cho một cơ sở chăm sóc y tế và mong muốn trao đổi về khả năng triển khai, thử nghiệm hoặc hợp tác cùng giải pháp CareLens AI.",
    facility_purchase:
      "Xin chào CareLens AI, chúng tôi muốn nhận tư vấn và báo giá cho nhu cầu triển khai thiết bị tại cơ sở. Mong đội ngũ liên hệ để trao đổi thêm về số lượng, phương án triển khai và chi phí.",
  },
  placeholderPick: "Chọn nhóm của bạn để bắt đầu.",
  placeholderAction: "Chọn nhu cầu để hiện biểu mẫu phù hợp.",
  required: "Bắt buộc",
  optional: "Không bắt buộc",
  requiredNote: "Mục có dấu * là bắt buộc.",
  sections: { contact: "Thông tin liên hệ", needs: "Nhu cầu", delivery: "Thông tin giao nhận", organization: "Thông tin cơ sở" },
  labels: {
    full_name: "Họ và tên",
    contact_name: "Họ và tên người liên hệ",
    phone: "Số điện thoại",
    email: "Email",
    work_email: "Email công việc",
    relationship: "Bạn là gì của người được chăm sóc",
    interests: "Bạn quan tâm đến",
    product_interest: "Sản phẩm hoặc cấu hình quan tâm",
    quantity: "Số lượng",
    recipient_name: "Tên người nhận",
    recipient_phone: "Số điện thoại người nhận",
    delivery_address: "Địa chỉ giao hàng",
    delivery_notes: "Ghi chú giao hàng",
    organization: "Tên cơ sở / tổ chức",
    facility_type: "Loại cơ sở",
    job_title: "Chức danh",
    address: "Địa chỉ cơ sở",
    care_recipients_estimate: "Số người được chăm sóc (ước tính)",
    device_quantity: "Số lượng thiết bị (ước tính)",
    timeline: "Thời gian dự kiến triển khai",
    integration_requirements: "Yêu cầu lắp đặt hoặc tích hợp",
    message: "Lời nhắn",
    message_needs: "Mô tả nhu cầu triển khai",
    message_extra: "Lời nhắn / yêu cầu thêm",
    consent: "Tôi đồng ý để CareLens AI dùng thông tin trên để liên hệ về yêu cầu này.",
  },
  hints: {
    product_interest: "Nếu chưa rõ, có thể để trống. Đội ngũ sẽ tư vấn cấu hình phù hợp.",
    message: "Bạn có thể sửa nội dung gợi ý. Vui lòng không gửi hồ sơ bệnh án hay thông tin sức khỏe chi tiết.",
    quantity: "Giá và tình trạng hàng sẽ được đội ngũ xác nhận khi liên hệ.",
  },
  choose: "Chọn…",
  relationships: [
    { id: "self", label: "Bản thân" },
    { id: "parent", label: "Cha hoặc mẹ" },
    { id: "grandparent", label: "Ông hoặc bà" },
    { id: "other_family", label: "Người thân khác trong gia đình" },
    { id: "other", label: "Khác" },
  ],
  interests: [
    { id: "incident_alerts", label: "Cảnh báo khi có sự cố" },
    { id: "reminders", label: "Nhắc uống nước, uống thuốc" },
    { id: "daily_summary", label: "Tóm tắt hằng ngày cho người thân" },
    { id: "setup_and_use", label: "Lắp đặt và sử dụng thiết bị" },
    { id: "privacy", label: "Quyền riêng tư và dữ liệu" },
    { id: "pricing_and_purchase", label: "Chi phí và cách đặt mua" },
  ],
  facilityTypes: [
    { id: "nursing_home", label: "Viện dưỡng lão / trung tâm dưỡng lão" },
    { id: "hospital", label: "Bệnh viện" },
    { id: "clinic", label: "Phòng khám" },
    { id: "home_care", label: "Dịch vụ chăm sóc tại nhà" },
    { id: "rehabilitation", label: "Cơ sở phục hồi chức năng" },
    { id: "other", label: "Khác" },
  ],
  timelines: [
    { id: "within_1_month", label: "Trong 1 tháng" },
    { id: "1_3_months", label: "1–3 tháng" },
    { id: "3_6_months", label: "3–6 tháng" },
    { id: "over_6_months", label: "Trên 6 tháng" },
    { id: "undecided", label: "Chưa xác định" },
  ],
  errors: {
    required: "Vui lòng nhập thông tin này.",
    choose: "Vui lòng chọn.",
    email: "Email chưa đúng định dạng, ví dụ ten@tenmien.vn.",
    phone: "Số điện thoại cần 8–15 chữ số, có thể bắt đầu bằng +.",
    count: "Nhập số nguyên từ 1 đến {max}.",
    tooLong: "Nội dung quá dài (tối đa {max} ký tự).",
    consent: "Cần đồng ý để đội ngũ có thể liên hệ với bạn.",
    summary: "Vui lòng kiểm tra lại {n} mục chưa hợp lệ.",
  },
  submit: "Gửi yêu cầu",
  submitting: "Đang gửi…",
  privacyTitle: "Quyền riêng tư",
  /** Thông báo quyền riêng tư (A44): mục đích, bên xử lý email (Resend), thời hạn lưu, cách xem/xóa, không quảng cáo.
   * Thời hạn khớp backend/care-monitoring/worker/src/contact.ts (CLOSED_RETENTION_DAYS, INACTIVITY_CLOSE_MONTHS). */
  privacy: [
    "Thông tin bạn gửi chỉ dùng để liên hệ, tư vấn và xử lý yêu cầu này; không dùng cho quảng cáo hay mục đích không liên quan.",
    "Để báo cho đội ngũ, nội dung yêu cầu được gửi qua Resend, dịch vụ chuyển email mà CareLens AI sử dụng.",
    "Yêu cầu đã xử lý xong được xóa khỏi máy chủ sau 180 ngày. Yêu cầu không có trao đổi trong 12 tháng được coi là đã xử lý xong.",
    "Để xem hoặc xóa thông tin của bạn, hãy gửi một yêu cầu tư vấn mới ghi rõ mã yêu cầu. Đội ngũ sẽ xác minh qua email hoặc số điện thoại bạn đã cung cấp trước khi thực hiện.",
    "Đây là yêu cầu, chưa phải đơn hàng; không có thanh toán trực tuyến.",
  ],
  /** Phiên bản của thông báo (`privacy`) và câu đồng ý (`labels.consent`) mà biểu mẫu hiển thị; máy chủ lưu kèm thời điểm đồng ý.
   * Đổi một trong hai thì phải đặt phiên bản mới ở đây, trong PRIVACY_NOTICE_VERSIONS của Worker và trong contact.test.tsx
   * (test so mã băm nội dung với phiên bản). */
  privacyNoticeVersion: "contact-notice-2026-11-06",
  failure: {
    no_backend: "Bản web này chưa kết nối máy chủ nên chưa gửi được yêu cầu. Nội dung bạn nhập vẫn được giữ nguyên.",
    network:
      "Không kết nối được máy chủ nên chưa xác nhận được yêu cầu. Kiểm tra mạng rồi gửi lại; nội dung bạn nhập vẫn được giữ nguyên, và gửi lại cùng nội dung sẽ không tạo yêu cầu trùng.",
    timeout:
      "Máy chủ phản hồi quá lâu nên chưa xác nhận được yêu cầu đã lưu hay chưa. Bạn có thể gửi lại: nếu yêu cầu đã được lưu, hệ thống trả lại mã cũ thay vì tạo yêu cầu trùng. Nội dung bạn nhập vẫn được giữ nguyên.",
    invalid: "Máy chủ chưa chấp nhận một số mục. Vui lòng kiểm tra các mục được đánh dấu.",
    rate_limited: "Bạn đã gửi nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau ít phút; nội dung bạn nhập vẫn được giữ nguyên.",
    rejected: "Máy chủ không chấp nhận yêu cầu gửi từ trang này. Nội dung bạn nhập vẫn được giữ nguyên; vui lòng thử lại sau.",
    server: "Máy chủ gặp lỗi nên chưa xác nhận được yêu cầu. Vui lòng thử lại sau ít phút; nội dung bạn nhập vẫn được giữ nguyên.",
  },
  success: {
    title: "Đã ghi nhận yêu cầu của bạn",
    reference: "Mã yêu cầu",
    body: "Đội ngũ CareLens AI sẽ liên hệ với bạn qua số điện thoại hoặc email đã cung cấp. Hệ thống không gửi email xác nhận cho bạn, vui lòng giữ mã yêu cầu để tiện trao đổi.",
    purchase: "Đây là yêu cầu đặt mua, chưa phải đơn hàng đã xác nhận. Sản phẩm, giá và giao nhận sẽ được xác nhận khi đội ngũ liên hệ.",
    duplicate: "Yêu cầu giống hệt đã được gửi trước đó, nên không tạo yêu cầu mới. Đây là mã của yêu cầu đã lưu.",
    /** Máy chủ trả "pending" hoặc "failed": yêu cầu đã lưu, email báo đội ngũ chưa được nhà cung cấp nhận; cron sẽ thử lại. */
    notificationPending: "Yêu cầu đã được lưu. Email báo cho đội ngũ chưa gửi xong; hệ thống sẽ tự thử gửi lại. Bạn không cần gửi lại yêu cầu.",
    /** Máy chủ trả "not_configured": email báo đội ngũ chưa được bật trên máy chủ này. */
    notificationNotConfigured:
      "Yêu cầu đã được lưu, nhưng máy chủ này chưa bật email báo cho đội ngũ, nên đội ngũ có thể chưa biết ngay về yêu cầu. Bạn không cần gửi lại yêu cầu.",
    again: "Gửi yêu cầu khác",
  },
  app: "Xem ứng dụng",
} as const;

export const FOOTER = {
  status: "CareLens AI hỗ trợ theo dõi và phối hợp chăm sóc, không tự đưa ra chẩn đoán và không thay thế nhân viên y tế. Hệ thống chưa được kiểm chứng lâm sàng.",
  attribution: "Ghi công mô hình 3D của bên thứ ba",
  attributionHref: "/models/carelens/components/ATTRIBUTION.txt",
  inspector: "Công cụ kiểm tra 3D",
} as const;
