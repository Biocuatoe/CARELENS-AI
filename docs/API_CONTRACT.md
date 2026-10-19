# Hợp đồng API — care-monitoring

Phiên bản 2026-10-19 (lần 2). Mã nguồn: `backend/care-monitoring/worker/src/index.ts` (định tuyến), `src/contracts.ts` (schema đầu vào, xuất ra `contracts/carelens/*.schema.json`). Trạng thái: **đã kiểm chứng bằng test cục bộ** (Vitest trong runtime Workers, test agent, test đầu-cuối với mô hình thật qua `wrangler dev`), **chưa deploy**. Hợp đồng thiết bị là **đề xuất của adapter, chưa xác minh với firmware ESP32**; chi tiết cho người viết firmware ở [`DEVICE_API.md`](DEVICE_API.md).

## Quy ước chung

| Mục | Quy ước |
| --- | --- |
| Xác thực | `Authorization: Bearer <token>`. Tiền tố: thiết bị `cld_`, agent `cla_`, người chăm sóc `clc_` (token API hoặc phiên đăng nhập web), vé stream `cls_` (chỉ ở query `ticket=` của `/api/demo/stream`), admin (token tùy ý, so SHA-256 với secret). Token sai loại luôn 401 |
| Lỗi | `application/problem+json`: `type`, `title`, `status`, `detail`, `code`, `request_id` (+ trường bổ sung như `missing_chunks`, `current_status`, `stop_playback`). Không stack trace |
| Thời gian | Máy chủ lưu UTC. Mọi yêu cầu thiết bị mang `clock = {boot_id, uptime_ms, wall_clock_synced, wall_time}`; bằng chứng thiết bị dùng **đồng hồ đơn điệu của thiết bị** (`uptime_ms` trong một `boot_id`). Thời điểm UTC của bằng chứng thiết bị là **ước lượng của máy chủ** (`device_boots.epoch_ms`). Instant RFC 3339 phải có offset |
| JSON | snake_case, schema strict (trường lạ → 422 `invalid_payload`), giới hạn kích thước (413) |
| Phân trang | `?limit=` (≤ 200) và `?cursor=` mờ; phản hồi có `next_cursor` |
| Idempotency | Burst theo `(device_id, capture_id)` (hash bỏ qua `clock.uptime_ms`); chunk theo chỉ số; IMU batch theo `(device_id, boot_id, batch_seq)`; trigger theo `trigger_id`; kết quả agent theo `idempotency_key`; lệnh theo `idempotency_key`; báo cáo theo `(recipient, ngày)` |
| Giới hạn tần suất | Rate Limiting binding theo thiết bị (120/phút), theo IP khi xác thực sai (20/phút) và theo IP cho mọi lần thử đăng nhập web (20/phút, kiểm trước mật khẩu) → 429 + `Retry-After`; hạn mức burst mỗi giờ lưu bền trong D1 |
| CORS | Chỉ origin trong `ALLOWED_ORIGINS`; header cho phép `Authorization, Content-Type, Idempotency-Key, Last-Event-ID` |

## Sức khỏe

| Route | Mô tả |
| --- | --- |
| `GET /health` | Sống, không chạm DB |
| `GET /ready` | Kiểm D1 (migrations), bindings R2/DO; báo năng lực thật: `vision_fall_rule`, `imu_fall_rule` (`not_configured…` khi chưa duyệt), `alerts` (`none_until_both_rules_are_approved`), `single_source_alerts: never`, `web_sign_in`, `legacy_stream_access`, `device_audio_sample_rates_hz`, `esp32_firmware: not_verified_with_hardware`. 503 khi chưa sẵn sàng |

## Thiết bị — `/api/device/v1` (token `cld_`)

