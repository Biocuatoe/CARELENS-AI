# Chạy cục bộ: backend, tài khoản Live Demo và frontend

Trạng thái: **Đã kiểm chứng** ngày 2026-10-19 trên Windows 11 (Node 24, Python 3.11): trình duyệt Chromium đăng nhập bằng form thật vào Worker thật và D1 cục bộ (không mock). Chỉ chạy trên loopback; không đụng tài khoản Cloudflare.

## Một lần

```powershell
npm install                                   # gốc repo
cd backend/care-monitoring/worker; npm ci; cd ../../..
python backend/care-monitoring/scripts/dev_setup.py init     # tạo worker/.dev.vars và token admin cục bộ (cả hai bị gitignore)
```

`init` không ghi đè `.dev.vars` đã có. Nếu `.dev.vars` có sẵn thì nó phải chứa `ADMIN_TOKEN_SHA256` và `ALLOWED_ORIGINS` (xem `.dev.vars.example`).

## Mỗi lần làm việc

Hai cửa sổ terminal, từ thư mục gốc:

```powershell
npm run dev:backend      # Worker + D1 + R2 cục bộ ở http://127.0.0.1:8787 (tự áp migration)
npm run dev              # frontend ở http://localhost:5173
```

Cấp tài khoản trình diễn lần đầu, hoặc sau khi reset DB (mật khẩu nhập ở dòng nhắc ẩn, không phải tham số dòng lệnh; không có trong repo):

```powershell
python backend/care-monitoring/scripts/dev_setup.py provision --login-id DAYONE
```

Rồi mở http://localhost:5173/login và đăng nhập. Tài khoản là `viewer` (chỉ xem) trên hồ sơ `rcp-showcase`. Có thể chạy lại `provision` bất cứ lúc nào (đổi mật khẩu và kết thúc mọi phiên của tài khoản).

## Khi không đăng nhập được

Trang đăng nhập phân biệt các nguyên nhân; thông báo cho biết nên xem gì:

| Thông báo | Nguyên nhân | Việc cần làm |
| --- | --- | --- |
| "Không kết nối được máy chủ CareLens…" | Không có gì trả lời ở `http://127.0.0.1:8787` | Chạy `npm run dev:backend`. Nếu nó thoát ngay với mã 3 ("local database predates the schema check"), chạy `python backend/care-monitoring/start_backend.py --reset-local-db` (xóa DB cục bộ, chỉ dữ liệu thử), rồi `provision` lại |
| "Máy chủ đang chạy nhưng không chấp nhận địa chỉ trang này (…)" | CORS: origin của trang không nằm trong `ALLOWED_ORIGINS` (Vite chỉ dùng cổng 5173) | Thêm origin vào `ALLOWED_ORIGINS` trong `.dev.vars`, khởi động lại backend |
| "Tài khoản hoặc mật khẩu không đúng." | Máy chủ trả 401 (chưa `provision`, hoặc sai) | `provision` rồi thử lại |
| "Có quá nhiều lần đăng nhập…" | Giới hạn tần suất | Đợi một phút |
| "Máy chủ không xác nhận đăng nhập (mã N)" | Lỗi máy chủ (xem log của `npm run dev:backend`) | Sửa theo log |

Cần dừng sạch: `wrangler dev` có thể để lại tiến trình `workerd` chạy nền; hai bản chạy chồng nhau trên cổng 8787 làm máy chủ nhận kết nối nhưng không trả lời. Tắt hết rồi chạy lại một bản.

## Đăng nhập bằng Google (tùy chọn, cần tài khoản Google Cloud của chủ sở hữu)

Không có cấu hình Google thì nút "Đăng nhập bằng Google" báo rõ "chưa được cấu hình trên máy chủ này". Để thử cục bộ:

1. Google Cloud Console → APIs & Services → OAuth consent screen (loại External, trạng thái Testing, thêm email thử vào Test users) → Credentials → Create OAuth client ID → **Web application**. Authorized redirect URI: `http://localhost:8787/api/app/v1/auth/google/callback`.
2. Trong `worker/.dev.vars` điền `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, giữ `GOOGLE_REDIRECT_URI=http://localhost:8787/api/app/v1/auth/google/callback` và `GOOGLE_POST_LOGIN_URL=http://localhost:5173/login`. Khởi động lại backend.
3. Luồng phải bắt đầu trên đúng host của redirect URI (cookie gắn với host), nên chạy frontend với `VITE_API_BASE_URL=http://localhost:8787`:
   `$env:VITE_API_BASE_URL='http://localhost:8787'; npm run dev` và mở http://localhost:5173/login.
4. Cho phép một tài khoản Google (không ai được vào tự động): `python backend/care-monitoring/scripts/admin.py --api http://localhost:8787 google-allow --user <user_id của tài khoản ở bước provision> --email <email Google>` (cần `CARELENS_ADMIN_TOKEN`; token cục bộ nằm ở `worker/.wrangler/dev-admin-token.txt`).
5. Bấm nút Google và đăng nhập bằng đúng email đó. Email khác bị từ chối ("chưa được cấp quyền").

## Thiết bị thật (ESP32) và dashboard admin không cần Google

Đã chạy 2026-10-19. Chỉ trên máy dev và mạng nhà; không đụng Cloudflare.

1. Backend với email admin dev: `python backend/care-monitoring/start_backend.py --dev-admin-email local-dev-admin@carelens.invalid` (truyền `ADMIN_BOOTSTRAP_EMAILS` chỉ cho `wrangler dev` cục bộ).
2. Dashboard admin: `python backend/care-monitoring/scripts/dev_admin_login.py` ghi một liên kết đăng nhập dùng một lần (10 phút) vào `worker/.wrangler/dev-admin-login-url.txt`; mở liên kết đó trong trình duyệt (frontend dev ở 5173). Phiên admin chỉ trong bộ nhớ: tải lại trang là phải đăng nhập lại.
3. Thiết bị: `firmware/carelens-esp32s3/README.md` §"Thử đầu-cuối cục bộ" (cấp thiết bị/agent, CA thử nghiệm, proxy TLS trên IP LAN, nạp cấu hình qua UART).
4. Thử tự động với thiết bị: `frontend/e2e/hardware-device.spec.ts` (biến `E2E_HARDWARE_DEVICE`, `E2E_ADMIN_LOGIN_URL_FILE`, `E2E_TEST_MP3` (MP3 thử, ADR-025), tùy chọn `E2E_FIRMWARE_VERSION`, `E2E_SPEAKER_VOLUME`, `E2E_STEPS`) và `firmware/carelens-esp32s3/tools/e2e_failures.py`.
5. `wrangler dev` không tự chạy cron: kích hoạt bảo trì bằng `curl "http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*"` (có nhờ `--test-scheduled`).

## Kiểm tra

```powershell
cd backend/care-monitoring/worker; npm test; npm run typecheck     # Worker, gồm test Google với Google giả
npm run lint; npm run typecheck; npm test                            # frontend (từ gốc)
npm run test:e2e                                                     # Playwright (backend giả ở tầng mạng)
# Đăng nhập thật, không mock, vào backend cục bộ đang chạy và frontend dev:
$env:E2E_BASE_URL='http://localhost:5173'; $env:E2E_LIVE_BACKEND_URL='http://127.0.0.1:8787'
$env:E2E_LIVE_EMAIL='DAYONE'; $env:E2E_LIVE_PASSWORD='<mật khẩu đã provision>'
npx -w @istartup/web playwright test live-demo-backend
```
