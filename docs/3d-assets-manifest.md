# Manifest tài sản 3D (CareLens exploded view)

Cập nhật: 2026-10-13 (đợt 2: mô-đun 3D runtime, §7; đợt 3: bố trí lắp ráp, §8). Phạm vi: tám linh kiện bên trong thiết bị CareLens. Hai file vỏ (`Body_CareLens_43x32x65.stl`, `topcap_ CareLens_43x32x65.stl`) đã gỡ khỏi thư mục gốc (2026-10-14); bản duy nhất nằm ở `frontend/public/models/carelens/enclosure/` (`body.stl`, `topcap.stl`, SHA-256 ghim trong `enclosure.test.ts`), không nằm trong manifest này.

Nhãn trạng thái: **Đã kiểm chứng** (có lệnh hoặc số đo), **Đề xuất** (chọn làm tạm), **Chưa xác minh**. Không có linh kiện nào dưới đây được xác minh là khớp đúng phần cứng thật.

## 1. Tóm tắt

| # | Linh kiện | Kết quả | Nguồn | Giấy phép | Được phát hành công khai? |
| --- | --- | --- | --- | --- | --- |
| 1 | ESP32-S3 N16R8 WROOM CAM | **Một phần**: chỉ có module WROOM-1, không có bo mạch camera | KiCad `RF_Module` | CC-BY-SA 4.0 (ngoại lệ KiCad) | Chưa. Chờ bạn chấp nhận điều kiện ShareAlike |
| 2 | TP4056 USB-C | Có, **sai biến thể** (bo UPS 40,9 × 20 mm) | Boardoza | CC-BY-SA 4.0 | Chưa. Chờ bạn chấp nhận ShareAlike và biến thể phù hợp |
| 3 | GY-521 MPU6050 | **Không tải được** | Marathon OS (cần đăng nhập, không ghi giấy phép) | Không rõ | Không |
| 4 | MAX98357A | Có | Adafruit `3006` | MIT | **Có** (kèm thông báo bản quyền) |
| 5 | Mạch boost 3,7 → 5 V | **Không xác định được biến thể**, không tải | SketchUp 3D Warehouse (cần đăng nhập) | Không rõ | Không |
| 6 | Loa 8 Ω mini | Có, **mô hình thay thế** (hình oval 32,5 × 19,9 mm) | Adafruit `3923` | MIT | **Có** |
| 7 | Công tắc trượt ON/OFF | CAD 56 tam giác **không dùng**; runtime dựng bằng code (có cần gạt trượt thật) | Adafruit `805` (không dùng) | MIT | Không đưa vào `public/` |
| 8 | Pin LiPo 2000 mAh | CAD là khối hộp **không dùng**; runtime dựng túi pin và dây bằng code theo kích thước tham chiếu, **không lắp vừa vỏ** | Adafruit `2011` (chỉ lấy kích thước) | MIT | Không đưa vào `public/` |

Dựng bằng three.js trong runtime (xem §7): bo ESP32-S3 CAM + ống kính, pin + dây, TP4056 + USB-C, mạch boost, GY-521, công tắc trượt. Chỉ MAX98357A và loa dùng file CAD.

## 2. Chi tiết từng linh kiện

Kích thước đo từ chính file đã chuyển đổi (mm, trục gốc của STEP, không co giãn). Đây là kích thước mô hình, không phải kích thước linh kiện thật.

### 2.1 ESP32-S3 N16R8 WROOM CAM

| Mục | Giá trị |
| --- | --- |
| File dùng | `tools/3d-assets/source/kicad-esp32s3-ccbysa/ESP32-S3-WROOM-1.step` (từ `RF_Module.3dshapes/ESP32-S3-WROOM-1.step`) |
| URL | https://gitlab.com/kicad/libraries/kicad-packages3D (nhánh `master`, tải ngày 2026-10-13) |
| Giấy phép | CC-BY-SA 4.0, kèm ngoại lệ cho **thiết kế điện tử** dùng thư viện. Ngoại lệ không áp dụng khi phân phối lại mô hình riêng lẻ. Bản sao: `source/kicad-esp32s3-ccbysa/LICENSE.md` |
| Yêu cầu | Ghi công KiCad, nêu rõ đã chuyển đổi STEP sang GLB, phát hành file GLB này theo CC-BY-SA 4.0 |
| Biến thể | Module WROOM-1 ăng-ten PCB, **không phải bo CAM**. N16R8 có cùng gói cơ khí theo datasheet, nhưng chưa kiểm chứng trên file này |
| Kích thước | 18 × 25,5 × 3,1 mm (gốc ở giữa module, đáy tại Z = 0) |
| Độ phức tạp | STEP 1.906.878 B → GLB 94.332 B (sau hàn đỉnh, lượng tử hoá, gộp bản sao), 52 nút mesh, 10 mesh duy nhất, 7.564 tam giác |
| Chuyển đổi | Xong. `tools/3d-assets/processed-conditional/esp32s3-wroom1-kicad.glb` |
| Đối chiếu | Kích thước khớp từng số với STEP chính hãng Espressif (18 × 25,5 × 3,1). Đã kiểm chứng bằng cách chuyển đổi cả hai file |
| Cần thay hoặc tinh chỉnh | **Có.** Phải thêm bo mạch CAM, đầu nối camera, ống kính OV2640/OV5640 và khe SD bằng three.js. Không có CAD có giấy phép cho bo thật |

Nguồn đã loại:

| Nguồn | Lý do |
| --- | --- |
| shanhu3d.com/model/10464995 (Freenove ESP32-S3-WROOM-CAM, 23,1 MB) | Trang tải cần tài khoản và điểm, ghi "All Rights Reserved", không có giấy phép. Không tải |
| Freenove GitHub | Giấy phép CC BY-NC-SA 3.0 (phi thương mại). Không phù hợp sản phẩm thương mại. Không thấy file STEP ở thư mục gốc và cấp một của `Datasheet`, `C`, `Python`, `CH343` (chưa duyệt sâu hơn) |
| Espressif chính hãng (`ESP32-S3-WROOM-1 3D Model.STEP`, 6,2 MB) | Trang tải **không nêu điều khoản sử dụng hay phân phối lại**. Đã tải về `source/espressif-unspecified/` chỉ để đối chiếu kích thước, **không dùng cho runtime**. Xem `NOTICE.txt` trong thư mục đó |

### 2.2 TP4056 USB-C

| Mục | Giá trị |
| --- | --- |
| File dùng | `tools/3d-assets/source/boardoza-tp4056-ccbysa/TP4056_Step.step` (2.145.106 B) |
| URL | https://github.com/Boardoza/Boardoza_TP4056_Lithium_Battery_Charger_Breakout_Board (`assets/TP4056 Step.step`) |
| Giấy phép | CC-BY-SA 4.0 (khai báo trong repo và README). Bản sao: `LICENSE.txt` cùng thư mục |
| Yêu cầu | Ghi công Boardoza, nêu thay đổi, giữ CC-BY-SA 4.0 cho file GLB |
| Biến thể | **Boardoza TP4056 UPS Type-C, 20 × 40 mm** (README). Tên trong STEP: "Battery Protector Load Switch", xuất từ KiCad. **Không phải** mô-đun TP4056 USB-C phổ biến trên thị trường (thường nhỏ hơn); biến thể bạn dùng chưa được xác định |
| Kích thước | 40,94 × 20 × 9,4 mm. Nguồn gốc trục không ở giữa; GLB đã đặt lại gốc bằng dịch chuyển nút gốc `[-177,814; 114,743; 1,8]` (đỉnh vật thể không bị sửa) |
| Độ phức tạp | STEP 2.145.106 B → GLB 624.216 B, 65 nút mesh, 40 mesh duy nhất, 33.756 tam giác |
| Chuyển đổi | Xong. `tools/3d-assets/processed-conditional/tp4056-boardoza.glb` |
| Cần thay hoặc tinh chỉnh | **Có.** Thay bằng kích thước thật của mô-đun bạn mua, hoặc dựng bằng three.js |

### 2.3 GY-521 MPU6050

| Mục | Giá trị |
| --- | --- |
| Kết quả | **Không tải.** Chưa có file |
| Nguồn thử | https://marathon-os.com/library/gy521-mpu6050-accelerometer-and-68155822fcc7c6ee36fcf89e |
| Lý do | Trang có nút Login, không nêu giấy phép, chỉ ghi "file chia sẻ để lấy cảm hứng, có thể không chính xác". Không vượt qua đăng nhập, không dùng cho công khai |
| Số liệu tham khảo | Trang công bố hộp bao 21 × 16 × 3,8 mm (**Chưa xác minh**, chưa đo trên bo thật) |
| Thay thế đã xét | Adafruit CAD Parts (MIT) không có MPU-6050. Chỉ có IMU 6DoF khác, không cùng bo, nên không dùng |
| Việc cần làm | `TODO-3D-01`: dựng bo GY-521 bằng three.js (bo 21 × 16, chip, hàng chân 2,54 mm) |

### 2.4 MAX98357A

