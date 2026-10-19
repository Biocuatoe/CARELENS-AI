# Trạng thái triển khai UI hệ thống

Cập nhật: 2026-09-15  
Phạm vi: landing theo `docs/CARELENS_ECOPATCH_LANDING_PROMPT.md` và UI hệ thống theo `docs/CARELENS_ECOPATCH_SYSTEM_UI_PROMPT.md` (S01–S14).  
Trạng thái dữ liệu: **toàn bộ là mô phỏng**. Chưa có API nghiệp vụ, backend, thiết bị hoặc AI thật. Chưa có người dùng nghiệm thu.

## 1. Cách chạy

```bash
npm install
npm run dev          # http://localhost:5173 là landing; /login → tài khoản Live Demo (cần backend, xem A35)
```

Người dùng mô phỏng:

| Người dùng | Vai trò | Dùng để thử |
| --- | --- | --- |
| Minh | Quản lý Nhóm A, người chăm sóc Bà An và Ông Bình | Luồng đầy đủ, đổi hồ sơ, thu hồi quyền, xuất CSV, ghép thiết bị |
| Lan | Người chăm sóc Bà An | Xử lý cảnh báo, thay miếng dán, không có quyền xuất dữ liệu |
| Hà | Người xem Ông Bình (Nhóm B) | Chỉ xem, cách ly với Nhóm A |
| Khoa | Quản trị nền tảng | Trang vận hành, không xem được dữ liệu sức khỏe |

Nút **Dữ liệu mô phỏng** trên header mở công cụ demo với các tình huống sau: phát sự kiện CareLens, người khác tiếp nhận trước để thử xung đột, mất kết nối hub, gói đo đến muộn, hết phiên, đổi người dùng và đặt lại dữ liệu. Tải lại trang cũng đặt lại toàn bộ dữ liệu (A04).

## 2. Màn hình

| ID | Màn hình | Route | Trạng thái | Nguồn dữ liệu |
| --- | --- | --- | --- | --- |
| Shell | Sidebar ≥1024px, rail 768–1023px, hamburger <768px, header sticky, đổi hồ sơ | – | Đã dựng | Mô phỏng |
| S01 | Đăng nhập | `/login` | Đã dựng theo bảng màu landing (A35). Một tài khoản Live Demo dùng chung, đăng nhập qua backend care-monitoring; không còn chọn người dùng mô phỏng. Build thiếu `VITE_API_BASE_URL` thì báo chưa kết nối máy chủ | Máy chủ thật (đã kiểm bằng backend giả ở tầng mạng trong e2e; chưa kiểm trên bản deploy) |
| S02 | Onboarding 5 bước | (đã gỡ) | Gỡ theo A35: tài khoản Live Demo chỉ có một hồ sơ do máy chủ cấp, không tạo hồ sơ từ giao diện | Không áp dụng |
| S03 | Chọn hồ sơ | `/people` | Đã dựng | Mô phỏng |
| S04 | Tổng quan | `/people/:id/overview` | Đã dựng | Mô phỏng |
| S05 | CareLens | `/people/:id/carelens` | Đã dựng. Chưa có màn hình cấu hình AI cho người vận hành | Mô phỏng |
| S06 | EcoPatch | `/people/:id/ecopatch` | Đã dựng. Không có dạng sóng ECG vì nguồn không cung cấp | Mô phỏng |
| S07 | Danh sách cảnh báo | `/people/:id/alerts` | Đã dựng | Mô phỏng |
| S08 | Chi tiết và xử lý cảnh báo | `/people/:id/alerts/:alertId` | Đã dựng | Mô phỏng |
| S09 | Thiết bị, hướng dẫn, thay miếng dán | `/people/:id/devices` | Đã dựng | Mô phỏng |
| S10 | Lịch sử và ghi chú | `/people/:id/history` | Đã dựng | Mô phỏng |
| S11 | Báo cáo và xuất CSV | `/people/:id/reports` | Đã dựng. Không có xuất PDF | Mô phỏng |
| S12 | Gia đình và quyền truy cập | `/people/:id/sharing` | Đã dựng. Chưa có luồng chấp nhận lời mời | Mô phỏng |
| S13 | Thông báo và tài khoản | `/settings/notifications` | Đã dựng. Web Push chưa cấu hình (D09) | Mô phỏng |
| S14 | Vận hành | (đã gỡ) | Gỡ theo A35: chỉ persona quản trị mô phỏng vào được | Không áp dụng |
| Landing | Trang giới thiệu | `/` | Đã dựng đủ 8 section theo prompt: header sticky, hero, hai giải pháp, bản xem thử có tab, cách bắt đầu, quyền riêng tư, FAQ, CTA cuối và footer. CTA và dữ liệu xem thử theo A10 | Fixture tĩnh có nhãn mô phỏng |

