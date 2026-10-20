# Kiểm kê hệ thống CareLens AI (Prompt 0) — 2026-10-19

Phạm vi: đọc mã, tài liệu, cấu hình; chạy test cục bộ không tác dụng phụ; gọi **chỉ đọc, không token** tới bản deploy công khai. Không sửa mã, không deploy, không migration, không tạo credential, không nạp firmware. Tệp này là thay đổi duy nhất trong working tree.

Quy ước trạng thái: **Đã kiểm chứng** (kèm lệnh/bằng chứng) · **Suy từ mã** (đọc mã, chưa tái hiện bằng chạy) · **Chưa xác minh**.

Mức ưu tiên: **P0** chặn luồng đầu-cuối hoặc lỗi an toàn/bảo mật nghiêm trọng · **P1** sai giao thức hoặc thiếu độ bền, phải sửa trước khi thử phần cứng · **P2** cải thiện, vệ sinh mã/tài liệu.

## 0. Trạng thái Git trước khi kiểm kê

| Mục | Giá trị (đo bằng `git status --porcelain=v1 -b`, `git log`) |
| --- | --- |
| Nhánh | `main`, khớp `origin/main`, working tree sạch |
| Commit gần nhất | `d76a45e admin fe` (18:38 +07:00), `d4a80c9 google auth`, `b9e0497 origin and db id` |
| Nhánh từ xa khác | `origin/claude/quirky-hamilton-f25ob3` |
| Tệp bị bỏ qua đáng chú ý | `backend/care-monitoring/.env` (token Telegram cũ, xem §9.3), `backend/care-monitoring/worker/.dev.vars`, `.vercel/`, `frontend/dist/`, `frontend/test-results/` |

## 1. Kết luận nhanh

1. **Backend, agent và frontend khớp nhau và có test tốt** (Đã kiểm chứng cục bộ: Worker 287/287, agent 38/38, frontend unit 359/361 với 2 lỗi không thuộc phạm vi, Playwright 97 pass/3 bỏ qua với backend giả, xem §10).
2. **Firmware chưa tồn tại trong repo.** Sketch duy nhất tìm thấy nằm **ngoài workspace** (`C:\Users\HLC\Downloads\esp32s3_all_in_one_wav__1_.ino`, 709 dòng, SHA-256 `64271ffe…acb8c`): một web server LAN độc lập, **không gọi backend nào**, không TLS, không token thiết bị, không đồng hồ boot/uptime. Đồng thời có lỗi tràn bộ đệm khi phát WAV mono (§9.1 FW-1) và lộ Wi-Fi/camera không xác thực trên LAN (§9.3).
3. **Production chưa có bảng điều khiển admin (Phase B).** Worker đang chạy trả 404/405 cho mọi route admin mới; trong khi frontend production (Vercel, tự deploy từ `main`) **đã có** khu `/admin`. Thứ tự triển khai runbook §16 (migration → Worker → frontend) đã bị đảo do auto-deploy. Giao diện xử lý được tình huống này (báo "máy chủ chưa hỗ trợ"), nhưng luồng **gửi âm thanh từ Dashboard hiện không chạy được trên production**.
4. **Hai rủi ro giao thức lệnh cần chốt trong Prompt 1** (Suy từ mã, chưa có test): (a) hạn ACK 30 s đếm từ lúc giao, trong khi `accepted` chỉ được gửi sau khi tải xong WAV; tải chậm làm lệnh bị đưa lại hàng đợi và route âm thanh trả 404 giữa chừng; (b) thiết bị khởi động lại khi lệnh ở `accepted`/`started` làm lệnh treo và chặn các lệnh cùng hoặc thấp ưu tiên tới khi hết hạn (tối đa 1 giờ với lời nhắn, 240 phút với nhắc lịch).
5. **Không có đường cảnh báo ngã đơn nguồn** (Đã kiểm chứng: `src/fusion.ts:230` và `/ready` production báo `alerts: none_until_both_rules_are_approved`).
6. **Không biên dịch được firmware từ dòng lệnh trên máy này**: không có `arduino-cli`; PlatformIO có nhưng framework Arduino của nó là 2.0.17, trong khi sketch cần core 3.x (`ESP_I2S.h`). Core 3.3.8 đã có trong Arduino15.

## 2. Kiến trúc thực tế

### 2.1 Thành phần

| Thành phần | Công nghệ (đọc từ mã) | Vị trí | Trạng thái |
| --- | --- | --- | --- |
| Frontend | React 19 + TypeScript + Vite 8 SPA, Tailwind v4, React Router 8, TanStack Query 5, zod 4 | `frontend/` | Production trên Vercel `https://carelens-ai-eta.vercel.app` (đo: bundle `index-an82cNLG.js`, header A40) |
| Client API người xem | `DemoAdapter.backendCall` (`fetch`, Bearer `clc_` trong bộ nhớ, `credentials: "omit"`) | `frontend/src/data/demo/demoAdapter.ts:195-233` | Đăng nhập Google, vé stream, SSE Live Demo, hành động cảnh báo |
| Client API admin | `AdminClient.call` (Bearer `clm_` trong bộ nhớ) | `frontend/src/data/admin/adminClient.ts:224-429` | Bảng điều khiển `/admin` |
| Backend | Cloudflare Worker TypeScript, router regex tự viết, zod, D1, R2 ×2, Durable Object `RealtimeHub`, Cron, Rate Limiting | `backend/care-monitoring/worker/` | Production `https://care-monitoring.care-monitoring-worker.workers.dev` (bản trước Phase B) |
| Agent cục bộ | Python thư viện chuẩn, HTTPS đi ra, kéo job | `integrations/carelens/local-agent/` | Đã chạy với mô hình thật trên backend cục bộ (TEST_REPORT); chưa nối production |
| Vision API | Python `http.server` đơn luồng, R3D-18 (ngã) + YOLO11n (uống nước/thuốc) | `D:\AI\Models\CareLens-VLM\carelens_models_v1_20261018\tools\fit_eps32_server\server.py` (ngoài repo) | `127.0.0.1:8080`, chưa hiệu chỉnh |
| LLM | Ollama, `qwen3:4b-instruct-2507-q4_K_M` | ngoài repo | `127.0.0.1:11434` (đang nghe lúc kiểm kê) |
| Firmware | Arduino core esp32 3.x (theo chú thích sketch) | **Không có trong repo**; sketch ngoài workspace | Chưa tích hợp |
| `backend/api` (FastAPI, ADR-002) | — | chỉ `.gitkeep`, `README.md`, `render.yaml` | Chưa có |

### 2.2 Sơ đồ luồng dữ liệu

