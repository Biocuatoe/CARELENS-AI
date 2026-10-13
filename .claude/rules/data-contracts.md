---
paths:
  - "contracts/**"
  - "integrations/**"
  - "backend/api/app/modules/ingest/**"
---

# Data contracts và integrations

Spec: `docs/IMPLEMENTATION_PLAN.md` §4.2, §7.4, §8, §14. Kiến trúc: `docs/ARCHITECTURE.md` §6.3, §8.

## Contract

- Đường dẫn: `contracts/<product>/<name>.v<major>.schema.json` (JSON Schema 2020-12). Fixture tổng hợp ở `contracts/<product>/fixtures/valid/` và `fixtures/invalid/`.
- Test trong `backend/api` bảo đảm Pydantic ingest chấp nhận mọi fixture hợp lệ và từ chối mọi fixture không hợp lệ.
- Trường bắt buộc của dữ liệu nguồn: `schema_version`, `source_record_id`, `source_mode` (`simulated | device | manual`), `product`, `device_id`, `observed_at`.
- `received_at` do backend gán, không nhận từ nguồn.
- Payload nguồn **không có** `care_recipient_id`. Backend xác định hồ sơ theo credential và DeviceAssignment.
- Thay đổi không tương thích tạo major mới, giữ bản cũ tới khi mọi adapter chuyển xong, ghi `/decision-log`.
- Mô tả schema ghi rõ "hợp đồng đề xuất của adapter, chưa xác minh với thiết bị" cho tới khi M5 có bằng chứng.

## Simulator

- CLI Python trong `integrations/<product>/`, tham số `--scenario`, `--seed`, `--api-url`. Credential đọc từ biến môi trường.
- Tất định theo seed. Retry dùng lại đúng `source_record_id`.
- Gửi qua API ingest bằng credential thiết bị như nguồn thật. Không ghi thẳng DB.
- Luôn đặt `source_mode = "simulated"`.
- Kịch bản theo plan §14: bình thường, thiếu dữ liệu, kết nối kém, mất kết nối, event trùng, gói đến muộn, cảnh báo chưa nhận, báo động sai, phản hồi chưa xác định. Mỗi kịch bản mô tả kết quả UI mong đợi.
- Fixture không dùng tên hay thông tin người thật. Giá trị chỉ để kiểm UI, không phải ngưỡng y khoa.

## CareLens

- Chỉ dữ liệu văn bản: `event_type`, `severity`, `care_level` (0–10, nullable), `summary`, `model_version`, `rule_version`.
- Không có frame, base64, URL ảnh, bounding box kèm ảnh.
- API hub trong PRD (`/api/v1/events`, `/events/stream`, `/ws/stream`, `/ai/status`, `/ai/config`) **chưa được xác minh**. Adapter thật chỉ viết ở M5 sau khi xác minh. Webapp không bao giờ gọi `/api/v1/cameras/frame`.
- Không suy ra confidence từ `care_level`.
- Không xây xác nhận uống thuốc khi chưa có đặc tả và nguồn sự kiện.

## EcoPatch

- Chỉ metric có nguồn xác nhận thiết bị hỗ trợ. Demo dùng `heart_rate` (bpm) kèm `quality`.
- GSR nếu có là giá trị thô kèm đơn vị. Không quy đổi thành hydrat hóa hay điện giải.
- Waveform lưu dạng WaveformSegment có `sample_rate`, `unit`, `started_at`, `sample_count`, có thời hạn lưu riêng.
- Pin là trường nullable. Không có thì hiển thị không có dữ liệu.
- Không giả định Web Bluetooth trong trình duyệt. BLE thuộc app điện thoại hoặc gateway.
- Lõi IoT và miếng dán là hai đối tượng. Thay miếng dán không đổi người được gán cho lõi.
