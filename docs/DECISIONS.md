# Nhật ký quyết định

Nơi ghi quyết định, giả định, vấn đề chưa chốt và mâu thuẫn tài liệu. Dùng skill `/decision-log` để thêm hoặc cập nhật.

## Quy ước

| Trạng thái | Nghĩa | Ai được đặt |
| --- | --- | --- |
| Open | Vấn đề chưa chốt, đang dùng phương án tạm | Agent hoặc dev |
| Proposed | Đề xuất cụ thể, chờ duyệt | Agent hoặc dev |
| Accepted | Đã duyệt. Bắt buộc ghi ai duyệt, khi nào, ở đâu | Chỉ người dùng hoặc owner |
| Rejected | Đã bác bỏ | Chỉ người dùng hoặc owner |
| Superseded | Bị thay bởi mục mới | Khi mục mới Accepted |

Loại ID: `Dxx` vấn đề sản phẩm/dữ liệu/thiết bị · `ADR-xxx` quyết định kỹ thuật · `Axx` giả định tạm.

Không sửa nội dung mục đã Accepted. Tạo mục mới ghi `Supersedes`.

## Tổng hợp

| ID | Tiêu đề | Trạng thái | Cập nhật |
| --- | --- | --- | --- |
| D01 | Ranh giới local (CareLens) và cloud (EcoPatch) | Open | 2026-09-14 |
| D02 | Camera đeo có quan sát được tư thế người đeo | Open | 2026-09-14 |
| D03 | Care level và độ trễ AI chưa có bằng chứng đánh giá | Open | 2026-09-14 |
| D04 | Schema telemetry/BLE EcoPatch | Open | 2026-09-14 |
| D05 | Dự đoán đột quỵ/mất nước chưa kiểm chứng | Open | 2026-09-14 |
| D06 | Vòng đời miếng dán 7–14 ngày và gói 30 miếng/tháng | Open | 2026-09-14 |
| D07 | Đội ngũ, deadline, code hiện có | Open | 2026-09-14 |
| D08 | Thời hạn lưu và xóa dữ liệu thật | Open | 2026-09-14 |
| D09 | Nhà cung cấp thông báo | Open | 2026-09-14 |
| ADR-001 | Neumorphism cho landing và app | Accepted | 2026-09-14 |
| ADR-002 | Modular monolith: React SPA + FastAPI + PostgreSQL | Accepted | 2026-09-14 |
| ADR-003 | Monorepo với npm workspaces và uv workspace | Accepted | 2026-09-14 |
| ADR-004 | Token Neumorphism một nguồn trong Tailwind v4 | Accepted | 2026-09-14 |
| ADR-005 | Transactional outbox trên PostgreSQL | Accepted | 2026-09-14 |
| ADR-006 | Session phía server với cookie httpOnly | Accepted | 2026-09-14 |
| ADR-007 | contracts/ JSON Schema và type sinh từ OpenAPI | Accepted | 2026-09-14 |
| ADR-008 | Diễn giải giá trị motion mâu thuẫn trong design system | Accepted | 2026-09-14 |
| ADR-009 | Quy tắc dùng màu muted và chữ trắng trên accent | Accepted (chữ trắng trên accent còn Open) | 2026-09-14 |
| ADR-010 | SSE chỉ mang gợi ý thay đổi | Accepted | 2026-09-14 |
| ADR-011 | Demo trên Cloud Run với banner mô phỏng | Proposed | 2026-09-15 |
| ADR-012 | Cấu trúc repo: frontend/ + backend/ thay cho apps/ | Proposed | 2026-09-21 |
| ADR-013 | Telegram-driven Demo Control (LIVESHOWCASE) | Accepted | 2026-09-22 |
| A01 | Múi giờ hiển thị mặc định Asia/Ho_Chi_Minh | Proposed | 2026-09-14 |
| A02 | Type contract viết tay ở web cho tới khi có OpenAPI | Proposed | 2026-09-14 |
| A03 | Diễn giải trạng thái hover và pressed của nút primary | Proposed | 2026-09-14 |
| A04 | Dữ liệu và phiên demo chỉ nằm trong bộ nhớ trình duyệt | Proposed | 2026-09-14 |
| A05 | features/common là module nghiệp vụ dùng chung duy nhất | Proposed | 2026-09-14 |
| A06 | Bộ permission mặc định tạm cho UI demo | Proposed | 2026-09-14 |
| A07 | Điều hướng tablet dạng rail và bảng cảnh báo từ 1280px | Proposed | 2026-09-14 |
| A08 | Route `/` chuyển tới `/login` cho tới khi có landing | Superseded bởi A10 | 2026-09-15 |
| A09 | Biểu đồ SVG tự viết thay cho thư viện biểu đồ | Proposed | 2026-09-14 |
| A10 | Cách triển khai landing: CTA, dữ liệu xem thử, điểm gập menu | Proposed | 2026-09-15 |
| A11 | Accent đậm hơn cho CTA để tăng khả năng đọc | Proposed | 2026-09-15 |

## Vấn đề sản phẩm chưa chốt (từ plan §3)

Owner của D01–D09 chưa được gán. Không dùng D02–D06 để chặn phát triển giao diện và nghiệp vụ mô phỏng. Không bật tích hợp thật khi quyết định liên quan chưa Accepted.

| ID | Vấn đề | Mặc định cho demo | Điều kiện trước tích hợp thật | Owner |
| --- | --- | --- | --- | --- |
| D01 | CareLens không cloud, EcoPatch có cloud | Một demo local với dữ liệu tổng hợp. Tách adapter và kho dữ liệu theo module | Chốt ranh giới local/cloud, xác thực và truy cập từ xa | Chưa gán |
| D02 | Camera đeo có quan sát được tư thế người đeo không | Sự kiện mô phỏng gắn với hồ sơ rõ ràng | Xác minh góc nhìn và cách ánh xạ sự kiện. Không đoán danh tính người trong ảnh | Chưa gán |
| D03 | Điểm care level và độ trễ AI chưa có bằng chứng đánh giá | Hiển thị điểm gốc như thông tin AI thử nghiệm | Đo trên cấu hình thật, xác nhận phiên bản mô hình và quy tắc cảnh báo | Chưa gán |
| D04 | EcoPatch chưa có schema telemetry/BLE | Adapter mô phỏng theo schema đề xuất plan §8 | Chốt GATT, định dạng gói, đơn vị, tần suất, hiệu chuẩn, chất lượng tín hiệu | Chưa gán |
| D05 | Dự đoán đột quỵ/mất nước chưa có kết quả kiểm chứng | Không triển khai, không hiển thị như chức năng hoạt động | Có đặc tả và bằng chứng đánh giá phù hợp | Chưa gán |
| D06 | Vòng đời 7–14 ngày không khớp gói 30 miếng/tháng | Cho nhập ngày dự kiến thay. Chưa bán subscription | Chốt vòng đời sử dụng và quy cách bán, tách khỏi thời gian phân hủy | Chưa gán |
| D07 | Chưa biết đội ngũ, deadline, code hiện có | Ưu tiên luồng demo xuyên suốt | Cập nhật ước lượng sau khảo sát M0 | Chưa gán |
| D08 | Chưa chốt thời hạn lưu và xóa dữ liệu thật | Chỉ dữ liệu tổng hợp, có tác vụ reset demo | Chốt thời hạn theo từng loại dữ liệu, kể cả bản sao lưu | Chưa gán |
| D09 | Chưa có nhà cung cấp thông báo | Lưu notification vào sink nội bộ, không gửi ra ngoài | Cấu hình kênh, quyền người nhận, kiểm tra thiết bị, phương án dự phòng | Chưa gán |

## Quyết định kỹ thuật

### ADR-001 — Neumorphism cho landing và app

- **Trạng thái:** Accepted
- **Duyệt bởi:** người dùng, ghi nhận trong `docs/IMPLEMENTATION_PLAN.md` v1.2 (2026-09-14), mục 1 và 6.1
- **Quyết định:** Landing và UI hệ thống cùng dùng Neumorphism / Soft UI theo khối `<design-system>` trong hai prompt. Hướng A/B ở v1.1 bị thay thế.
- **Hệ quả:** Không hỏi lại style. G1 là mốc kiểm tra chất lượng áp dụng, không phải bước chọn style.

### ADR-002 — Modular monolith: React SPA + FastAPI + PostgreSQL