```
                    ┌──────────────── Hợp đồng thiết bị v2 (ADR-019) — CHƯA có firmware dùng ────────────────┐
ESP32-S3 CAM        │ HTTPS + Bearer cld_ (mọi body có clock{boot_id, uptime_ms, wall_clock_synced, wall_time}) │
 OV5640 / MPU6050 ──┤  POST /api/device/v1/heartbeat · captures · chunks · complete · imu-batches · imu-events  │
 MAX98357A          │  GET  /api/device/v1/commands/next · /commands/{id}/audio (Range)                       │
                    │  POST /api/device/v1/commands/{id}/status                                               │
                    └──────────────────────────────────────────┬──────────────────────────────────────────────┘
  (Sketch hiện tại: HTTP LAN :81/:82, không xác thực,           ▼
   không gọi backend)                         Cloudflare Worker care-monitoring
                                               ├─ D1: thiết bị, boot, sự kiện, quyết định, cảnh báo, lệnh, IMU thô 72 h, audit
                                               ├─ R2 MEDIA: chunk JPEG, xóa sau suy luận / thất bại / ≤ 900 s (+ lifecycle 1 ngày)
                                               ├─ R2 AUDIO: WAV lời nhắn, giữ tới khi người chăm sóc xóa
                                               ├─ DO RealtimeHub: SSE gợi ý (/recipients/{id}/stream, /api/demo/stream, /api/agent/v1/events)
                                               └─ Cron "* * * * *" (bảo trì, nhắc lịch, hết hạn) + "15 17 * * *" (báo cáo ngày)
                                                         ▲                                   ▲
           HTTPS đi ra, Bearer cla_, lease token         │                                   │ HTTPS, Bearer clc_/clm_ (bộ nhớ),
PC tại nhà: local-agent ─────────────────────────────────┘                                   │ vé cls_ một lần cho EventSource
   ├─ http://127.0.0.1:8080  Vision (fall-check 16/24 khung, object-check 1–24 khung)          │
   └─ http://127.0.0.1:11434 Ollama (báo cáo ngày)                              Trình duyệt (Vercel SPA)
```

## 3. Danh mục tệp liên quan

| Vùng | Tệp chính |
| --- | --- |
| Định tuyến, CORS, lỗi | `worker/src/index.ts` (bảng route 53-189, `/ready` 191-233, fetch/scheduled 241-296), `src/http.ts` (problem+json, `readBody` giới hạn kích thước, CORS) |
| Cấu hình | `worker/wrangler.jsonc`, `src/env.ts` (`loadConfig`, chính sách hợp nhất mặc định), `worker/.dev.vars.example` |
| Xác thực | `src/context.ts` (device/agent/caregiver, `requireRecipient`, audit), `src/adminAuth.ts` (phiên `clm_`), `src/session.ts` (đăng nhập, vé stream), `src/google.ts` (OIDC + PKCE), `src/password.ts` |
| Lệnh, âm thanh, nhắc lịch | `src/commands.ts`, `src/voice.ts`, `src/media.ts` (`inspectWav`, `inspectJpeg`), `src/adminComms.ts`, `src/reminders.ts` |
| Ảnh, IMU, suy luận | `src/captures.ts`, `src/imu.ts`, `src/clock.ts`, `src/jobs.ts`, `src/vision.ts`, `src/fusion.ts`, `src/decisions.ts`, `src/alerts.ts`, `src/maintenance.ts` |
| Live Demo, admin đọc | `src/legacy.ts`, `src/adminOps.ts`, `src/admin.ts` (cấp phát), `src/realtime.ts`, `src/reports.ts` |
| Schema | `src/contracts.ts` → `contracts/carelens/*.schema.json` + `fixtures/valid|invalid` |
| Migration | `worker/migrations/0001…0005` (bảng ở §4.3) |
| Test backend | `worker/test/*.test.ts` (12 tệp) |
| Agent | `local-agent/src/carelens_agent/{cloud,config,vision,frames,runner,summarizer}.py`, `tools/sample_device.py` (harness thiết bị giả, chỉ backend cục bộ) |
| Frontend dữ liệu | `frontend/src/data/demo/demoAdapter.ts`, `src/data/admin/{adminClient,adminModels,adminError}.ts` |
| Frontend admin | `src/features/admin/*` (Messages, Reminders, Devices, Report, Audit, Agents, Login, Overview), `wav.ts`, `useAdminLoad.ts` |
| Triển khai | `frontend/vercel.json` (CSP, header), `frontend/playwright.config.ts`, `docs/DEPLOYMENT_RUNBOOK.md` |
| Cũ, không còn dùng | `frontend/scripts/devBridge.ts`, `frontend/scripts/inject-bridge-url.ts` + `vite.config.ts:14-24`, `frontend/Dockerfile` (trỏ `apps/web`), `cloudbuild-web.yaml`, `frontend/nginx.conf`, `backend/api/render.yaml` |
| Ngoài workspace (chỉ đọc) | Sketch ở Downloads; `Downloads\Phần cứng Carlens AI.txt` (sơ đồ nối dây dạng chữ); `D:\CareLens_Monorepo\firmware\` (PlatformIO cũ: BMI270, WebSocket, core 2.0.14 — kiến trúc khác, không dùng được trực tiếp) |

## 4. Cấu hình, biến môi trường, dữ liệu

### 4.1 URL API, CORS, CSP

| Mục | Giá trị | Nhất quán? |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Đọc **một nơi**: `DEMO_API_BASE` (`demoAdapter.ts:96-99`), `AdminClient` dùng lại (`adminClient.ts:226`). Bản build production không có biến → không kết nối (không rơi về localhost). Dev → `http://127.0.0.1:8787` | Có. Bundle production chứa đúng URL Worker, không có `127.0.0.1:8787` (đo bằng tải bundle) |
| CORS Worker | `ALLOWED_ORIGINS = https://carelens-ai-eta.vercel.app`; header cho phép `Authorization, Content-Type, Idempotency-Key, Last-Event-ID` | Có. Đo: preflight từ origin Vercel → 204 + đúng `access-control-allow-origin`; origin lạ → 403 |
| CSP Vercel | `connect-src 'self' https://care-monitoring.care-monitoring-worker.workers.dev`, `script-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, `media-src 'self' blob:` | Có. Đo trên `/admin/login` production. Đổi URL Worker phải sửa đồng thời `connect-src` (đã ghi ở A40) |
| Header khác | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` tắt camera/micro/vị trí | Đã có trên production |
| Google OAuth | `GOOGLE_CLIENT_ID` (công khai, trong `wrangler.jsonc`), `GOOGLE_REDIRECT_URI` = Worker, `GOOGLE_POST_LOGIN_URL` = Vercel `/login`, secret `GOOGLE_CLIENT_SECRET` | `/ready` production: `google_signin: configured`, `open_viewer_read_only`, `password_sign_in: disabled` |
| Admin | Secret `ADMIN_BOOTSTRAP_EMAILS` (Phase B), `ADMIN_TOKEN_SHA256` (để trống ở production) | Production chạy bản cũ: `admin_api: not_configured`, không có trường `admin_signin` |

### 4.2 Biến Worker quan trọng cho thiết bị (`wrangler.jsonc`)

