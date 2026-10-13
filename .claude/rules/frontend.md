---
paths:
  - "frontend/**"
---

# Frontend rules (frontend)

Spec: `docs/CARELENS_ECOPATCH_SYSTEM_UI_PROMPT.md` cho app, `docs/CARELENS_ECOPATCH_LANDING_PROMPT.md` cho landing, `docs/IMPLEMENTATION_PLAN.md` §6. Kiến trúc: `docs/ARCHITECTURE.md` §7.

## Design system Neumorphism

- Token chỉ định nghĩa một lần trong `src/design-system/tokens.css` (`@theme`). Component dùng utility sinh từ token (`bg-surface`, `text-fg`, `shadow-extruded`, `rounded-container`). Không chép hex hay shadow vào `features/`.
- Giá trị gốc không làm tròn, không đổi: nền `#E0E5EC`, chữ `#3D4852`, muted `#6B7280`, accent `#6C63FF`, accent light `#8B84FF`, teal `#38B2AC`, placeholder `#A0AEC0`. Công thức 6 shadow (extruded, extruded-hover, extruded-sm, inset, inset-deep, inset-sm) theo ARCHITECTURE §7.4.
- Radius: container 32px, button/input 16px, chi tiết bên trong 12px hoặc full.
- Font: Plus Jakarta Sans (500–800) cho heading, DM Sans (400/500/700) cho body và control, Google Fonts với `display=swap`.
- Trạng thái: nghỉ = extruded. Hover = extruded-hover + nhấc −1px (button) hoặc −2px (card). Pressed = inset-sm + ấn +0.5px. Input = inset, focus = inset-deep + ring. Icon well = inset-deep hoặc inset.
- Motion: 300ms ease-out cho UI, 500ms cho nested depth (ADR-008). `prefers-reduced-motion` tắt float, rotate, smooth scroll.
- Focus ring 2px accent, offset 2px trên mọi phần tử tương tác.
- **Cấm:** `bg-white`, viền hiển thị, shadow hex đục, `rounded-sm/md/lg` cho surface, `#A0AEC0`/`#8B95A5` cho chữ, theme riêng cho từng sản phẩm, dark mode, palette đỏ/hổ phách chưa được duyệt.
- **Tương phản (ADR-009):** chữ thiết yếu (timestamp, đơn vị, nhãn trạng thái, lỗi, cảnh báo) dùng `text-fg`. `text-muted` chỉ cho chữ lớn hoặc không thiết yếu. Không tuyên bố đạt WCAG AA toàn app.
- **Mức độ khẩn** diễn đạt bằng chữ, icon, vị trí, font weight và CTA. Teal chỉ nghĩa là thao tác thành công, không nghĩa là người được chăm sóc khỏe.
- **Bố cục app** khác landing: panel raised 32px, padding 32px. Dữ liệu dày đặt trong một panel, không đổ bóng từng ô. Không dùng heading 72px hay `py-32` trong app. Trang trí concentric chỉ ở onboarding và empty state.

## Cấu trúc

```
src/app/                 router, providers, AppShell, guards
src/design-system/       tokens.css + primitives
src/features/<domain>/   components, hooks, labels.ts, *.test.tsx
src/data/                DataAdapter, httpAdapter, demoAdapter, generated/, queryKeys.ts, sse.ts
src/lib/                 time, format, a11y
```

- Domain: `landing`, `auth`, `onboarding`, `recipients`, `overview`, `carelens`, `ecopatch`, `alerts`, `devices`, `history`, `reports`, `sharing`, `settings`, `admin`.
- `features/*` không import lẫn nhau. Phần dùng chung đưa lên `design-system/` (UI thuần), `data/` (dữ liệu), hoặc `features/common/` cho component nghiệp vụ dùng chung (A05).
- Chỉ thêm primitive vào `design-system/` khi ít nhất hai nơi cần.
- Landing preview dùng lại component nghiệp vụ (`features/common`) ở chế độ read-only, không viết markup riêng. Dữ liệu xem thử hiện là fixture tĩnh có nhãn mô phỏng (A10).
- Nhãn trạng thái tiếng Việt tập trung trong `features/<domain>/labels.ts`, không rải chuỗi trạng thái trong JSX.

