# Báo cáo kiểm thử và ma trận tích hợp — 2026-10-19

Phạm vi: backend `care-monitoring` (Cloudflare Worker), Local AI Agent, tích hợp frontend (Live Demo), hợp đồng thiết bị. Không có firmware ESP32, không có tài khoản Cloudflare/Vercel: **không có gì được deploy**. Mọi số liệu dưới đây là kết quả chạy thật trên PC phát triển ngày 2026-10-19.

## 0. Đợt 2 — chuẩn bị triển khai (cùng ngày)

Thay đổi trong đợt này: tài khoản giám khảo dùng chung (giới hạn lần thử đăng nhập kiểm trước mật khẩu, lệnh `admin.py revoke-token` / `revoke-grant`), frontend lùi dần khi stream hỏng liên tiếp và bỏ vé đã dùng, hai câu chữ trên trang đăng nhập, workspace npm gốc (D13), bảo vệ dung lượng IMU (`IMU_STORAGE_SOFT_LIMIT_MB`, `storage` trong `/api/admin/v1/status`), sửa ước lượng dung lượng IMU (A33), runbook viết lại. Không đổi schema thiết bị v2, ngưỡng hay kiến trúc hợp nhất.

| Kiểm tra | Lệnh (thư mục) | Kết quả |
| --- | --- | --- |
| Worker — kiểu, test | `npm run typecheck`; `npx vitest run` (`backend/care-monitoring/worker`) | Pass; **169/169** (thêm: 5 phiên đồng thời của một tài khoản giám khảo, vé riêng mỗi phiên, vé dùng hai lần cùng lúc chỉ mở một stream, quyền chỉ đọc ở API, đăng xuất tách biệt, đổi mật khẩu kết thúc mọi phiên; giới hạn lần thử đăng nhập trước mật khẩu; IMU bị từ chối 507 trên ngưỡng dung lượng) |
| Worker — schema, đóng gói | `npm run contracts:check`; `npm run deploy:dry-run` | Pass; 1031,25 KiB (gzip 184,19 KiB), có `IMU_STORAGE_SOFT_LIMIT_MB`, không cảnh báo cấu hình |
| Tài khoản giám khảo với CLI thật | Script tạm: `wrangler dev` cục bộ + `admin.py` (`recipient`, `caregiver`, `revoke-token`, `grant --role viewer`, `login`, `revoke-grant`, `login` lần hai) | **19/19**: 5 đăng nhập và 5 stream đồng thời, vé dùng lại bị 401, viewer 403 khi xử lý cảnh báo và 401 ở admin, đăng xuất một người không ảnh hưởng người khác, thu hồi grant chặn vé, đổi mật khẩu kết thúc mọi phiên và vô hiệu mật khẩu cũ |
| Frontend — lệnh gốc qua workspace | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (gốc) | Pass, pass, **258/259** (1 lỗi có từ trước, §6), pass; 0 tham chiếu `127.0.0.1` trong bundle |
| Frontend — test Live Demo | `npx vitest run src/data/demo/liveDemoBackend.test.ts` | 14/14 (thêm: mở lại với vé mới và `last_seq` sau khi máy chủ đóng stream, không nhân đôi bản ghi; stream đóng sớm được báo và không xin vé trong thời gian chờ 5→10 s) |
| Frontend — Playwright toàn bộ | `npm run test:e2e` (gốc) | **60 pass, 2 fail, 4 skip** (31,5 phút). Hai lỗi có từ trước (§6) |
| Trình duyệt thật với mô hình thật | `python -m pytest -m e2e tests/integration/test_e2e_browser_live_demo.py` (Vision server CUDA bật tạm, tắt sau) | 1/1 |
| Lockfile gốc trong bản sao sạch | `cd frontend && npm ci && npm run build` trong bản sao chỉ có `package.json`, `package-lock.json` gốc và `frontend/` | Pass: npm cài theo workspace gốc (đường của Vercel), 0 khác biệt phiên bản so với `frontend/package-lock.json` |
| Agent — test | Không chạy lại | Mã agent không đổi |

Kiểm tra bí mật (chỉ đếm, không in giá trị): không có tệp bí mật bị track; `.env`, `.dev.vars`, `agent.env`, `device-credentials*.json` bị git bỏ qua, các tệp `*.example` chỉ có chỗ trống; không có source map trong bundle hay khi deploy Worker; `frontend/dev-server.log` không có chuỗi dạng token. **Có** một chuỗi dạng token Telegram trong lịch sử git (commit `e9d9b67`, `backend/demo-control/src/demo_control/tests/test_telegram_bot.py`, đã có trên `origin/main`), khớp mask `8291****15A` bên cạnh: owner phải thu hồi (runbook §1). Không viết lại lịch sử.