`MEDIA_MAX_AGE_SECONDS=900`, `UPLOAD_SESSION_TTL_SECONDS=120`, `MAX_CAPTURE_AGE_SECONDS=600`, `FRAMES_PER_CHUNK=8`, `CADENCE_TOLERANCE_MS=40`, `MAX_NORMAL_CAPTURES_PER_HOUR=60`, `MAX_TRIGGERED_CAPTURES_PER_HOUR=20`, `DEVICE_ONLINE_WINDOW_SECONDS=180`, `EMERGENCY_COMMAND_TTL_SECONDS=300`, `IMU_RAW_RETENTION_HOURS=72`, `IMU_MAX_BATCH_AGE_SECONDS=3600`, `IMU_STORAGE_SOFT_LIMIT_MB=400`, `DEVICE_AUDIO_SAMPLE_RATES=16000`, `ACCEPT_SIMULATED_SOURCES=false`. Hằng số trong mã: `ACK_TIMEOUT_SECONDS=30`, `PLAYING_TIMEOUT_SECONDS=600` (`commands.ts:32-33`), giới hạn thiết bị 120 yêu cầu/phút (Rate Limiting binding).

### 4.3 D1 và R2

| Migration | Nội dung | Production |
| --- | --- | --- |
| `0001_initial` | 26 bảng: thiết bị, boot, presence, agent, người chăm sóc, token, vé, grant, capture, IMU, sự kiện, quyết định, cảnh báo, báo cáo, job, âm thanh, nhắc lịch, lệnh, audit, `tx_guard` | Đã áp (runbook) |
| `0002_google_signin`, `0003_google_open_viewers` | `google_identities`, `oauth_states`, `login_exchanges`, `google_viewers` | Đã áp (runbook) |
| `0004_admin_auth` | `admins`, `admin_sessions`, `admin_login_exchanges`, cột `oauth_states.purpose` | **Chưa áp** (runbook §16, khớp đo `/ready`) |
| `0005_admin_ops` | cột `reminder_schedules.paused_at` + 3 chỉ mục | **Chưa áp**. Worker mới chạy trên DB thiếu cột này làm cron nhắc lịch lỗi `no such column` |

Dọn dữ liệu (Suy từ mã, có test cục bộ): chunk R2 xóa ngay khi job hoàn tất/thất bại hẳn/upload dở/quá 900 s (`maintenance.ts:48-87`, tối đa 15 lần xóa mỗi phút); IMU thô xóa sau 72 h theo lô 500; vé, state OAuth, mã đổi phiên xóa sau 1 h; phiên admin giữ 7 ngày sau khi hết hạn. R2 AUDIO không có hạn (D08 Open) và admin chưa có route xóa bản ghi.

## 5. Ma trận endpoint: frontend ↔ backend ↔ thiết bị

Cột "Prod" là kết quả đo chỉ đọc, không token, ngày 2026-10-19 (`curl.exe --tls-max 1.2`); "có" nghĩa là route tồn tại (401/503 thay vì 404/405).

### 5.1 Thiết bị `/api/device/v1` (token `cld_`)

| Route | Backend | Frontend | Sketch hiện tại | Harness `sample_device.py` | Prod |
| --- | --- | --- | --- | --- | --- |
| `POST /heartbeat` | `index.ts:65` | — | Không | Có | có (401) |
| `POST /captures` | `captures.ts:155` | — | Không | Có | chưa đo |
| `GET /captures/{id}` | `captures.ts:386` | — | Không | Không | chưa đo |
| `PUT /captures/{id}/chunks/{i}` | `captures.ts:258` | — | Không | Có | chưa đo |
| `POST /captures/{id}/complete` | `captures.ts:315` | — | Không | Có | chưa đo |
| `POST /imu-batches` | `imu.ts:62` | — | Không | Có | chưa đo |
| `POST /imu-events` | `imu.ts:149` | — | Không | Có | chưa đo |
| `GET /commands/next` | `commands.ts:281` | — | Không | Có | có (401) |
| `GET /commands/{id}/audio` | `commands.ts:367` | — | Không | Có (Range 16 KB) | chưa đo |
| `POST /commands/{id}/status` | `commands.ts:328` | — | Không | Có | chưa đo |

Sketch chỉ có route LAN của chính nó: `:81/stream` (MJPEG), `:82/` (trang HTML có xem camera, ghi video), `:82/capture`, `:82/imu`, `:82/beep`, `:82/hello`, `POST :82/upload`.

### 5.2 Agent `/api/agent/v1` (token `cla_`)

`POST /heartbeat`, `POST /jobs/claim`, `GET /jobs/{id}/media/{i}`, `POST /jobs/{id}/lease|release|complete|fail`, `GET /events`: backend `jobs.ts`, `index.ts:95-107`; agent `cloud.py:106-188` gọi đủ cả 8. Prod: `jobs/claim` có (401). Agent chưa có token production (cần admin API).

### 5.3 Ứng dụng `/api/app/v1` và Live Demo

| Route | Frontend gọi | Prod |
| --- | --- | --- |
| `POST /session` | Có (ẩn khi `password_sign_in=false`) | 403 `password_sign_in_disabled` theo thiết kế (A38) |
| `DELETE /session` | Có | có |
| `GET /auth/google/config` | Có | 200 `{enabled:true, access:"open_viewer", password_sign_in:false}` |
| `GET /auth/google/start` (`?mode=admin`) | Điều hướng toàn trang | có; `mode=admin` cần Phase B |
| `GET /auth/google/callback` | Google gọi | có |
| `POST /session/exchange` | Có | có |
| `POST /stream-tickets` + `GET /api/demo/stream?ticket=` | Có (EventSource) | có |
| `POST /recipients/{rid}/alerts/{id}/actions` | Có (body khớp `AlertActionV1`) | có |
| `GET /me`, `/events`, `/devices`, `/imu-samples`, `/stream`, `/fusion-decisions(+review)`, `/alerts(/{id})`, `/daily-reports(/{date})`, `/reminders` CRUD, `/voice-messages` CRUD, `/devices/{did}/commands`, `/commands/{id}(/cancel)` | **Không** (các màn hình khác vẫn dùng fixture, AGENTS.md §1) | có (bản cũ) |

### 5.4 Admin `/api/admin/v1`

| Nhóm | Route | Frontend | Prod |
| --- | --- | --- | --- |
| Phase B | `POST /session/exchange`, `DELETE /session`, `GET /me` | Có | **Không có** (`/me` → 404) |
| Bảng điều khiển (A40) | `GET /capabilities`, `GET /devices`, `GET /devices/{id}`, `GET /devices/{id}/activity`, `GET|POST /devices/{id}/voice-messages`, `GET /voice-messages/{id}/audio`, `POST /devices/{id}/voice-commands`, `GET /devices/{id}/commands`, `GET /commands/{id}`, `POST /commands/{id}/cancel`, `GET|POST /devices/{id}/reminders`, `POST /reminders/{id}/(pause|resume|cancel)`, `GET /audit` | Có (tất cả) | **Không có** (`/capabilities` → 404, `GET /devices` → 405) |
| Cấp phát (token tĩnh hoặc phiên) | `POST /recipients|devices|agents|caregivers|grants`, `GET /recipients`, `POST /devices/{id}/rotate-token|revoke`, `POST /agents/{id}/revoke`, `POST /caregivers/{id}/login|google`, `POST /google/revoke`, `POST /caregiver-tokens/{id}/revoke`, `POST /grants/{id}/revoke`, `POST /daily-reports/{id}/retry` | Không (chỉ CLI `scripts/admin.py`) | có nhưng 503 `admin_not_configured` (không có token tĩnh, không có Phase B) |
| Trạng thái | `GET /status` | Có | 503 `admin_not_configured` |

