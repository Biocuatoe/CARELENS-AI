# Kết quả thử đầu-cuối — 2026-10-19

Môi trường: ESP32-S3 thật (`esp32s3-chest-01`, firmware `carelens-fw-0.1.0`), Worker thật chạy **cục bộ** (`wrangler dev`, D1/R2 Miniflare), HTTPS thật trong LAN qua proxy có CA thử nghiệm riêng (`192.168.1.12:8443`), Agent và Vision thật trên PC (RTX, `carelens_models_v1_20261018`), frontend thật (Vite dev) trong Chromium thật. **Không có gì chạy trên production** ngoài một `GET /health` chỉ đọc. Giờ ghi theo UTC (giờ Việt Nam = UTC+7).

Ký hiệu nguồn bằng chứng: **HW** phần cứng thật · **LS** dịch vụ cục bộ thật · **P** người dùng xác nhận bằng tai/mắt · **FI** lỗi chèn có kiểm soát (proxy cục bộ hoặc lệnh firmware) · **SIM** môi trường giả lập/mock.

## 1. Ma trận hoàn thành

| Luồng | Nguồn | Đích | Bằng chứng thật | Kết quả |
| --- | --- | --- | --- | --- |
| Heartbeat thiết bị | ESP32 thật (HW) | Backend cục bộ (LS) | Heartbeat đầu 15:34:29.851Z → 200; `devices.last_heartbeat_json` có camera/imu/speaker `ok`, RSSI, heap, `speaker_volume`; dashboard "Có liên lạc gần đây", firmware `carelens-fw-0.1.0` (Playwright) | **PASS** (HW+LS) |
| Lệnh âm thanh | Dashboard (LS, Chromium) | Loa ESP32 (HW) | `cmd_a9dac540bc56455d96d61efe4af91a99`: queued 15:59:35.410 → delivered .173 → received .371 → accepted .759 → started .890 → completed 15:59:39.012; `played_confirmed_by_device: true`; người dùng: "Nghe rõ, đủ to" ở 70% | **PASS** (HW+LS+P) |
| Upload ảnh | OV5640 thật (HW) | Backend/R2 cục bộ (LS) | `cap-b-54e906062cd1-n1`: 24 khung JPEG 640×480, manifest 201, 3 chunk 200 (SHA-256 từng khung kiểm ở máy chủ), complete 202, `cadence_status: ok` (135–136 ms), `source_mode: device`; camera hướng tường trống | **PASS** (HW+LS) |
| Lô IMU | IMU thật (HW) | Backend → Agent (LS) | 106 lô seq 0…105 trong một boot, 57 094 mẫu, 50 Hz, trung vị 20 ms, 0 cờ chất lượng, không hở; phủ đủ cửa sổ burst ±3 s | **PASS** (HW+LS) |
| Vòng Vision | Backend/Agent (LS) | Vision API → backend (LS) | Mô hình được gọi: ngã = R3D-18 đông cứng (`r3d_18-b3b3357e.pth`) + 3 nhánh C3 (`fall_heads: 3`, seed 20261007–09); uống nước/thuốc = `drink_detector_v4` (YOLO, `stage_drink/train_v4`) + `drink_rule_v12`. `job_16e073587aea413eb1416072a8715ab7` → `evt_c7231a78…` fall_check logit −6,0 (`NOT_CALIBRATED`), `evt_472ec909…` drink "khong"; ảnh xóa 16:02:44.109Z; mọi burst khác trong lượt thử cũng `processed` và bị xóa ảnh (§2, §4, §7) | **PASS** (LS; mô hình chưa hiệu chỉnh) |
| Kết quả trên dashboard | Backend (LS) | Frontend (LS, Chromium) | Trang thiết bị admin: "Suy luận thành công gần nhất 23:28", "Sự kiện gần nhất … fall_check", lần chụp "Đã xử lý" (Playwright `E2E_STEPS=online,results`) | **PASS** (LS) |
| Phục hồi | Thiết bị/backend/agent | Toàn bộ | 9/9 kịch bản lỗi trên thiết bị + agent tắt + Vision tắt + upload dở + backend vắng 23 s (§4) | **PASS** (HW+LS+FI) |
| Lời chào khởi động | ESP32 thật (HW) | MAX98357A + loa (HW) | Log: `greeting "Xin chao." 590 ms queued: ok` → `frames_written=9440 result=finished ms=667`; người dùng: "Rõ 'Xin chào', giọng nữ nhẹ" | **PASS** (HW+P) |
| Âm lượng từ dashboard (thêm theo yêu cầu) | Dashboard (LS) | Thiết bị (HW) | Audit `device.speaker_volume` 0,45 (15:42:05Z) và 0,70 (15:56:51Z); thiết bị log `speaker volume 0.25 -> 0.45 (set by the server, saved)`, heartbeat báo `speaker_volume: 0.7` | **PASS** (HW+LS+P) |

