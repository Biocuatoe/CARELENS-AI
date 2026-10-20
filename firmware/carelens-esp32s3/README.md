# Firmware CareLens cho hộp đeo ngực ESP32-S3

Firmware cho thiết bị thật: ESP32-S3-WROOM N16R8 + OV5640 + MPU6050 (chip báo `WHO_AM_I = 0x70`, xem dưới) + MAX98357A, tất cả trong một hộp đeo trên ngực (`docs/HARDWARE.md`, D14). Thực hiện hợp đồng thiết bị v2 (`docs/DEVICE_API.md`) cộng ADR-022 (`received`, hạn tải theo kích thước, xử lý khởi động lại), thiết lập âm lượng từ xa (ADR-024) và lời nhắn MP3 giải mã trên thiết bị (ADR-025, từ `carelens-fw-0.2.0`).

Trạng thái: **Đã kiểm chứng trên bo thật với backend cục bộ** (0.1.0: 2026-10-19; 0.2.0 với MP3: 2026-10-20; chi tiết và giới hạn ở `docs/ESP32_INTEGRATION_PROGRESS.md`, `docs/E2E_TEST_RESULTS.md`). Bản 0.1.0 đã chạy với Worker production (2026-10-20, `docs/PRODUCTION_ROLLOUT_READINESS.md`); bản 0.2.0 chưa.

## Phần cứng và cấu hình build

Chân GPIO, cấu hình camera, PSRAM, flash, bảng phân vùng và USB lấy nguyên từ sketch baseline đã chạy được (`src/config.h`, `platformio.ini`). Không đổi khi chưa kiểm trên bo.

| Mục | Giá trị |
| --- | --- |
| Toolchain | PlatformIO + pioarduino `55.03.38-1` = Arduino-ESP32 3.3.8, ESP-IDF libs 5.5.4 (ADR-021). Bản nạp bằng Arduino IDE trước đây dùng core **3.3.12** (đường dẫn `__FILE__` trong ảnh cũ) |
| Board | `esp32-s3-devkitc1-n16r8`, phân vùng `app3M_fat9M_16MB.csv` (vùng FFat không bị firmware đụng tới) |
| USB | `ARDUINO_USB_CDC_ON_BOOT=1` như baseline. Log chẩn đoán đi ra **UART0** (`Serial0`) → cầu CH343 → COM6, cổng đã kiểm trên bo này |
| Bí mật | Không có trong mã hay ảnh `.bin`. Wi-Fi, URL API, mã thiết bị, token `cld_`, CA tin cậy được nạp vào NVS qua UART (`tools/provision.py`). NVS không mã hóa: ai cầm được flash đọc được |

## Chức năng

| Phần | Hành vi |
| --- | --- |
| Lời chào | "Xin chào." giọng nữ (Piper `vi_VN-vais1000-medium`, VAIS-1000, CC BY 4.0), MP3 4 104 byte nhúng trong flash (`src/greeting_mp3.h`), phát qua bộ giải mã MP3 **một lần mỗi lần khởi động** sau khi I2S sẵn sàng, không cần mạng. Bỏ qua sau brownout và sau 2 lần khởi động liên tiếp chưa tới 60 s (chống lặp khi boot-loop) |
| Âm thanh | Một tác vụ sở hữu I2S. `started` chỉ báo sau khi khối mẫu đầu tiên được driver nhận; `completed` sau mẫu cuối và 150 ms im lặng; ghi thiếu byte là lỗi. Bộ đệm theo số khung, không thể tràn (sửa FW-1). Âm lượng 0,05–0,70 (mặc định 0,25 như baseline), đặt từ dashboard |
| MP3 (ADR-025) | Lời nhắn là MP3 (MPEG-1/2/2.5 Layer III, 8–48 kHz, mono/stereo, ≤ 2 MB, ≤ 60 s). Sau khi tải và kiểm SHA-256: duyệt mọi tiêu đề khung (`src/mp3.cpp`), so với siêu dữ liệu của máy chủ, rồi giải mã **từng khung** bằng dr_mp3 (`src/third_party/dr_mp3`, public domain/MIT-0) vào bộ đệm PSRAM cố định; I2S chạy theo tần số của tệp. WAV PCM cũ vẫn phát được. Heartbeat báo `audio_codecs` khi máy chủ hỏi |
| Lệnh | Heartbeat 60 s, hỏi lệnh 5 s (2 s khi đang có lệnh). Sổ lệnh trong NVS: không phát lại lệnh đã bắt đầu, báo lại trạng thái cuối khi bị giao lại, báo `failed device_rebooted` cho lệnh đang phát lúc khởi động lại. Tải âm thanh theo đoạn 64 KB, kiểm `Content-Range`, kích thước và SHA-256 trước `accepted`; chỉ phát khi `accepted` được máy chủ xác nhận và còn hạn |
| IMU | 50 Hz, ±8 g, ±1000 °/s, DLPF ~20 Hz, mốc `uptime_ms` từng mẫu, vòng đệm 180 s trong PSRAM, lô `imu-batch.v1` mỗi 10 s (tối đa 600 mẫu), gửi lại cùng `batch_seq` khi lỗi mạng/5xx. Luật kích hoạt firmware `|a| ≥ 2,5 g` (`fw-imu-impact-0.1-uncalibrated`) chỉ xin một burst, **không phải bằng chứng ngã** |
| Camera | VGA JPEG q12 như baseline; cảm biến ngủ giữa các burst. Burst 24/40 khung chọn theo mốc thời gian của driver, cách nhau ≥ 110 ms (≈ 7,5–8 fps), liên tục, không có khoảng nghỉ. Burst định kỳ tắt mặc định (`capint=0`); burst theo kích hoạt bắt đầu sau kích hoạt (`trigger_frame_index = 0`, chưa có bộ đệm trước kích hoạt) |
| Mạng | Chỉ chế độ station, không phát AP dự phòng, không web server trên thiết bị. HTTPS bắt buộc: kiểm chứng chỉ và tên máy chủ bằng CA đã nạp, hoặc bằng bộ chứng chỉ ESP-IDF khi không nạp CA. SNTP trước request HTTPS đầu tiên |

