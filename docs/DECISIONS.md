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
| D10 | Đường đi của frame ESP32 (qua cloud backend hay chỉ tới Module 1) | Proposed (hướng người dùng chọn 2026-10-19, chờ owner xác nhận) | 2026-10-19 |
| D11 | Quy tắc ứng viên hình ảnh và IMU thô cho nghi ngã (cần hiệu chỉnh trên thiết bị) | Open | 2026-10-19 |
| D12 | Truy cập Live Demo `/api/demo/stream` của frontend | Proposed (đăng nhập + vé stream, ADR-018; một tài khoản giám khảo dùng chung) | 2026-10-19 |
| D13 | Lệnh npm ở gốc (`-w @istartup/web`) không chạy vì glob workspace `frontend/*` | Proposed (đã sửa glob thành `frontend`, chờ owner duyệt) | 2026-10-19 |
| D14 | Thiết bị đeo trên ngực: mọi linh kiện trong một hộp, MPU6050 cố định trong hộp, camera nhìn từ ngực ra — hệ quả cho hiệu chỉnh ngã, riêng tư và an toàn | Open | 2026-10-19 |
| D15 | Hợp đồng lệnh không có trạng thái "thiết bị đã nhận" tách khỏi "đã tải và kiểm âm thanh"; hạn ACK 30 s và khởi động lại giữa lệnh | Proposed (ADR-022 đã triển khai cục bộ và kiểm trên thiết bị thật; chưa lên production) | 2026-10-19 |
| D16 | Cảm biến IMU trong hộp trả `WHO_AM_I = 0x70`, không phải 0x68 của MPU6050 | Open | 2026-10-19 |
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
| ADR-013 | Telegram-driven Demo Control (LIVESHOWCASE) | Accepted (ADR-014, ADR-015 đề xuất thay thế) | 2026-10-19 |
| ADR-014 | Gỡ tích hợp Telegram và service demo-bridge | Proposed | 2026-10-19 |
| ADR-015 | Backend care-monitoring: bỏ mô phỏng, ngừng backend EcoPatch và Firebase | Proposed (phần store bộ nhớ được ADR-016 đề xuất thay) | 2026-10-19 |
| ADR-016 | Cloud backend trên Cloudflare Workers + D1 + R2, agent cục bộ kéo việc | Proposed | 2026-10-19 |
| ADR-017 | Hợp nhất IMU thô và hình ảnh bằng luật minh bạch `fusion-rules.v2`, không ngưỡng mặc định, không cảnh báo đơn nguồn | Proposed (sửa lần 2 cùng ngày) | 2026-10-19 |
| ADR-018 | Đăng nhập web bằng thông tin do owner cấp và vé stream dùng một lần cho Live Demo | Proposed | 2026-10-19 |
| ADR-019 | Hợp đồng thiết bị v2: đồng hồ boot/uptime, lô IMU thô, xác nhận lệnh đủ vòng đời | Proposed | 2026-10-19 |
| ADR-020 | Danh tính admin: đăng nhập Google riêng (`mode=admin`), danh sách bootstrap bằng secret, phiên `clm_` tách khỏi người xem | Proposed | 2026-10-19 |
| ADR-021 | Công cụ build firmware: PlatformIO + pioarduino `55.03.38-1` (Arduino-ESP32 core 3.3.8), board `esp32-s3-devkitc1-n16r8` với cờ tương đương Arduino IDE | Proposed (đã nạp và chạy trên bo thật; bản Arduino IDE cũ dùng core 3.3.12) | 2026-10-19 |
| ADR-022 | Xác nhận lệnh `received` bổ sung, hạn tải âm thanh theo kích thước, đóng lệnh khi thiết bị khởi động lại (tương thích ngược) | Proposed (triển khai cục bộ + migration 0006, kiểm trên thiết bị thật; chưa lên production) | 2026-10-19 |
| ADR-023 | Firmware tích hợp trong repo (`firmware/carelens-esp32s3/`): bí mật nạp vào NVS qua UART, log UART0, không web server trên thiết bị, CA thử nghiệm cục bộ cho E2E | Proposed (đã kiểm trên bo thật với backend cục bộ) | 2026-10-19 |
| ADR-024 | Âm lượng loa đặt từ dashboard, gửi qua phản hồi heartbeat, "đã áp dụng" chỉ theo báo cáo của thiết bị (migration 0007) | Proposed (theo yêu cầu người dùng 2026-10-19; đã kiểm trên thiết bị thật) | 2026-10-19 |
| ADR-025 | Lời nhắn thoại là MP3 từ đầu đến cuối: tải lên MP3, lưu và giao nguyên tệp, ESP32 tự giải mã (dr_mp3); WAV chỉ còn để phát bản ghi cũ; thiết bị báo codec qua heartbeat | Proposed (theo yêu cầu người dùng 2026-10-20; đã kiểm trên thiết bị thật với backend cục bộ; chưa lên production) | 2026-10-20 |
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
| A30 | Nhịp chụp, hạn mức và thời gian sống của media theo giới hạn free plan | Proposed | 2026-10-19 |
| A31 | Định dạng lời nhắn thoại gia đình: WAV PCM mono 16-bit | Proposed | 2026-10-19 |
| A32 | Ưu tiên GPU giữa Vision và LLM trên RTX 2060 6 GB | Proposed | 2026-10-19 |
| A33 | Lưu IMU thô 72 giờ và các tham số chất lượng dữ liệu của hợp nhất | Proposed | 2026-10-19 |
| A34 | Live Demo trong frontend: dữ liệu máy chủ là nguồn sự thật, từ chối ghi chỉ-cục-bộ khi có phiên máy chủ | Proposed | 2026-10-19 |
| A35 | Một hệ thiết kế (bảng màu landing) cho landing, đăng nhập và ứng dụng; một tài khoản Live Demo (thay A29) | Proposed | 2026-10-19 |
| A36 | Đăng nhập web bằng tên đăng nhập, mật khẩu do owner chọn lưu bằng PBKDF2 (tài khoản trình diễn DAYONE) | Proposed | 2026-10-19 |
| A37 | Đăng nhập bằng Google (OIDC code + PKCE) chỉ cho danh tính do owner cho phép; sửa lỗi "không kết nối" khi chạy cục bộ | Proposed | 2026-10-19 |
| A38 | Bản deploy chỉ đăng nhập bằng Google; mọi tài khoản Google đã xác minh được xem (chỉ xem) đúng một hồ sơ trình diễn | Proposed | 2026-10-19 |
| A39 | Khu quản trị `/admin` (giao diện Phase B-UI): phiên admin tách khỏi người xem, chỉ đọc, không có dữ liệu giả | Proposed | 2026-10-19 |
| A40 | Bảng điều khiển admin có API thật: thiết bị, báo cáo ngày, gửi âm thanh, nhắc lịch, nhật ký; header bảo mật Vercel; migration 0005 | Proposed | 2026-10-19 |
| A41 | XCLK camera 20 MHz thay vì 10 MHz của baseline để burst đạt nhịp 125 ± 40 ms | Proposed (đo trên bo thật; nhiệt chưa đo) | 2026-10-19 |

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
| D10 | Kiến trúc người dùng nêu ngày 2026-10-19 cho ESP32-S3 CAM gửi dữ liệu qua Internet tới cloud backend, trong khi AGENTS.md §6 cũ cấm frame CareLens đi vào API nghiệp vụ, DB, log (và D01: CareLens không cloud) | **Proposed theo yêu cầu người dùng 2026-10-19:** frame JPEG đi qua API upload riêng (`/api/device/v1/captures`) vào bucket R2 riêng tư, chỉ để Local AI Agent tải về suy luận; xóa ngay khi suy luận xong, khi job thất bại hẳn, hoặc tối đa `MEDIA_MAX_AGE_SECONDS` (mặc định 900 s). Frame không bao giờ vào D1, log, export, analytics hay API caregiver. AGENTS.md §6 đã sửa theo đó | Owner xác nhận Accepted. Chốt thời hạn lưu (D08), có cần mã hóa phía thiết bị, và kiểm thử trên ESP32 thật | Chưa gán |
| D11 | Gói mô hình trả `NOT_CALIBRATED`, không có ngưỡng ngã đã hiệu chỉnh trên thiết bị. Ngưỡng demo −0,3296 thuộc điểm video của demo, không áp cho API. Chưa có ngưỡng gia tốc/con quay nào được kiểm chứng cho cách gắn MPU6050 và người đeo | `fusion-rules.v2` mặc định: `vision_candidate_rule: null`, `imu_candidate_rule: null`, không có công tắc cảnh báo đơn nguồn (đã bỏ). Kích hoạt firmware chỉ mở quyết định `needs_review` / `not_enough_data` / `processing_failed`, không tạo cảnh báo. Backend lưu điểm thô và IMU thô (72 h) để hiệu chỉnh | Owner cung cấp **cả hai** quy tắc đã hiệu chỉnh trên dữ liệu ESP32 thật (24 khung và cách gộp 40 khung; ngưỡng IMU theo đúng vị trí gắn) kèm `approved_by`, `evidence_ref`; kiểm lại `alignment_tolerance_ms`, `imu_min_coverage_ratio`, `imu_max_gap_ms` trên bản ghi thật | Chưa gán |
| D12 | `EventSource` không gửi được header nên `/api/demo/stream` cũ không kiểm được quyền theo hồ sơ; giám khảo cần xem Live Demo sau khi đăng nhập | **Proposed (ADR-018):** biểu mẫu đăng nhập hiện có gọi `POST /api/app/v1/session` bằng thông tin owner cấp; frontend lấy vé `cls_` dùng một lần (60 s) cho mỗi lần mở stream; giám khảo nhận grant `viewer` (chỉ đọc). Không vé → không có dữ liệu, trừ danh sách IP chỉ dùng cho phát triển cục bộ | Owner xác nhận cách cấp tài khoản cho giám khảo. **Mặc định (owner nêu 2026-10-19):** một tài khoản giám khảo dùng chung, grant `viewer` chỉ trên hồ sơ trình diễn, mật khẩu do máy chủ sinh, chia sẻ ngoài kênh; nhiều giám khảo đăng nhập cùng lúc (mỗi lần đăng nhập là một phiên); không đăng ký, không khôi phục mật khẩu; sau buổi trình diễn thu hồi grant và đổi mật khẩu (`docs/DEPLOYMENT_RUNBOOK.md` §8.1). Câu "Bản demo chưa có máy chủ xác thực…" trong `LoginPage.tsx` đã sửa 2026-10-19 theo yêu cầu owner (chỉ đổi hai câu chữ, giữ bố cục) | Chưa gán |
| D13 | `package.json` gốc khai báo `"workspaces": ["frontend/*", "backend/*"]` (có từ commit `e9d9b67`), nên `npm run build|test|lint|typecheck` ở gốc báo "No workspaces found: --workspace=@istartup/web". `package-lock.json` gốc còn từ thời `apps/web` (45 phiên bản khác, thiếu `three`) | **Proposed, đã sửa 2026-10-19 theo yêu cầu owner:** chỉ đổi `"frontend/*"` thành `"frontend"` (giữ các thay đổi chưa commit khác của owner trong `package.json`); `package-lock.json` gốc dựng lại từ `frontend/package-lock.json` rồi chuẩn hóa bằng `npm install --package-lock-only` — 0 khác biệt `version`/`resolved`/`integrity` so với bản frontend đã kiểm, không nâng cấp gói. Lệnh gốc chạy được; `cd frontend && npm ci` trong bản sao sạch cài theo workspace gốc (đường của Vercel) và build thành công. Từ đây `npm install` (gốc hoặc trong `frontend/`) dùng lockfile gốc; `frontend/package-lock.json` chỉ còn cho `frontend/Dockerfile` cũ (đang hỏng vì trỏ `apps/web`) | Owner duyệt thay đổi; quyết định giữ hay bỏ `frontend/package-lock.json`, `frontend/Dockerfile`, `cloudbuild-web.yaml` | Chưa gán |
| D14 | Owner xác nhận (phiên Claude Code 2026-10-19; câu trả lời đầu "không đeo trên người" đã được owner sửa trong cùng phiên): mọi linh kiện nằm trong **một hộp, hộp đeo trên ngực** người được chăm sóc; MPU6050 cố định trong hộp. Hệ quả: (1) IMU đo chuyển động thân trên qua hộp và dây đeo; tín hiệu phụ thuộc độ chặt dây, vị trí trên ngực và hướng lắp cảm biến trong hộp (trục nào thẳng đứng khi đứng: chưa biết). IMU một mình vẫn không xác nhận được ngã. (2) Camera nhìn từ ngực ra: thấy môi trường, tay, đồ vật trước mặt và người khác, **không thấy tư thế của chính người đeo** (liên quan D02). Gói mô hình ngã R3D-18 chưa được kiểm chứng trên video góc nhìn người đeo (khi ngã, cảnh lật và nhòe). (3) Hai nguồn trên cùng thiết bị, cùng đồng hồ → căn thời gian thuận lợi, nhưng chưa có quy tắc nào được hiệu chỉnh cho vị trí đeo ngực. (4) Camera đeo trên người quay cả người xung quanh (riêng tư người thứ ba). (5) Thiết bị áp sát người: nhiệt của OV5640/ESP32, pin LiPo và âm lượng loa cần đo an toàn | Giữ chính sách mặc định (không quy tắc, không cảnh báo nghi ngã, D11). Không tự đặt ngưỡng IMU hay hình ảnh. Dải đo ±2 g mặc định của sketch có thể bão hòa khi va chạm (backend đã gắn cờ chạm dải đo); dải đo của firmware chọn theo bản ghi thử, không đoán. Chỉ người thử đã đồng ý, không bệnh nhân thật (ESP32_READINESS §6). Chi tiết: `docs/HARDWARE.md` §5 | Owner: (a) xác nhận hướng lắp MPU6050 trong hộp và cách đeo (dây, vị trí trên ngực); (b) cung cấp bản ghi thật có nhãn (ngã giả lập an toàn, sinh hoạt thường) để hiệu chỉnh cả hai quy tắc cho vị trí đeo ngực (D11); (c) quyết định cách xử lý người xung quanh trong khung hình (D10, D08); (d) đo nhiệt bề mặt hộp khi chụp liên tục trước khi đeo lâu | Chưa gán |
| D15 | Người dùng (2026-10-19) muốn phân biệt: backend nhận lệnh · thiết bị nhận lệnh · `started` (đã tải, đã kiểm SHA-256, loa thật sự bắt đầu phát) · `completed` (phát xong, có ACK hợp lệ), **giữ nguyên ngữ nghĩa hiện có, không định nghĩa lại `accepted`**. Hợp đồng hiện tại (`docs/DEVICE_API.md` §8.2): "backend nhận" = `queued`; `delivered` do **máy chủ** ghi khi trả lệnh trong phản hồi 200, không phải xác nhận của thiết bị; `accepted` của thiết bị = đã lưu lệnh **và** (với âm thanh) đã tải và kiểm SHA-256. Không có báo cáo "đã nhận, đang tải". Hạn ACK 30 s đếm từ `delivered` tới `accepted` nên gồm cả thời gian tải (rủi ro R-1 của `docs/AUDIT_INVENTORY_2026-10-19.md`); thiết bị khởi động lại khi lệnh ở `accepted`/`started` không được máy chủ phát hiện (R-2). `device_commands.status` có CHECK cố định: thêm giá trị trạng thái mới cần dựng lại bảng | Cục bộ (2026-10-19): ADR-022 đã triển khai (migration 0006) và kiểm trên thiết bị thật; production vẫn chạy hành vi cũ tới khi owner duyệt triển khai. Firmware gửi `received` khi nhận lệnh (bỏ qua nếu máy chủ cũ trả 422), `accepted` chỉ sau khi tải đủ và kiểm SHA-256, gửi `started` chỉ khi loa thật sự bắt đầu phát, `completed` chỉ khi phát hết, kiểm hạn bằng đồng hồ đơn điệu trước khi phát | Owner duyệt ADR-022 (hoặc một phần); đo thời gian tải WAV thật qua HTTPS trên ESP32 để chốt tốc độ tối thiểu dùng cho hạn tải | Chưa gán |
| D16 | Cảm biến IMU trong hộp trả `WHO_AM_I = 0x70` (đo bằng firmware tích hợp 2026-10-19); MPU6050 thật trả 0x68, 0x70 thường gặp ở MPU6500 hoặc chip tương thích bán dưới tên MPU6050. Các thanh ghi dùng (PWR_MGMT_1, SMPLRT_DIV, CONFIG, GYRO_CONFIG, ACCEL_CONFIG, dữ liệu 0x3B–0x48) đọc lại đúng; đứng yên \|a\| ≈ 1,00 g ở ±8 g; 50 Hz, 0 lỗi đọc | Dùng như MPU6050 (cùng bản đồ thanh ghi cho các phần dùng); contract vẫn ghi `sensor: "mpu6050"`. Quy tắc IMU (D11) phải hiệu chỉnh trên chính cảm biến này | Owner xác định linh kiện thật (ký hiệu trên chip/nhà bán); quyết định có thêm `sensor: "mpu6500"` vào contract | Chưa gán |

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

