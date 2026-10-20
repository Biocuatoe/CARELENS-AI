# Hợp đồng API — care-monitoring

Phiên bản 2026-10-19 (lần 2). Mã nguồn: `backend/care-monitoring/worker/src/index.ts` (định tuyến), `src/contracts.ts` (schema đầu vào, xuất ra `contracts/carelens/*.schema.json`). Trạng thái: **đã kiểm chứng bằng test cục bộ** (Vitest trong runtime Workers, test agent, test đầu-cuối với mô hình thật qua `wrangler dev`). **Production (đo chỉ đọc 2026-10-19):** chạy bản trước Phase B — có các nhóm thiết bị, agent, ứng dụng, Live Demo và cấp phát; **không có** danh tính admin (ADR-020) và bảng điều khiển admin (A40), các route đó chỉ đã kiểm cục bộ; production cũng chưa có ADR-022 (`received`, hạn tải, khởi động lại) và ADR-024 (âm lượng loa), migration 0006/0007. Hợp đồng thiết bị **đã kiểm với firmware ESP32-S3 thật (`firmware/carelens-esp32s3/`) trên backend cục bộ** ngày 2026-10-19 (`docs/E2E_TEST_RESULTS.md`), chưa với Worker production; chi tiết cho người viết firmware ở [`DEVICE_API.md`](DEVICE_API.md).

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
| `POST /heartbeat` | `device-heartbeat.v2` (tùy chọn `status.speaker_volume`, `status.audio_codecs` ⊆ `["pcm_s16le","mp3"]`) → `{server_time, pending_commands, clock{boot_id, estimated_boot_epoch, issues}, config{speaker_volume, report_audio_codecs: true}}`. Thiết bị chỉ gửi `audio_codecs` khi máy chủ hỏi (ADR-025); lệnh MP3 chỉ tạo được cho thiết bị đã báo `mp3`. Heartbeat từ `boot_id` mới đóng các lệnh của boot cũ (ADR-022) |
| `POST /captures` | `capture-session.v2` → 201 `{capture, upload{frames_per_chunk, chunk_count, chunk_path_template, complete_path, max_chunk_bytes, body_format, upload_deadline}}`; cùng burst → 200; khác → 409 `capture_id_reused`; vượt hạn mức → 429 |
| `PUT /captures/{capture_id}/chunks/{i}` | `application/octet-stream`, khung `i*K … i*K+K-1`, mỗi khung `[uint32 LE độ dài][JPEG]`. 422: `invalid_chunk`, `frame_size_mismatch`, `invalid_jpeg`, `frame_dimension_mismatch`, `frame_hash_mismatch`. Gửi lại chunk đã nhận → 200 `duplicate:true` |
| `POST /captures/{capture_id}/complete` | 202 `{capture, job}`; thiếu chunk → 409 `chunks_missing` + `missing_chunks` |
| `GET /captures/{capture_id}` | Trạng thái burst, chunk đã nhận, job (không có media) — dùng để tiếp tục upload bị gián đoạn |
| `POST /imu-batches` | `imu-batch.v1` → 201 `{batch_id, sample_count, issues, decisions_made}`; trùng `(boot_id, batch_seq)` cùng nội dung → 200; khác → 409 `batch_seq_reused`; cũ hơn `IMU_MAX_BATCH_AGE_SECONDS` → 422 `batch_too_old`; DB D1 lớn hơn `IMU_STORAGE_SOFT_LIMIT_MB` → 507 `imu_storage_budget_exceeded` + `Retry-After` (chỉ IMU thô bị từ chối) |
| `POST /imu-events` | `imu-event.v2` (firmware báo luật của nó kích hoạt) → 201 `{event_id, fusion: decided|waiting}` |
| `GET /commands/next` | 204 khi không có gì; 200 `{command|null, cancel_command_ids[], server_time}` |
| `POST /commands/{id}/status` | `command-status.v2`: `received` (ADR-022: ghi `received_at`, trạng thái vẫn `delivered`, không giao lại), `accepted`, `started` (lệnh có âm thanh: chỉ sau `accepted`), `completed`, `failed`/`rejected` (bắt buộc `reason_code`, gồm `device_rebooted`, `download_timeout`), `cancelled` (chỉ sau yêu cầu hủy). Sai chuyển trạng thái/hết hạn → 409 `invalid_transition` + `stop_playback` |
| `GET /commands/{id}/audio` | Đúng các byte đã tải lên của bản ghi lệnh đang hoạt động: `audio/mpeg` (ADR-025) hoặc `audio/wav` cho bản ghi cũ, theo `content_type` đã lưu; hỗ trợ `Range: bytes=a-b` (206); header `x-content-sha256` |

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
| `GET/POST /recipients/{rid}/voice-messages?title=` · `GET/PUT …/{id}/audio` · `DELETE …/{id}` | Lời nhắn MP3 (ADR-025): thân `audio/mpeg` thô, MPEG Layer III, 8–48 kHz, mono/stereo, 0,5–60 s, ≤ 2 MB; WAV → 415 `mp3_required`; tệp hỏng/ghép/cắt cụt → 422 `invalid_audio`. Lưu và trả nguyên tệp; bản ghi WAV cũ vẫn đọc được với `content_type audio/wav`. Danh sách có `format` (hợp đồng MP3) và `legacy_format` (WAV: chỉ phát). Mỗi lần thay là phiên bản mới, khóa R2 bất biến |
| `GET/POST /recipients/{rid}/devices/{did}/commands` | Lệnh phát lời nhắn (`idempotency_key`, `expires_in_seconds` 30–3600); phản hồi có `played_confirmed_by_device` |
| `GET /recipients/{rid}/commands/{id}` | Lệnh và dòng thời gian (`queued → delivered → accepted → started → completed`, ai báo) |
| `POST /recipients/{rid}/commands/{id}/cancel` | `queued` → hủy ngay (200); đã giao cho thiết bị → 202 "chờ thiết bị xác nhận"; còi khẩn không hủy được |
| `GET /recipients/{rid}/stream` | SSE gợi ý `{seq, type, entity_id}` (ADR-010), đóng khi grant/token bị thu hồi |

