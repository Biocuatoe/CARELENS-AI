# Trạng thái triển khai đầu-cuối — 2026-10-19

Phạm vi: các thay đổi để chạy được luồng thiết bị thật ↔ backend ↔ agent/Vision ↔ dashboard trên máy dev. Tất cả thay đổi còn **chưa commit**. Ngày 2026-10-20 owner cho triển khai có kiểm soát: Worker production chạy cây làm việc này (bản `934bcb18`, có ADR-025), frontend production `dpl_AvuBn88R…`; xem `docs/PRODUCTION_ROLLOUT_READINESS.md`. Kết quả thử: `docs/E2E_TEST_RESULTS.md`; tiến độ phần cứng: `docs/ESP32_INTEGRATION_PROGRESS.md`; triển khai production: `docs/PRODUCTION_ROLLOUT_READINESS.md`.

## 1. Thành phần đã thay đổi

| Thành phần | Thay đổi | Quyết định |
| --- | --- | --- |
| Firmware (mới) | `firmware/carelens-esp32s3/`: heartbeat, lệnh đủ vòng đời có sổ lệnh NVS, tải âm thanh Range + SHA-256, phát I2S có kiểm, lô IMU thô, burst ảnh, luật kích hoạt (không phải bằng chứng), âm lượng từ xa, lời chào offline, console UART0 (nạp cấu hình, chẩn đoán, `tlscheck`, `wifidrop`), unit test trên PC | ADR-023, ADR-024, A41 |
| Backend | Báo cáo `received`, hạn chờ theo kích thước âm thanh (`ack_deadline_at`), `download_timeout`, đóng lệnh khi khởi động lại (`device_rebooted`), `started` của lệnh có âm thanh chỉ sau `accepted`; âm lượng loa (`PUT /api/admin/v1/devices/{id}/speaker-volume`, `config` trong phản hồi heartbeat, `status.speaker_volume`); migration `0006`, `0007` (chỉ cộng thêm) | ADR-022, ADR-024 |
| Contracts | `command-status.v2`: `received`, `device_rebooted`, `download_timeout`; `device-heartbeat.v2`: `status.speaker_volume` tùy chọn; 2 fixture hợp lệ mới | ADR-022, ADR-024 |
| Frontend | Timeout cho `fetch` (admin 20 s / upload 120 s, người xem 20 s); giữ khóa idempotency khi kết quả gửi chưa rõ, khóa mới sau khi bị từ chối rõ ràng; thông báo "đã gửi" lấy trạng thái mới nhất; kiểm kích thước tệp trước khi đọc; nhãn `received`/`download_timeout`/`device_rebooted`; thẻ "Âm lượng loa"; polling bỏ qua tab ẩn | AUDIT F-1…F-4, ADR-022, ADR-024 |
| Công cụ dev (chỉ cục bộ) | `start_backend.py --dev-admin-email`; `scripts/dev_admin_login.py` (mã đổi phiên admin một lần trong D1 cục bộ); firmware `tools/local_e2e_setup.py`, `local_tls_proxy.py` (chỉ IP LAN, chỉ API thiết bị, chèn lỗi có kiểm soát), `provision.py`, `serial_console.py`, `e2e_failures.py`, `make_greeting.py`, `embed_asset.py`, `run_host_tests.py`; `frontend/e2e/hardware-device.spec.ts` | — |
| Tài liệu | `DEVICE_API.md`, `API_CONTRACT.md`, `DECISIONS.md` (D15, D16, ADR-021…024, A41), `DEPLOYMENT_RUNBOOK.md` §16, `HARDWARE.md`, `FIRMWARE_TOOLCHAIN.md`, `ESP32_READINESS.md`, `DEV_LOCAL.md`, `AGENTS.md` §1 §4, 4 báo cáo mới | — |
| **MP3 (2026-10-20)** — firmware | `carelens-fw-0.2.0`: `src/mp3.{h,cpp}` (duyệt khung + giải từng khung), `src/dr_mp3_impl.c` + `src/third_party/dr_mp3/` (vendored, public domain/MIT-0), `audio` thêm `kMp3` (bộ đệm PSRAM cấp một lần, đo CPU/stack), `cloud` nhận `audio/mpeg`+`mp3` hoặc WAV cũ, so siêu dữ liệu sau SHA-256, báo `audio_codecs` khi máy chủ hỏi; lời chào chuyển sang MP3 (`src/greeting.h`, `greeting_mp3.h`); selftest thêm giải mã đủ lời chào và từ chối tệp cắt cụt; host test MP3 (fixture LAME) | ADR-025 |
| MP3 — backend | `media.ts` `MP3_CONTRACT` + `inspectMp3` (cùng quy tắc với firmware); `voice.ts` chỉ nhận `audio/mpeg` (WAV → 415 `mp3_required`), lưu nguyên tệp `.mp3`, trả đúng `content_type` đã lưu; `commands.ts` codec theo phiên bản lưu, `playbackProblem` (MP3 cần thiết bị báo `mp3`), route tải trả `content_type` thật; heartbeat `config.report_audio_codecs`; capabilities MP3 + `legacy_wav`; sổ thiết bị có `audio_codecs`. Không có migration | ADR-025 |
| MP3 — contracts | `device-heartbeat.v2`: `status.audio_codecs` tùy chọn; fixture hợp lệ `device-heartbeat.v2.audio-codecs.json`, không hợp lệ `…unknown-codec.json` | ADR-025 |
| MP3 — frontend | `features/admin/mp3.ts` (duyệt khung trong trình duyệt, thông điệp tiếng Việt, mô tả định dạng), `idempotency.ts` (tách khỏi `wav.ts` đã xóa), `data/admin/xhrUpload.ts` (tiến độ byte), `adminClient.uploadVoice` gửi `audio/mpeg` nguyên tệp; trang Gửi âm thanh: chỉ MP3, chi tiết tệp, tiến độ, nhãn "WAV (định dạng cũ)", cảnh báo thiết bị chưa báo MP3 | ADR-025 |
| MP3 — agent/harness | Agent không xử lý âm thanh (không đổi). `tools/sample_device.py`: `synthetic_silent_mp3`, heartbeat báo `audio_codecs`; 2 test tích hợp tải MP3 | ADR-025 |
| MP3 — công cụ | `firmware/carelens-esp32s3/tools/make_test_mp3.py` (LAME qua `lameenc`, chỉ khi phát triển), `embed_asset.py` nhúng MP3, `run_host_tests.py` biên dịch dr_mp3 | — |

