---
paths:
  - "**/tests/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/test_*.py"
  - "**/*_test.py"
---

# Testing rules

Spec: `docs/IMPLEMENTATION_PLAN.md` §13. Chiến lược: `docs/ARCHITECTURE.md` §9.

- **Ưu tiên:** unit cho state machine, validation, format. Integration với API và PostgreSQL thật cho quyền, transaction, idempotency, retry. E2E Playwright cho kịch bản demo và responsive.
- **Truy vết AC:** mỗi AC01–AC18 có ít nhất một test tự động, hoặc ghi rõ lý do kiểm tra thủ công trong báo cáo mốc. Đặt ID trong tên test, ví dụ `test_ac03_cross_household_recipient_returns_404`.
- **Quyền:** mọi endpoint theo hồ sơ có bốn test (đúng quyền, nhóm khác, sau thu hồi, thiếu permission).
- **Đồng thời thật:** AC05 (hai caregiver tiếp nhận cùng lúc) và AC10 (retry thay patch) chạy hai request song song trên DB thật, không mô phỏng bằng mock.
- **Không mock DB** cho logic quyền và transaction. Test UI với `demoAdapter` không chứng minh cách ly backend.
- **Tất định:** fixture tổng hợp, clock inject. Không assert trên `now()` không cố định. Không phụ thuộc thứ tự chạy test.
- **Fixture:** không có tên, ảnh hay thông tin người thật. Giá trị không mang ý nghĩa ngưỡng y khoa.
- **Không gian lận:** không snapshot lớn để tăng số lượng test. Không skip hay xóa test đang fail mà không ghi lý do và mở việc.
- **Báo cáo trung thực:** ghi lệnh đã chạy và số pass/fail thật. Test chưa chạy không được ghi là pass.
