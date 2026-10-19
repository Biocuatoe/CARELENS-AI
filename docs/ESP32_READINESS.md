# Đánh giá sẵn sàng thử ESP32-S3 CAM (OV5640 + MPU6050)

Phiên bản 2026-10-19. Kiểm bằng đọc mã nguồn, chạy test cục bộ và các yêu cầu chỉ đọc tới bản deploy. **Không** ghi dữ liệu vào production, không tạo credential. Hợp đồng chi tiết: `docs/DEVICE_API.md`.

## 1. Kết luận

**SẴN SÀNG THỬ GIAO THỨC/FIRMWARE CÓ GIỚI HẠN, KÈM CÁC CHẶN NÊU DƯỚI.**

| Lớp | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Triển khai backend và frontend | Sẵn sàng | `/ready` báo `ready` (D1 ok, hai bucket R2 và Durable Object đã bind, `simulated_sources: rejected`); frontend tải được; một lần đăng nhập Google thật thành công (audit log production: `google_viewer.enroll` rồi `session.google_login`, 08:29 UTC) |
| Hợp đồng giao thức | Sẵn sàng (đã kiểm cục bộ) | Schema `src/contracts.ts`, fixtures `contracts/carelens/fixtures/`, 151 test thiết bị pass trên runtime Workers cục bộ (D1/R2 tạm); ví dụ trong `DEVICE_API.md` kiểm với schema thật |
| Cấp credential thiết bị | **Bị chặn** | Chỉ có đường `POST /api/admin/v1/devices` (`src/admin.ts:65`); admin API trên production trả 503 `admin_not_configured` (`ADMIN_TOKEN_SHA256` chưa đặt). Production hiện có 0 thiết bị, 0 agent |
| Local AI Agent nối production | **Bị chặn** | (1) Chưa có token agent (cũng cần admin API). (2) Python của agent trên PC này **không xác minh được chứng chỉ Worker** (mục 4). (3) Vision server (`127.0.0.1:8080`) chưa chạy; Ollama đang chạy |
| Kiểm thử trên thiết bị thật | **Chưa có** | Chưa có firmware; mọi bằng chứng là harness giả lập (`tools/sample_device.py`) trên backend cục bộ |

Có thể bắt đầu viết firmware ngay (hợp đồng đã đủ và ổn định). **Chưa thể** chạy một vòng ESP32 → backend → agent → dashboard trên production cho tới khi gỡ các chặn ở mục 5.

## 2. Ma trận sẵn sàng

