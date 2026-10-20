# Tiến độ tích hợp ESP32 — cập nhật 2026-10-20

Thiết bị: hộp đeo ngực, ESP32-S3-WROOM N16R8 (rev v0.2, PSRAM 8 MB, flash 16 MB, MAC `28:84:85:65:60:f0`) + OV5640 + IMU (báo `WHO_AM_I = 0x70`) + MAX98357A + loa 8 Ω 1 W, nối PC qua cầu CH343 (COM6). Firmware: `firmware/carelens-esp32s3/` (ADR-023), đang nạp `carelens-fw-0.2.0` (MP3, ADR-025). Kết quả thử chi tiết: `docs/E2E_TEST_RESULTS.md`.

Trạng thái chung: **Đã kiểm chứng trên bo thật với backend cục bộ** (wrangler dev, D1/R2 cục bộ, HTTPS qua proxy LAN có CA thử nghiệm riêng). Bản 0.1.0 đã chạy với **Worker production** 2026-10-20 trong khoảng 40 phút (heartbeat, ảnh → agent → Vision, IMU, phục hồi; `docs/PRODUCTION_ROLLOUT_READINESS.md` §6b) rồi được trả về backend cục bộ. Bản 0.2.0 (MP3) kiểm đầy đủ với backend cục bộ, rồi chạy với Worker production 04:01–04:06 UTC cùng ngày: owner tải MP3 của mình lên dashboard production, thiết bị phát xong 3/3 lệnh (`PRODUCTION_ROLLOUT_READINESS.md` §6c). Hiện thiết bị lại báo về backend cục bộ (heartbeat 04:06:45, boot `b-93c67c7478ff`).

## 1. Theo hạng mục

| Hạng mục | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Build | Đã kiểm chứng | PlatformIO + pioarduino 55.03.38-1 (core 3.3.8), không cảnh báo trong mã dự án; 0.2.0: RAM tĩnh 74 168 byte (22,6 %), flash 1 319 171 byte (41,9 % của 3 MB) |
| Nạp | Đã kiểm chứng | 8 lần nạp qua COM6 (lần 8: 0.2.0, 2026-10-20 02:23 UTC, sau khi kiểm VID/PID CH343 và MAC), mỗi lần 4 vùng (bootloader, bảng phân vùng, boot_app0, app) qua kiểm hash; không xóa toàn bộ flash, không đổi bảng phân vùng; FFat và NVS giữ nguyên (Wi-Fi, token, âm lượng còn nguyên sau khi nạp) |
| Log chẩn đoán | Đã kiểm chứng | UART0 → CH343 → COM6 (`tools/serial_console.py`); thay cho `Serial` của sketch (USB gốc, không cắm vào PC) |
| Lời chào "Xin chào." | Đã kiểm chứng, người dùng nghe xác nhận | 0.1.0 (WAV): 9440/9440 khung trong 667 ms, "Rõ 'Xin chào', giọng nữ nhẹ". 0.2.0 (MP3 4 104 byte): 19 khung, 10 944 frame ra I2S, giải mã 21 ms (3,1 %); người dùng nghe xác nhận 2026-10-20 |
| Lời nhắn MP3 (ADR-025) | Đã kiểm chứng, người dùng nghe xác nhận | dr_mp3 giải từng khung trong PSRAM; 8 định dạng 8–48 kHz mono/stereo CBR/VBR phát `completed` với số frame ra I2S đúng bằng số khung × mẫu/khung; CPU 1,6–11,5 %; đoạn 59 s 1,42 MB liền mạch trong lúc camera chụp; hủy, khởi động lại, hỏng dữ liệu, Range lỗi, rớt Wi-Fi, gửi trùng đều đúng; không rò PSRAM; heartbeat báo `audio_codecs` (`E2E_TEST_RESULTS.md` §9). Production: tệp 24 kHz stereo 160 kbps của owner phát `completed` 3/3 lần, owner nghe thấy (§9.5) |
| Bản ghi WAV cũ trên firmware 0.2.0 | Đã kiểm chứng | Lệnh `pcm_s16le` phát `completed`; người dùng thấy bản WAV "hơi rè", MP3 thì không (giải mã không cắt đỉnh; nguyên nhân chưa xác định) |
| Sửa FW-1 (tràn bộ đệm WAV mono) | Đã kiểm chứng | `pcmToStereo` giới hạn theo dung lượng ra; host test chứng minh không ghi quá khối; selftest trên bo |
| `/beep` không nghe thấy | Đã khoanh vùng | Đúng chuỗi Đô-Rê-Mi (262/294/330 Hz × 0,3 s) ghi đủ 14 400/14 400 khung nhưng người dùng không nghe; lượt quét 262/523/1000/2000 Hz × 0,6 s thì nghe được cả bốn. Không phải lỗi phần mềm hay core; loa nhỏ ở âm lượng 0,25. Ở 0,70 lời nhắn "nghe rõ, đủ to" |
| Âm lượng từ dashboard (ADR-024) | Đã kiểm chứng | 0,25 → 0,45 → 0,70 đặt trên dashboard, thiết bị tự báo lại và lưu NVS qua các lần khởi động |
| HTTPS + xác minh chứng chỉ | Đã kiểm chứng | LAN: CA thử nghiệm cục bộ + chứng chỉ theo IP; production: `tlscheck` `workers.dev/health` → 200, bộ chứng chỉ ESP-IDF, xác minh chuỗi và tên |
| Heartbeat | Đã kiểm chứng | 60 s; trạng thái camera/imu/speaker do thiết bị báo, RSSI, heap; `boot_id` mới mỗi lần khởi động |
| Lệnh âm thanh (ADR-022) | Đã kiểm chứng, người dùng nghe xác nhận | `delivered → received → accepted → started → completed`, tải Range + SHA-256 trước `accepted`, chỉ phát khi `accepted` được xác nhận |
| Sổ lệnh chống phát lại | Đã kiểm chứng | Khởi động lại giữa lúc phát → máy chủ `failed device_rebooted`, không phát lại; ACK mất → gửi lại nhận `duplicate:true` |
| IMU thô | Đã kiểm chứng | 50 Hz, ±8 g, ±1000 °/s; lô ≤ 600 mẫu; liền mạch qua backend vắng 23 s và Wi-Fi mất 20–70 s; sửa lỗi bộ gửi chậm hơn thời gian thực sau khi mất mạng |
| Burst ảnh | Đã kiểm chứng (nhịp cần A41) | 24 khung VGA; XCLK 10 MHz → 180 ms/khung (`out_of_tolerance`), XCLK 20 MHz → 135–136 ms (`ok`) |
| Vòng Agent/Vision | Đã kiểm chứng | Job thật, Vision cục bộ thật (R3D-18 + YOLO11n, `carelens_models_v1_20261018`, chưa hiệu chỉnh), ảnh bị xóa sau suy luận |
| Luật kích hoạt IMU của firmware | Đã viết, chưa kích hoạt trên bo | `|a| ≥ 2,5 g`, giới hạn 1 lần/phút; không lần thử nào vượt ngưỡng; không phải bằng chứng ngã |
| Còi khẩn | Đã viết, chưa thử trên bo | Không có cảnh báo nào (quy tắc hợp nhất chưa duyệt, D11) |
| Pin, nhiệt, sụt áp | Chưa đo | Không có ADC đo pin; không có cảm biến nhiệt; không thấy brownout trong các lần chạy (bộ đếm `reset=brownout` không xuất hiện) |