- **Trạng thái:** Accepted · Duyệt bởi người dùng, 2026-09-14, phiên chat Claude Code · Đề xuất bởi coding agent
- **Bối cảnh:** Repo chưa có code. Plan §4.1 đề xuất React + TypeScript, FastAPI, PostgreSQL, SSE và worker. Nhóm nhỏ, lịch 6–8 tuần. Khối AI CareLens viết bằng Python.
- **Phương án:**
  1. Vite SPA + FastAPI modular monolith + PostgreSQL.
  2. Next.js full-stack TypeScript + PostgreSQL.
  3. Microservices tách theo sản phẩm.
- **Lựa chọn:** Phương án 1.
- **Lý do:** Khớp plan. OpenAPI tự sinh cho type web. Cùng ngôn ngữ với simulator và khối AI. App đăng nhập không cần SSR. Phương án 3 quá nặng cho quy mô nhóm.
- **Hệ quả:** Hai toolchain Node và Python. Landing không SSR nên SEO hạn chế, chấp nhận được cho demo.
- **Xem lại khi:** landing cần SEO mạnh, hoặc phát hiện repo CareLens/EcoPatch có sẵn dùng stack khác cần tái sử dụng.

### ADR-003 — Monorepo với npm workspaces và uv workspace

- **Trạng thái:** Accepted · Duyệt bởi người dùng, 2026-09-14, phiên chat Claude Code
- **Bối cảnh:** Plan §11 gợi ý `frontend/`, `backend/`, `integrations/`, `contracts/`. Máy dev Windows đã có Node 24, npm 11, Python 3.11/3.14. Chưa có pnpm và uv.
- **Phương án:**
  1. npm workspaces + uv workspace.
  2. pnpm + Poetry.
  3. npm + pip/venv với requirements.txt.
- **Lựa chọn:** Phương án 1.
- **Lý do:** npm có sẵn. uv có lockfile, quản lý phiên bản Python, workspace chung cho `backend/api` và `integrations/*`. Phương án 3 không có lockfile đáng tin.
- **Hệ quả:** Cần cài uv một lần. Script điều phối viết bằng npm scripts để chạy trên Windows, không dùng Makefile hay bash.

### ADR-004 — Token Neumorphism một nguồn trong Tailwind v4

- **Trạng thái:** Accepted · Duyệt bởi người dùng, 2026-09-14, phiên chat Claude Code
- **Bối cảnh:** Design system gốc viết bằng utility Tailwind và giá trị shadow tùy ý. Plan §6.1 yêu cầu một nguồn token cho landing và app.
- **Phương án:**
  1. Tailwind v4, token trong `@theme` tại `design-system/tokens.css`.
  2. CSS Modules với biến CSS.
  3. Thư viện component có sẵn (MUI, shadcn/ui) rồi ghi đè style.
- **Lựa chọn:** Phương án 1.
- **Lý do:** Chuyển nguyên văn giá trị gốc. Sinh utility có tên (`shadow-extruded`, `rounded-container`) nên feature không cần giá trị tùy ý. Phương án 3 kéo theo style mặc định trái với Neumorphism.
- **Hệ quả:** Cấm hex và shadow tùy ý trong `features/`. `/guardrail-check` quét vi phạm.

### ADR-005 — Transactional outbox trên PostgreSQL

- **Trạng thái:** Accepted · Duyệt bởi người dùng, 2026-09-14, phiên chat Claude Code
- **Bối cảnh:** AC12 yêu cầu không mất thông báo khi worker dừng sau khi lưu alert. Plan §10 yêu cầu retry có giới hạn và chống gửi trùng.
- **Phương án:**
  1. Bảng outbox ghi cùng transaction, worker Python dùng `FOR UPDATE SKIP LOCKED`.
  2. Celery + Redis.
  3. BackgroundTasks trong FastAPI.
- **Lựa chọn:** Phương án 1.
- **Lý do:** Phương án 3 mất việc khi process chết. Phương án 2 thêm hạ tầng và vẫn cần outbox để đảm bảo nguyên tử.
- **Hệ quả:** Throughput giới hạn bởi polling, đủ cho demo. Worker là process riêng trong `npm run dev`.

### ADR-006 — Session phía server với cookie httpOnly

- **Trạng thái:** Accepted · Duyệt bởi người dùng, 2026-09-14, phiên chat Claude Code
- **Bối cảnh:** Plan §10 và prompt S01 cấm `localStorage.isLoggedIn`, yêu cầu bảo vệ session, CSRF, giới hạn thử đăng nhập, thu hồi quyền có hiệu lực ngay.
- **Phương án:**
  1. Session lưu DB + cookie httpOnly + CSRF token + argon2.
  2. JWT lưu trong localStorage.
  3. Dịch vụ auth bên ngoài.
- **Lựa chọn:** Phương án 1.
- **Lý do:** Phương án 2 trái yêu cầu. Phương án 3 là dịch vụ ngoài, có thể trả phí, cần người dùng quyết định.
- **Hệ quả:** Thu hồi phiên tức thì. Đăng nhập demo dùng tài khoản tổng hợp qua session thật với nút `Vào bản demo`.

### ADR-007 — contracts/ JSON Schema và type sinh từ OpenAPI

- **Trạng thái:** Accepted · Duyệt bởi người dùng, 2026-09-14, phiên chat Claude Code
- **Bối cảnh:** Plan §11 yêu cầu `contracts/` có version và fixture được validate. Web và API cần cùng một hợp đồng.
- **Phương án:**
  1. JSON Schema cho dữ liệu nguồn. OpenAPI từ FastAPI sinh type TypeScript bằng openapi-typescript.
  2. Viết type TypeScript và Pydantic bằng tay ở hai nơi.
  3. Protobuf hoặc gRPC.
- **Lựa chọn:** Phương án 1.
- **Lý do:** Một nguồn sự thật mỗi loại hợp đồng. Phương án 2 dễ lệch. Phương án 3 không hợp với trình duyệt và SSE.
- **Hệ quả:** Sau khi đổi schema API phải chạy lệnh sinh type. CI kiểm tra file sinh không lệch.

### ADR-008 — Diễn giải giá trị motion mâu thuẫn trong design system

- **Trạng thái:** Accepted · Duyệt bởi người dùng, 2026-09-14, phiên chat Claude Code
- **Bối cảnh:** Khối `<design-system>` ghi pixel cụ thể ở mục Component Styling (button hover `translate-y-[-1px]`, active `translate-y-[0.5px]`, card hover `translate-y-[-2px]`) nhưng mục Animation ghi `-translate-y-1` và `translate-y-0.5`. Với spacing mặc định của Tailwind, hai giá trị sau là 4px và 2px. Hai prompt yêu cầu ghi lại cách diễn giải.
- **Phương án:**
  1. Dùng giá trị pixel ở mục Component Styling.
  2. Dùng utility Tailwind ở mục Animation.
- **Lựa chọn:** Phương án 1.
- **Lý do:** Giá trị pixel cụ thể hơn và khớp mô tả "slight lift". Mục Card ở Animation cũng tự ghi "1px lift" cạnh `-translate-y-1`.
- **Hệ quả:** Button hover −1px, active +0.5px. Card hover −2px. Nested circle `scale-105` + `rotate-180`. Thời lượng 300ms UI và 500ms nested depth, ease-out.
- **Xem lại khi:** kiểm tra G1 thấy chuyển động quá yếu.

### ADR-009 — Quy tắc dùng màu muted và chữ trắng trên accent

- **Trạng thái:** Quy tắc màu muted: Accepted · Duyệt bởi người dùng, 2026-09-14, phiên chat Claude Code. Phần chữ trắng trên nút primary vẫn Open, chờ người dùng chọn phương án
- **Bối cảnh:** Tỷ lệ tính từ hex (plan §6.2): `#3D4852` trên nền 7.38:1. `#6B7280` trên nền 3.82:1, không đạt AA cho chữ thường dù design system ghi 4.6:1. Chữ trắng trên `#6C63FF` 4.32:1, không đạt AA cho chữ thường. Plan cấm đổi palette âm thầm.
- **Đề xuất cho màu muted:** Chữ thiết yếu (timestamp để ra quyết định, đơn vị, nhãn trạng thái, cảnh báo, lỗi) dùng `fg`. Chỉ dùng `muted` cho chữ lớn (từ 24px thường hoặc 18.66px đậm) hoặc chữ không thiết yếu.
- **Phần còn Open, chữ trắng trên nút primary:**
  1. Giữ nguyên và ghi nhận xung đột.
  2. Nhãn nút primary từ 19px đậm để đạt ngưỡng chữ lớn (3:1).
  3. Đổi màu nền nút. Đây là thay đổi palette, cần người dùng duyệt.