| Mục | Giá trị |
| --- | --- |
| File dùng | `tools/3d-assets/source/adafruit-mit/3006_MAX98357.step` (296.260 B) |
| URL | https://github.com/adafruit/Adafruit_CAD_Parts (thư mục `3006 MAX98357`) |
| Giấy phép | MIT, bản quyền Adafruit Industries 2016. Bản sao: `source/adafruit-mit/LICENSE.txt` |
| Yêu cầu | Giữ thông báo bản quyền MIT (đã có trong `ATTRIBUTION.txt`) |
| Biến thể | Bo Adafruit MAX98357A. Bo clone trên thị trường có thể có kích thước khác |
| Kích thước | 17,78 × 19,05 × 2,57 mm |
| Độ phức tạp | STEP 296.260 B → GLB 132.344 B (bản đầu chưa tối ưu: 218.396 B), 17 nút mesh, 5.672 tam giác |
| Chuyển đổi | Xong. `frontend/public/models/carelens/components/max98357a-adafruit-3006.glb`. **Đang dùng trong runtime** |
| Cần thay hoặc tinh chỉnh | Khi biết bo thật. Nguồn thay thế bị loại: `nulllaborg/max98357a-module` (GitHub không khai báo giấy phép, repo không có file LICENSE) |

### 2.5 Mạch boost 3,7 → 5 V

| Mục | Giá trị |
| --- | --- |
| Kết quả | **Không tải.** Biến thể IC/PCB chưa xác định (MT3608 chỉ là ứng viên) |
| Nguồn thử | https://embed-3dwarehouse-classic.sketchup.com/model/4ea83fc5-145d-4fa3-a376-fd5663e1f32c/MT3608-Boost-Converter |
| Lý do | Nút tải cần đăng nhập SketchUp 3D Warehouse; trang không nêu giấy phép cho từng mô hình. Không vượt qua đăng nhập |
| Số liệu tham khảo | Trang ghi hộp bao 20 × 44 × 10 mm (**Chưa xác minh**; nguồn độc lập khác ghi bo MT3608 37,2 × 17,2 × 14 mm, hai số không khớp nhau) |
| Việc cần làm | `TODO-3D-02`: cần biết mô-đun thật (ảnh hoặc kích thước đo) trước khi dựng bằng three.js |

### 2.6 Loa 8 Ω mini

| Mục | Giá trị |
| --- | --- |
| File dùng | `tools/3d-assets/source/adafruit-mit/3923_Mini_Oval_Speaker.step` (76.364 B) |
| URL | https://github.com/adafruit/Adafruit_CAD_Parts (thư mục `3923 Mini Oval Speaker`) |
| Giấy phép | MIT, Adafruit Industries |
| Biến thể | **Mô hình thay thế theo hình dạng**, không phải loa của bạn. Chưa biết loa thật |
| Kích thước | 19,9 × 32,495 × 6,499 mm |
| Độ phức tạp | STEP 76.364 B → GLB 127.844 B (GLB **lớn hơn** STEP; bản đầu 205.716 B), 8 mesh, 5.980 tam giác |
| Chuyển đổi | Xong. `frontend/public/models/carelens/components/speaker-adafruit-3923.glb`. **Đang dùng trong runtime** |
| Cần thay hoặc tinh chỉnh | Khi biết loa thật |

Nguồn đã loại hoặc chưa dùng: Taoglas SPKM208A trên TraceParts trả HTTP 403 (không tải). KiCad có `Speaker_CUI_CMR-1206S-67.step` (CC-BY-SA, chưa tải).

### 2.7 Công tắc trượt ON/OFF

| Mục | Giá trị |
| --- | --- |
| File dùng | `tools/3d-assets/source/adafruit-mit/805_slide_switch.step` (22.814 B) |
| URL | https://github.com/adafruit/Adafruit_CAD_Parts (thư mục `805 slide switch`) |
| Giấy phép | MIT, Adafruit Industries |
| Biến thể | Công tắc trượt SPDT kiểu Adafruit, **không phải công tắc của bạn**. Đây là công tắc trượt chốt, không phải nút bấm nhả |
| Kích thước | 11,7 × 4 × 8 mm |
| Độ phức tạp | GLB 3.112 B, **1 mesh, 56 tam giác**: khối thô, chưa xem hình dạng cần gạt |
| Chuyển đổi | Xong nhưng **không dùng**: `tools/3d-assets/processed-unused/slide-switch-adafruit-805.glb`. Runtime dựng công tắc bằng code vì cần cần gạt trượt riêng |
| Cần thay hoặc tinh chỉnh | Nên. Độ chi tiết thấp; hành trình gạt và vị trí ON/OFF **Chưa xác minh** |

Đã loại: `innerscene.com/.../6-mm-tactile-switch-8f9e0daf` (CC0, nhưng là nút bấm nhả theo mô tả trang, không dùng làm công tắc nguồn). KiCad có `SW_Slide_SPDT_Straight_CK_OS102011MS2Q.step` (CC-BY-SA, chưa tải) làm phương án dự phòng.

### 2.8 Pin LiPo dẹt 2000 mAh

| Mục | Giá trị |
| --- | --- |
| File dùng | `tools/3d-assets/source/adafruit-mit/2011_2000mAh_Battery.step` (14.821 B) |
| URL | https://github.com/adafruit/Adafruit_CAD_Parts (thư mục `2011 2000mAh Battery`) |
| Giấy phép | MIT, Adafruit Industries |
| Biến thể | Pin Adafruit 2011. **Kích thước pin thật của bạn chưa biết** |
| Kích thước | 37 × 60 × 7,5 mm |
| Độ phức tạp | GLB 5.672 B, 1 mesh, 188 tam giác (khối hộp, không có dây) |
| Chuyển đổi | Xong nhưng **không dùng**: `tools/3d-assets/processed-unused/lipo-adafruit-2011.glb`. Runtime dựng túi pin và dây bằng code, lấy kích thước 37 × 60 × 7,5 mm từ mô hình này |
| Lắp vào vỏ | **Không vừa.** Cạnh dài 60 mm lớn hơn mọi kích thước bên trong vỏ đã đo (39 × 28 mặt cắt, cao khoảng 50 mm). Cần pin nhỏ hơn hoặc vỏ khác |
| Cần thay hoặc tinh chỉnh | **Có**, cần kích thước pin thật |

## 3. Kiểm tra đã chạy

| Kiểm tra | Kết quả |
| --- | --- |
| Header file STEP | Cả 7 file bắt đầu bằng `ISO-10303-21`. Không phải HTML, không phải con trỏ Git LFS (`grep git-lfs` không có kết quả) |
| Chuyển đổi STEP → GLB | 7/7 thành công (`tools/3d-assets/scripts/step-to-glb.mjs`) |
| Đọc lại GLB độc lập | `node scripts/verify-glb.mjs`: 6/6 GLB giữ lại đọc được, không có NaN, có tam giác (GLB thứ 7, từ STEP Espressif, chỉ tạo tạm để đối chiếu rồi bỏ) |
| Hai file STL vỏ | SHA-256 trước và sau không đổi |
| GLB nạp được trong three.js | **Đã kiểm chứng**: `GLTFLoader` trong Vitest (`assembly.test.ts`) và trong Chromium (`e2e/hardware.spec.ts`), kích thước khớp phép đo nguồn |
| Hình dạng mô hình | Đã xem ảnh chụp Chromium (`frontend/test-results/screens/hardware-*.png`) cho hai GLB đang dùng và các mô hình dựng bằng code. Chưa xem hai GLB CC-BY-SA và hai GLB không dùng |

## 4. Việc cần làm

| ID | Việc | Chặn bởi |
| --- | --- | --- |
| TODO-3D-01 | ~~Dựng GY-521 bằng three.js~~ Đã dựng (16 × 21 mm điển hình). Còn lại: thay bằng số đo bo thật | Kích thước đo thật |
| TODO-3D-02 | ~~Dựng mạch boost~~ Đã dựng (17 × 36 mm kiểu MT3608). Còn lại: xác định mô-đun thật | Xác định mô-đun thật |
| TODO-3D-03 | ~~Dựng bo ESP32-S3 CAM~~ Đã dựng (27 × 40 mm; ống kính khớp tâm cửa sổ 8 × 8 mm, có test). Còn lại: biến thể bo thật; dùng module KiCad nếu chấp nhận CC-BY-SA | Biến thể bo thật |
| TODO-3D-04 | Quyết định về hai mô hình CC-BY-SA (`processed-conditional/`) | Chủ dự án chấp nhận ghi công và ShareAlike. Nếu có, chuyển GLB sang `frontend/public/models/carelens/components/` và bổ sung `ATTRIBUTION.txt` |
| TODO-3D-05 | Thay pin bằng kích thước thật (`manifest.ts`); pin tham chiếu 60 mm không lắp vừa | Kích thước pin |
| TODO-3D-06 | ~~Xem hình dạng GLB~~ Xong cho hai GLB đang dùng | – |
| TODO-3D-07 | Bổ sung lỗ cổng sạc và lỗ công tắc cho vỏ (hai mesh vỏ hiện không có) | File STL sửa đổi hoặc quyết định hiển thị lỗ đề xuất |

