---
name: api-endpoint
description: Add or change a business API endpoint in backend/api (FastAPI) for the CareLens + EcoPatch webapp — with server-side recipient authorization, transactional service logic, audit, problem+json errors, OpenAPI examples, isolation tests and regenerated web types. Use for "thêm endpoint", "API hành động cảnh báo", "sửa schema response", or any route under /api/app/v1.
argument-hint: "<METHOD> <path> — <mục đích>"
---

# Endpoint: $ARGUMENTS

## 1. Đối chiếu trước khi viết

- Tìm endpoint trong plan §9.2. Không có trong bảng thì xác nhận luồng thực sự cần nó, ghi lý do bằng `/decision-log`.
- Trả lời đủ các câu:

| Câu hỏi | Trả lời |
| --- | --- |
| Module nào sở hữu? | |
| Permission cần? (`data.read`, `alerts.act`, `sharing.manage`…) | |
| Route thuộc sản phẩm nào, cần kiểm enrollment? | |
| Mutation có thể retry, cần `Idempotency-Key`? | |
| Có tranh chấp đồng thời, cần `version`? | |
| Ghi AuditLog? | |
| Phát outbox hoặc stream event? | |
| AC liên quan? | |

## 2. Thứ tự viết

1. **models.py + migration Alembic** nếu đổi schema. Bất biến đặt bằng constraint DB (unique, check, exclusion, partial index). Index cho cursor.
2. **schemas.py:** request với `extra="forbid"`, không có `actor_id`, `user_id`, `received_at`. Response tường minh. Ví dụ trong `json_schema_extra`.
3. **repository.py:** mọi query có scope recipient hoặc household trong SQL.
4. **service.py:** nghiệp vụ, transaction, chuyển trạng thái, outbox, audit. Không import FastAPI. Lỗi nghiệp vụ là exception domain.
5. **router.py:** dependency session và `require_recipient(permission)`, gọi service, map exception domain sang problem+json (403, 404, 409, 422).
6. Đăng ký router, mở `/docs` kiểm tra schema và ví dụ.

## 3. Test bắt buộc

Đặt trong `backend/api/tests/integration/`, chạy với PostgreSQL thật. Gắn ID AC vào tên test khi liên quan.

- [ ] Người có đúng quyền: thành công, response khớp schema.
- [ ] Hồ sơ thuộc nhóm khác: 404, không rò dữ liệu.
- [ ] Grant đã thu hồi hoặc hết hạn: bị chặn.
- [ ] Thiếu permission cụ thể (ví dụ viewer gọi mutation): 403.
- [ ] Input sai: 422 dạng problem+json.
- [ ] Idempotent: gửi lại cùng khóa không tạo bản ghi thứ hai.
- [ ] Có version: hai request song song cho ra một thành công và một 409 kèm trạng thái hiện tại.
- [ ] Có audit: AuditLog đủ actor, action, target, không chứa payload nhạy cảm.
- [ ] Có outbox: outbox được ghi cùng transaction, rollback thì không còn outbox.

## 4. Hoàn tất

1. Chạy ruff, pyright, pytest cho module.
2. Chạy lệnh sinh type web (xem `AGENTS.md` §4). Sửa lỗi typecheck phát sinh ở web.
3. Cập nhật `docs/API_CONTRACT.md` nếu hợp đồng thay đổi (tạo file khi có endpoint đầu tiên).
4. Chạy `/guardrail-check` với các file vừa đổi.
