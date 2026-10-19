---
paths:
  - "contracts/**"
  - "integrations/**"
  - "backend/api/app/modules/ingest/**"
  - "backend/care-monitoring/**"
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
- Luôn đặt `source_mode = "simulated"`. Chỉ chạy trong test hoặc môi trường dev riêng, không bao giờ trỏ vào backend chạy thật.
- Kịch bản theo plan §14: bình thường, thiếu dữ liệu, kết nối kém, mất kết nối, event trùng, gói đến muộn, cảnh báo chưa nhận, báo động sai, phản hồi chưa xác định. Mỗi kịch bản mô tả kết quả UI mong đợi.
- Fixture không dùng tên hay thông tin người thật. Giá trị chỉ để kiểm UI, không phải ngưỡng y khoa.

## CareLens

- Chỉ dữ liệu văn bản: `event_type`, `severity`, `care_level` (0–10, nullable), `summary`, `model_version`, `rule_version`.
- Không có frame, base64, URL ảnh, bounding box kèm ảnh trong D1, API người chăm sóc, log hay contract kết quả. Ngoại lệ duy nhất: API upload thiết bị `/api/device/v1/captures` đưa JPEG vào R2 riêng tư tạm thời cho agent cục bộ (D10, Proposed); không tạo đường ảnh nào khác.
- API hub trong PRD (`/api/v1/events`, `/events/stream`, `/ws/stream`, `/ai/status`, `/ai/config`) **chưa được xác minh**. Adapter thật chỉ viết ở M5 sau khi xác minh. Webapp không bao giờ gọi `/api/v1/cameras/frame`.
- Không suy ra confidence từ `care_level`.
- Không xây xác nhận uống thuốc khi chưa có đặc tả và nguồn sự kiện. Nhãn `uong_nuoc` / `uong_thuoc` của Module 1 chỉ là quan sát AI chưa xác nhận, không phải xác nhận uống thuốc, không tạo cảnh báo.
- Kết quả Module 1 vào backend qua `vision-result.v1` do agent cục bộ nộp (`contracts/carelens/`, sinh từ `backend/care-monitoring/worker/src/contracts.ts` bằng `npm run contracts:generate`; test kiểm fixture và độ lệch). Chỉ lưu số và nhãn; bỏ timing, header phản hồi và hộp phát hiện.
- Điểm ngã là logit chưa hiệu chỉnh. Không đặt ngưỡng trong code; ngưỡng chỉ qua `FUSION_POLICY_JSON.vision_candidate_rule` và `imu_candidate_rule` do owner duyệt (D11, ADR-017 `fusion-rules.v2`). Kích hoạt của firmware không phải bằng chứng; không có cảnh báo đơn nguồn.
- Hợp đồng thiết bị v2 (ADR-019, `docs/DEVICE_API.md`): mọi yêu cầu có `clock{boot_id, uptime_ms, …}`; bằng chứng mang `uptime_ms` và chỉ được ghép trong cùng `boot_id`. IMU thô (`imu-batch.v1`) giữ nguyên dạng với đơn vị cố định g, °/s, ms; không nội suy hay bịa mẫu. Thay đổi không tương thích tạo major mới và cập nhật harness `tools/sample_device.py` cùng lúc.
- Harness thiết bị giả (`integrations/carelens/local-agent/tools/sample_device.py`) luôn gửi `source_mode = "simulated"` và chỉ chấp nhận backend cục bộ.

## EcoPatch

Backend EcoPatch đã ngừng (ADR-015, Proposed). Không thêm contract, simulator, ingest hay metric EcoPatch. UI EcoPatch còn trong frontend nằm ngoài phạm vi.