## 2. File

| Vùng | File |
| --- | --- |
| Firmware | `firmware/carelens-esp32s3/{platformio.ini, README.md, .gitignore}`, `src/{main, config, log, devclock, settings, audio, pcm, wav, mp3, jpeg, ledger, textutil, imu, camera, https, cloud, console}.{h,cpp}`, `src/greeting.h`, `src/greeting_mp3.h` (sinh; thay `greeting_wav.h`), `src/dr_mp3_impl.c`, `src/third_party/dr_mp3/{dr_mp3.h, README.md}`, `assets/greeting_vi_xin_chao_16k.{wav,mp3}`, `test/host/test_main.cpp`, `test/fixtures/mp3/*` (tone tổng hợp), `tools/*.py` |
| MP3 (2026-10-20) | Backend `worker/src/{media, voice, commands, adminComms, adminOps, contracts, index}.ts`, `worker/test/audio.ts` (mới) + `{commands, admin-ops, command-receipts, device-flow, auth, unit, speaker-volume}.test.ts`, `test/helpers.ts`; `scripts/admin.py` (User-Agent); frontend `src/features/admin/{mp3, idempotency, testAudio}.ts` (mới), `wav.ts` (xóa), `AdminMessagesPage.tsx`, `AdminRemindersPage.tsx`, `src/data/admin/{adminClient, adminModels, xhrUpload}.ts`, `src/app/adminAuth.tsx`, test `adminHelpers.test.ts`, `adminDashboard.test.tsx`, `adminDashboardClient.test.ts`, `admin.test.tsx`, `testKit.tsx`, e2e `admin-dashboard.spec.ts`, `hardware-device.spec.ts`; `LoginPage.tsx` (liên kết "Đăng nhập quản trị"); agent `tools/sample_device.py`, `tests/integration/test_e2e_{local_stack, browser_live_demo}.py`, `tests/integration/stack.py` (backend thử tắt `GOOGLE_CLIENT_ID` của production) |
| Backend | `worker/src/{commands, index, contracts, env, adminComms, adminOps}.ts`, `worker/migrations/{0006_command_receipts, 0007_device_speaker_volume}.sql`, `worker/test/{command-receipts, speaker-volume}.test.ts` (mới), `worker/test/commands.test.ts` (3 test cập nhật theo ADR-022), `start_backend.py`, `scripts/dev_admin_login.py` |
| Contracts | `contracts/carelens/{command-status.v2, device-heartbeat.v2}.schema.json` (sinh lại), `fixtures/valid/command-status.v2.{received, failed-device-rebooted}.json` |
| Frontend | `src/data/admin/{adminClient, adminError, adminModels}.ts`, `src/data/demo/demoAdapter.ts`, `src/features/admin/{AdminMessagesPage, AdminDevicesPage, SpeakerVolumeCard, labels}.tsx/ts`, test `adminClient.test.ts`, `adminDashboard.test.tsx`, `e2e/hardware-device.spec.ts` |