### 5.5 Điểm lệch

| ID | Lệch | Giữa | Mức |
| --- | --- | --- | --- |
| L1 | Route admin Phase B + A40 có ở frontend production và backend cục bộ, **không có** ở Worker production | FE ↔ BE prod | P0 cho luồng âm thanh trên prod (vận hành, cần owner) |
| L2 | Toàn bộ hợp đồng thiết bị v2 chưa có phía thiết bị | BE ↔ firmware | P0 |
| L3 | Âm thanh: sketch nhận mono/stereo, mọi tần số, ≤ 2 MiB, lưu FFat cục bộ; backend chỉ mono 16 kHz, 0,5–60 s, ≤ 2,2 MB, tải qua lệnh có SHA-256 | BE ↔ firmware | P1 |
| L4 | IMU: sketch đọc 20 Hz, ±2 g/±250 °/s, gửi ảnh chụp tức thời `{ax…gz, roll, pitch, cam}` không mốc thời gian; hợp đồng cần lô cột `imu-batch.v1` có `uptime_ms` từng mẫu, không nhận góc (fixture `invalid/imu-batch.v1.angle-instead-of-raw.json`) | BE ↔ firmware | P1 |
| L5 | Camera: sketch stream VGA liên tục với chu kỳ 5 s bật/2 s tắt; hợp đồng cần burst liên tục 24/40 khung ở 8 fps (125 ± 40 ms), cấu hình Vision nói rõ 24 khung lấy từ **bộ đệm vòng trước kích hoạt** | BE/Vision ↔ firmware | P1 |
| L6 | Thời gian: sketch không có `boot_id`, `uptime_ms` 64-bit, SNTP | BE ↔ firmware | P1 |
| L7 | Ngữ nghĩa `accepted` (sau khi tải và kiểm SHA-256) xung đột với hạn ACK 30 s (§9.2 R-1) | Hợp đồng ↔ BE | P1 |

## 6. Luồng phát âm thanh (Dashboard → ESP32 → ACK)

| Bước | Thực hiện | Bằng chứng | Ghi chú |
| --- | --- | --- | --- |
| 1. Chọn/tải WAV | `UploadForm` kiểm trước bằng `wav.ts inspectWav` theo `/capabilities`, rồi `POST /api/admin/v1/devices/{id}/voice-messages?title=` thân `audio/wav` | `AdminMessagesPage.tsx:58-132`; test `admin-ops.test.ts:335-378` | Máy chủ là nơi quyết định (`media.ts:96-135`: RIFF/PCM/mono/16-bit/tần số/0,5–60 s/≤ 2,2 MB/`blockAlign=2`). Upload không có idempotency (chỉ khóa nút khi đang gửi) |
| 2. Metadata | `audio_assets` + `audio_asset_versions` (khóa R2 bất biến `voice/<rid>/<asset>/v<n>.wav`, SHA-256, thời lượng) | `voice.ts:110-133` | R2 lưu trước, D1 sau; lỗi D1 thì xóa object |
| 3. Chọn thiết bị, xác nhận | Hộp thoại xác nhận, khóa idempotency sinh khi mở hộp thoại, máy chủ bắt buộc `confirm: true` | `AdminMessagesPage.tsx:236-250, 325, 340-364`; `adminComms.ts:104-120` | Giới hạn 20 thay đổi/phút/admin đếm từ `audit_log` |
| 4. Tạo lệnh | `play_voice_message`, ưu tiên 40, `expires_in_seconds` 30–3600, `ON CONFLICT (idempotency_key) DO NOTHING`, khóa gắn tiền tố `admin:<id>:` | `commands.ts:417-478` | Lặp cùng khóa → 200 `created:false`; khác nội dung → 409 |
| 5. Theo dõi trạng thái | Frontend hỏi lại `GET /devices/{id}/commands` mỗi 5 s khi còn lệnh chưa kết thúc | `AdminMessagesPage.tsx:180-217` | Không dùng SSE cho admin. Hộp "Lệnh đã được máy chủ nhận" giữ nguyên trạng thái lúc tạo (§9.2 F-3) |
| 6. Thiết bị nhận | `GET /commands/next`: dọn hạn, giao lệnh ưu tiên cao nhất **cao hơn** mọi lệnh đang hoạt động, trả `expires_in_ms` để thiết bị tính hạn bằng đồng hồ đơn điệu, kèm `cancel_command_ids` | `commands.ts:281-309` | Giao ít nhất một lần: chưa `accepted` sau 30 s thì giao lại cùng `command_id`, tối đa 3 lần |
| 7. Tải âm thanh | `GET /commands/{id}/audio` (Range → 206, header `x-content-sha256`) chỉ khi lệnh `delivered/accepted/started` và chưa hết hạn | `commands.ts:367-397`; test `commands.test.ts:108-139` | Không có URL công khai; bucket riêng tư |
| 8. Thực thi | **Chưa có firmware.** Hợp đồng: kiểm SHA-256, không phát lệnh trùng, không phát khi quá hạn | `DEVICE_API.md` §8.2 | Sketch hiện chỉ phát `hello.wav` cục bộ khi gọi `/hello` |
| 9. ACK | `POST /commands/{id}/status`: `accepted`, `started`, `completed`, `failed`/`rejected` (bắt buộc `reason_code`), `cancelled` (chỉ sau yêu cầu hủy). Lặp cùng trạng thái → `duplicate:true`; chuyển sai/hết hạn → 409 `invalid_transition` + `stop_playback` | `commands.ts:311-363`; test `commands.test.ts:142-226` | Không lùi trạng thái. Không cập nhật trạng thái và dòng thời gian trong cùng một batch (§9.2 R-3) |
| 10. Dashboard | `played_confirmed_by_device = (status === "completed")`; nhãn "Chưa có xác nhận phát xong từ thiết bị — không được coi là đã phát" | `commands.ts:253-277`; `AdminMessagesPage.tsx:162-166`; `labels.ts:24-36` | Đúng yêu cầu "không báo đã phát trước khi có xác nhận" |

Giới hạn thời gian ngầm: lệnh `started` quá 600 s không có kết thúc → `failed` (`no_completion_report`); hết hạn ở `queued/delivered/accepted` → `expired`, không bao giờ giao lại.

## 7. Luồng camera / IMU / Vision