- **Xem lại khi:** kiểm tra G1 ở M0. Không tuyên bố toàn app đạt WCAG AA.

### ADR-010 — SSE chỉ mang gợi ý thay đổi

- **Trạng thái:** Accepted · Duyệt bởi người dùng, 2026-09-14, phiên chat Claude Code
- **Bối cảnh:** Plan §7.4 và AC11, AC13 yêu cầu reconnect không mất sự kiện, không trùng, và thu hồi quyền có hiệu lực với stream đang mở.
- **Phương án:**
  1. SSE gửi `{seq, type, entity_id}`, client refetch qua REST.
  2. SSE gửi toàn bộ bản ghi.
  3. WebSocket hai chiều.
- **Lựa chọn:** Phương án 1.
- **Lý do:** Quyền được kiểm lại mỗi lần đọc. Stream không chứa dữ liệu sức khỏe. Replay chỉ cần `seq`. Web không cần gửi dữ liệu ngược qua stream.
- **Hệ quả:** Thêm request sau mỗi gợi ý, chấp nhận được ở quy mô demo.

### ADR-011 — Demo trên Cloud Run với banner mô phỏng

- **Trạng thái:** Proposed · 2026-09-15 · Đề xuất bởi coding agent
- **Bối cảnh:** Demo local hiện tại chỉ chạy trên máy dev. Cần mở rộng sang Cloud Run để trình diễn investor không cần cài đặt. GCP yêu cầu project + billing từ người dùng.
- **Phương án:**
  1. Cloud Run cho web (static SPA) và bridge (Telegram ↔ WebSocket hub).
  2. Cloud Run + Cloud SQL (không dùng).
  3. Máy ảo hoặc Kubernetes.
- **Lựa chọn:** Phương án 1.
- **Lý do:** Cloud Run serverless, scale về 0 khi không dùng, miễn phí 2 triệu request/tháng. Web là static files phù hợp container nhẹ. Bridge là Node.js service đơn giản.
- **Hệ quả:**
  - Không có API nghiệp vụ thật — mọi data chỉ trong bộ nhớ trình duyệt.
  - Không có thiết bị thật — mọi event/measurement là simulated.
  - Không Cloud SQL — dữ liệu không persist giữa các lần refresh.
  - Bridge dùng long polling Telegram (hoặc webhook nếu có domain).
  - Secret (Telegram bot token) lưu trong Secret Manager.
- **Ranh giới:**
  - Web trên Cloud Run: `https://carelens-demo-web-<hash>.a.run.app`
  - Bridge trên Cloud Run: `https://carelens-demo-bridge-<hash>.a.run.app/ws`
  - Cả hai đều hiển thị banner "Bản demo · Dữ liệu mô phỏng" trên mọi trang.
  - Không dùng cho production với dữ liệu thật hoặc người dùng thật.
  - Không gửi notification tới người thật.
- **Xem lại khi:** Cần persistence (Cloud SQL), tích hợp thiết bị thật (M5), hoặc thanh toán thật.

### ADR-012 — Cấu trúc repo: frontend/ + backend/ thay cho apps/

- **Trạng thái:** Proposed · 2026-09-21
- **Bối cảnh:** ADR-003 chốt monorepo với npm workspaces và uv workspace. Cấu trúc `apps/web/` + `apps/api/` đã có từ M0. User yêu cầu tái cấu trúc thành `frontend/` + `backend/` để rõ ràng hơn về vai trò của mỗi phần.
- **Phương án:**
  1. `frontend/` + `backend/` (đề xuất).
  2. Giữ nguyên `apps/web/` + `apps/api/`.
  3. Cấu trúc phẳng hơn (`web/`, `api/`, `services/`).
- **Lựa chọn:** Phương án 1.
- **Lý do:** Tách biệt rõ frontend và backend. `backend/services/` chứa các service riêng như demo-bridge. Cấu trúc tương thích với ADR-003 và uv workspace.
- **Hệ quả:**
  - `tools/demo-bridge/` → `backend/services/demo-bridge/`
  - `apps/web/` → `frontend/` (khi có code)
  - `apps/api/` → `backend/api/` (scaffold ở M1)
  - `apps/` và `tools/` bị xóa
  - Package.json workspaces: `["frontend/*", "backend/*"]`
  - Cần cập nhật tất cả đường dẫn trong tài liệu
- **Xem lại khi:** Cần thêm service khác ngoài demo-bridge.

### ADR-013 — Telegram-driven Demo Control (LIVESHOWCASE)

- **Trạng thái:** Accepted · 2026-09-22 · Người dùng phê duyệt trong phiên chat
- **Bối cảnh:** Cuộc thi demo cần điều khiển thiết bị từ Telegram thay vì giao diện web. Backend `demo-control` là hub trạng thái.
- **Phương án:**
  1. Thêm Telegram bot long-polling vào `backend/demo-control`, dispatch vào `apply_command()`.
  2. Backend SSE broadcast trạng thái tới frontend qua `mergeBackendDevices/Events/Alerts`.
- **Lựa chọn:** Phương án 1 + 2.
- **Lý do:** Long polling (python-telegram-bot) không cần webhook URL. Bot chạy trong FastAPI lifespan. Chỉ `r_liveshowcase` bị ảnh hưởng; các persona tĩnh không đụng.
- **Lệnh Telegram (16 lệnh):**

| Lệnh | Mục đích | Backend | Frontend |
| --- | --- | --- | --- |
| `/c_on` | Bật CareLens | `carelens_online` | Thiết bị online, SSE |
| `/c_off` | Tắt CareLens | `carelens_offline` | Thiết bị offline, SSE |
| `/c_status` | Trạng thái CareLens | Đọc state, reply trực tiếp | — |
| `/c_fall` | Mô phỏng ngã (critical, alert) | `carelens_event_fall`, source_mode="telegram" | Event + alert, SSE |
| `/c_low` | Mô phỏng tư thế thấp gần sàn (warning, alert) | `carelens_event_posture`, source_mode="telegram" | Event + alert, SSE |
| `/c_activity` | Mô phỏng đang hoạt động | `carelens_event_activity`, source_mode="telegram" | Event, SSE |
| `/c_inactive` | Mô phỏng ít vận động | `carelens_event_idle`, source_mode="telegram" | Event, SSE |
| `/c_idle` | Alias của `/c_inactive` | `carelens_event_idle` | Event, SSE |
| `/c_lying` | Mô phỏng đang nằm (no alert) | `carelens_event_lying`, category="posture", type="lying", severity="notice", care_level=3, source_mode="telegram" | Event, SSE |
| `/c_water` | Ghi nhận đã uống nước | CareNote, source="telegram" | Note, SSE |
| `/c_medicine` | Ghi nhận đã uống thuốc | CareNote, source="telegram" | Note, SSE |
| `/e_on` | Bật EcoPatch (online) | `ecopatch_online` | Thiết bị online, SSE (không tự sinh BPM) |
| `/e_off` | Tắt EcoPatch (offline) | `ecopatch_offline` | Thiết bị offline, SSE |
| `/e_status` | Trạng thái EcoPatch | Đọc state, reply trực tiếp | — |
| `/status` | Trạng thái toàn hệ thống | Đọc state, reply trực tiếp | — |
| `/reset` | Đặt lại demo state | Xóa events/alerts/notes, đặt thiết bị offline | SSE reset |
| `/menu` | Hiển thị menu lệnh | Reply với MENU_TEXT | — |
| `/start` | Chào mừng + menu | Reply với MENU_TEXT | — |