| Route | Body → kết quả |
| --- | --- |
| `POST /heartbeat` | `device-heartbeat.v2` → `{server_time, pending_commands, clock{boot_id, estimated_boot_epoch, issues}}` |
| `POST /captures` | `capture-session.v2` → 201 `{capture, upload{frames_per_chunk, chunk_count, chunk_path_template, complete_path, max_chunk_bytes, body_format, upload_deadline}}`; cùng burst → 200; khác → 409 `capture_id_reused`; vượt hạn mức → 429 |
| `PUT /captures/{capture_id}/chunks/{i}` | `application/octet-stream`, khung `i*K … i*K+K-1`, mỗi khung `[uint32 LE độ dài][JPEG]`. 422: `invalid_chunk`, `frame_size_mismatch`, `invalid_jpeg`, `frame_dimension_mismatch`, `frame_hash_mismatch`. Gửi lại chunk đã nhận → 200 `duplicate:true` |
| `POST /captures/{capture_id}/complete` | 202 `{capture, job}`; thiếu chunk → 409 `chunks_missing` + `missing_chunks` |
| `GET /captures/{capture_id}` | Trạng thái burst, chunk đã nhận, job (không có media) — dùng để tiếp tục upload bị gián đoạn |
| `POST /imu-batches` | `imu-batch.v1` → 201 `{batch_id, sample_count, issues, decisions_made}`; trùng `(boot_id, batch_seq)` cùng nội dung → 200; khác → 409 `batch_seq_reused`; cũ hơn `IMU_MAX_BATCH_AGE_SECONDS` → 422 `batch_too_old`; DB D1 lớn hơn `IMU_STORAGE_SOFT_LIMIT_MB` → 507 `imu_storage_budget_exceeded` + `Retry-After` (chỉ IMU thô bị từ chối) |
| `POST /imu-events` | `imu-event.v2` (firmware báo luật của nó kích hoạt) → 201 `{event_id, fusion: decided|waiting}` |
| `GET /commands/next` | 204 khi không có gì; 200 `{command|null, cancel_command_ids[], server_time}` |
| `POST /commands/{id}/status` | `command-status.v2`: `accepted`, `started`, `completed`, `failed`/`rejected` (bắt buộc `reason_code`), `cancelled` (chỉ sau yêu cầu hủy). Sai chuyển trạng thái/hết hạn → 409 `invalid_transition` + `stop_playback` |
| `GET /commands/{id}/audio` | WAV của lệnh đang hoạt động; hỗ trợ `Range: bytes=a-b` (206); header `x-content-sha256` |

Đặc tả từng trường, cách tính thời gian, chu kỳ gửi và quy tắc thử lại: [`DEVICE_API.md`](DEVICE_API.md). Schema: `contracts/carelens/{capture-session.v2,imu-batch.v1,imu-event.v2,device-heartbeat.v2,command-status.v2}.schema.json`.

## Agent cục bộ — `/api/agent/v1` (token `cla_`)

| Route | Mô tả |
| --- | --- |
| `POST /jobs/claim` | `{kinds: [vision|daily_report], lease_seconds 30–900, defer_if_vision_pending}` → `{job|null, vision_backlog}`. Job: `job_id, kind, priority, attempt, max_attempts, lease_token, lease_expires_at, expires_at, payload` |
| `GET /jobs/{id}/media/{i}` | Header `X-Lease-Token`. Chunk R2 nguyên dạng; 410 khi media đã xóa |
| `POST /jobs/{id}/lease` | `{lease_token, lease_seconds}`; không vượt `expires_at` |
| `POST /jobs/{id}/release` | `{lease_token, reason}`; trả job về hàng đợi, không tính lượt |
| `POST /jobs/{id}/complete` | Header `X-Lease-Token`; body `vision-result.v1` hoặc `daily-report-result.v1`. Lặp lại cùng key → 200 `duplicate:true`; kết quả khác → 409; không nhất quán → 422 `inconsistent_result` / `report_rejected`. Phản hồi vision: `{event_ids, decision_ids, alert_ids, fusion_pending, imu_state, media_deleted}` |
| `POST /jobs/{id}/fail` | `{lease_token, error_code, retryable, detail}` → `retry_pending` hoặc `failed` |
| `POST /heartbeat` | Phiên bản, tình trạng Vision/Ollama, thống kê, `health{last_vision_completed_at, last_report_completed_at, last_failure}` (≤ 4 KB, không secret, không payload) |
| `GET /events` | SSE gợi ý `{"type":"job_available","kind":…,"priority":…}` |