## 1. Môi trường

| Mục | Giá trị |
| --- | --- |
| Máy | Windows 10 Pro, NVIDIA GeForce RTX 2060 6 GB (driver 596.36) |
| Node / Wrangler / Playwright | 24.15.0 / 4.151.1 / 1.63.0 (Chromium) |
| Python test | 3.11.9 (pytest, jsonschema) |
| Gói Vision | `carelens_models_v1_20261018`, server `127.0.0.1:8080`, CUDA, Python 3.14.7 (`D:\AI\Envs\CareLens-VLM`) |
| LLM | Ollama 0.40.6, `qwen3:4b-instruct-2507-q4_K_M` |
| Backend trong test đầu-cuối | `wrangler dev` cục bộ trên cổng ngẫu nhiên, D1/R2/Durable Object cục bộ trong thư mục tạm, xóa sau test |

## 2. Lệnh đã chạy và kết quả

| Thành phần | Lệnh (thư mục) | Kết quả |
| --- | --- | --- |
| Worker — kiểu | `npm run typecheck` (`backend/care-monitoring/worker`) | Pass |
| Worker — test | `npm test` | **166/166 pass**, 8 file (unit 46 gồm ma trận hợp nhất 13 ca; fusion qua API 23; capture/job 22; auth 16; commands 12; realtime/đăng nhập/vé 9; reports 5; contracts 33) |
| Worker — schema | `npm run contracts:check` | Pass (8 schema khớp `src/contracts.ts`, không còn schema v1 cũ) |
| Worker — đóng gói | `npm run deploy:dry-run` | Pass, 1029,67 KiB (gzip 183,59 KiB), đủ binding DB, MEDIA, AUDIO, REALTIME, 2 rate limiter |
| Agent — test | `python -m pytest -q` (`integrations/carelens/local-agent`) | **38/38 pass** (11 test e2e được bỏ chọn mặc định) |
| Agent ↔ mô hình thật | `python -m pytest -m e2e tests/integration -s` | **11/11 pass** (40,4 s) |
| Frontend — kiểu | `npm run typecheck` (`frontend`) | Pass |
| Frontend — lint | `npm run lint` (`frontend`) | Pass |
| Frontend — test | `npx vitest run` (`frontend`) | **257/258 pass**; 1 fail có từ trước (mục 6) |
| Frontend — test mới | `npx vitest run src/data/demo/liveDemoBackend.test.ts` | 13/13 pass |
| Frontend — build | `npx vite build` có và không có `VITE_API_BASE_URL` | Pass; bundle production chứa 0 tham chiếu `127.0.0.1:8787`; bản có biến chứa đúng URL backend |
| Trình duyệt thật | `tests/integration/test_e2e_browser_live_demo.py` → `frontend/e2e/live-demo-backend.spec.ts` | Pass: Chromium đăng nhập bằng biểu mẫu thật, Live Demo hiện quyết định do mô hình thật tạo, lệnh phát được thiết bị xác nhận, dòng trạng thái hệ thống; stream dùng vé `cls_`; không có `clc_`/`cls_` trong web storage |

Lệnh gốc `npm run build|test|lint|typecheck` (qua `-w @istartup/web`) **không chạy được** từ trước thay đổi này (D13); các lệnh trên chạy trong `frontend/`.

## 3. Các ca đầu-cuối với mô hình thật (11 test)