### ADR-014 — Gỡ tích hợp Telegram và service demo-bridge

- **Trạng thái:** Proposed · 2026-10-19 · Đề xuất bởi coding agent theo yêu cầu dọn repo của người dùng (phiên Claude Code 2026-10-19). Đã thực hiện trong working tree, **chưa được người dùng duyệt**. Bản trước ghi nhầm Accepted; người dùng xác nhận chưa duyệt nên sửa về Proposed.
- **Đề xuất thay thế:** ADR-013 (chuyển Superseded khi mục này được Accepted). Rút phần "bridge (Telegram ↔ WebSocket hub)" khỏi ADR-011 (ADR-011 vẫn Proposed cho phần web). Phần `demo-control` còn lại (lệnh demo, cầu Firebase) được ADR-015 đề xuất gỡ tiếp.
- **Bối cảnh:** Có hai đường điều khiển demo qua Telegram: bot long-polling trong `backend/demo-control` (ADR-013) và service Node `backend/services/demo-bridge` (grammY ↔ WebSocket, deploy bằng `cloudbuild-bridge.yaml`). Kiểm tra ngày 2026-10-19: frontend chỉ dùng SSE `GET /api/demo/stream` của `demo-control` (`frontend/src/data/demo/demoAdapter.ts`), không gọi `/api/demo/telegram/webhook`, không đọc `window.__BRIDGE_URL__`. `demo-bridge` không khớp glob workspace `backend/*` nên `npm run bridge` không chạy được. Event Telegram mang `source_mode="telegram"`, trái AGENTS.md §6 (dữ liệu tổng hợp phải là `simulated`).
- **Phương án:**
  1. Gỡ bot, route webhook, `demo-bridge`, cấu hình và tài liệu Telegram; giữ `POST /api/demo/command` và SSE làm đường điều khiển demo duy nhất.
  2. Giữ Telegram nhưng tắt mặc định.
- **Lựa chọn:** Phương án 1.
- **Lý do:** Người dùng yêu cầu gỡ. Hợp đồng SSE/state/command mà frontend dùng không đổi. Event tạo qua lệnh HTTP mặc định `source_mode="simulated"`.
- **Hệ quả:**
  - Xóa `telegram_bot.py`, `commands.py`, test tương ứng, `check_env.py`, `test_telegram.py`, route `/api/demo/telegram/webhook`, `python-telegram-bot` trong `requirements.txt`, khối Telegram trong `.env.example`, chốt chặn `TELEGRAM_BOT_TOKEN` trong `start_backend.py`.
  - `state.py`: `source_record_id` đổi tiền tố `telegram-` → `demo-`; note luôn có `author_name="Demo Bot"`; bỏ hàm `add_note()` không còn nơi gọi.
  - Xóa `backend/services/demo-bridge/`, `cloudbuild-bridge.yaml`, `deploy/grant.sh`, `docs/DEMO_INDEX.md`, `docs/DEMO_CARELENS.md|.yaml`, `docs/DEMO_ECOPATCH.md|.yaml`; rút gọn `deploy/README.md` còn phần web.
  - Frontend **không sửa** (ràng buộc của yêu cầu): `TelegramBadge`, `SourceMode "telegram"`, `frontend/scripts/devBridge.ts`, `inject-bridge-url.ts` và biến `VITE_BRIDGE_PUBLIC_URL` (cả trong `cloudbuild-web.yaml`) vẫn còn nhưng không còn nguồn phát. Cần một thay đổi frontend riêng nếu muốn dọn.
  - `package-lock.json` gốc còn mục `demo-bridge`/`grammy` cũ, chưa sinh lại.
  - `backend/demo-control/.env` cục bộ chưa sửa (bị chặn đọc); người dùng tự xóa các khóa `TELEGRAM_*`, `ALLOWED_CHAT_IDS`, `ALLOWED_USER_IDS`.
- **Xem lại khi:** Cần lại kênh điều khiển demo từ xa, hoặc dọn phần Telegram còn lại ở frontend.

### ADR-015 — Backend care-monitoring: bỏ mô phỏng, ngừng backend EcoPatch và Firebase

- **Trạng thái:** Proposed · 2026-10-19 · Đề xuất bởi coding agent theo yêu cầu của người dùng (phiên Claude Code 2026-10-19). Đã thực hiện trong working tree, chờ người dùng duyệt.
- **Đề xuất thay thế:** phần backend còn lại của ADR-013 (lệnh demo, trạng thái giả). Đổi quy tắc "dữ liệu tổng hợp luôn `simulated`" ở AGENTS.md §6 thành quy tắc provenance.
- **Bối cảnh:** Người dùng xác định CareLens AI là hệ thống giám sát thật, không phải demo. Luồng đích: ESP32-S3 CAM → cloud backend → Module 1 (gói nhận diện cục bộ `carelens_models_v1_20261018`: kiểm tra ngã R3D-18, nhận diện uống nước/thuốc YOLO11n) → backend lưu sự kiện và phát cảnh báo ngay. Độc lập với đó, scheduler gọi Module 2 (LLM cục bộ `qwen3:4b-instruct-2507-q4_K_M` trên Ollama) tóm tắt sự kiện theo ngày; tóm tắt không bao giờ làm chậm cảnh báo. Khảo sát 2026-10-19: `backend/demo-control` chỉ gồm trạng thái giả (bật/tắt thiết bị kèm mô tả AI và nhịp tim tổng hợp, sự kiện ngã/uống thuốc theo lệnh, reset) và cầu Firebase cho telemetry EcoPatch. Frontend được giữ nguyên chỉ đọc `GET /api/demo/stream`, bỏ qua mọi khung không phải JSON `{"type":"state_update","state":…}` (khung đầu cũ là `repr` Python nên luôn bị bỏ). Không có DB, phiên đăng nhập, nhận frame ESP32 hay giao việc cho Module 1.
- **Phương án:**
  1. Đổi tên thành `backend/care-monitoring`, bỏ toàn bộ trạng thái giả, nhận kết quả Module 1 qua ingest có xác thực, phát cảnh báo trong lúc ingest, giữ `/api/demo/*` làm adapter tương thích chỉ trả dữ liệu thật.
  2. Giữ `demo-control` và thêm đường thật song song.
  3. Dựng ngay `backend/api` đầy đủ (PostgreSQL, phiên, quyền) theo ADR-002.
- **Lựa chọn:** Phương án 1. Phương án 3 vẫn là đích M1; store trong bộ nhớ của care-monitoring là chỗ cắm PostgreSQL.
- **Lý do:** Phương án 2 giữ dữ liệu giả trên đường production. Phương án 3 vượt phạm vi yêu cầu (chuẩn bị backend, không dựng hạ tầng mới).
- **Hệ quả:**
  - `POST /api/app/v1/ingest/recognition-results` (bearer token theo thiết bị). Thiết bị và hồ sơ lấy từ registry credential lưu SHA-256, không lấy từ payload. Chỉ lưu số và nhãn, không lưu ảnh, timing hay hộp phát hiện.
  - Cảnh báo chỉ khi kết quả mô hình mang quyết định đã hiệu chỉnh (`alert=true`, có `threshold`, `status` khác `NOT_CALIBRATED`), rule `model-decision-passthrough.v1`. Backend không tự đặt ngưỡng. Gói hiện tại chưa hiệu chỉnh nên **hiện không tạo cảnh báo nào**. Mọi kết luận giữ `verification: "unverified"`.
  - Nhận diện uống thuốc là quan sát AI chưa xác nhận, không phải xác nhận uống thuốc (`.claude/rules/data-contracts.md`), không tạo cảnh báo.
  - `/api/demo/command` trả `410`. `/api/demo/stream` gửi JSON `state_update` từ khung đầu. Event legacy mang `source_mode: "device"` (giá trị gần nhất trong union frontend cho nguồn thiết bị đã xác thực).
  - **Mâu thuẫn ghi nhận:** frontend mở stream không có credential, nên không thể kiểm quyền theo hồ sơ như AGENTS.md §6. Mặc định adapter không lộ dữ liệu; bật `CARE_MONITORING_LEGACY_STREAM_RECIPIENT_ID` thì chỉ client loopback thấy một hồ sơ. Đây là biện pháp tạm cho máy đơn, không phải phân quyền; cần phiên (ADR-006) và grant trước khi dùng thật.
  - Store không bền. Chưa có: nhận frame ESP32 (D10), giao việc cho Module 1, scheduler và worker Module 2 cùng nơi lưu báo cáo ngày, trạng thái kết nối thiết bị, phiên và quyền.
  - Gỡ EcoPatch và Firebase khỏi backend: cầu Firebase, `firebase-admin`, biến `FIREBASE_*` và `GOOGLE_APPLICATION_CREDENTIALS` trong `.env.example`, file service account (chuyển ra ngoài repo). Frontend vẫn có trang EcoPatch, Telegram badge (ngoài phạm vi).
- **Xem lại khi:** Có PostgreSQL và phiên đăng nhập (M1), khi Module 1 được hiệu chỉnh trên thiết bị, hoặc khi D10 được chốt.
- **Cập nhật 2026-10-19 (phiên sau):** service Python bộ nhớ đã được thay bằng Cloudflare Worker cùng tên (ADR-016, Proposed); logic phân loại, credential băm SHA-256 và adapter `/api/demo/*` được chuyển sang. Code Python cũ không còn trong repo (chưa từng được commit).

### ADR-016 — Cloud backend trên Cloudflare Workers + D1 + R2, agent cục bộ kéo việc