| # | Hạng mục | Trạng thái | Bằng chứng và giới hạn |
| --- | --- | --- | --- |
| 1 | Cấp thiết bị | **BLOCKED** | Triển khai có (`admin.ts:65` `createDevice`, CLI `scripts/admin.py device`), nhưng production chưa có admin API. Hồ sơ đích `rcp-showcase` ("Hồ sơ trình diễn", `active`) đã tồn tại, tạo rỗng khi người xem Google đầu tiên vào (đọc D1 production) |
| 2 | Bảo mật credential thiết bị | READY WITH LIMITATIONS | Token `cld_` 256 bit ngẫu nhiên, hiện một lần, chỉ lưu SHA-256 (`util.ts randomToken`, `admin.ts:65`); hồ sơ lấy từ credential, `device_id` body phải khớp (403 `device_mismatch`, `index.ts` heartbeat, `captures.ts:157`); xoay/thu hồi có (`admin.ts` `rotateDeviceToken`, `revokeDevice`). Giới hạn: không có chứng chỉ client; giới hạn tần suất lỗi xác thực theo IP; bảo vệ token trong flash ESP32 là việc firmware |
| 3 | Schema khung ảnh và kiểm tra | READY (cục bộ) | `capture-session.v2` (`contracts.ts`), kiểm thứ tự, thời gian, chế độ/số khung, tuổi burst, quota (`captures.ts:156-200`); mỗi khung kiểm JPEG, kích thước, SHA-256 (`captures.ts:272-289`). Test: `captures-jobs.test.ts` ("rejects invalid sequencing…", "validates every frame of a chunk…", "rejects a JPEG whose bytes match the manifest but is not a JPEG") |
| 4 | Giới hạn kích thước, số khung, chunk | READY WITH LIMITATIONS | 24 khung (normal) hoặc 40 (triggered), 8 khung/chunk, khung ≤ 200 000 B và ≤ 640×480, manifest ≤ 32 KB, chunk ≤ 8×200 004 B, `Content-Type: application/octet-stream` (415 nếu khác), phiên upload 120 s. Chưa đo: CPU 10 ms/lần gọi của Workers Free cho một chunk 8 khung; PSRAM và thời gian chụp 8 fps trên ESP32 |
| 5 | Schema IMU, đơn vị, thời gian lấy mẫu | READY (cục bộ) | `imu-batch.v1`: g, °/s, `uptime_ms` mỗi mẫu, 1–1000 mẫu, ≤ 256 KB, ≤ 120 s, kiểm dải đo ±5 % (`imu.ts:34-63`). Chưa kiểm: nhịp thật của MPU6050 qua I2C, cách ghi số thực (quyết định dung lượng D1) |
| 6 | Đối chiếu thời gian khung ↔ IMU | READY WITH LIMITATIONS | Cùng `boot_id`, so sánh trực tiếp `uptime_ms`; yêu cầu phủ ≥ 0,8 và không hở > 500 ms (`env.ts DEFAULT_FUSION_POLICY`); sai lệch UTC ước lượng từ `received_at − uptime_ms`. Test: `fusion-alerts.test.ts`, `captures-jobs.test.ts` ("estimates capture time from the device clock…"). Chưa kiểm: độ trôi và jitter của đồng hồ ESP32 thật |
| 7 | Thử lại và chống trùng | READY (cục bộ) | Manifest trùng → 200 `created:false`, `capture_id_reused` 409; chunk và `complete` gửi lại an toàn; `batch_seq`, `trigger_id` idempotent. Test: "is idempotent for the same manifest…", "treats a re-sent chunk and a re-sent complete as duplicates", `batch_seq_reused`, `trigger_id_reused` |
| 8 | Phân phát việc và xác thực agent | READY WITH LIMITATIONS | Hàng đợi bền, claim một câu lệnh, lease, backoff 5/15/45 s (`jobs.ts` đầu file); test "never hands the same job to two concurrent claimers", "serves media only with the current lease". Production: **NOT VERIFIED**, không có token agent |
| 9 | Agent offline | READY WITH LIMITATIONS | Việc vision hết hạn và ảnh bị xóa khi quá `MEDIA_MAX_AGE_SECONDS` (900 s) (`maintenance.ts expireMedia`; test "expires queued work and deletes media when the agent stays offline…"). **Burst xảy ra lúc agent tắt quá 15 phút bị mất, không được xếp hàng dài hạn**; báo cáo ngày thì bền |
| 10 | Giao kết quả suy luận | READY (cục bộ) / NOT VERIFIED (production) | `vision-result.v1`, hoàn tất một lần trong một transaction, kết quả lặp là duplicate (test "completes once, deletes media, and treats a retried completion as a duplicate"). Agent + gói mô hình thật + Qwen thật + backend cục bộ + Chromium: 11/11 (README agent, 2026-10-19). Chưa chạy qua production |
| 11 | Trạng thái thiết bị và hiển thị trên dashboard | READY WITH LIMITATIONS | Hub online khi liên hệ xác thực gần nhất ≤ `DEVICE_ONLINE_WINDOW_SECONDS` (180 s) (`legacy.ts:216-228`); sự kiện từ quyết định hợp nhất, quan sát uống nước, vòng đời lệnh, cảnh báo; không bịa dữ liệu. **Không hiển thị ảnh hay IMU thô.** Đã kiểm cục bộ bằng Chromium; production mới kiểm đến bước đăng nhập, chưa có dữ liệu thiết bị |
| 12 | Cảnh báo so với ứng viên mô hình | READY WITH LIMITATIONS | Kích hoạt của firmware chỉ mở quyết định, không phải bằng chứng; không cảnh báo đơn nguồn; chưa có quy tắc được duyệt nên `/ready` báo `alerts: none_until_both_rules_are_approved` và kết quả chỉ là `needs_review` (`fusion.ts:230-252`). Điểm ngã là logit chưa hiệu chỉnh (D11) |
| 13 | Media riêng tư và xóa | READY WITH LIMITATIONS | Hai bucket riêng tư (r2.dev tắt, không custom domain), ảnh chỉ qua Worker, xóa ngay khi hoàn tất, thất bại hẳn, upload dở hoặc quá 900 s; quy tắc vòng đời 1 ngày làm lưới an toàn. Xóa đã kiểm bằng test cục bộ, **chưa thực hiện trên R2 production**. IMU thô lưu 72 giờ trong D1 (D08 chưa chốt) |
| 14 | Sẵn sàng thử phần cứng | NOT IMPLEMENTED | Chưa có firmware. Mục 6 là kế hoạch thử đầu tiên |

