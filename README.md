# CareLens + EcoPatch Webapp

Webapp chung giúp người chăm sóc theo dõi thông tin, quản lý thiết bị và phối hợp xử lý cảnh báo cho hai giải pháp CareLens và EcoPatch. Người được chăm sóc là trung tâm: một hồ sơ có thể dùng một hoặc cả hai sản phẩm.

> **Trạng thái 2026-09-15:** đã có landing page và UI hệ thống S01–S14 chạy trên **dữ liệu mô phỏng**. Chưa có backend, chưa tích hợp thiết bị hoặc AI thật. Đây không phải thiết bị y tế và không đưa ra chẩn đoán.

## Chạy thử

Yêu cầu: Node 22 trở lên (khuyến nghị 24).

```bash
npm install
npm run dev
```

Mở http://localhost:5173 để xem landing. Vào ứng dụng qua **Đăng nhập** hoặc **Mở bản demo đầy đủ**, rồi chọn một người dùng trong mục **Vào bản demo**. Dữ liệu chỉ nằm trong trình duyệt và đặt lại khi tải lại trang.

Kiểm tra:

```bash
npm run typecheck
npm run lint
npm test
npx -w @istartup/web playwright install chromium   # một lần
npm run test:e2e
```

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Hướng dẫn bắt buộc cho coding agent và lập trình viên |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Kế hoạch triển khai: nghiệp vụ, dữ liệu, quyền, mốc, nghiệm thu |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Kiến trúc kỹ thuật |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Quyết định, giả định, vấn đề chưa chốt |
| [docs/UI_IMPLEMENTATION_STATUS.md](docs/UI_IMPLEMENTATION_STATUS.md) | Trạng thái màn hình, kiểm tra đã chạy, khoảng trống tích hợp |
| [docs/CARELENS_ECOPATCH_SYSTEM_UI_PROMPT.md](docs/CARELENS_ECOPATCH_SYSTEM_UI_PROMPT.md) | Đặc tả UI hệ thống S01–S14 |
| [docs/CARELENS_ECOPATCH_LANDING_PROMPT.md](docs/CARELENS_ECOPATCH_LANDING_PROMPT.md) | Đặc tả landing page |
| `Carelens/`, `EcoPatch/` | PRD bản nháp (.docx, tiếng Việt và tiếng Anh) |

## Nguyên tắc dữ liệu

- Chỉ dùng dữ liệu tổng hợp, luôn gắn nhãn `Dữ liệu mô phỏng`.
- Không commit secrets, dữ liệu sức khỏe thật hoặc ảnh người thật.
- Ảnh và video từ CareLens không đi vào webapp.