| Test | Kiểm gì |
| --- | --- |
| `test_normal_capture_fall_sample_matches_package_reference` | Burst 24 khung qua harness → Vision CUDA: điểm khớp `samples/expected.json` (< 1e-3); `uncalibrated_output`, `NOT_CALIBRATED`; sự kiện mang `boot_id` |
| `test_normal_capture_drink_sample_matches_package_reference` | Nhãn `uong_thuoc` và bằng chứng khớp tham chiếu; không lộ hộp phát hiện |
| `test_triggered_40_frame_capture_with_raw_imu_is_split_and_fused_on_the_device_clock` | 40 khung → 3 yêu cầu chồng (0–23, 8–31, 16–39), điểm yêu cầu đầu khớp tham chiếu; IMU thô phủ burst (≥ 0,8) trên đồng hồ thiết bị; quyết định `needs_review` / `rules_not_configured`, không cảnh báo; đọc lại ≥ 900 mẫu thô |
| `test_no_media_remains_after_processing` | Không còn media trong R2 và không có tệp ảnh trong thư mục trạng thái; `/admin/v1/status` có lần suy luận thành công |
| `test_live_demo_stream_via_sign_in_and_ticket_matches_the_frontend_contract` | Đăng nhập viewer → vé → `/api/demo/stream`; khung khớp các interface của frontend; vé dùng lần hai bị 401 |
| `test_downstream_voice_message_reaches_the_device_and_only_completes_on_its_report` | Tải WAV → lệnh → thiết bị lấy âm thanh theo `Range`, kiểm SHA-256 → `accepted/started/completed`; `played_confirmed_by_device` chỉ đúng sau `completed`; Live Demo ghi "thiết bị xác nhận đã phát xong"; đường âm thanh đóng sau đó |
| `test_daily_report_runs_through_real_ollama` | Cron 00:15 → Qwen thật → báo cáo hợp lệ, `eval_count > 0`, Qwen được gỡ khỏi GPU sau đó |
| `test_agent_heartbeat_reaches_the_status_view` | Heartbeat agent (tình trạng, lần thành công gần nhất) và heartbeat thiết bị hiện trong `/admin/v1/status`, không có token |
| `test_aligned_evidence_raises_a_provisional_alert_that_reaches_device_caregiver_and_live_demo` | Backend riêng với **chính sách thử chỉ để kiểm đường đi** (chấp nhận mọi điểm; IMU khớp gai tổng hợp): `suspected_fall` + cảnh báo tạm thời → còi giao tới thiết bị và được xác nhận → người chăm sóc tiếp nhận → Live Demo hiện cảnh báo phiên bản 2 và lệnh còi đã xác nhận |
| `test_the_viewer_session_cannot_act_on_the_alert` | Phiên giám khảo (viewer) bị 403 khi xử lý cảnh báo |
| `test_frontend_login_and_live_demo_show_real_backend_records` | Chromium (mục 2) |

Đo một lần (RTX 2060, Vision server thường trú): job 24 khung 0,58 s; job 40 khung 0,76 s; báo cáo ngày 5,5 s; Ollama không giữ mô hình sau báo cáo (`/api/ps` rỗng). Đây là số đo đơn lẻ, không phải benchmark.

## 4. Ma trận tích hợp

Trạng thái: **Verified** (đã chạy thật trên máy này, trong phạm vi ghi chú), **Partially verified**, **Blocked**, **Not tested**.

| Đường đi | Trạng thái | Ghi chú |
| --- | --- | --- |
| Hợp đồng thiết bị → Worker (burst, chunk, IMU thô, kích hoạt, heartbeat) | Partially verified | Verified với harness thử nghiệm qua HTTP thật tới `wrangler dev`; **Blocked** trên ESP32 (chưa có firmware) |
| Kiểm tra upload (JPEG, kích thước, SHA-256, thứ tự, nhịp, hạn mức, upload dở, thử lại) | Verified | Test Worker |
| Đồng hồ thiết bị: căn theo `uptime_ms` cùng boot, đồng hồ tường sai, độ trễ, khởi động lại | Verified | Test Worker; độ trễ mạng thật **Not tested** |
| IMU thô: lưu, kiểm, idempotent, khoảng hở, lô muộn, xóa theo hạn, đọc lại | Verified | Test Worker + e2e |
| Job: claim nguyên tử, lease, retry, hết hạn, trùng kết quả, release | Verified | Test Worker; agent unit test |
| Agent → Vision thật (24/40 khung, cửa sổ chồng, scrub bộ đệm) | Verified | e2e, khớp tham chiếu gói |
| Agent → Qwen thật (báo cáo ngày, ưu tiên GPU) | Verified | e2e; chạy đồng thời dưới tải dài **Not tested** |
| Hợp nhất `fusion-rules.v2` (13 ca + lệch thời gian, thiếu, trùng, upload dở, đồng hồ, chưa hiệu chỉnh, mâu thuẫn) | Verified | Logic; ngưỡng thật **Blocked** (D11) |
| Cảnh báo tạm thời → còi → thiết bị xác nhận → người chăm sóc → Live Demo | Verified | Chỉ với chính sách thử nghiệm đường đi; với cấu hình mặc định không có cảnh báo (đúng thiết kế) |
| Lời nhắn thoại: tải lên, phiên bản, giao theo lệnh, `Range`, SHA-256, xác nhận phát | Verified | Harness; loa I2S thật **Blocked** |
| Lệnh: ưu tiên, giao lại, hết hạn offline, hủy chờ thiết bị xác nhận, thay thế nhắc lịch | Verified | Test Worker |
| Đăng nhập web + vé stream + quyền viewer/caregiver | Verified | Test Worker + e2e + Chromium |
| Frontend Live Demo hiển thị dữ liệu thật, cập nhật tại chỗ, báo mất kết nối, thao tác cảnh báo qua máy chủ | Verified | Vitest (fake fetch/EventSource) + Chromium với backend thật cục bộ |
| Frontend production không gọi localhost | Verified | Kiểm bundle |
| Deploy Cloudflare (D1/R2/DO/Cron/Rate Limiting thật, CORS qua domain thật) | Blocked | Cần tài khoản; `deploy:dry-run` pass |
| Deploy Vercel + rewrite SPA + kết nối Worker thật | Blocked | Cần tài khoản/dự án Vercel |
| Mạng production (độ trễ, mất gói, SSE qua proxy) | Not tested | Sau khi deploy. Hành vi khi proxy cắt stream sớm: đã kiểm bằng test đơn vị (lùi dần, không xin vé liên tục) |
| Một tài khoản giám khảo dùng chung, nhiều phiên đồng thời | Verified | Test Worker + `wrangler dev` cục bộ với `admin.py` thật (đợt 2); chưa kiểm trên Cloudflare thật |
| Workspace npm gốc và lockfile (D13) | Verified | Lệnh gốc và bản sao sạch (đợt 2); build trên Vercel thật **Blocked** (cần dự án Vercel) |
| Hiệu năng free plan dưới nhịp chụp thật | Not tested | Ước lượng (đã sửa ở đợt 2) trong `backend/care-monitoring/README.md`; IMU 100 Hz liên tục vượt D1 Free. Bảo vệ 507 khi DB lớn: Verified (test Worker) |