## 3. Kiểm tra đã chạy trong lượt này

| Kiểm tra | Hạ tầng | Kết quả |
| --- | --- | --- |
| `vitest` 6 tệp (captures-jobs, fusion-alerts, commands, contracts, realtime, unit) | Runtime Workers **cục bộ** (D1/R2 tạm) | 151/151 pass |
| `npm run contracts:check` | Cục bộ | JSON Schema khớp `contracts.ts` |
| Ví dụ JSON của `DEVICE_API.md` và 6 fixture hợp lệ so với schema zod thật | Cục bộ, không mạng | Heartbeat, `imu-event.v2`, `command-status.v2` hợp lệ; ví dụ capture và IMU bị rút gọn bằng "…" nên không gửi nguyên văn (đã ghi chú vào tài liệu); 6/6 fixture hợp lệ |
| `/health`, `/ready`, `/api/admin/v1/status` (không token), `/api/device/v1/heartbeat` (không token), `/api/agent/v1/jobs/claim` (không token) | Production, chỉ đọc | 200, ready, 503, 401, 401 |
| Truy vấn `SELECT COUNT(*)` và nhóm `audit_log` theo hành động | D1 production, chỉ đọc | 0 thiết bị, 0 agent, 0 capture/event/job/IMU, 1 hồ sơ, 1 người xem Google |
| Chuỗi chứng chỉ TLS và xác minh từ Python của agent | Production, chỉ đọc | Chuỗi ECDSA (xem mục 4); Python 3.14.7 và 3.11.9 trên PC này: `certificate verify failed: certificate has expired` |

Không có request thiết bị nào gửi vào production, không tạo credential, không bật quyền công khai R2.

## 4. Phát hiện mới: agent không kết nối được production từ PC này

- **Nguyên nhân (đã đo):** kho chứng chỉ gốc Windows của PC chứa `ISRG Root X2` tự ký **đã hết hạn 15/09/2025**, và không có `ISRG Root YE`. Chuỗi của `*.workers.dev` là lá → `YE2` → `Root YE` → `ISRG Root X2` (ký chéo bởi `X1`). OpenSSL của Python neo vào bản X2 hết hạn nên báo hết hạn, trong khi `openssl s_client` và Chromium (kho riêng) xác minh được. Agent dùng `ssl.create_default_context()` (`local-agent/src/carelens_agent/cloud.py:59`) nên chịu cùng lỗi.
- **Cách xử lý (chưa thử, cần chủ máy quyết định):** cập nhật chứng chỉ gốc Windows (Windows Update, hoặc `certutil -generateSSTFromWU` rồi nạp), hoặc gỡ bản `ISRG Root X2` hết hạn khỏi kho Trusted Root. Sau đó chạy lại phép thử một dòng bằng Python của agent; kỳ vọng `HTTP 200` trên `/health`.
- **Lưu ý khác:** trên mạng của máy này, `curl`/Node mặc định (TLS 1.3 kèm khóa post-quantum) lỗi bắt tay tới `*.workers.dev`; `--tls-max 1.2` chạy được. Chưa rõ Python có gặp lỗi này sau khi sửa kho chứng chỉ hay không.
- **Hệ quả cho ESP32:** firmware cần gốc tin cậy đúng và giờ đúng (mục 1 của `DEVICE_API.md`). Chưa kiểm trên thiết bị.