## Admin — `/api/admin/v1`

### Danh tính admin (ADR-020, Phase B)

Chỉ đã kiểm cục bộ (test Worker). Admin là principal thứ ba, tách khỏi người xem/người chăm sóc (`clc_`), thiết bị (`cld_`) và agent (`cla_`).

| Route | Mô tả |
| --- | --- |
| `GET /api/app/v1/auth/google/start?mode=admin` | Bắt đầu luồng Google cho admin (cùng luồng PKCE/state/nonce như người xem). `mode` chỉ nhận `viewer` (mặc định) hoặc `admin`; giá trị khác → 400 `invalid_mode`. Danh sách bootstrap rỗng → 503 `admin_signin_not_configured`; sai định dạng → 503 `misconfigured`. Mục đích luồng được lưu cùng state (`oauth_states.purpose`), callback đọc từ DB, không từ request |
| `GET /api/app/v1/auth/google/callback` | Với luồng admin: email đã xác minh phải nằm trong secret `ADMIN_BOOTSTRAP_EMAILS` (vai `owner`) hoặc là hàng `admins` đang hoạt động (vai `admin`). Gắn `sub` ở lần đầu; cùng email với `sub` khác bị từ chối. Luôn → 302 `<origin của GOOGLE_POST_LOGIN_URL>/admin/login#admin_code=cax_…` (mã 60 giây, một lần) hoặc `#error=…`. Không dùng danh sách cho phép người xem hay chế độ người xem mở |
| `POST /api/admin/v1/session/exchange` | `{code}` (chặt, không nhận trường khác) → 201 `{token: "clm_…", token_type, expires_at, storage: "memory_only", admin: {admin_id, role}}`. Phiên sống `ADMIN_SESSION_TTL_MINUTES` (mặc định 120; 15–720). Mã sai, hết hạn hoặc đã dùng → 401; mã của người xem không dùng được ở đây và ngược lại |
| `DELETE /api/admin/v1/session` | Thu hồi đúng phiên này → 204. Token tĩnh không có phiên → 400 `no_session` |
| `GET /api/admin/v1/me` | `{auth_method: "session", admin_id, email, role, session: {expires_at, authenticated_at}}`; với token tĩnh: `{auth_method: "static_token", admin_id: null, role: null}`. Không trả token, `sub` hay cấu hình |

Mọi route `/api/admin/v1/*` (trừ `session/exchange`) kiểm ở máy chủ: phiên `clm_` còn hạn, chưa thu hồi, admin `active`; `owner` chỉ hợp lệ khi email còn trong `ADMIN_BOOTSTRAP_EMAILS` (đổi secret là thu hồi owner ngay). Token tĩnh `ADMIN_TOKEN_SHA256` vẫn chạy nếu được đặt (production để trống). Chưa cấu hình gì → 503 `admin_not_configured`; đã cấu hình mà không có token hợp lệ → 401. Nhật ký audit ghi `actor_id = admin_id` (token tĩnh vẫn ghi `admin`).

