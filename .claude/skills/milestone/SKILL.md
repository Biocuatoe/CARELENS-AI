---
name: milestone
description: Execute or continue an implementation milestone (M0–M5) of the CareLens + EcoPatch webapp from docs/IMPLEMENTATION_PLAN.md §12 — survey the repo, plan vertical slices, implement, verify with real commands, update the checklist and write the milestone report. Use for requests like "làm M1", "tiếp tục mốc M2", "bắt đầu mốc tiếp theo", "báo cáo tiến độ mốc".
argument-hint: "[M0|M1|M2|M3|M4|M5]"
---

# Thực hiện mốc $ARGUMENTS

## 1. Xác định mốc

- Không có tham số: đọc checklist plan §12, chọn mốc thấp nhất còn mục chưa tick.
- M5 chỉ bắt đầu khi quyết định liên quan trong `docs/DECISIONS.md` (D01–D04, D09) là Accepted và có thiết bị hoặc API thật để xác minh. Thiếu điều kiện thì không làm M5, báo rõ điều kiện còn thiếu.

## 2. Khảo sát, chưa sửa code

1. Đọc `AGENTS.md`, mục mốc trong `docs/IMPLEMENTATION_PLAN.md` §12, AC liên quan ở §13, `docs/DECISIONS.md`.
2. Xem `git status`, cấu trúc repo, lệnh ở `AGENTS.md` §4.
3. Chạy test hiện có để lấy baseline. Ghi lại test đang fail trước khi bắt đầu.
4. Lập bảng: mục checklist → module/file sẽ chạm → AC chứng minh → phụ thuộc hoặc chặn.

## 3. Lập kế hoạch ngắn

- Chia thành lát dọc chạy được (DB → API → adapter → UI → test). Không làm hết một tầng rồi mới sang tầng khác.
- Mỗi lát có kết quả kiểm tra được và lệnh verify cụ thể.
- Giả định không chặn: ghi bằng `/decision-log` với trạng thái Proposed rồi làm tiếp.

## 4. Phạm vi gợi ý theo mốc

| Mốc | Trọng tâm | Không làm |
| --- | --- | --- |
| M0 | Scaffold theo ARCHITECTURE §5 (chỉ phần dùng ngay). Token + primitives. App shell + tổng quan, CareLens, EcoPatch, cảnh báo với `demoAdapter`. Contract event, measurement, error. Kiểm tra G1 ở 390 và 1440px. Cập nhật `AGENTS.md` §4 bằng lệnh thật | Backend nghiệp vụ đầy đủ |
| M1 | Auth session, household, recipient, grant, invitation, enrollment, menu theo quyền, test cách ly nhóm | Ingest thiết bị |
| M2 | Simulator → ingest → event/measurement → alert + outbox → sink → SSE → UI tiếp nhận và xử lý alert | Pairing, export |
| M3 | Pairing có challenge, heartbeat, thay patch, ghi chú, báo cáo, CSV export, thu hồi quyền có hiệu lực, worker nhắc và chuyển người dự phòng | Tích hợp thật |
| M4 | Responsive và bàn phím, test reconnect/trùng/đến muộn/xung đột, README và DEMO_GUIDE, kết quả AC | Tính năng mới |
| M5 | Nối nguồn thật đã xác minh, đo độ trễ từng chặng, danh sách hạn chế | Pilot với người thật |

Tiêu chí "Hoàn thành khi" của từng mốc nằm cuối mục mốc trong plan §12. Đó là điều kiện kết thúc, không phải gợi ý.

## 5. Triển khai từng lát

1. Viết code theo `.claude/rules/` (tự nạp theo đường dẫn). Dùng `/api-endpoint`, `/ui-screen`, `/ingest-adapter` cho phần tương ứng.
2. Chạy lint, typecheck, test liên quan. Sửa tới khi pass, hoặc ghi rõ lỗi còn lại và lý do.
3. Với UI: chạy app và kiểm tra thật trong trình duyệt, tối thiểu ở 390px và 1440px.
4. Chỉ commit khi người dùng đã cho phép commit trong phiên. Commit nhỏ theo Conventional Commits.

## 6. Kết thúc mốc

1. Chạy `/guardrail-check` trên toàn bộ thay đổi của mốc. Sửa mọi mục mức Chặn.
2. Chạy toàn bộ test suite. Ghi lệnh và kết quả thật.
3. Tick checklist plan §12 chỉ cho mục có bằng chứng. Cập nhật `AGENTS.md` §4 nếu lệnh thay đổi. Cập nhật `docs/DECISIONS.md`.
4. Trả báo cáo theo mẫu:

```markdown
## Báo cáo mốc Mx — YYYY-MM-DD

**Đã làm:** …
**File thay đổi chính:** …
**Cách chạy:**
    <lệnh>
**Kiểm tra đã chạy:**
| Lệnh | Kết quả |
| --- | --- |
**AC có test tự động:** ACxx, …
**AC kiểm tra thủ công hoặc chưa kiểm tra:** …
**Mô phỏng và tích hợp thật:** …
**Tiêu chí "Hoàn thành khi":** đạt / chưa đạt, vì sao
**Còn chặn:** …
**Quyết định mới cần người dùng duyệt:** …
```