Chưa có giai đoạn nào kiểm tra chồng lấn hay khoảng hở giữa các linh kiện trong vỏ. Mọi vị trí trong ảnh nổ sẽ là minh họa, không phải bố trí đã xác minh.

## 5. Tái tạo

```powershell
cd tools/3d-assets
npm ci
node scripts/step-to-glb.mjs source/adafruit-mit/3006_MAX98357.step ../../frontend/public/models/carelens/components/max98357a-adafruit-3006.glb --name max98357a-adafruit-3006
node scripts/verify-glb.mjs ../../frontend/public/models/carelens/components/*.glb
```

Công cụ chỉ chạy lúc build (`occt-import-js` 0.0.23 LGPL-2.1, `@gltf-transform` 4.5.1 MIT). Chúng không nằm trong `frontend/package.json` và không vào bundle web.

## 6. Hash nguồn (SHA-256)

| File | SHA-256 |
| --- | --- |
| `adafruit-mit/3006_MAX98357.step` | `bdc3c4c3dcbb7402eb73427a87efb1fe99a8b674fa7217ac56fc2315b027ec93` |
| `adafruit-mit/3923_Mini_Oval_Speaker.step` | `d2f8e1981d47382d63b105b375fc113a4278b3500cd80900a7f82500fc9b7120` |
| `adafruit-mit/805_slide_switch.step` | `192359d794292afb0ccaab33378a2671377e973f2e7fa6e93527f8b6fa5d2a4c` |
| `adafruit-mit/2011_2000mAh_Battery.step` | `dc8a606030ce3ec1b2c349d1a6843084411cd2ef5ea1889d135956523d801bd3` |
| `boardoza-tp4056-ccbysa/TP4056_Step.step` | `355ab717694b1bf850c816bdaff939b04702172fd13ae32a67719ef1efb238b9` |
| `kicad-esp32s3-ccbysa/ESP32-S3-WROOM-1.step` | `3e35bb7ba7d030d88855fcf968398c8670934c7dca08b4e30b2c578bc1e13954` |
| `espressif-unspecified/ESP32-S3-WROOM-1_3D_Model.STEP` | `02e192087a1a2268ccbe7bf667ef04884370fc76c994484bf85654dfa7407ef6` |

Giấy phép trong bảng chỉ phản ánh những gì đọc được từ repo hoặc trang nguồn ngày 2026-10-13. Đây không phải tư vấn pháp lý; chủ dự án xác nhận trước khi phát hành công khai.

## 7. Mô-đun 3D runtime (đợt 2)

Mã: `frontend/src/lib/hardware3d/` (cấu hình lắp ráp `assemblyConfig.ts`, vật liệu, dựng linh kiện, lắp ráp, viewer, kiểm tra `validate.ts`). Giao diện kiểm tra: `frontend/src/features/hardware/`, route nội bộ `/hardware-inspector` (không có liên kết điều hướng, tải lười). Landing và hoạt ảnh cuộn chưa làm.

Quy ước: 1 đơn vị = 1 mm, khung CAD (Z lên, mặt trước là −Y) như STL; `assembly.root` xoay −90° quanh X sang khung three.js. Gốc cục bộ của mọi linh kiện là tâm hộp bao.

### 7.1 Vật thể trong cảnh

| Mã vật thể | Nguồn | Mức bằng chứng | File tải về |
| --- | --- | --- | --- |
| `enclosure-body` | STL của dự án | Đo từ mesh | `enclosure/body.stl` 1.105.484 B |
| `enclosure-cap` | STL của dự án | Đo từ mesh | `enclosure/topcap.stl` 580.684 B |
| `max98357a` | Adafruit 3006 (GLB) | CAD tham chiếu | `components/max98357a-adafruit-3006.glb` 132.344 B |
| `speaker` | Adafruit 3923 (GLB) | CAD tham chiếu | `components/speaker-adafruit-3923.glb` 127.844 B |
| `esp32-cam` (có `lens`, `camera-module`, `esp32-s3-wroom-1`) | Dựng bằng code | Ước lượng | Không |
| `lipo-cell` (có `pouch`, `wires`) | Dựng bằng code | Ước lượng | Không |
| `tp4056` (có `usb-c`) | Dựng bằng code | Ước lượng | Không |
| `boost-converter` (có `trimmer`) | Dựng bằng code | Ước lượng | Không |
| `gy521` | Dựng bằng code | Ước lượng | Không |
| `slide-switch` (có `slider`) | Dựng bằng code | Ước lượng | Không |

Tổng file tải khi mở trang kiểm tra: 4 file, 1.946.356 B (1,86 MiB). Hai bản sao STL trong `public/` giống từng byte file gốc ở thư mục gốc (test so SHA-256).

### 7.2 Đo từ mesh STL (ray cast, có test)

| Đại lượng | Giá trị |
| --- | --- |
| Thân | 43 × 32 × 53 mm, z 0 → 53 |
| Nắp | 43 × 32 × 16 mm, z 49 → 65 |
| Khoang trong | x 2 → 41, y 2 → 30, đáy phẳng z = 2, mặt trong nắp z = 63; mặt cắt đầy đủ 39 × 28 tới z ≈ 57 |
| Vành cắm nắp | khe hở 36 × 25 mm ở z 53 → 54,3 |
| Cửa sổ camera | 8 × 8 mm, tâm x = 21,5, z = 20,5 (đếm 64 tia lọt qua lưới 1 mm) |
| Lỗ cổng sạc, lỗ công tắc | **Không có**: 0 tia lọt qua ba thành còn lại trong vùng z 8 → 50 |

### 7.3 Kiểm tra đã chạy (2026-10-13)

| Lệnh | Kết quả |
| --- | --- |
| `npx tsc -b --noEmit` | Pass |
| `npm run lint` | Pass |
| `npx vitest run src/lib/hardware3d` | 19/19 pass (nạp thật STL và GLB từ `public/`) |
| `npm test` (toàn bộ) | 125/126 pass. 1 lỗi ở `landing.test.tsx` ("Mất kết nối"); file landing không được sửa trong đợt này, chưa điều tra nguyên nhân |
| `npx playwright test e2e/hardware.spec.ts` | 3/3 pass: 10 vật thể `loaded`, khung 3D có điểm ảnh thật (đọc render target), không lỗi console, không tràn ngang ở 360 → 1440 px |
| `npm run test:e2e` (toàn bộ) | 19 pass, 3 skipped, 2 fail ở `flows.spec.ts` (AC11 và hết phiên). Hai lỗi này **vẫn xảy ra khi gỡ route 3D và build lại**, nên không do đợt này gây ra; chưa điều tra nguyên nhân |
| `npm run build` | Pass. Bundle chính 727,78 kB (gzip 208,96 kB). Chunk 3D riêng 686,61 kB (gzip 176,39 kB), chỉ tải ở `/hardware-inspector` |

### 7.4 Kết quả đáng chú ý

- Pin tham chiếu 37 × 60 × 7,5 mm **không nằm gọn** trong khoang (xem A14). Trang hiển thị cảnh báo này.
- Bố trí linh kiện trong vỏ chỉ là minh hoạ. Hộp bao thô của các linh kiện giao nhau ở trạng thái lắp (trang liệt kê số cặp). Ở trạng thái tách rời hoàn toàn không có cặp nào giao nhau (có test).
- Vỏ chưa có lỗ cho USB-C, công tắc, loa; mô hình công tắc và USB-C quay hướng tuỳ ý trong vỏ.
- Điều chưa kiểm tra: hiệu năng trên thiết bị yếu (chỉ chạy Chromium headless, kết xuất phần mềm), Safari/Firefox, khả năng truy cập bằng trình đọc màn hình ngoài nhãn của canvas.

## 8. Bố trí lắp ráp (đợt 3)

Nguồn sự thật cho vị trí: `frontend/src/lib/hardware3d/assemblyConfig.ts`. Mỗi linh kiện có mã, tài sản, kích thước kèm mức bằng chứng,
hộp và hướng khi lắp, vị trí và hướng khi tách rời, trạng thái và ghi chú vị trí. Test bắt buộc hộp trong cấu hình khớp hình học thật (sai lệch ≤ 0,01 mm).

### 8.1 Đặc điểm vỏ đo lại từ STL

| Đặc điểm | Kết quả | Cách đo |
| --- | --- | --- |
| Cửa sổ camera vuông | **Có**: 8 × 8 mm, tâm x 21,5, z 20,5, thành trước | 42.000 tia từ 6 điểm trong vỏ đóng: chỉ 198 tia thoát, tất cả qua cửa sổ này |
| Lỗ USB-C chữ nhật | **Không có** | Cùng phép quét |
| Rãnh công tắc trượt | **Không có** | Cùng phép quét |
| Khoang, thành, đáy | Thành 2 mm, khoang 39 × 28 mm, góc trong R6, đáy phẳng z = 2, mép đáy bo khoảng R5 | Lát cắt và ray cast |
| Mặt ghép nắp | Vành cắm 1,2 mm, gờ trong 36 × 25 mm ở z 53–54,3; hai lẫy ±Y ăn vào rãnh sâu 0,5 mm ở z 49,6–51 | Lát cắt |
| Trụ đỡ, ray, gân, ụ bắt vít | **Không có** | Mặt cắt ngang trong khoang luôn là hình chữ nhật bo góc trơn |

