# care-monitoring

Cloud backend của CareLens AI trên Cloudflare Workers (ADR-016, **Proposed**). Hợp đồng API: [docs/API_CONTRACT.md](../../docs/API_CONTRACT.md). Giao thức cho firmware ESP32: [docs/DEVICE_API.md](../../docs/DEVICE_API.md). Triển khai: [docs/DEPLOYMENT_RUNBOOK.md](../../docs/DEPLOYMENT_RUNBOOK.md). Kết quả kiểm thử: [docs/TEST_REPORT_2026-10-19.md](../../docs/TEST_REPORT_2026-10-19.md).

Không có suy luận AI ở đây. Mô hình Vision (Module 1) và LLM Qwen (Module 2) chạy trên PC tại nhà; agent cục bộ ([integrations/carelens/local-agent](../../integrations/carelens/local-agent/README.md)) kéo việc về qua HTTPS đi ra.

```
ESP32-S3 CAM ──/api/device/v1──▶ Worker ──▶ D1 (trạng thái bền, IMU thô 72 h) + R2 MEDIA (frame tạm thời, ≤ 15 phút)
  burst JPEG, IMU thô, kích hoạt,   │  ▲                                  + R2 AUDIO (lời nhắn, có phiên bản)
  heartbeat, lệnh + âm thanh         │  └──/api/agent/v1── Local AI Agent (PC) ──▶ Vision 127.0.0.1:8080, Ollama
              Durable Object ◀───────┘
              (SSE realtime)
Frontend (Vercel) ──/api/app/v1/session, stream-tickets──▶ Worker ──/api/demo/stream?ticket=…──▶ Live Demo
```

## Trạng thái

| Hạng mục | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Worker, schema D1, R2, Durable Object, Cron | **Đã kiểm chứng cục bộ** | `npm test`: 8 file, 169 test trong runtime Workers (Miniflare, D1/R2/DO cục bộ); `npm run typecheck`; `npm run contracts:check`; `npm run deploy:dry-run` (1031,25 KiB, gzip 184,19 KiB) |
| Thiết bị → Worker → agent → Vision thật → kết quả, hợp nhất, cảnh báo, còi → xác nhận của thiết bị → frontend | **Đã kiểm chứng cục bộ** với harness thiết bị (không phải ESP32) | `pytest -m e2e tests/integration` ở local-agent: 11/11, gồm Chromium đăng nhập qua biểu mẫu thật |
| Deploy lên Cloudflare | **Chưa làm** | Cần tài khoản, D1, R2, secret ([runbook](../../docs/DEPLOYMENT_RUNBOOK.md)) |
| ESP32 thật | **Chưa có** | Hợp đồng thiết bị là đề xuất (ADR-019) |
| Hiệu chỉnh ngã | **Chưa có** | Gói trả `NOT_CALIBRATED`; chưa có quy tắc IMU đã duyệt; mặc định không tạo cảnh báo nghi ngã (D11) |

## Chạy cục bộ

```powershell
cd backend/care-monitoring/worker
npm ci                                   # một lần; lockfile riêng, không đụng package-lock.json gốc
copy .dev.vars.example .dev.vars         # rồi điền ADMIN_TOKEN_SHA256 (xem dưới)
cd ../../..
npm run dev:backend                      # wrangler dev trên 127.0.0.1:8787, D1/R2 cục bộ ở worker/.wrangler/state
```

Migration 0001 đã được sửa trước lần deploy đầu. Nếu DB phát triển cục bộ được tạo từ bản cũ, launcher dừng và yêu cầu `python backend/care-monitoring/start_backend.py --reset-local-db` (chỉ xóa `worker/.wrangler/state/v3/d1`, dữ liệu thử cục bộ).

Tạo token admin: `python backend/care-monitoring/scripts/make_admin_token.py` (ghi token ra file trong thư mục home, in digest). Đặt digest vào `ADMIN_TOKEN_SHA256`. Cấp thiết bị, agent, người chăm sóc, grant và đăng nhập web bằng `scripts/admin.py` (đọc token từ biến `CARELENS_ADMIN_TOKEN`).

Kiểm tra:

```powershell
cd backend/care-monitoring/worker
npm run typecheck
npm test                    # Vitest trong runtime Workers
npm run contracts:check     # contracts/carelens/*.schema.json khớp src/contracts.ts, không còn schema cũ
npm run deploy:dry-run      # đóng gói, không cần tài khoản
```

## Những gì backend làm