- **`/c_lying` quyết định:** Dùng `category = "posture"` (không thêm category mới). Thêm trường `type = "lying"` để phân biệt. `CareEventCategory` union TypeScript không mở rộng.
- **`source_mode = "telegram"`:** Mọi event từ Telegram được tag `source_mode="telegram"`. Frontend hiển thị `TelegramBadge`.
- **BPM isolation:** `/e_on` bật EcoPatch online NHƯNG không tự sinh dữ liệu BPM. `mergeBackendDevices({ seedMeasurements: false })` được gọi trong SSE handler. Biểu đồ TrendChart sẽ trống cho đến khi có đường ingestion thật (M5).
- **Care note semantics:** `/c_water` và `/c_medicine` ghi vào `CareNote` với `source="telegram"`. Hiển thị trong History timeline.
- **Reset:** `/reset` xóa events/alerts/notes của `r_liveshowcase`, đặt cả hai thiết bị offline. Không ảnh hưởng các persona khác.
- **Authorization:** `ALLOWED_CHAT_IDS` là bắt buộc. `ALLOWED_USER_IDS` là tùy chọn: nếu set → cả `chat_id` VÀ `user_id` phải cùng nằm trong tập tương ứng. Nếu empty → chỉ kiểm tra `chat_id`.
- **Cấu hình:** `TELEGRAM_BOT_TOKEN`, `ALLOWED_CHAT_IDS`, `ALLOWED_USER_IDS` (tùy chọn), `TELEGRAM_ADMIN_CHAT_ID` trong `.env`.
- **Hệ quả:**
  - Backend thêm `python-telegram-bot>=21.0.0`.
  - `state.py` thêm `_apply_carelens_event(source_mode)`, `type_` field, `source` field trong note.
  - `demoAdapter.ts` thêm `type` field trong `EventFromBackend` và `mergeBackendEvents`.
  - `contracts.ts` thêm `"telegram"` vào `SourceMode`, thêm `type?: string` vào `CareEvent`.
  - `feedback.tsx` thêm `TelegramBadge` dùng cùng style với `DemoBadge`.
  - Frontend hiển thị `TelegramBadge` cho events/alerts có `sourceMode === "telegram"`.
- **Xem lại khi:** M5 (tích hợp ESP32-C3 + MAX30102) cần thêm nguồn BPM thật.

## Giả định tạm

### A01 — Múi giờ hiển thị mặc định Asia/Ho_Chi_Minh

- **Trạng thái:** Proposed · 2026-09-14
- **Nội dung:** Dữ liệu lưu UTC. Hiển thị theo múi giờ cấu hình, mặc định `Asia/Ho_Chi_Minh` vì người dùng mục tiêu ở Việt Nam. Báo cáo và biểu đồ ghi rõ múi giờ.
- **Xem lại khi:** có người dùng ngoài Việt Nam, hoặc cần múi giờ theo hồ sơ.

### A02 — Type contract viết tay ở web cho tới khi có OpenAPI

- **Trạng thái:** Proposed · 2026-09-14
- **Nội dung:** Chưa có `backend/api` nên chưa sinh được type theo ADR-007. Type tạm nằm ở `frontend/src/data/contracts.ts`, theo plan §8 và ARCHITECTURE §6.
- **Mặc định đang dùng:** UI chỉ dùng type này qua `DataAdapter`. Không thêm trường ngoài plan.
- **Điều kiện giải quyết:** Ở M1, thay bằng `src/data/generated/openapi.ts` và xóa file tạm.
- **Owner:** Chưa gán

### A03 — Diễn giải trạng thái hover và pressed của nút primary

- **Trạng thái:** Proposed · 2026-09-14
- **Nội dung:** Design system ghi nút primary khi bấm dùng "specific rgba inset shadows" nhưng không có giá trị. Nó cũng ghi accent light `#8B84FF` dùng cho hover.
- **Mặc định đang dùng:** Bóng pressed là token `--shadow-accent-pressed`, lấy từ màu accent. Khi hover, nút giữ nền `#6C63FF`, chỉ nhấc lên và đổi bóng. Không đổi sang `#8B84FF` vì chữ trắng trên nền đó còn kém tương phản hơn 4.32:1. `#8B84FF` chưa được dùng.
- **Điều kiện giải quyết:** Người dùng xác nhận hoặc cung cấp giá trị gốc. Liên quan phần còn mở của ADR-009.
- **Owner:** Chưa gán

### A04 — Dữ liệu và phiên demo chỉ nằm trong bộ nhớ trình duyệt

- **Trạng thái:** Proposed · 2026-09-14
- **Nội dung:** Không dùng web storage cho phiên hoặc dữ liệu sức khỏe (AGENTS.md §6).
- **Mặc định đang dùng:** Tải lại trang sẽ đặt lại dữ liệu mô phỏng và đưa về trang đăng nhập. Mở trực tiếp một đường dẫn sâu cũng cần vào demo lại.
- **Điều kiện giải quyết:** Hết hiệu lực khi có session phía server (ADR-006, M1).
- **Owner:** Chưa gán

### A05 — features/common là module nghiệp vụ dùng chung duy nhất

- **Trạng thái:** Proposed · 2026-09-14
- **Nội dung:** Rule frontend cấm các feature import lẫn nhau. Tuy vậy, nhiều màn hình cần chung component nghiệp vụ như độ mới nguồn, hàng cảnh báo, nhận định AI, nhãn trạng thái và form ghép thiết bị.
- **Mặc định đang dùng:** `src/features/common/` là ngoại lệ duy nhất mà mọi feature được import. Các feature khác vẫn không import lẫn nhau.
- **Owner:** Chưa gán

### A06 — Bộ permission mặc định tạm cho UI demo

- **Trạng thái:** Proposed · 2026-09-14
- **Nội dung:** ARCHITECTURE §6.2 để bảng permission chốt ở M1.
- **Mặc định đang dùng:** Caregiver có thêm `patches.replace`. Manager mặc định không có `data.read`, quyền dữ liệu được cấp thêm trên grant khi có đồng ý chia sẻ. Xuất dữ liệu cần cả `exports.create` và `data.read`. Chỉ người có `sharing.manage` xem được danh sách người truy cập.
- **Điều kiện giải quyết:** Chốt ở M1 cùng schema quyền backend.
- **Owner:** Chưa gán

### A07 — Điều hướng tablet dạng rail và bảng cảnh báo từ 1280px

- **Trạng thái:** Proposed · 2026-09-14
- **Nội dung:** Plan §6.3 yêu cầu điều hướng gọn ở 768–1023px nhưng không mô tả cụ thể.
- **Mặc định đang dùng:** Dưới 768px dùng hamburger. Từ 768px đến 1023px dùng rail raised 112px, mỗi mục có icon và nhãn ngắn, tên đầy đủ nằm trong `aria-label`. Từ 1024px dùng sidebar. Danh sách cảnh báo hiển thị dạng bảng từ 1280px, vì ở 1024px bảng 7 cột bị tràn ngang.
- **Owner:** Chưa gán

### A08 — Route `/` chuyển tới `/login` cho tới khi có landing

- **Trạng thái:** Superseded bởi A10 · 2026-09-15. Người dùng yêu cầu làm landing trong phiên chat ngày 2026-09-15; `/` giờ là landing.
- **Nội dung:** Yêu cầu lần này chỉ gồm UI hệ thống. Landing theo `CARELENS_ECOPATCH_LANDING_PROMPT.md` chưa được triển khai.
- **Mặc định đang dùng:** `/` chuyển tới `/login`. Token và primitive trong `src/design-system/` sẵn sàng cho landing dùng lại.
- **Owner:** Chưa gán

### A10 — Cách triển khai landing: CTA, dữ liệu xem thử, điểm gập menu

- **Trạng thái:** Proposed · 2026-09-15
- **Bối cảnh:** Landing theo `docs/CARELENS_ECOPATCH_LANDING_PROMPT.md`. Prompt yêu cầu mọi CTA có đích thật, bản xem thử có nhãn mô phỏng, hamburger dưới `md`, và bản xem thử dùng lại component nghiệp vụ.
- **Lựa chọn tạm:**
  1. **CTA chính** “Khám phá bản demo” ở hero, header và cuối trang đều cuộn tới bản xem thử `#trai-nghiem`. Trong bản xem thử có link “Mở bản demo đầy đủ” tới `/login`, nơi có mục “Vào bản demo”. CTA phụ cuộn tới `#giai-phap`. “Đăng nhập” trỏ tới `/login` vì route đã tồn tại.
  2. **Dữ liệu xem thử** là fixture tĩnh ở `features/landing/previewData.ts`, đúng các ví dụ trong prompt (Bà An, 09:35, Mất kết nối · 09:36, 72 bpm · 09:42, Chưa đặt lịch thay). Không dùng `demoAdapter`, vì landing công khai, không có phiên, và giờ trong prompt là cố định. Giao diện vẫn dùng lại component chung (`AlertStatusLabel`, `SeverityLabel`, `AiObservation`, `MeasurementFigure`, `ConnectionLabel`, `ProductTag`). Trạng thái tiếp nhận chỉ nằm trong state của trang và dùng chung cho hero và bản xem thử.
  3. **Điểm gập menu:** năm nhãn điều hướng tiếng Việt nguyên văn không vừa một hàng dưới 1280px. Vì vậy header chỉ hiện đủ nhãn từ `xl`. Từ 768px đến 1279px, header hiện CTA, Đăng nhập và nút Menu/X. Dưới 768px chỉ còn thương hiệu và Menu/X, đúng spec. Đây là điểm lệch so với câu “hamburger dưới `md:`” trong design system.
  4. **FAQ** dùng primitive `Disclosure` (`<details>`/`<summary>`), dùng chung với phần hướng dẫn ở trang thiết bị.