Vì vậy không linh kiện nào được giữ cơ khí trong vỏ hiện tại; bố trí là vị trí hợp lý, không phải lắp ráp đã kiểm chứng.

### 8.2 Bố trí (khung CAD, mm)

| Linh kiện | Vùng | Trạng thái vị trí |
| --- | --- | --- |
| Bo ESP32-S3 CAM | Lớp trước y 2,2–11,0; x 8–35; z 9,5–50,6 | **Căn đã kiểm tra**: tâm ống kính trùng tâm cửa sổ (lệch 0 mm, lệch trục 0°), nhìn ra ngoài qua cửa sổ |
| Mạch sạc TP4056 | Lớp giữa trái, z 3,55–32,65, cổng USB-C hướng xuống đáy | **Thiếu đặc điểm**: không có lỗ USB-C; miệng cổng cách đáy trong 1,55 mm tại x 12,1, y 12,9 |
| Loa (Adafruit 3923) | Lớp giữa phải, z 2,4–34,9 | Ước lượng; vỏ không có lỗ thoát âm |
| GY-521 | Lớp giữa trái trên, nằm ngang, z 35,1–51,1 | Ước lượng; trục cảm biến xoay 90° so với trục thiết bị |
| Công tắc trượt | Lớp giữa sát thành phải, z 40–48,6, cần gạt hướng +X, trượt theo Z | **Thiếu đặc điểm**: không có rãnh; mặt cần gạt cách thành trong 0,25 mm. Rãnh cần có: x = 41, y 12,4–13,8, z 41,8–46,8 |
| Pin (định dạng 103450, giả định) | Lớp sau y 18,3–28,3, z 4,4–54,4 | Ước lượng; lùi tối đa theo góc bo R6 |
| Mạch boost | Nằm phẳng trong vòm nắp, z 54,6–59 | Ước lượng; lớp giữa không đủ chỗ cho bo 36 mm |
| MAX98357A (Adafruit 3006) | Nằm phẳng trên mạch boost, z 59,2–61,77 | Ước lượng; trần vòm ở z 63 |

Lớp giữa (y 11,2–18,2) chỉ có được khi module WROOM-1 nằm cùng mặt với camera. Đây là giả định về bo, chưa xác minh.

### 8.3 Kiểm tra tự động (`validate.ts`, có test)

| Kiểm tra | Kết quả trạng thái lắp |
| --- | --- |
| Điểm của linh kiện cứng nằm trong thành vỏ hoặc ra ngoài vỏ | 0 / 12.274 điểm (mọi đỉnh, cộng điểm rải mỗi 1,5 mm trên cạnh khối hộp) |
| Va chạm giữa linh kiện (hộp bao từng mesh con) | 0 cặp; tách rời hoàn toàn: 0 cặp |
| Camera | lệch tâm 0 mm, lệch trục 0°, tia từ ống kính lọt qua cửa sổ |
| USB-C, công tắc | tia từ miệng cổng và cần gạt **chạm thành** (không có lỗ) |
| Kiểm tra âm | đẩy công tắc 1,5 mm vào thành và đẩy loa 1 mm sang mạch sạc đều bị phát hiện |

Phép thử điểm-trong-khối dùng tia song song X với đếm chẵn lẻ trên mesh STL kín, có lưới YZ 1 mm; mất khoảng 70 ms trong Node.
Va chạm dùng hộp bao của từng mesh con nên có thể bỏ sót va chạm giữa hai mặt cong không song song trục; với khối hộp xoay bội số 90° thì chính xác.

### 8.4 Kiểm tra bằng mắt

Ảnh Chromium (`frontend/test-results/screens/` từ `e2e/hardware.spec.ts`): trạng thái đóng từ chéo trước, trước, sau, trái, phải, trên, dưới;
mặt cắt nửa trước và nửa phải; xuyên vỏ từ trên và dưới; tách rời. Đã xem lại cả bộ ảnh dựng bằng GPU thật (ANGLE D3D11, RTX 2060).

Chromium headless mặc định kết xuất bằng phần mềm (SwiftShader) và vẽ thêm vài đường mảnh khi mặt phẳng bên trong nằm song song hướng nhìn
(thấy ở hướng phải). Cùng cảnh trên GPU thật không có các đường này, nên đây là lỗi của bộ kết xuất phần mềm, không phải hình học xuyên vỏ.

### 8.5 Điều chưa chắc chắn về cơ khí

- Không có lỗ USB-C và rãnh công tắc trong STL: hai vị trí này là đề xuất, chưa có trong vỏ.
- Pin thật chưa biết. Pin tham chiếu 2000 mAh 37 × 60 × 7,5 mm không vừa (có test). Định dạng 103450 được chọn để bố trí vừa, dung lượng chưa xác minh.
- Kích thước bo ESP32-S3 CAM, vị trí camera trên bo và việc module cùng mặt với camera là ước lượng; nếu module ở mặt sau, lớp giữa không còn chỗ cho loa.
- Không có chi tiết giữ linh kiện; dây giữa các mô-đun chưa được mô phỏng (chỉ có dây pin tới đầu nối JST).
- Loa không có đường thoát âm; tản nhiệt của mạch sạc và boost chưa được xét.

## 9. Cảnh cuộn mở nắp và tách linh kiện (đợt 4)

Trang thử nội bộ: `/hardware-story` (chưa gắn vào landing; thêm `<HardwareScrollStory />` vào vị trí mong muốn khi được duyệt).
Cảnh dùng đúng cụm lắp ráp của §8 (hai STL vỏ, mười vật thể) trong một cảnh Three.js duy nhất; không có ảnh hay video tĩnh.

### 9.1 Kiến trúc

| Phần | Vị trí | Vai trò |
| --- | --- | --- |
| Toạ độ nhà và trạm | `src/lib/hardware3d/assemblyConfig.ts` | Nguồn duy nhất của vị trí lắp (home) và vị trí tách (station). Hoạt ảnh không bao giờ ghi vào đây |
| Cấu hình hoạt ảnh | `animationConfig.ts` | 5 giai đoạn, cửa sổ chuyển động từng linh kiện, 8 nhịp giới thiệu (tiêu đề, mô tả, trạng thái xác minh), khoá camera |
| Dòng thời gian | `timeline.ts` | Hàm thuần theo tiến trình p ∈ [0, 1]: vị trí từng linh kiện, nắp, camera, độ mờ nhãn. p = 0 trả đúng vị trí nhà từng bit; p = 1 trả đúng trạm |
| Kiểm tra | `animationValidation.ts` | Lấy mẫu theo thời gian, đo xuyên vỏ, va chạm nắp, va chạm linh kiện cứng và mềm |
| Điều khiển | `scrollStory.ts` | Làm mượt tiến trình (hằng số thời gian 0,11 s chế độ đủ, 0,07 s chế độ nhẹ), vòng vẽ tự dừng khi hội tụ, tạm dừng khi ngoài màn hình |
| Giao diện | `src/features/hardware/HardwareScrollStory.tsx` | Vùng cao `svh` cùng khung `position: sticky`; tiến trình tính từ vị trí cuộn thật; nhãn HTML đặt theo toạ độ chiếu của linh kiện |

Quyết định chính: **không dùng GSAP/ScrollTrigger**. Tiến trình lấy trực tiếp từ vị trí cuộn của trình duyệt qua `position: sticky`, nên không cần
pin-spacer chèn DOM (xung đột với React) và không thêm phụ thuộc hay giấy phép. Xem A16 trong `DECISIONS.md`.

### 9.2 Trình tự

1. **Lắp ráp** (p 0 – 0,08): góc ba phần tư, hai đèn chính và đèn viền, vỏ đóng.
2. **Mở nắp** (p 0,08 – 0,2): nắp nhấc thẳng lên theo trục Z của vỏ, camera nâng lên nhìn vào khoang.
3. **Tách rời** (p 0,2 – 0,58): mỗi linh kiện đi theo đường home → nhấc thẳng lên khỏi khoang → ngang → trạm. Bo camera ra phía cửa sổ camera (−Y), mạch sạc ra phía cổng USB-C (−X), công tắc ra theo trục rãnh (−X), loa sang +X, pin ra +Y.
4. **Khám phá** (p 0,615 + 0,048 × i, 8 nhịp): camera dừng ở từng linh kiện, một nhãn mỗi lúc, nhãn chỉ hiện khi linh kiện đã tới trạm; hộp viền teal quanh linh kiện đang nói.
5. **Lắp lại** (p → 1): cùng đường đi theo chiều ngược; p = 0 khôi phục đúng vị trí nhà.

### 9.3 Số liệu kiểm tra (đã chạy)