## 5. Chặn và hành động tối thiểu của owner

| # | Chặn | Hành động tối thiểu |
| --- | --- | --- |
| B1 | Không cấp được token thiết bị và agent | Owner quyết định một trong hai: (a) bật admin API bằng cách đặt secret `ADMIN_TOKEN_SHA256` qua `npx wrangler secret put` (digest do `scripts/make_admin_token.py` sinh; owner đã nói không muốn token admin thủ công nên đây là quyết định riêng); (b) đề xuất một đường cấp phát khác để tôi thiết kế và ghi ADR. Chưa có đường (b); tôi không ghi thẳng vào D1 để vòng qua admin API |
| B2 | Agent không xác minh được TLS | Sửa kho chứng chỉ gốc như mục 4 |
| B3 | Vision server chưa chạy | `powershell -ExecutionPolicy Bypass -File integrations\carelens\local-agent\scripts\start_vision_server.ps1 -Device cuda -Background` |
| B4 | Không có quy tắc ngã được duyệt (D11) | Không chặn thử đường ống: chỉ ảnh hưởng việc có cảnh báo hay không. Mọi kết quả sẽ là `needs_review`, không phải cảnh báo |
| B5 | Chưa chốt vị trí gắn MPU6050 và thời hạn lưu dữ liệu (D08) | Chỉ dùng người/vật thử không phải bệnh nhân thật cho tới khi chốt |

## 6. Kế hoạch thử đầu tiên với ESP32-S3 CAM thật

Mỗi bước chỉ làm khi bước trước đạt. Mọi dữ liệu gửi lên phải là `source_mode: "device"` từ phần cứng thật; production từ chối `simulated`. Ví dụ nằm trong `DEVICE_API.md` và `contracts/carelens/fixtures/valid/` chỉ là dữ liệu thử về cấu trúc.