**Trạng thái tổng: END-TO-END VERIFIED LOCALLY.** Không có môi trường staging. Production chưa được kiểm (cần owner duyệt, `docs/PRODUCTION_ROLLOUT_READINESS.md`).

## 2. Đối chiếu từng lần chạy (Test 6)

| Lần | Thiết bị / boot | ID | Mốc (UTC) | HTTP | Chuyển trạng thái phía máy chủ | Agent / Vision | Quan sát trên dashboard | Nguồn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Lệnh 45% | `esp32s3-chest-01` / `b-a36dc98f412a` | `cmd_b12fcc846ea3494d844a92caa56dcf93` | queued 15:43:36.582, delivered .071, received .213, accepted .463, started .661, completed 15:43:39.851 | status ×4: 200; audio 206 (63 724 B) | `delivered → (received) → accepted → started → completed` | — | "Thiết bị báo đã phát xong" | HW+LS (người dùng chưa để ý tiếng) |
| Lệnh lặp | cùng | `cmd_478048157ed241ea934e54ce8c47bd3f` | queued 15:56:03.659 … completed 15:56:07.523 | 200/206 | như trên | — | như trên | HW+LS+P ("Có, nhưng vẫn nhỏ") |
| Lệnh 70% | cùng | `cmd_a9dac540bc56455d96d61efe4af91a99` | xem §1 | 200/206 | như trên | — | như trên | HW+LS+P ("Nghe rõ, đủ to") |
| Burst 10 MHz | `b-a36dc98f412a` | `cap-b-a36dc98f412a-n1` / `job_16e07358…` | upload 16:01:13Z, xử lý 16:02:44Z | 201/200×3/202 | `uploaded → processed`, `cadence_status: out_of_tolerance` (180 ms) | fall 669 ms, drink 760 ms, `scrub=True`, IMU `covered` | — | HW+LS |
| Burst 20 MHz | `b-54e906062cd1` | `cap-b-54e906062cd1-n1` / `job_92968939…` | xử lý 16:07:59Z | 201/200×3/202 | `cadence_status: ok` (135–136 ms) | fall 351 ms, drink 304 ms | — | HW+LS |
| Kết quả hiển thị | `b-2f5bbf9d25a3` | `cap-b-2f5bbf9d25a3-n2` / `job_4fccec21…` (sau Vision khôi phục) | completed 16:28:33Z | — | `completed`, attempts 3 | 2 lần `vision_unavailable`, lần 3 thành công | "Suy luận thành công gần nhất 23:28 (+07)" | HW+LS |

## 3. Kiểm từng phần

| Hạng mục | Kết quả |
| --- | --- |
| COM6 | CH343 `USB\VID_1A86&PID_55D3\5C4C152639`; esptool: ESP32-S3 (QFN56) rev v0.2, PSRAM 8 MB, flash 16 MB, MAC `28:84:85:65:60:f0`. Một lần CH343 ngừng chuyển dữ liệu; người dùng rút cắm lại cáp, sau đó bình thường |
| Nạp | 7 lần, mỗi lần 4 vùng qua kiểm hash; không xóa flash, không đổi phân vùng, NVS/FFat giữ nguyên |
| Selftest trên bo | 8/8 PASS (asset lời chào, SHA-256 asset, giới hạn khối PCM FW-1, WAV chunk quá lớn, PSRAM, audio, IMU, camera) |
| `/beep` cũ | Đô-Rê-Mi ghi đủ 14 400/14 400 khung, người dùng không nghe thấy (2 lần); lượt quét 262/523/1000/2000 Hz × 0,6 s nghe được cả bốn. Kết luận: loa nhỏ ở 0,25 với nốt trầm, ngắn; không phải lỗi phần mềm hay core |
| TLS production (chỉ đọc) | `tlscheck https://care-monitoring.care-monitoring-worker.workers.dev` → 200 sau 2 365 ms, bộ chứng chỉ ESP-IDF, xác minh chuỗi và tên |
| Tải âm thanh | 63 724 B: 1 Range, khoảng 40 ms ở proxy; 473 644 B: 8 Range, 0,86 s tới khi kiểm SHA-256 xong |