- **Trạng thái:** Proposed · 2026-10-19 · Đề xuất bởi coding agent theo hướng công nghệ người dùng chọn trong yêu cầu phiên Claude Code 2026-10-19. Chờ owner xác nhận Accepted.
- **Đề xuất thay thế (khi Accepted):** phần API, DB, worker và xác thực của ADR-002 (FastAPI + PostgreSQL), ADR-005 (outbox trên PostgreSQL), ADR-006 (session cookie) cho phạm vi CareLens; store bộ nhớ của ADR-015. ADR-002 vẫn Accepted cho tới khi owner quyết định; mâu thuẫn được ghi ở đây.
- **Bối cảnh:** Người dùng yêu cầu backend dùng thật, sẵn sàng triển khai: Cloudflare Workers, D1, R2, Cron Triggers, Durable Objects khi cần realtime; mô hình Vision và Qwen chạy trên PC Windows (RTX 2060 6 GB) qua một agent chỉ gọi ra ngoài. Không có tài khoản Cloudflare trong phiên; không deploy.
- **Phương án:**
  1. Worker TypeScript + D1 + R2 + một lớp Durable Object (SQLite) cho realtime; agent Python thư viện chuẩn trên PC.
  2. Python Workers (beta) chạy lại FastAPI.
  3. Giữ FastAPI + PostgreSQL (ADR-002) và host ở nơi khác.
- **Lựa chọn:** Phương án 1. Mã ở `backend/care-monitoring/worker` (ngoài glob workspace `backend/*` để không đổi `package-lock.json` gốc); agent ở `integrations/carelens/local-agent`.
- **Lý do:** Khớp hướng người dùng chọn. Bindings D1/R2/DO, Cron và công cụ test (`@cloudflare/vitest-plugin`, Miniflare) ổn định cho TypeScript. Store bộ nhớ của FastAPI không chạy được trên Workers và không bền.
- **Hệ quả:**
  - D1 thay PostgreSQL: không có `SKIP LOCKED`; claim dùng một câu `UPDATE … WHERE job_id = (SELECT … LIMIT 1) RETURNING` (D1 ghi tuần tự); giao dịch dùng `db.batch()` kèm bảng `tx_guard` để hủy batch khi điều kiện lease hoặc trạng thái sai.
  - Xác thực bằng bearer token ngẫu nhiên lưu SHA-256 (thiết bị `cld_`, agent `cla_`, người chăm sóc `clc_`, admin qua secret `ADMIN_TOKEN_SHA256`). Đăng nhập web bằng thông tin do owner cấp và vé stream: ADR-018. Chưa có cookie, CSRF (ADR-006 chưa được thay trên web).
  - Realtime: Durable Object `RealtimeHub` dùng WebSocket hibernation; Worker giữ SSE cho client, giới hạn đời stream `SSE_MAX_LIFETIME_SECONDS`; không có vòng polling.
  - Free plan (tài liệu Cloudflare đọc ngày 2026-10-19): Workers 100.000 request/ngày, 10 ms CPU/lần gọi, 50 subrequest; D1 5 triệu dòng đọc, 100.000 dòng ghi/ngày, 50 truy vấn/lần gọi, 500 MB/DB; R2 10 GB-tháng, 1 triệu thao tác loại A, 10 triệu loại B/tháng; DO chỉ loại SQLite, 100.000 request và 13.000 GB-s/ngày; 5 Cron Trigger/tài khoản. Bật R2 theo nguồn bên thứ ba cần thêm phương thức thanh toán (chưa xác minh trên tài khoản thật). Xem A30.
  - Lệnh chạy và test mới ở AGENTS.md §4.
- **Xem lại khi:** Owner duyệt hoặc bác hướng Cloudflare; số thiết bị hoặc nhịp chụp vượt free plan; cần đăng nhập người dùng trên web.

### ADR-017 — Hợp nhất IMU thô và hình ảnh bằng luật minh bạch `fusion-rules.v2`, không ngưỡng mặc định, không cảnh báo đơn nguồn

- **Trạng thái:** Proposed · 2026-10-19 (sửa lần 2 cùng ngày; bản `fusion-rules.v1` chưa từng deploy) · Đề xuất bởi coding agent theo yêu cầu người dùng: "quyết định ngã cuối cùng phải dùng bằng chứng tương quan thời gian từ cả hình ảnh và gia tốc/con quay; kích hoạt IMU không tự thành cảnh báo; điểm hình ảnh không được vượt qua chính sách hợp nhất".
- **Bối cảnh:** Bản v1 coi báo cáo kích hoạt của firmware là bằng chứng IMU và có hai công tắc cảnh báo đơn nguồn. Gói Vision trả logit chưa hiệu chỉnh.
- **Lựa chọn:** Backend tự đánh giá mẫu gia tốc/con quay **thô** trên cửa sổ của burst, trên đồng hồ đơn điệu của cùng một `boot_id` (`src/fusion.ts` `evaluateImu`, `decide`; `src/decisions.ts` điều phối):
  - Bằng chứng IMU: `missing`, `insufficient_coverage` (tỉ lệ mẫu < `imu_min_coverage_ratio` hoặc khoảng hở > `imu_max_gap_ms`), `sensor_fault` (cả sáu trục đứng yên tuyệt đối), `rule_not_configured`, `below_rule`, `candidate` (kèm `aligned` khi khớp trong burst ± `alignment_tolerance_ms`).
  - Bằng chứng hình ảnh: `candidate`, `below_rule`, `uncalibrated`, `missing`, `failed`.
  - Kết quả: `suspected_fall` (chỉ khi cả hai là `candidate` và khớp thời gian → cảnh báo tạm thời + còi), `needs_review` (lệch thời gian, mâu thuẫn, thiếu quy tắc), `not_enough_data` (thiếu hình ảnh hoặc IMU thô), `no_fall_detected` (cả hai dưới quy tắc đã duyệt; không bao giờ hiện là "an toàn"), `processing_failed` (job hình ảnh thất bại, upload dở, cảm biến đứng yên). Chỉ người chăm sóc đặt `verified`/`dismissed`.
  - Một quyết định chỉ mở khi có kích hoạt firmware, ứng viên hình ảnh hoặc ứng viên IMU; burst thường không có tín hiệu chỉ là sự kiện bằng chứng.
  - Chờ bằng chứng: kích hoạt chờ burst được liên kết (`imu_decision_grace_seconds`); quyết định chờ IMU thô phủ burst (`imu_wait_seconds`) và được đánh giá lại khi lô IMU tới hoặc theo cron.
  - Không bao giờ hợp nhất bằng chứng khác `boot_id`; đồng hồ tường của thiết bị không dùng để sắp thứ tự.
- **Lý do:** Đúng yêu cầu người dùng, minh bạch, kiểm thử được (ma trận 13 ca trong `test/unit.test.ts`, 23 test qua API trong `test/fusion-alerts.test.ts`), không tự đặt ngưỡng y khoa.
- **Hệ quả:** Với cấu hình mặc định hệ thống **không tạo cảnh báo nghi ngã nào**. Muốn có cảnh báo, owner phải duyệt cả quy tắc hình ảnh và quy tắc IMU (D11). Các tham số thời gian/độ phủ là mặc định kỹ thuật chưa kiểm chứng trên thiết bị (A33). `FUSION_POLICY_JSON` kiểu v1 (có `alert_on_*`) bị từ chối (503 `misconfigured`).
- **Xem lại khi:** Có dữ liệu hiệu chỉnh trên thiết bị (D11) hoặc biết vị trí gắn MPU6050 (người đeo hay đặt cố định).

### ADR-018 — Đăng nhập web bằng thông tin do owner cấp và vé stream dùng một lần cho Live Demo

- **Trạng thái:** Proposed · 2026-10-19 · Đề xuất bởi coding agent theo yêu cầu "giữ quy trình của giám khảo, vào Live Demo sau khi đăng nhập, không làm API được bảo vệ thành công khai".
- **Bối cảnh:** Frontend mở `EventSource(${VITE_API_BASE_URL}/api/demo/stream)`; EventSource không gửi được `Authorization`. Danh sách IP (D12 cũ) không dùng được cho giám khảo ở mạng bất kỳ.
- **Phương án:**
  1. Stream công khai cho một hồ sơ trình diễn (bị loại: lộ dữ liệu sức khỏe).
  2. Cookie phiên `SameSite=None` khác miền Vercel/workers.dev (bị loại: cookie bên thứ ba bị chặn ở Safari/Firefox).
  3. Đăng nhập bằng biểu mẫu hiện có → token phiên trong bộ nhớ; mỗi lần mở stream đổi lấy vé `cls_` dùng một lần, 60 s, đặt trong query.
- **Lựa chọn:** Phương án 3 (`src/session.ts`, `src/legacy.ts`; frontend `demoAdapter.ts`).
- **Lý do:** Không đổi giao diện; quyền vẫn theo grant ở máy chủ; vé trong URL hết hạn sau một lần dùng, không mang quyền ghi.
- **Hệ quả:** Mật khẩu là chuỗi 100 bit do máy chủ sinh (SHA-256 đủ vì không phải mật khẩu người tự đặt; phù hợp giới hạn 10 ms CPU của Workers Free). Giám khảo nhận grant `viewer`; người thân nhận `caregiver` (được xử lý cảnh báo từ web). Đổi mật khẩu thu hồi mọi phiên. Mỗi lần đăng nhập là một phiên riêng, nên một tài khoản giám khảo dùng chung được nhiều trình duyệt cùng lúc; đăng xuất chỉ kết thúc phiên đó. Mọi lần thử đăng nhập (đúng hoặc sai) tính vào ngân sách 20 lần/60 s theo IP **trước** khi kiểm mật khẩu (429 `too_many_attempts`). Mỗi lần mở stream ghi một vé vào D1, nên frontend lùi dần khi stream hỏng liên tiếp (không mở được, hoặc đóng trong 30 s: chờ 5, 10, 20, 40, rồi 60 s) và báo "Mất luồng cập nhật" trong lúc chờ. Tải lại trang thì phải đăng nhập lại (không lưu token vào web storage, AGENTS.md §6). Chưa có tự đăng ký, quên mật khẩu, 2FA, cookie/CSRF (ADR-006 vẫn là đích dài hạn).
- **Xem lại khi:** Có `backend/api` với phiên cookie (ADR-006) hoặc cần tài khoản tự phục vụ.

### ADR-019 — Hợp đồng thiết bị v2: đồng hồ boot/uptime, lô IMU thô, xác nhận lệnh đủ vòng đời

- **Trạng thái:** Proposed · 2026-10-19 · Đề xuất bởi coding agent. **Thay đổi không tương thích** với `capture-session.v1`, `imu-event.v1`, `device-heartbeat.v1`, `command-status.v1`; các bản v1 chưa từng có firmware dùng (chỉ có harness kiểm thử, đã chuyển sang v2 trong cùng thay đổi) nên được gỡ thay vì giữ song song.
- **Bối cảnh:** Yêu cầu: định danh phiên khởi động, số thứ tự lô IMU tăng dần, mốc thời gian từng mẫu, đơn vị rõ ràng, phát hiện trùng/thiếu/lỗi thời, liên kết IMU với burst theo thời gian, không giả định đồng hồ thiết bị đồng bộ; xác nhận `accepted/started/completed/expired/failed`.
- **Lựa chọn:** Mọi yêu cầu thiết bị có khối `clock{boot_id, uptime_ms, wall_clock_synced, wall_time}`; khung ảnh và mẫu IMU mang `uptime_ms` (64-bit, mili giây từ lúc khởi động). Máy chủ ước lượng mốc 0 của mỗi boot = min(thời điểm nhận − uptime). Lô IMU `imu-batch.v1` (≤ 1000 mẫu, đơn vị cố định g, °/s, ms). Báo cáo kích hoạt `imu-event.v2` không mang mẫu. Lệnh: `accepted`, `started`, `completed`, `failed`/`rejected` (mã lý do bắt buộc), `cancelled` (chỉ sau yêu cầu hủy). Chi tiết: `docs/DEVICE_API.md`.
- **Lý do:** Căn chỉnh trong một boot chính xác tuyệt đối, chịu được đồng hồ tường sai hoặc chưa đồng bộ; lệnh và âm thanh có ngữ nghĩa xác nhận trung thực.
- **Hệ quả:** Firmware phải dùng `esp_timer_get_time()`, sinh `boot_id` ngẫu nhiên mỗi lần khởi động, gửi IMU thô theo lô bao phủ mỗi burst. Chưa xác minh trên ESP32 thật.
- **Xem lại khi:** Bắt đầu viết firmware (M5).

### ADR-020 — Danh tính admin: Google `mode=admin`, bootstrap bằng secret, phiên `clm_` riêng