## 3. Vị trí mã nguồn

| Thành phần | Vị trí |
| --- | --- |
| Token (một nguồn, bảng màu landing, A35) | `frontend/src/design-system/tokens.css` |
| Primitive | `frontend/src/design-system/primitives.tsx`, `feedback.tsx`, `overlays.tsx` |
| Component nghiệp vụ dùng chung | `frontend/src/features/common/` |
| Hợp đồng dữ liệu tạm (A02) | `frontend/src/data/contracts.ts` |
| Interface adapter | `frontend/src/data/adapter.ts` |
| Adapter mô phỏng và fixture | `frontend/src/data/demo/` |
| Stream gợi ý thay đổi | `frontend/src/data/stream.ts` |
| Màn hình | `frontend/src/features/<domain>/` |
| Landing (copy, dữ liệu xem thử, header, bản xem thử) | `frontend/src/features/landing/` |

Chế độ `VITE_DATA_MODE=http` đã được nối nhưng mọi lời gọi đều báo "Chưa có API". Chế độ này không bao giờ quay về dữ liệu demo.

## 4. Kiểm tra đã chạy

Chạy lại ngày 2026-09-15 trên Windows 11, Node 24, Chromium headless của Playwright.

| Lệnh | Kết quả |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | 36/36 pass (thêm 5 test landing) |
| `npm run build` | Pass. Bundle JS 714 kB, gzip 206 kB |
| `npm run test:e2e` | 21/21 pass (thêm 5 test landing) |

Kiểm tra theo tiêu chí nghiệm thu, **chỉ trên adapter mô phỏng**. Kết quả này không chứng minh backend thật cách ly dữ liệu.

| AC | Kiểm tra | Loại |
| --- | --- | --- |
| AC01 | Hồ sơ chỉ bật EcoPatch không gọi được API CareLens | Unit |
| AC03 | Người xem Nhóm B không thấy hồ sơ Nhóm A qua list, detail, export và UI | Unit + E2E |
| AC04 | Gửi trùng event chỉ tạo một event và một cảnh báo | Unit |
| AC05 | Tiếp nhận cùng lúc: người sau nhận 409 kèm trạng thái hiện tại | Unit + E2E |
| AC06 | Tiếp nhận không đóng cảnh báo và không ghi kết quả | Unit + E2E |
| AC07 | Hub mất kết nối hiển thị riêng, không báo bình thường | Unit + E2E |
| AC08 | Gói đo đến muộn không thay giá trị mới nhất | Unit |
| AC09 | Gói đo trước thời điểm gán thiết bị bị cách ly | Unit |
| AC10 | Retry thay miếng dán với cùng khóa không tạo phiên trùng | Unit + E2E |
| AC11 | Thu hồi quyền đóng stream và chặn truy cập mới | Unit + E2E |
| AC14 | Không có số pin hoặc ECG khi thiết bị không cung cấp | Unit |
| AC15 | CSV có nhãn mô phỏng, `source_mode`, chống formula injection | Unit |
| AC16 | Phản hồi không chứa dữ liệu hình ảnh | Unit |
| AC17 | Serial đúng nhưng sai mã kích hoạt thì không ghép được | Unit + E2E |
| AC18 | Quản trị nền tảng không đọc được dữ liệu sức khỏe | Unit |
| AC02, AC12, AC13 | Chưa có test tự động. AC12 cần worker thật. AC13 mới được mô phỏng bằng stream trong trình duyệt | Chưa kiểm tra |