| Miền | Hành vi |
| --- | --- |
| Thiết bị | Token riêng mỗi thiết bị (`cld_…`), chỉ lưu SHA-256, cấp một lần, xoay/thu hồi được. `device_id` phải trùng credential. Mọi yêu cầu mang `clock{boot_id, uptime_ms, …}`; máy chủ ước lượng mốc boot (`device_boots`). Heartbeat v2 lưu trạng thái camera/IMU/loa, RSSI, heap |
| Burst ảnh | `capture-session.v2` → chunk 8 khung (`[uint32 LE độ dài][JPEG]`) → complete. 24 khung (thường) hoặc 40 khung (kích hoạt), 8 fps, mốc `uptime_ms` từng khung. Kiểm JPEG, ≤ 640×480 và đúng manifest, ≤ 200 000 byte/khung, SHA-256 từng khung, thứ tự, nhịp 125 ± 40 ms chỉ trong một burst (khoảng > 187 ms là mất khung → bỏ qua suy luận ngã của burst đó). Tiếp tục upload qua `GET /captures/{id}`. Hạn mức mỗi giờ (A30) |
| Media | R2 `MEDIA/media/<capture_pk>/chunk-<i>`. Xóa ngay sau khi agent nộp kết quả, khi job thất bại hẳn, khi upload bỏ dở quá `UPLOAD_SESSION_TTL_SECONDS`, và chắc chắn khi hết `MEDIA_MAX_AGE_SECONDS` (Cron mỗi phút). D1 chỉ có metadata |
| IMU thô | `imu-batch.v1`: mẫu MPU6050 nguyên dạng (g, °/s, ms từ khi khởi động), ≤ 1000 mẫu/lô, idempotent theo `(boot_id, batch_seq)`, cờ chất lượng (khoảng hở, lệch tần số, chạm dải, thiếu/muộn lô), từ chối giá trị ngoài dải, mốc không hợp lệ, lô quá cũ. Lưu `IMU_RAW_RETENTION_HOURS` (72 h); đọc lại qua `GET /recipients/{rid}/imu-samples` |
| Kích hoạt firmware | `imu-event.v2`: chỉ mở quyết định, không phải bằng chứng |
| Job | `vision` (ưu tiên 100 kích hoạt / 50 thường) và `daily_report` (10). Claim nguyên tử, lease có token, gia hạn, thu hồi lease hết hạn, retry 5 s/15 s/45 s, tối đa 3 (vision) hoặc 6 (báo cáo), `release` không tính lượt, `expired` theo media. Hoàn tất idempotent theo `idempotency_key`; job chỉ `completed` trong cùng giao dịch lưu kết quả |
| Hợp nhất | `fusion-rules.v2` (ADR-017): hình ảnh + IMU thô trên đồng hồ đơn điệu cùng boot → `suspected_fall` / `needs_review` / `not_enough_data` / `no_fall_detected` / `processing_failed`; chỉ người chăm sóc đặt `verified`/`dismissed`. Không ngưỡng mặc định, không cảnh báo đơn nguồn |
| Cảnh báo | Chỉ `suspected_fall`. Lưu cùng giao dịch với quyết định, phát qua SSE ngay, kèm lệnh còi 30 s. Luôn "cần xác minh". Chống trùng theo thiết bị. Không phụ thuộc LLM |
| Báo cáo ngày | Cron `15 17 * * *` UTC = 00:15 Asia/Ho_Chi_Minh, bù mỗi 10 phút. Số liệu do backend tính; đầu ra LLM bị từ chối nếu nêu id/khoảng trống lạ hoặc số không có trong đầu vào. Chỉ lưu khi có bộ đếm suy luận thật từ Ollama |
| Lệnh thiết bị | `emergency_buzzer` (100), `reminder` (50), `play_voice_message` (40). `queued → delivered → accepted → started → completed`; `failed`/`rejected` (mã lý do), `expired`, `cancelled` (thiết bị xác nhận), `superseded`. "Đã phát" chỉ khi thiết bị báo `completed`. Giao lại cùng id nếu không `accepted` trong 30 s. Hết hạn thì không bao giờ phát lại |
| Nhắc thuốc/nước | Lịch ở backend theo múi giờ; mỗi lần đến hạn một lệnh idempotent; lần mới hơn thay lần cũ chưa được nhận; hết `deadline_minutes` thì hết hạn |
| Lời nhắn thoại | WAV PCM mono 16-bit, tần số theo `DEVICE_AUDIO_SAMPLE_RATES` (A31), R2 `AUDIO` khóa bất biến theo phiên bản. Thiết bị chỉ tải qua lệnh đang hoạt động (hỗ trợ `Range`), kèm `sha256` để tự kiểm |
| Người dùng web | Đăng nhập bằng thông tin do owner cấp (ADR-018) → token phiên `clc_…` (12 h, chỉ trong bộ nhớ trình duyệt); vé stream `cls_…` dùng một lần cho `/api/demo/stream`. Quyền theo grant (`caregiver` / `viewer`): không grant 404, thiếu quyền 403 |
| Live Demo | `/api/demo/stream` (SSE `state_update`) cho persona "Demo trực tiếp": quyết định, uống nước/thuốc, vòng đời lệnh, dòng trạng thái hệ thống, cảnh báo có phiên bản. Không vé → rỗng, trừ danh sách IP phát triển |
| Vận hành | `GET /api/admin/v1/status`: hàng đợi và tuổi job, lỗi 24 h theo mã, lần suy luận thành công gần nhất, agent, thiết bị, IMU, lệnh, quyết định. `GET /ready`: năng lực thật |
| Audit | `audit_log`: actor, hành động, đích, kết quả. Không token, media, mẫu cảm biến |

