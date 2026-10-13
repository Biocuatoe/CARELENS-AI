---
name: guardrail-check
description: Review the current changes (git diff) or given paths of the CareLens + EcoPatch webapp against the project's non-negotiable guardrails in AGENTS.md §6 — medical/AI safety, CareLens image privacy, server-side authorization, demo labeling, external actions and the Neumorphism design system — before reporting work as done. Use before finishing a task or milestone, before a commit or PR, or when asked "rà soát guardrail", "kiểm tra vi phạm", "check an toàn dữ liệu".
argument-hint: "[path | base-branch]"
---

# Guardrail check $ARGUMENTS

Mục tiêu là tìm vi phạm `AGENTS.md` §6 trong thay đổi. Skill này chỉ báo cáo. Chỉ sửa khi người dùng yêu cầu hoặc khi đang chạy trong `/milestone`.

## 1. Phạm vi

- Có git và không có tham số: `git status --porcelain` và `git diff HEAD` (gồm cả file chưa track).
- Tham số là branch: `git diff <branch>...HEAD`.
- Tham số là path, hoặc chưa có git: rà các path đó.

## 2. Quét tự động

Kết quả grep chỉ là gợi ý. Đọc ngữ cảnh từng dòng trước khi kết luận. Copy FAQ trên landing có thể nhắc "bất thường" hợp lệ.

```bash
# Ảnh hoặc frame đi vào webapp (AC16)
grep -rnEi "base64|image/|jpe?g|\bframe|thumbnail|video|UploadFile|cameras/frame" apps integrations --include=*.py --include=*.ts --include=*.tsx

# Auth hoặc dữ liệu trong web storage
grep -rnE "localStorage|sessionStorage|indexedDB|isLoggedIn" frontend/src

# Tin ID từ client
grep -rnE "\b(actor_id|user_id|care_recipient_id|received_at)\b" backend/api/app/modules/*/schemas.py backend/api/app/modules/ingest

# Chỉ số bịa hoặc tuyên bố y khoa
grep -rnEi "hydrat|electrolyte|điện giải|spo2|stroke|đột quỵ|mất nước|probability|xác suất|accuracy|độ chính xác|confidence|độ tin cậy|an toàn|healthy|khỏe mạnh" frontend/src backend/api/app

# Log dữ liệu nhạy cảm
grep -rnE "print\(|console\.(log|debug)|logger\.(info|debug|warning)\(.*(payload|token|password|cookie|body|waveform)" frontend/src backend/api/app

# Gửi ra ngoài
grep -rnEi "smtp|sendgrid|twilio|firebase|onesignal|webpush|https?://[a-z0-9.-]+\.(com|io|net|vn)" frontend/src backend/api/app --include=*.py --include=*.ts --include=*.tsx

# Design system
grep -rnE "bg-white|rounded-(sm|md|lg)\b|shadow-(sm|md|lg|xl|2xl)\b|#A3B1C6|#8B95A5|border-(gray|slate|zinc|neutral)" frontend/src
grep -rnE "#[0-9A-Fa-f]{3,8}\b" frontend/src/features

# Biểu đồ nối qua khoảng mất dữ liệu
grep -rn "connectNulls" frontend/src

# Secrets bị track
git ls-files | grep -Ei "(^|/)\.env$|\.env\.(local|prod)|\.pem$|\.key$|secret|credential"
```

## 3. Rà thủ công

**Y khoa và AI**
- [ ] Không có metric hay con số ngoài contract. Không confidence suy từ care level.
- [ ] Thiếu dữ liệu, dữ liệu cũ, mất kết nối không hiển thị như bình thường hay an toàn.
- [ ] Acknowledge không đóng alert và không tính là AI đúng. Resolve bắt buộc outcome và ghi chú.
- [ ] Mô tả AI có nhãn chưa xác nhận. Không có lời khuyên điều trị.
- [ ] Ngưỡng demo có `rule_version`, không trình bày như ngưỡng y khoa.

**Quyền và riêng tư**
- [ ] Endpoint mới theo hồ sơ dùng `require_recipient` và có bốn test quyền.
- [ ] Query có scope trong SQL.
- [ ] Actor lấy từ session. Hồ sơ của dữ liệu ingest lấy từ assignment.
- [ ] Không có ảnh hay frame trong API, DB, log, export. Không analytics bên thứ ba.
- [ ] Log và response lỗi không chứa token, cookie, payload sức khỏe.
- [ ] Export kiểm quyền khi tạo và khi tải, chống CSV injection, giữ nhãn mô phỏng.
- [ ] Thu hồi quyền có hiệu lực với stream, export và thông báo đang chờ.

**Demo và hành động ra ngoài**
- [ ] Dữ liệu tổng hợp có `source_mode = "simulated"` và badge `Dữ liệu mô phỏng`.
- [ ] Không gọi provider email, SMS, push thật. Không có cấu hình deploy public.
- [ ] Fixture không có thông tin người thật.

**Thiết kế**
- [ ] Token từ nguồn duy nhất. Không hex hay shadow chép tay trong `features/`.
- [ ] Focus ring, label, touch target 44px. State matrix đủ cho màn hình đã đổi.

**Tài liệu**
- [ ] Không tuyên bố "đã kiểm chứng", "đã nghiệm thu", "đạt WCAG AA" khi thiếu bằng chứng.
- [ ] Quyết định mới đã ghi `docs/DECISIONS.md` với trạng thái đúng.

## 4. Báo cáo

| Mức | File:dòng | Vi phạm | Cách sửa |
| --- | --- | --- | --- |
| Chặn / Nên sửa / Ghi chú | | | |

- **Chặn:** vi phạm §6. Không được báo xong khi còn mục này.
- **Nên sửa:** lệch rules chi tiết nhưng không vi phạm §6.
- **Ghi chú:** cần người dùng xác nhận hoặc cần kiểm tra ở mốc sau.

Không có vi phạm thì nói rõ phạm vi đã rà và phần không rà được, ví dụ test chưa chạy hoặc chưa có backend.