## 5. Kết quả kiểm tra G1

G1 là mốc kiểm tra app shell và bốn màn hình cốt lõi. Cách kiểm tra: Playwright chụp màn hình và đo tràn ngang ở 360, 390, 768, 1024, 1440px cho tổng quan, CareLens, EcoPatch, cảnh báo, chi tiết cảnh báo, thiết bị, lịch sử, báo cáo và quyền truy cập. Ảnh lưu ở `frontend/test-results/screens/` (không commit).

**Đạt, theo kiểm tra tự động:**
- Không trang nào tràn ngang ở cả năm kích thước.
- Nút và link điều hướng trên mobile đạt tối thiểu 44×44px.
- Menu Menu/X có `aria-expanded` và tự đóng khi chuyển trang.
- Dialog đóng bằng Esc và trả focus về nút mở.
- Link bỏ qua điều hướng có focus ring.
- `prefers-reduced-motion` tắt animation float.

**Lỗi đã phát hiện và đã sửa trong lần kiểm tra này:**
- Bảng cảnh báo tràn ngang 105px ở 1024px. Bảng giờ hiển thị từ 1280px (A07).
- Nhãn đơn vị "bpm" đè lên số trên trục biểu đồ.
- Tab đang chọn khó phân biệt với tab chưa chọn. Đã thêm chấm chỉ báo.
- Trên mobile, panel xử lý cảnh báo nằm cuối trang. Giờ panel đứng ngay sau thông tin sự kiện.
- Sau khi đăng xuất, người đăng nhập tiếp theo bị đưa vào trang của người trước.
- Ô checkbox dùng `rounded-lg` trái design system.

**Còn tồn tại:**
- **Chữ trắng trên nút tím** chỉ đạt khoảng 4.32:1, dưới AA cho chữ thường. Tôi giữ nguyên thiết kế gốc vì ADR-009 còn mở và chờ người dùng chọn phương án.
- **Tương phản toàn app chưa đo tự động.** Chữ thiết yếu dùng `#3D4852`. `#6B7280` chưa được dùng cho chữ. Không tuyên bố đạt WCAG AA.
- **Font** tải từ Google Fonts. Khi không có mạng, trang dùng font hệ thống.
- **Ô chọn ngày** hiển thị theo locale của trình duyệt. Trong ảnh chụp Chromium headless, ngày hiện dạng tháng/ngày/năm.
- **Bundle** một file 686 kB, chưa tách route. Đủ cho demo, nên tách trước khi triển khai thật.
- **Chưa kiểm tra** trên thiết bị thật, bàn phím ảo mobile, zoom trình duyệt 200% và trình đọc màn hình thật.
- **Chưa có quan sát thử khả dụng** với người dùng (plan §12.1).

## 5b. Kiểm tra landing

Cách kiểm tra: Playwright chụp màn hình và đo tràn ngang ở 360, 390, 768, 1024, 1440px. Test Vitest kiểm tra nội dung và tương tác.

**Đạt, theo kiểm tra tự động:**
- Không tràn ngang ở cả năm kích thước.
- Hình minh họa hero vẫn hiển thị trên mobile.
- Mọi phần tử bấm được trên mobile đạt tối thiểu 44×44px.
- CTA “Khám phá bản demo” cuộn tới bản xem thử.
- Tab bản xem thử dùng đúng vai trò ARIA `tablist`, `tab`, `tabpanel` và chuyển được bằng phím mũi tên.
- “Tiếp nhận kiểm tra” chỉ đổi sang “Đã tiếp nhận · Chưa có kết quả kiểm tra”. Cảnh báo không bị đóng. Hero hiển thị cùng trạng thái đó.
- Drawer chi tiết đóng bằng Esc và trả focus về nút mở.
- Menu mobile đóng khi chọn mục hoặc nhấn Esc, và trả focus về nút Menu.
- FAQ có đủ 7 mục mở/đóng.
- Mọi link `#` trỏ tới phần tử có thật. Không có `href="#"`.
- `prefers-reduced-motion` tắt animation float và smooth scroll.
- Không có tuyên bố “100%”, “tuyệt đối”, dự đoán đột quỵ/mất nước, hydrat hóa hay SpO2.