- **Trạng thái:** Proposed · 2026-10-19 · Phase B của lộ trình admin/credential/firmware. Chưa deploy, chưa áp migration `0004` lên production.
- **Bối cảnh:** Admin API chỉ có một bearer tĩnh (`ADMIN_TOKEN_SHA256`), không có danh tính (audit ghi `actor_id = "admin"`), và owner không muốn token admin thủ công. Cấp thiết bị/agent bị chặn vì vậy.
- **Lựa chọn:**
  - Dùng lại luồng OIDC của người xem (PKCE, state, nonce, JWKS) với `?mode=admin`. Mục đích luồng nằm trong `oauth_states.purpose` và callback đọc từ DB; request không chọn được kết quả.
  - Ai được là admin do máy chủ quyết: email Google đã xác minh nằm trong secret `ADMIN_BOOTSTRAP_EMAILS` (vai `owner`, tạo hàng `admins` ở lần đăng nhập đầu) hoặc hàng `admins` đang hoạt động (vai `admin`, dành cho Phase sau). `sub` gắn ở lần đầu. Danh sách bootstrap rỗng hoặc sai định dạng → đăng nhập admin tắt (đóng cửa), lỗi không lặp lại giá trị.
  - Phiên `clm_` (bảng `admin_sessions`, chỉ lưu SHA-256, TTL mặc định 120 phút, chỉ trong bộ nhớ trình duyệt) tách khỏi `caregiver_tokens`/`clc_`; mã đổi phiên `cax_` ở bảng riêng `admin_login_exchanges`. Mỗi request đọc lại phiên và hàng admin; `owner` chỉ hợp lệ khi email còn trong secret, nên xoay secret là thu hồi.
  - Token tĩnh giữ lại cho môi trường phát triển/CLI khi được đặt; production để trống.
- **Hệ quả:** Lộ tài khoản Google của owner là lộ admin (cần xác minh 2 bước cho tài khoản đó); Google gián đoạn thì không đăng nhập admin được (đường dự phòng: owner tạm đặt `ADMIN_TOKEN_SHA256`). Email so sánh bằng `trim` + chữ thường, không gộp dấu chấm/`+tag` của Gmail. Hàng `admins` bị tắt (`status = 'disabled'`) thắng cả danh sách bootstrap; muốn bật lại owner phải sửa D1 hoặc xóa hàng. Chưa có giao diện, thêm/gỡ admin, hay xác thực lại (`auth_at` đã lưu để dùng sau).
- **Đã kiểm chứng (2026-10-19, cục bộ):** 35 test mới `test/admin-auth.test.ts` + toàn bộ 245 test Worker pass với Google giả (khóa RSA thật). **Chưa kiểm:** đăng nhập admin với Google thật, migration trên D1 production, hành vi `ALTER TABLE … CHECK` trên D1 thật.
- **Điều kiện giải quyết:** Owner chấp nhận thiết kế, đặt secret `ADMIN_BOOTSTRAP_EMAILS` bằng `wrangler secret put`, áp migration `0004`, và một lần đăng nhập admin thật thành công.
- **Owner:** Chưa gán

### ADR-021 — Công cụ build firmware: PlatformIO + pioarduino (Arduino-ESP32 core 3.3.8)

- **Trạng thái:** Proposed · 2026-10-19 · Hướng công cụ do người dùng chọn trong phiên Claude Code 2026-10-19 ("PlatformIO trong VS Code, Arduino framework, core 3.x, nếu sketch và cấu hình board đã kiểm build được"); phiên bản, board và cờ do coding agent đề xuất và kiểm.
- **Bối cảnh:** Sketch baseline (`docs/HARDWARE.md` §3) viết cho Arduino core 3.x (`ESP_I2S.h`). PlatformIO Core 6.1.19 trên máy có nền chính thức chỉ kèm core 2.0.17. Arduino15 có core 3.3.8 nhưng không có `arduino-cli`.
- **Lựa chọn:** nền pioarduino `55.03.38-1` (ghim URL; SHA-256 zip khớp digest GitHub), kéo Arduino-ESP32 3.3.8 và ESP-IDF libs 5.5.4 từ bản phát hành chính thức; board `esp32-s3-devkitc1-n16r8` cộng phân vùng `app3M_fat9M_16MB.csv` và cờ `ARDUINO_USB_MODE=1`, `ARDUINO_USB_CDC_ON_BOOT=1`, MSC/DFU = 0, `CORE_DEBUG_LEVEL=0`. Thư mục core PlatformIO trên D: (`PLATFORMIO_CORE_DIR`), không đổi cấu hình hệ thống.
- **Đã kiểm chứng (2026-10-19, PC dev, chưa nạp):** bản sao `.cpp` của sketch (chỉ thêm `#include <Arduino.h>` và thay chuỗi SSID/mật khẩu bằng placeholder) build đạt; macro biên dịch, biến thể SDK `qio_opi`, ELF bootloader `qio_80m`, header ảnh (DIO/80m/16MB), bảng phân vùng và giới hạn kích thước khớp cấu hình Arduino IDE ghi trong sketch. Bằng chứng và lệnh: `docs/FIRMWARE_TOOLCHAIN.md` §3.
- **Hệ quả:** (1) Mã `.ino` có chuỗi raw không qua được bộ tiền xử lý của PlatformIO: firmware mới viết thẳng `.cpp`. (2) Không build từ Git Bash/MSYS (trình cài công cụ từ chối). (3) Tương đương lúc **chạy** trên bo chưa kiểm: cần owner nạp bản baseline build bằng PlatformIO và so với bản nạp bằng Arduino IDE (`docs/FIRMWARE_TOOLCHAIN.md` §8). (4) Phụ thuộc bản nền cộng đồng; nâng phiên bản phải kiểm lại bảng ở §3.
- **Điều kiện giải quyết:** owner xác nhận hướng này, xác nhận phiên bản core đã dùng cho bản nạp chạy được (nếu khác 3.3.8 thì đối chiếu), và một lần chạy baseline build bằng PlatformIO trên bo thật.
- **Cập nhật 2026-10-19 (đã kiểm chứng trên bo thật):** baseline build bằng PlatformIO đã nạp qua COM6 và chạy (Wi-Fi, camera, IMU, phát WAV; `BASELINE_FLASH_TEST_REPORT.md`); firmware tích hợp (ADR-023) build và chạy bằng cùng cấu hình. Ảnh app cũ trong bản sao lưu flash chứa đường dẫn `__FILE__` `Arduino15\packages\esp32\hardware\esp32\3.3.12\…` và `tools\esp32s3-libs\3.3.12`, header ảnh ghi ESP-IDF v5.5.5: bản nạp bằng Arduino IDE trước đây dùng **core 3.3.12**; Arduino15 trên PC này chỉ có 3.3.8. Chưa thấy khác biệt hành vi nào do chênh core (vấn đề `/beep` tái hiện y hệt trên firmware mới, nguyên nhân là âm lượng/loa, xem `docs/HARDWARE.md`).
- **Owner:** Chưa gán

### ADR-022 — Xác nhận `received` bổ sung, hạn tải âm thanh theo kích thước, đóng lệnh khi thiết bị khởi động lại

- **Trạng thái:** Proposed · 2026-10-19 · Đề xuất bởi coding agent cho D15. **Chưa triển khai.** Người dùng yêu cầu đề xuất trước khi đổi hành vi API.
- **Bối cảnh (đọc từ mã, `backend/care-monitoring/worker/src/commands.ts`):**

  | Khái niệm người dùng nêu | Trạng thái hiện có | Ai ghi | Hạn hiện tại |
  | --- | --- | --- | --- |
  | Backend nhận lệnh | `queued` (201 `created:true`) | máy chủ | `expires_at` = tạo + `expires_in_seconds` (30–3600 s) |
  | Lệnh được trao cho thiết bị | `delivered` (khi `GET /commands/next` trả 200) | máy chủ | chưa `accepted` sau `ACK_TIMEOUT_SECONDS` = 30 s → giao lại cùng `command_id`, tối đa 3 lượt → `failed no_acknowledgement` |
  | Thiết bị nhận lệnh | **không có** | — | — |
  | Đã tải và kiểm SHA-256 | `accepted` (báo cáo của thiết bị) | thiết bị | phải trước `expires_at` |
  | Loa bắt đầu phát | `started` | thiết bị | phải trước `expires_at`; quá 600 s không kết thúc → `failed no_completion_report` |
  | Phát xong | `completed` (`played_confirmed_by_device = true`) | thiết bị | — |

  Giới hạn âm thanh thật: WAV PCM 16-bit mono 16 kHz, 0,5–60 s → tối đa 1 920 044 byte (trần máy chủ 2 200 000). Cron dọn hạn chạy mỗi phút; `GET /commands/next` và báo cáo trạng thái cũng dọn hạn cho đúng thiết bị đó. Thời gian tải trên ESP32 **chưa đo**.
- **Phương án:**
  1. Giữ nguyên, chỉ tăng `ACK_TIMEOUT_SECONDS` cho mọi lệnh: đơn giản nhưng làm chậm phát hiện phản hồi bị mất (giao lại muộn) cho cả còi khẩn.
  2. Thêm trạng thái `received` vào `device_commands.status`: cần dựng lại bảng (CHECK của SQLite không sửa tại chỗ) và làm client cũ gặp trạng thái lạ.
  3. **(Đề xuất)** Thêm *báo cáo* `received` nhưng không thêm *trạng thái*: cột `status` vẫn `delivered`, máy chủ ghi `received_at`, `device_boot_id` và một dòng `received` trong `device_command_events` (cột `status` của bảng này không có CHECK).
- **Nội dung đề xuất (phương án 3):**
  1. `command-status.v2` nhận thêm giá trị `received` (cộng thêm vào enum; thiết bị không gửi vẫn hợp lệ). Chỉ từ `delivered`. Gửi lại khi đã `received`/`accepted`/`started`/`completed` → 200 `duplicate:true`, không lùi trạng thái.
  2. Khi đã có `received_at`: máy chủ **không giao lại** lệnh đó. Hạn tải = `received_at + 30 s + ceil(byte_size / AUDIO_DOWNLOAD_MIN_BYTES_PER_SECOND)`, không vượt `expires_at`; mặc định đề xuất 16 000 B/s (WAV tối đa ≈ 150 s, gấp đôi thời lượng phát), chốt lại sau khi đo trên ESP32. Quá hạn mà chưa `accepted`/`started` → `failed` `download_timeout` (không giao lại, tránh phát trùng hoặc muộn).
  3. Thiết bị không gửi `received`: với lệnh có âm thanh, hạn giao lại tính bằng cùng công thức từ `delivered_at` thay cho 30 s cố định; còi và nhắc lịch không có âm thanh giữ 30 s.
  4. `started` nghĩa là **loa đã thật sự bắt đầu phát** sau khi tải đủ và kiểm SHA-256 (đúng định nghĩa người dùng). Thiết bị phải kiểm hạn bằng đồng hồ đơn điệu (`uptime lúc nhận + expires_in_ms`) **trước** khi phát, gửi `started` ngay khi mẫu I2S đầu tiên được ghi, và dừng ngay nếu nhận 409 `stop_playback`. Câu "Không bắt đầu phát khi `accepted`/`started` bị từ chối" của `DEVICE_API.md` §8.2 mục 5 được sửa cho khớp. Tùy chọn 4a: máy chủ chỉ nhận `started` của lệnh có âm thanh sau `accepted`.
  5. Khởi động lại: máy chủ lưu `boot_id` của báo cáo `received`/`accepted`/`started`. Khi heartbeat hoặc báo cáo trạng thái mang `boot_id` khác: lệnh chưa `started` và chưa hết hạn → trở lại `queued` (`status_reason = device_rebooted`; chưa phát nên không thể phát trùng); lệnh `started` → `failed` `device_rebooted` (không bao giờ tự thành `completed`). Firmware gửi heartbeat ngay sau khi khởi động, trước `commands/next`.
  6. Migration `0006` chỉ cộng thêm: `device_commands.received_at TEXT`, `device_commands.device_boot_id TEXT`. Không dựng lại bảng; Worker cũ bỏ qua hai cột.
  7. Giao diện: hiện "Thiết bị đã nhận lệnh, đang tải âm thanh" khi có `received_at`; nhãn cho `download_timeout`, `device_rebooted`. Không đổi giá trị `status` nên frontend cũ vẫn hiển thị đúng như hiện nay.
- **Ma trận tương thích:**

  | Thành phần | Ảnh hưởng |
  | --- | --- |
  | Thiết bị theo hợp đồng hiện tại (không gửi `received`) | Vẫn chạy; lệnh có âm thanh chờ lâu hơn trước khi bị giao lại |
  | Thiết bị gửi `received` | Phát hiện phản hồi mất sau 30 s, có thời gian tải riêng |
  | Frontend production hiện tại | Không đổi giá trị trạng thái; trường mới bị bỏ qua; mã lý do mới hiện nguyên mã cho tới khi thêm nhãn |
  | Agent cục bộ | Không ảnh hưởng |
  | DB | `0006` cộng thêm, áp sau `0004`/`0005`, trước Worker mới |
  | Schema `contracts/` | `command-status.v2` thêm một giá trị enum; thêm fixture hợp lệ `command-status.v2.received.json` |