- **Điều kiện xem lại:** Khi có nhãn điều hướng ngắn hơn được duyệt, hoặc khi có API công khai cho dữ liệu xem thử.

### A11 — Accent đậm hơn cho CTA để tăng khả năng đọc

- **Trạng thái:** Proposed · 2026-09-15
- **Nội dung:** Yêu cầu mới nhất là làm UI thân thiện, dễ nhìn và tránh lỗi hiển thị. Chữ trắng trên `#6C63FF` chỉ đạt khoảng 4.32:1, chưa đạt AA cho chữ cỡ thường (ADR-009).
- **Mặc định đang dùng:** Giữ sắc tím thương hiệu cho icon, focus và điểm nhấn; các CTA primary dùng token `accent-strong` (`#5148D7`) tập trung ở `design-system/tokens.css`. Không thêm palette cảnh báo mới hay theme riêng cho sản phẩm.
- **Điều kiện giải quyết:** Xác nhận lại màu CTA qua kiểm tra trực quan với người dùng và đo tương phản toàn app.
- **Owner:** Chưa gán

### A09 — Biểu đồ SVG tự viết thay cho thư viện biểu đồ

- **Trạng thái:** Proposed · 2026-09-14
- **Nội dung:** ARCHITECTURE §4 ghi Recharts "chốt ở M2".
- **Mặc định đang dùng:** `features/ecopatch/TrendChart.tsx` vẽ SVG trực tiếp. Biểu đồ tách đoạn tại khoảng mất dữ liệu, có đơn vị, múi giờ, `title` và `desc`, và không thêm dependency.
- **Điều kiện giải quyết:** Xem lại khi cần tooltip, zoom hoặc dạng sóng ECG.
- **Owner:** Chưa gán

### A12 — Thêm three.js cho mô hình phần cứng 3D, không dùng React Three Fiber

- **Trạng thái:** Proposed · 2026-10-13
- **Nội dung:** Cảnh 3D vỏ và linh kiện CareLens cần một thư viện dựng 3D. Chọn `three` 0.186.1 (MIT) trực tiếp, đặt ở `frontend/src/lib/hardware3d/`, tải lười qua route nội bộ `/hardware-inspector` nên không vào bundle chính (chunk riêng 686 kB, gzip 176 kB).
- **Mặc định đang dùng:** Không thêm `@react-three/fiber` hay `drei` vì chỉ có một cảnh điều khiển bằng lệnh. Công cụ chuyển đổi CAD (`occt-import-js` LGPL-2.1, `@gltf-transform`) nằm ở `tools/3d-assets/`, không thuộc `frontend/package.json`.
- **Điều kiện giải quyết:** Chủ dự án duyệt thêm dependency. Landing sẽ import từ `lib/hardware3d` (không import từ `features/*`).
- **Owner:** Chưa gán

### A13 — Giấy phép mô hình CAD linh kiện cho trang công khai

- **Trạng thái:** Open · 2026-10-13
- **Nội dung:** Hai mô hình Adafruit (MIT) đã được đưa vào `frontend/public/`. Hai mô hình CC-BY-SA 4.0 (module ESP32-S3-WROOM-1 từ KiCad, TP4056 từ Boardoza) chưa được dùng: phát hành lại chúng cần ghi công và phát hành file GLB theo cùng điều kiện. STEP chính hãng Espressif không nêu điều khoản. Chi tiết: `docs/3d-assets-manifest.md`.
- **Mặc định đang dùng:** Chỉ dùng MIT trong runtime. ESP32-S3 CAM, TP4056, boost, GY-521, pin và công tắc dựng bằng code, gắn nhãn "Ước lượng, chưa xác minh".
- **Điều kiện giải quyết:** Chủ dự án quyết định có chấp nhận CC-BY-SA cho hai mô hình đó hay không, và cung cấp biến thể linh kiện thật.
- **Owner:** Chưa gán

### A14 — Vỏ STL chưa có lỗ cổng sạc, lỗ công tắc; pin tham chiếu không lắp vừa

- **Trạng thái:** Open · 2026-10-13
- **Nội dung:** Đo bằng ray cast trên mesh: ngoài cửa sổ camera 8 × 8 mm, ba thành còn lại kín. Pin 2000 mAh tham chiếu (37 × 60 × 7,5 mm) dài hơn khoang trong (39 × 28 × 55 mm). Trang `/hardware-inspector` hiển thị cảnh báo này thay vì giấu.
- **Mặc định đang dùng:** Bố trí linh kiện trong vỏ là minh hoạ, không tuyên bố lắp vừa.
- **Điều kiện giải quyết:** STL vỏ chỉnh sửa hoặc kích thước pin thật.
- **Owner:** Chưa gán

### A15 — Bố trí lắp ráp ước lượng và pin định dạng 103450

- **Trạng thái:** Proposed · 2026-10-13
- **Nội dung:** Vỏ không có lỗ USB-C, rãnh công tắc hay chi tiết giữ (đo bằng quét tia trên STL). Pin tham chiếu 2000 mAh không lắp vừa. Để có trạng thái lắp liền mạch cho hoạt ảnh, `assemblyConfig.ts` dùng pin giả định định dạng 103450 (10 × 34 × 50 mm), đặt mạch boost và MAX98357A nằm phẳng trong vòm nắp, cổng USB-C hướng xuống đáy, cần gạt công tắc hướng ra thành phải.
- **Mặc định đang dùng:** Bố trí trên, được `validate.ts` kiểm tra không xuyên vỏ và không va chạm. Mọi vị trí ngoài ống kính camera là ước lượng.
- **Điều kiện giải quyết:** Kích thước pin và các mô-đun thật; STL có lỗ USB-C và rãnh công tắc (khi đó validate.ts sẽ báo căn chỉnh qua `openingFound`).
- **Owner:** Chưa gán

### A16 — Cảnh cuộn 3D dùng `position: sticky` gốc, không dùng GSAP ScrollTrigger

- **Trạng thái:** Proposed · 2026-10-13
- **Nội dung:** Cảnh mở nắp và tách linh kiện cần đồng bộ camera, vật thể và nhãn theo vị trí cuộn. Dùng vùng cao theo `svh` cùng khung `sticky`, tiến trình = phần đã cuộn / quãng cuộn được, đưa qua bộ làm mượt có hội tụ. GSAP ScrollTrigger sẽ chèn pin-spacer vào DOM do React quản lý và thêm một phụ thuộc cùng điều khoản giấy phép, mà không cho thêm khả năng nào cần thiết.
- **Mặc định đang dùng:** Triển khai gốc (không GSAP). Chế độ nhẹ cho viewport dưới 768 px hoặc máy yếu; giảm chuyển động thành 3 ảnh tĩnh.
- **Điều kiện giải quyết:** Người dùng xác nhận; nếu sau này cần timeline phức tạp hơn (nhiều cảnh nối nhau) thì xét lại.
- **Owner:** Chưa gán

### A17 — Route `/hardware-story` là trang thử nội bộ, chưa gắn vào landing

- **Trạng thái:** Open · 2026-10-13
- **Nội dung:** Cảnh cuộn hoàn chỉnh nhưng nội dung đi kèm nêu rõ linh kiện là ước lượng và vỏ thiếu lỗ USB-C, rãnh công tắc. Gắn vào landing là quyết định sản phẩm: vị trí, copy, và việc có cho công chúng thấy mô hình chưa xác minh hay không.
- **Mặc định đang dùng:** Chỉ có route `/hardware-story` và `/hardware-inspector` (lazy). Landing không đổi.
- **Điều kiện giải quyết:** Người dùng chọn vị trí trong landing và duyệt copy; giấy phép mô hình (A13) vẫn phải giữ nguyên với trang công khai.
- **Owner:** Chưa gán

### A18 — Điều chỉnh bố trí để hoạt ảnh không va chạm (cập nhật A15)