## 4. Lỗi và phục hồi (Test 5)

`firmware/carelens-esp32s3/tools/e2e_failures.py` (kết quả thô `D:\AI\Cache\Tmp\e2e-failures*\e2e-failures.json`, log thiết bị kèm theo). Chỉ trạng thái cuối do máy chủ ghi mới quyết định PASS.

| Kịch bản | Cách tạo | Trạng thái thật | Kết quả |
| --- | --- | --- | --- |
| Âm thanh bị hỏng 1 byte | FI proxy | `rejected audio_integrity_failed` (`sha256_mismatch`), không `started`, không phát | PASS |
| Âm thanh đã bị xóa (410) | FI proxy | `failed audio_download_failed` (`audio_deleted`), không phát | PASS |
| Mất phản hồi `completed` | FI proxy (502 sau khi máy chủ đã ghi) | thiết bị gửi lại → `completed (duplicate)`; một sự kiện `completed`; không phát lại | PASS (lần 2; lần 1 lỗi ở chính proxy kiểm thử, đã sửa) |
| Mất phản hồi `received` | FI proxy | một sự kiện `received`, lệnh vẫn `completed` | PASS |
| Khởi động lại khi đang phát (bản ghi 14,8 s) | lệnh `reboot` lúc đang phát | `failed device_rebooted`, `played_confirmed_by_device: false`, `started` chỉ một lần, không phát lại sau khởi động | PASS |
| Lệnh hết hạn khi thiết bị offline | `wifidrop 70`, lệnh hạn 30 s | `expired deadline_passed`, thiết bị không bao giờ thấy lệnh | PASS (lần 2; lần 1 firmware tự kết nối lại sớm — đã sửa `consoleWifiHeld`) |
| Mất Wi-Fi rồi có lại | `wifidrop 20` | `wi-fi lost` → `wi-fi back` sau 21 s → heartbeat 200 | PASS |
| Backend chậm (20 s) | FI proxy | `commands/next transport error` (timeout 15 s), kết nối lại, lệnh sau đó `completed` | PASS |
| Chunk ảnh hỏng | FI proxy | 422 `frame_hash_mismatch`, thiết bị dừng burst, ghi `last_error`; bảo trì đóng phiên `expired upload_incomplete`, `media_deleted_at` có giá trị | PASS |
| Backend vắng 23 s | dừng `wrangler dev` | proxy trả 502; thiết bị thử lại; lô IMU gửi lại cùng `batch_seq`, không mất mẫu | PASS |
| Agent tắt | `stop_agent.ps1` | job `queued`, ảnh còn trong R2; bật lại → `completed`, ảnh bị xóa | PASS |
| Vision tắt | dừng tiến trình 8080 | `vision_unavailable (retryable)` ×2; Vision lên lại → lần 3 `completed`, ảnh bị xóa | PASS |

Không kịch bản nào tạo cảnh báo hay thông báo (quy tắc hợp nhất chưa duyệt, D11).

## 5. Lỗi tìm ra nhờ chạy thật và đã sửa