## Lệnh (PowerShell, không dùng Git Bash)

```powershell
$env:PLATFORMIO_CORE_DIR = "D:\AI\Cache\platformio"; $env:TMP = "D:\AI\Cache\Tmp"; $env:TEMP = "D:\AI\Cache\Tmp"
python tools\run_host_tests.py                                   # unit test trên PC (WAV, PCM, JPEG, MP3, sổ lệnh, base64): 662 kiểm tra
& D:\AI\Cache\platformio\penv\Scripts\pio.exe run -e carelens                           # build
& D:\AI\Cache\platformio\penv\Scripts\pio.exe run -e carelens -t upload --upload-port COM6   # nạp (bootloader, bảng phân vùng, app; không xóa flash)
python tools\serial_console.py --seconds 30 --reset --cmd selftest --cmd status          # log UART0 + lệnh console
```

Console UART0 (115200): `status`, `selftest`, `greet`, `beep` (đúng chuỗi Đô-Rê-Mi của `/beep` cũ), `sweep` (262/523/1000/2000 Hz), `tone <hz> <ms>`, `cam` (đo một ảnh rồi bỏ, không lưu, không gửi), `burst`, `prov …`, `reboot`.

## Thử đầu-cuối cục bộ (không đụng production)

1. Backend cục bộ: `python backend/care-monitoring/start_backend.py --dev-admin-email local-dev-admin@carelens.invalid`.
2. `python tools\local_e2e_setup.py --lan-ip <IP LAN riêng của PC>`: tạo hồ sơ, thiết bị, agent, tài khoản xem thử, CA thử nghiệm cục bộ và chứng chỉ máy chủ; ghi bí mật vào `D:\AI\Cache\carelens-device\` (ngoài repo) và `integrations/carelens/local-agent/agent.env` (git bỏ qua).
3. `python tools\local_tls_proxy.py`: HTTPS chỉ trên IP LAN đó, chỉ chuyển tiếp `/api/device/v1/*` và `/health` tới `127.0.0.1:8787`. Không mở cổng ra internet, không đổi router hay tường lửa.
4. `python tools\provision.py` rồi thiết bị tự khởi động lại và kết nối.
5. Dashboard: `python backend/care-monitoring/scripts/dev_admin_login.py` (liên kết đăng nhập một lần, chỉ D1 cục bộ), rồi `E2E_HARDWARE_DEVICE=… npx -w @istartup/web playwright test e2e/hardware-device.spec.ts` (`frontend/e2e/hardware-device.spec.ts`).

## Khôi phục

Bản baseline vẫn ở `D:\AI\Cache\carelens-fw-baseline-check\` (nạp lại: `pio run -e baseline -t upload --upload-port COM6`). Bản sao lưu toàn bộ flash trước lần nạp PlatformIO đầu tiên: `D:\AI\Cache\carelens-fw-baseline-check\backup\` (chứa thông tin Wi-Fi, chỉ giữ riêng).

## Phát hiện phần cứng

- Cảm biến IMU trả `WHO_AM_I = 0x70` (MPU6050 thật trả 0x68; 0x70 thường là MPU6500 hoặc chip tương thích). Thanh ghi cấu hình đọc lại khớp và gia tốc lúc đứng yên ≈ 1,00 g, nên dữ liệu dùng được; contract vẫn ghi `sensor: "mpu6050"` (giá trị cố định của schema).
- `/beep` của baseline: mẫu được ghi đủ vào I2S nhưng 3 nốt 262–330 Hz × 0,3 s ở âm lượng 0,25 không nghe thấy, trong khi tiếng 262 Hz dài 0,6 s của lượt quét thì nghe được (người dùng xác nhận). Không phải lỗi firmware hay core; loa nhỏ ở mức âm lượng đó.

## Nguồn lời chào

`assets/greeting_vi_xin_chao_16k.wav` (SHA-256 `0807b15b51e084bf50f8c7eba1c455439ab36d2d94569617dbe4e0cd042588fa`) do `tools/make_greeting.py` tổng hợp cục bộ bằng Piper (phần mềm GPL-3.0) với giọng `vi_VN-vais1000-medium`; bộ dữ liệu VAIS-1000 theo giấy phép CC BY 4.0 (ghi công: VAIS-1000 Vietnamese Speech Synthesis Corpus). Văn bản không rời máy. VITS lấy mẫu nhiễu nên tổng hợp lại sẽ ra tệp khác; WAV đã commit là bản gốc. Từ ADR-025, bản nhúng là `assets/greeting_vi_xin_chao_16k.mp3` (LAME 48 kbps, 16 kHz mono, 4 104 byte, SHA-256 `705cbc979ac1e7bd18de83a0beaed1760b59f6d3f43a996f2db73fe3fb672705`), làm từ WAV đó bằng `tools/make_test_mp3.py encode … --kbps 48`; `tools/embed_asset.py` kiểm khung và sinh `src/greeting_mp3.h`.

## Tệp MP3 thử

`test/fixtures/mp3/` là tone 440/660 Hz tổng hợp (không có giọng người), sinh bằng `tools/make_test_mp3.py fixtures` (LAME qua `lameenc`, chỉ cần khi phát triển). Bản thử trên thiết bị được làm từ câu TTS thử nghiệm bằng `make_test_mp3.py encode` và để ngoài repo (`D:\AI\Cache\carelens-device\mp3\`).