### Cấp phát (token tĩnh hoặc phiên admin)

`POST /recipients`, `GET /recipients`, `POST /devices` (trả token một lần), `POST /devices/{id}/rotate-token`, `POST /devices/{id}/revoke`, `POST /agents`, `POST /agents/{id}/revoke`, `POST /caregivers`, `POST /caregivers/{id}/login` (`{login_email}` → mật khẩu hiện một lần), `POST /caregiver-tokens/{id}/revoke`, `POST /grants`, `POST /grants/{id}/revoke`, `POST /daily-reports/{id}/retry`, `GET /status` (hàng đợi và tuổi job, lỗi 24 h theo mã, lần suy luận thành công gần nhất, agent kết nối/tình trạng tự báo, liên lạc cuối và heartbeat của thiết bị, IMU 24 h, lệnh 24 h, quyết định 24 h, quy tắc đang dùng, `storage{d1_size_bytes, imu_storage_soft_limit_bytes, imu_ingest, imu_raw_retention_hours}`).

### Bảng điều khiển admin (A40): ma trận giao diện ↔ API

Đã kiểm cục bộ bằng test Worker (`test/admin-ops.test.ts`, `test/device-flow.test.ts`) và test giao diện; **chưa chạy trên production** (Worker production hiện không có các route này, xem `docs/DEPLOYMENT_RUNBOOK.md` §16). Mọi route dưới đây cần phiên admin `clm_` hợp lệ (hoặc token tĩnh nếu được đặt); token người chăm sóc, người xem, thiết bị, agent → 401. Vai trò: `owner` và `admin` có cùng quyền ở các route này (chưa có phân quyền theo vai trò). Mọi thay đổi (POST) có `confirm: true` bắt buộc ở máy chủ, giới hạn 20 thay đổi mỗi phút mỗi admin (429 `rate_limited`, `retry-after`), và ghi `audit_log` cùng giao dịch (id và enum, không có nội dung nhắc, token hay âm thanh).