| Lỗi | Sửa |
| --- | --- |
| D1 từ chối khi bind thừa tham số (500 ở báo cáo trạng thái) | Bind đúng số tham số theo câu SQL |
| D1 bind số JS dạng REAL, phép chia thành số thực (hạn lệch 3 ms) | `CAST(… AS INTEGER)` |
| Nhịp burst 180 ms ở XCLK 10 MHz | XCLK 20 MHz mặc định (A41), thiết lập `camxclk` |
| Bộ gửi IMU chậm hơn thời gian thực sau khi mất mạng (trễ 26 s) | Gửi liên tiếp khi còn tồn đọng; gửi sớm sau mỗi burst |
| `wifidrop` bị tác vụ cloud tự kết nối lại | `consoleWifiHeld()` |
| Đăng nhập admin bị mất khi `page.goto` (phiên chỉ trong bộ nhớ, đúng thiết kế) | Spec điều hướng trong ứng dụng |
| Ô chọn tệp còn khóa khi `setInputFiles` | Spec chờ ô được bật |

## 6. Bộ kiểm tự động

| Bộ | Lệnh | Kết quả |
| --- | --- | --- |
| Worker | `npm test` (worker) | **319/319** sau ADR-025 (2026-10-20; trước đó 309/309 gồm 17 test ADR-022, 5 test ADR-024) |
| Worker cũ trên schema mới | mã HEAD + migration 0006/0007 | **254/254** (trừ test fixture cần thư mục `contracts/`) |
| Typecheck Worker, contracts, dry-run | `npm run typecheck`, `contracts:check`, `deploy:dry-run` | đạt (bundle 1110 KiB, gzip 203 KiB) |
| Frontend unit | `npm test` | **376/378** sau ADR-025: "đội ngũ" của landing lỗi từ trước (thiếu ảnh); test tải STL vỏ hộp quá thời gian khi chạy cùng bộ dưới tải, chạy riêng thì đạt |
| Frontend admin | `vitest src/features/admin src/data/admin` | 109/109 (một lần 1 test chập chờn dưới tải, chạy lại 2 lần đều đạt) |
| Lint, typecheck, build frontend | `npm run lint/typecheck/build` | đạt |
| Playwright toàn bộ (backend giả) | `npm run test:e2e` | **98 đạt, 4 bỏ qua, 0 lỗi** sau ADR-025 (30 phút); 4 test bỏ qua là `hardware-device` và 3 test `live-demo-backend`, chỉ chạy khi có biến môi trường, đã chạy riêng ở hai dòng dưới |
| Playwright Live Demo với backend cục bộ thật | `live-demo-backend.spec.ts` (qua test e2e của agent) | **3/3** sau khi sửa harness: backend thử tắt `GOOGLE_CLIENT_ID` (trước đó test Google lỗi 503 `misconfigured` vì `wrangler.jsonc` mang client id production mà không có secret) |
| Playwright với thiết bị thật | `hardware-device.spec.ts` | đạt (4 lần chạy, xem §1–2) |
| Agent | `python -m pytest -q` | **38/38** |
| Agent e2e với mô hình thật | `python -m pytest -m e2e tests/integration -q` | **11/11** (2026-10-20, sau hai sửa harness: tắt Google như trên; kiểm Playwright "không lỗi, không bỏ qua" thay cho "1 passed" cũ, spec đã có 3 test) |
| Firmware trên PC | `tools/run_host_tests.py` | **662/662** sau ADR-025 (trước đó 94/94) |

## 7. Ổn định trên thiết bị

Boot `b-73f542690099`, cấp nguồn USB, camera hướng tường trống, âm lượng 0,70; `status` mỗi 60 s và một burst mỗi 5 phút (log `D:\AI\Cache\Tmpw-stability-1.log`). Thời gian quan sát **25 phút** (uptime 134 → 1635 s).

| Chỉ số | Kết quả |
| --- | --- |
| Khởi động lại (banner ROM), panic, watchdog | 0 |
| Heap nội trống | 74 572–74 756 byte (dao động 184 byte, không giảm dần) |
| PSRAM trống | 7 935 592–7 935 880 byte |
| IMU | 75 058 mẫu mới, 0 lỗi đọc, 0 khe bị bỏ; máy chủ nhận 163 lô / 84 287 mẫu trong boot này |
| HTTPS | 490 request, 0 lỗi transport |
| Camera | 5/5 burst 24 khung đạt, `cadence_status: ok`, đều `processed`, ảnh đã xóa (R2 còn 0 đối tượng) |
| Wi-Fi | 0 lần mất |