## 5. Chặn còn lại

| Chặn | Cần gì | Ai |
| --- | --- | --- |
| Hiệu chỉnh ngã (D11) | Quy tắc hình ảnh và quy tắc IMU đã hiệu chỉnh trên dữ liệu ESP32 thật, kèm `approved_by`, `evidence_ref` | Owner |
| Firmware ESP32 | Viết theo `docs/DEVICE_API.md`; kiểm burst 8 fps, IMU, I2S, khởi động lại, mất mạng | Nhóm phần cứng |
| Tài khoản và tài nguyên | Cloudflare (D1, 2 bucket R2, secret), Vercel, có thể cần phương thức thanh toán cho R2 | Owner |
| Quyết định Proposed | ADR-016…019, D10, D12, A30–A34 | Owner |
| Thời hạn lưu (D08) | Frame (≤ 15 phút), IMU thô (72 h), lời nhắn, quyết định, audit | Owner |
| Gói Cloudflare | Free đủ cho ~1 burst/phút/thiết bị; liên tục cần Workers Paid (A30) | Owner |
| Token Telegram cũ | Thu hồi ở BotFather nếu chưa làm (có trong lịch sử git đã push và trong `backend/care-monitoring/.env`); rồi xóa `.env` | Owner |
| Ảnh đội ngũ | `members/*.jpg` (5 ảnh) đã bị xóa khỏi cây làm việc nhưng `TeamSection.tsx` vẫn đọc chúng: phần đội ngũ trên landing hiện trống. Khôi phục (`git restore members/`) nếu xóa nhầm, hoặc sửa phần đội ngũ và test nếu cố ý (lưu ý AGENTS.md §6 về ảnh người thật) | Owner |

## 6. Lỗi có từ trước (không do thay đổi này)

| Lỗi | Bằng chứng |
| --- | --- |
| `src/features/landing/landing.test.tsx` › "đội ngũ: … đủ năm thành viên …" fail (`expected 5, received 0`) | Fail giống hệt khi chạy với `demoAdapter.ts` gốc (đã thử bằng cách đặt lại tệp gốc tạm thời); thuộc phần landing người dùng đang sửa |
| ~~Lệnh npm ở gốc với `-w @istartup/web` báo "No workspaces found"~~ | Đã sửa ở đợt 2 (D13, Proposed) |
| ~~Câu "Bản demo chưa có máy chủ xác thực…" trên trang đăng nhập~~ | Đã sửa ở đợt 2 theo yêu cầu owner (chỉ hai câu chữ) |
| `e2e/flows.spec.ts` › "AC11: thu hồi quyền có hiệu lực khi người bị thu hồi vào lại" | `src/app/auth.tsx` (không đổi từ `HEAD`) gọi `demo.reset()` trước mỗi lần vào persona, xóa việc thu hồi vừa làm, nên Lan vẫn thấy Bà An |
| `e2e/flows.spec.ts` › "hết phiên đưa về đăng nhập và quay lại đúng trang" | Test gọi `window.__demo?.expireSession()`, nhưng `window.__demo` không tồn tại trong mã nguồn (kể cả `HEAD`), nên phiên không bao giờ hết hạn |
