---
name: ui-screen
description: Build or modify one CareLens + EcoPatch UI screen (S01–S14 from docs/CARELENS_ECOPATCH_SYSTEM_UI_PROMPT.md), a landing page section, or a shared Neumorphism primitive — with the exact design tokens, the full state matrix, accessibility and real responsive checks. Use for "dựng màn hình tổng quan", "làm S08 chi tiết cảnh báo", "sửa hero landing", "tạo component SoftButton".
argument-hint: "[S01..S14 | landing:<section> | component:<Name>]"
---

# Dựng UI: $ARGUMENTS

## 1. Đọc spec

| ID | Route | Mục spec |
| --- | --- | --- |
| S01 | `/login` | Account entry |
| S02 | `/onboarding` | Onboarding |
| S03 | `/people` | Recipient selection |
| S04 | `/people/:recipientId/overview` | Overview |
| S05 | `/people/:recipientId/carelens` | CareLens |
| S06 | `/people/:recipientId/ecopatch` | EcoPatch |
| S07 | `/people/:recipientId/alerts` | Alert list |
| S08 | `/people/:recipientId/alerts/:alertId` | Alert detail and processing |
| S09 | `/people/:recipientId/devices` | Devices, guidance, patch replacement |
| S10 | `/people/:recipientId/history` | History and notes |
| S11 | `/people/:recipientId/reports` | Reports and export |
| S12 | `/people/:recipientId/sharing` | Family and access |
| S13 | `/settings/notifications` | Notification preferences |
| S14 | `/admin` | Restricted operations |

- Màn hình app: đọc mục tương ứng trong `<screens>` và toàn bộ `<components-and-states>` của `docs/CARELENS_ECOPATCH_SYSTEM_UI_PROMPT.md`.
- Landing: đọc section tương ứng trong `docs/CARELENS_ECOPATCH_LANDING_PROMPT.md`. Copy tiếng Việt lấy nguyên văn từ đó.
- Luôn đối chiếu plan §6 và `.claude/rules/frontend.md`.

## 2. Kiểm kê trước khi viết

- Primitive nào đã có trong `src/design-system/`? Dùng lại. Chỉ thêm primitive khi ít nhất hai nơi cần.
- Màn hình cần dữ liệu gì? Method nào của `DataAdapter` đã có? Type trong `data/generated/` đã có chưa?
- API chưa có: thêm method vào interface và `demoAdapter` với fixture tổng hợp, đánh dấu "mock" trong báo cáo. Không thêm trường ngoài contract hoặc plan §8.
- Permission và enrollment nào quyết định việc hiển thị và hành động?

## 3. Viết

- Component màn hình ở `src/features/<domain>/`. Nhãn trạng thái ở `labels.ts`.
- Làm đủ trạng thái trước khi đánh bóng: loading, populated, empty, filtered empty, error, stale, disconnected, forbidden, session expired. Có mutation thì thêm invalid, submitting, success, failed, conflict.
- Checklist nội dung:
  - [ ] Thời điểm cập nhật và nguồn nằm cạnh dữ liệu.
  - [ ] Badge `Dữ liệu mô phỏng` khi `source_mode = "simulated"`.
  - [ ] Không có con số nào mà contract không trả.
  - [ ] Không có alert mở thì hiện `Không có cảnh báo đang mở` và trạng thái kết nối riêng, không "an toàn".
  - [ ] Mô tả AI có nhãn chưa được xác nhận. Care level ghi là điểm AI.
  - [ ] Acknowledge hiển thị `Đã tiếp nhận · Chưa có kết quả kiểm tra`, không đóng alert.
  - [ ] Mọi nút làm đúng việc, hoặc disabled kèm lý do, hoặc bỏ đi.

## 4. Rà token trong file vừa sửa

```bash
grep -nE "bg-white|rounded-(sm|md|lg)\b|shadow-(sm|md|lg|xl|2xl)\b|#A3B1C6|#8B95A5|border-(gray|slate|zinc)" <files>
grep -nE "#[0-9A-Fa-f]{3,8}\b|rgba?\(" <files trong src/features>
```

Mọi kết quả ở `src/features/` phải được thay bằng token. Xem ngữ cảnh trước khi sửa.

## 5. Verify

1. Vitest cho logic chọn state và nhãn. Playwright cho luồng có mutation.
2. Chạy app và mở màn hình ở 360, 390, 768, 1024, 1440px. Không tràn ngang, CTA chính thấy được, bóng không bị cắt.
3. Bàn phím: Tab qua mọi control, focus ring thấy rõ, dialog có focus trap, Esc đóng và trả focus.
4. Reduced motion (Playwright `reducedMotion: "reduce"`): không float, không rotate.
5. Đo tương phản các cặp màu thực tế đã dùng. Ghi xung đột còn lại, không đổi palette (ADR-009).
6. Cập nhật `docs/UI_IMPLEMENTATION_STATUS.md` (tạo khi có màn hình đầu tiên): màn hình, mock hay thật, trạng thái đã có, vấn đề layout và contrast còn lại, kích thước đã kiểm tra.