Chưa đo: nhiệt độ, dòng điện, pin; thời gian dài hơn 25 phút.

## 8. Chưa đo / chưa thử

- Trên production: báo cáo ngày qua LLM, và các kịch bản lỗi MP3 ở §9.4 (chỉ chạy cục bộ). Production đã chạy firmware 0.1.0 (heartbeat, ảnh, IMU, phục hồi; `docs/PRODUCTION_ROLLOUT_READINESS.md` §6b) và 0.2.0 (lời nhắn MP3, §9.5).
- Burst 40 khung kích hoạt bởi IMU, còi khẩn, nhắc lịch trên thiết bị thật.
- Nhiệt độ cảm biến và vỏ hộp, điện áp pin, sụt áp khi chạy bằng pin (chỉ cấp nguồn USB trong lượt thử).
- Chạy dài hơn thời gian ghi ở §7.
- Độ chính xác của mô hình cho góc nhìn từ ngực (Vision báo "có cốc" ở 24/24 khung một bức tường trống).

## 9. Lời nhắn MP3 trên thiết bị thật (ADR-025) — 2026-10-20

Môi trường như trên, thiết bị chạy `carelens-fw-0.2.0` (nạp COM6 02:23 UTC sau khi kiểm CH343 `VID_1A86&PID_55D3` và MAC `28:84:85:65:60:f0`; 4 vùng ghi đều "Hash of data verified"; NVS và FFat không đụng tới), Worker cục bộ có ADR-025 (tự nạp lại mã khi sửa), dashboard thật (Vite dev, Chromium). Tệp thử: câu TTS tổng hợp (Piper, không phải giọng người) mã hóa bằng LAME; ngoài repo. Giờ UTC.

### 9.1 Chuỗi đầu-cuối từ dashboard

| Bước | Bằng chứng | Nguồn |
| --- | --- | --- |
| Tải lên qua dashboard | Playwright `hardware-device.spec.ts` (`E2E_TEST_MP3=msg_44k_stereo_128k.mp3`): ô "Tệp đã chọn" hiện `MP3 · MPEG-1 · 44,1 kHz · stereo · 128 kbps`, 32,6 KB, 2,0 giây | HW+LS |
| Lưu nguyên tệp | `audio_asset_versions`: `audio/mpeg`, 44 100 Hz, 2 kênh, `bits_per_sample 0`, 2 037 ms, **32 600 byte, SHA-256 `eafb3afb…f715` = SHA-256 của tệp gốc**, khóa R2 `voice/rcp-showcase/vm_f7830a…/v1.mp3` | LS |
| Thiết bị tải và kiểm | Log: `downloading 32600 bytes` → `audio verified (sha256 ok, mp3 2037 ms, 2 ch, 44100 Hz, 78 frames, 128-128 kbps)` (thiết bị tự duyệt khung, cùng 2 037 ms với máy chủ) | HW |
| Giải mã và phát | `i2s configured at 44100 Hz`; `frames_written=89856` = 78 khung × 1 152 mẫu; giải mã 200 ms cho 2 037 ms âm thanh (9,9 %), tối đa 3 033 µs/khung; phát 2 189 ms (gồm 150 ms im lặng cuối) | HW |
| Xác nhận | `cmd_4c43f2a5592245809492a5cb9a2ff0d1`: queued 02:56:01.458 → delivered 05.082 → received 05.226 → accepted 05.514 → started 05.791 → **completed 08.067** (thiết bị báo) | HW+LS |
| Nghe | Người dùng nghe đủ lời chào MP3 và 3 lời nhắn (44,1 kHz; 8 kHz; 48 kHz) ở 03:02 ("nghe đủ 4 lời nhắn nhưng có chút nhỏ"); so sánh A/B 03:16: "WAV nghe rè, MP3 thì không" | P |

### 9.2 Ma trận định dạng (API admin như dashboard; mỗi lệnh `completed` do thiết bị báo; SHA-256 lưu = tệp gốc)

