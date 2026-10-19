# Giao thức thiết bị ESP32-S3 CAM ↔ care-monitoring

Phiên bản 2026-10-19. Dành cho người viết firmware. Trạng thái: **Đề xuất** (ADR-019). Backend và harness kiểm thử (`integrations/carelens/local-agent/tools/sample_device.py`) **đã kiểm chứng** theo đúng giao thức này bằng test cục bộ; **chưa có firmware và chưa chạy trên ESP32 thật**. Schema chính thức: `contracts/carelens/*.schema.json` (sinh từ `backend/care-monitoring/worker/src/contracts.ts`), ví dụ hợp lệ ở `contracts/carelens/fixtures/valid/`.

## 1. Xác thực

| Mục | Quy định |
| --- | --- |
| Token | `cld_…` do owner tạo bằng `python scripts/admin.py --api … device --id … --recipient … --label …`, hiện một lần. Lưu trong NVS mã hóa của ESP32. Máy chủ chỉ giữ SHA-256 |
| Header | `Authorization: Bearer cld_…` cho mọi yêu cầu |
| Danh tính | `device_id` trong body phải trùng thiết bị của token (khác → 403 `device_mismatch`). Thiết bị không bao giờ gửi `recipient_id`; hồ sơ lấy từ token |
| Thu hồi / xoay | 401 sau khi owner thu hồi hoặc xoay token: dừng gửi, báo lỗi cục bộ, chờ cấp lại. Không thử lại vòng lặp nhanh |
| Bí mật khác | Firmware không chứa token admin, agent hay bất kỳ secret Cloudflare nào |
| Mạng | Chỉ HTTPS tới URL Worker (ví dụ `https://care-monitoring.<subdomain>.workers.dev`), kiểm chứng chỉ TLS |

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

`camera|imu|speaker`: `ok|error|disabled|unknown`. `last_error`: mã ngắn `[a-z0-9_:.-]`, không văn bản tự do, không secret. Phản hồi 200: `{server_time, pending_commands, clock{boot_id, estimated_boot_epoch, issues}}`. Giới hạn 4 KB.

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

Kích hoạt chỉ **mở** một quyết định và ưu tiên xử lý; nó **không phải bằng chứng ngã**. `trigger_type`, `device_metrics` được ghi lại nhưng không dùng để quyết định. Thứ tự gợi ý: gửi kích hoạt (kèm `capture_id` sẽ dùng) → gửi lô IMU phủ thời điểm kích hoạt → upload burst `triggered` có `trigger_id`. Phản hồi 201 `{event_id, fusion: decided|waiting}`. Gửi lại cùng nội dung → 200; khác nội dung → 409 `trigger_id_reused`.

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
      "audio": { "voice_message_id": "vm_…", "version": 2, "content_type": "audio/wav", "codec": "pcm_s16le", "sample_rate_hz": 16000, "channels": 1, "bits_per_sample": 16, "duration_ms": 1500, "byte_size": 48044, "sha256": "…", "path": "/api/device/v1/commands/cmd_…/audio" }
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

1. **Chống lặp:** cùng `command_id` có thể được giao lại (khi chưa nhận được `accepted` sau 30 s). Coi là cùng một lệnh; không phát hai lần.
2. **Hạn chót:** tính hạn bằng đồng hồ đơn điệu: `uptime lúc nhận + expires_in_ms`. Quá hạn thì không bắt đầu phát; báo `rejected` với `expired_on_device`.
3. **Âm thanh:** chỉ tải `action.audio.path` của lệnh này (không có API liệt kê thư viện). Có thể tải theo đoạn: `Range: bytes=a-b` → 206 + `Content-Range`. Kiểm `sha256` và `byte_size` sau khi tải; sai → `rejected` + `audio_integrity_failed`. Đường âm thanh chỉ mở khi lệnh ở `delivered/accepted/started` và chưa hết hạn (404 ngoài khoảng đó, 410 nếu lời nhắn đã bị xóa).
4. **Xác nhận** — `POST {status_path}`:

```json
{ "schema_version": "command-status.v2", "device_id": "esp32-cam-example", "clock": { "boot_id": "boot-7f3a91c2", "uptime_ms": 3700000, "wall_clock_synced": false, "wall_time": null }, "status": "accepted", "reason_code": null, "detail": null }
```

| `status` | Ý nghĩa | Từ trạng thái |
| --- | --- | --- |
| `accepted` | Đã lưu lệnh; với âm thanh: đã tải và kiểm SHA-256 | `delivered` |
| `started` | Âm thanh/còi đã bắt đầu | `delivered`, `accepted` |
| `completed` | Phát hết. **Chỉ trạng thái này** được hiển thị là "đã phát" | `delivered`, `accepted`, `started` |
| `failed` | Lỗi khi phát; `reason_code` bắt buộc | `delivered`, `accepted`, `started` |
| `rejected` | Không thực hiện; `reason_code` bắt buộc | `delivered`, `accepted` |
| `cancelled` | Đã dừng theo yêu cầu hủy | chỉ khi máy chủ đã yêu cầu hủy |

`reason_code`: `expired_on_device`, `unsupported_command`, `audio_download_failed`, `audio_integrity_failed`, `audio_format_unsupported`, `playback_error`, `preempted_by_higher_priority`, `busy`, `cancel_requested`, `other`. `detail` ≤ 200 ký tự, không dữ liệu cá nhân.

5. **Trả lời 409:** báo lại cùng trạng thái → 200 `duplicate:true` (an toàn khi thử lại). 409 `invalid_transition` kèm `stop_playback: true` (lệnh đã hết hạn, bị hủy, bị thay thế hoặc đã kết thúc) → dừng ngay, bỏ lệnh. Không bắt đầu phát khi `accepted`/`started` bị từ chối.
6. **Hủy:** `cancel_command_ids` liệt kê lệnh đang ở trên thiết bị mà người chăm sóc yêu cầu hủy: dừng và báo `cancelled` + `cancel_requested`. Lệnh còn `queued` bị hủy ở máy chủ, không bao giờ tới thiết bị.
7. **Mất kết nối lâu:** lệnh hết hạn khi thiết bị offline bị đánh dấu `expired` và **không bao giờ giao lại**. Nhắc lịch cũ chưa được nhận bị `superseded` bởi lần nhắc mới hơn cùng lịch.
8. **Không báo hoàn tất:** lệnh ở `started` quá 600 s không có `completed`/`failed` → máy chủ ghi `failed` (`no_completion_report`).

### 8.3 Định dạng âm thanh

RIFF/WAVE PCM (format 1), **mono, 16-bit little-endian**, tần số theo `DEVICE_AUDIO_SAMPLE_RATES` (mặc định **16 000 Hz**), 0,5–60 s, ≤ 2,2 MB. Phù hợp phát thẳng qua I2S (ví dụ MAX98357A) không cần giải mã. Máy chủ từ chối tệp khác định dạng khi tải lên nên thiết bị không nhận tệp không phát được. Mỗi phiên bản là khóa R2 bất biến; lệnh ghim phiên bản.

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

## 11. Chưa kiểm chứng (cần firmware và thiết bị thật)

- Thời gian thực tế của chụp 8 fps QVGA trên ESP32-S3, kích thước JPEG, bộ nhớ PSRAM cho 40 khung.
- Độ trễ mạng thật và sai số ước lượng mốc boot.
- Vị trí gắn MPU6050 (đeo trên người hay đặt cố định) — quyết định ý nghĩa của mọi quy tắc IMU (D11).
- Phát I2S, thời lượng còi, hành vi khi mất điện giữa chừng.
- Khả năng chịu tải free plan với nhịp chụp và nhịp IMU thật; cách firmware ghi số thực (làm tròn hay float32 đầy đủ) quyết định dung lượng IMU gấp khoảng 3 lần.