| Bước | Hợp đồng và mã | Giới hạn | Ghi chú |
| --- | --- | --- | --- |
| Manifest burst | `POST /captures` (`capture-session.v2`): 24 khung `normal` hoặc 40 `triggered`, 8 fps, `seq` 0…n−1, `uptime_ms` tăng nghiêm ngặt, ≤ 640×480, khung ≤ 200 000 B, burst ≤ 60 s, không cũ hơn 600 s, `source_mode=device` | manifest ≤ 32 KB; 60 burst thường/giờ, 20 kích hoạt/giờ (429) | Idempotent theo `(device_id, capture_id)`, hash bỏ `clock.uptime_ms` |
| Chunk | `PUT …/chunks/{i}`, `application/octet-stream`, `[uint32 LE độ dài][JPEG]` × 8 khung; kiểm độ dài, JPEG, kích thước, SHA-256 từng khung | ≤ 8 × 200 004 B | Gửi lại → `duplicate:true`; phiên upload 120 s |
| Hoàn tất | `POST …/complete` → job `vision` (ưu tiên 100/50), hết hạn cùng media | — | Thiếu chunk → 409 `chunks_missing` |
| Lưu và xóa | R2 `MEDIA` riêng tư; xóa khi job xong/thất bại hẳn/quá 900 s | Cron mỗi phút, ≤ 15 capture/lần | Agent tắt > 15 phút → burst mất (không xếp hàng dài hạn) |
| Agent → Vision | Giới hạn **đã xác minh từ server thật** (`config/stage2_f6_server_v2.json`): fall-check 16 hoặc 24 khung, object-check 1–24, khung ≤ 200 000 B, thân ≤ 4 900 000 B, JPEG ≤ 640×480, timeout socket 10 s, đơn luồng, mặc định `127.0.0.1`. Burst 40 khung chia cửa sổ 0–23, 8–31, 16–39 | Agent: timeout Vision 30 s, backend 20 s | Agent xóa ảnh khỏi predictor sau object-check bằng khung xám (`vision.py:96-107`) |
| IMU thô | `POST /imu-batches` (`imu-batch.v1`): 1–1000 mẫu, ≤ 120 s, đơn vị g, °/s, ms từ boot; dải ±5 %; `batch_seq` idempotent theo boot | 256 KB; 507 khi D1 > 400 MB | Cờ chất lượng: hở, lệch nhịp, chạm dải đo, thiếu lô |
| Kích hoạt | `POST /imu-events` (`imu-event.v2`) chỉ mở quyết định, không phải bằng chứng | 16 KB | — |
| Hợp nhất | `fusion-rules.v2`: chỉ `suspected_fall` khi cả quy tắc hình ảnh và quy tắc IMU khớp và căn thời gian trong cùng `boot_id` | — | Mặc định cả hai quy tắc `null` → không cảnh báo (D11) |
| Agent offline / timeout | Lease hết hạn → retry 5/15/45 s, tối đa 3 lượt; quá `expires_at` → `expired`, media xóa, quyết định chuyển `processing_failed`/`not_enough_data` | — | Không bao giờ giả kết quả suy luận |

## 8. Firmware và phần cứng (ngoài workspace)

### 8.1 Sketch `esp32s3_all_in_one_wav__1_.ino` (đọc, không biên dịch, không nạp)

| Mục | Trong sketch | Theo hợp đồng / cần xác minh |
| --- | --- | --- |
| Board, framework | Chú thích: ESP32-S3 N16R8, Arduino core esp32 3.x, "ESP32S3 Dev Module", OPI PSRAM, Flash 16 MB, phân vùng "16M Flash (3MB APP/9.9MB FATFS)", USB CDC on Boot bật | Tên tùy chọn khớp `boards.txt` core 3.3.8: `esp32:esp32:esp32s3`, `PSRAM=opi`, `FlashSize=16M`, `PartitionScheme=app3M_fat9M_16MB`, `CDCOnBoot=cdc`. Model bo cụ thể (nhà sản xuất, revision) **chưa biết** |
| Camera OV5640 | XCLK 15, SIOD 4, SIOC 5, D0–D7 = 11, 9, 8, 10, 12, 18, 17, 16, VSYNC 6, HREF 7, PCLK 13, PWDN/RESET −1; XCLK 10 MHz; VGA, JPEG q12, 2 fb trong PSRAM, `GRAB_LATEST` | Trùng bố trí ESP32-S3-EYE/Freenove ESP32-S3 CAM, nhưng **chưa xác minh** với bo thật. Chu kỳ tắt camera 2 s cần bỏ hoặc đo lại (L5) |
| MPU6050 | I2C SDA 47, SCL 21, 400 kHz, 0x68; chỉ đánh thức (0x6B=0) → mặc định ±2 g, ±250 °/s, không đặt DLPF/SMPLRT; đọc 20 Hz bằng `vTaskDelay(50)` | Khớp `Phần cứng Carlens AI.txt`. Cần ±8/±16 g cho va chạm, nhịp ổn định có mốc `uptime_ms` từng mẫu, bộ đệm vòng |
| MAX98357A | I2S BCLK 41, LRC 42, DIN 1; stereo 16-bit, nhân âm lượng 0,25 | Khớp tệp nối dây. Chân SD/GAIN không nối (mặc định gain 9 dB, trộn (L+R)/2) — công suất thực vào loa 8 Ω/1 W ở VIN 5 V **chưa đo** |
| Nguồn | LiPo 2000 mAh → TP4056 → boost 5 V → chân 5 V ESP32 và VIN MAX98357A; MPU6050 từ 3V3 | Không đo được pin (không có chân ADC chia áp) → firmware không được báo mức pin (AGENTS.md §6). Sụt áp khi camera + Wi-Fi + loa cùng chạy **chưa đo** |
| Mạng | Wi-Fi STA, SSID/mật khẩu **viết cứng ở dòng 29–30** (không chép lại ở đây); không được thì phát AP mật khẩu cố định yếu (dòng 666-667) | Hợp đồng: chỉ HTTPS tới Worker, kiểm chứng chỉ, SNTP trước yêu cầu đầu tiên, token `cld_` trong NVS mã hóa |
| HTTP | Hai `esp_http_server` (:81, :82), không xác thực, `Access-Control-Allow-Origin: *` | Hợp đồng không cần server trên thiết bị |

GPIO: 41/42 là chân JTAG (MTDI/MTMS) — dùng được khi không debug JTAG; không đụng chân strapping 0/3/45/46, USB 19/20, PSRAM OPI 33–37. Camera SCCB (4/5) và `Wire` (47/21) là hai bus riêng; cổng I2C phần cứng mà driver camera dùng so với `Wire` (port 0) **cần xác minh** để tránh tranh chấp.

### 8.2 Công cụ build trên máy

| Công cụ | Trạng thái (đo) |
| --- | --- |
| Arduino core esp32 | 3.3.8 trong `%LOCALAPPDATA%\Arduino15` |
| `arduino-cli` | Không có (chỉ có bộ cài Arduino IDE 2.3.10 trong Downloads) |
| PlatformIO | 6.1.19, nền `espressif32`, toolchain xtensa-esp32s3; framework Arduino **2.0.17** (`3.20017…`) — không có `ESP_I2S.h` của core 3.x |

## 9. Lỗi và rủi ro

### 9.1 Firmware (sketch ngoài workspace)

