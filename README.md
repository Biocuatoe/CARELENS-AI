# CareLens AI

Hệ thống giám sát chăm sóc người cao tuổi: camera ESP32-S3, mô hình nhận diện chạy local (Module 1), backend lưu sự kiện và phát cảnh báo, LLM local tóm tắt theo ngày (Module 2), và webapp cho người chăm sóc. Người được chăm sóc là trung tâm. Backend EcoPatch đã ngừng; frontend vẫn giữ UI EcoPatch.

> **Trạng thái 2026-10-19:** frontend (landing, UI S01–S14) chạy trên **dữ liệu mô phỏng** trong trình duyệt, trừ persona **Demo trực tiếp** (Live Demo): đăng nhập bằng tài khoản do owner cấp thì hiển thị dữ liệu thật từ backend. Cloud backend `backend/care-monitoring` (Cloudflare Worker + D1 + R2, ADR-016 Proposed) và agent cục bộ `integrations/carelens/local-agent` đã chạy và kiểm thử cục bộ với mô hình thật và trình duyệt thật, **chưa deploy** và **chưa thử với ESP32 thật**. Mô hình nhận diện và quy tắc IMU chưa hiệu chỉnh trên thiết bị nên mặc định không tạo cảnh báo nghi ngã. Đây không phải thiết bị y tế và không đưa ra chẩn đoán.

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

Live Demo với backend cục bộ: làm theo `docs/DEV_LOCAL.md` (`dev_setup.py init` một lần, `npm run dev:backend`, `dev_setup.py provision --login-id <tên>`, `npm run dev`), rồi đăng nhập ở `/login`. Giám khảo dùng chung một tài khoản chỉ xem do owner cấp (`docs/DEPLOYMENT_RUNBOOK.md` §8.1). Bản build production cần `VITE_API_BASE_URL` (xem [docs/DEPLOYMENT_RUNBOOK.md](docs/DEPLOYMENT_RUNBOOK.md)).

Backend (Node 24): `cd backend/care-monitoring/worker && npm ci` một lần, rồi `npm run dev:backend` từ gốc (127.0.0.1:8787, dữ liệu cục bộ). Test: `cd backend/care-monitoring/worker` rồi `npm test`. Xem [backend/care-monitoring/README.md](backend/care-monitoring/README.md).

Agent cục bộ (Python 3.11+, thư viện chuẩn): xem [integrations/carelens/local-agent/README.md](integrations/carelens/local-agent/README.md). Test: `python -m pytest -q` trong thư mục đó.

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Hướng dẫn bắt buộc cho coding agent và lập trình viên |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Kế hoạch triển khai: nghiệp vụ, dữ liệu, quyền, mốc, nghiệm thu |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Kiến trúc kỹ thuật |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Quyết định, giả định, vấn đề chưa chốt |
| [docs/API_CONTRACT.md](docs/API_CONTRACT.md) | Hợp đồng API của cloud backend (thiết bị, agent, đăng nhập web, người chăm sóc, admin, Live Demo) |
| [docs/DEVICE_API.md](docs/DEVICE_API.md) | Giao thức cho firmware ESP32: đồng hồ, burst ảnh, IMU thô, kích hoạt, lệnh, âm thanh, lỗi |
| [docs/DEPLOYMENT_RUNBOOK.md](docs/DEPLOYMENT_RUNBOOK.md) | Các bước triển khai Cloudflare, agent, Vercel; kiểm tra và rollback |
| [docs/TEST_REPORT_2026-10-19.md](docs/TEST_REPORT_2026-10-19.md) | Lệnh đã chạy, kết quả, ma trận tích hợp, chặn còn lại |
| [docs/UI_IMPLEMENTATION_STATUS.md](docs/UI_IMPLEMENTATION_STATUS.md) | Trạng thái màn hình, kiểm tra đã chạy, khoảng trống tích hợp |
| [docs/CARELENS_ECOPATCH_SYSTEM_UI_PROMPT.md](docs/CARELENS_ECOPATCH_SYSTEM_UI_PROMPT.md) | Đặc tả UI hệ thống S01–S14 |
| [docs/CARELENS_ECOPATCH_LANDING_PROMPT.md](docs/CARELENS_ECOPATCH_LANDING_PROMPT.md) | Đặc tả landing page |
| `Carelens/`, `EcoPatch/` | PRD bản nháp (.docx, tiếng Việt và tiếng Anh) |

## Nguyên tắc dữ liệu

- Dữ liệu thật mang provenance đúng nguồn. Dữ liệu tổng hợp chỉ ở test và adapter mô phỏng của frontend, luôn gắn nhãn `Dữ liệu mô phỏng`.
- Không commit secrets, dữ liệu sức khỏe thật hoặc ảnh người thật.
- Frame CareLens chỉ nằm tạm trong bucket R2 riêng tư để agent cục bộ suy luận, rồi bị xóa (tối đa 15 phút). Không vào cơ sở dữ liệu, log hay webapp.