## 3. Bí mật và dữ liệu nằm ngoài repo

| Thứ | Ở đâu | Ghi chú |
| --- | --- | --- |
| Wi-Fi, token thiết bị `cld_`, mật khẩu tài khoản xem thử, CA thử nghiệm và khóa | `D:\AI\Cache\carelens-device\` | Không commit, không chia sẻ; Wi-Fi lấy từ bản sao baseline được bảo vệ |
| Token agent `cla_` | `integrations/carelens/local-agent/agent.env` | Git bỏ qua; trỏ backend cục bộ |
| Credential production: token thiết bị, token agent, token admin tĩnh | `D:\AI\Cache\carelens-device\secrets.production.json`, `agent.production.env`, `admin-token.txt` | Ngoài repo; ba credential tách riêng; owner gỡ token admin tĩnh khi xong |
| Token admin cục bộ, liên kết đăng nhập admin một lần | `backend/care-monitoring/worker/.wrangler/` | Git bỏ qua |
| NVS của thiết bị | Bo thật | Không mã hóa (ADR-023) |
| Ảnh camera | R2 cục bộ (tệp của Miniflare trong `worker/.wrangler/state`), xóa sau suy luận hoặc khi phiên upload hết hạn | Chỉ chụp tường trống; không ảnh nào được mở ra xem hay chép ra ngoài; sau mỗi lần thử R2 cục bộ còn 0 đối tượng |

Quét 83 file đã đổi/mới: không chứa mật khẩu Wi-Fi, token thiết bị/agent/admin hay mật khẩu tài khoản xem thử.

## 4. Thật và mô phỏng

| Phần | Nguồn |
| --- | --- |
| Thiết bị, camera, IMU, loa | **Phần cứng thật** (`source_mode: device`) |
| Backend | Worker thật chạy cục bộ (`wrangler dev`), D1/R2/Durable Object cục bộ (Miniflare) |
| HTTPS thiết bị | TLS thật qua proxy LAN với CA thử nghiệm riêng; production: TLS thẳng tới `workers.dev` với bộ chứng chỉ ESP-IDF, trong hai khung giờ thử 2026-10-20 |
| Agent, Vision | Agent thật, Vision server thật trên GPU (`carelens_models_v1_20261018`, chưa hiệu chỉnh) |
| Dashboard | Frontend thật (Vite dev) trong Chromium thật; đăng nhập admin bằng mã đổi phiên cục bộ thay cho Google |
| Lỗi mạng/âm thanh/chunk | Chèn có kiểm soát bởi proxy cục bộ (ghi `FAULT` trong log); Wi-Fi mất do lệnh `wifidrop` của firmware, không đổi router |
| Test tự động Worker/frontend | Môi trường giả lập Workers và mạng giả (không chứng minh production) |
| Production (2026-10-20) | Worker, D1, R2, frontend thật; thiết bị thật; agent thật trên PC; kết quả Vision chưa hiệu chỉnh, không tạo cảnh báo |

## 5. Cách chạy lại

`firmware/carelens-esp32s3/README.md` §"Thử đầu-cuối cục bộ" và `docs/DEV_LOCAL.md` §"Thiết bị thật".