| ID | Mức | Phát hiện | Bằng chứng | Trạng thái |
| --- | --- | --- | --- | --- |
| FW-1 | **P0** | `playWav()` tràn bộ đệm ngăn xếp với WAV **mono** (đúng định dạng khuyến nghị và định dạng hợp đồng): `raw[1024]` → `frames = 512`, ghi `out[2*i+1]` tới chỉ số 1023 trong khi `int16_t out[512]`, rồi `i2s.write(out, frames*4)` đọc 2048 byte từ mảng 1024 byte | sketch dòng 204-219 | Suy từ mã; chưa chạy trên thiết bị. Hành vi không xác định (hỏng ngăn xếp, khởi động lại) |
| FW-2 | **P0** | Không có tích hợp backend (HTTPS, token, heartbeat, poll, ACK, upload ảnh, lô IMU, SNTP, `boot_id`/`uptime_ms`) | toàn bộ sketch | Đã kiểm (đọc mã) |
| FW-3 | P1 | Chu kỳ tắt camera 5 s/2 s làm mất khung sự kiện; không có bộ đệm vòng trước kích hoạt | dòng 64-67, 230-242 | Suy từ mã |
| FW-4 | P1 | IMU 20 Hz không ổn định (delay sau đọc), ±2 g dễ bão hòa, không mốc thời gian, chỉ giữ một mẫu, tính roll/pitch | dòng 80-103, 654-659 | Suy từ mã |
| FW-5 | P2 | `stream_handler` lặp vô hạn khi client ngắt lúc camera nghỉ; `upload_handler` lặp mãi khi timeout socket | dòng 249-251, 319-321 | Suy từ mã |
| FW-6 | P2 | Không giới hạn âm lượng phần cứng (GAIN/SD) và không kiểm tần số WAV trước khi đổi I2S giữa chừng | dòng 106-114, 194-225 | Suy từ mã |

### 9.2 Backend, giao thức, frontend

| ID | Mức | Phát hiện | Bằng chứng | Trạng thái |
| --- | --- | --- | --- | --- |
| R-1 | **P1** | Hạn ACK 30 s (`ACK_TIMEOUT_SECONDS`) tính từ `delivered_at`, nhưng hợp đồng chỉ cho gửi `accepted` sau khi tải xong và kiểm SHA-256. Tải chậm hơn 30 s: nếu cron (mỗi phút) chạy trước, lệnh về `queued` và route âm thanh trả 404 giữa chừng (`status IN ACTIVE`) tới lần poll kế; nếu thiết bị poll song song, lệnh được giao lại ngay với cùng `command_id`. Mỗi lần giao lại tốn một lượt; sau 3 lượt (≈ 90 s) → `failed no_acknowledgement` dù thiết bị vẫn đang tải. WAV 60 s ≈ 1,92 MB | `commands.ts:32, 170-176, 369`; `DEVICE_API.md` §8.2 bảng `accepted` | Suy từ mã; không test nào phủ (harness tải xong ngay rồi mới `accepted`) |
| R-2 | **P1** | Thiết bị khởi động lại khi lệnh ở `accepted`/`started`: máy chủ không dùng `boot_id` mới để đóng lệnh của boot cũ; lệnh `accepted` chờ tới `expires_at` (lời nhắn ≤ 1 h, nhắc lịch ≤ 240 phút), `started` chờ 600 s, và trong thời gian đó **chặn mọi lệnh cùng/thấp ưu tiên** (`priority > MAX(active)`). Không có mã lý do kiểu `device_rebooted` | `clock.ts:31-58`; `commands.ts:158-184, 292`; `COMMAND_REASON_CODES` | Suy từ mã; không có test |
| R-3 | P2 | Cập nhật trạng thái lệnh và ghi `device_command_events` ở hai batch riêng; `/commands/next` đánh dấu `delivered` trước khi ghi sự kiện. Lỗi D1 giữa hai batch → trạng thái đúng nhưng thiếu dòng thời gian | `commands.ts:284-306, 342-360` | Suy từ mã |
| R-4 | P2 | Thiết bị bỏ qua `started` (chỉ `accepted` → `completed`) mà phát qua hạn chót: dọn hạn chuyển `accepted` → `expired` trước, nên `completed` bị 409 dù loa đã phát. Hợp đồng cần ghi rõ "phải gửi `started` trước khi phát" | `commands.ts:165-168, 336` | Suy từ mã |
| R-5 | P2 | Lặp lại cùng `idempotency_key` sau khi lời nhắn được thay phiên bản → 409 `idempotency_key_reused` (payload so cả `version`) | `commands.ts:441, 473` | Suy từ mã |
| R-6 | P2 | `pending_commands` của heartbeat đếm cả lệnh `queued` chưa giao được vì đang có lệnh ưu tiên bằng/cao hơn → thiết bị poll thừa | `index.ts:74` | Suy từ mã |
| R-7 | P2 | CPU 10 ms/lần gọi của Workers Free khi kiểm SHA-256 + header JPEG cho chunk 8 khung (tới 1,6 MB) | `captures.ts:278-290` | Chưa xác minh trên Cloudflare (đã ghi ở `DEVICE_API.md` §11) |
| F-1 | P2 | Không có timeout cho `fetch` ở cả hai client (không `AbortController`): request treo làm nút "Đang gửi…"/trạng thái tải đứng mãi | `adminClient.ts:245`; `demoAdapter.ts:210` | Đã kiểm (`git grep AbortController` không có kết quả trong `src/data`) |
| F-2 | P2 | Gửi lệnh lỗi mạng (kết quả không chắc chắn) → người dùng đóng hộp thoại và mở lại sinh khóa mới → có thể tạo lệnh thứ hai. Thông báo "Không gửi được lệnh" có thể sai nếu máy chủ đã lưu | `AdminMessagesPage.tsx:236-250, 325` | Suy từ mã |
| F-3 | P2 | Thông báo "Trạng thái hiện tại: …" sau khi gửi giữ trạng thái lúc tạo (`queued`), không cập nhật cùng danh sách bên dưới | `AdminMessagesPage.tsx:331-335` | Suy từ mã |
| F-4 | P2 | Đọc toàn bộ tệp vào bộ nhớ trước khi kiểm kích thước (`f.size` kiểm được trước) | `AdminMessagesPage.tsx:67-80` | Suy từ mã |
| F-5 | P2 | Mã cũ của demo-bridge Telegram còn lại (ADR-014 nói đã gỡ): plugin chèn `<script>` inline nếu đặt `VITE_BRIDGE_PUBLIC_URL` (CSP sẽ chặn), `devBridge.ts` nối `ws://localhost:8080/ws` (trùng cổng Vision); `frontend/Dockerfile` trỏ `apps/web` (hỏng) | `vite.config.ts:14-24`; `scripts/inject-bridge-url.ts`; `scripts/devBridge.ts:21`; `Dockerfile:11` | Đã kiểm: không còn được import |
| O-1 | P1 (vận hành) | Frontend có khu admin đã lên production trước Worker Phase B và migration 0004/0005 (tự deploy khi push `main`) | Đo: header A40 + bundle có `voice-commands`, `admin/login`; Worker `/api/admin/v1/me` 404 | Đã kiểm chứng (chỉ đọc) |

### 9.3 Bảo mật