| Tính năng | Route | Yêu cầu | Phản hồi | Lưu trữ / hành vi | Lỗi chính |
| --- | --- | --- | --- | --- | --- |
| Khả năng của máy chủ | `GET /capabilities` | — | `{tts{available:false,…}, audio{content_type:"audio/mpeg", codec:"mp3", sample_rates_hz, channels:[1,2], max_bytes, min/max_duration_ms, device_requirement:"audio_codecs_reports_mp3", legacy_wav{upload:"refused", playback:"supported",…}}, commands, reminders{timezone,scheduler,…}, report, device_playback:"not_verified_with_hardware"}` | Suy ra từ cấu hình, không ghi | — |
| Sổ thiết bị | `GET /devices` | — | `{items:[{device_id,recipient_id,label,status,firmware_version,credential{state,version},last_seen_at,connected,heartbeat{at,status}\|null,last_capture,last_event,last_inference_at,commands{active,last_24h},has_simulated_records_7d,audio_codecs[],…}],simulated_sources}` | Đọc `devices` + tổng hợp lệnh/chụp/sự kiện/job. **Không bao giờ chọn `token_sha256`** | — |
| Chi tiết thiết bị | `GET /devices/{id}` | — | `{device, last_boot}` | như trên + `device_boots` | 404 |
| Báo cáo hoạt động theo ngày | `GET /devices/{id}/activity?date=YYYY-MM-DD` | `date` là ngày lịch theo `REPORT_TIMEZONE` | `{device,date,timezone,period{start,end,interval:"[start, end)"},in_future,sources{<nguồn>:{status:ok\|truncated\|partial\|retention_expired\|not_stored,count,note}},entries[{at,source,kind,ref_id,source_mode,status,detail}]}` | Đọc `device_boots`, `device_presence`, `events`, `capture_sessions`, `imu_batches` (gộp theo giờ UTC), `fusion_decisions`, `alerts`, `device_commands` + `device_command_events`, `jobs`, `audit_log`. Mỗi bản ghi thuộc đúng một ngày theo mốc thời gian chính của nó (`>= start AND < end`). Tối đa 300 dòng/nguồn, quá thì `truncated`. Không có ảnh, khóa R2, mẫu IMU thô, credential | 400 `invalid_date`, 404, 422 `date_out_of_range` |
| Danh sách bản ghi âm | `GET /devices/{id}/voice-messages` | — | `{items:[{voice_message_id,title,created_by,audio{sample_rate_hz,duration_ms,byte_size,…}}],format}` | Đọc `audio_assets` của hồ sơ gắn với thiết bị | 404 |
| Tải bản ghi âm lên | `POST /devices/{id}/voice-messages?title=` | thân `audio/mpeg` thô (MP3 Layer III, 8–48 kHz, mono/stereo, 0,5–60 s, ≤ 2 MB; ADR-025) | 201 `{voice_message{…, audio{content_type, sample_rate_hz, channels, bits_per_sample: 0, duration_ms, byte_size, sha256}}}` | R2 `AUDIO` riêng tư, khóa `…/vN.mp3`, nguyên tệp + `audio_assets`/`audio_asset_versions`, `created_by = admin:<admin_id>`; audit `voice.upload` | 413, 415 `mp3_required` (WAV hay kiểu khác), 422 `invalid_audio`, 400 `title_required`, 404 (thiết bị không tồn tại hoặc đã thu hồi), 429 |
| Nghe thử | `GET /voice-messages/{id}/audio` | — | `content_type` đã lưu (`audio/mpeg`, hoặc `audio/wav` cho bản ghi cũ), `cache-control: private, no-store` | Đọc R2; không có URL chia sẻ được | 404, 410 |
| Gửi âm thanh | `POST /devices/{id}/voice-commands` | `{voice_message_id, idempotency_key(8–128), expires_in_seconds(30–3600), confirm:true}` | 201 `{command,created:true}` hoặc 200 `{created:false}` khi lặp | Tạo `play_voice_message` đúng giao thức thiết bị (`source_type='caregiver'`, `created_by='admin:<id>'`); khóa idempotency được gắn tiền tố theo admin. Audit `command.create` | 404, 422 (`voice_message_not_found`, `audio_not_playable`: MP3 cho thiết bị chưa báo `audio_codecs` có `mp3`, hoặc WAV cũ ngoài `DEVICE_AUDIO_SAMPLE_RATES`; thiếu `confirm`), 409 `idempotency_key_reused`, 429 |
| Danh sách lệnh | `GET /devices/{id}/commands?limit&cursor` | — | `{items:[command…],next_cursor}` với `status`, `played_confirmed_by_device`, các mốc `delivered/received/accepted/started/finished`, `download_deadline_at` (khi đã `received`), `created_by` | Đọc `device_commands` | 404, 400 |
| Âm lượng loa (ADR-024) | `PUT /devices/{id}/speaker-volume` | `{volume(0,05–0,70, bước 0,05), confirm:true}` | 200 `{device_id, speaker{desired_volume, desired_set_at, delivery:"next_heartbeat"}}` | `devices.speaker_volume` (migration 0007), gửi cho thiết bị trong phản hồi heartbeat; `GET /devices/{id}` có `speaker{desired_volume, desired_set_at, reported_volume, reported_at}`, `reported_*` chỉ từ heartbeat của thiết bị. Audit `device.speaker_volume`, tính vào 20 thay đổi/phút | 404 (thiết bị không hoạt động), 422, 429 |
| Diễn tiến lệnh | `GET /commands/{id}` | — | `{command, timeline:[{seq,status,reason,actor_type,at}]}` | Đọc `device_command_events` | 404 |
| Hủy lệnh | `POST /commands/{id}/cancel` | `{}` | 200 (đang chờ: hủy ngay) hoặc 202 `cancel_pending_device_confirmation` (thiết bị đã nhận: chờ thiết bị xác nhận); còi khẩn cấp không hủy được | Audit `command.cancel` | 404, 409 `not_cancellable` |
| Danh sách nhắc lịch | `GET /devices/{id}/reminders` | — | `{items:[{reminder_id,kind,label,schedule_kind:once\|recurring,state:scheduled\|paused\|cancelled\|finished,next_occurrence_at,window_open,paused_at,last_dispatch{command_id,status,played_confirmed_by_device,…}}],timezone}` | Đọc `reminder_schedules` + lệnh gần nhất của mỗi nhắc lịch | 404 |
| Tạo nhắc lịch | `POST /devices/{id}/reminders` | `{idempotency_key,kind:medication\|water,label(1–120),voice_message_id\|null,deadline_minutes(1–240),schedule:{type:"once",local_date,local_time}\|{type:"weekly",days_of_week,times_local,start_date,end_date\|null},confirm:true}`; giờ theo `REPORT_TIMEZONE` | 201 `{reminder,created:true}` hoặc 200 khi lặp | Ghi `reminder_schedules`; `reminder_id` suy ra từ (admin, khóa) nên gửi lặp không tạo bản thứ hai. Tác vụ định kỳ mỗi phút tạo đúng một lệnh cho mỗi lần hẹn (khóa `reminder:<id>:<occurrence>`). Audit `reminder.create` | 422 `schedule_in_past` (cách hiện tại < 30 s), `schedule_too_far` (> 366 ngày), `no_future_occurrence`, `invalid_date_range`, `audio_not_playable`, 409 `idempotency_key_reused` |
| Tạm dừng / tiếp tục / hủy | `POST /reminders/{id}/pause\|resume\|cancel` | `{}` | `{reminder,duplicate}` | `paused_at` (migration 0005) hoặc `status='cancelled'`; lệnh đang chờ của nhắc lịch bị hủy, lệnh thiết bị đang giữ được yêu cầu hủy. Audit `reminder.pause\|resume\|cancel` | 404, 409 `reminder_cancelled`, 409 `schedule_finished` (không tiếp tục được lịch hết lượt) |
| Nhật ký audit | `GET /audit?limit&cursor&action_prefix=` | `action_prefix` chỉ gồm `a-z . _` | `{items:[{audit_id,at,actor_type,actor_id,action,target_*,outcome,request_id,detail}],next_cursor}` mới nhất trước | Đọc `audit_log` | 400 |

