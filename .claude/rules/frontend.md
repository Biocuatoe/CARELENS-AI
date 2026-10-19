---
paths:
  - "frontend/**"
---

# Frontend rules (frontend)

Spec: `docs/CARELENS_ECOPATCH_SYSTEM_UI_PROMPT.md` cho app, `docs/CARELENS_ECOPATCH_LANDING_PROMPT.md` cho landing, `docs/IMPLEMENTATION_PLAN.md` §6. Kiến trúc: `docs/ARCHITECTURE.md` §7.

## Design system (bảng màu landing, A35)

- Token chỉ định nghĩa một lần trong `src/design-system/tokens.css` (`@theme`). Component dùng utility sinh từ token (`bg-surface`, `text-fg`, `text-accent`, `shadow-extruded`, `rounded-container`, hoặc trực tiếp `bg-midnight`, `bg-paper`, `text-ivory`). Không chép hex hay shadow vào `features/`.
- Bảng màu gốc là bảng màu landing (A19), giá trị không đổi: `midnight #14232D`, `graphite #233642`, `teal-deep #245F5A`, `signal #55B9A8`, `mint #B0E4D8`, `ivory #F2F0E9`, `paper #FAFBF8`, `ink #26363E`. Token ngữ nghĩa của app là bí danh: `surface` = ivory, `fg` = ink, `accent` = teal-deep. Landing, đăng nhập và app dùng chung bảng màu và primitive; không thêm palette hay theme riêng.
- Tông: khung điều hướng (thanh bên, thanh đầu trang, khu thương hiệu của đăng nhập) là tông tối `data-tone="dark"` (midnight, ivory, signal). Nội dung là tông sáng (ivory nền trang, paper cho thẻ, ink cho chữ). Một tông cố định như landing, không có công tắc sáng/tối và không lưu tông vào web storage.
- Độ nổi: thẻ = `shadow-extruded` (vòng 1px ink/15 cộng bóng giấy mềm). Viền nhãn và nút phụ = `shadow-extruded-sm`; ô lồng trong thẻ = `shadow-inset-sm`; ô nhập = `shadow-inset`; focus = `shadow-inset-deep`. Tên token giữ từ thời Neumorphism, nghĩa là các vòng viền mảnh như landing.
- Radius: thẻ `rounded-container` 24px; ô nhập và ô lồng `rounded-control` 16px; chi tiết bên trong 12px; nút, nhãn, tab và vòng icon là pill (`rounded-full`).
- Nút: dùng `buttonClasses`/`SoftButton` (hoặc `landingButtonClasses` ở landing), cùng màu: chính = nền teal-deep chữ paper; phụ = viền ink/30. Tông `dark` cho nút trên nền tối.
- Font: Plus Jakarta Sans (500–800) cho heading, DM Sans (400/500/700) cho body và control, nhãn nhỏ dùng font mono in hoa như landing (`Eyebrow`), Google Fonts với `display=swap`.
- Motion: 300ms ease-out cho UI. `prefers-reduced-motion` tắt float, rotate, smooth scroll.
- Focus ring 2px offset 2px trên mọi phần tử tương tác; màu theo tông (`signal` trên nền tối, `accent` trên nền sáng) qua quy tắc `[data-tone]` trong `tokens.css`. Không đặt `outline-accent` trên phần tử có thể nằm trong khung tối.
- **Ngoại lệ có chủ ý:** nút "Đăng nhập bằng Google" dùng màu do hướng dẫn thương hiệu của Google quy định (nền trắng, viền #747775, chữ #1F1F1F, biểu tượng G nhiều màu); không dùng cho thứ gì khác.
- **Cấm:** `bg-white`, viền dày hay shadow hex đục trong `features/`, `#A0AEC0`/`#8B95A5` cho chữ, theme riêng cho từng sản phẩm, công tắc đổi tông, palette đỏ/hổ phách chưa được duyệt, logo hay tên thương hiệu khác với wordmark "CareLens AI" (`design-system/Brand.tsx`).
- **Tương phản (ADR-009):** chữ thiết yếu (timestamp, đơn vị, nhãn trạng thái, lỗi, cảnh báo) dùng `text-fg`. `text-muted` chỉ cho chữ lớn hoặc không thiết yếu. Không tuyên bố đạt WCAG AA toàn app.
- **Mức độ khẩn** diễn đạt bằng chữ, icon, vị trí, font weight, độ đậm viền và CTA, không chỉ bằng màu. Teal là màu tương tác và nhấn, không nghĩa là người được chăm sóc khỏe.
- **Bố cục app:** thẻ `SoftSurface` (paper, 24px). Dữ liệu dày đặt trong một thẻ, ô lồng dùng viền nhạt. Không dùng heading 72px hay `py-32` trong app. Trang trí concentric chỉ ở empty state.
- **Một tài khoản Live Demo (A35):** không có chọn người dùng mô phỏng, đăng ký, khôi phục mật khẩu hay trang danh sách hồ sơ. Đăng nhập thành công vào thẳng `/people` → tổng quan của hồ sơ máy chủ cấp quyền xem. Điểm vào persona của `DemoAdapter` chỉ dùng trong unit test.

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
