# Công cụ build firmware ESP32-S3 (PlatformIO + Arduino-ESP32 3.3.8)

Phiên bản 2026-10-19. Trạng thái: **đã kiểm chứng build** trên PC dev cho một bản sao của sketch baseline (`docs/HARDWARE.md` §3). **Chưa nạp** bản build PlatformIO lên thiết bị, nên tương đương khi chạy thật **chưa kiểm chứng**. Quyết định: `docs/DECISIONS.md` ADR-021 (Proposed). Repo chưa có dự án firmware; dự án kiểm tra nằm ngoài repo ở `D:\AI\Cache\carelens-fw-baseline-check\`.

## 1. Phiên bản đã dùng

| Thành phần | Phiên bản | Nguồn |
| --- | --- | --- |
| PlatformIO Core | 6.1.19 (Python 3.11, cài cho người dùng) | `pio --version` |
| Nền `espressif32` (pioarduino) | `55.03.38-1`, SHA-256 tệp zip `54ca527d9920815d8fef77319b9c35679cf71c0299a3a9bf4ad8ae33a6cd95c4` (khớp digest GitHub) | `https://github.com/pioarduino/platform-espressif32/releases/download/55.03.38-1/platform-espressif32.zip` |
| Arduino-ESP32 core | 3.3.8 | `platform.json` → `espressif/arduino-esp32/releases/download/3.3.8/esp32-core-3.3.8.tar.xz` |
| Thư viện SDK | `framework-arduinoespressif32-libs` 5.5.4 (ESP-IDF v5.5.4) | log cài đặt, header ảnh |
| Toolchain | `toolchain-xtensa-esp-elf` 14.2.0+20260121 | log build |
| esptool | 5.2.0 | log build |

Nền chính thức `platformio/espressif32` chỉ có Arduino core 2.x (máy này có 2.0.17), không biên dịch được sketch (`ESP_I2S.h` chỉ có từ core 3.x). pioarduino là bản nền cộng đồng; nó tải core và thư viện từ bản phát hành chính thức của Espressif.

## 2. `platformio.ini` đã kiểm

```ini
[platformio]
default_envs = baseline

[env:baseline]
platform = https://github.com/pioarduino/platform-espressif32/releases/download/55.03.38-1/platform-espressif32.zip
board = esp32-s3-devkitc1-n16r8
framework = arduino
board_build.partitions = app3M_fat9M_16MB.csv
board_upload.maximum_size = 3145728
build_flags =
    -DARDUINO_USB_MODE=1
    -DARDUINO_USB_CDC_ON_BOOT=1
    -DARDUINO_USB_MSC_ON_BOOT=0
    -DARDUINO_USB_DFU_ON_BOOT=0
    -DCORE_DEBUG_LEVEL=0
upload_speed = 115200
monitor_speed = 115200
```

Mỗi dòng ánh xạ từ tùy chọn Arduino IDE ghi trong sketch qua `boards.txt`/`platform.txt` của core 3.3.8 (bảng ở `docs/HARDWARE.md` §4). Board `esp32-s3-devkitc1-n16r8` có sẵn `-DARDUINO_ESP32S3_DEV`, variant `esp32s3`, `memory_type qio_opi`, `-DBOARD_HAS_PSRAM`, 240 MHz, flash QIO 80 MHz 16 MB, lõi loop/event = 1; nó **không** có `ARDUINO_USB_MODE` và dùng phân vùng `default_16MB`, nên hai mục này được đặt rõ.

## 3. Bằng chứng tương đương với Arduino IDE (từ bản build)