| ID | Mức | Phát hiện | Ghi chú |
| --- | --- | --- | --- |
| S-1 | **P0** | Sketch: SSID/mật khẩu Wi-Fi viết cứng; AP dự phòng mật khẩu cố định yếu; camera stream/chụp ảnh/tải WAV/phát loa **không xác thực** trên LAN, kèm `Access-Control-Allow-Origin: *` (trang web bất kỳ mà người trong LAN mở có thể đọc ảnh nếu biết IP, trong giới hạn chặn mixed-content/Private Network Access của trình duyệt). Trang `:82/` có xem và ghi video — trái AGENTS.md §6 "không trang camera" | Không dùng sketch này ở nơi có người thật. Mật khẩu Wi-Fi nằm trong tệp ngoài repo: nên đổi nếu đã chia sẻ tệp |
| S-2 | P1 (đã biết) | Token Telegram dạng thật trong lịch sử đã push (`e9d9b67`) và trong `backend/care-monitoring/.env` (bị git bỏ qua) | Runbook §1: owner thu hồi ở BotFather; viết lại lịch sử là quyết định riêng |
| S-3 | P2 | Tệp `client_secret_*.json` của Google OAuth nằm trong Downloads (không đọc) | Nên xóa sau khi secret đã nằm trong Worker; không bao giờ chép vào repo |
| S-4 | P2 (đã biết, A39/A40) | Token phiên web/admin là Bearer trong bộ nhớ: XSS đọc được; CSP giảm nhưng không loại bỏ | Đánh đổi đã ghi, cần thiết kế cookie HttpOnly nếu muốn đổi |
| S-5 | Không phát hiện vấn đề | Backend: token 256 bit chỉ lưu SHA-256; so khớp hằng thời gian cho token tĩnh; `device_id` body phải khớp credential; hồ sơ lấy từ credential; quyền kiểm ở máy chủ (`requireRecipient`); Google OIDC đủ state/cookie/PKCE/nonce/RS256/iss/aud/exp; vé stream dùng một lần; lỗi không lộ stack; log chỉ id và mã | Suy từ mã + test Worker |

### 9.4 Mâu thuẫn tài liệu (đề xuất ghi vào `docs/DECISIONS.md` ở Prompt 1)

| Chỗ | Nội dung lệch |
| --- | --- |
| `DEPLOYMENT_RUNBOOK.md:13` vs `ESP32_READINESS.md:11` | Runbook: "chưa có lần đăng nhập Google thật nào hoàn tất"; readiness: đã có một lần thành công (audit production) |
| `AGENTS.md` §1 "Đăng nhập trên bản deploy" | Nói Google "chưa hoạt động cho tới khi owner đặt `GOOGLE_CLIENT_ID`"; `/ready` production (đo) báo `google_signin: configured` |
| `API_CONTRACT.md:3` | "chưa deploy" trong khi bản trước Phase B đã deploy |
| `ESP32_READINESS.md` §9 | "không có mã firmware nào trong repo" vẫn đúng, nhưng chưa nhắc sketch ngoài repo và sơ đồ nối dây owner đã có |

## 10. Test hiện có và kết quả thực chạy

| Bộ | Lệnh | Môi trường | Kết quả |
| --- | --- | --- | --- |
| Worker unit/integration | `cd backend/care-monitoring/worker && npm test` | Vitest 5 + `@cloudflare/vitest-plugin`, Miniflare cục bộ (D1/R2/DO giả lập trong runtime Workers), không mạng | **12 tệp, 287/287 pass** (17,5 s) |
| Worker typecheck | `npm run typecheck` | tsc 6 | Pass |
| Contract | `npm run contracts:check` | Node 24 | Pass (JSON Schema khớp `contracts.ts`) |
| Bundle deploy | `npm run deploy:dry-run` | wrangler 4.151.1, không tài khoản | Pass (1103 KiB, gzip 201 KiB, đủ binding) |
| Agent | `cd integrations/carelens/local-agent && python -m pytest -q` | Python 3.11.9, không mạng, bỏ marker `e2e` | **38 pass, 11 deselected** (e2e cần stack thật) |
| Frontend typecheck | `npm run typecheck` | tsc 6 | Pass |
| Frontend lint | `npm run lint` | ESLint 10 | Pass |
| Frontend unit | `npm test` | Vitest 5 + jsdom | **359/361**. Lỗi 1: `landing.test.tsx` "đội ngũ" — có từ trước (ảnh `members/*.jpg` không có trong repo, TEST_REPORT §5). Lỗi 2: `enclosure.test.ts` timeout 5 s khi chạy song song với hai bộ khác; **chạy riêng 6/6 pass** → nhạy tải, không phải hồi quy |
| Frontend build | `npm run build` (`tsc -b && vite build`) | Vite 8, không có `VITE_API_BASE_URL` | Pass. Lưu ý: bản build này ghi vào `frontend/dist/` (bị git bỏ qua) rồi bị bản build của e2e ghi đè |
| Frontend e2e | `npm run test:e2e` | Playwright Chromium, bản build với backend **giả ở tầng mạng** (`e2e/helpers.ts`), không gọi backend thật | **97 pass, 3 skipped, 0 fail** (28,3 phút). 3 test bỏ qua là `live-demo-backend.spec.ts` (chỉ chạy khi đặt `E2E_LIVE_BACKEND_URL`). Đây là mock có chủ đích, không chứng minh tích hợp với Worker thật |
| Agent e2e với mô hình thật | `python -m pytest -m e2e tests/integration -q` | Cần Vision + Ollama + `wrangler dev` | **Không chạy** trong lượt này (nặng GPU; TEST_REPORT ghi 11/11 hôm nay) |
| Firmware | — | — | **Không có** test và không biên dịch được từ CLI (§8.2) |
| Production (chỉ đọc) | `curl.exe --tls-max 1.2` GET `/health`, `/ready`, route không token, header Vercel, preflight CORS | Internet | Kết quả ở §4.1, §5 |

## 11. Chưa thể xác minh

- Bất kỳ hành vi nào trên ESP32 thật: camera 8 fps, kích thước JPEG, PSRAM cho 40 khung, MPU6050 thật, I2S, TLS mbedTLS với chuỗi ECDSA của `workers.dev`, SNTP, sụt áp nguồn, mất điện giữa chừng.
- Model bo ESP32-S3 CAM chính xác và revision; pinout camera chỉ khớp một bố trí phổ biến.
- Biên dịch sketch (thiếu `arduino-cli`; PlatformIO dùng core 2.0.17).
- Worker Phase B, migration 0004/0005, cron nhắc lịch, đăng nhập admin bằng Google thật trên production.
- Agent nối production (chứng chỉ gốc Windows hết hạn — ESP32_READINESS §4; chưa có token `cla_`).
- CPU 10 ms của Workers Free cho chunk ảnh; dung lượng D1 với nhịp IMU thật.
- Tải WAV qua HTTPS trên ESP32 mất bao lâu (quyết định mức nghiêm trọng của R-1).

## 12. Thứ tự sửa đề xuất