| Bước | Việc | Cần credential | Kỳ vọng và cách kiểm |
| --- | --- | --- | --- |
| 0 | Đồng bộ SNTP, rồi `GET https://care-monitoring.care-monitoring-worker.workers.dev/health` | Không | 200 `{"status":"ok","service":"care-monitoring"}`. Kiểm bắt tay TLS, chuỗi ECDSA, giờ. **Làm được ngay, không chờ B1** |
| 0b | `GET /ready` | Không | 200, `status: ready`, `esp32_firmware: not_verified_with_hardware` |
| 1 | `POST /api/device/v1/heartbeat` (`Authorization: Bearer cld_…`, `Content-Type: application/json`, `device-heartbeat.v2`, ≤ 4 KB) | Token thiết bị (B1) | 200 `{server_time, pending_commands:0, clock{boot_id, estimated_boot_epoch, issues}}`. D1: `devices.last_seen_at`, `last_heartbeat_at` cập nhật; dashboard hiện hub "connected" trong 180 s. Sai token → 401: dừng, không lặp nhanh |
| 2 | `POST /api/device/v1/imu-batches` (`imu-batch.v1`, g, °/s, `uptime_ms` mỗi mẫu) với 1–2 s dữ liệu thật | Như trên | 201 `{batch_id, sample_count, issues, decisions_made}`. Xem `issues` (khoảng hở, lệch nhịp, chạm dải đo). Gửi lại cùng `batch_seq` và nội dung → 200 `created:false` |
| 3 | Burst `normal` 24 khung: `POST /captures` (manifest), `PUT /captures/{id}/chunks/0..2` (octet-stream; mỗi khung `[uint32 LE độ dài][JPEG]`), `POST /captures/{id}/complete` | Như trên | Manifest 201 `created:true` kèm `upload{chunk_count:3,…}`; chunk 200/201; complete 202 `{capture, job}` với job `queued`. Mất mạng giữa chừng: `GET /captures/{id}` lấy `chunks_received[]`, gửi phần thiếu trước `upload_deadline` (120 s) |
| 4 | Agent chạy (B2, B3) | Token agent (B1) | `admin.py status`: `agents[0].connected:true`, `reported.vision.fall_heads:3`; job chuyển `processing` rồi `completed`; capture `processed`; ảnh bị xóa khỏi R2 |
| 5 | Dashboard (đăng nhập Google, `/people`) | Không | Kết quả là mục `needs_review` / quan sát, hoặc không có gì nếu không có sự kiện nên hiển thị. Không có cảnh báo ngã khi chưa có quy tắc. Dòng "Trạng thái hệ thống" cho biết agent đang kết nối |
| 6 | Burst `triggered` 40 khung kèm `imu-event.v2` | Như trên | `imu-events` 201 `{event_id, fusion: decided|waiting}`; quyết định cuối trong ≤ 60 s sau burst nếu IMU phủ ≥ 0,8 |
| 7 | `GET /api/device/v1/commands/next` mỗi 5–10 s | Như trên | 204 khi không có lệnh |

**Thử lại:** 5xx, mất mạng, timeout → lùi 1 s, 2 s, 4 s… tối đa 60 s, có jitter, gửi lại **cùng** `capture_id`, chỉ số chunk, `batch_seq`, `trigger_id`. 400/422 → không gửi lại y nguyên. 429 → chờ `Retry-After`. 507 → chỉ lô IMU bị hoãn.

**Cách xác nhận từng chặng** (owner chạy, chỉ đọc): `wrangler tail` cho log Worker (chỉ id và mã, không token hay mẫu); `npx wrangler d1 execute care_monitoring --remote --command "SELECT …"` trên `devices`, `capture_sessions`, `jobs`, `imu_batches`; `admin.py status` nếu B1 được giải quyết; dashboard.

**Riêng tư và dọn dẹp:** chỉ người thử đã đồng ý, không bệnh nhân thật. Ảnh chỉ nằm trong R2 tạm, xóa khi agent xong, khi job thất bại hẳn, hoặc tối đa 15 phút; không vào D1, log hay dashboard. IMU thô lưu 72 giờ trong D1. Sau buổi thử: thu hồi thiết bị bằng `POST /api/admin/v1/devices/{id}/revoke` (route có trong `index.ts`, nhưng `scripts/admin.py` **chưa có lệnh** cho việc này); IMU thô tự bị xóa sau `IMU_RAW_RETENTION_HOURS`. Chưa có công cụ xóa dữ liệu thử theo yêu cầu.

## 7. Giới hạn Free plan ảnh hưởng thử nghiệm (đọc từ mã và cấu hình, chưa đo)

- Rate limit thiết bị 120 yêu cầu/phút (`wrangler.jsonc`): `commands/next` mỗi 5 s (12/phút) cộng IMU mỗi 1 s (60/phút) cộng chunk còn chừa chỗ, nhưng sát trần khi đang upload.
- Workers Free 100 000 request/ngày: `commands/next` mỗi 5 s đã là 17 280; IMU mỗi 1 s sẽ là 86 400. Chỉ gửi IMU quanh burst (runbook §13) hoặc mỗi 10 s.
- IMU thô liên tục làm đầy D1 Free trong khoảng một ngày; Worker từ chối bằng 507 từ 400 MB.

## 8. Chưa giải quyết (không coi là đã có)

