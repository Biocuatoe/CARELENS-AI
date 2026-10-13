---
paths:
  - "docs/**"
  - "README.md"
  - "AGENTS.md"
---

# Documentation rules

- Viết tiếng Việt, identifier tiếng Anh. Câu ngắn, dùng bảng khi liệt kê nhiều mục song song.
- Mọi khẳng định về năng lực gắn một trong ba trạng thái: **Yêu cầu PRD**, **Đề xuất**, **Đã kiểm chứng** (kèm bằng chứng: lệnh, test, commit, thiết bị).
- `docs/DECISIONS.md`: agent chỉ tạo Open hoặc Proposed. Accepted và Rejected chỉ khi người dùng hoặc owner xác nhận, ghi rõ ai, khi nào, ở đâu. Đổi quyết định đã Accepted bằng mục mới có `Supersedes`.
- Checklist ở plan §12 chỉ tick khi có bằng chứng chạy được. Không tick theo cảm nhận "code đã viết xong".
- Chỉ tạo tài liệu mới khi có nội dung thật:
  - `docs/API_CONTRACT.md` khi có endpoint đầu tiên.
  - `docs/UI_IMPLEMENTATION_STATUS.md` khi có màn hình đầu tiên.
  - `docs/DEMO_GUIDE.md` khi demo chạy được từ checkout sạch.
- Không đưa link giả, trang pháp lý bịa, chứng nhận y khoa, đối tác, số liệu hiệu năng chưa đo.
- Không sửa khối `<design-system>` trong hai file prompt. Xung đột với design system ghi vào DECISIONS.
- Khi thay đổi lệnh chạy, cập nhật `AGENTS.md` §4 trong cùng thay đổi.
