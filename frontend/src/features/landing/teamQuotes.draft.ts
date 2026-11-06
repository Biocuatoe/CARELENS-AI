/**
 * BẢN NHÁP, CHƯA ĐƯỢC DUYỆT. Hai câu dưới đây là nội dung đề xuất (marketing copy), KHÔNG phải lời đã được chuyên gia xác nhận.
 *
 * Cơ chế duyệt:
 * - Tệp này chỉ được nạp bằng `import()` động khi chạy `npm run dev` kèm `?team-quotes=draft` (xem `TeamSection.tsx`). Trong bản build
 *   (`import.meta.env.DEV` là false) nhánh đó bị loại, nên các câu này không có trong gói JS của trang công khai.
 * - Khi chủ dự án hoặc chính chuyên gia xác nhận bằng văn bản, chuyển câu đã duyệt sang trường `quote` của chuyên gia tương ứng trong
 *   `TEAM.experts` (`content.ts`) cùng `approvedBy` và `approvedAt`; `TeamSection` chỉ hiển thị quote có đủ hai trường đó. Sau đó xóa mục
 *   tương ứng ở đây. Nếu chuyên gia sửa lời, ghi đúng lời đã duyệt.
 * - Chưa duyệt thì không chuyển, không rút gọn, không ghi "nhận xét" hay "đánh giá" cho các câu này.
 */
export const TEAM_QUOTE_DRAFTS: Readonly<Record<string, string>> = {
  "chu-huy-anh":
    "Giá trị của CareLens AI không chỉ nằm ở việc ứng dụng trí tuệ nhân tạo, mà còn ở cách thiết kế hệ thống để công nghệ hỗ trợ con người một cách có trách nhiệm, minh bạch và phù hợp với nhu cầu chăm sóc thực tế.",
  "ha-manh-hung":
    "Một giải pháp AI trong lĩnh vực chăm sóc chỉ thực sự có ý nghĩa khi được phát triển từ nhu cầu thực tế, kiểm thử nghiêm túc và đặt độ tin cậy cùng quyền riêng tư của người dùng lên hàng đầu.",
};