- **Test cần thêm khi triển khai:** `received` trùng và sai thứ tự; không giao lại sau `received`; tải quá hạn → `download_timeout`; thiết bị không gửi `received` với WAV lớn không bị giao lại trước hạn theo kích thước; khởi động lại khi `accepted` → `queued` rồi giao lại; khởi động lại khi `started` → `failed device_rebooted`; lệnh hết hạn không bao giờ `started`; hai `GET /commands/next` đồng thời không giao hai lệnh; hành vi cũ của còi/nhắc lịch không đổi.
- **Điều kiện giải quyết:** Owner duyệt toàn bộ hoặc từng mục (1–7); sau đó Prompt 2 triển khai cùng test. Đo thời gian tải WAV trên ESP32 thật (Prompt 4/7) để chốt tốc độ tối thiểu.
- **Triển khai cục bộ 2026-10-19** (người dùng yêu cầu "tự quyết định kỹ thuật từ mã hiện có, giữ cổng phê duyệt production"; trạng thái vẫn Proposed tới khi owner duyệt):
  - Mục 1–7 và 4a đã có trong `worker/src/commands.ts`, `index.ts` (heartbeat), `contracts.ts` (`received`, `device_rebooted`, `download_timeout`), migration `0006_command_receipts.sql` (3 cột cộng thêm: `received_at`, `device_boot_id`, `ack_deadline_at`). Biến `AUDIO_DOWNLOAD_MIN_BYTES_PER_SECOND` (mặc định 16 000).
  - Khác đề xuất ở hai chỗ: (a) hạn giao lại tính sẵn lúc giao vào cột `ack_deadline_at` (một câu SQL, không cần batch thứ hai); (b) báo cáo trạng thái từ boot mới **loại trừ chính lệnh đang được báo** khỏi việc đóng do khởi động lại, để `completed` mà thiết bị lưu qua lần khởi động lại vẫn được ghi nhận.
  - Hai test cũ (còi khẩn, hủy lệnh) báo `started` từ `delivered` cho lời nhắn có âm thanh; đã thêm bước `accepted` theo mục 4a. Test giao lại dùng hạn 30 s + 3 s cho WAV 32 044 byte.
  - Kiểm chứng: `test/command-receipts.test.ts` (17 test) + toàn bộ Worker 309/309; thiết bị thật đi đủ `delivered → received → accepted → started → completed`, và 9 kịch bản lỗi (`docs/E2E_TEST_RESULTS.md`). Tải WAV 63 724 byte qua HTTPS trên ESP32 mất khoảng 100 ms trên LAN (một Range 206); tốc độ tối thiểu 16 000 B/s chưa được đo qua internet.
- **Owner:** Chưa gán

### ADR-023 — Firmware tích hợp: bí mật trong NVS qua UART, log UART0, không web server, CA thử nghiệm cục bộ

- **Trạng thái:** Proposed · 2026-10-19 · coding agent, theo nhiệm vụ "firmware tích hợp backend và kiểm trên thiết bị thật" của người dùng.
- **Bối cảnh:** Sketch baseline viết cứng SSID/mật khẩu, mở camera trên LAN không xác thực, có AP dự phòng mật khẩu yếu, tràn bộ đệm khi phát WAV mono (FW-1) và in log ra cổng USB gốc không cắm vào PC.
- **Lựa chọn:**
  - Dự án `firmware/carelens-esp32s3/` trong repo, cấu hình build và chân lấy nguyên từ baseline (ADR-021, `docs/HARDWARE.md`).
  - Không bí mật nào trong mã hay `.bin`: Wi-Fi, URL API, `device_id`, token `cld_`, CA tùy chọn được nạp vào NVS qua console UART0 (`tools/provision.py`); console không in lại giá trị, chỉ in độ dài. NVS không mã hóa (cần flash encryption, chưa bật).
  - Log chẩn đoán ra `Serial0` (UART0 → CH343 → COM6), giữ `ARDUINO_USB_CDC_ON_BOOT=1` như baseline.
  - Không web server, không AP dự phòng, chỉ HTTPS ra ngoài. Chứng chỉ luôn được kiểm (CA đã nạp hoặc bộ chứng chỉ ESP-IDF), SNTP trước request đầu.
  - Thử E2E cục bộ: CA thử nghiệm riêng, chứng chỉ máy chủ theo IP LAN, proxy TLS chỉ trên IP LAN và chỉ chuyển tiếp `/api/device/v1/*` (`tools/local_tls_proxy.py`). Đây là xác minh thật bằng CA riêng, không phải tắt kiểm chứng; CA không bao giờ dùng ngoài mạng nhà.
  - Lời chào "Xin chào." nhúng trong flash (Piper, giọng `vi_VN-vais1000-medium`, CC BY 4.0), một lần mỗi lần khởi động, bỏ qua sau brownout hoặc 2 lần khởi động ngắn liên tiếp.
- **Hệ quả:** Muốn đổi Wi-Fi hay token phải cắm cáp UART. Ai cầm được bo đọc được NVS. Trên production, thiết bị dùng bộ chứng chỉ ESP-IDF (`tlscheck` tới `workers.dev` đã đạt 200 với xác minh đầy đủ).
- **Đã kiểm chứng (2026-10-19, bo thật + backend cục bộ):** host test 94/94, selftest trên bo 8/8, lời chào nghe rõ (người dùng xác nhận), heartbeat/IMU/burst/lệnh âm thanh, 9 kịch bản lỗi (`docs/E2E_TEST_RESULTS.md`).
- **Điều kiện giải quyết:** owner chấp nhận cách nạp bí mật và vị trí dự án; quyết định có bật flash encryption + NVS encryption không.
- **Owner:** Chưa gán

### ADR-024 — Âm lượng loa từ dashboard, gửi qua phản hồi heartbeat

- **Trạng thái:** Proposed · 2026-10-19 · theo yêu cầu người dùng ("loa đang bị bé quá, bổ sung nút chỉnh âm lượng trong admin dashboard").
- **Lựa chọn:** `PUT /api/admin/v1/devices/{id}/speaker-volume` `{volume, confirm: true}` (0,05–0,70, bước 0,05; audit `device.speaker_volume`; tính vào hạn mức 20 thay đổi/phút). Lưu ở `devices.speaker_volume` (migration `0007`, cộng thêm, có CHECK). Phản hồi heartbeat mang `config.speaker_volume`; thiết bị áp dụng, lưu NVS, và báo `status.speaker_volume` ở heartbeat kế (chỉ khi máy chủ có gửi `config`, nên firmware mới vẫn chạy với Worker cũ). Dashboard hiện riêng "mức đặt trên máy chủ" và "thiết bị báo đang dùng"; chờ thiết bị báo mới coi là đã áp dụng.
- **Vì sao không dùng lệnh:** `device_commands.command_type` có CHECK cố định; thêm loại lệnh phải dựng lại bảng. Âm lượng là thiết lập, không phải hành động có vòng đời phát.
- **Giới hạn 0,70:** giới hạn phần mềm thận trọng cho loa 8 Ω 1 W trên MAX98357A (GAIN không nối, 9 dB), **không phải số đo công suất**. Ở 0,70 người dùng nghe "rõ, đủ to"; ở 0,25 và 0,45 "vẫn nhỏ".
- **Đã kiểm chứng (2026-10-19):** `test/speaker-volume.test.ts` (5 test), test UI (3 test), Playwright với thiết bị thật: đặt 45% rồi 70% trên dashboard, thiết bị tự báo đúng mức trong vòng một heartbeat.
- **Owner:** Chưa gán

### ADR-025 — Lời nhắn thoại MP3 từ đầu đến cuối, giải mã trên ESP32

- **Trạng thái:** Proposed · 2026-10-20 · theo yêu cầu người dùng ("FULL MP3 AUDIO PIPELINE MIGRATION": tải MP3, không chuyển sang WAV ở frontend hay backend, ESP32 tự giải mã MP3). Thay hợp đồng WAV-only trước đó (`media.ts AUDIO_CONTRACT`, A31).
- **Trước đây:** chỉ nhận WAV PCM mono 16-bit 16 kHz (`DEVICE_AUDIO_SAMPLE_RATES`), vì firmware chỉ đẩy PCM thẳng ra I2S. Tệp MP3 hay stereo bị từ chối ở trình duyệt ("Cần âm thanh mono") và người dùng không có cách gửi tệp thường gặp.
- **Lựa chọn:**
  - **Tải lên:** chỉ `audio/mpeg` (MPEG-1/2/2.5 Layer III; 8; 11,025; 12; 16; 22,05; 24; 32; 44,1 hoặc 48 kHz; mono hoặc stereo; CBR hoặc VBR; 0,5–60 s; ≤ 2 000 000 byte). WAV bị từ chối `415 mp3_required`. Máy chủ duyệt **mọi tiêu đề khung** (`inspectMp3`): một tần số, một kiểu kênh, khung đủ, chỉ cho phép thẻ ID3v2 ở đầu, APEv2/ID3v1 ở cuối và đệm 0; không dựa vào tên hay kiểu tệp. Trình duyệt làm cùng phép duyệt để báo lỗi sớm; tệp không được giải mã hay đổi gì.
  - **Lưu và giao:** tệp lưu nguyên vẹn (R2 `…/vN.mp3`, `content_type audio/mpeg`, `bits_per_sample = 0` vì MP3 không có độ sâu mẫu trước khi giải mã; **không cần migration**, các cột hiện có đủ). Lệnh mang `content_type: audio/mpeg`, `codec: mp3`, `sample_rate_hz`, `channels`, `duration_ms`, `byte_size`, `sha256`; route tải trả đúng các byte đã tải lên, có Range.
  - **Firmware (`carelens-fw-0.2.0`):** tải cả tệp vào PSRAM (≤ 2 MB), kiểm SHA-256, chạy lại cùng phép duyệt khung và so với siêu dữ liệu của máy chủ, rồi **giải mã từng khung** bằng dr_mp3 v0.7.4 (mackron/dr_libs, public domain/MIT-0, dựa trên minimp3; vendored nguyên vẹn, `src/third_party/dr_mp3`) qua API "push" cấp thấp. Trạng thái giải mã (~23 KB, gồm vùng scratch) và một khung PCM (4,6 KB) nằm trong PSRAM, cấp một lần; RAM nội giữ cho Wi-Fi/TLS (`CONFIG_MBEDTLS_INTERNAL_MEM_ALLOC`). I2S đổi theo tần số của tệp; mỗi khung chia khối 256 frame qua `pcmToStereo` có sẵn; cờ dừng được xét giữa các khối; thời gian phát tối đa = độ dài tệp + 5 s.
  - **Tương thích:** phản hồi heartbeat có `config.report_audio_codecs: true`; firmware 0.2.0 trả `status.audio_codecs: ["pcm_s16le","mp3"]` (trường tùy chọn, chỉ gửi khi máy chủ hỏi, nên firmware mới vẫn chạy với Worker cũ). Máy chủ **từ chối tạo** lệnh hoặc nhắc lịch (admin) có MP3 cho thiết bị chưa báo `mp3` (`422 audio_not_playable`). Nhắc lịch do người chăm sóc tạo không kiểm trước; nếu cron gửi MP3 tới firmware cũ, firmware báo `rejected audio_format_unsupported` (đúng sự thật, không phát sai).
  - **Bản ghi WAV cũ:** giữ nguyên `content_type audio/wav` và được giao với `codec: pcm_s16le`; firmware 0.2.0 vẫn phát WAV. Không bao giờ dán nhãn MP3 cho WAV. Lệnh WAV đang chờ vẫn phát được; lệnh đã bắt đầu trước khi khởi động lại vẫn thành `failed device_rebooted` (ADR-022).
  - **Lời chào khởi động:** chuyển sang MP3 (`assets/greeting_vi_xin_chao_16k.mp3`, LAME 48 kbps, 4 104 byte thay vì 18 924 byte WAV; WAV giữ làm bản gốc), phát qua cùng bộ giải mã. Âm khác (bíp, còi, chuông nhắc, quét tần) là sóng tổng hợp, không phải tệp.
- **Vì sao không dùng thư viện khác:** libhelix (RPSL, có điều kiện công bố sửa đổi), `esp_audio_codec` của Espressif (phải chuyển sang build hybrid ESP-IDF, đổi toolchain đã kiểm), libmad (GPL). dr_mp3 được bảo trì (sửa lỗi gần nhất 2026-08-31), chỉ C chuẩn, cho phép đặt toàn bộ trạng thái vào bộ nhớ do mình cấp.
- **Đã kiểm chứng (2026-10-20, backend cục bộ, thiết bị thật, `docs/E2E_TEST_RESULTS.md` §9):** host test firmware 662/662 (giải mã đủ 9 tệp LAME mọi họ tần số, tần số tone đúng, 300 bản hỏng không làm vượt biên); trên bo: selftest 10/10, 8 định dạng phát `completed` với số frame ghi ra I2S đúng bằng số khung × mẫu/khung, CPU giải mã 1,6–11,5 % thời gian thực; đoạn 59 s 1,42 MB phát liền mạch trong lúc camera chụp 2 burst và IMU không mất mẫu (người dùng nghe xác nhận); hủy, khởi động lại, hỏng dữ liệu, mất một Range, rớt Wi-Fi, gửi trùng; không rò PSRAM. Người dùng nghe đủ lời chào MP3 và lời nhắn.
- **Giới hạn:** chưa lên production (Worker, frontend; firmware đã nạp trên bo). Chỉ thử Chromium cho phần trình duyệt. Chưa đo nhiệt khi phát dài. Người dùng thấy bản WAV "hơi rè" còn MP3 thì không; chuỗi số không cắt đỉnh (đo), nguyên nhân chưa xác định.
- **Owner:** Chưa gán

## Giả định tạm

### A41 — XCLK camera 20 MHz

- **Trạng thái:** Proposed · 2026-10-19 · đo trên bo thật.
- **Bối cảnh:** Baseline hạ XCLK xuống 10 MHz để cảm biến mát hơn khi stream liên tục. Đo trên bo: ở 10 MHz mỗi khung VGA cách 90 ms, nên burst chỉ chọn được khung cách 180 ms (ngoài 125 ± 40 ms, máy chủ ghi `out_of_tolerance`). Ở 20 MHz khung cách khoảng 45 ms, burst đạt 135–136 ms (`cadence_status: ok`).
- **Lựa chọn:** mặc định 20 MHz trong firmware tích hợp; thiết lập NVS `camxclk=10` quay về baseline. Cảm biến ở chế độ ngủ giữa các burst (3–5 s), không stream liên tục như baseline.
- **Chưa đo:** nhiệt độ cảm biến và vỏ hộp ở 20 MHz. Không được coi là an toàn nhiệt khi chưa đo.

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