| Kiểm | Arduino IDE (core 3.3.8, theo `boards.txt`/`platform.txt`) | PlatformIO (đo) |
| --- | --- | --- |
| Macro khi biên dịch sketch | `ARDUINO_ESP32S3_DEV`, `BOARD_HAS_PSRAM`, `ARDUINO_USB_MODE=1`, `ARDUINO_USB_CDC_ON_BOOT=1`, MSC/DFU = 0, `CORE_DEBUG_LEVEL=0`, lõi 1/1, `F_CPU=240000000L` | Như vậy (dòng biên dịch `src/main.cpp` trong `build-verbose4.log`), thêm `ARDUINO_PARTITION_app3M_fat9M_16MB` |
| Biến thể SDK | `memory_type = qio_opi` | Include `esp32s3/qio_opi/include` |
| Bootloader | `bootloader_qio_80m.elf`, header `--flash-mode dio --flash-freq 80m --flash-size 16MB` | `bootloader_qio_80m.elf`; `esptool image-info`: DIO, 80m, 16MB, hash hợp lệ |
| Ảnh app | header dio / 80m / 16MB | DIO, 80m, 16MB, hash hợp lệ, ESP-IDF v5.5.4 |
| Bảng phân vùng | `app3M_fat9M_16MB.csv` | Giải mã `partitions.bin` khớp từng mục: nvs 0x9000 20K, otadata 0xe000 8K, app0 0x10000 3M, app1 0x310000 3M, ffat 0x610000 10112K, coredump 0xff0000 64K |
| Kích thước | giới hạn app 3 145 728 B, RAM 327 680 B | Flash 1 101 339 B (35,0 %), RAM tĩnh 57 672 B (17,6 %) |
| Cảnh báo trong sketch | — | Không có |

Bỏ `-DCORE_DEBUG_LEVEL=0` thì ảnh app lớn hơn khoảng 32,7 KB (còn mã log), tức **không** còn tương đương mặc định của Arduino IDE. Phải giữ cờ này.

## 4. Khác biệt đã biết

1. **Tệp `.ino` của sketch không build được nguyên dạng bằng PlatformIO.** Bộ chuyển `.ino` → `.cpp` của PlatformIO không hiểu chuỗi raw C++11 (`R"HTML(…)HTML"`) và sinh nguyên mẫu hàm cho các hàm JavaScript trong trang HTML (lỗi `'function' does not name a type`). Arduino IDE thì xử lý được. Cách khuyến nghị của PlatformIO: biên dịch dưới dạng `.cpp` và thêm `#include <Arduino.h>`. Sketch định nghĩa mọi hàm trước khi dùng nên không cần thêm khai báo. Bản baseline cho PlatformIO vì vậy là **bản sao** `main.cpp` = 3 dòng đầu + nội dung sketch; tệp `.ino` gốc không đổi.
2. **Không chạy PlatformIO từ Git Bash/MSYS.** Trình cài công cụ của pioarduino báo `MSys/Mingw is not supported` rồi toolchain không dùng được. Dùng PowerShell, cmd hoặc terminal của VS Code (PowerShell).
3. **Bản nạp bằng Arduino IDE trước đây dùng core 3.3.12** (đã xác định 2026-10-19 từ bản sao lưu flash: ảnh app chứa đường dẫn `__FILE__` `Arduino15\packages\esp32\hardware\esp32\3.3.12\cores\esp32\…` và `tools\esp32s3-libs\3.3.12`, header ảnh ghi ESP-IDF v5.5.5). Arduino15 trên PC này chỉ có 3.3.8. Baseline build bằng 3.3.8 chạy đúng trên bo; chưa thấy khác biệt hành vi do chênh core.
4. **CH343 có thể ngừng chuyển dữ liệu UART** (đã gặp 2026-10-19 sau vài lần esptool không kết nối được): không có banner ROM khi reset, esptool báo "No serial data received". Rút cáp USB rồi cắm lại đúng cổng là hết; không cần đổi driver hay cài gì.

## 5. Cài đặt (không cần quyền admin)

Ổ C: còn khoảng 5 GB, bộ công cụ tải về khoảng vài GB, nên đặt thư mục PlatformIO trên D:.