## Cấu hình

Biến thường nằm trong `worker/wrangler.jsonc` (`vars`), secret đặt bằng `wrangler secret put`. Cục bộ: `worker/.dev.vars` (mẫu `.dev.vars.example`, không commit).

| Tên | Loại | Ý nghĩa |
| --- | --- | --- |
| `ADMIN_TOKEN_SHA256` | **secret** | SHA-256 của token admin. Trống: admin API trả 503 |
| `ALLOWED_ORIGINS` | var | Origin trình duyệt được CORS (URL Vercel). Trống: không trình duyệt nào gọi được |
| `ACCEPT_SIMULATED_SOURCES` | var | `false` ở production. `true` chỉ cho test/dev cục bộ |
| `FUSION_POLICY_JSON` | var | Chính sách `fusion-rules.v2` (ADR-017). Trống = mặc định, không quy tắc, không cảnh báo |
| `MEDIA_MAX_AGE_SECONDS`, `UPLOAD_SESSION_TTL_SECONDS`, `MAX_CAPTURE_AGE_SECONDS` | var | Vòng đời media và tuổi tối đa của burst |
| `FRAMES_PER_CHUNK`, `CADENCE_TOLERANCE_MS`, `MAX_NORMAL_CAPTURES_PER_HOUR`, `MAX_TRIGGERED_CAPTURES_PER_HOUR` | var | Upload và hạn mức (A30) |
| `IMU_RAW_RETENTION_HOURS`, `IMU_MAX_BATCH_AGE_SECONDS` | var | Lưu IMU thô và tuổi tối đa của lô (A33) |
| `IMU_STORAGE_SOFT_LIMIT_MB` | var | Từ chối lô IMU thô (507 `imu_storage_budget_exceeded`) khi DB D1 lớn hơn mức này (mặc định 400 cho Free 500 MB; 0 = không nhận IMU thô). Cảnh báo, burst, lệnh không bị ảnh hưởng |
| `DEVICE_AUDIO_SAMPLE_RATES` | var | Tần số WAV thiết bị phát được (mặc định `16000`) |
| `SESSION_TTL_HOURS` | var | Đời phiên đăng nhập web (mặc định 12) |
| `LOGIN_PBKDF2_ITERATIONS` | var | Số vòng PBKDF2 cho mật khẩu do owner chọn (mặc định và tối đa 100000, tối thiểu 1000). Hạ xuống nếu lần đăng nhập vượt giới hạn CPU của gói Free; băm đã lưu giữ số vòng riêng nên không hỏng |
| `DEVICE_ONLINE_WINDOW_SECONDS` | var | Thiết bị coi là đang kết nối nếu liên lạc trong khoảng này |
| `REPORT_TIMEZONE`, `DAILY_REPORT_LOCAL_TIME` | var | Mặc định `Asia/Ho_Chi_Minh`, `00:15`. Đổi giờ thì sửa cả cron trong `wrangler.jsonc` |
| `LEGACY_STREAM_RECIPIENT_ID`, `LEGACY_STREAM_DEVICE_ID`, `LEGACY_STREAM_ALLOWED_IPS` | var | Truy cập Live Demo không vé chỉ cho phát triển (D12); `LEGACY_STREAM_DEVICE_ID` cũng chọn thiết bị hiện làm hub |
| `SSE_MAX_LIFETIME_SECONDS`, `EMERGENCY_COMMAND_TTL_SECONDS` | var | Đời stream; hạn của lệnh còi |