| Phép đo | Kết quả |
| --- | --- |
| Điểm của linh kiện cứng xuyên thành vỏ trên toàn bộ dòng thời gian (bước p 0,0005, bước đường 0,5 mm) | 0 |
| Va chạm nắp với linh kiện hoặc vỏ khi nắp nhấc | 0 |
| Va chạm giữa linh kiện cứng, giữa linh kiện cứng và mềm (dây, đầu nối) | 0 và 0 |
| Bước dịch chuyển lớn nhất giữa hai mẫu liên tiếp | 0,85 mm mỗi 0,0005 p (không có bước nhảy) |
| Hai nghìn lần gọi `evaluate` với p ngẫu nhiên rồi về 0 | đúng vị trí nhà |
| Kiểm tra âm (đẩy linh kiện vào thành, đổi lối đi cho nắp) | đều bị phát hiện |

Test: `npx vitest run src/lib/hardware3d` → 3 file, 44 test đạt (trong đó `timeline.test.ts` 19 test). `npm test` toàn bộ: 150 đạt, 1 lỗi có sẵn (xem 9.5).

### 9.4 Kiểm tra trình duyệt (Playwright, Chromium)

`e2e/hardware-story.spec.ts`: 15 test, đạt cả 15. `e2e/hardware.spec.ts`: 3 test đạt. Toàn bộ `npm run test:e2e`: 34 đạt, 3 bỏ qua, 2 lỗi có sẵn (9.5).

| Tình huống | Cách kiểm tra |
| --- | --- |
| Cuộn chậm | Bánh xe thật, từng 140 px: đủ 5 giai đoạn đúng thứ tự, tiến trình không lùi, không lỗi console |
| Cuộn nhanh | Nhiều cú giật liên tiếp tới đầu, cuối rồi dừng giữa chừng: hội tụ đúng điểm; về 0 = đúng vị trí nhà |
| Cuộn ngược | Lắp lại từng bước, nhãn hiện ở cả hai chiều |
| Lặp lại | 6 vòng đóng–mở: mỗi vòng về đúng trạng thái, vòng vẽ dừng khi đứng yên (0 khung hình khi trang đứng yên) |
| Đổi kích thước | 1024×768, 800×1000, 390×844, 1440×900 khi đang ở một nhịp: canvas khớp khung, bố cục đổi rộng/hẹp, nhãn nằm trong màn hình, không tràn ngang, vẫn có hình, không cảnh báo "Too many active WebGL contexts" |
| Tải lại ở vị trí cuộn | p ≈ 0, 0,3, 0,65, 1: khung đầu đúng ngay, không chạy lại hoạt ảnh từ đầu |
| Không chặn cuộn trang | Canvas `pointer-events: none`, `touch-action: pan-y`; bánh xe qua canvas vẫn cuộn; phím End, Home hoạt động |
| Điện thoại | 390×844, cảm ứng thật (CDP `Input.dispatchTouchEvent`): chế độ nhẹ, vuốt qua canvas vẫn cuộn trang và điều khiển hoạt ảnh; nhãn dán đáy |
| Giảm chuyển động | Chỉ 3 ảnh tĩnh (p 0, 0,2, 0,58), không nội suy, danh sách linh kiện hiện đầy đủ thay cho nhãn trôi nổi |

Ảnh duyệt: `frontend/test-results/story-review/` (đóng, nhấc nắp, mở, đang tách, đã tách, tổng quan, 8 nhịp, ba trạng thái giảm chuyển động, bốn kích thước, điện thoại). Các khung chính đã được xem trên GPU thật (ANGLE D3D11, RTX 2060); ảnh điện thoại, giảm chuyển động và đổi kích thước xem từ lần chạy SwiftShader.

Lỗi tìm thấy và đã sửa khi kiểm tra:

- `isWebGLAvailable()` tạo một context WebGL mới ở mỗi lần gọi, mà `useSyncExternalStore` gọi nó ở mỗi lần dựng lại giao diện; sau khoảng 16 lần trình duyệt huỷ context cũ nhất (chính là canvas đang xem) và khung hình trống vĩnh viễn. Nay chỉ thăm dò một lần và nhả context thăm dò; test đổi kích thước kiểm tra không còn cảnh báo (6/6 lần chạy song song đạt sau khi sửa, trước đó lỗi ngắt quãng).
- Tải lại trang không khôi phục vị trí cuộn vì trang dựng muộn (route tải lười, tài liệu còn ngắn). `useScrollMemory` ghi `scrollY` vào `history.state` (không dùng web storage) và đặt lại trước khi cảnh đọc tiến trình.

### 9.5 Hạn chế và lỗi có sẵn

- Chỉ chạy Chromium (SwiftShader mặc định cộng kiểm tra bằng mắt trên GPU thật). **Chưa** chạy Safari, Firefox, thiết bị di động thật hay đo hiệu năng trên máy yếu; chế độ nhẹ (DPR tối đa 1,5, không hộp viền) dựa trên kích thước màn hình và số nhân/bộ nhớ báo bởi trình duyệt.
- Với WebGL chạy bằng phần mềm, phím bấm ngay lúc vòng vẽ còn đang hội tụ bị Chromium bỏ qua; test chờ vòng vẽ dừng trước khi bấm End. Trên GPU thật phím hoạt động ngay sau khi cuộn (đã thử). Chưa điều tra sâu nguyên nhân phía Chromium.
- Chuyển động chỉ chứng minh không xuyên vỏ trong mô hình hiện tại. Mọi kích thước linh kiện ngoài STL vẫn là ước lượng (xem 8.5); không được hiểu là đã xác minh lắp vừa.
- Hai lỗ trên vỏ (USB-C, công tắc) vẫn không có trong STL; hoạt ảnh đưa mạch sạc và công tắc ra đúng trục dự kiến của hai lỗ đó, đánh dấu `feature-missing`.
- Lỗi có sẵn, không do công việc này (đã xác nhận bằng cách gỡ route và dựng lại): `landing.test.tsx` "mất kết nối CareLens…" (unit); `flows.spec.ts` "AC11: thu hồi quyền…" và "hết phiên đưa về đăng nhập…" (e2e).
- Kích thước: chunk chính 728,24 kB (209,16 kB gzip); chunk 3D tách riêng 698,88 kB (180,86 kB gzip); trang cảnh cuộn 11,37 kB. Cảnh chỉ tải khi vào `/hardware-story`.

## 10. Landing CareLens AI (đợt 5)

Landing `/` nay mở bằng cảnh 3D (xem A19, A20): hero chữ nằm trên khung 3D cố định, cuộn để mở nắp và tách linh kiện (tám nhịp giới thiệu từng linh kiện nằm trong chính cảnh), sau đó là các phần
tình huống ngã (khái niệm), hỗ trợ dùng thuốc (khái niệm, một ngày mô phỏng), quy trình cảm biến → người chăm sóc, riêng tư và phẩm giá, CTA thử nghiệm.

- Đợt 7 (A22): bỏ phần `#linh-kien` (`ComponentsSection`) liệt kê lại chín linh kiện ngay sau cảnh 3D, vì trùng với các nhịp giới thiệu trong cảnh. Cảnh 3D, tài sản và hoạt ảnh không đổi. Danh sách linh kiện chỉ còn là phương án thay thế do cảnh cung cấp (`staticList`): hiện khi giảm chuyển động hoặc không có WebGL, chỉ dành cho trình đọc màn hình ở chế độ cuộn. Copy các phần còn lại được rút gọn, bỏ ghi chú kỹ thuật (STL, ESP32-S3, YOLOv10, PRD nháp) khỏi trang công khai.
- Mã: `frontend/src/features/landing/` (mỗi phần một file), cảnh dùng chung `features/common/HardwareScrollStory.tsx`, primitive `design-system/landing.tsx`, token màu trong `tokens.css`.
- Camera hero: `HERO_FRAME` và `setHeroInset` (đo vùng chữ, đặt thiết bị vào vùng trống). `?debug=1` vẫn mở API kiểm thử.
- Kiểm tra đã chạy: `tsc` sạch, `eslint` sạch, `npm test` 177/177 (gồm 31 test landing và tương phản bảng màu), `npx vitest run src/lib/hardware3d` 44/44,
  `npm run test:e2e` 44 đạt, 3 bỏ qua, 2 lỗi có sẵn ở `flows.spec.ts` (AC11, hết phiên). `e2e/landing.spec.ts` 15 test: hero, cuộn khỏi hero, cuộn liền mạch xuống cuối và ngược lên,
  điều hướng, bàn phím, hai bản minh hoạ, chunk 3D tải chậm, không có WebGL, 360–1440 px, điện thoại cảm ứng, touch target 44 px, giảm chuyển động.
- Đã xem bằng mắt (GPU thật) ở 1440×900, 1280×600, 1024×768, 768×1024, 390×844, 360×640.
- Kích thước: chunk chính 752,35 kB (217,61 kB gzip), chunk 3D 699,82 kB (181,20 kB gzip), chunk cảnh 12,64 kB.
- Chưa làm: địa chỉ liên hệ thử nghiệm (nút đang tắt kèm lý do cho tới khi đặt `VITE_PILOT_CONTACT_EMAIL`); chưa thử Safari, Firefox, thiết bị thật; chưa đo Lighthouse.
- Hạn chế nội dung: không có số liệu, lời chứng thực, tuyên bố lâm sàng; phát hiện ngã và hỗ trợ dùng thuốc chỉ là khái niệm.

## 11. Chất lượng hình ảnh 3D (đợt 6)

