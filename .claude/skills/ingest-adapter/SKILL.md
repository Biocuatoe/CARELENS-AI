---
name: ingest-adapter
description: Add or extend a device data source for the CareLens + EcoPatch webapp — a synthetic simulator or a verified real adapter under integrations/carelens or integrations/ecopatch, its versioned JSON Schema contract in contracts/, and the authenticated ingest path with dedup, device-assignment mapping, quarantine and late-arrival handling. Use for "tạo simulator CareLens", "thêm metric EcoPatch", "kịch bản gói đến muộn", "nối hub thật".
argument-hint: "<carelens|ecopatch> <simulator|real> [kịch bản hoặc metric]"
---

# Nguồn dữ liệu: $ARGUMENTS

## 0. Cổng kiểm tra

- **Adapter thật:** chỉ làm khi `docs/DECISIONS.md` có D01, D02, D03 (CareLens) hoặc D04 (EcoPatch) ở trạng thái Accepted, và có tài liệu API hoặc thiết bị để xác minh. Thiếu điều kiện thì dừng phần adapter thật, báo điều kiện còn thiếu, đề xuất làm simulator.
- **Metric EcoPatch mới:** cần nguồn xác nhận thiết bị hỗ trợ, có đơn vị và tần suất. Không có thì không thêm.
- **Không bao giờ thêm:** hydrat hóa, điện giải, SpO2, confidence suy diễn, trường ảnh.

## 1. Contract

1. Tạo hoặc cập nhật `contracts/<product>/<name>.v<N>.schema.json`.
2. Thêm fixture ở `fixtures/valid/` và `fixtures/invalid/`. Bộ invalid gồm ít nhất: thiếu `source_record_id`, sai `source_mode`, có `care_recipient_id`, có trường ảnh.
3. Mô tả schema ghi "hợp đồng đề xuất của adapter, chưa xác minh với thiết bị" cho tới khi có bằng chứng M5.
4. Thay đổi không tương thích thì tạo major mới và ghi `/decision-log`.

## 2. Ingest trong backend/api/app/modules/ingest

1. Xác thực credential thiết bị, xác định `device`.
2. Validate payload bằng Pydantic khớp contract.
3. Dedup bằng `UNIQUE (device_id, source_record_id)`. Trùng thì trả bản ghi cũ, không tạo event hay alert mới (AC04).
4. Tìm DeviceAssignment tại `observed_at`. Không xác định được thì đưa vào quarantine (AC09).
5. Gán `received_at` từ clock server. `observed_at` ở tương lai quá ngưỡng cấu hình thì từ chối hoặc đánh dấu.
6. Chỉ cập nhật giá trị mới nhất khi `observed_at` mới hơn (AC08).
7. CareLens event qua rule demo có `rule_version`. Đạt điều kiện thì tạo alert, outbox và stream event trong cùng transaction.
8. Heartbeat cập nhật `last_seen`. Ngưỡng stale và disconnected là cấu hình kỹ thuật có ghi nguồn.

## 3. Simulator trong integrations/<product>/

- CLI Python với `--scenario`, `--seed`, `--api-url`. Credential đọc từ biến môi trường.
- Tất định theo seed. Retry dùng lại `source_record_id`.
- Luôn `source_mode = "simulated"`.
- Gửi qua API ingest, không ghi thẳng DB.
- Kịch bản plan §14: bình thường, thiếu dữ liệu, kết nối kém, mất kết nối, event trùng, gói đến muộn, cảnh báo chưa nhận, báo động sai, phản hồi chưa xác định. Mỗi kịch bản ghi kết quả UI mong đợi trong docstring hoặc README của thư mục.

## 4. Test

- [ ] Contract: mọi fixture valid qua Pydantic, mọi fixture invalid bị từ chối.
- [ ] AC04: gửi cùng event nhiều lần ra một event và một alert.
- [ ] AC08: gói cũ đến sau gói mới vào lịch sử, không thay giá trị mới nhất.
- [ ] AC09: đổi gán thiết bị rồi nhận gói cũ, dữ liệu thuộc người tại thời điểm đo hoặc bị cách ly.
- [ ] Credential sai trả 401. Thiết bị ngoài scope trả 403.
- [ ] Payload có trường ảnh trả 422.
- [ ] Simulator chạy mỗi kịch bản không lỗi trên DB demo sạch.

Kết thúc bằng `/guardrail-check` để rà AC16 (không có đường ảnh vào webapp).
