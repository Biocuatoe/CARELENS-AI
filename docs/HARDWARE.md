# Phần cứng thiết bị CareLens AI (ESP32-S3 CAM)

Phiên bản 2026-10-19. Nguồn: owner (tin nhắn trong phiên 2026-10-19 và tệp `Phần cứng Carlens AI.txt`), sketch đã chạy được trên bo (ngoài repo, xem §3), `boards.txt` của Arduino-ESP32 core 3.3.8. Giao thức với backend: `docs/DEVICE_API.md`. Không có firmware trong repo tại thời điểm này.

## 1. Linh kiện (owner cung cấp)

| # | Linh kiện |
| --- | --- |
| 1 | Pin LiPo 2000 mAh |
| 2 | Mạch sạc và bảo vệ TP4056, cổng Type-C |
| 3 | Mạch tăng áp 3,7 V → 5 V |
| 4 | ESP32-S3 CAM với camera OV5640. Module: **ESP32-S3-WROOM N16R8** (16 MB flash, 8 MB PSRAM octal). Nhà sản xuất và revision của bo mang: **chưa xác định** |
| 5 | Cảm biến gia tốc/con quay MPU6050 |
| 6 | Mạch khuếch đại âm thanh I2S MAX98357A |
| 7 | Loa 8 Ω, 1 W |

Mọi linh kiện nằm trong **một hộp, hộp đeo trên ngực** người được chăm sóc (owner, 2026-10-19).

## 2. Nối dây (owner cung cấp)

### 2.1 Nguồn

| Từ | Tới | Ghi chú |
| --- | --- | --- |
| LiPo (+) | B+ của TP4056 | |
| LiPo (−) | B− của TP4056 | |
| OUT+ TP4056 | IN+ boost | qua công tắc nguồn |
| OUT− TP4056 | IN− boost | |
| OUT+ boost (5 V) | chân 5V của ESP32-S3 | |
| OUT+ boost (5 V) | VIN của MAX98357A | |
| OUT− boost | GND của ESP32-S3, MPU6050, MAX98357A | mass chung |

### 2.2 Tín hiệu

| ESP32-S3 | MPU6050 | MAX98357A |
| --- | --- | --- |
| 3V3 | VCC | — |
| 5V (từ boost) | — | VIN |
| GND | GND | GND |
| GPIO47 | SDA | — |
| GPIO21 | SCL | — |
| GPIO41 | — | BCLK |
| GPIO42 | — | LRC |
| GPIO1 | — | DIN |

Các chân trên khớp với hằng số của sketch đã chạy được (`MPU_SDA 47`, `MPU_SCL 21`, `I2S_BCLK 41`, `I2S_LRC 42`, `I2S_DIN 1`). Chân SD và GAIN của MAX98357A không có trong sơ đồ.

## 3. Cấu hình phần cứng đã chạy được (baseline)

