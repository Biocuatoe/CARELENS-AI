---
paths:
  - "backend/api/**"
---

# Backend rules (backend/api)

Spec: `docs/IMPLEMENTATION_PLAN.md` §5, §7–§10. Kiến trúc: `docs/ARCHITECTURE.md` §6.

## Cấu trúc modular monolith

```
app/main.py              tạo app, middleware request_id, error handler, mount router
app/core/                config, db, security, errors, logging, clock
app/authz/               Permission enum, require_recipient(...)
app/modules/<domain>/    router.py · schemas.py · service.py · repository.py · models.py
app/worker/              outbox runner, escalation, export
alembic/                 migrations
tests/unit/  tests/integration/
```

- Chiều phụ thuộc: router → service → repository → models.
- Router không truy vấn DB. Service không import FastAPI. Module khác chỉ gọi qua service, không truy vấn bảng của nhau.
- Không tạo module rỗng. Tạo khi có endpoint hoặc job thật.

## Phân quyền

- Mọi endpoint dưới `/people/{recipient_id}/…` dùng dependency `require_recipient(permission, product=None)`. Kiểm tra permission cụ thể, không kiểm tra tên vai trò.
- Grant hợp lệ khi chưa thu hồi và chưa hết hạn. Route theo sản phẩm kiểm tra thêm enrollment.
- Không có grant với hồ sơ: 404. Có grant nhưng thiếu permission: 403.
- Repository luôn lọc scope (`care_recipient_id`, `household_id`) trong SQL. Không tải rồi lọc bằng Python.
- Platform admin và device operator không mặc định có `data.read`.
- Actor luôn lấy từ session. Request schema không có `actor_id`, `user_id`, `received_at`.
- Hành động cấu hình, quyền, thiết bị, export và alert ghi AuditLog gồm actor, action, target, thời điểm, kết quả. Không ghi payload nhạy cảm.

## Auth

- Session lưu DB, cookie httpOnly + SameSite=Lax + Secure ngoài localhost. CSRF token qua header cho mọi mutation.
- Mật khẩu hash bằng argon2 qua thư viện chuẩn. Không tự viết crypto.
- Giới hạn thử đăng nhập. Thông báo lỗi chung, không lộ tài khoản có tồn tại.
- Credential thiết bị lưu hash, scope theo thiết bị. Ingest không chấp nhận session trình duyệt.
- Token lời mời ngẫu nhiên, lưu hash, dùng một lần, có hạn, không log.

## Transaction và độ tin cậy

- Alert, outbox và stream event ghi cùng transaction với event gốc.
- Worker lấy việc bằng `SELECT … FOR UPDATE SKIP LOCKED`, retry có backoff và số lần tối đa, khóa idempotency chống gửi trùng. Kiểm tra lại quyền người nhận ngay trước khi gửi.
- Trạng thái delivery chỉ gồm `queued`, `provider_accepted`, `failed`. Không có `delivered`/`read` nếu kênh không cung cấp bằng chứng.
- Ingest idempotent bằng `UNIQUE (device_id, source_record_id)`. Mutation có thể retry (thay patch, tạo export) nhận header `Idempotency-Key`.
- State machine alert: `open → acknowledged → in_progress → resolved`, cho phép `acknowledged → resolved`. Chuyển trạng thái dùng `UPDATE … WHERE status = :from AND version = :v`. Không khớp trả 409 kèm trạng thái hiện tại.
- Resolve bắt buộc `review_outcome ∈ {confirmed, false_alarm, uncertain}` và ghi chú. Acknowledge không bao giờ tự đóng alert. Escalation là một AlertAction, không phải status.
- Thay patch: đóng phiên cũ và mở phiên mới trong một transaction. Partial unique index chặn hai phiên đang hoạt động trên một lõi.
- DeviceAssignment không chồng thời gian (exclusion constraint với `btree_gist`). Ingest gán hồ sơ theo assignment tại `observed_at`. Không xác định được thì đưa vào quarantine, không đoán.

## Dữ liệu và thời gian

- Cột thời gian là `timestamptz` UTC. Lưu cả `observed_at` từ nguồn và `received_at` do server gán qua clock inject được.
- Giá trị mới nhất tính theo `observed_at`. Gói đến muộn vào lịch sử, không ghi đè giá trị mới hơn.
- `observed_at` ở tương lai quá ngưỡng cấu hình thì từ chối hoặc đánh dấu.
- Schema quan hệ rõ ràng. JSONB chỉ cho phần mở rộng đã validate.
- Không có cột, bảng hay endpoint nhận ảnh, frame, base64 hình ảnh, `UploadFile` ảnh.
- Mọi thay đổi schema có migration Alembic chạy được trên DB trống. Không sửa migration đã merge.

## API

- Prefix `/api/app/v1`. Request schema Pydantic đặt `extra="forbid"`. Response có schema tường minh.
- OpenAPI có ví dụ request và lỗi. Sau khi đổi schema, chạy lệnh sinh type web.
- Lỗi trả `application/problem+json` với `type`, `title`, `status`, `detail`, `code`, `request_id`. Không trả stack trace.
- List dùng cursor trên `(observed_at, id)` hoặc `(created_at, id)`, `limit` có giá trị tối đa. Truy vấn measurement bắt buộc có khoảng thời gian giới hạn.
- SSE `/people/{id}/stream` gửi `{seq, type, entity_id}`. Kiểm quyền khi mở. Đóng stream khi grant bị thu hồi.
- Export CSV kiểm quyền khi tạo và khi tải. Escape ô bắt đầu bằng `=`, `+`, `-`, `@`. Giữ cột nguồn, đơn vị, múi giờ, `source_mode`.

## Log và cấu hình

- Log có cấu trúc kèm `request_id`. Không log token, mật khẩu, cookie, payload sức khỏe đầy đủ, waveform.
- Cấu hình qua biến môi trường với pydantic-settings. Thêm biến thì cập nhật `.env.example`. Không có giá trị mặc định là secret thật.
- Notification provider mặc định `sink`. Provider thật chỉ bật qua cấu hình tường minh sau khi D09 được chốt.

## Test

- pytest với PostgreSQL thật trong Docker. Không dùng SQLite vì cần constraint và locking thật.
- Endpoint theo hồ sơ có đủ bốn test: đúng quyền thành công, hồ sơ nhóm khác 404, grant đã thu hồi bị chặn, thiếu permission 403.
