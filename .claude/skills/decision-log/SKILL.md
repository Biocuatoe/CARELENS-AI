---
name: decision-log
description: Record or update a technical/product decision, non-blocking assumption, open question or document conflict in docs/DECISIONS.md with the correct status — agents may only create Open or Proposed; Accepted/Rejected only on explicit user or owner confirmation. Use when choosing between approaches, making an assumption to avoid blocking, finding a contradiction between PRD/plan/prompts, or when the user approves or rejects something ("ghi quyết định", "chốt D04", "tôi duyệt ADR-003").
argument-hint: "<chủ đề mới hoặc ID cần cập nhật>"
---

# Ghi quyết định: $ARGUMENTS

1. Đọc `docs/DECISIONS.md`. Đã có mục cùng chủ đề thì cập nhật mục đó, không tạo trùng.
2. Chọn loại và lấy số tiếp theo:
   - `Dxx`: vấn đề sản phẩm, dữ liệu, thiết bị chưa chốt.
   - `ADR-xxx`: quyết định kỹ thuật hoặc kiến trúc.
   - `Axx`: giả định tạm để không bị chặn.
3. Đặt trạng thái:
   - Agent tự tạo: chỉ `Open` hoặc `Proposed`.
   - `Accepted` hoặc `Rejected`: chỉ khi người dùng hoặc owner nói rõ trong phiên. Ghi `Duyệt bởi: <người>, <ngày>, <nơi: phiên chat, issue, cuộc họp>`.
   - Đổi một mục đã Accepted: tạo mục mới ghi `Supersedes ADR-xxx`. Mục cũ chuyển `Superseded` khi mục mới được Accepted.
4. Viết theo mẫu cuối file. ADR bắt buộc có bối cảnh, ít nhất hai phương án, lựa chọn, lý do, hệ quả, điều kiện xem lại. Ghi nguồn tài liệu (file và mục).
5. Cập nhật bảng Tổng hợp đầu file với ngày hôm nay.
6. Quyết định ảnh hưởng `AGENTS.md`, `docs/ARCHITECTURE.md` hoặc `.claude/rules/` thì sửa các file đó trong cùng thay đổi.
7. Trả lời người dùng một câu: ID, tiêu đề, trạng thái, và việc gì cần họ duyệt nếu có.