- Cấp thiết bị khi không có admin API.
- Firmware, chụp 8 fps thật, JPEG thật, độ trễ, mất điện giữa chừng.
- Công cụ xóa dữ liệu thử theo yêu cầu.
- Cảnh báo ngã (D11), thời hạn lưu (D08), chế độ lưu IMU (A33).
- Hành vi TLS của ESP32 với chuỗi hiện tại.

## 9. Hợp đồng luồng dữ liệu ESP32-S3 (12 bước) và thành phần còn thiếu

Cập nhật 2026-10-19 (A40). Firmware **chưa được nạp** lên bo và **không có mã firmware nào trong repo** (không có `.ino`, `platformio.ini`, `sdkconfig`). Cột "Bằng chứng" chỉ là thiết bị **mô phỏng** đi qua đúng route device v2 trong môi trường test Worker (`test/device-flow.test.ts` trừ khi ghi khác); không bước nào đã được quan sát trên ESP32 thật.

| # | Bước | Route / hợp đồng | Bằng chứng hiện có | Trạng thái |
| --- | --- | --- | --- | --- |
| 1 | Thiết bị có danh tính và credential riêng | `POST /api/admin/v1/devices` trả `cld_…` một lần, chỉ lưu SHA-256 | test cấp phát (`provision` trong mọi test Worker) | Route có; **chưa cấp phát thiết bị nào trên production**; giao diện không cấp phát (A40) |
| 2 | Wi-Fi và đồng bộ giờ SNTP | Phía thiết bị. Máy chủ ước lượng epoch từ `boot_id` + `uptime_ms` nên không phụ thuộc giờ treo tường | test đồng hồ (`unit`, `captures-jobs`) | **Thuộc firmware, chưa có** |
| 3 | Kiểm chứng chuỗi chứng chỉ HTTPS | Phía thiết bị; cần gói chứng chỉ gốc CA đủ để xác minh chuỗi của `*.workers.dev` | không | **Chưa có; không được tắt kiểm chứng TLS** |
| 4 | Heartbeat có xác thực | `POST /api/device/v1/heartbeat` (`device-heartbeat.v2`) → `pending_commands` | flow test bước 4 | Mô phỏng đạt |
| 5 | Lô IMU và sự kiện kích hoạt | `POST /imu-batches`, `/imu-events` (g, °/s, ms từ boot; giới hạn kích thước theo contract) | flow test bước 5 | Mô phỏng đạt. Kích hoạt của firmware không phải bằng chứng ngã |
| 6 | Siêu dữ liệu chụp và các chunk ảnh | `POST /captures`, `PUT /captures/{id}/chunks/{i}`, `POST …/complete` (24/40 khung, JPEG, hash từng khung) | flow test bước 6 | Mô phỏng đạt (ảnh JPEG xám tổng hợp) |
| 7 | Lưu riêng tư, xóa theo hạn | R2 `MEDIA` riêng tư, xóa sau suy luận hoặc `MEDIA_MAX_AGE_SECONDS` (900 s) | flow test: sau `complete` không còn đối tượng R2 | Mô phỏng đạt |
| 8 | Agent cục bộ lấy việc và suy luận | `POST /api/agent/v1/jobs/claim` → media theo lease → `complete` | flow test dùng kết quả `vision-result.v1` tổng hợp. Ngoài test: agent đã chạy với mô hình thật ở máy cục bộ (2026-10-19, ghi trong `TEST_REPORT_2026-10-19.md`) | Máy chủ mô phỏng đạt; **agent chưa nối bản deploy** (chứng chỉ gốc Windows hết hạn, xem §4) |
| 9 | Kết quả được lưu và hiện trong báo cáo admin | `events`, `capture_sessions`, `jobs` → `GET /devices/{id}/activity` | flow test bước 9: có `fall_check`/`drink_check` `uncalibrated_output` `unverified`, **không có cảnh báo** khi chưa có quy tắc được duyệt (D11) | Mô phỏng đạt |
| 10 | Admin tạo lệnh hoặc nhắc lịch | `POST /api/admin/v1/devices/{id}/voice-commands`, `/reminders` | `admin-ops.test.ts`, flow test bước 10 | Mô phỏng đạt |
| 11 | Thiết bị lấy lệnh và báo trạng thái | `GET /commands/next`, `GET /commands/{id}/audio` (xác thực, kiểm sha256), `POST /commands/{id}/status` (`accepted`/`started`/`completed`/`failed`/`rejected`/`cancelled`) | flow test bước 11: thiết bị khác không nhận được âm thanh hay báo trạng thái thay | Mô phỏng đạt. **Phát qua MAX98357A chưa kiểm chứng** |
| 12 | Dashboard hiện đúng trạng thái máy chủ trả về | `GET /commands/{id}`, `/devices` | flow test bước 12 và test giao diện | Mô phỏng đạt |

