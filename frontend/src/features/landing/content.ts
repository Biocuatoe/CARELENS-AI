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

/** Đội ngũ: tên và vai trò lấy trực tiếp từ tên tệp ảnh trong `members/` (dạng "Họ tên - VAI TRÒ.jpg"), không thêm tiểu sử hay thành tích. */
export const TEAM = {
  eyebrow: "Con người phía sau sản phẩm",
  heading: "Đội ngũ của chúng tôi",
  /** Thứ tự trên màn rộng: hàng ngang năm người, CEO ở chính giữa, hai người mỗi bên. */
  desktopOrder: ["CTO", "COO", "CEO", "CMO", "CSO"],
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
 * Liên hệ. Repo chưa có địa chỉ email, số điện thoại hay biểu mẫu chính thức nào, nên không có thông tin nào được bịa ra: khi chưa có địa chỉ
 * (biến `VITE_CONTACT_EMAIL`), nút chính sao chép nội dung trao đổi để người xem tự gửi. Không có gì được "gửi đi" từ trang này.
 */
export const CONTACT = {
  eyebrow: "Hợp tác cùng CareLens AI",
  heading: "Liên hệ với chúng tôi",
  body: "Chọn nhóm phù hợp để bắt đầu trao đổi với đội ngũ CareLens AI.",
  audiences: [
    {
      id: "family",
      title: "Cá nhân và gia đình",
      why: "Chủ động chăm sóc và đồng hành cùng người thân.",
      draft: "Xin chào đội ngũ CareLens AI, tôi muốn tìm hiểu cách CareLens AI hỗ trợ việc chăm sóc người thân của mình.\n\nTôi là: \nHoàn cảnh gia đình: \nĐiều tôi quan tâm nhất: ",
    },
    {
      id: "business",
      title: "Doanh nghiệp",
      why: "Hợp tác, tích hợp hoặc triển khai tiềm năng.",
      draft: "Xin chào đội ngũ CareLens AI, doanh nghiệp chúng tôi muốn trao đổi về hợp tác, tích hợp hoặc triển khai.\n\nĐơn vị: \nNgười liên hệ: \nHình thức hợp tác quan tâm: ",
    },
    {
      id: "facility",
      title: "Cơ sở chăm sóc y tế",
      why: "Trao đổi quy trình chăm sóc và cơ hội hợp tác phù hợp.",
      draft: "Xin chào đội ngũ CareLens AI, cơ sở chúng tôi muốn trao đổi về quy trình chăm sóc và cơ hội hợp tác.\n\nCơ sở: \nNgười liên hệ: \nQuy trình muốn trao đổi: ",
    },
  ],
  draftTitle: "Nội dung trao đổi gợi ý",
  send: "Gửi email cho đội ngũ",
  copy: "Sao chép nội dung",
  copied: "Đã sao chép. Hãy dán nội dung vào email hoặc tin nhắn gửi cho đội ngũ.",
  copyFailed: "Không sao chép tự động được. Hãy chọn và sao chép nội dung ở trên.",
  noChannel: "Địa chỉ liên hệ chính thức sẽ được cập nhật tại đây. Trang này không tự gửi tin nhắn.",
  team: "Gặp đội ngũ",
  app: "Xem ứng dụng",
  mailSubject: "Liên hệ CareLens AI",
} as const;

export const FOOTER = {
  status: "CareLens AI hỗ trợ theo dõi và phối hợp chăm sóc, không tự đưa ra chẩn đoán và không thay thế nhân viên y tế. Hệ thống chưa được kiểm chứng lâm sàng.",
  attribution: "Ghi công mô hình 3D của bên thứ ba",
  attributionHref: "/models/carelens/components/ATTRIBUTION.txt",
  inspector: "Công cụ kiểm tra 3D",
} as const;