**Quy ước trạng thái lệnh (từ giao thức thiết bị; ADR-022 thêm báo cáo `received` không đổi trạng thái):** `queued → delivered (→ received) → accepted → started → completed`; rẽ nhánh `failed`/`rejected` (thiết bị báo, có `reason_code`), `expired`, `cancelled`, `superseded`. `played_confirmed_by_device` chỉ `true` khi thiết bị tự báo `completed`; `queued`/`delivered` không bao giờ nghĩa là đã phát.

**Chưa có (không giả lập):** chuyển văn bản thành giọng nói (không có dịch vụ nào; `/capabilities.tts.available=false`), đăng ký/xoay/thu hồi credential trong giao diện (route cấp phát có sẵn nhưng giao diện không dùng, xem A40), lịch sử heartbeat theo ngày (chỉ lưu heartbeat gần nhất), lịch sử online/offline của thiết bị và agent, xóa bản ghi âm bởi admin, phân quyền theo vai trò admin.

## Live Demo của frontend — `/api/demo/*`

| Route | Hành vi |
| --- | --- |
| `GET /api/demo/stream?ticket=cls_…&last_seq=` | SSE; mỗi khung `{"type":"state_update","state":{schema_version: care-monitoring-legacy-3, seq, updated_at, hubs, events, alerts, notes:[], alert_actions:[], reset_at:null, care_monitoring}}`. Keepalive 15 s; stream đóng sau `SSE_MAX_LIFETIME_SECONDS` và frontend nối lại bằng vé mới. Vé sai/đã dùng/hết hạn → 401 |
| `GET /api/demo/stream` (không vé) | Chỉ có dữ liệu khi `LEGACY_STREAM_RECIPIENT_ID` đặt **và** IP nằm trong `LEGACY_STREAM_ALLOWED_IPS` (phát triển cục bộ); ngoài ra trạng thái rỗng |
| `GET /api/demo/state` | Snapshot theo cùng quy tắc không vé |
| `POST /api/demo/command` | 410 `demo_command_removed` |

Ánh xạ: hồ sơ của vé hiện dưới persona `r_liveshowcase`; thiết bị `LEGACY_STREAM_DEVICE_ID` (hoặc thiết bị đầu tiên của hồ sơ) hiện là hub `d_hub_liveshowcase` (`online` từ liên lạc cuối có xác thực). Sự kiện: quyết định hợp nhất (`fall_like`, `type` = trạng thái hoặc kết quả xác minh, `alert_id`), quan sát uống nước/thuốc (`care_activity`), vòng đời lệnh thiết bị (`care_activity`, `type: device_command_<status>`, chỉ ghi "đã phát xong" khi thiết bị báo `completed`) và một dòng trạng thái hệ thống (`activity`, `type: system_status`, `source_mode: system`: agent cục bộ, hàng đợi, lần phân tích gần nhất, lỗi gần nhất, IMU gần nhất, trạng thái hiệu chỉnh). Cảnh báo có `version`, `policy_version`, `source_mode`. `care_level`, `latest_data`, `battery` luôn `null`.