| Tệp | Byte | Tần số / kênh / bitrate | Khung | Frame ra I2S | CPU giải mã | Khung chậm nhất |
| --- | --- | --- | --- | --- | --- | --- |
| `msg_8k_mono_24k.mp3` (MPEG-2.5) | 6 480 | 8 kHz mono 24 kbps | 30 | 17 280 = 30 × 576 | 1,6 % | 1 684 µs |
| `msg_16k_mono_48k.mp3` | 12 528 | 16 kHz mono 48 kbps | 58 | 33 408 = 58 × 576 | 3,1 % | 1 645 µs |
| `msg_22k_mono_64k.mp3` | 16 509 | 22,05 kHz mono 64 kbps | 79 | 45 504 = 79 × 576 | 4,3 % | 1 770 µs |
| `msg_24k_stereo_96k.mp3` | 24 480 | 24 kHz stereo 96 kbps | 85 | 48 960 = 85 × 576 | 5,7 % | 1 804 µs |
| `msg_32k_stereo_vbr.mp3` | 19 728 | 32 kHz stereo VBR | 57 | 65 664 = 57 × 1 152 | 7,2 % | 2 884 µs |
| `msg_44k_stereo_128k.mp3` | 32 600 | 44,1 kHz stereo 128 kbps | 78 | 89 856 = 78 × 1 152 | 9,9 % | 3 033 µs |
| `msg_48k_stereo_320k.mp3` | 80 640 | 48 kHz stereo 320 kbps | 84 | 96 768 = 84 × 1 152 | 11,5 % | 3 362 µs |
| `long_44k_stereo_192k.mp3` | 1 421 897 | 44,1 kHz stereo 192 kbps, 59,2 s | 2 268 | 2 612 736 = 2 268 × 1 152 | 10,2 % | 4 252 µs |
| Lời chào (nhúng) | 4 104 | 16 kHz mono 48 kbps | 19 | 10 944 = 19 × 576 | 3,1 % | 1 707 µs |

Bộ giải mã: trạng thái 22 928 byte + khung PCM 4 608 byte trong PSRAM; ngăn xếp task âm thanh còn trống 4 344 byte. Độ trễ tạo lệnh → `started` 1–4 s (chu kỳ hỏi lệnh 5 s khi rảnh); tải + kiểm 1,42 MB khoảng 2,6 s trên LAN.

### 9.3 Từ chối khi tải lên (không lưu gì, R2 không thêm đối tượng)

| Đầu vào | Kết quả |
| --- | --- |
| WAV (`audio/wav`) | 415 `mp3_required` |
| MP3 cắt cụt 37 byte cuối | 422 `invalid_audio` (`mp3_truncated_frame`) |
| Rác đặt tên `.mp3` | 422 `invalid_audio` |
| MP3 2 369 280 byte (48 kHz 320 kbps, 59 s) | 413 |
| Trình duyệt: WAV, WAV đổi tên `.mp3`, MPEG Layer II, tệp cắt cụt, > 2 MB | Báo lỗi tiếng Việt trước khi tải, không gọi API (test UI + Playwright) |

### 9.4 Lỗi, phục hồi, tài nguyên (thiết bị thật; `mp3_hw_scenarios.py` chạy cục bộ)