### A29 — Trang đăng nhập dùng hai tông của landing (sáng/tối), không dùng Neumorphism (cập nhật A19; mâu thuẫn có chủ ý với `.claude/rules/frontend.md` và ARCHITECTURE §"ngoài phạm vi")

- **Trạng thái:** Proposed · 2026-10-18
- **Nội dung:** Theo yêu cầu mới nhất của người dùng (nguồn số 1), `/login` được dựng lại để khớp landing: cùng token A19 (`midnight`, `graphite`, `ivory`, `paper`, `ink`, `teal-deep`, `signal`, `mint`), nút pill `landingButtonClasses`, nhãn `Eyebrow`, logo Day1Care hiện có (`BrandIdentity`, theo yêu cầu rõ của người dùng; landing dùng wordmark "CareLens AI" nên hai nơi đang hiển thị hai tên thương hiệu khác nhau, cần người dùng chốt). Bố cục: dưới `lg` một cột (hàng logo, tiêu đề, thẻ đăng nhập, thẻ demo); từ `lg` hai khu, cột thương hiệu cố định bên trái (logo, một câu giới thiệu, ba việc người chăm sóc làm được) và cột đăng nhập bên phải. Hai chế độ là hai tông có sẵn của landing: `dark` (midnight/graphite/signal) và `light` (ivory/paper/teal-deep). Mặc định theo `prefers-color-scheme`; nút ở đầu trang đổi tông và lưu lựa chọn vào `localStorage` (khóa `login-tone`, chỉ là sở thích giao diện, không phải token hay dữ liệu sức khỏe). Không thêm màu mới; lỗi vẫn diễn đạt bằng icon, chữ đậm và viền đậm, không dùng đỏ/hổ phách (ADR-009). Style riêng nằm trong `features/auth/loginParts.tsx`, `loginTone.ts`; `BrandIdentity` chỉ thêm prop `large` (phóng to từ `lg`, mặc định không đổi). Landing không bị sửa. Logic xác thực, schema, `safeReturnTo`, route, nhãn nút và nhãn `Dữ liệu mô phỏng` không đổi.
- **Mâu thuẫn ghi nhận:** `.claude/rules/frontend.md` và ARCHITECTURE liệt dark mode vào danh sách cấm/ngoài phạm vi. Yêu cầu mới nhất được ưu tiên (AGENTS.md §2), nhưng các tài liệu đó **chưa được sửa**. Dark mode chỉ có ở `/login`; ứng dụng S01–S14 vẫn Neumorphism sáng, nên sau khi đăng nhập giao diện đổi phong cách.
- **Mặc định đang dùng:** Như trên.
- **Điều kiện giải quyết:** Người dùng xác nhận (a) cho phép dark mode ở login và cập nhật rules/ARCHITECTURE, (b) có mở rộng hai tông sang app không, (c) tên thương hiệu hiển thị (Day1Care ở login/app, CareLens AI ở landing). Đã đo bằng script canvas trên trang login: mọi chữ ≥ 4.5:1 (tối thiểu 5.64 sáng, 6.80 tối), viền ô nhập 3.18:1 (sáng) và 4.47:1 (tối) so với nền thẻ; chưa chạy công cụ kiểm tra a11y độc lập.
- **Owner:** Chưa gán

### A30 — Nhịp chụp, hạn mức và thời gian sống của media theo giới hạn free plan

- **Trạng thái:** Proposed · 2026-10-19
- **Nội dung:** Mỗi lần chụp thường (24 khung) tốn khoảng 3 PUT R2, 6–8 request Worker và 20–30 dòng ghi D1 kể cả chỉ mục. Chụp liên tục mỗi ~4 s (24 khung ở 8 fps + nghỉ 1 s) là khoảng 21.600 lần/ngày, vượt free plan nhiều lần.
- **Mặc định đang dùng:** `MAX_NORMAL_CAPTURES_PER_HOUR=60`, `MAX_TRIGGERED_CAPTURES_PER_HOUR=20` (vượt thì 429 + `Retry-After`), `FRAMES_PER_CHUNK=8`, `UPLOAD_SESSION_TTL_SECONDS=120`, `MEDIA_MAX_AGE_SECONDS=900`, `MAX_CAPTURE_AGE_SECONDS=600`, nhịp 125 ms ± `CADENCE_TOLERANCE_MS=40`; khoảng > 187 ms là mất khung và bỏ qua suy luận của lần chụp đó. Với 60 lần/giờ, một thiết bị dùng khoảng 1.440 lần chụp/ngày.
- **Điều kiện giải quyết:** Owner chọn nhịp chụp thường thật cho firmware và gói Cloudflare (Free hay Workers Paid).
- **Owner:** Chưa gán

### A31 — Định dạng lời nhắn thoại gia đình: WAV PCM mono 16-bit

- **Trạng thái:** Proposed · 2026-10-19
- **Nội dung:** Firmware sau này phát bằng I2S từ RAM hoặc stream, không giải mã nén.
- **Mặc định đang dùng:** RIFF/WAVE PCM (format 1), mono, 16-bit little-endian, 0,5–60 s, ≤ 2,2 MB, tần số theo hồ sơ thiết bị `DEVICE_AUDIO_SAMPLE_RATES` (mặc định chỉ 16 000 Hz; có thể thêm 8 000/22 050/24 000 khi firmware hỗ trợ). Tệp khác tần số bị từ chối khi tải lên, không nhận âm thầm; chuyển đổi bằng `ffmpeg -i in.m4a -ac 1 -ar 16000 -sample_fmt s16 out.wav`. Mỗi lần thay là một phiên bản mới với khóa R2 bất biến; lệnh phát ghim phiên bản và mang `sha256`, `byte_size` để thiết bị kiểm tra. Thiết bị chỉ tải được âm thanh qua lệnh đang hoạt động (hỗ trợ `Range`). Lưu tới khi người chăm sóc xóa (thời hạn lưu: D08).
- **Điều kiện giải quyết:** Xác nhận với phần cứng loa/I2S và firmware.
- **Owner:** Chưa gán

### A32 — Ưu tiên GPU giữa Vision và LLM trên RTX 2060 6 GB

- **Trạng thái:** Proposed · 2026-10-19
- **Nội dung:** Đo một lần ngày 2026-10-19: Vision server thường trú + Qwen3 4B (num_ctx 6144) cùng nạp dùng 5.297/6.144 MiB; một fall-check 24 khung (71 ms) và một object-check (119 ms) vẫn chạy khi Qwen đang nạp. Đây là một lần đo, không phải kiểm chứng dưới tải.
- **Mặc định đang dùng:** Agent dùng hai làn; làn báo cáo chỉ nhận việc khi không còn việc Vision (`defer_if_vision_pending`), việc Vision cắt ngang báo cáo đang sinh (trả job lại, không tính lượt), Ollama `keep_alive=0` để gỡ LLM sau mỗi báo cáo.
- **Điều kiện giải quyết:** Đo dưới tải dài hơn, hoặc chuyển LLM sang máy khác.
- **Owner:** Chưa gán

### A33 — Lưu IMU thô 72 giờ và các tham số chất lượng dữ liệu của hợp nhất

- **Trạng thái:** Proposed · 2026-10-19
- **Nội dung:** IMU thô cần cho hợp nhất và điều tra sự cố nhưng chiếm chỗ D1. **Sửa ước lượng 2026-10-19:** con số cũ "≈ 48 MB/ngày" sai. `samples_json` lưu nguyên JSON: ≈ 42–48 byte/mẫu nếu firmware làm tròn (3–4 chữ số cho g, 1–2 cho °/s), ≈ 130 byte/mẫu nếu ghi float32 đầy đủ, nên 100 Hz liên tục ≈ 360–1 100 MB/ngày/thiết bị (chưa tính chỉ mục). D1 Free giữ 500 MB/DB; với 72 h thì cần 1,1–3,3 GB. Mỗi lô ≈ 11 dòng ghi (đồng hồ, bảng + 4 chỉ mục, xóa theo hạn), nên lô 10 s liên tục ≈ 95 000 dòng/ngày, sát hạn 100 000 của Free chỉ với một thiết bị. Đây là ước lượng theo tài liệu Cloudflare, chưa đo trên firmware. Khi D1 đầy hoặc hết dòng ghi, mọi lệnh ghi thất bại, kể cả cảnh báo.
- **Mặc định đang dùng:** `IMU_RAW_RETENTION_HOURS=72` (cron xóa theo lô 500), `IMU_MAX_BATCH_AGE_SECONDS=3600`, lô ≤ 1000 mẫu và ≤ 120 s. Hợp nhất: `alignment_tolerance_ms=3000`, `imu_search_margin_ms=10000`, `imu_min_coverage_ratio=0.8`, `imu_max_gap_ms=500`, `imu_wait_seconds=60`. Quyết định giữ đặc trưng tính từ mẫu thô và độ phủ sau khi mẫu bị xóa. Đây là tham số chất lượng dữ liệu, không phải ngưỡng y khoa, và chưa kiểm chứng trên thiết bị. Bảo vệ dung lượng: `IMU_STORAGE_SOFT_LIMIT_MB=400` — khi DB lớn hơn, lô IMU thô bị từ chối rõ ràng (507 `imu_storage_budget_exceeded`, `Retry-After: 600`) còn burst, kích hoạt, quyết định, cảnh báo, lệnh vẫn ghi được; `GET /api/admin/v1/status` báo `storage.d1_size_bytes` và `storage.imu_ingest`. Không có giới hạn dòng ghi mỗi ngày trong mã (đếm sẽ tốn thêm ghi); theo dõi trong dashboard D1. Khuyến nghị trên Free: firmware chỉ gửi IMU quanh burst và kích hoạt.
- **Điều kiện giải quyết:** Chốt thời hạn lưu (D08); đo nhịp gửi IMU thật của firmware (liên tục hay chỉ quanh burst), cách ghi số thực và cỡ dữ liệu; chọn Free (IMU quanh sự kiện) hay Workers Paid (IMU liên tục).
- **Owner:** Chưa gán

### A34 — Live Demo trong frontend: dữ liệu máy chủ là nguồn sự thật, từ chối ghi chỉ-cục-bộ khi có phiên máy chủ

- **Trạng thái:** Proposed · 2026-10-19
- **Nội dung:** Persona "Demo trực tiếp" (`r_liveshowcase`) là nơi duy nhất frontend hiện dữ liệu thật. Để không báo thành công điều máy chủ chưa ghi nhận, `frontend/src/data/demo/demoAdapter.ts` (không đổi giao diện):
  - bản build production không có `VITE_API_BASE_URL` thì không kết nối (không gọi localhost) và luồng báo "Mất luồng cập nhật, đang thử lại";
  - sự kiện và cảnh báo từ máy chủ được cập nhật tại chỗ (trạng thái, phiên bản, xác minh), mang `source_mode`/`policy_version` thật thay cho nhãn mô phỏng;
  - thao tác cảnh báo của cảnh báo máy chủ gửi tới API và chỉ áp dụng kết quả máy chủ xác nhận;
  - khi đang có phiên máy chủ, các thao tác ghi chỉ có trong bộ nhớ (ghi chú, xuất dữ liệu, ghép thiết bị, mời, công cụ demo phát sự kiện…) bị từ chối với thông báo rõ ràng;
  - mỗi lần (mở lại) stream dùng vé mới; vé đã dùng bị bỏ ngay khi stream lỗi; stream hỏng liên tiếp được báo "Mất luồng cập nhật" và thử lại với độ trễ tăng dần (ADR-018).
  Ngoài lớp dữ liệu, chỉ đổi hai câu chữ trên trang đăng nhập (D12) để không còn nói "chưa có máy chủ xác thực".
- **Điều kiện giải quyết:** Khi có adapter `http` đầy đủ (M1+) thì thay cách này.
- **Owner:** Chưa gán

### A35 — Một hệ thiết kế (bảng màu landing) cho landing, đăng nhập và ứng dụng; một tài khoản Live Demo (thay A29; ghi đè ADR-001 cho ứng dụng)