Owner xác nhận sketch `esp32s3_all_in_one_wav__1_.ino` đã chạy thành công trên bo. Tệp nằm **ngoài repo** (`C:\Users\HLC\Downloads\`, 709 dòng, SHA-256 `64271ffe9c168f845a85680371dc3f0a0d142530505e2614c8449fe3bb0acb8c`) vì chứa SSID và mật khẩu Wi-Fi viết cứng; không sửa, không chép nguyên văn vào repo. Đây là tham chiếu cho mọi lần tái cấu trúc firmware: không đổi chân hay cấu hình camera nếu chưa xác minh trên đúng bo.

### 3.1 Camera OV5640 (trên bo, không có trong sơ đồ nối dây)

| Tín hiệu | GPIO | Tín hiệu | GPIO |
| --- | --- | --- | --- |
| XCLK | 15 | D0 (Y2) | 11 |
| SIOD (SDA) | 4 | D1 (Y3) | 9 |
| SIOC (SCL) | 5 | D2 (Y4) | 8 |
| VSYNC | 6 | D3 (Y5) | 10 |
| HREF | 7 | D4 (Y6) | 12 |
| PCLK | 13 | D5 (Y7) | 18 |
| PWDN | −1 (không dùng) | D6 (Y8) | 17 |
| RESET | −1 (không dùng) | D7 (Y9) | 16 |

Thiết lập trong sketch: XCLK 10 MHz (hạ từ 20 MHz để giảm nóng), JPEG, VGA 640×480, chất lượng 12, 2 frame buffer trong PSRAM, `CAMERA_GRAB_LATEST`, AWB/AGC bật, gain ceiling 4×, LENC/BPC/WPC bật. Chu kỳ "quay 5 s, nghỉ 2 s" (software power-down OV5640) là biện pháp chống nóng của sketch; nó làm mất khung trong khoảng nghỉ nên không tương thích với burst liên tục của `capture-session.v2` (cần đo nhiệt trước khi bỏ hay thay).

### 3.2 MPU6050 và MAX98357A trong sketch

| Mục | Giá trị trong sketch |
| --- | --- |
| I2C | `Wire.begin(47, 21, 400000)`, địa chỉ 0x68, chỉ ghi 0x6B = 0 (thoát sleep) |
| Dải đo | Mặc định sau reset: ±2 g, ±250 °/s (hệ số 16384 LSB/g, 131 LSB/(°/s)) |
| Nhịp đọc | Khoảng 20 Hz (`vTaskDelay(50 ms)` sau mỗi lần đọc), không mốc thời gian từng mẫu |
| I2S | `ESP_I2S`, chuẩn STD, 16-bit, stereo hai khe, tần số theo tệp đang phát (MP3 8–48 kHz từ firmware 0.2.0; WAV cũ; mặc định 16 kHz), âm lượng phần mềm 0,25 (đặt được tới 0,70) |
| Lưu trữ | FFat trên phân vùng `app3M_fat9M_16MB` |

## 4. Board và cấu hình build

| Tùy chọn Arduino IDE (chú thích sketch) | Thuộc tính `boards.txt` core 3.3.8 |
| --- | --- |
| Board "ESP32S3 Dev Module" | `build.board=ESP32S3_DEV`, `build.variant=esp32s3`, `build.mcu=esp32s3` |
| PSRAM "OPI PSRAM" | `-DBOARD_HAS_PSRAM`, `psram_type=opi` → `memory_type=qio_opi` |
| Flash Size "16MB" | `flash_size=16MB` |
| Flash Mode (mặc định "QIO 80MHz") | `boot=qio`, `boot_freq=80m`, `flash_mode=dio` (ảnh app), `flash_freq=80m` |
| Partition "16M Flash (3MB APP/9.9MB FATFS)" | `partitions=app3M_fat9M_16MB`, `upload.maximum_size=3145728` |
| USB CDC On Boot "Enabled" | `cdc_on_boot=1` |
| USB Mode (mặc định "Hardware CDC and JTAG") | `usb_mode=1` |
| CPU (mặc định 240 MHz), Loop/Events core (mặc định 1/1) | `f_cpu=240000000L` |
| Upload speed 115200 (chú thích sketch) | — |

Phiên bản core: Arduino15 trên PC này có duy nhất **3.3.8** (cài 2026-05-22). Chưa có bằng chứng bản build đã chạy được dùng đúng 3.3.8 (có thể đã build trên máy khác).

Ánh xạ sang PlatformIO, bằng chứng build và hướng dẫn nạp: `docs/FIRMWARE_TOOLCHAIN.md`, quyết định ADR-021.

## 5. Thiết bị đeo trên ngực (owner, 2026-10-19)

MPU6050 cố định trong hộp; hộp chứa toàn bộ mạch và camera, **đeo trên ngực**. (Câu trả lời đầu tiên trong phiên "không đeo trên người" đã được owner sửa.) Hệ quả, quyết định cần owner ở `docs/DECISIONS.md` D14:

- **IMU** đo chuyển động thân trên **qua hộp và dây đeo**: tư thế ngực, va chạm, rơi tự do, xoay người. Tín hiệu còn chứa chuyển động của hộp so với người (dây lỏng, hộp lắc), nên phụ thuộc cách đeo và vị trí trên ngực. Hướng lắp cảm biến trong hộp (trục nào thẳng đứng khi người đứng) **chưa biết**: firmware gửi trục thô của cảm biến, không tự xoay hay đổi tên trục; hướng lắp được ghi lại khi owner xác nhận.
- IMU một mình **không xác nhận được ngã** (cúi người, ngồi phịch xuống ghế, tháo hộp ra đặt lên bàn đều tạo tín hiệu mạnh). Đúng với ADR-017: kích hoạt firmware chỉ mở quyết định, không phải bằng chứng.
- Dải đo ±2 g, ±250 °/s mặc định của sketch có thể bão hòa khi va chạm thân người; backend đã gắn cờ "chạm dải đo". Dải đo của firmware chọn theo bản ghi thử (Prompt 4), không đoán, và luôn ghi kèm trong `imu-batch.v1` (`accel_range_g`, `gyro_range_dps`).
- **Camera** nhìn từ ngực ra (góc nhìn người đeo): thấy môi trường, tay, cốc, vỉ thuốc, người khác; **không thấy tư thế của chính người đeo** (D02). Khi ngã, cảnh trong khung lật nhanh, nhòe hoặc chỉ thấy trần/sàn. Gói mô hình ngã R3D-18 **chưa được kiểm chứng** trên video góc nhìn người đeo; điểm của nó tiếp tục là logit chưa hiệu chỉnh (D11). Kiểm uống nước/thuốc (tay đưa cốc lên gần mặt) cũng chưa kiểm chứng ở góc nhìn này.
- Hai nguồn nằm trên **cùng thiết bị, cùng đồng hồ** (`boot_id` + `uptime_ms`), nên căn thời gian khung ảnh với IMU thô là thuận lợi. Yêu cầu hai nguồn của `fusion-rules.v2` vẫn khả thi về nguyên tắc, nhưng cả hai quy tắc phải được hiệu chỉnh cho đúng vị trí đeo ngực.
- **Riêng tư:** camera đeo trên người quay cả người xung quanh. Khung ảnh chỉ đi vào R2 tạm thời cho agent (D10); cách xử lý người thứ ba cần owner quyết (D08, D10).
- **An toàn khi đeo:** hộp áp sát người. Cần đo nhiệt bề mặt khi camera chạy liên tục (chu kỳ nghỉ của sketch là biện pháp chống nóng), an toàn pin LiPo khi sạc/xả gần cơ thể, và giới hạn âm lượng loa gần tai.

## 6. Điểm chưa xác minh

| Mục | Trạng thái |
| --- | --- |
| Nhà sản xuất và revision của bo ESP32-S3 CAM | Chưa xác định; sơ đồ chân camera chỉ lấy từ sketch đã chạy |
| Cổng I2C phần cứng mà driver camera dùng cho SCCB so với `Wire` (port 0) | Đã kiểm gián tiếp 2026-10-19: sdkconfig của core đặt `CONFIG_SCCB_HARDWARE_I2C_PORT1`; camera và IMU chạy đồng thời không lỗi trong firmware tích hợp |
| GPIO41/42 là chân JTAG (MTDI/MTMS) | Dùng được khi không debug JTAG; không debug JTAG khi đang dùng I2S |
| Chân SD/GAIN của module MAX98357A | Không nối theo sơ đồ; độ lợi và chế độ kênh thực tế phụ thuộc mạch module, chưa đo. Âm lượng phần mềm (0,05–0,70, ADR-024) là lớp bảo vệ loa 1 W duy nhất. Ở 0,25 (baseline) người dùng thấy nhỏ, ở 0,70 "nghe rõ, đủ to" (2026-10-19) |
| Đo điện áp pin | Không có mạch đo → firmware **không được** báo mức pin |
| Sụt áp boost khi camera + Wi-Fi + loa cùng chạy | Chưa đo |
| Nhiệt độ OV5640 (firmware tích hợp: XCLK 20 MHz, cảm biến ngủ giữa các burst 3–5 s, A41), nhiệt bề mặt hộp khi đeo | Chưa đo |
| Hướng lắp MPU6050 trong hộp, cách đeo (dây, vị trí trên ngực) | Chưa xác nhận (D14) |
| Thời gian tải WAV qua HTTPS trên ESP32 | Đo trên LAN 2026-10-19: 63 724 byte trong một Range 206 khoảng 40 ms (proxy), 473 644 byte (8 Range 64 KB) từ lúc bắt đầu tải tới khi kiểm SHA-256 xong 0,86 s (≈ 550 KB/s, log thiết bị). Qua internet chưa đo |

## 7. Đo bằng firmware tích hợp (2026-10-19, `firmware/carelens-esp32s3/`)

| Mục | Kết quả |
| --- | --- |
| Cổng PC | COM6 = WCH CH343 (`USB\VID_1A86&PID_55D3`) nối UART0; esptool đọc ESP32-S3 (QFN56) rev v0.2, PSRAM 8 MB AP_3v3, flash 16 MB, MAC `28:84:85:65:60:f0`. Có lúc CH343 ngừng chuyển dữ liệu (không thấy banner ROM khi reset, esptool "No serial data received"); rút cáp cắm lại là hết |
| IMU | Chip trả `WHO_AM_I = 0x70` (MPU6050 thật trả 0x68; D16). Cấu hình ±8 g, ±1000 °/s, DLPF ~20 Hz, 50 Hz đọc lại đúng; đứng yên \|a\| ≈ 1,00 g; 0 lỗi đọc, 0 khe bị bỏ trong các lần chạy |
| Camera | Chân và cấu hình baseline chạy đúng. VGA JPEG q12: 14–48 KB/khung. Chu kỳ khung 90 ms ở XCLK 10 MHz, khoảng 45 ms ở 20 MHz (A41) |
| Loa | I2S 16 kHz stereo trên BCLK 41 / LRC 42 / DIN 1. Lời chào và lời nhắn nghe rõ (người dùng xác nhận). Đô-Rê-Mi 262–330 Hz × 0,3 s ở âm lượng 0,25 không nghe thấy dù ghi đủ mẫu; tiếng 262 Hz × 0,6 s nghe được |
| Nguồn | Chỉ cấp từ USB của PC trong lượt thử; không có reset `brownout` nào trong log khởi động. Pin chưa thử |