## Dữ liệu

- Component không gọi `fetch`. Mọi dữ liệu đi qua `DataAdapter` và TanStack Query.
- Type lấy từ `src/data/generated/openapi.ts`. Trước M1 dùng tạm `src/data/contracts.ts` (A02). Không tự khai báo lại type response ở nơi khác. Không thêm trường ngoài contract.
- Ở chế độ `http`, API lỗi phải hiện lỗi. Không fallback sang dữ liệu demo.
- Query key luôn bắt đầu `["recipient", recipientId, …]`. Đổi hồ sơ: hủy request, xóa cache hồ sơ cũ, đóng SSE, đóng dialog (ARCHITECTURE §7.2).
- Mutation chăm sóc (hành động alert, thay patch, ghép thiết bị, thu hồi quyền, gửi lời mời) chờ server xác nhận, không optimistic. Chống double submit. Lỗi 409 hiện trạng thái server mới nhất và giữ nội dung người dùng đã nhập.
- SSE: dedup theo ID, reconnect bằng `Last-Event-ID`, refetch khi nhận gợi ý. Không đảo thứ tự dòng người dùng đang thao tác, hiện chỉ báo "có mục mới".
- Không lưu token, cờ đăng nhập hay dữ liệu sức khỏe vào localStorage, sessionStorage, IndexedDB. Logout xóa toàn bộ query cache.

## Trạng thái bắt buộc

| Ngữ cảnh | Trạng thái phải có |
| --- | --- |
| Dữ liệu | loading, populated, empty, filtered empty, fetch error |
| Nguồn | connected, stale, disconnected, local access unavailable, unknown |
| Mutation | idle, invalid, submitting, success do server xác nhận, failed, conflict |
| Truy cập | authorized, read-only, forbidden, invitation pending/expired, session expired |
| Thiết bị | unpaired, verifying, assigned, reassignment pending, unsupported capability |
| Demo | badge `Dữ liệu mô phỏng`, phản hồi hành động cục bộ, reset fixture |

- Luôn hiện thời điểm cập nhật và nguồn cạnh dữ liệu.
- Không có alert mở thì hiện `Không có cảnh báo đang mở` và trạng thái kết nối riêng. Không bao giờ hiện "an toàn" hay ô xanh bình thường.
- Mô tả AI có nhãn chưa được xác nhận. Care level ghi là điểm AI, không phải xác suất.
- Biểu đồ có đơn vị, khoảng thời gian, múi giờ. Khoảng mất dữ liệu là khoảng trống, không `connectNulls`. ECG chỉ vẽ khi nguồn có waveform kèm sample rate, cửa sổ giới hạn.
- Không hiển thị pin, ECG, hydrat hóa, SpO2, confidence nếu API không trả.
- Mọi nút hoặc làm đúng việc, hoặc disabled kèm lý do, hoặc bỏ đi. Không toast giả.

## Accessibility và responsive

- HTML ngữ nghĩa: `form`, `table`, `button`, `nav`, heading đúng cấp.
- Mọi control có label. Lỗi gắn với field bằng `aria-describedby`. Form dài có tóm tắt lỗi.
- Dialog và drawer có title, focus trap, đóng bằng Esc, trả focus về phần tử mở.
- Touch target tối thiểu 44×44px.
- Dưới 768px: hamburger Menu/X với menu trượt xuống dạng extruded, một cột, không bottom nav. 768–1023px: giảm cột. Từ 1024px: sidebar raised, header sticky.
- Kiểm tra thật ở 360, 390, 768, 1024, 1440px. Không tràn ngang, không cắt nhãn hay đơn vị, bóng không bị clip bởi `overflow-hidden`.

## Test

- Vitest + Testing Library cho chọn state, nhãn, format, hooks.
- Playwright cho luồng có mutation, responsive, bàn phím, reduced motion.
- Không snapshot lớn. Test UI với `demoAdapter` không chứng minh cách ly backend.
