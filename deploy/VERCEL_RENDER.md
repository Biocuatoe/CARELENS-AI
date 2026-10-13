# Hướng dẫn triển khai — Vercel + Render

## Vercel Setup (Frontend)

**Bước 1:** Import repository vào Vercel
- Truy cập [vercel.com](https://vercel.com) → "Import Project"
- Chọn repository `istartup` (hoặc `d-IStartup-main`)

**Bước 2:** Cấu hình Root Directory
- Đặt **Root Directory** là `frontend`

**Bước 3:** Thêm Environment Variable
- `VITE_API_URL` = URL của Render API (ví dụ: `https://istartup-api.onrender.com`)
- Nhấn "Deploy"

---

## Render Setup (Backend)

**Bước 1:** Import repository vào Render
- Truy cập [render.com](https://render.com) → "New" → "Blueprint"
- Upload file `backend/api/render.yaml` HOẶC liên kết GitHub repo và chọn `backend/api` làm root

**Bước 2:** Tạo Environment Group
- Trong Render Dashboard → "Environment" → "Groups"
- Tạo group tên `istartup-api-env`
- Thêm các biến môi trường theo bảng bên dưới

**Bước 3:** Tạo PostgreSQL Database
- Render Dashboard → "New" → "PostgreSQL"
- Chọn region: **Singapore**
- Chọn plan: **Free**
- Copy **Internal Database URL** vào `DATABASE_URL` trong env group

**Bước 4:** Deploy
- Nhấn "Apply Changes" hoặc "Create Blueprint"
- Render sẽ chạy `pip install uv && uv sync && alembic upgrade head` rồi khởi động uvicorn

---

## Environment Variables

| Biến | Nền tảng | Giá trị mẫu | Ghi chú |
| --- | --- | --- | --- |
| `VITE_API_URL` | Vercel (frontend) | `https://istartup-api.onrender.com` | URL của Render API |
| `DATABASE_URL` | Render (backend) | `postgres://user:pass@host/db` | Connection string từ Render PostgreSQL |
| `SECRET_KEY` | Render (backend) | `xxxxxxxx...` (64 ký tự hex) | Tạo: `openssl rand -hex 32` |
| `CORS_ORIGINS` | Render (backend) | `https://istartup.vercel.app` | Domain Vercel, phân cách bằng dấu phẩy |
| `ENVIRONMENT` | Render (backend) | `production` | |

---

## Health Check

Endpoint `GET /health` sẽ được thêm trong M1. Sau khi backend deploy thành công:
- Kiểm tra: `https://istartup-api.onrender.com/health`
- Response mong đợi: `{"status": "ok"}`

---

## CI/CD

**Không cần GitHub Actions** — Vercel và Render tự deploy khi push lên nhánh `main`:

| Nền tảng | Trigger | Tự động chạy |
| --- | --- | --- |
| Vercel | Push lên `main` | `npm run build` |
| Render | Push lên `main` | `uv sync && alembic upgrade head` |

---

## Thứ tự deploy đề xuất

1. Deploy **Render backend** trước (tạo PostgreSQL + env group)
2. Lấy URL backend (ví dụ: `https://istartup-api.onrender.com`)
3. Deploy **Vercel frontend** với `VITE_API_URL` đã có
4. Verify: mở https://istartup.vercel.app → kiểm tra kết nối API