- **Trạng thái:** Proposed · 2026-10-19
- **Nội dung:** Theo yêu cầu mới nhất của người dùng (nguồn số 1): landing là chuẩn thị giác, đăng nhập và ứng dụng sau đăng nhập phải cùng một sản phẩm, và chỉ còn một tài khoản Live Demo dùng chung.
  - **Token.** `frontend/src/design-system/tokens.css` vẫn là nguồn duy nhất. Tám màu landing (A19) giữ nguyên giá trị; các token ngữ nghĩa của ứng dụng chỉ còn là bí danh: `surface` = ivory, `fg` = ink, `accent` = teal-deep, `accent-light` = signal. Các bóng Neumorphism (`extruded`, `inset`…) giữ tên nhưng đổi nghĩa: vòng 1px bằng shadow (không đổi kích thước hộp) cộng bóng giấy mềm của landing. Bán kính thẻ 32px → 24px (khớp thẻ đăng nhập). Không thêm màu mới; lỗi vẫn là icon, chữ đậm và viền đậm, không đỏ/hổ phách (ADR-009).
  - **Primitive dùng chung** (`design-system/primitives.tsx`, `feedback.tsx`, `overlays.tsx`): `SoftSurface` raised = thẻ `paper` viền mảnh; `buttonClasses` dùng lại màu nút của `landingButtonClasses` (pill, teal-deep, tông `dark` cho thanh điều hướng); ô nhập là `InsetField` (viền ink/55, focus teal); `IconWell` = `IconRing` của landing; tab/phân đoạn là nhãn pill, mục chọn đổi nền teal đậm và có chấm đánh dấu. Tên component giữ nguyên để các trang không phải sửa.
  - **Khung ứng dụng** (`app/AppShell.tsx`): thanh bên và thanh đầu trang midnight như header landing (nhãn mono, nav pill, mục đang chọn có viền signal và chữ đậm), vùng nội dung ivory/paper. Một tông cố định như landing, không có công tắc sáng/tối.
  - **Đăng nhập** (`features/auth/LoginPage.tsx`): khu thương hiệu midnight cạnh khu biểu mẫu ivory/paper, dùng đúng các primitive trên. Bỏ khối "Vào bản demo" (bốn người dùng mô phỏng và LIVESHOWCASE), bỏ nút đổi tông và khóa `localStorage` `login-tone` (A29), bỏ thành phần riêng `loginParts`/`loginTone`. Đăng nhập đúng chuyển tới `/people`, và `/people` (`features/recipients/LiveDemoHome.tsx`) chuyển thẳng tới tổng quan của hồ sơ đầu tiên máy chủ cấp quyền xem.
  - **Thương hiệu.** Mọi nơi dùng wordmark "CareLens AI" của landing (`design-system/Brand.tsx`, chuyển từ `features/landing/Brand.tsx`). `BrandIdentity` (logo Day1Care ở đăng nhập và ứng dụng) bị xóa; tiêu đề tab đổi sang "CareLens AI". Logo Day1Care chỉ còn làm favicon (`public/brand/day1care-logo.png`), chưa đổi vì là tài sản thương hiệu cần chủ sở hữu quyết.
  - **Gỡ phần chỉ phục vụ demo nhiều người dùng:** `OnboardingPage` (tạo hồ sơ; vốn bị từ chối khi có phiên máy chủ), `AdminPage` và route `/admin` (chỉ persona quản trị mô phỏng vào được), trang danh sách hồ sơ và bộ chọn hồ sơ, `enterDemo`/`useDemoControls` trong giao diện. Các phương thức tương ứng của `DemoAdapter` và fixture persona **còn lại làm điểm tiếp cận cho unit test** (`demoAdapter.test.ts`), không còn đường vào từ giao diện.
  - **Trung thực:** email fixture (`*.invalid`) không còn hiện như email của người đăng nhập; nhãn cạnh nội dung là "Demo trực tiếp"; câu "Toàn bộ dữ liệu trên trang là dữ liệu mô phỏng" bị bỏ vì sai với dữ liệu máy chủ.
- **Mâu thuẫn ghi nhận:** `.claude/rules/frontend.md` (mục Neumorphism, cấm dark mode/viền) và AGENTS.md §6 "Thiết kế" nói ngược lại; đã cập nhật hai nơi này theo A35. `docs/CARELENS_ECOPATCH_SYSTEM_UI_PROMPT.md` và ARCHITECTURE §7.4 (công thức bóng Neumorphism) **chưa sửa**. Trang EcoPatch, Chia sẻ, Thiết bị vẫn hiển thị dữ liệu fixture cho hồ sơ Live Demo (có nhãn "Demo trực tiếp"); chưa được thay bằng dữ liệu máy chủ.
- **Điều kiện giải quyết:** Người dùng xác nhận (a) bảng màu landing là chuẩn cho cả ứng dụng, (b) tên hiển thị CareLens AI thay Day1Care và số phận của favicon, (c) việc ẩn hoặc nối dữ liệu máy chủ cho các trang còn dùng fixture. Độ tương phản của các cặp màu mới chưa chạy công cụ a11y độc lập; palette.test.ts chỉ kiểm các cặp đã dùng ở landing.
- **Owner:** Chưa gán

### A36 — Đăng nhập web bằng tên đăng nhập; mật khẩu do owner chọn lưu bằng PBKDF2 (tài khoản trình diễn DAYONE)

- **Trạng thái:** Proposed · 2026-10-19
- **Nội dung:** Theo yêu cầu mới nhất của người dùng: tài khoản trình diễn dùng chung là `DAYONE` / `DAYONE` (chỉ cho cuộc thi, không phải khuyến nghị cho production).
  - **Hợp đồng:** `POST /api/app/v1/session` nhận `username` (email hoặc tên đăng nhập thuần `[a-z0-9._@+-]`, 3–254 ký tự, không phân biệt hoa thường); `email` cũ vẫn được nhận. Admin `POST /caregivers/{id}/login` nhận `login_id` (hoặc `login_email` cũ) và `password` tùy chọn (5–128 ký tự). Cột `login_email` giữ nguyên (không có migration mới).
  - **Lưu mật khẩu:** mật khẩu sinh tự động (100 bit) vẫn là SHA-256 (đủ vì không đoán được offline). Mật khẩu **do owner chọn** có thể yếu nên lưu `pbkdf2-sha256$<vòng>$<salt>$<băm>` (WebCrypto, salt ngẫu nhiên 16 byte, mặc định 100000 vòng là mức tối đa của Workers; số vòng nằm trong chuỗi băm nên hạ `LOGIN_PBKDF2_ITERATIONS` không làm hỏng băm cũ). Mật khẩu chọn phân biệt hoa thường; không bao giờ được trả về hay ghi log. Tài khoản không tồn tại vẫn tốn một lần PBKDF2 để thời gian trả lời không lộ sự tồn tại.
  - **Không đổi:** giới hạn 20 lần/60 s mỗi IP (tính cả lần đúng), phiên riêng mỗi lần đăng nhập (đăng xuất một nơi không ảnh hưởng nơi khác), xoay mật khẩu kết thúc mọi phiên, vé stream dùng một lần, quyền `viewer` chỉ đọc.
  - **Rủi ro chấp nhận:** `DAYONE` đoán được. Giảm nhẹ bằng quyền chỉ xem trên một hồ sơ trình diễn, giới hạn tần suất, và xoay ngay sau buổi trình diễn (`docs/DEPLOYMENT_RUNBOOK.md` §8.1). Khả năng bruteforce online dưới giới hạn tần suất chưa được đánh giá bằng thử nghiệm tải.
  - **Chưa kiểm:** thời gian CPU của PBKDF2 100000 vòng trên Workers Free (giới hạn 10 ms) chưa đo trên Cloudflare; chỉ chạy được trong `wrangler dev` và test Workers cục bộ. Nếu đăng nhập lỗi vượt CPU sau deploy, hạ `LOGIN_PBKDF2_ITERATIONS` rồi xoay lại mật khẩu, hoặc dùng gói Paid.
- **Điều kiện giải quyết:** Người dùng xác nhận chấp nhận mật khẩu yếu cho trình diễn; đo đăng nhập trên bản deploy; tạo tài khoản bằng `admin.py login --login-id DAYONE --choose-password` trên backend đã deploy.
- **Owner:** Chưa gán

### A37 — Đăng nhập bằng Google (OIDC code + PKCE) chỉ cho danh tính do owner cho phép; sửa lỗi "không kết nối" khi chạy cục bộ

- **Trạng thái:** Proposed · 2026-10-19
- **Nội dung (nguyên nhân lỗi cục bộ):** trang đăng nhập báo "Không kết nối được máy chủ CareLens" vì (1) `npm run dev:backend` thoát ngay với mã 3 khi DB cục bộ cũ hơn kiểm tra schema, nên không có gì nghe ở cổng 8787; (2) có thể còn hai bộ `wrangler dev`/`workerd` chạy chồng, nhận kết nối nhưng không trả lời; (3) khi origin của trang không nằm trong `ALLOWED_ORIGINS`, preflight bị 403 và trình duyệt báo y hệt máy chủ chết, nên frontend gọi nhầm là mất kết nối. Đã sửa: frontend thăm dò `GET /health` (no-cors) để phân biệt "máy chủ tắt" với "máy chủ từ chối origin", thêm báo lỗi riêng cho 400/422; thêm `scripts/dev_setup.py` (`init`, `provision`) và `docs/DEV_LOCAL.md`. Không có dữ liệu mô phỏng hay xác thực giả nào thay thế.
- **Nội dung (Google):** luồng authorization code + PKCE (S256) thực hiện hoàn toàn ở Worker (`src/google.ts`), scope chỉ `openid email`. State dùng một lần (băm trong D1, 10 phút) và gắn với cookie HttpOnly của trình duyệt khởi tạo (chặn login CSRF). Mã đổi token cùng client secret (bí mật Worker) và code_verifier; ID token kiểm chữ ký RS256 theo JWKS của Google, `iss`, `aud`, `exp`, `iat`, `nonce`, `email_verified`. Chuyển hướng về web chỉ tới `GOOGLE_POST_LOGIN_URL` cấu hình sẵn; web đổi mã `clx_…` dùng một lần (60 giây, nằm ở fragment, bị xóa khỏi thanh địa chỉ ngay) lấy phiên riêng qua `POST /session/exchange`, nên token phiên không bao giờ nằm trên URL. Không có token Google nào được lưu hay log; không dùng web storage.
- **Chính sách cấp quyền:** **danh sách cho phép tường minh do owner quản** (`google_identities`, bảng D1): `admin.py google-allow --user … --email …` gắn một email Google với một tài khoản chỉ xem có sẵn; không tự tạo tài khoản, không cho theo miền. Lần đăng nhập đầu gắn `sub` của Google; cùng email với `sub` khác bị từ chối (chống chiếm lại địa chỉ). Danh sách rỗng = không ai vào được bằng Google. Chọn danh sách email thay vì miền Workspace vì chưa có miền nào do owner chỉ định; chưa đoán email hay miền nào.
- **Cấu hình cần owner:** `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `GOOGLE_POST_LOGIN_URL` (biến) và `GOOGLE_CLIENT_SECRET` (secret). Thiếu client id và secret thì Google tắt và nút báo "chưa được cấu hình"; cấu hình dở dang hoặc URL sai thì chỉ các route Google báo 503 `misconfigured` (phần còn lại của API không bị ảnh hưởng). Không có giá trị nào được bịa trong repo.
- **Không đổi:** đăng nhập `DAYONE` bằng mật khẩu (A36), giới hạn tần suất (tính cả callback và exchange), phiên riêng cho mỗi lần đăng nhập, vé stream dùng một lần, quyền `viewer`.
- **Đã kiểm chứng:** 23 test Worker với "Google giả" (khóa RSA thật ký ID token, JWKS thật) cho state/CSRF/PKCE/nonce/chữ ký/audience/issuer/hết hạn/email chưa xác minh/danh tính lạ/`sub` lệch/hết hạn mã/phiên độc lập; Worker thật cục bộ (client id giả) cho redirect bắt đầu, cookie, từ chối callback giả và nút trong trình duyệt. **Chưa kiểm:** đăng nhập với Google thật (cần client id/secret và tài khoản Google thật của owner), thời gian CPU của PBKDF2/RSA trên Workers Free, kiểm duyệt màn hình đồng ý của Google khi ra khỏi trạng thái Testing.
- **Điều kiện giải quyết:** Owner tạo OAuth client, điền cấu hình, `google-allow` các email; kiểm một lần đăng nhập Google thật.
- **Owner:** Chưa gán

### A38 — Bản deploy chỉ đăng nhập bằng Google; mọi tài khoản Google đã xác minh được xem (chỉ xem) đúng một hồ sơ trình diễn

- **Trạng thái:** Proposed · 2026-10-19 (theo yêu cầu của owner trong phiên: "mọi người dùng Google đều đăng nhập được vào Live Demo dùng chung, chỉ xem; không cần tài khoản `DAYONE`"). Mở rộng A37, không thay chính sách danh sách cho phép.
- **Nội dung:**
  - `GOOGLE_OPEN_VIEWER_RECIPIENT_ID` (biến, bản deploy: `rcp-showcase`). Khi có giá trị, mọi danh tính Google qua đủ kiểm tra của A37 (state, PKCE, nonce, chữ ký, `iss`, `aud`, `exp`, email đã xác minh) mà không có trong `google_identities` được gắn theo `sub` vào một tài khoản riêng (bảng `google_viewers`, migration `0003`) có đúng một grant `viewer` (chỉ `data.read`) trên hồ sơ đó. Không lưu email hay thông tin hồ sơ Google nào khác.
  - Hồ sơ trình diễn được tạo **rỗng** (nhãn "Hồ sơ trình diễn", không thiết bị, không sự kiện) nếu chưa có, bằng `INSERT OR IGNORE`; không bao giờ kích hoạt lại khi owner đã tắt nó. Không seed dữ liệu.
  - Owner vẫn kiểm soát: grant đã thu hồi không được tạo lại, tài khoản bị tắt (`caregivers.status = 'disabled'`) bị từ chối, để trống biến là đóng chế độ mở ngay (kể cả với người đã từng vào). Email trong danh sách cho phép không bao giờ rơi sang chế độ mở khi `sub` lệch.
  - `PASSWORD_SIGN_IN` (`enabled` mặc định, bản deploy `disabled`): `POST /session` trả 403 `password_sign_in_disabled` trước mọi kiểm tra; `GET /auth/google/config` báo `password_sign_in` và trang đăng nhập ẩn biểu mẫu. Backend cục bộ (`start_backend.py`), test Worker và stack e2e Python bật lại mật khẩu.
- **Rủi ro chấp nhận:** bất kỳ ai có tài khoản Google đều đọc được hồ sơ trình diễn, nên hồ sơ này **không bao giờ** được chứa dữ liệu người thật (AGENTS.md §6). Mỗi tài khoản Google mới thêm một dòng `caregivers`/`google_viewers`/`grants`; số lần tạo bị chặn bởi giới hạn đăng nhập 20 lần/60 s mỗi IP, chưa có giới hạn tổng.
- **Đã kiểm chứng (2026-10-19):** 15 test Worker mới với Google giả (khóa RSA thật): cấp quyền chỉ xem đúng hồ sơ, cùng `sub` → cùng tài khoản, mọi lệnh ghi/lệnh thiết bị/admin → 403/401, hồ sơ khác → 404, phiên hết hạn và đăng xuất độc lập, grant thu hồi không tạo lại, tắt chế độ thì bị từ chối, token sai chữ ký/aud/iss/hết hạn/nonce và state sai vẫn bị từ chối mà không tạo tài khoản; mật khẩu tắt → 403. Toàn bộ 210 test Worker pass. Production: migration `0003` đã áp, Worker deploy, `/ready` báo `password_sign_in: disabled`, trang đăng nhập production (Chromium thật, backend thật) chỉ có nút Google. **Chưa kiểm:** đăng nhập với Google thật (chờ owner tạo OAuth client và đặt `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
- **Owner:** Chưa gán