| Ưu tiên | Việc | Prompt |
| --- | --- | --- |
| P0 | Firmware mới theo hợp đồng v2 (FW-2), không mang theo lỗi FW-1 và cấu hình S-1 | 4 |
| P0 | Owner quyết định và thực hiện triển khai Phase B theo runbook §16 (migration 0004/0005 → Worker → kiểm frontend) để luồng âm thanh admin chạy trên production (L1, O-1) | ngoài code, cần owner |
| P0 | Owner cung cấp model bo chính xác (và ảnh/sơ đồ chân) để xác minh pinout trước khi viết firmware phần cứng | 4 |
| P1 | Chốt ngữ nghĩa ACK/tải âm thanh (R-1) và xử lý khởi động lại (R-2) trong hợp đồng, rồi sửa backend + test | 1 → 2 |
| P1 | IMU ±8/16 g, nhịp ổn định, mốc từng mẫu, bộ đệm vòng; camera burst liên tục 8 fps có bộ đệm trước kích hoạt (FW-3, FW-4) | 4 |
| P1 | Thu hồi token Telegram (S-2) | owner |
| P2 | Timeout `fetch`, khóa idempotency sau lỗi không chắc chắn, thông báo trạng thái cập nhật, kiểm `f.size` (F-1…F-4) | 3 |
| P2 | Gộp cập nhật trạng thái lệnh và dòng thời gian vào một batch (R-3); ghi rõ yêu cầu `started` (R-4); R-5, R-6 | 2 |
| P2 | Dọn mã bridge cũ, Dockerfile/cloudbuild hỏng (F-5) — cần owner đồng ý vì có thể là di sản muốn giữ | 6 |
| P2 | Sửa mâu thuẫn tài liệu (§9.4) | 1 |

## 13. Kế hoạch các prompt tiếp theo (điều chỉnh theo thực tế)

| Prompt | Phạm vi thực tế | Điều kiện bắt đầu |
| --- | --- | --- |
| 1 — Hợp đồng | Hợp đồng đã đầy đủ (`API_CONTRACT.md`, `DEVICE_API.md`, `contracts/`). Việc còn lại: quyết định R-1 (ví dụ tách "đã nhận" khỏi "đã tải xong", hoặc hạn ACK riêng cho lệnh có âm thanh, hoặc cho phép tải tiếp khi giao lại), R-2 (đóng lệnh của `boot_id` cũ, thêm mã lý do), ghi yêu cầu `started` (R-4), cập nhật tương thích ngược, ghi ADR/mâu thuẫn vào `DECISIONS.md`. **Không cần endpoint mới** cho luồng âm thanh | Owner trả lời câu hỏi §14 |
| 2 — Backend | Sửa theo quyết định Prompt 1 + test (khởi động lại, tải chậm, ACK trùng/sai thứ tự, poll đồng thời, lỗi D1 giữa batch). Có thể cần migration `0006` nếu thêm cột/mã lý do (CHECK của SQLite không sửa tại chỗ) | Prompt 1 xong |
| 3 — Frontend | F-1…F-4; giữ bố cục; test cho 401/403/404/409/429/500, offline, bấm trùng | Song song với 2 |
| 4 — Firmware | Dự án firmware mới trong repo (đề xuất `firmware/esp32s3-carelens/`, cần ADR), Arduino core 3.x qua `arduino-cli` hoặc PlatformIO với nền core 3.x (cần owner chọn và cho cài công cụ). Module: cấu hình/NVS, Wi-Fi, SNTP, HTTPS + CA, heartbeat, poll + máy trạng thái lệnh, trình phát WAV streaming, camera burst + bộ đệm vòng, IMU + bộ đệm vòng, hàng đợi upload | Board chính xác + pinout xác minh; quyết định công cụ build |
| 5 — Tích hợp | Mở rộng harness `sample_device.py`/test Worker cho các ca mới; test hợp đồng giữa firmware (phần giao thức chạy được trên PC) và backend | 2, 4 |
| 6 — Rà soát | Bảo mật, hồi quy, bộ nhớ firmware | 2–5 |
| 7 — Đóng gói | `.bin` (app + bootloader + partition, merged nếu được), SHA-256, hướng dẫn nạp | 4–6 đạt, có board |

## 14. Câu hỏi cần owner trả lời trước Prompt 1/4

1. Model bo ESP32-S3 CAM chính xác (tên, nhà sản xuất, ảnh mặt trước/sau hoặc link sản phẩm)? Pinout camera trong sketch có phải đã chạy được trên đúng bo này không?
2. Sketch ở Downloads có phải "tệp `.ino` được cung cấp" cho dự án không, và đã từng chạy ổn định trên thiết bị (camera, MPU6050, loa) chưa?
3. MPU6050 gắn trên người (đeo) hay cố định trong phòng? (quyết định dải đo và ý nghĩa quy tắc IMU, D11)
4. Công cụ build firmware: cài `arduino-cli` (dùng core 3.3.8 đã có) hay dùng PlatformIO với nền core 3.x? Có cho phép cài công cụ trên máy này không?
5. Có triển khai Phase B (migration 0004/0005 + Worker mới) lên production trước khi thử phần cứng không? Ai chạy và khi nào (runbook §16)?
6. R-1: chấp nhận đổi ngữ nghĩa `accepted` (thiết bị báo ngay khi nhận lệnh, kiểm SHA-256 trước `started`) hay giữ nguyên và tăng hạn ACK cho lệnh có âm thanh?

## 15. Cập nhật sau báo cáo (cùng ngày, sau câu trả lời của owner)

Phần trên giữ nguyên như lúc kiểm kê. Những điểm đã thay đổi:

| Mục của báo cáo | Cập nhật |
| --- | --- |
| §8.1, §14 câu 1–3 | Owner: module ESP32-S3-WROOM N16R8 + OV5640, bo mang chưa xác định; sketch đã chạy được trên bo (baseline); nối dây nguồn/MPU6050/MAX98357A đã cung cấp; **toàn bộ thiết bị trong một hộp đeo trên ngực**. Ghi ở `docs/HARDWARE.md`, `docs/DECISIONS.md` D14 |
| §8.2, §11 "biên dịch sketch" | Đã build được bản sao `.cpp` của sketch bằng PlatformIO + pioarduino `55.03.38-1` (core 3.3.8), cấu hình khớp Arduino IDE; chưa nạp. `docs/FIRMWARE_TOOLCHAIN.md`, ADR-021 |
| §9.2 R-1, R-2; §14 câu 6 | Owner giữ nguyên ngữ nghĩa trạng thái hiện có. Giới hạn hợp đồng và đề xuất tương thích ngược ở D15 / ADR-022, **chưa triển khai**, chờ duyệt |
| §12 hàng "Owner quyết định triển khai Phase B" | Owner: chưa deploy, chưa áp 0004/0005. Kế hoạch rollout và diễn tập migration cục bộ ở `docs/DEPLOYMENT_RUNBOOK.md` §16–§16.1 |
| §9.4 mâu thuẫn tài liệu | Đã sửa trong `AGENTS.md` §1, `docs/API_CONTRACT.md`, `docs/DEPLOYMENT_RUNBOOK.md`, `docs/ESP32_READINESS.md` theo số đo chỉ đọc |