Payload job `vision`: `capture_id, mode, frame_count, frame_width, frame_height, captured_at, clock{boot_id, first_uptime_ms, last_uptime_ms}, frames[{seq, t_offset_ms, size_bytes, sha256}]` (`t_offset_ms` tính từ khung 0 của **chính burst đó**), `cadence_status, cadence_tolerance_ms, checks, window_plan ([[0,23]] hoặc [[0,23],[8,31],[16,39]]), media[], imu_window{boot_id, from/until_uptime_ms, state: covered|missing|insufficient_coverage|sensor_fault, coverage, batches, fused_by: "backend"}`. Agent chỉ ghi log `imu_window`; hợp nhất IMU–hình ảnh chạy ở backend.

`vision-result.v1`: kết quả từng yêu cầu (khung, thời gian, `score`/`window_logits`/`threshold`/`alert`/`status` của fall-check; `label`/`evidence`/`status` của object-check) và các tổng hợp. Backend tự tính lại tổng hợp (`single_request.v1`, `max_request_score_overlapping.v1`, `drink_capture_aggregate.v1`) và từ chối nếu khác. Không có frame, hộp phát hiện hay thời gian xử lý.

Payload job `daily_report`: `{report_id, input (daily-report-input.v1), input_snapshot_sha256}`. `daily-report-result.v1`: `report (daily-report-llm.v1)`, `model{name, digest, runtime: ollama}`, `inference{eval_count ≥ 1, prompt_eval_count, total_duration_ms, attempts}`.

## Đăng nhập web và vé stream — `/api/app/v1`

| Route | Mô tả |
| --- | --- |
| `POST /session` | Khi `PASSWORD_SIGN_IN=disabled` (bản deploy): 403 `password_sign_in_disabled` trước mọi kiểm tra thông tin đăng nhập. Còn lại: `{username, password}` (thông tin đăng nhập do owner cấp qua admin API; `username` là email hoặc tên đăng nhập thuần `[a-z0-9._@+-]`, không phân biệt hoa thường; trường cũ `email` vẫn được nhận; mật khẩu do owner chọn được lưu bằng PBKDF2-SHA256 có salt, mật khẩu sinh tự động bằng SHA-256) → 201 `{token (clc_…), token_type, expires_at, storage: "memory_only", user, recipients[{recipient_id, role, permissions}]}`. Sai → 401 `invalid_credential` (đếm vào giới hạn theo IP). Quá 20 lần thử/60 s từ một IP → 429 `too_many_attempts`, trước khi kiểm mật khẩu. Mỗi lần đăng nhập là một phiên riêng: một tài khoản (ví dụ giám khảo dùng chung) dùng được ở nhiều trình duyệt cùng lúc |
| `DELETE /session` | Thu hồi phiên hiện tại và mọi vé chưa dùng của phiên đó → 204; phiên khác của cùng tài khoản không bị ảnh hưởng |
| `GET /auth/google/config` | Công khai → 200 `{enabled, access: "open_viewer" \| "allowlist" \| null, password_sign_in}`. Trang đăng nhập ẩn biểu mẫu mật khẩu khi `password_sign_in` là `false`. Không lộ cấu hình hay bí mật |
| `GET /auth/google/start` | Chỉ khi Google đã cấu hình (khác: 503 `google_not_configured`). Tạo state, nonce, PKCE (S256), cookie gắn trình duyệt (`cl_oauth`, HttpOnly, SameSite=Lax, theo `GOOGLE_REDIRECT_URI`), → 302 tới Google với scope `openid email`. Phải gọi trên đúng origin của `GOOGLE_REDIRECT_URI` (khác: 400 `redirect_origin_mismatch`) |
| `GET /auth/google/callback` | Google gọi về. Kiểm state một lần, chưa hết hạn (10 phút) và khớp cookie; đổi code với client secret và code_verifier; kiểm chữ ký RS256 theo JWKS của Google, `iss`, `aud`, `exp`, `nonce`, email đã xác minh; tra danh sách cho phép của owner, hoặc (khi có `GOOGLE_OPEN_VIEWER_RECIPIENT_ID`, A38) gắn theo `sub` một tài khoản chỉ xem với đúng một grant `viewer` trên hồ sơ trình diễn đó (tạo rỗng nếu chưa có; không lưu email; grant đã thu hồi không tạo lại; email trong danh sách cho phép không bao giờ rơi sang chế độ mở). Luôn → 302 `GOOGLE_POST_LOGIN_URL#code=clx_…` (mã đổi phiên 60 giây, dùng một lần) hoặc `#error=google_denied\|google_state\|google_exchange\|google_token\|google_unauthorized\|google_unavailable`. Đích chuyển hướng chỉ lấy từ cấu hình |
| `POST /session/exchange` | `{code}` (mã từ fragment) → 201 cùng dạng với `POST /session` (phiên riêng của trình duyệt, đăng xuất một nơi không ảnh hưởng nơi khác); mã sai, hết hạn hoặc đã dùng → 401 |
| `POST /stream-tickets` | `{recipient_id}`, cần `data.read` → 201 `{ticket (cls_…), expires_at (+60 s), single_use: true, stream_path}` |