- **Trạng thái:** Proposed · 2026-10-13
- **Nội dung:** Để lối đi của từng linh kiện khỏi khoang không chạm vỏ hay nhau, bố trí A15 được chỉnh: mạch boost rút xuống 35 mm (hở 0,5 mm với gờ nắp) và dịch theo Y; GY-521 dịch theo Y; mạch sạc quay mặt về −X với trạm đặt trên trục cổng USB-C; công tắc quay mặt về −X với trạm đặt trên trục rãnh; mạch sạc nâng đáy lên z 6,2 và pin lên z 4,4 để tránh góc bo đáy khoang. Mọi giá trị nằm trong `assemblyConfig.ts`.
- **Mặc định đang dùng:** Bố trí mới, được `validateTimeline` kiểm tra 0 xuyên vỏ và 0 va chạm. Mạch boost 35 mm là kích thước ước lượng, không phải số đo mô-đun thật.
- **Điều kiện giải quyết:** Kích thước mô-đun thật và STL vỏ có lỗ.
- **Owner:** Chưa gán

### A19 — Landing CareLens AI thay thế landing hai sản phẩm, dùng bảng màu riêng (ghi đè ADR-001 cho landing)

- **Trạng thái:** Proposed · 2026-10-13
- **Nội dung:** Theo yêu cầu mới nhất của người dùng (nguồn sự thật số 1), landing `/` được viết lại quanh thiết bị 3D CareLens AI, không còn phần EcoPatch, bản xem thử tổng quan hay FAQ cũ. Landing dùng bảng màu 8 giá trị người dùng chọn (token `--color-midnight … --color-ink` trong `tokens.css`), nền tối cho cảnh 3D và vài phần kỹ thuật, nền sáng cho phần giải thích, không dùng bề mặt Neumorphism. Màn hình ứng dụng (S01–S14) giữ nguyên Neumorphism. AGENTS.md §6 và `.claude/rules/frontend.md` vẫn ghi "Neumorphism là phong cách duy nhất cho landing" và cần được cập nhật nếu người dùng xác nhận.
- **Mặc định đang dùng:** Landing mới; nút Trao đổi về thử nghiệm đọc `VITE_PILOT_CONTACT_EMAIL` (không đặt thì nút tắt kèm lý do, không có biểu mẫu, không thu thập dữ liệu). Chữ signal/mint không dùng trên nền sáng (tương phản < 3:1, có test). Mọi năng lực gắn nhãn Đang hoạt động / Mô phỏng / Khái niệm.
- **Điều kiện giải quyết:** Người dùng xác nhận bỏ Neumorphism cho landing; cung cấp địa chỉ liên hệ thử nghiệm; quyết định số phận nội dung EcoPatch trên landing (hiện không có).
- **Owner:** Chưa gán

### A20 — Cảnh 3D là hero của landing (đóng A17)