Nhất quán định danh: `device_id` lấy từ credential (thiết bị gửi sai `device_id` → 403 `device_mismatch`), `command_id` do máy chủ cấp và là khóa xuyên suốt (lệnh, sự kiện, báo cáo), `request_id` trong mọi phản hồi lỗi và trong `audit_log`, `idempotency_key` do client sinh một lần cho mỗi ý định và được gắn tiền tố theo người thao tác. Mọi mốc thời gian lưu UTC ISO-8601; thiết bị chỉ gửi đồng hồ đơn điệu.

### Thiết bị mô phỏng và dữ liệu mô phỏng

Thiết bị mô phỏng chỉ tồn tại trong test (`test/helpers.ts`) và `integrations/carelens/local-agent/tools/sample_device.py` (chỉ trỏ backend cục bộ). Không có đường `source=simulated` nào cho production: `ACCEPT_SIMULATED_SOURCES=false` làm Worker production trả 403 `simulated_source_rejected` (có test). Khi một máy chủ chấp nhận dữ liệu mô phỏng, bảng điều khiển ghi rõ "Dữ liệu mô phỏng" trên từng bản ghi, thiết bị có bản ghi mô phỏng trong 7 ngày, và cả máy chủ nhận mô phỏng.

### Thành phần còn thiếu để có luồng thật

| Thiếu | Ai / cái gì | Ghi chú |
| --- | --- | --- |
| Mã firmware (Wi-Fi, SNTP, TLS, heartbeat, IMU, chụp, tải chunk, hỏi lệnh, phát WAV) | Việc firmware kế tiếp | Việc nhỏ nhất: bản "heartbeat + hỏi lệnh" qua TLS thật rồi mới đến camera/IMU/loa |
| Sơ đồ chân OV5640, MPU6050, MAX98357A | Owner cung cấp bo cụ thể | **Không đoán chân.** Cần model bo ESP32-S3 CAM chính xác (và nhà sản xuất), vì chân camera/PSRAM khác nhau giữa các bo |
| Kiểm chứng TLS trên ESP32 với `*.workers.dev` | Firmware | Cần gói CA; không dùng `setInsecure` |
| Bộ giải WAV 16 kHz mono PCM → I2S | Firmware | Hợp đồng âm thanh đã cố định: `DEVICE_AUDIO_SAMPLE_RATES=16000`, thiết bị kiểm sha256 trước khi phát |
| Triển khai Worker có Phase B + migration `0004`/`0005` | Owner (runbook §16) | Production hiện không có admin API (đã đo: `/ready` không có `admin_signin`, `/api/admin/v1/me` → 404) |
| Cấp phát một thiết bị production | Owner, sau khi firmware sẵn sàng | Không làm tự động |
| Hiệu chỉnh mô hình và quy tắc được duyệt | Owner (D11) | Trước đó không có cảnh báo ngã |

Chưa được coi là đã kiểm chứng cho tới khi có thiết bị thật: chụp ảnh thật, đọc IMU thật, TLS trên ESP32, phát âm thanh thật, xác nhận lệnh thật từ thiết bị, dữ liệu đầu-cuối trên production.