Phiên hết hạn sau `SESSION_TTL_HOURS` (mặc định 12). Mật khẩu là chuỗi ngẫu nhiên 100 bit do máy chủ sinh (`xxxxx-xxxxx-xxxxx-xxxxx`, không phân biệt hoa thường), lưu SHA-256; đổi mật khẩu thu hồi mọi phiên của người đó.

## Người chăm sóc — `/api/app/v1` (token `clc_` + grant)

Quyền: `caregiver` = đọc, xử lý cảnh báo, xác minh, quản lý nhắc lịch và lời nhắn, gửi/hủy lệnh; `viewer` = chỉ đọc (dùng cho giám khảo). Không có grant → 404; thiếu quyền → 403.

| Route | Mô tả |
| --- | --- |
| `GET /me` | Hồ sơ được cấp quyền và quyền |
| `GET /recipients/{rid}/events?type=` | Sự kiện (`fall_check`, `drink_check`, `imu_trigger`) kèm bằng chứng số, `boot_id`/`uptime_*`, `ai_output_unverified` |
| `GET /recipients/{rid}/fusion-decisions` | Quyết định `fusion-rules.v2` kèm giải thích (bằng chứng hình ảnh, IMU thô: độ phủ, đặc trưng, vị trí khớp quy tắc) |
| `POST /recipients/{rid}/fusion-decisions/{id}/review` | `{verification: verified|dismissed, note}`; chỉ một lần |
| `GET /recipients/{rid}/alerts?status=` · `GET …/alerts/{id}` | Cảnh báo (luôn `provisional`, `verification_required`), quyết định và lịch sử hành động |
| `POST /recipients/{rid}/alerts/{id}/actions` | `{action: acknowledge|start|resolve, expected_version, review_outcome, note}`; resolve bắt buộc `review_outcome` và ghi chú; sai phiên bản → 409 |
| `GET /recipients/{rid}/devices` | `connection`: `connected`, `disconnected`, `never_seen`, `revoked` |
| `GET /recipients/{rid}/imu-samples?device_id=&from=&to=` | Mẫu IMU thô (≤ 10 phút/yêu cầu) để điều tra; trong thời hạn `IMU_RAW_RETENTION_HOURS` |
| `GET /recipients/{rid}/daily-reports?from=&to=` · `GET …/daily-reports/{YYYY-MM-DD}` | Báo cáo: số liệu do backend tính + tóm tắt AI có nhãn "chưa được con người xác nhận" |
| `GET/POST /recipients/{rid}/reminders` · `PATCH/DELETE …/reminders/{id}` | Lịch nhắc; PATCH cần `expected_version` |
| `GET/POST /recipients/{rid}/voice-messages?title=` · `GET/PUT …/{id}/audio` · `DELETE …/{id}` | Lời nhắn WAV PCM 16-bit mono, tần số theo `DEVICE_AUDIO_SAMPLE_RATES` (mặc định 16 kHz); mỗi lần thay là phiên bản mới, khóa R2 bất biến |
| `GET/POST /recipients/{rid}/devices/{did}/commands` | Lệnh phát lời nhắn (`idempotency_key`, `expires_in_seconds` 30–3600); phản hồi có `played_confirmed_by_device` |
| `GET /recipients/{rid}/commands/{id}` | Lệnh và dòng thời gian (`queued → delivered → accepted → started → completed`, ai báo) |
| `POST /recipients/{rid}/commands/{id}/cancel` | `queued` → hủy ngay (200); đã giao cho thiết bị → 202 "chờ thiết bị xác nhận"; còi khẩn không hủy được |
| `GET /recipients/{rid}/stream` | SSE gợi ý `{seq, type, entity_id}` (ADR-010), đóng khi grant/token bị thu hồi |