Mục tiêu: từ "trình xem CAD thô" sang hình ảnh sản phẩm có chủ đích. Hình học vỏ STL không đổi (SHA-256 của hai file gốc giữ nguyên);
mọi linh kiện giữ nguyên hộp bao lắp ráp (test `assembly.test.ts` so khớp ≤ 0,01 mm).

### 11.1 Lỗi hình ảnh đã sửa

| Lỗi trước | Sửa | File |
| --- | --- | --- |
| Vỏ phẳng, sáng đều, không vệt sáng trên góc bo | Polymer màu gốm #D0D0C8 (MeshPhysicalMaterial, nhám 0,48, lớp phủ 0,32/0,42); môi trường phản chiếu là phòng chụp sản phẩm tự dựng (softbox lớn, tấm phụ, hai dải đèn dọc) thay cho RoomEnvironment | `materials.ts`, `studioEnvironment.ts`, `viewer.ts` |
| Khoang trong sáng như mặt ngoài | Che sáng khoang (AO xấp xỉ) ghi vào màu đỉnh theo pháp tuyến hướng vào trục vỏ và độ sâu; hình học, pháp tuyến không đổi | `assets.ts` (`bakeCavityOcclusion`) |
| Vật thể lơ lửng, không bóng | Bóng tiếp xúc mềm trên sàn vô hình (độ sâu nhìn từ sàn lên, 256 px, nhoè hai lượt; 128 px ở chế độ nhẹ) cùng vầng sáng sàn rất nhẹ; chỉ vẽ lại khi vật thể dịch chuyển | `contactShadow.ts`, `viewer.ts`, `scrollStory.ts` |
| Đèn viền teal tô màu mép vỏ; ACES làm màu ngả xám | Ánh sáng ba điểm trung tính (key ấm rộng, fill dịu, rim trung tính) cộng rim teal 0,22; tone mapping Neutral | `viewer.ts` |
| PCB là tấm phẳng, cạnh giống mặt | Mặt phủ hàn hơi bóng, bốn cạnh lộ lõi FR4 | `procedural.ts` (`board`) |
| IC là khối đen, linh kiện dán là khối trắng | Chân gull-wing hoặc pad QFN mạ thiếc, dấu chân 1; tụ gốm có hai đầu thiếc; điện trở thân đen; nét in lụa khung linh kiện (không chữ); vòng pad xuyên lỗ; ăng-ten PCB dạng uốn khúc; pad bán lỗ dọc module; cần khoá FPC; diode có vạch cực âm | `procedural.ts` |
| Vật liệu GLB Adafruit là màu phẳng đồng nhất (bo khuếch đại màu ô liu) | Gán lại theo tên mesh: bo → phủ hàn đen, chân QFN → thiếc, thân IC → epoxy, 0805 → gốm; loa: khung đen, màng trắng ngà mờ, dây đỏ/đen. Màu bo đen là giả định hiển thị | `assembly.ts` (`remapCadMaterials`) |
| Kim loại (vỏ USB-C, nắp chắn RF) gần như đen | Tường phòng chụp sáng hơn, `envMapIntensity` riêng cho kim loại | `materials.ts`, `studioEnvironment.ts` |
| Nhãn pin tối như màn hình | Nhãn trống xám xanh mờ (không in dung lượng hay mã) | `materials.ts` |
| Khung dây BoxHelper kiểu CAD quanh linh kiện đang giới thiệu | Các vật thể khác lùi dần về tông nền (#1B2C37) theo độ hiện của nhãn; mỗi vật thể có bản sao vật liệu riêng | `assembly.ts` (`setFocus`), `scrollStory.ts` |
| Tổng quan tách rời: cột dọc chật, pin bị bo che, công tắc lạc xa, sản phẩm chiếm khoảng 35 % chiều cao | Bố trí trạm mới (11.2), góc tổng quan cố định chéo trước-trái, khung chặt hơn | `assemblyConfig.ts`, `animationConfig.ts` |

### 11.2 Bố trí tách rời mới

Một cột giữa đi thẳng lên (thân → pin → nắp), các linh kiện ra theo hướng chức năng ở hai bên:

| Linh kiện | Trạm (khung CAD, mm) | Quan hệ với vị trí lắp |
| --- | --- | --- |
| Nắp | (21,5; 16; 130) | Thẳng lên trục Z |
| Pin | (21,5; 23; 83) | Rút thẳng lên khỏi khoang, cùng x, y |
| Bo camera | (21,5; −40; 30,05) | Trên trục quang, phía trước cửa sổ |
| Mạch sạc TP4056 | (−47; 13,5; 14,7) | Trên trục cổng USB-C đề xuất, sang trái |
| Công tắc trượt | (−24; 13,1; 48,4) | Trên trục rãnh đề xuất, sát thành trái |
| Loa | (80; 14,55; 33,65) | Sang phải, cùng độ cao |
| MAX98357A | (−17; 15,525; 86) | Nửa trái vòm nắp → trái |
| GY-521 | (60; 16; 99) | Nửa phải vòm nắp → phải |
| Mạch boost | (64; 17; 82) | Sang phải dưới GY-521, chừa cột giữa cho pin |

Góc máy: hero chéo trước-phải (34°), vòng chậm sang chéo trước-trái (−28°) trong lúc tách; các nhịp giới thiệu trong khoảng −64° → −10°.
Kiểm tra `validateTimeline` trên STL thật (bước p 0,0005): 0 xuyên thân, 0 chạm nắp, 0 va chạm giữa linh kiện cứng hoặc mềm,
bước lớn nhất < 1 mm. Đây chỉ là kiểm tra trong mô hình; vị trí bên trong vẫn là ước lượng, chưa xác minh cơ khí.

### 11.3 Hiệu năng (đo thật)

| Môi trường | Khung chính | Khung có vẽ lại bóng sàn | Ghi chú |
| --- | --- | --- | --- |
| GPU thật (ANGLE D3D11, RTX 2060), 1440 × 900 | 0,34–0,44 ms | 0,7–1,3 ms | 139 lần gọi vẽ, 61 k tam giác; giữ 60 fps khi cuộn |
| SwiftShader (headless, phần mềm), 1440 × 900 | khoảng 150 ms/khung | | Khoảng 117 ms nếu bỏ bóng sàn và lớp phủ vỏ |

Bóng sàn chỉ vẽ lại khi vật thể dịch chuyển (đoạn mở nắp và tách); ở các nhịp khám phá chỉ camera di chuyển nên không tốn lượt bóng.
Hàm đo `bench()` chỉ có khi mở trang với `?debug=1`. Chunk 3D: 713,13 kB (185,32 kB gzip), tăng khoảng 13 kB; chunk chính không đổi.
Test cuộn chậm chạy bằng SwiftShader mất khoảng 84 s (trước khoảng 55 s) nên được đặt thời hạn riêng 180 s, có ghi lý do.

### 11.4 Còn hạn chế

- Không có SSAO hay bóng đổ thời gian thực giữa các linh kiện; che sáng khoang là xấp xỉ theo hình học, không tính từ tia.
- Chi tiết chân IC, linh kiện dán, nét in lụa là kiểu đóng gói tiêu chuẩn, không phải bố trí bo thật. Màu phủ hàn (xanh, đen) là giả định.
- Chỉ kiểm tra bằng mắt trên Chromium (GPU thật và SwiftShader). Chưa thử Safari, Firefox, điện thoại thật.

## 12. Tình huống 01: cảnh ngã chạy theo cuộn (đợt 8, A23)

Mã: `frontend/src/lib/careScene/` (`figure.ts` hình người và khớp, `fallTimeline.ts` dòng thời gian, `fallScene.ts` cảnh và vòng vẽ, `steps.ts` ba bước, không phụ thuộc three.js), giao diện `features/landing/FallSection.tsx`.

| Hạng mục | Cách làm |
| --- | --- |
| Hình người | Dựng bằng code: chi lathe thuôn có đầu tròn, thân dẹt, áo len dài, tóc bạc, không mặt. Không tải mô hình ngoài, không có giấy phép bên thứ ba |
| Thiết bị | Hai STL vỏ của dự án, tỉ lệ thật 43 × 32 × 65 mm, vật liệu polymer gốm dùng chung, kẹp giữa ngực |
| Chuyển động | 25 kênh góc khớp, 7 khoá tư thế (đứng, hụt bước, gối khuỵu, quỳ, đổ nghiêng, nằm), nội suy Hermite đơn điệu (không vượt khoá). Gốc luôn đặt sao cho điểm thấp nhất của cơ thể ở y = 0 |
| Camera | 9 khoá: toàn cảnh, theo người xuống sàn, cận thiết bị lúc ghi nhận, lùi ra chừa chỗ cho thông báo. Khung hẹp lùi xa hơn; người luôn đặt giữa phần khung không bị bảng bước hoặc thẻ thông báo che |
| Ánh sáng | Đèn spot ấm có bóng mềm tạo quầng sáng làm tiêu điểm, viền lạnh phía sau, viền teal rất nhẹ, phản chiếu phòng chụp dùng chung, sương mù theo khoảng lùi camera |
| Hiệu năng | Vẽ theo yêu cầu, dừng khi đứng yên, tạm dừng khi ra khỏi màn hình; bóng chỉ vẽ lại khi tư thế đổi. Chunk cảnh 18,46 kB |

Kiểm tra: `src/lib/careScene/fallTimeline.test.ts` (chạm sàn ở mọi p, không nhảy giữa hai bước cuộn 0,001, cùng p cho cùng khung sau khi quét tới-lùi, camera không xuống sàn hay chui vào người, thứ tự bước), `e2e/scenario.spec.ts` (cuộn tới-lùi bằng bánh xe rồi so khung hình, bố cục 1440 px và 390 px, giảm chuyển động).
Hạn chế: hình người là mannequin cách điệu, không có biến dạng da hay va chạm giữa các chi (tư thế được chỉnh bằng mắt); chưa thử Safari, Firefox, điện thoại thật.

## 13. Tình huống 02: quan sát hoạt động và gói dữ liệu (đợt 9, A24)

Mã: `frontend/src/lib/careScene/` (`hand.ts` bàn tay có ngón, `figure.ts` hình người và khớp, `props.ts` ly nước, hộp thuốc, quầy, hub và khay, `dataPacket.ts` gói dữ liệu,
`medicationTimeline.ts` dòng thời gian và động học ngược, `medicationScene.ts` cảnh, `scrollScene.ts` nền chung, `deviceModel.ts` vỏ thiết bị từ hai STL), giao diện `features/landing/MedicationSection.tsx`.

| Giai đoạn (p) | Điều thấy | Cách làm |
| --- | --- | --- |
| 1 · Một hành động (0 – 0,34) | Người đứng ở quầy, tay phải với tới ly, nắm và nâng lên ngang ngực | Tay phải giải động học ngược tới điểm nắm của ly; 3 khớp, cổ tay giữ ngón cái hướng lên nên ly thẳng đứng |
| 2 · Camera quan sát (0,34 – 0,55) | Bốn góc khung ngắm và bốn cạnh mảnh từ ống kính tới khung, đèn báo ống kính sáng; nhãn "Camera đeo ngực" | Không quét, không nhấp nháy: chỉ hiện dần |
| 3 · Thành gói dữ liệu (0,55 – 0,73) | Khung đóng băng thành ảnh (chụp từ chính ống kính), thu nhỏ thành thẻ dữ liệu dạng ô vuông có viền teal kín | Ảnh dựng một lần lúc tải (cảnh tổng hợp, 192 × 144) và thu nhỏ còn lưới 32 × 24 |
| 4 · Gửi tới hub (0,73 – 1) | Thẻ nhấc lên, bay theo một cung qua mặt quầy, hạ êm xuống khay nhận; đèn hub và viền khay sáng khi tới; nhãn "Hub trong nhà (khái niệm)" | Đường Bézier bậc ba, ease ở hai đầu, ba vệt mờ phía sau cho thấy hướng bay |

**Gói dữ liệu (đối tượng bền vững).** Một `DataPacket` duy nhất, dựng một lần: khung ngắm, ảnh chụp, thẻ, viền và vệt bay là các lớp của cùng một nhóm; chỉ độ hiện và độ lớn đổi. `samplePacket(plan, p)` là hàm thuần (tư thế, độ lớn, các lớp hiện, pha, vận tốc).

**Giao diện bàn giao cho phần sau** (`PacketHandoff`, lấy bằng `MedicationScene.getPacketHandoff()`):

| Trường | Ý nghĩa |
| --- | --- |
| `phase`, `arrived`, `progress` | Pha hiện tại (`hidden`, `framing`, `captured`, `condensing`, `transit`, `arrived`), đã tới khay chưa, p của cảnh chủ |
| `current`, `final` | Tư thế (vị trí m, quaternion [x, y, z, w], độ lớn) đang vẽ và tư thế cuối, hệ toạ độ cảnh quan sát (gốc ở chân người, +Y lên, +Z hướng về người xem). Cuối: nằm phẳng trên khay, mặt ngửa lên |
| `finalScreen` | Vị trí cuối trên khung hình (0–1, gốc trên-trái của khung cố định) để phần sau đặt gói đúng điểm ảnh khi chuyển cảnh |
| `spec`, `snapshot`, `mosaic` | Kích thước, màu, ảnh chụp và ảnh thu nhỏ: đủ để dựng `new DataPacket(snapshot, spec)` giống hệt |
| `sample(p)` | Hàm thuần của cảnh gốc để phát lại hoặc nối đoạn bay |
| `object` | Đối tượng sống, chỉ hợp lệ khi cảnh gốc còn tồn tại |

Chương bảo vệ (§14) chạy trong cùng cảnh và dùng lại chính `object`, nên không cần dựng lại. Nếu sau này một khung vẽ khác cần nối tiếp, nó dựng lại gói ở `finalScreen` bằng `spec` và `snapshot`.

**Trung thực.** Không có mô hình hay thiết bị nào được kiểm chứng nhận ra thuốc, việc uống thuốc hay hành động nào khác; ảnh trong gói là cảnh tổng hợp dựng bằng code; hub là hình minh hoạ. Bước cuối của trang ghi "Chưa có mô hình nào được kiểm chứng để nhận ra việc uống thuốc".

Kiểm tra: `src/lib/careScene/medicationTimeline.test.ts` (sai số động học ngược dưới 1 mm, ly đổi chủ không nhảy, tay và camera không nhảy giữa hai bước cuộn 0,001, thứ tự pha, tư thế cuối đúng khay, gói liên tục, tất định sau khi quét tới-lùi, không xuyên quầy hay hub), `e2e/medication-scene.spec.ts` (cuộn chậm tới và ngược về đúng khung đầu, cuộn nhanh và nhảy cóc ra cùng một khung, giao diện bàn giao, bố cục 1440 px và 390 px, chọn bước, giảm chuyển động).
Hạn chế: bàn tay không có biến dạng da hay va chạm giữa ngón và ly (các góc nắm chỉnh bằng mắt); người là mannequin cách điệu; chưa thử Safari, Firefox, điện thoại thật; ảnh trong gói là cảnh tổng hợp.

## 14. Chương bảo vệ dữ liệu nối tiếp (đợt 10, A25)

Mã: `frontend/src/lib/careScene/securityTimeline.ts` (dòng thời gian, camera, khiên, không khí), `hexLattice.ts` (lưới lục giác, đường hội tụ, dấu vân minh hoạ), `shield.ts` (tấm khiên dựng bằng code), `storySteps.ts` (hai chương trên một vùng cuộn), lớp bảo vệ trong `dataPacket.ts` (`applySecure`), ghép trong `medicationScene.ts`.

| Bước (p của chương) | Điều thấy | Cách làm |
| --- | --- | --- |
| 5 · Vào vùng bảo vệ (0,04 – 0,44) | Gói nhấc thẳng khỏi khay, dựng đứng, bay lên tấm khiên phía trên hub và đi vào lòng khiên; căn phòng chìm dần vào nền; nhãn "Vùng xử lý trong nhà (minh hoạ)" | Một đường Bézier từ tư thế cuối của chương trước; khiên hiện và nâng nhẹ lên chỗ, không xoay; sương mù khép lại (gói và khiên không chịu sương mù) |
| 6 · Tách khỏi ảnh gốc (0,44 – 0,66) | Mặt ảnh thu nhỏ lát thành 60 ô lục giác cùng màu ảnh, lưới tản rộng nhẹ và lệch sâu | Ô lớn dần từ tâm ra ngoài trong khi thẻ mờ đi; lệch sâu theo góc vàng (cố định theo chỉ số, không ngẫu nhiên) |
| 7 · Chỉ còn bản rút gọn (0,66 – 1) | Các ô hội tụ thành dải tám ô, màu chuyển sang ô sẫm; chuỗi 16 ký tự hex hiện trên dải, gạch chân teal; nhãn "Bản rút gọn (minh hoạ)" | Mỗi ô đích giữ một ô đại diện, các ô khác thu nhỏ và tan vào nó khi tới; camera tiến lại gần rồi lùi nhẹ cho khung kết |

**Tính liền mạch của vật thể.** Chỉ có một `DataPacket` trong cảnh suốt hai chương (kiểm bằng đếm đối tượng tên `data-packet` và định danh `uuid`). Chương bảo vệ bắt đầu đúng `finalPacketPose(plan)` và đúng camera cuối của chương quan sát; các lớp thẻ (ảnh thu nhỏ, thân, viền) giữ đúng giá trị cuối rồi mới mờ đi khi lớp lục giác hiện. Cuộn ngược về trước ranh giới thì lớp lục giác và khiên ẩn hoàn toàn và gói trở lại đúng thẻ trên khay. `MedicationScene.artifactState()` đọc thẳng tư thế, định danh, số ô đang hiện và chuỗi từ đối tượng.

**Trung thực.** Khiên và chuỗi dạng mã băm là minh hoạ; không có bước băm, mã hoá hay ẩn danh hoá nào trong repo. Chuỗi là FNV-1a hai làn trên điểm ảnh của ảnh minh hoạ (không phải hàm băm mật mã), có thể khác giữa các máy và giữa chất lượng đầy đủ và nhẹ (màn hẹp) vì ảnh minh hoạ được vẽ lại trên chính máy đó; trong một lần xem, chuỗi cố định. Trang ghi lưu ý này ở chân khung trong suốt chương bảo vệ.

Kiểm tra: `src/lib/careScene/securityTimeline.test.ts` (bàn giao tư thế, lớp và camera ở cả hai bố cục, không nhảy qua điểm nối, thứ tự pha, liên tục theo p, tất định, không xuyên hub, khung cuối chỉ còn tám ô, cuộn ngược ẩn lớp bảo vệ, lưới và dấu vân), `e2e/medication-scene.spec.ts` (cuộn chậm qua ranh giới rồi ngược về đúng khung cũ, nhảy cóc và lướt nhanh, cùng `uuid` và đúng một gói ở mọi khung, bàn giao tại ranh giới, bố cục 1440 px và 390 px, chọn bước cả hai chương, giảm chuyển động bảy ảnh tĩnh, phần ngay sau là Riêng tư).
Hạn chế: chỉ thử Chromium (GPU thật và SwiftShader); khiên là hình học đơn giản; chuỗi nhỏ trên màn hẹp.

## 15. Chương "Tổng quan hôm nay" nối tiếp cảnh bảo vệ (đợt 11, A26)

Mã: `frontend/src/lib/careScene/reportTimeline.ts` (dòng thời gian, camera, quy khung HTML về mặt phẳng 3D), `reportSurface.ts` (bề mặt bo góc, đường viền), `storySteps.ts` (ba chương trên một vùng cuộn), ghép trong `medicationScene.ts`; giao diện `features/landing/DailyReport.tsx`, `MedicationSection.tsx`, nội dung `content.ts` (`DAILY_REPORT`).

| Đoạn (p của chương) | Điều thấy | Cách làm |
| --- | --- | --- |
| Đứng yên (0 – 0,08) | Dải rút gọn y như cuối chương bảo vệ | Khung ở p = 0 trùng khung cuối của chương trước ở gói, ô lục giác, khiên, ánh sáng và camera (có kiểm thử cả hai bố cục) |
| Mở ra (0,08 – 0,5) | Bề mặt bo góc mọc ra từ chính dải; khiên mờ, bảng bước mờ, căn phòng chìm hẳn; camera tiến tới nhìn thẳng vào bề mặt; các ô tan vào bề mặt | Hình chữ nhật nội suy từ khung quanh dải tới khung báo cáo; camera cuối vuông góc với mặt phẳng bề mặt, nên khung HTML và khung 3D chỉ là một phép tỉ lệ; bề mặt không kiểm tra độ sâu (luôn phủ lên căn phòng), các lớp của gói vẽ sau |
| Hiện nội dung (0,54 – 0,8) | Nền HTML thế chỗ bề mặt (cùng màu), rồi tiêu đề, dòng thời gian, tóm tắt hiện lần lượt | Một biến CSS `--r` do cảnh đặt theo tiến trình; mỗi khối hiện chậm hơn khối trước một nhịp, cuộn ngược thì ẩn lại đúng như cũ |
| Đứng yên (0,8 – 1) | Báo cáo ổn định; nếu khung thấp hơn nội dung, phần thân cuộn lên trong khung (tiêu đề không đi) | `--shift` = phần nội dung thừa × mức cuộn; bằng 0 khi vừa khung |

**Tính liền mạch.** Vẫn một `DataPacket` (kiểm bằng đếm đối tượng và `uuid` ở mọi khung); chương này chỉ đổi lớp hiển thị của nó (các ô tan đi). `artifactState()` đọc thẳng từ đối tượng. `reportSurfaceScreen()` chiếu bề mặt 3D về px để kiểm thử so với khung HTML.

**Nội dung và trung thực.** Báo cáo là dữ liệu mẫu cố định có nhãn "Dữ liệu mô phỏng" (nhỏ, cạnh tiêu đề), có nguồn và thời điểm cập nhật; mô tả ghi là của AI, chưa được con người xác nhận. Không có số đo, phần trăm, độ chính xác hay kết luận y khoa.

Kiểm tra: `src/lib/careScene/reportTimeline.test.ts` (bàn giao từ chương bảo vệ, pha, liên tục, đơn điệu, tất định, camera, phép quy khung HTML về 3D bằng camera thật), `src/features/landing/DailyReport.test.tsx` (nội dung, thứ tự thời gian, không số liệu hay kết luận), `e2e/medication-scene.spec.ts` (qua cả ba chương: cuộn chậm tới và ngược về đúng khung cũ, nhảy cóc, bàn giao hai ranh giới, bề mặt khớp khung HTML, báo cáo đứng yên, điện thoại 390 × 844 và 360 × 640, giảm chuyển động).
Hạn chế: chỉ thử Chromium; trên màn hình thấp nội dung báo cáo cuộn trong khung; bản nhẹ (màn hẹp) dùng cùng nhịp tỉ lệ nhưng ngắn hơn.

## 16. Nhân vật người lớn tuổi của hai cảnh tình huống (đợt 12, A28)

Mã: `frontend/src/lib/careScene/` — `figure.ts` (bộ xương, vật liệu, áo len, chân tay), `face.ts` (đầu, mắt, tai, tóc), `facePaint.ts` (lớp vẽ mặt), `textures.ts` (thớ len, vải quần, sợi tóc), `shapes.ts` (chi có nếp, thân dựng từ mặt cắt, dải nẹp). **Không có tài sản ngoài**: không tệp mô hình, không ảnh, không phông; mọi hình và hoa văn sinh bằng code lúc chạy, nên không có giấy phép bên thứ ba và không tăng dung lượng tải ngoài phần mã (gói `careScene` +22 kB, +8 kB nén).

| Phần | Cách dựng | Ghi chú |
| --- | --- | --- |
| Đầu | Lưới cầu tự dựng (128 × 92; nhẹ 96 × 72), dày hơn ở mặt trước, nắn thành hộp sọ, gò má, hàm, cằm; mũi và môi nắn vào lưới | Không có đường nối; pháp tuyến liền khắp đầu |
| Mặt | Lớp vẽ canvas 1024 px chiếu từ phía trước: hốc mắt, túi mắt, nếp mi, đuôi mắt, lông mày, môi, rãnh mũi-má, nếp trán nhạt | Không canvas (kiểm thử jsdom) thì dùng màu đỉnh tính từ cùng hàm hình khối |
| Mắt | Lòng trắng, tròng, đồng tử, mi trên hơi nặng, mi dưới | Hình cầu nhỏ, đặt trong hốc đã nắn |
| Tóc | Vỏ mỏng ôm hộp sọ, bạc ngắn; chân tóc cắt bằng bản đồ alpha 128 × 64 nên mép răng cưa mềm, không bậc thang theo lưới | `alphaTest`; không dùng trong trường hợp không có canvas |
| Áo len | Một mặt liền từ gấu tới cổ, `SkinnedMesh` bám ba xương theo độ cao; nẹp khuy, 5 khuy, cổ áo, gấu bo gân; thớ len bản đồ pháp tuyến 256 px | Cỡ mắt len đều nhờ UV theo độ cao thật |
| Tay, chân | Hồ sơ bán kính tuỳ ý (bắp tay, cẳng tay, đùi, bắp chân) có nếp ở khuỷu, háng, đầu gối, gấu quần; cổ tay bo gân, sơ mi ló ra | Cả hai cảnh dùng bàn tay có ngón |
| Giày | Da có sơn bóng nhẹ, đế riêng, lưỡi gà | Đáy giày giữ đúng độ cao điểm dò chạm sàn |

Giữ nguyên: bộ xương và 31 kênh tư thế, các điểm dò chạm sàn, điểm gắn thiết bị, bàn tay `CareHand`, mọi dòng thời gian, camera, thẻ và nhãn giao diện, cuộn.

Bộ vẽ: `scrollScene.ts` — tỉ lệ điểm ảnh ban đầu `initialPixelRatio` (đầy đủ: 1,5–2; nhẹ: tối đa 1,5), hạ dần một bậc 0,25 khi 14 khung liên tiếp chậm hơn 30 ms, không dưới tỉ lệ của màn hình. Bản đồ bóng 2048 px (nhẹ 1024) với bán kính lọc 3.

Kiểm tra: `figure.test.ts` (đủ bộ phận, chiều cao 1,55–1,75 m, chân chạm sàn, hình học hữu hạn, ngân sách tam giác, áo liền bám ba xương và gấu áo không theo cột sống khi cúi, dựng được khi không có canvas, tỉ lệ điểm ảnh), cùng các kiểm thử dòng thời gian hiện có. Kiểm bằng mắt: chụp cả hai cảnh trên GPU thật (ANGLE D3D11) ở 1440 × 900 và 390 × 844, so với ảnh chụp trước khi sửa.
Hạn chế: nhân vật là hình cách điệu, không phải ảnh hay quét người thật; mặt chỉ rõ khi cận cảnh (khung cảnh ngã đầu đứng chỉ khoảng 60 px ở 1440 × 900); chỉ thử Chromium trên GPU của máy dev.