- **Trạng thái:** Proposed · 2026-10-13
- **Nội dung:** `HardwareScrollStory` chuyển sang `features/common` và là phần đầu của landing: một khung cố định dưới header, chữ hero nằm trên khung và mờ đi khi cuộn. Camera đo vùng chữ chiếm (`setHeroInset`) rồi đặt thiết bị vào vùng trống còn lại. Cảnh tải lười (chunk 3D riêng, ~182 kB gzip) và hero chữ hiện ngay khi chunk chưa về. `/hardware-story` và `/hardware-inspector` vẫn còn. Màu vỏ in 3D đổi từ xám xanh sang xám ngà (#8a8b84) để nổi trên nền tối.
- **Mặc định đang dùng:** Như trên. Ghi công mô hình Adafruit (MIT) có link ở chân trang.
- **Điều kiện giải quyết:** Giữ A13: không đưa mô hình CC-BY-SA vào landing công khai khi chưa được duyệt.
- **Owner:** Chưa gán

### A21 — Hướng hình ảnh 3D: polymer màu gốm, phòng chụp trung tính, bố trí tách rời hai bên (cập nhật A18, A20)

- **Trạng thái:** Proposed · 2026-10-13
- **Nội dung:** Vỏ dùng màu gốm #D0D0C8 với lớp phủ mỏng; môi trường phản chiếu là phòng chụp sản phẩm tự dựng (không tải ảnh HDR); bóng tiếp xúc mềm trên sàn; linh kiện dựng bằng code có chân IC, đầu thiếc, nét in lụa không chữ. Trạm tách rời đổi sang một cột giữa (thân → pin → nắp) với linh kiện toả hai bên theo hướng chức năng; góc tổng quan chéo trước-trái. Linh kiện không được giới thiệu lùi về tông nền thay cho khung dây BoxHelper (công cụ kiểm tra vẫn dùng BoxHelper). Không thêm phụ thuộc.
- **Mặc định đang dùng:** Như trên; `validateTimeline` báo 0 va chạm. Màu phủ hàn đen của bo MAX98357A và màu cần gạt công tắc là giả định hiển thị.
- **Điều kiện giải quyết:** Người dùng duyệt hướng hình ảnh; ảnh hoặc số đo linh kiện thật để thay màu và chi tiết giả định.
- **Owner:** Chưa gán

### A22 — Bỏ phần liệt kê lại chín linh kiện sau cảnh 3D; rút gọn copy landing (cập nhật A19, A20)

- **Trạng thái:** Proposed · 2026-10-13
- **Nội dung:** Bỏ `ComponentsSection` (`#linh-kien`, mục "Linh kiện" trên thanh điều hướng) vì lặp lại thông tin đã có trong tám nhịp giới thiệu của cảnh 3D. Cảnh 3D, vỏ STL, tài sản và hoạt ảnh giữ nguyên. Người dùng giảm chuyển động hoặc không có WebGL vẫn có danh sách linh kiện do chính cảnh cung cấp (`staticList`, `#sau-mo-phong`). Copy các phần còn lại được rút gọn: bỏ ghi chú kỹ thuật khỏi trang công khai (tên file STL, mã linh kiện, mô hình AI, "theo PRD nháp"), bỏ ghi chú trạng thái lặp lại nhãn Đang hoạt động / Mô phỏng / Khái niệm, bỏ danh sách chủ đề ở CTA thử nghiệm. Liên kết tới công cụ kiểm tra 3D chỉ còn ở chân trang.
- **Mặc định đang dùng:** Như trên. Các nhãn trạng thái, câu "không quan sát được không có nghĩa là chưa uống thuốc" và lời nói rõ khẩu hiệu không phải cam kết kỹ thuật được giữ nguyên.
- **Điều kiện giải quyết:** Người dùng duyệt cấu trúc landing mới; phần kịch bản, hoạt ảnh bảo mật và báo cáo sẽ làm đợt sau.
- **Owner:** Chưa gán

### A23 — Tình huống 01 (ngã) dựng lại thành cảnh 3D chạy theo cuộn (cập nhật A19)

- **Trạng thái:** Proposed · 2026-10-13
- **Nội dung:** Hình SVG người que ba tư thế (đổi bằng mờ dần, tự phát theo đồng hồ) được thay bằng cảnh three.js riêng (`src/lib/careScene/`): người lớn tuổi cách điệu dựng bằng code (không mặt, không tài sản ngoài, không giấy phép bên thứ ba), phòng khách tối dưới một quầng sáng ấm, thiết bị CareLens trên ngực dùng đúng hai STL vỏ ở tỉ lệ thật. Mọi thứ (tư thế, camera, vòng ghi nhận teal, thông báo) là hàm thuần của tiến trình cuộn, nội suy Hermite đơn điệu; người luôn được đặt chạm sàn theo điểm thấp nhất. Giảm chuyển động: ba ảnh tĩnh chọn bằng nút; không WebGL: chỉ các bước dạng chữ. Cảnh phần cứng (`lib/hardware3d`, `HardwareScrollStory`) không đổi; cảnh mới chỉ dùng lại môi trường phòng chụp, bóng tiếp xúc, vật liệu vỏ và bộ đọc STL.
- **Mặc định đang dùng:** Như trên. Chưa nối sang phần bảo mật (làm đợt sau).
- **Điều kiện giải quyết:** Người dùng duyệt hướng hình ảnh và nhịp chuyển động.
- **Owner:** Chưa gán

### A24 — Tình huống 02: cảnh quan sát hoạt động và gói dữ liệu bàn giao (cập nhật A19, A23)

- **Trạng thái:** Proposed · 2026-10-13
- **Nội dung:** Phần "hỗ trợ dùng thuốc" có thêm cảnh 3D chạy theo cuộn (`src/lib/careScene/medicationScene.ts`) trước bản mô phỏng một ngày (giữ nguyên): một người cầm ly nước ở quầy, camera trên ngực quan sát, khung hình được đóng băng thành ảnh, co lại thành một gói dữ liệu và bay sang khay nhận của hub trong nhà. Bàn tay có ngón dựng bằng code (không tài sản ngoài); bàn tay với tới ly bằng động học ngược giải một lần lúc dựng. Gói dữ liệu (`dataPacket.ts`) là một vật thể bền vững và mọi trạng thái của nó là hàm thuần của tiến trình cuộn. Giao diện bàn giao cho phần sau là `PacketHandoff` (tư thế hiện tại và cuối, vị trí cuối trên màn hình, ảnh chụp, đặc tả, hàm lấy mẫu). Ba cảnh cuộn dùng chung `ScrollScene` (làm mượt cuộn, vòng vẽ theo yêu cầu, tạm dừng khi ra khỏi màn hình).
- **Giới hạn trung thực:** Đây là minh hoạ khái niệm. Repo chưa có mô hình hay thiết bị nào được kiểm chứng nhận ra thuốc, việc uống thuốc hay hành động nào khác; ảnh trong gói là cảnh tổng hợp dựng bằng code; hub chỉ là hình minh hoạ. Nội dung trang nói rõ "chưa có mô hình nào được kiểm chứng". Gói ảnh chỉ đi tới hub trong nhà, không tới ứng dụng (đúng ranh giới ở AGENTS.md §6).
- **Mặc định đang dùng:** Như trên. Chương bảo vệ nối tiếp được dựng ở A25.
- **Điều kiện giải quyết:** Người dùng duyệt hướng hình ảnh, nhịp chuyển động và giao diện bàn giao.
- **Owner:** Chưa gán

### A25 — Chương bảo vệ dữ liệu nối tiếp cảnh quan sát, cùng một gói; Riêng tư đứng ngay sau tình huống (cập nhật A19, A24)

- **Trạng thái:** Proposed · 2026-10-13
- **Nội dung:** Vùng cảnh 3D của phần "hỗ trợ dùng thuốc" kéo dài thêm một chương (`src/lib/careScene/securityTimeline.ts`, `shield.ts`, `hexLattice.ts`, `storySteps.ts`): chính gói dữ liệu đã tới khay rời khay, đi vào một tấm khiên phía trên hub, mặt ảnh thu nhỏ của nó lát thành 60 ô lục giác (màu lấy từ chính ảnh đó), các ô hội tụ thành một dải tám ô mang chuỗi 16 ký tự dạng mã băm, rồi đứng yên. Hai chương dùng chung một khung vẽ, một cảnh three, một hệ toạ độ thế giới và **một** đối tượng `DataPacket` (lớp lục giác và dải rút gọn nằm trong chính nhóm của gói). Bàn giao giữa hai chương là tường minh: chương bảo vệ bắt đầu từ `finalPacketPose` của chương quan sát và từ camera cuối của chương đó (theo từng bố cục), có kiểm thử. Tiến trình cả vùng là s; chương quan sát chiếm [0; 0,62], chương bảo vệ phần còn lại (`STORY_SPLIT`). Bản mô phỏng một ngày chuyển lên trước cảnh 3D, và phần Riêng tư chuyển lên ngay sau phần dùng thuốc (trước Quy trình); thứ tự điều hướng đổi theo.
- **Giới hạn trung thực:** Khiên và chuỗi dạng mã băm là hình minh hoạ. Repo không có bước băm, mã hoá hay ẩn danh hoá nào cho dữ liệu; chuỗi là dấu vân FNV-1a (không phải hàm băm mật mã) của chính ảnh minh hoạ, chỉ để gắn với đúng gói này. Trang ghi rõ điều đó và ghi rằng riêng việc băm không đủ để bảo đảm an toàn. Điều duy nhất đã áp dụng thật trong ứng dụng là ranh giới "ứng dụng chỉ nhận mô tả dạng văn bản" (kiểu `CareEvent` không có trường ảnh; `demoAdapter.test.ts` AC16 kiểm không có dữ liệu hình ảnh trong phản hồi); phía hub chưa được kiểm toán.
- **Mặc định đang dùng:** Như trên. Chương nối tiếp (báo cáo ngày) ở A26; điểm nối các chương nằm ở `storySteps.ts`.
- **Điều kiện giải quyết:** Người dùng duyệt hình ảnh khiên, nhịp chuyển động, câu chữ về bảo mật và thứ tự phần mới (Riêng tư trước Quy trình).
- **Owner:** Chưa gán

### A26 — Chương "Tổng quan hôm nay" nối tiếp cảnh bảo vệ, cùng một cảnh và cùng một gói (cập nhật A25)

- **Trạng thái:** Proposed · 2026-10-13
- **Nội dung:** Vùng cảnh 3D có chương thứ ba (`reportTimeline.ts`, `reportSurface.ts`, `DailyReport.tsx`, `storySteps.ts`). Dải tám ô rút gọn của chương bảo vệ đứng yên một lúc, rồi một bề mặt báo cáo bo góc mọc ra từ chính dải đó trong cảnh 3D (cùng gói, cùng hệ toạ độ), khiên và căn phòng chìm đi, camera tiến lại gần cho tới khi nhìn thẳng vào bề mặt. Bản báo cáo ngày là HTML thật (chữ sắc nét, co giãn theo màn hình, đọc được bằng trình đọc màn hình) đặt đúng lên khung của bề mặt: cảnh nhận khung HTML (px) từ trang và quy về hình chữ nhật trên mặt phẳng bề mặt, nên hai thứ trùng nhau (kiểm thử e2e: sai lệch dưới 1,5 px ở máy tính và điện thoại). Chữ chỉ hiện sau khi bề mặt đã mọc đủ và đặc; nền HTML cùng màu thế chỗ bề mặt nên không có đường nối. Bảng bước nhường chỗ cho báo cáo (mờ đi); chương này là điểm đến nên không có nút bước riêng. Độ dài vùng cuộn: quan sát ≈ 395, bảo vệ ≈ 245, tổng quan ≈ 170 svh. Báo cáo đứng yên ở phần cuối; chỉ khi khung thấp hơn nội dung (màn hình thấp), phần thân cuộn lên theo cuộn trang còn tiêu đề và nhãn mô phỏng đứng yên. Giảm chuyển động hoặc không có WebGL: báo cáo nằm trong luồng trang, hiện đủ ngay.
- **Nội dung báo cáo (dữ liệu mô phỏng, có nhãn):** bốn sự kiện theo thời gian (đi lại, cầm ly nước, giờ nhắc chưa có quan sát, thay đổi tư thế đã được tiếp nhận), tóm tắt cho người chăm sóc đếm từ chính danh sách, ghi chú "mô tả do AI tạo, chưa được con người xác nhận". Không có số đo, phần trăm, độ chính xác, điểm số hay kết luận y khoa; "đã tiếp nhận" không bị viết thành "đã xử lý"; "chưa quan sát được" không bị viết thành "chưa uống thuốc"; không có chữ "an toàn" hay "bình thường" (AGENTS.md §6). Kiểm thử đơn vị giữ các ràng buộc này.
- **Giới hạn trung thực:** Đây là minh hoạ khái niệm trên dữ liệu mẫu cố định, không đọc từ ứng dụng hay hub; không chứng minh hệ thống có thể tạo báo cáo như vậy. Ba sự kiện đầu mô tả những điều chưa có mô hình hay thiết bị nào được kiểm chứng (xem A24).
- **Điều kiện giải quyết:** Người dùng duyệt hình ảnh chuyển cảnh, nội dung báo cáo mẫu và nhịp cuộn.
- **Owner:** Chưa gán

### A27 — Landing định vị như sản phẩm sẵn sàng trao đổi: phần Đội ngũ, phần Liên hệ, bỏ nhãn mô phỏng/khái niệm (cập nhật A19, A25, A26; mâu thuẫn có chủ ý với AGENTS.md §6 "Demo")

- **Trạng thái:** Proposed · 2026-10-14
- **Nội dung:** Theo yêu cầu mới nhất của người dùng (nguồn số 1 trong AGENTS.md §2): (1) phần "Quy trình khái niệm" (năm chặng) được thay bằng "Đội ngũ của chúng tôi": năm chân dung dùng trực tiếp từ `members/` (không sao chép, không đổi tên; Vite phát tệp băm khi build), tên và vai trò đọc từ chính tên tệp; màn rộng xếp CTO, COO, **CEO ở giữa**, CMO, CSO; màn hẹp và tablet CEO một hàng riêng rồi lưới 2 × 2; không có tiểu sử hay thành tích. (2) "Giai đoạn trước thương mại / Cùng thử nghiệm" được thay bằng "Liên hệ với chúng tôi": ba nhóm (cá nhân và gia đình, doanh nghiệp, cơ sở chăm sóc y tế), nội dung trao đổi gợi ý theo nhóm, nút chính luôn dùng được. (3) Mọi chữ "mô phỏng", "khái niệm", "trước thương mại", "Đang hoạt động" trên landing được bỏ; nhãn năng lực đổi thành "Có trong ứng dụng", "Ví dụ", "Đang hoàn thiện"; báo cáo ngày ghi "Ví dụ báo cáo" và bỏ dòng "nguồn: hub trong nhà" vì có thể ngụ ý dữ liệu trực tiếp.
- **Liên hệ:** repo **chưa có** email, số điện thoại hay biểu mẫu chính thức nào (email duy nhất tìm thấy là tài khoản dịch vụ Firebase, không phải kênh liên hệ nên không dùng). Vì vậy không có địa chỉ nào được bịa: khi chưa đặt `VITE_CONTACT_EMAIL` (đổi tên từ `VITE_PILOT_CONTACT_EMAIL`), nút chính sao chép nội dung trao đổi và trang nói rõ không tự gửi; khi đặt biến, nút thành "Gửi email cho đội ngũ" mở thư soạn sẵn theo nhóm.
- **Mâu thuẫn ghi nhận:** AGENTS.md §6 yêu cầu dữ liệu tổng hợp luôn có nhãn "Dữ liệu mô phỏng" trên trang. Yêu cầu mới nhất bỏ nhãn đó khỏi **landing**; landing chỉ còn nhãn trung tính "Ví dụ báo cáo" / "Ví dụ" ở chỗ có dữ liệu mẫu, và chân trang vẫn nói rõ chưa kiểm chứng lâm sàng, không chẩn đoán. **Ứng dụng (S01–S14) không đổi** và vẫn mang nhãn `Dữ liệu mô phỏng`. Không câu nào mới khẳng định thiết bị, camera, cảm biến, cảnh báo hay backend đang chạy thật.
- **Điều kiện giải quyết:** Người dùng xác nhận (a) địa chỉ liên hệ chính thức để đặt `VITE_CONTACT_EMAIL`, (b) chấp nhận nhãn "Ví dụ" thay "Dữ liệu mô phỏng" trên landing, (c) thứ tự CTO, COO, CEO, CMO, CSO hai bên CEO.
- **Owner:** Chưa gán

### A28 — Nâng chất lượng hình ảnh hai cảnh tình huống: người lớn tuổi có mặt và tóc, áo len đan bám xương, vẽ sắc nét hơn (cập nhật A23, A24)

- **Trạng thái:** Proposed · 2026-10-14
- **Nội dung:** Theo yêu cầu mới nhất của người dùng: nhân vật trong hai cảnh tình huống (ngã; quan sát hoạt động) trước đây là hình nộm không mặt (đầu cầu gắn mũ tóc, ống tay hình trụ, hai nửa thân dẹt nối cứng). Nguyên nhân chất lượng kém là **hình học và vật liệu**, không phải bộ vẽ: không có khuôn mặt, tai, lông mày; da, áo, quần là màu phẳng không thớ; hai nửa thân dùng chung một mối nối cứng nên khi cúi thì vạt áo vén lên và để lộ hông; bóng đổ nhiễu hạt và 1024 px là quá thô cho vật nhỏ.
- **Lựa chọn:** **Tinh chỉnh, không thay mô hình.** Không có mô hình người lớn tuổi nào có sẵn trong dự án, và một mô hình ngoài có xương riêng sẽ phải ánh xạ lại toàn bộ 31 kênh tư thế, bàn tay có ngón và điểm nắm ly mà các dòng thời gian cùng kiểm thử đang dựa vào. Vì vậy nhân vật vẫn dựng bằng code (không tệp ngoài, không giấy phép bên thứ ba), giữ nguyên bộ xương, kênh tư thế, điểm dò chạm sàn và điểm gắn thiết bị. Mới: đầu có hộp sọ, gò má, hàm, cằm, tai, mắt có mi, mũi và môi nắn vào lưới đầu; lớp vẽ mặt (canvas, 1024 px) cho hốc mắt, nếp mi, lông mày, môi, rãnh mũi-má; tóc bạc ngắn có chân tóc lùi nhẹ ở thái dương; áo len đan có nẹp khuy, khuy, cổ áo và gấu bo gân, thớ len và thớ vải quần sinh bằng bản đồ pháp tuyến nhỏ (256 px); tay áo, ống quần có nếp ở khớp; giày da có đế riêng. Dấu hiệu tuổi chừng mực (tóc bạc, mi nặng, túi mắt và rãnh nông, má hơi trũng), không nhăn nặng, không biếm hoạ.
- **Thân áo:** một mặt liền từ gấu tới cổ, gắn vào ba xương (hông, thắt lưng, ngực) bằng trọng số theo độ cao (`SkinnedMesh`). Khi cúi hay nằm, áo uốn liền, không vén lên và không để lộ hông. Hai phương án trước đã thử và bỏ: ba mảnh cứng chồng nhau (còn dải tông khác nhau ở mối nối) và một mặt cứng gắn vào thắt lưng (vạt vén lên).
- **Bộ vẽ:** tỉ lệ điểm ảnh ở chế độ đầy đủ không dưới 1,5 và không quá 2 (màn 1080p tỉ lệ 1 trước đây vẽ đúng 1 lần nên cạnh người răng cưa); chế độ nhẹ không quá 1,5; khung nào quá 30 ms liên tiếp 14 lần thì tự hạ 0,25 (không dưới tỉ lệ của màn hình, không nâng lại). Bản đồ bóng 2048 px (chế độ nhẹ 1024), bán kính lọc 3 thay vì 4–5 để bớt nhiễu hạt; bóng vẫn chỉ vẽ lại khi tư thế đổi. Thêm ánh bù mềm không đổ bóng từ phía người xem để gương mặt đọc được mà không làm phẳng phòng. Không hậu kỳ, không làm nét giả.
- **Hạn chế trung thực:** đây vẫn là nhân vật cách điệu dựng bằng code, không phải ảnh hay quét người thật; mặt giống một người lớn tuổi nói chung, không giống ai. Hình ảnh chỉ minh hoạ, không ngụ ý nhận diện tư thế, nhận diện thuốc hay xử lý máy chủ đã được kiểm chứng. Chi phí: khoảng 117 nghìn tam giác cho người (trước đây khoảng 41 nghìn; chế độ nhẹ thấp hơn khoảng 15 nghìn), bộ nhớ GPU thêm (ước tính từ kích thước, chưa đo) khoảng 8 MB cho hoa văn cộng khoảng 24 MB cho hai bản đồ bóng lớn hơn; đo độ mượt khi cuộn cả hai cảnh ở 1440 × 900 trên GPU thật cho cùng kết quả trước và sau (p95 khoảng 16,8 ms). Gói `careScene` tăng khoảng 22 kB (8 kB nén).
- **Điều kiện giải quyết:** Người dùng duyệt hình ảnh nhân vật. Nếu cần chân dung giống thật hơn, phương án sau là một nhân vật có bản quyền rõ ràng đã gắn xương, kèm bước ánh xạ kênh tư thế và kiểm thử lại điểm nắm ly.
- **Owner:** Chưa gán

## Mẫu

### Mẫu ADR

```markdown
### ADR-xxx — <Tiêu đề>

- **Trạng thái:** Proposed · <YYYY-MM-DD> · Đề xuất bởi <ai>
- **Bối cảnh:** <vấn đề, ràng buộc, nguồn tài liệu>
- **Phương án:**
  1. <phương án>
  2. <phương án>
- **Lựa chọn:** <phương án>
- **Lý do:** <vì sao>
- **Hệ quả:** <đánh đổi, việc phải làm thêm>
- **Xem lại khi:** <điều kiện>
```

### Mẫu vấn đề hoặc giả định

```markdown
### Dxx / Axx — <Tiêu đề>

- **Trạng thái:** Open | Proposed · <YYYY-MM-DD>
- **Nội dung:** <vấn đề hoặc giả định>
- **Mặc định đang dùng:** <phương án tạm>
- **Điều kiện giải quyết:** <cần gì, từ ai>
- **Owner:** <người hoặc Chưa gán>
```