1. Kiểm PlatformIO Core trong PowerShell: `pio --version` (máy này: 6.1.19). Nếu chưa có: `py -3.11 -m pip install --user "platformio==6.1.19"`.
2. Mỗi phiên PowerShell trước khi build:

   ```powershell
   $env:PLATFORMIO_CORE_DIR = "D:\AI\Cache\platformio"
   $env:TMP = "D:\AI\Cache\Tmp"; $env:TEMP = "D:\AI\Cache\Tmp"
   ```

   Muốn cố định cho mọi phiên và cho VS Code: đặt biến môi trường **người dùng** `PLATFORMIO_CORE_DIR` (không cần admin, nhưng là thay đổi cấu hình Windows nên tôi không tự làm): `[Environment]::SetEnvironmentVariable("PLATFORMIO_CORE_DIR", "D:\AI\Cache\platformio", "User")`, rồi mở lại VS Code.
3. VS Code: cài extension **PlatformIO IDE** (`platformio.platformio-ide`). Nếu chưa đặt biến ở bước 2, extension cài core vào `%USERPROFILE%\.platformio` trên ổ C:.
4. Lần build đầu tự tải nền, core 3.3.8 và toolchain vào `D:\AI\Cache\platformio` (cần mạng tới GitHub).

## 6. Build bản baseline (bản sao cục bộ, không commit)

