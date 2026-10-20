# Giao thức thiết bị ESP32-S3 CAM ↔ care-monitoring

Phiên bản 2026-10-19 (bổ sung ADR-022 và ADR-024 cùng ngày). Dành cho người viết firmware. Trạng thái: **Đề xuất** (ADR-019, ADR-022, ADR-024). **Đã kiểm chứng trên ESP32-S3 thật với backend cục bộ** (`firmware/carelens-esp32s3/`, `docs/E2E_TEST_RESULTS.md`): heartbeat, lệnh âm thanh đủ vòng đời, lô IMU thô, burst ảnh, âm lượng từ xa, 9 kịch bản lỗi. **Chưa chạy với Worker production**: production chưa có ADR-022/024 và migration 0004–0007 (`docs/PRODUCTION_ROLLOUT_READINESS.md`). Harness `integrations/carelens/local-agent/tools/sample_device.py` vẫn dùng cho test. Đánh giá sẵn sàng và kế hoạch thử đầu tiên: `docs/ESP32_READINESS.md`. Schema chính thức: `contracts/carelens/*.schema.json` (sinh từ `backend/care-monitoring/worker/src/contracts.ts`), ví dụ hợp lệ ở `contracts/carelens/fixtures/valid/`.

## 1. Xác thực

| Mục | Quy định |
| --- | --- |
| Token | `cld_…` do owner tạo bằng `python scripts/admin.py --api … device --id … --recipient … --label …`, hiện một lần. Lưu trong NVS mã hóa của ESP32. Máy chủ chỉ giữ SHA-256 |
| Header | `Authorization: Bearer cld_…` cho mọi yêu cầu |
| Danh tính | `device_id` trong body phải trùng thiết bị của token (khác → 403 `device_mismatch`). Thiết bị không bao giờ gửi `recipient_id`; hồ sơ lấy từ token |
| Thu hồi / xoay | 401 sau khi owner thu hồi hoặc xoay token: dừng gửi, báo lỗi cục bộ, chờ cấp lại. Không thử lại vòng lặp nhanh |
| Bí mật khác | Firmware không chứa token admin, agent hay bất kỳ secret Cloudflare nào |
| Mạng | Chỉ HTTPS tới URL Worker (ví dụ `https://care-monitoring.<subdomain>.workers.dev`), kiểm chứng chỉ TLS |
| TLS thực tế (đã đo bằng `openssl s_client`, 2026-10-19) | Bản deploy `care-monitoring.care-monitoring-worker.workers.dev` trình chuỗi **ECDSA**: lá P-256 (Let's Encrypt `YE2`) → `Root YE` → `ISRG Root X2` (ký chéo bởi `ISRG Root X1`). Chấp nhận TLS 1.2 và 1.3. Chuỗi do Cloudflare chọn và có thể đổi (nhà phát hành khác, ví dụ Google Trust Services). Firmware phải: bật bộ mã ECDHE-ECDSA và đường cong secp256r1 + secp384r1 của mbedTLS; có gốc tin cậy phù hợp (kho gốc của ESP-IDF hoặc ghim **ISRG Root X1**, hết hạn 2035, và dự phòng khi nhà phát hành đổi); **đồng bộ SNTP trước yêu cầu HTTPS đầu tiên**, vì kiểm hạn chứng chỉ cần giờ đúng (giờ 1970 làm bắt tay lỗi). **Đã kiểm trên ESP32-S3 thật (2026-10-19):** firmware tích hợp (Arduino-ESP32 3.3.8, mbedTLS 3.6.5) dùng bộ chứng chỉ đầy đủ của ESP-IDF, `GET /health` của `workers.dev` → 200 sau 2,4 s, xác minh chuỗi và tên máy chủ, không token (lệnh console `tlscheck`) |

## 2. Đồng hồ (bắt buộc trong mọi yêu cầu)

```json
"clock": { "boot_id": "boot-7f3a91c2", "uptime_ms": 3601600, "wall_clock_synced": true, "wall_time": "2026-10-19T01:00:06.100Z" }
```

| Trường | Quy định |
| --- | --- |
| `boot_id` | Chuỗi ngẫu nhiên 8–64 ký tự `[A-Za-z0-9._:-]`, sinh mới **mỗi lần khởi động** (ví dụ 6 byte `esp_random()` dạng hex) |
| `uptime_ms` | `esp_timer_get_time() / 1000` (64-bit) tại lúc **dựng** body. Không dùng `millis()` 32-bit (tràn sau 49,7 ngày) |
| `wall_clock_synced` | `true` chỉ sau khi SNTP đồng bộ thành công trong boot này |
| `wall_time` | Giờ tường RFC 3339 có offset khi đã đồng bộ, ngược lại `null` (gửi giờ tường khi chưa đồng bộ → 422 `invalid_clock`) |

Mọi mốc thời gian của bằng chứng (khung ảnh, mẫu IMU, kích hoạt) là `uptime_ms` của cùng boot. Máy chủ ước lượng UTC của `uptime_ms = 0` bằng giá trị nhỏ nhất của (thời điểm nhận − `clock.uptime_ms`) trong boot đó, nên sai lệch chỉ bằng độ trễ mạng nhỏ nhất (thường < 1 s). Hợp nhất IMU–hình ảnh so sánh `uptime_ms` trực tiếp, nên đồng hồ tường sai hoặc chưa đồng bộ không ảnh hưởng. Bằng chứng khác `boot_id` không bao giờ được ghép theo thời gian. Lệch giờ tường > 2 s so với máy chủ được ghi cờ chẩn đoán.

**Ví dụ trong tài liệu này:** khối JSON của heartbeat, `imu-event.v2` và `command-status.v2` đã được kiểm với schema thật và hợp lệ (2026-10-19). Ví dụ `capture-session.v2` và `imu-batch.v1` được **rút gọn bằng "…"** nên không gửi nguyên văn được; dùng fixture đầy đủ `contracts/carelens/fixtures/valid/capture-session.v2.{normal,triggered}.json` và `imu-batch.v1.raw-100hz.json` làm mẫu cấu trúc. Đó là dữ liệu thử, không phải bằng chứng từ cảm biến.

## 3. Vòng lặp gợi ý

| Việc | Nhịp gợi ý | Ghi chú |
| --- | --- | --- |
| `POST /api/device/v1/heartbeat` | 60 s | Trạng thái camera/IMU/loa; phản hồi có `pending_commands` |
| `GET /api/device/v1/commands/next` | 5–10 s, và ngay khi heartbeat báo `pending_commands > 0` | 204 khi không có gì |
| `POST /api/device/v1/imu-batches` | Mỗi 1–10 s khi gửi liên tục; hoặc xả bộ đệm vòng quanh mỗi burst/kích hoạt. Trên Workers Free chỉ quanh sự kiện (dung lượng: `docs/DEPLOYMENT_RUNBOOK.md` §13) | Phải phủ cửa sổ của mọi burst ít nhất ±3 s |
| Burst thường (24 khung) | ≤ `MAX_NORMAL_CAPTURES_PER_HOUR` (mặc định 60/giờ) | Vượt → 429 |
| Burst kích hoạt (40 khung) | Khi luật IMU của firmware kích hoạt; ≤ 20/giờ | Kèm `imu-event.v2` |

Free plan Cloudflare chịu được khoảng 1 burst/phút/thiết bị (A30); chụp liên tục cần Workers Paid.

## 4. Heartbeat — `POST /api/device/v1/heartbeat`

```json
{
  "schema_version": "device-heartbeat.v2",
  "device_id": "esp32-cam-example",
  "clock": { "boot_id": "boot-7f3a91c2", "uptime_ms": 3605000, "wall_clock_synced": true, "wall_time": "2026-10-19T01:00:09.500Z" },
  "firmware_version": "fw-example-0.1",
  "status": { "camera": "ok", "imu": "ok", "speaker": "ok", "wifi_rssi_dbm": -61, "free_heap_bytes": 143000, "last_error": null }
}
```

`camera|imu|speaker`: `ok|error|disabled|unknown`. `last_error`: mã ngắn `[a-z0-9_:.-]`, không văn bản tự do, không secret. `speaker_volume` (tùy chọn, 0–1, ADR-024): âm lượng thiết bị đang dùng; **chỉ gửi khi phản hồi heartbeat có `config`** (Worker cũ từ chối trường lạ). `audio_codecs` (tùy chọn, ADR-025): codec firmware phát được, ⊆ `["pcm_s16le","mp3"]`; **chỉ gửi khi phản hồi có `config.report_audio_codecs: true`** (§8.3). Giới hạn 4 KB.

Phản hồi 200: `{server_time, pending_commands, clock{boot_id, estimated_boot_epoch, issues}, config{speaker_volume, report_audio_codecs}}`. `config.speaker_volume` là mức admin đặt (0,05–0,70) hoặc `null` (giữ mức của thiết bị). Thiết bị áp dụng, lưu lại qua lần khởi động, và báo mức thật ở heartbeat kế; dashboard chỉ coi là đã áp dụng khi thiết bị báo.

Heartbeat từ `boot_id` mới cũng là tín hiệu khởi động lại cho các lệnh (§8.2 mục 9). Firmware gửi heartbeat ngay sau khi kết nối, trước `commands/next`.

## 5. Burst ảnh

Một burst là 24 khung (`normal`) hoặc 40 khung (`triggered`) JPEG, 8 fps danh định, ghi **liên tục, không qua khoảng tắt camera**. Không ghép khung của hai burst.

### 5.1 Manifest — `POST /api/device/v1/captures`

```json
{
  "schema_version": "capture-session.v2",
  "source_mode": "device",
  "device_id": "esp32-cam-example",
  "capture_id": "cap-000124",
  "mode": "triggered",
  "clock": { "boot_id": "boot-7f3a91c2", "uptime_ms": 3606275, "wall_clock_synced": true, "wall_time": "2026-10-19T01:00:10.775Z" },
  "frame_count": 40,
  "nominal_fps": 8,
  "content_type": "image/jpeg",
  "frame_width": 320,
  "frame_height": 240,
  "frames": [ { "seq": 0, "uptime_ms": 3600000, "size_bytes": 12000, "sha256": "…64 hex…" }, "… 40 mục …" ],
  "trigger_id": "trg-000045",
  "trigger_frame_index": 12,
  "firmware_version": "fw-example-0.1"
}
```

| Quy tắc | Lỗi nếu sai (422) |
| --- | --- |
| `mode=normal` ↔ 24 khung, `mode=triggered` ↔ 40 khung, `frames` đúng số lượng | `frame_count_mode_mismatch`, `frame_list_length` |
| `seq` 0…n−1 theo thứ tự | `invalid_sequence` |
| `frames[].uptime_ms` tăng nghiêm ngặt, ≤ `clock.uptime_ms`, cả burst ≤ 60 s | `invalid_timing` |
| Khung ≤ 200 000 byte, ≤ 640×480, JPEG baseline/progressive | `frame_too_large` |
| `trigger_id` bắt buộc khi `triggered`, cấm khi `normal` | `trigger_required`, `trigger_not_allowed` |
| Burst không cũ hơn `MAX_CAPTURE_AGE_SECONDS` (600 s) | `capture_too_old` |
| `source_mode: device` (`simulated` bị 403 ở môi trường thật) | `simulated_source_rejected` |

Khoảng cách khung danh định 125 ms ± `CADENCE_TOLERANCE_MS` (40). Khoảng > 187 ms (mất khung) được ghi `cadence_status: gap`; agent **bỏ qua suy luận ngã** của burst đó và nói rõ lý do, không nội suy.

Phản hồi 201: `{created, capture, upload{frames_per_chunk (K, mặc định 8), chunk_count, chunk_path_template, complete_path, max_chunk_bytes, body_format, upload_deadline}}`. Gửi lại đúng manifest (kể cả `clock.uptime_ms` mới) → 200 `created:false`. Cùng `capture_id` nhưng khung khác → 409 `capture_id_reused`. Quá hạn mức → 429 + `Retry-After`.

### 5.2 Chunk — `PUT /api/device/v1/captures/{capture_id}/chunks/{i}`

`Content-Type: application/octet-stream`. Body: khung `i*K … i*K+K−1`, mỗi khung `[uint32 little-endian độ dài][byte JPEG]`. Máy chủ kiểm từng khung: độ dài = `size_bytes`, JPEG hợp lệ, kích thước = khai báo, SHA-256 = manifest. Lỗi 422: `invalid_chunk`, `frame_size_mismatch`, `invalid_jpeg`, `frame_dimension_mismatch`, `frame_hash_mismatch`. Gửi lại chunk đã nhận → 200 `duplicate:true` (an toàn khi thử lại).

### 5.3 Hoàn tất — `POST /api/device/v1/captures/{capture_id}/complete`

202 `{capture, job}`. Thiếu chunk → 409 `chunks_missing` + `missing_chunks[]`. Gọi lại sau khi đã hoàn tất → 200 `duplicate:true`.

### 5.4 Tiếp tục sau gián đoạn

`GET /api/device/v1/captures/{capture_id}` trả `chunks_received[]` và `upload_deadline`. Gửi các chunk còn thiếu rồi `complete`. Quá `UPLOAD_SESSION_TTL_SECONDS` (120 s) phiên hết hạn (`expired`, `upload_incomplete`), chunk đã nhận bị xóa; burst đó không thể hoàn tất — bắt đầu burst mới với `capture_id` mới.

## 6. IMU thô — `POST /api/device/v1/imu-batches`

```json
{
  "schema_version": "imu-batch.v1",
  "source_mode": "device",
  "device_id": "esp32-cam-example",
  "clock": { "boot_id": "boot-7f3a91c2", "uptime_ms": 3601250, "wall_clock_synced": true, "wall_time": "2026-10-19T01:00:05.750Z" },
  "batch_seq": 361,
  "sensor": "mpu6050",
  "sample_rate_hz": 100,
  "accel_range_g": 8,
  "gyro_range_dps": 1000,
  "units": { "time": "ms_since_boot", "accel": "g", "gyro": "deg_per_s" },
  "samples": { "uptime_ms": [3601000, 3601010, "…"], "ax": [0.01, "…"], "ay": ["…"], "az": ["…"], "gx": ["…"], "gy": ["…"], "gz": ["…"] }
}
```

| Quy tắc | Lỗi |
| --- | --- |
| Đơn vị cố định: gia tốc **g**, con quay **°/s**, thời gian **ms từ khi khởi động**. Đổi từ raw MPU6050: `raw / LSB_per_g` theo `accel_range_g`, `raw / LSB_per_dps` theo `gyro_range_dps` | Đơn vị khác → 422 (schema) |
| 1–1000 mẫu, sáu cột cùng độ dài như `uptime_ms` | `imu_length_mismatch` |
| `uptime_ms` tăng nghiêm ngặt, ≤ `clock.uptime_ms`, cả lô ≤ 120 s | `imu_timing` |
| Giá trị trong dải đo ±5 % | `imu_out_of_range` |
| Số hữu hạn (không NaN/Infinity) | 422 |
| Lô kết thúc không cũ hơn `IMU_MAX_BATCH_AGE_SECONDS` (3600 s) | `batch_too_old` |
| `batch_seq` tăng 1 mỗi lô trong một boot, về 0 khi khởi động lại | Trùng `batch_seq` khác nội dung → 409 `batch_seq_reused`; cùng nội dung → 200 `created:false` |
| Máy chủ còn chỗ lưu IMU thô (DB D1 dưới `IMU_STORAGE_SOFT_LIMIT_MB`) | 507 `imu_storage_budget_exceeded` + `Retry-After: 600`: chưa gửi lại lô đó trước `Retry-After` (có thể bỏ lô cũ khỏi bộ đệm vòng); burst, kích hoạt, heartbeat, lệnh vẫn gửi bình thường |

Máy chủ **không sửa, không nội suy, không bịa mẫu**. Cờ chất lượng (không chặn): khoảng hở > 3 chu kỳ, tần số trung vị lệch > 20 % so với `sample_rate_hz`, chạm dải đo (có thể bị cắt), thiếu lô trước đó (`seq_gap_before`), lô đến muộn. Lưu `IMU_RAW_RETENTION_HOURS` (72 h). Phản hồi 201 `{batch_id, sample_count, issues, decisions_made}`.

Để hợp nhất được, mẫu IMU phải phủ cửa sổ của burst: tỉ lệ ≥ 0,8 số mẫu kỳ vọng và không hở > 500 ms (A33). Gửi IMU trước hay sau burst đều được; quyết định chờ tối đa `imu_wait_seconds` (60 s) sau burst.

## 7. Kích hoạt của firmware — `POST /api/device/v1/imu-events`

```json
{
  "schema_version": "imu-event.v2",
  "source_mode": "device",
  "device_id": "esp32-cam-example",
  "clock": { "boot_id": "boot-7f3a91c2", "uptime_ms": 3601600, "wall_clock_synced": true, "wall_time": "2026-10-19T01:00:06.100Z" },
  "trigger": { "trigger_id": "trg-000045", "trigger_type": "impact", "triggered_uptime_ms": 3601500, "firmware_rule_version": "fw-imu-example-0", "capture_id": "cap-000124", "device_metrics": { "peak_accel_g": 2.1 } }
}
```

Kích hoạt chỉ **mở** một quyết định và ưu tiên xử lý; nó **không phải bằng chứng ngã**. `trigger_type`, `device_metrics` được ghi lại nhưng không dùng để quyết định. Thứ tự gợi ý: gửi kích hoạt (kèm `capture_id` sẽ dùng) → gửi lô IMU phủ thời điểm kích hoạt → upload burst `triggered` có `trigger_id`. Phản hồi 201 `{event_id, fusion: decided|waiting}`. Gửi lại cùng nội dung → 200; khác nội dung → 409 `trigger_id_reused`. Mã nguồn còn từ chối (422) `trigger_timing` khi `triggered_uptime_ms` lớn hơn `clock.uptime_ms`, và `event_too_old` khi kích hoạt cũ hơn 24 giờ (`src/imu.ts`).

Quyết định do máy chủ tính (`fusion-rules.v2`, ADR-017). Với cấu hình hiện tại (chưa có quy tắc đã hiệu chỉnh) **không có cảnh báo nghi ngã nào**, chỉ các mục cần người chăm sóc xem lại.

## 8. Lệnh thiết bị

### 8.1 Nhận lệnh — `GET /api/device/v1/commands/next`

204: không có gì. 200:

```json
{
  "command": {
    "command_id": "cmd_…",
    "command_type": "play_voice_message",
    "priority": 40,
    "preempts_lower_priority": false,
    "delivery_attempt": 1,
    "created_at": "2026-10-19T01:00:00.000Z",
    "expires_at": "2026-10-19T01:05:00.000Z",
    "expires_in_ms": 300000,
    "action": {
      "kind": "voice",
      "audio": { "voice_message_id": "vm_…", "version": 2, "content_type": "audio/mpeg", "codec": "mp3", "sample_rate_hz": 44100, "channels": 2, "duration_ms": 2037, "byte_size": 32600, "sha256": "…", "path": "/api/device/v1/commands/cmd_…/audio" }
    },
    "status_path": "/api/device/v1/commands/cmd_…/status"
  },
  "cancel_command_ids": [],
  "server_time": "2026-10-19T01:00:00.000Z"
}
```

| `action.kind` | Nội dung | Ưu tiên |
| --- | --- | --- |
| `buzzer` | `pattern: repeat_beep`, `duration_ms: 30000`, `beep_on_ms: 500`, `beep_off_ms: 500` (cảnh báo nghi ngã tạm thời) | 100, `preempts_lower_priority: true` |
| `reminder` | `reminder_kind: medication|water`, `label` (do người chăm sóc nhập), `occurrence_at`, `audio` hoặc `null` + `fallback: default_tone` | 50 |
| `voice` | `audio` (lời nhắn gia đình đã ghim phiên bản) | 40 |

Máy chủ chỉ giao lệnh mới khi ưu tiên của nó **cao hơn** mọi lệnh đang hoạt động của thiết bị. Khi nhận còi khẩn trong lúc đang phát nhắc/lời nhắn: dừng âm thanh đó, báo nó `failed` với `preempted_by_higher_priority`, rồi xử lý còi.

### 8.2 Hành vi thiết bị bắt buộc

1. **Chống lặp:** cùng `command_id` có thể được giao lại (khi chưa nhận được `received`/`accepted` trước hạn, xem mục 8). Coi là cùng một lệnh; không phát hai lần. Firmware tích hợp giữ sổ lệnh trong NVS: lệnh đã kết thúc → báo lại trạng thái cuối; lệnh đã `started` trước khi khởi động lại → báo `failed device_rebooted`, không bao giờ phát lại.
2. **Hạn chót:** tính hạn bằng đồng hồ đơn điệu: `uptime lúc nhận + expires_in_ms`. Quá hạn thì không bắt đầu phát; báo `rejected` với `expired_on_device`.
3. **Âm thanh:** chỉ tải `action.audio.path` của lệnh này (không có API liệt kê thư viện). Có thể tải theo đoạn: `Range: bytes=a-b` → 206 + `Content-Range`. Kiểm `sha256` và `byte_size` sau khi tải; sai → `rejected` + `audio_integrity_failed`. Đường âm thanh chỉ mở khi lệnh ở `delivered/accepted/started` và chưa hết hạn (404 ngoài khoảng đó, 410 nếu lời nhắn đã bị xóa).
4. **Xác nhận** — `POST {status_path}`:

```json
{ "schema_version": "command-status.v2", "device_id": "esp32-cam-example", "clock": { "boot_id": "boot-7f3a91c2", "uptime_ms": 3700000, "wall_clock_synced": false, "wall_time": null }, "status": "accepted", "reason_code": null, "detail": null }
```

| `status` | Ý nghĩa | Từ trạng thái |
| --- | --- | --- |
| `received` (ADR-022, tùy chọn) | Đã lưu lệnh, chưa phát gì. **Không đổi trạng thái** (vẫn `delivered`); máy chủ ghi `received_at`, `device_boot_id` và không giao lại lệnh này nữa | `delivered` (lặp lại → `duplicate:true`) |
| `accepted` | Đã lưu lệnh; với âm thanh: đã tải và kiểm SHA-256 | `delivered` |
| `started` | Âm thanh/còi đã thật sự bắt đầu (mẫu đầu tiên đã vào I2S). **Lệnh có âm thanh: chỉ sau `accepted`** | `accepted`; lệnh không có âm thanh: `delivered`, `accepted` |
| `completed` | Phát hết. **Chỉ trạng thái này** được hiển thị là "đã phát" | `delivered`, `accepted`, `started` |
| `failed` | Lỗi khi phát; `reason_code` bắt buộc | `delivered`, `accepted`, `started` |
| `rejected` | Không thực hiện; `reason_code` bắt buộc | `delivered`, `accepted` |
| `cancelled` | Đã dừng theo yêu cầu hủy | chỉ khi máy chủ đã yêu cầu hủy |

Ánh xạ: backend nhận lệnh = `queued`; trao cho thiết bị = `delivered`; thiết bị nhận = báo cáo `received`; đã tải và kiểm = `accepted`; bắt đầu phát = `started`; phát xong = `completed` (D15, ADR-022). Bảng trên là hành vi của backend cục bộ; Worker production hiện chưa có `received` và chưa buộc `accepted` trước `started`.

`reason_code`: `expired_on_device`, `unsupported_command`, `audio_download_failed`, `audio_integrity_failed`, `audio_format_unsupported`, `playback_error`, `preempted_by_higher_priority`, `busy`, `cancel_requested`, `device_rebooted`, `download_timeout`, `other`. `detail` ≤ 200 ký tự, không dữ liệu cá nhân. Máy chủ cũ trả 422 cho `received`, `device_rebooted`, `download_timeout`: firmware bỏ `received` và đổi lý do thành `other` (chi tiết giữ mã gốc).

5. **Trả lời 409:** báo lại cùng trạng thái → 200 `duplicate:true` (an toàn khi thử lại). 409 `invalid_transition` kèm `stop_playback: true` (lệnh đã hết hạn, bị hủy, bị thay thế hoặc đã kết thúc) → dừng ngay, bỏ lệnh. Chỉ bắt đầu phát khi `accepted` đã được máy chủ trả 2xx và còn hạn (firmware tích hợp: nếu không gửi được `accepted` thì không phát, máy chủ tự ghi `download_timeout`). `started` được gửi ngay sau khi mẫu đầu tiên vào I2S; nếu bị trả `stop_playback: true` thì dừng phát ngay.
6. **Hủy:** `cancel_command_ids` liệt kê lệnh đang ở trên thiết bị mà người chăm sóc yêu cầu hủy: dừng và báo `cancelled` + `cancel_requested`. Lệnh còn `queued` bị hủy ở máy chủ, không bao giờ tới thiết bị.
7. **Mất kết nối lâu:** lệnh hết hạn khi thiết bị offline bị đánh dấu `expired` và **không bao giờ giao lại**. Nhắc lịch cũ chưa được nhận bị `superseded` bởi lần nhắc mới hơn cùng lịch.
8. **Hạn chờ và hạn tải (ADR-022):** chưa có `received` → giao lại sau `30 s + ceil(byte_size / 16 000 B/s)` (lệnh không có âm thanh: 30 s); có `received` mà chưa `accepted` trước `received_at + 30 s + ceil(byte_size / 16 000)` (không quá `expires_at`) → `failed download_timeout`, không giao lại. Tốc độ tối thiểu chỉnh bằng `AUDIO_DOWNLOAD_MIN_BYTES_PER_SECOND`.
9. **Khởi động lại:** heartbeat hoặc báo cáo trạng thái mang `boot_id` khác với boot đã báo về lệnh: lệnh chưa `started` (đã `received` hoặc `accepted`) → về `queued` với `status_reason device_rebooted` (chưa phát nên không thể phát trùng); lệnh `started` → `failed device_rebooted`, không bao giờ tự thành `completed`. Báo cáo của chính lệnh đó từ boot mới (ví dụ `completed` thiết bị đã lưu trước khi khởi động lại) vẫn được nhận.
10. **Không báo hoàn tất:** lệnh ở `started` quá 600 s không có `completed`/`failed` → máy chủ ghi `failed` (`no_completion_report`).

### 8.3 Định dạng âm thanh (ADR-025)

Hai định dạng, máy chủ nêu rõ trong `action.audio` và thiết bị chỉ chấp nhận đúng hai cặp này (khác → `rejected audio_format_unsupported` trước khi tải một byte nào):

| `content_type` / `codec` | Nội dung | Ghi chú |
| --- | --- | --- |
| `audio/mpeg` / `mp3` | MP3 đúng như người dùng tải lên: MPEG-1/2/2.5 Layer III, 8; 11,025; 12; 16; 22,05; 24; 32; 44,1 hoặc 48 kHz, mono hoặc stereo, CBR/VBR, 0,5–60 s, ≤ 2 000 000 byte; `duration_ms` = số khung × mẫu/khung (không tính khung Xing/Info) | Định dạng tải lên duy nhất từ ADR-025. Không có `bits_per_sample`. Chỉ giao cho thiết bị đã báo `mp3` trong `status.audio_codecs` |
| `audio/wav` / `pcm_s16le` | RIFF/WAVE PCM mono 16-bit, tần số theo `DEVICE_AUDIO_SAMPLE_RATES`, ≤ 2,2 MB | Chỉ bản ghi lưu trước ADR-025; không tải lên mới được |

Firmware tích hợp (`carelens-fw-0.2.0`): tải cả tệp vào PSRAM theo Range, kiểm `sha256` và `byte_size`, rồi với MP3 duyệt lại mọi tiêu đề khung (`src/mp3.cpp`, cùng quy tắc với máy chủ) và so `sample_rate_hz`, `channels`, `duration_ms` (lệch > 2 ms → `rejected audio_format_unsupported`, chi tiết `metadata_mismatch` hoặc mã `mp3_*`). Giải mã từng khung bằng dr_mp3 vào bộ đệm PSRAM cố định, I2S theo tần số của tệp, chuyển sang stereo 16-bit có âm lượng. `started` chỉ gửi sau khi khối PCM đầu tiên vào I2S; `completed` sau khối cuối và 150 ms im lặng; lỗi giải mã → `failed playback_error` (chi tiết `mp3_decode_error`, `mp3_format_changed`, `mp3_overlong`). Mỗi phiên bản là khóa R2 bất biến; lệnh ghim phiên bản.

**Báo codec:** phản hồi heartbeat có `config.report_audio_codecs: true`; firmware 0.2.0 đáp lại bằng `status.audio_codecs: ["pcm_s16le","mp3"]` ở heartbeat kế (ngay lập tức, không chờ một phút). Firmware cũ không biết cờ này nên không gửi gì và được coi là chỉ phát WAV. Máy chủ cũ không gửi cờ nên firmware mới không gửi trường lạ (heartbeat `strict`).

## 9. Lỗi và thử lại

| Mã | Hành vi thiết bị |
| --- | --- |
| 2xx | Thành công |
| 400 / 422 | Lỗi nội dung: **không** gửi lại y nguyên; ghi `last_error` (mã) vào heartbeat kế |
| 401 | Token sai/thu hồi: dừng, chờ cấp lại |
| 403 | `device_mismatch` hoặc nguồn mô phỏng: lỗi cấu hình firmware |
| 404 | Tài nguyên không tồn tại (ví dụ chunk ngoài phạm vi, lệnh đã kết thúc) |
| 409 | Xung đột trạng thái/idempotency: đọc `code`, không lặp vô hạn |
| 410 | Media/âm thanh đã bị xóa |
| 413 / 415 | Body quá lớn / sai `Content-Type` |
| 429 | Chờ đúng `Retry-After` |
| 507 | `imu_storage_budget_exceeded`: chỉ lô IMU thô bị từ chối; chờ `Retry-After`, không lùi các yêu cầu khác |
| 5xx, mất mạng, timeout | Lùi dần có jitter 1 s → 2 s → 4 s … tối đa 60 s; gửi lại **cùng** `capture_id`, chỉ số chunk, `batch_seq`, `trigger_id` (đều idempotent) |

Lỗi luôn là `application/problem+json` với `code` và `request_id`.

## 10. Giới hạn kích thước

| Yêu cầu | Giới hạn |
| --- | --- |
| Manifest | 32 KB |
| Chunk | `frames_per_chunk × (200 000 + 4)` byte |
| Lô IMU | 256 KB, ≤ 1000 mẫu, ≤ 120 s |
| Kích hoạt | 16 KB |
| Heartbeat | 4 KB |
| Báo trạng thái lệnh | 64 KB (thực tế < 1 KB) |
| Tốc độ | 120 yêu cầu/phút/thiết bị (Rate Limiting binding) |

## 11. Đã đo trên thiết bị thật và còn chưa kiểm chứng

Đã đo 2026-10-19 (ESP32-S3 thật, backend cục bộ qua HTTPS trong LAN; chi tiết `docs/E2E_TEST_RESULTS.md`):

- Burst 24 khung VGA JPEG q12, mỗi khung khoảng 14–48 KB, chunk 8 khung khoảng 140 KB. Ở XCLK 10 MHz cảm biến cho một khung mỗi 90 ms nên khoảng chọn là 180 ms (`out_of_tolerance`); ở XCLK 20 MHz đạt 135–136 ms (`ok`, A41). Chưa đo burst 40 khung kích hoạt và nhiệt.
- IMU 50 Hz ±8 g/±1000 °/s, lô 600 mẫu (~24–28 KB JSON), khoảng trung vị 20 ms, không cờ chất lượng, liền mạch qua lần backend vắng mặt 23 s và Wi-Fi mất 20–70 s.
- Lệnh âm thanh: tải WAV 63 724 byte trong một Range 206 khoảng 40 ms trên LAN; vòng `delivered → completed` khoảng 3 s với bản ghi 2 s.
- MP3 (2026-10-20, firmware 0.2.0): 8 định dạng từ 8 kHz mono 24 kbps tới 48 kHz stereo 320 kbps phát `completed`; số frame ghi ra I2S đúng bằng số khung × mẫu/khung; CPU giải mã 1,6–11,5 % thời gian thực, tối đa 4,3 ms/khung; tệp 1,42 MB (59 s, 44,1 kHz stereo 192 kbps) tải và kiểm trong khoảng 2,6 s trên LAN rồi phát liền mạch trong lúc camera chụp 2 burst. Chi tiết `docs/E2E_TEST_RESULTS.md` §9.

Còn chưa kiểm chứng:

- Chạy với Worker production (chưa có token thiết bị production, chưa có ADR-022/024 trên production).
- Độ trễ mạng qua internet và sai số ước lượng mốc boot ngoài LAN.
- Vị trí gắn MPU6050: **đã biết** — cố định trong hộp, hộp đeo trên ngực (owner, 2026-10-19, D14, `docs/HARDWARE.md` §5). Chưa biết hướng lắp cảm biến trong hộp và cách đeo; mọi quy tắc IMU phải hiệu chỉnh cho vị trí này (D11).
- Còi khẩn trên thiết bị thật (không có cảnh báo nào được tạo vì quy tắc hợp nhất chưa duyệt), hành vi khi mất điện giữa chừng, pin.
- Burst kích hoạt bởi IMU trên thiết bị thật (luật firmware `|a| ≥ 2,5 g` chưa được kích hoạt trong các lần thử).
- Thời gian CPU của Worker (giới hạn 10 ms/lần gọi trên Free) khi nhận một chunk 8 khung: SHA-256 và kiểm header JPEG chạy trong test cục bộ nhưng chưa đo trên Cloudflare.
- Khả năng chịu tải free plan với nhịp chụp và nhịp IMU thật; cách firmware ghi số thực (làm tròn hay float32 đầy đủ) quyết định dung lượng IMU gấp khoảng 3 lần.