Bindings: `DB` (D1 `care_monitoring`), `MEDIA` (R2 `carelens-capture-media`), `AUDIO` (R2 `carelens-voice-audio`), `REALTIME` (Durable Object `RealtimeHub`, SQLite), `AUTH_FAILURE_LIMITER`, `DEVICE_LIMITER` (Rate Limiting; thiếu binding thì bỏ qua).

## Giới hạn free plan và sizing

Số liệu từ tài liệu Cloudflare đọc ngày 2026-10-19 (ADR-016):

| Tài nguyên | Free | Tiêu thụ ước tính |
| --- | --- | --- |
| Request Worker | 100 000/ngày | ~8 request mỗi burst thường + 1 request mỗi lô IMU (gửi liên tục mỗi 10 s ≈ 8 640/ngày/thiết bị) + nền của agent (~3 000/ngày) + stream Live Demo (~1 request/5 phút/tab) |
| CPU | 10 ms/lần gọi | Kiểm JPEG chỉ đọc header; SHA-256 native; mật khẩu web dùng SHA-256 vì là bí mật ngẫu nhiên 100 bit |
| D1 ghi | 100 000 dòng/ngày | ~20–30 dòng mỗi burst; ≈ 11 dòng mỗi lô IMU (1 đồng hồ + bảng và 4 chỉ mục khi ghi + bằng ấy khi xóa theo hạn; ước lượng theo cách tính của Cloudflare, chưa đo) |
| D1 dung lượng | 500 MB/DB | IMU thô JSON ≈ 42–48 byte/mẫu nếu firmware làm tròn số, ≈ 130 byte/mẫu nếu ghi float32 đầy đủ → 100 Hz liên tục ≈ 360–1 100 MB/ngày/thiết bị (con số 48 MB/ngày ghi trước đây sai). `IMU_STORAGE_SOFT_LIMIT_MB` từ chối IMU thô trước khi DB đầy (A33) |
| D1 truy vấn | 50/lần gọi | Mỗi bước cron có giới hạn số mục |
| R2 loại A | 1 triệu/tháng | 3 PUT mỗi burst 24 khung; DELETE miễn phí |
| Durable Object | 100 000 request, 13 000 GB-s/ngày | Một `publish` mỗi thay đổi; WebSocket hibernation không tính thời gian khi rảnh |
| Cron Trigger | 5/tài khoản | Dùng 2 |

Ước lượng cho một thiết bị trên Free, chưa đo trên firmware:

| Cách gửi IMU (100 Hz, lô 10 s) | Lô/ngày | Dòng ghi D1/ngày | Dung lượng giữ 72 h |
| --- | --- | --- | --- |
| Liên tục | 8 640 | ≈ 95 000 (gần hết hạn Free) | 1,1–3,3 GB → vượt 500 MB trong khoảng một ngày |
| Quanh mỗi burst thường (60/giờ, cửa sổ ~20 s) | ≈ 2 900 | ≈ 32 000 | 0,4–1,1 GB → vượt nếu giữ 72 h |
| Chỉ quanh kích hoạt (≤ 20/giờ, cửa sổ ~20 s) | ≈ 960 | ≈ 11 000 | 0,12–0,37 GB |

Khi D1 đầy hoặc hết dòng ghi trong ngày, mọi lệnh ghi thất bại, kể cả cảnh báo. Vì vậy IMU thô bị từ chối (507) từ `IMU_STORAGE_SOFT_LIMIT_MB`. Hạn dòng ghi mỗi ngày không được chặn trong mã; theo dõi ở dashboard D1. Trên Free: firmware chỉ gửi IMU quanh kích hoạt (và burst khi đủ chỗ), hoặc giảm `IMU_RAW_RETENTION_HOURS`. Chụp liên tục (mỗi ~4 s) hoặc IMU liên tục cần Workers Paid. Chốt sau khi đo lưu lượng thật (A33, D08). Bật R2 có thể đòi phương thức thanh toán dù dùng trong hạn miễn phí (nguồn bên thứ ba, chưa kiểm trên tài khoản thật).

## Giới hạn đã biết

- Gói mô hình chưa hiệu chỉnh và chưa có quy tắc IMU: điểm ngã là logit, không phải xác suất; không có cảnh báo nghi ngã với cấu hình mặc định (D11).
- Thiết bị gắn cố định với một hồ sơ; đổi người dùng thì thu hồi và cấp `device_id` mới.
- Web chỉ có đăng nhập bằng thông tin do owner cấp; chưa có tự đăng ký, quên mật khẩu, cookie (ADR-018).
- `backend/care-monitoring/.env` (bị git bỏ qua) là file của service cũ, không còn được đọc; nếu còn token Telegram cũ thì thu hồi token và xóa file.