1. Tạo thư mục dự án (ví dụ đã có `D:\AI\Cache\carelens-fw-baseline-check\`) với `platformio.ini` ở §2.
2. Tạo `src\main.cpp`: dòng `#include <Arduino.h>` rồi chép nguyên nội dung sketch `.ino`. Muốn thiết bị vào Wi-Fi thì giữ SSID/mật khẩu thật **chỉ trong bản sao cục bộ này**; không đưa tệp này vào repo, chat hay ảnh chụp. Để placeholder thì sketch tự phát AP `ESP32S3-CAM` như bản gốc.
3. Build: `pio run -e baseline` (trong thư mục dự án). Kết quả ở `.pio\build\baseline\`: `bootloader.bin`, `partitions.bin`, `firmware.bin`, `firmware.factory.bin` (gộp, nạp tại 0x0).

## 7. Chọn board và cổng

- Board và mọi tùy chọn bộ nhớ đã cố định trong `platformio.ini`; không chọn board ở menu nào khác.
- Cắm cáp USB, chạy `pio device list`. Cổng USB gốc của ESP32-S3 (Hardware CDC/JTAG) có VID:PID `303A:1001`. Sketch bật CDC On Boot nên log `Serial` đi qua cổng USB gốc. Nếu bo mang có thêm chip USB-UART (CH340/CP210x) thì đó là cổng khác; bo của dự án chưa xác định nên kiểm bằng `pio device list`.
- Ghi cổng khi nạp: `--upload-port COMx`, khi xem log: `--port COMx`.

## 8. Nạp và xem log (chỉ khi owner cho phép; lượt 2026-10-19 được phép nạp COM6)

Firmware tích hợp (`firmware/carelens-esp32s3/`) dùng cùng cấu hình: `pio run -e carelens -t upload --upload-port COM6`, log qua UART0 bằng `python tools/serial_console.py` (không dùng `pio device monitor`: nó bật DTR/RTS và có thể reset bo). Chi tiết: `firmware/carelens-esp32s3/README.md`. Mục dưới đây là cho bản baseline.

1. Nên sao lưu toàn bộ flash trước lần nạp đầu bằng PlatformIO (16 MB, có NVS và thông tin Wi-Fi đã biên dịch: lưu riêng tư, không commit):
   `& "D:\AI\Cache\platformio\penv\Scripts\esptool.exe" --chip esp32s3 --port COMx --baud 115200 read-flash 0 0x1000000 D:\AI\Cache\flash-backup-baseline.bin`
2. Nạp: `pio run -e baseline -t upload --upload-port COMx` (115200 như chú thích sketch). Lệnh ghi bootloader (0x0), bảng phân vùng (0x8000), `boot_app0` (0xe000), app (0x10000); vùng FFat (0x610000) không bị xóa nên `hello.wav` đã tải lên vẫn còn. Nếu không vào được chế độ nạp: giữ BOOT, nhấn RESET, thả BOOT.
3. Xem log: `pio device monitor -e baseline --port COMx`. Kỳ vọng theo sketch: `Camera: OK | MPU6050: OK | Loa: OK | FFat: OK`, rồi `Mo: http://<IP>:82/` (đã vào Wi-Fi) hoặc `Che do AP: http://192.168.4.1:82/`. USB CDC liệt kê lại khi reset nên có thể lỡ vài dòng đầu: mở monitor rồi nhấn RESET.
4. Thử nhanh (không đụng production). **Lưu ý riêng tư:** sketch baseline mở camera trực tiếp, chụp ảnh, tải WAV và phát loa trên LAN **không xác thực** (CORS `*`, AP dự phòng mật khẩu cố định); chỉ thử trên mạng tin cậy, với người thử đã đồng ý, không bao giờ với người bệnh thật, và tắt thiết bị sau khi thử. Firmware tích hợp backend sẽ không có trang này (AGENTS.md §6). Các mục thử: trang `:82/`, Đô-Rê-Mi, phát `hello.wav` (WAV **stereo** cho tới khi sửa lỗi tràn bộ đệm mono FW-1), `/imu`. So với hành vi của bản nạp bằng Arduino IDE.
5. Quay lại: nạp lại bằng Arduino IDE như trước (cùng tùy chọn), hoặc ghi lại bản sao lưu: `… esptool.exe --chip esp32s3 --port COMx --baud 115200 write-flash 0 D:\AI\Cache\flash-backup-baseline.bin`.

## 9. Bộ giải mã MP3 (ADR-025, `carelens-fw-0.2.0`)

| Mục | Giá trị |
| --- | --- |
| Thư viện | dr_mp3 v0.7.4 (mackron/dr_libs, commit `51e61d30`, 2026-08-31), public domain / MIT-0, dựa trên minimp3. Vendored nguyên vẹn ở `src/third_party/dr_mp3/` (README ghi nguồn, SHA-256 `997b7ee1…a2f`, giấy phép). Không thêm `lib_deps`, không đổi `platformio.ini` ngoài phiên bản firmware |
| Biên dịch | Một lần trong `src/dr_mp3_impl.c` (`DR_MP3_NO_STDIO`, `DR_MP3_NO_SIMD`, tắt cảnh báo của mã bên thứ ba). Host test biên dịch tệp này bằng `gcc` riêng, mã của dự án vẫn `-Werror` |
| Bộ nhớ | Trạng thái `drmp3dec` 22 928 byte (gồm vùng scratch) + một khung PCM 4 608 byte, cấp một lần trong PSRAM ở lần phát MP3 đầu. Tệp MP3 (≤ 2 MB) nằm trong PSRAM khi phát rồi được giải phóng. Ngăn xếp task âm thanh 8 KB (còn trống 4 344 byte khi đo). Không đổi phân vùng, PSRAM, flash, GPIO hay USB |
| Lý do chọn | Được bảo trì; chỉ C chuẩn; API "push" cấp thấp giải từng khung trên bộ đệm của mình và cho phép đặt toàn bộ trạng thái vào PSRAM, nên RAM nội (`CONFIG_MBEDTLS_INTERNAL_MEM_ALLOC`, khoảng 72 KB trống) giữ cho Wi-Fi/TLS. Đã loại: libhelix (RPSL), `esp_audio_codec` (cần build hybrid ESP-IDF), libmad (GPL) |
| Đã đo trên bo | Xem `docs/E2E_TEST_RESULTS.md` §9: CPU giải mã 1,6 % (8 kHz mono) tới 11,5 % (48 kHz stereo 320 kbps) thời gian thực |

Tạo tệp thử: `tools/make_test_mp3.py` (LAME qua gói `lameenc`, chỉ dùng khi phát triển, cài trong venv riêng: `pip install lameenc numpy`). `fixtures` sinh tone tổng hợp cho host test (`test/fixtures/mp3/`); `encode` đổi một WAV (ví dụ lời chào hay câu TTS thử) sang MP3 với `--kbps`, `--rate`, `--channels`, `--vbr`, `--repeat`. Lời chào: `encode assets/greeting_vi_xin_chao_16k.wav assets/greeting_vi_xin_chao_16k.mp3 --kbps 48` rồi `python tools/embed_asset.py` (sinh `src/greeting_mp3.h`).