### A39 — Khu quản trị `/admin` trong frontend: phiên admin riêng, chỉ đọc, không dữ liệu giả

- **Trạng thái:** Proposed · 2026-10-19 · Giao diện của ADR-020. Chưa deploy; chưa chạy với Google thật hay Worker production.
- **Quan hệ với A35:** A35 gỡ `AdminPage` và `/admin` vì đó là persona quản trị **mô phỏng** của nhiều người dùng giả. Khu mới này là việc khác: đăng nhập quản trị thật qua máy chủ, không persona, không dữ liệu mô phỏng. A35 vẫn đúng với phần đã gỡ.
- **Nội dung:**
  - `/admin/login` bắt đầu luồng bằng điều hướng toàn trang tới `…/api/app/v1/auth/google/start?mode=admin`. Callback trả về `/admin/login#admin_code=cax_…` hoặc `#error=…`; trang đọc fragment một lần, xóa khỏi thanh địa chỉ bằng `history.replaceState` ngay, chỉ chấp nhận đúng dạng `cax_…` (mã người xem `clx_…` không bao giờ được đổi ở đây), rồi `POST /api/admin/v1/session/exchange` đúng một lần (không thử lại mã dùng một lần).
  - `/admin` chỉ hiện sau khi `GET /api/admin/v1/me` xác nhận phiên (trạng thái `signed_in` chỉ tồn tại sau lời gọi này), và hỏi lại khi vào lại sau hơn 10 giây. 401 hoặc 403 ở bất kỳ lời gọi admin nào kết thúc phiên và đưa về `/admin/login`. Vai trò và email hiển thị đúng như máy chủ trả về; giao diện không có cờ vai trò riêng.
  - Phiên admin nằm trong `AdminAuthProvider` (`app/adminAuth.tsx`), tách khỏi `AuthProvider`, adapter và `QueryClient` của người xem. Dùng lớp lỗi riêng `AdminApiError` (không phải `ApiError`) vì `AuthFailureBridge` trong `providers.tsx` đăng xuất người xem khi gặp lỗi xác thực của `ApiError`; nếu dùng chung, một phiên admin hết hạn sẽ đăng xuất nhầm người xem. Dữ liệu admin không vào cache TanStack nên không sót lại sau khi đăng xuất. Token chỉ ở một `ref` trong bộ nhớ.
  - Tổng quan chỉ đọc `GET /api/admin/v1/status` (API có sẵn): trạng thái hệ thống, sổ thiết bị (chỉ xem), agent. Nhật ký audit ghi rõ "chưa khả dụng" vì chưa có API đọc. Không có nút cấp phát, xoay, thu hồi hay mời.
  - Trước khi hiện nút đăng nhập, trang đọc `GET /ready` (`capabilities.admin_signin`, `google_signin`) để không dẫn người dùng tới trang JSON lỗi của máy chủ. Máy chủ cũ không có trường này được báo là "chưa hỗ trợ đăng nhập quản trị" (đúng với production hiện tại).
- **Lưu ý bảo mật cho owner (chưa xử lý, không đổi kiến trúc):**
  1. Bearer trong bộ nhớ không bền qua tải lại trang (tải lại = đăng nhập Google lại) và vẫn đọc được bởi bất kỳ script nào chạy trong trang (XSS). Cookie HttpOnly sẽ giảm rủi ro rò token nhưng cần đổi backend (CORS có thông tin xác thực, chống CSRF) nên cần quyết định riêng.
  2. (Đã xử lý ở A40.) `frontend/vercel.json` ban đầu không đặt header bảo mật. Nên thêm `Content-Security-Policy`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` (hoặc `frame-ancestors`) và `X-Content-Type-Options` trước khi dùng quyền admin trên bản deploy.
  3. Phiên admin sống tối đa `ADMIN_SESSION_TTL_MINUTES` (mặc định 120). Chưa có xác thực lại cho thao tác nhạy cảm; sẽ cần khi có hiện/xoay credential.
  4. Phía máy chủ vẫn là nơi duy nhất thực thi quyền; guard giao diện chỉ để điều hướng.
- **Đã kiểm chứng (2026-10-19, cục bộ):** 46 test Vitest mới (`data/admin/adminClient.test.ts`, `features/admin/admin.test.tsx`), 4 test Playwright mới cho bản build production với Worker giả (`e2e/admin-login.spec.ts`), 14 test Playwright viewer `google-login.spec.ts` vẫn đạt. **Chưa kiểm:** đăng nhập admin với Google thật, migration `0004` và quyền admin trên production.
- **Owner:** Chưa gán

### A40 — Bảng điều khiển admin có API thật; header bảo mật; migration 0005

- **Trạng thái:** Proposed · 2026-10-19 · Mở rộng A39. Chưa deploy; chưa chạy với Google thật, Worker production hay thiết bị ESP32.
- **Phạm vi:** `/admin` có thêm Thiết bị (danh sách, chi tiết), Báo cáo ngày, Gửi âm thanh, Nhắc lịch, Agent và dịch vụ, Nhật ký. Mỗi màn hình gọi một route thật trong ma trận ở `docs/API_CONTRACT.md` "Bảng điều khiển admin"; chỗ chưa có API thì ghi rõ "không có / không được lưu", không có số liệu dựng sẵn.
- **Tái dùng, không tạo giao thức mới:** lệnh phát âm thanh là `play_voice_message`, nhắc lịch là hàng `reminder_schedules` do cron mỗi phút (đã có) biến thành lệnh `reminder` một lần cho mỗi lần hẹn. Lõi tạo lệnh, hủy lệnh, lưu bản ghi âm được tách khỏi route người chăm sóc (`createVoiceCommand`, `cancelCommandOf`, `storeVoice`) để hai đường dùng cùng mã; 245 test Worker có từ trước vẫn đạt.
- **Ghi nhận người thao tác mà không đổi ràng buộc CHECK cũ:** `device_commands.source_type` chỉ nhận `alert|reminder|caregiver` và `device_command_events.actor_type` chỉ nhận `device|caregiver|system`. SQLite không sửa CHECK tại chỗ, nên lệnh của admin dùng `source_type='caregiver'`, `created_by='admin:<admin_id>'`; sự kiện hủy của admin ghi `actor_type='system'` với lý do `cancelled_by_admin`. Người thao tác thật nằm trong `audit_log` (`actor_type='admin'`, `actor_id`). Đổi sang bảng riêng cần dựng lại bảng, để quyết định sau nếu cần.
- **Migration `0005_admin_ops.sql` (chỉ cộng thêm):** cột `reminder_schedules.paused_at` (tạm dừng khác hủy), chỉ mục `events(device_id, observed_at)`, `device_commands(device_id, created_at)`, `audit_log(actor_id, at)`. **Thứ tự triển khai bắt buộc:** áp migration `0004` và `0005` trước, rồi mới deploy Worker, vì cron chọn `paused_at`; Worker mới chạy trên DB chưa có cột sẽ làm bước nhắc lịch của cron lỗi.
- **Báo cáo ngày:** ngày lịch theo `REPORT_TIMEZONE` → khoảng UTC nửa mở `[start, end)`, mỗi nguồn lọc theo mốc thời gian chính của nó bằng cùng quy tắc nên một bản ghi thuộc đúng một ngày (có test ở ranh giới mili-giây). Mỗi nguồn trả trạng thái riêng (`ok`, `truncated`, `partial`, `retention_expired`, `not_stored`) để "không thấy dòng nào" không bị đọc thành "không có hoạt động". Lỗi truy vấn là lỗi HTTP, không bao giờ là danh sách rỗng. **Khoảng trống dữ liệu đã biết:** heartbeat chỉ lưu bản gần nhất; không có lịch sử online/offline của thiết bị hay agent; IMU thô chỉ giữ `IMU_RAW_RETENTION_HOURS` (72 giờ) và chỉ được tóm tắt theo giờ trong báo cáo.
- **Âm thanh:** chỉ phát được bản ghi WAV đã tải lên (PCM 16-bit mono, tốc độ theo `DEVICE_AUDIO_SAMPLE_RATES`). **Chuyển văn bản thành giọng nói chưa có** (Ollama không phải TTS; không có dịch vụ nào được kiểm chứng), nên không có ô nhập văn bản đọc to. Nghe thử qua `fetch` có Bearer rồi phát từ blob; không có URL công khai. Thiết bị tải âm thanh qua route có xác thực của chính lệnh đó (`/api/device/v1/commands/{id}/audio`), như giao thức hiện có.
- **Chống gửi nhầm và trùng:** thân yêu cầu bắt buộc `confirm: true` ở máy chủ (giao diện cũng có hộp xác nhận), khóa idempotency gắn tiền tố theo admin, nút gửi bị khóa khi đang gửi, giới hạn 20 thay đổi/phút/admin tính từ chính `audit_log`.
- **Nhắc lịch bền:** lịch nằm trong D1 và do cron của Worker thực hiện; không dùng bộ hẹn giờ trình duyệt. Mỗi lần hẹn đúng một lệnh (khóa `reminder:<id>:<occurrence>`, có test chạy cron nhiều lần), thiết bị ngoại tuyến quá `deadline_minutes` thì lệnh hết hạn và không bao giờ phát muộn. **Chưa có bằng chứng cron chạy trên production:** bằng chứng duy nhất là xuất hiện lệnh cho lần hẹn đầu tiên sau khi deploy.
- **Đăng ký / xoay / thu hồi credential thiết bị: chưa đưa vào giao diện.** Route cấp phát (`POST /devices`, `rotate-token`, `revoke`) đã có từ trước, trả credential một lần và ghi audit, nhưng giao diện hiển thị bí mật cần xác thực lại gần đây (step-up) mà phiên admin hiện chưa có (`auth_at` đã lưu, chưa có route kiểm). Trong lúc firmware chưa nạp, rủi ro lớn hơn lợi ích. Mở trang thiết bị không bao giờ tạo hay lộ credential.
- **Header bảo mật (`frontend/vercel.json`):** CSP (`default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` vì React/Tailwind dùng thuộc tính `style`; `font-src https://fonts.gstatic.com`; `img-src 'self' data: blob:`; `media-src 'self' blob:` cho nghe thử; `connect-src 'self'` + **địa chỉ Worker production** mã cứng; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` tắt camera, micro, định vị. **Đổi `VITE_API_BASE_URL` sang origin khác thì phải sửa `connect-src` cùng lúc**, nếu không toàn bộ lời gọi API bị chặn. Đăng nhập Google là điều hướng toàn trang nên không bị CSP chặn. Đã kiểm bản build thật trong Chromium với đúng các header này: không vi phạm CSP trên 5 route, nhúng iframe bị từ chối, kết nối tới origin ngoài chính sách bị chặn. **Chưa kiểm trên Vercel thật.**
- **Đánh đổi giữ nguyên (không đổi âm thầm):** phiên admin vẫn là Bearer trong bộ nhớ (tải lại = đăng nhập lại; script trong trang đọc được token nếu có XSS). CSP giảm rủi ro XSS nhưng không loại bỏ; chuyển sang cookie HttpOnly cần thiết kế riêng cho CORS có thông tin xác thực và CSRF.
- **Đã kiểm chứng cục bộ (2026-10-19):** Worker 287/287 (`admin-ops` 38, `device-flow` 4, 245 test cũ), typecheck và `contracts:check` sạch, `deploy:dry-run` đạt; frontend: test giao diện và client mới, 8 test Playwright admin (bản build production, Worker giả, `<dialog>` thật), 14 test Playwright viewer vẫn đạt. **Chưa kiểm:** Google OAuth thật, migration `0004`/`0005` trên production, cron trên production, bất kỳ thiết bị ESP32 thật.
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