| Kịch bản | Bằng chứng | Kết quả |
| --- | --- | --- |
| Đoạn 59 s phát trong lúc camera chụp 2 burst, IMU 50 Hz, Wi-Fi bật | `cmd_a87b1c5c…` completed; 2 612 736 frame; burst n1, n2: 24/24 khung, 135–136 ms, complete 202, `processed`, ảnh đã xóa; IMU 3 139 mẫu trong ~63 s, `errors=0 skipped=0`; heap nội 71 908 → 71 696; người dùng: "Liền mạch, không giật" | **PASS** (HW+LS+P) |
| Hủy khi đang phát | `cmd_1cb67e4b…`: cancel 202 lúc 03:20:01.8 → thiết bị dừng (`result=stopped` sau 5,7 s phát) → `cancelled` 03:20:02.2 | **PASS** |
| Một byte hỏng khi giao (proxy `corrupt_audio`) | `sha256 mismatch` → `rejected audio_integrity_failed`, không phát | **PASS** (FI) |
| Một Range trả 503 (proxy `audio_status`) | `range bytes=0-12527 failed (status 503), retry 1` → kiểm SHA đạt → `completed` | **PASS** (FI) |
| Rớt Wi-Fi 6 s giữa lúc tải 1,42 MB (`wifidrop 6`) | `ESP_ERR_HTTP_INCOMPLETE_DATA`, Range lỗi, kết nối lại, tải tiếp, SHA đạt, phát hết 59 s → `completed` | **PASS** (FI) |
| Gửi trùng (một khóa idempotency) | Lần 2: 200 `created:false`, cùng `command_id`; thiết bị phát **1** lần | **PASS** |
| Khởi động lại khi đang phát | `cmd_fdfa5faf…`: started 03:22:01.7 → `reboot` → lời chào MP3 lúc boot → `failed device_rebooted` 03:22:31.1; chỉ 1 dòng `started`, **không phát lại** | **PASS** (FI) |
| Bản ghi WAV cũ trên firmware mới | Bản ghi `audio/wav` (lưu như Worker trước ADR-025, chỉ D1/R2 cục bộ) → `codec: pcm_s16le` → `completed`; không bao giờ ghi nhãn MP3 | **PASS** (HW+LS) |
| Rò bộ nhớ | Cùng boot, trước/sau 3 lệnh MP3 (1,42 MB, 80 KB, 1,42 MB): PSRAM trống 7 908 032 → 7 908 064 byte, heap nội 71 892 → 71 712 | **PASS** |
| IMU liên tục qua mọi kịch bản | Boot `b-423567c2d9e1`: 333 lô `batch_seq` 0–332, **0 khoảng trống**, 171 499 mẫu | **PASS** |
| Âm lượng sau khi đổi firmware | `PUT speaker-volume` 0,65 → thiết bị `0.70 -> 0.65 (set by the server, saved)` → báo 0,65; trả về 0,70 | **PASS** |
| Thiết bị báo codec | `status.audio_codecs = ["pcm_s16le","mp3"]` trong `last_heartbeat_json` sau phản hồi có `report_audio_codecs` | **PASS** |

Kiểm trên PC (không cần bo): bộ duyệt và giải mã cho cùng số khung, số mẫu và độ dài với máy chủ; tone ra đúng 440/660 Hz; 300 bản hỏng ngẫu nhiên không làm vượt biên hay treo; không mẫu nào bị cắt đỉnh khi giải mã các tệp thử (đỉnh −2,9 đến −3,4 dBFS).

### 9.5 Production (Worker `934bcb18`, frontend `dpl_AvuBn88R…`, 04:01–04:06 UTC)

Thiết bị chuyển sang production trong khoảng có hạn rồi trả về cục bộ (chi tiết lệnh và mã bản: `docs/PRODUCTION_ROLLOUT_READINESS.md` §6c).

| Bước | Bằng chứng | Kết quả |
| --- | --- | --- |
| Worker production từ chối WAV | `POST …/voice-messages` `audio/wav` → 415 `mp3_required`; không thêm phiên bản âm thanh | **PASS** |
| Thiết bị báo codec | Boot `b-c6dfc797f866`: heartbeat production có `audio_codecs ["pcm_s16le","mp3"]` | **PASS** (HW+PS) |
| Owner tải MP3 của mình qua dashboard production | `vm_78d75cf6…`: 24 kHz stereo 160 kbps, 122 400 B; D1 lưu `audio/mpeg` | **PASS** (PS) |
| Phát 3 lần từ dashboard | `cmd_94cc7c57…`, `cmd_f24f255e…`, `cmd_ca1be747…`: mỗi lệnh đủ 6 trạng thái, `completed` do thiết bị báo; 146 880 frame/lần, phát 6,2–6,3 s; owner: "Loa phát, báo đã phát xong" | **PASS** (HW+PS+P) |

PS = máy chủ production (D1/API production, chỉ đọc trừ thao tác owner).

**Kết luận phần MP3:** đã kiểm chứng đầu-cuối với thiết bị thật **cục bộ** (§9.1–9.4) và **trên production** cho luồng dashboard → lệnh → loa (§9.5). Thiết bị không nối production thường trực.