## Admin — `/api/admin/v1`

`POST /recipients`, `GET /recipients`, `POST /devices` (trả token một lần), `POST /devices/{id}/rotate-token`, `POST /devices/{id}/revoke`, `POST /agents`, `POST /agents/{id}/revoke`, `POST /caregivers`, `POST /caregivers/{id}/login` (`{login_email}` → mật khẩu hiện một lần), `POST /caregiver-tokens/{id}/revoke`, `POST /grants`, `POST /grants/{id}/revoke`, `POST /daily-reports/{id}/retry`, `GET /status` (hàng đợi và tuổi job, lỗi 24 h theo mã, lần suy luận thành công gần nhất, agent kết nối/tình trạng tự báo, liên lạc cuối và heartbeat của thiết bị, IMU 24 h, lệnh 24 h, quyết định 24 h, quy tắc đang dùng, `storage{d1_size_bytes, imu_storage_soft_limit_bytes, imu_ingest, imu_raw_retention_hours}`).

## Live Demo của frontend — `/api/demo/*`

| Route | Hành vi |
| --- | --- |
| `GET /api/demo/stream?ticket=cls_…&last_seq=` | SSE; mỗi khung `{"type":"state_update","state":{schema_version: care-monitoring-legacy-3, seq, updated_at, hubs, events, alerts, notes:[], alert_actions:[], reset_at:null, care_monitoring}}`. Keepalive 15 s; stream đóng sau `SSE_MAX_LIFETIME_SECONDS` và frontend nối lại bằng vé mới. Vé sai/đã dùng/hết hạn → 401 |
| `GET /api/demo/stream` (không vé) | Chỉ có dữ liệu khi `LEGACY_STREAM_RECIPIENT_ID` đặt **và** IP nằm trong `LEGACY_STREAM_ALLOWED_IPS` (phát triển cục bộ); ngoài ra trạng thái rỗng |
| `GET /api/demo/state` | Snapshot theo cùng quy tắc không vé |
| `POST /api/demo/command` | 410 `demo_command_removed` |

Ánh xạ: hồ sơ của vé hiện dưới persona `r_liveshowcase`; thiết bị `LEGACY_STREAM_DEVICE_ID` (hoặc thiết bị đầu tiên của hồ sơ) hiện là hub `d_hub_liveshowcase` (`online` từ liên lạc cuối có xác thực). Sự kiện: quyết định hợp nhất (`fall_like`, `type` = trạng thái hoặc kết quả xác minh, `alert_id`), quan sát uống nước/thuốc (`care_activity`), vòng đời lệnh thiết bị (`care_activity`, `type: device_command_<status>`, chỉ ghi "đã phát xong" khi thiết bị báo `completed`) và một dòng trạng thái hệ thống (`activity`, `type: system_status`, `source_mode: system`: agent cục bộ, hàng đợi, lần phân tích gần nhất, lỗi gần nhất, IMU gần nhất, trạng thái hiệu chỉnh). Cảnh báo có `version`, `policy_version`, `source_mode`. `care_level`, `latest_data`, `battery` luôn `null`.