## 2. Phát hiện phần cứng mới

| ID | Phát hiện | Ảnh hưởng |
| --- | --- | --- |
| D16 | IMU trả `WHO_AM_I = 0x70` (MPU6050 thật trả 0x68) | Dùng được; quy tắc IMU phải hiệu chỉnh trên chính chip này |
| A41 | OV5640 ở XCLK 10 MHz cho một khung VGA mỗi 90 ms | Phải chạy 20 MHz để đạt nhịp hợp đồng; nhiệt chưa đo |
| ADR-021 | Bản nạp bằng Arduino IDE trước đây dùng core 3.3.12 (đường dẫn trong ảnh cũ); PC chỉ có 3.3.8 | Chưa thấy khác biệt hành vi |
| — | CH343 có lúc ngừng chuyển dữ liệu UART (sau vài lần esptool không kết nối được); rút cáp cắm lại là hết | Ghi trong `docs/FIRMWARE_TOOLCHAIN.md` |
| — | Loa nhỏ ở âm lượng của baseline (0,25) | Đặt 0,70 trên dashboard; muốn to hơn nữa phải đổi phần cứng (chân GAIN của MAX98357A) — không tự làm |

## 3. Còn lại

| Việc | Cần |
| --- | --- |
| Chạy production lâu dài | Gói Cloudflare (IMU liên tục ≈ 86 000 dòng ghi D1/ngày, sát hạn Free) hoặc chế độ gửi IMU quanh burst |
| Bộ đệm trước kích hoạt cho burst 40 khung | Camera phải chạy liên tục (nhiệt); hiện burst kích hoạt bắt đầu sau kích hoạt (`trigger_frame_index = 0`) |
| Hiệu chỉnh ngã cho góc nhìn từ ngực | Dữ liệu có nhãn từ chính thiết bị; Vision hiện báo "có cốc" ở 24/24 khung một bức tường trống (nhận diện sai) |
| Flash/NVS encryption | Quyết định của owner (ADR-023) |
| Đo nhiệt ở XCLK 20 MHz, đo pin | Dụng cụ đo |