**Lỗi phát hiện và đã sửa trong lần kiểm tra này:**
- CTA trên header vẫn hiện ở mobile vì class `inline-flex` thắng `hidden`, đẩy nút Menu ra ngoài 54px.
- Ba tab xem thử rớt dòng ở 390px. Đã giảm padding tab trên mobile.
- Testing Library không dọn DOM giữa các test vì Vitest không bật globals. Đã thêm cleanup trong `src/test/setup.ts`.

**Còn tồn tại:**
- **Chữ trắng trên nút tím** chỉ đạt khoảng 4.32:1, ADR-009 còn mở. Nhãn các nút primary trên landing có cỡ 16px, dưới ngưỡng chữ lớn.
- **Header** chỉ hiện đủ năm nhãn điều hướng từ 1280px, dưới mức đó dùng menu (A10).
- **Landing không có SSR** (ADR-002), nên SEO bị hạn chế.
- **Chưa kiểm tra** trên thiết bị thật và trình đọc màn hình thật.

## 6. Cập nhật trải nghiệm UI (2026-09-15)

- Giảm padding card trên mobile, giữ không gian rộng hơn từ tablet trở lên; CTA trong hàng cảnh báo và “Việc cần làm” nay chiếm toàn bộ chiều ngang ở mobile để dễ chạm.
- Ô chọn hồ sơ trong header co giãn theo phần còn lại của thanh công cụ, tránh cắt tên sớm khi cạnh nút menu và công cụ demo.
- Lịch sử miếng dán chuyển thành thẻ có nhãn trường dưới `md`; bảng đầy đủ chỉ còn ở desktop/tablet để không cắt cột hay yêu cầu cuộn ngang trên điện thoại.
- Biểu đồ EcoPatch giữ tỷ lệ chữ đọc được trên mobile và có chỉ dẫn vuốt ngang; vẫn biểu thị khoảng mất dữ liệu, không nối đường qua đoạn thiếu.
- CTA primary dùng token `accent-strong` tạm thời để chữ trắng đủ tương phản; xem A11 trong `docs/DECISIONS.md`.
- Sidebar desktop rộng 320px, nhãn menu không xuống dòng, giảm nhịp dọc để hiển thị toàn bộ mục ở chiều cao desktop thông thường; có nút ẩn/hiện cố định ở giữa mép trái.
- Khi sidebar mở, nút ẩn/hiện bám vào mép phải của sidebar; khi đóng, nút trở lại mép trái màn hình. Thương hiệu hiển thị của web là Day1Care; CareLens và EcoPatch vẫn là tên hai module.
- Lockup `BrandIdentity` dùng chung logo Day1Care ở landing, app shell, đăng nhập, onboarding và footer; favicon trỏ tới asset logo.

## 7. Khoảng trống tích hợp

| Hạng mục | Tình trạng | Cần gì |
| --- | --- | --- |
| Xác thực, phiên, CSRF | Chỉ phiên demo trong bộ nhớ | API M1 (ADR-006) |
| Thực thi quyền, thu hồi với stream, export, hàng đợi thông báo | Chỉ mô phỏng trong trình duyệt | Backend và test integration M1–M3 |
| Stream SSE, reconnect bằng `Last-Event-ID` | Mô phỏng. Hook đã xử lý dedup, lastSeq và retry | API SSE (ADR-010) |
| Hub CareLens, gateway EcoPatch | Chưa tích hợp | M5, cần D01–D04 |
| Nhà cung cấp thông báo, Web Push | Chưa cấu hình. Ghi vào hộp nội bộ | D09 |
| Chấp nhận lời mời | Chưa có | Máy chủ xác thực |
| Cấu hình AI cho người vận hành | Chưa có | Xác minh `PATCH /api/v1/ai/config` |
| Dữ liệu xem thử trên landing | Fixture tĩnh (A10) | Xem xét lại khi có API công khai |
