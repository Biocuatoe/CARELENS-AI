# Runbook triển khai — Cloudflare (backend) + PC tại nhà (agent) + Vercel (frontend)

Phiên bản 2026-10-19 (đợt 3). Trạng thái: **đã triển khai backend và frontend, đăng nhập Google chờ owner cấu hình** (bảng dưới). Ô `[ ]` là việc chưa làm.

| Thành phần | Giá trị thật (2026-10-19) |
| --- | --- |
| Cloudflare account | `Hungleduc2005@gmail.com's Account` |
| Worker | `https://care-monitoring.care-monitoring-worker.workers.dev` |
| D1 `care_monitoring` | id `bc68672b-ae27-459c-8edf-408c44a96728`, migration `0001`–`0003` đã áp |
| R2 | `carelens-capture-media` (xóa sau 1 ngày), `carelens-voice-audio`; r2.dev tắt, không custom domain |
| Vercel | team `dayone7`, project `carelens-ai`, Root Directory `frontend`, nối GitHub `Biocuatoe/CARELENS-AI` nhánh `main` (tự deploy khi push) |
| Frontend | `https://carelens-ai-eta.vercel.app` (`carelens-ai.vercel.app` đã có người dùng) |
| Đăng nhập | Chỉ Google (A38): `PASSWORD_SIGN_IN=disabled`, `GOOGLE_OPEN_VIEWER_RECIPIENT_ID=rcp-showcase`. `GOOGLE_CLIENT_ID` và secret `GOOGLE_CLIENT_SECRET` đã đặt, Worker bản `b2e7726f`; `/ready` báo `google_signin: configured`, Google chấp nhận client và redirect URI (tới trang chọn tài khoản). `docs/ESP32_READINESS.md` §1 ghi đã có một lần đăng nhập người xem thật thành công (đọc audit production); chưa đối chiếu lại trong đợt 2026-10-19 tối |
| Chưa làm | `ADMIN_TOKEN_SHA256` (admin API báo 503), agent cục bộ, thiết bị |

Ghi chú mạng: ở mạng của máy dev, `curl`/Node mặc định (TLS 1.3 với khóa post-quantum) bắt tay lỗi tới `*.workers.dev`; `curl.exe --tls-max 1.2`, `openssl` và Chromium đều chạy. Dùng `--tls-max 1.2` cho các lệnh `curl` dưới đây nếu gặp lỗi 35. Lệnh chạy trong PowerShell trên Windows trừ khi ghi khác. `<…>` là chỗ điền giá trị thật; không dán giá trị bí mật vào tài liệu, chat hay commit.

## 0. Xem xét trước (không cần tài khoản)

- [ ] Đọc các quyết định chưa chốt trong `docs/DECISIONS.md`. Deploy cho buổi trình diễn **không** đòi chốt chúng, nhưng đưa dữ liệu người thật lên thì phải chốt:

  | Mục | Trạng thái | Khi nào chốt |
  | --- | --- | --- |
  | ADR-016 (Cloudflare), ADR-018 (đăng nhập web, vé stream), D12 (tài khoản giám khảo), A34 | Proposed | Trước khi deploy |
  | D13 (workspace npm gốc, đã sửa trong mã, chờ owner xem) | Proposed | Khi duyệt thay đổi |
  | ADR-017 (hợp nhất), ADR-019 (hợp đồng thiết bị v2), D10 (frame qua cloud), D11 (hiệu chỉnh), A30, A33 (lưu IMU) | Proposed / Open | **Giai đoạn firmware**, sau khi có dữ liệu ESP32 thật (mục 15) |
  | D08 (thời hạn lưu) | Open | Trước khi có dữ liệu người thật |

- [ ] Xem chặn còn lại: `docs/TEST_REPORT_2026-10-19.md` §5.
- [ ] Chạy kiểm tra cục bộ:

```powershell
npm install                                   # gốc: cài workspace frontend (D13)
npm run typecheck; npm run lint; npm test; npm run build
cd backend/care-monitoring/worker
npm ci
npm run typecheck; npm test; npm run contracts:check; npm run deploy:dry-run
```

## 1. Bí mật đã lộ và tệp cục bộ

- [ ] **Thu hồi token Telegram cũ** ở BotFather (`/revoke`, chọn bot) nếu chưa làm. Hai nơi chứa token dạng Telegram:
  - `backend/care-monitoring/.env` của service cũ: bị git bỏ qua, không mã nào còn đọc.
  - Commit `e9d9b67` (`backend/demo-control/src/demo_control/tests/test_telegram_bot.py`), **đã có trên `origin/main`** (GitHub) và nhánh `origin/claude/quirky-hamilton-f25ob3`. Chuỗi khớp dạng mask `8291****15A` ngay cạnh nó nên coi như token thật.

  Thu hồi làm cả hai bản sao vô hiệu. Viết lại lịch sử git (`git filter-repo` + force push) là quyết định riêng của owner, không cần để vận hành và không làm trong runbook này.
- [ ] Sau khi thu hồi: `Remove-Item backend\care-monitoring\.env`.
- [ ] Trước mỗi commit, kiểm tra không có tệp bí mật trong vùng staged:

```powershell
git diff --cached --name-only        # không được có: .env*, .dev.vars, agent.env, *token*.txt,
                                     # device-credentials*.json, *.pem, *.key, frontend/dist, .wrangler/
git status --porcelain --ignored     # .env, .dev.vars, agent.env phải hiện là "!!" (bị bỏ qua)
```

- [ ] Không đặt bí mật vào biến `VITE_*`: mọi `VITE_*` bị nhúng vào bundle công khai. `VITE_API_BASE_URL` chỉ là URL công khai của Worker.

## 2. Đăng nhập Cloudflare

```powershell
cd backend/care-monitoring/worker
npx wrangler login
npx wrangler whoami                  # đúng tài khoản dự định dùng
```

## 3. Tạo D1 và R2 riêng tư (chỉ khi bắt đầu triển khai)

- [ ] Bật R2 trong dashboard. Có thể phải thêm phương thức thanh toán dù dùng trong hạn miễn phí (nguồn bên thứ ba, chưa kiểm trên tài khoản thật).

```powershell
npx wrangler d1 create care_monitoring
npx wrangler r2 bucket create carelens-capture-media
npx wrangler r2 bucket create carelens-voice-audio
# Lưới an toàn: Worker xóa frame trong ≤ 15 phút; quy tắc này xóa mọi thứ còn sót sau 1 ngày.
npx wrangler r2 bucket lifecycle add carelens-capture-media expire-media --expire-days 1
```

- [ ] Hai bucket **riêng tư**: `npx wrangler r2 bucket dev-url get carelens-capture-media` (và `carelens-voice-audio`) báo r2.dev đang tắt; dashboard R2 → bucket → Settings: không có custom domain. Không bật public access.

## 4. Điền binding và cấu hình (`wrangler.jsonc`)

- [ ] `d1_databases[0].database_id` = id in ra ở bước 3 (thay `00000000-0000-0000-0000-000000000000`). Tên bucket giữ nguyên.
- [ ] `vars`:

  | Biến | Giá trị production |
  | --- | --- |
  | `ENVIRONMENT` | `production` |
  | `ALLOWED_ORIGINS` | Origin Vercel chính xác, ví dụ `https://<dự-án>.vercel.app` (thêm domain riêng nếu có). Không dùng `*`. Chọn tên dự án Vercel trước để biết origin |
  | `ACCEPT_SIMULATED_SOURCES` | `false` (dữ liệu `simulated` bị từ chối) |
  | `FUSION_POLICY_JSON` | Để trống: không cảnh báo nghi ngã cho tới khi D11 có quy tắc đã duyệt. Không dùng chính sách thử của test |
  | `LEGACY_STREAM_RECIPIENT_ID`, `LEGACY_STREAM_DEVICE_ID`, `LEGACY_STREAM_ALLOWED_IPS` | Để trống (Live Demo dùng đăng nhập + vé) |
  | `DEVICE_AUDIO_SAMPLE_RATES` | `16000` cho tới khi firmware hỗ trợ thêm |
  | `IMU_RAW_RETENTION_HOURS`, `IMU_STORAGE_SOFT_LIMIT_MB` | `72`, `400` (mặc định; xem mục 13 trước khi bật IMU liên tục) |
  | `SESSION_TTL_HOURS` | `12` (đủ một buổi chấm) |
  | Còn lại | Giữ mặc định (bảng đầy đủ: `backend/care-monitoring/README.md`) |

- [ ] `npm run deploy:dry-run` liệt kê đủ binding, không có cảnh báo cấu hình.

## 5. Migration D1 remote (không hoàn tác được)

```powershell
npx wrangler d1 migrations list care_monitoring --remote   # chỉ 0001_initial.sql đang chờ
npm run db:migrate:remote
```

- [ ] Từ đây không sửa `migrations/0001_initial.sql`; mọi thay đổi schema là file `0002_*.sql` mới.

## 6. Secret và origin

```powershell
python ..\scripts\make_admin_token.py          # ghi token admin vào ~/carelens-admin-token.txt, in SHA-256
npx wrangler secret put ADMIN_TOKEN_SHA256     # dán digest (64 hex), không dán token
```

- [ ] Lưu token admin trong trình quản lý mật khẩu, rồi xóa tệp `~/carelens-admin-token.txt`.
- [ ] `ALLOWED_ORIGINS` đã đặt ở mục 4. Không có secret nào khác.

## 7. Deploy Worker, kiểm `/ready` và CORS

```powershell
npm run deploy
$api = "https://care-monitoring.<subdomain>.workers.dev"
curl.exe -s "$api/health"
curl.exe -s "$api/ready"
curl.exe -s -i -X OPTIONS "$api/api/app/v1/session" -H "Origin: https://<dự-án>.vercel.app" -H "Access-Control-Request-Method: POST"
curl.exe -s -i -X OPTIONS "$api/api/app/v1/session" -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST"
```

- [ ] `/ready`: `"status":"ready"`, `checks.d1: ok`, `admin_api: configured`, `simulated_sources: rejected`, `alerts: none_until_both_rules_are_approved`.
- [ ] CORS: origin Vercel → 204 + `access-control-allow-origin` đúng origin đó; origin lạ → 403, không có header CORS.

## 8. Cấp phát (admin API)

```powershell
$env:CARELENS_ADMIN_TOKEN = '<token admin>'
cd ..   # backend/care-monitoring
python scripts/admin.py --api $api recipient --label "Hồ sơ trình diễn" --id rcp-showcase
python scripts/admin.py --api $api agent --label "PC tại nhà"                 # → token cla_… cho agent.env
python scripts/admin.py --api $api caregiver --name "Người thân"               # → user_id, token_id
python scripts/admin.py --api $api grant --user <user_id người thân> --recipient rcp-showcase --role caregiver
python scripts/admin.py --api $api login --user <user_id người thân> --login-id <email hoặc tên đăng nhập>
# Khi có firmware (giai đoạn sau):
# python scripts/admin.py --api $api device --id esp32-cam-01 --recipient rcp-showcase --label "Camera phòng khách"
```

Mật khẩu web và token chỉ hiện một lần. Lệnh `caregiver` in thêm một token API `clc_…` dài hạn mà web không cần: nếu không dùng thì thu hồi bằng `revoke-token --id <token_id>`.

### 8.1 Một tài khoản giám khảo dùng chung (chỉ xem)

> **Bản deploy hiện tại không dùng mục này** (A38): đăng nhập mật khẩu bị tắt và giám khảo vào bằng Google (§8.2). Chỉ làm theo mục này nếu owner bật lại `PASSWORD_SIGN_IN` (`"enabled"` trong `wrangler.jsonc`, rồi `npm run deploy`) và đã có admin API.

Một tài khoản riêng cho cả ban giám khảo. Mỗi lần đăng nhập là một phiên riêng nên nhiều giám khảo dùng cùng lúc được (đã kiểm cục bộ: 5 phiên và 5 stream đồng thời). Không dùng tài khoản owner, admin hay người thân cho việc này. Không có đăng ký, khôi phục mật khẩu hay tài khoản riêng từng giám khảo.

- [ ] Tạo bản ghi riêng: `python scripts/admin.py --api $api caregiver --name "Ban giám khảo"` → ghi `user_id`, `token_id`.
- [ ] Thu hồi token API vừa in (giám khảo chỉ dùng đăng nhập web): `python scripts/admin.py --api $api revoke-token --id <token_id>`.
- [ ] Cấp quyền tối thiểu, chỉ trên hồ sơ trình diễn: `python scripts/admin.py --api $api grant --user <user_id> --recipient rcp-showcase --role viewer` → ghi `grant_id`.
- [ ] Cấp đăng nhập. Có hai cách:
  - **Mật khẩu do máy chủ sinh (khuyến nghị):** `python scripts/admin.py --api $api login --user <user_id> --login-id <email hoặc tên đăng nhập>`. Mật khẩu 100 bit dạng `xxxxx-xxxxx-xxxxx-xxxxx`, chỉ hiện một lần.
  - **Tài khoản trình diễn cố định `DAYONE` / `DAYONE` (chỉ dùng cho cuộc thi, mật khẩu yếu):** `python scripts/admin.py --api $api login --user <user_id> --login-id DAYONE --choose-password`, rồi gõ mật khẩu ở dòng nhắc ẩn (hoặc đặt biến môi trường `CARELENS_LOGIN_PASSWORD` trong phiên hiện tại và xóa ngay sau đó). Mật khẩu không bao giờ là tham số dòng lệnh, không có trong repo hay biến `VITE_*`. Máy chủ chỉ lưu băm PBKDF2-SHA256 có salt (`pbkdf2-sha256$<vòng lặp>$<salt>$<băm>`) và không trả mật khẩu về. Tên đăng nhập không phân biệt hoa thường; mật khẩu thì phân biệt.
  - Mật khẩu yếu chỉ được chấp nhận vì tài khoản là `viewer` trên đúng một hồ sơ trình diễn, đăng nhập bị giới hạn 20 lần/60 s mỗi IP, và phải **xoay ngay sau buổi trình diễn** (bước dưới). Không dùng cho dữ liệu thật hay tài khoản có quyền xử lý cảnh báo.
  - **Chưa thực hiện trên bản deploy.** Hiện chỉ đã kiểm trên backend cục bộ (`wrangler dev`, D1 tạm); tài khoản trên Cloudflare chỉ tồn tại sau khi chạy lệnh trên với backend đã deploy.
- [ ] Chuyển tên đăng nhập và mật khẩu cho ban tổ chức qua kênh riêng (trực tiếp hoặc tin nhắn riêng), không qua nhóm chat chung. Không ghi vào repo, slide hay ảnh chụp màn hình.
- [ ] Kiểm sau khi deploy frontend (mục 11): đăng nhập trên hai trình duyệt hoặc thiết bị cùng lúc; cả hai thấy Live Demo; đăng xuất một bên không ảnh hưởng bên kia; xử lý cảnh báo bị từ chối ("chỉ có quyền xem").
- [ ] **Sau buổi trình diễn**:
  1. `python scripts/admin.py --api $api revoke-grant --id <grant_id>`: hết quyền xem, stream đang mở bị đóng.
  2. `python scripts/admin.py --api $api login --user <user_id> --login-id <tên đăng nhập>` (không `--choose-password`): máy chủ sinh mật khẩu ngẫu nhiên mới, kết thúc mọi phiên và vô hiệu `DAYONE`. Không chia sẻ mật khẩu mới.
- [ ] Xong cấp phát: `Remove-Item Env:CARELENS_ADMIN_TOKEN`.

Giới hạn: đăng nhập tính 20 lần/60 s cho mỗi địa chỉ IP, kể cả lần đúng. Cả ban giám khảo sau một NAT vẫn đủ. Phiên sống `SESSION_TTL_HOURS` (12 h). Tải lại trang thì phải đăng nhập lại, vì token chỉ nằm trong bộ nhớ.

### 8.2 Đăng nhập bằng Google (lối đăng nhập duy nhất của bản deploy, A38)

Đã có sẵn trong `wrangler.jsonc` và đã deploy: `GOOGLE_REDIRECT_URI`, `GOOGLE_POST_LOGIN_URL`, `GOOGLE_OPEN_VIEWER_RECIPIENT_ID=rcp-showcase`, `PASSWORD_SIGN_IN=disabled`; migration `0002` và `0003` đã áp. **Còn thiếu đúng hai giá trị do owner tạo:** Client ID (công khai) và Client secret (bí mật).

1. Google Cloud Console → chọn (hoặc tạo) project → **Google Auth Platform** (tên cũ: *APIs & Services → OAuth consent screen*):
   - **Branding:** tên ứng dụng (ví dụ "CareLens AI Live Demo"), email hỗ trợ, email liên hệ của nhà phát triển. Có thể thêm *Authorized domain* `vercel.app` và `workers.dev` nếu Console yêu cầu.
   - **Audience:** User type **External**. Bấm **Publish app** để chuyển sang **In production**. Nếu để *Testing*, chỉ các email trong *Test users* (tối đa 100) đăng nhập được, còn mọi người khác bị Google chặn trước khi tới CareLens. Chỉ dùng scope không nhạy cảm `openid` và `email`, nên thường không cần xét duyệt; Google có thể vẫn hiện cảnh báo "ứng dụng chưa được xác minh" cho tới khi xác minh thương hiệu (chưa kiểm trên tài khoản này).
   - **Data access:** chỉ `openid` và `.../auth/userinfo.email`. Không thêm scope khác.
2. **Clients → Create client → Web application**:
   - *Authorized redirect URIs*: đúng một dòng, đúng từng ký tự:
     `https://care-monitoring.care-monitoring-worker.workers.dev/api/app/v1/auth/google/callback`
   - *Authorized JavaScript origins*: để trống (trình duyệt không gọi Google trực tiếp; Worker làm mọi bước).
   - Ghi lại Client ID (`…apps.googleusercontent.com`) và Client secret.
3. Đặt cấu hình ở Worker (từ `backend/care-monitoring/worker`):
   - Client secret, gõ ở dòng nhắc của Wrangler, không dán vào chat, tệp hay tham số: `npx wrangler secret put GOOGLE_CLIENT_SECRET`. Wrangler tự tạo phiên bản Worker mới mang secret này.
   - Client ID không phải bí mật: điền vào `"GOOGLE_CLIENT_ID"` trong `wrangler.jsonc` rồi `npm run deploy` (bước này là lần deploy cần thiết). Đặt secret trước rồi mới deploy client ID, để không có lúc nào chỉ có một nửa cấu hình (nửa vời → các route Google báo 503 `misconfigured`, phần còn lại không ảnh hưởng).
   - Frontend không cần deploy lại: nó hỏi `GET /auth/google/config` mỗi lần mở trang đăng nhập.
4. Kiểm:
   - `curl.exe --tls-max 1.2 -s $api/api/app/v1/auth/google/config` trả `{"enabled":true,"access":"open_viewer","password_sign_in":false}`; `/ready` có `google_signin: configured`, `google_access: open_viewer_read_only`.
   - Cửa sổ riêng tư → `https://carelens-ai-eta.vercel.app/login` → "Đăng nhập bằng Google" → chọn tài khoản → về `/people` → thấy "Hồ sơ trình diễn". Thử bằng tài khoản Google thứ hai trên trình duyệt khác; đăng xuất một bên không ảnh hưởng bên kia.
   - Hồ sơ trình diễn rỗng cho tới khi có thiết bị thật gán vào `rcp-showcase` (cần admin API). Như vậy là đúng, không phải lỗi.
5. Kiểm soát sau đó:
   - Đóng chế độ mở: đặt `"GOOGLE_OPEN_VIEWER_RECIPIENT_ID": ""` rồi `npm run deploy` (không ai mới vào được; phiên đang có hết sau `SESSION_TTL_HOURS`).
   - Chặn một người: tắt tài khoản của họ trong D1 (`UPDATE caregivers SET status='disabled' WHERE user_id=…`, tra `user_id` qua bảng `google_viewers`) hoặc thu hồi grant bằng admin API.
   - Tắt hẳn Google: `npx wrangler secret delete GOOGLE_CLIENT_SECRET` và để trống `GOOGLE_CLIENT_ID`, rồi deploy; xóa OAuth client ở Console nếu không dùng nữa.

Chế độ danh sách cho phép (A37) vẫn còn: để trống `GOOGLE_OPEN_VIEWER_RECIPIENT_ID` và dùng `admin.py google-allow --user … --email …` (cần admin API).

## 9. Agent cục bộ trên PC Windows

Xem `integrations/carelens/local-agent/README.md`. **Chặn đã đo (2026-10-19):** Python của agent trên PC dev báo `certificate verify failed: certificate has expired` khi gọi Worker, vì kho gốc Windows có `ISRG Root X2` hết hạn; sửa kho chứng chỉ trước (`docs/ESP32_READINESS.md` §4). Agent cũng cần token `cla_…` từ admin API (chưa cấu hình). Tóm tắt:

```powershell
cd integrations/carelens/local-agent
copy agent.env.example agent.env       # CARELENS_BACKEND_URL=$api, CARELENS_AGENT_TOKEN=cla_…
powershell -ExecutionPolicy Bypass -File scripts\start_vision_server.ps1 -Device cuda -Background
powershell -ExecutionPolicy Bypass -File scripts\check_agent.ps1
powershell -ExecutionPolicy Bypass -File scripts\start_agent.ps1
```

- [ ] `python ..\..\..\backend\care-monitoring\scripts\admin.py --api $api status` → `agents[0].connected: true`, `reported.vision.fall_heads: 3`.
- [ ] Agent chỉ gọi ra ngoài: không mở cổng, không đăng ký Windows service, Vision và Ollama chỉ nghe `127.0.0.1`.

## 10. Vercel (frontend)

| Thiết lập | Giá trị |
| --- | --- |
| Root Directory | `frontend` |
| Include files outside the Root Directory | Bật (mặc định). Từ D13, `npm install` trong `frontend/` cài theo workspace gốc và `package-lock.json` gốc |
| Framework Preset | Vite (đã có trong `frontend/vercel.json`, kèm rewrite SPA về `index.html`) |
| Environment Variables | `VITE_API_BASE_URL = https://care-monitoring.<subdomain>.workers.dev` cho **Production** (Preview chỉ khi đã thêm origin Preview vào `ALLOWED_ORIGINS`). Không đặt `VITE_DATA_MODE`. Không biến bí mật nào |
| Build | `npm run build` (mặc định của `vercel.json`) |

Biến `VITE_*` được nhúng lúc build: đổi URL thì phải deploy lại. Bản build không có `VITE_API_BASE_URL` không gọi localhost. Đăng nhập khi đó báo "chưa kết nối máy chủ xác thực (thiếu VITE_API_BASE_URL…)" và Live Demo báo mất luồng cập nhật.

## 11. Deploy frontend, đăng nhập và kiểm Live Demo

- [ ] Deploy trên Vercel. Mở `/login` trực tiếp để kiểm rewrite SPA.
- [ ] Trình duyệt riêng tư: đăng nhập bằng tài khoản giám khảo → `/people` → "Demo trực tiếp" → CareLens. Phải thấy dòng "Trạng thái hệ thống…" (agent kết nối, trạng thái hiệu chỉnh).
- [ ] DevTools → Network: `POST …/api/app/v1/session` 201, `POST …/stream-tickets` 201, `GET …/api/demo/stream?ticket=cls_…` 200 `text/event-stream`. Application → Storage: không có `clc_`/`cls_`.
- [ ] Thử xử lý cảnh báo bằng tài khoản giám khảo: bị từ chối (403).
- [ ] Mục kiểm hai trình duyệt cùng lúc ở 8.1.

## 12. Kiểm suy luận thật và luồng sự kiện

- [ ] `admin.py status`: `last_successful_inference`, `queue`, `failures_24h`, `storage`.
- [ ] Chưa có firmware thì không có dữ liệu thiết bị. Live Demo chỉ hiện dòng trạng thái hệ thống; như vậy là đúng, không phải lỗi. Đường thiết bị → suy luận → Live Demo đã kiểm cục bộ với harness (`docs/TEST_REPORT_2026-10-19.md`) và được kiểm lại với ESP32 ở mục 15.
- [ ] Không trỏ harness `tools/sample_device.py` vào production. Harness chỉ chấp nhận backend cục bộ, và production từ chối `simulated`.

## 13. Dung lượng và giám sát

Ước lượng theo cách tính của Cloudflare, **chưa đo trên firmware**. Chi tiết ở `backend/care-monitoring/README.md`, "Giới hạn free plan và sizing".

| Điều kiện | Hệ quả trên Workers/D1 Free |
| --- | --- |
| IMU 100 Hz **liên tục**, JSON | ≈ 360–1 100 MB/ngày/thiết bị (tùy cách firmware ghi số thực). D1 Free 500 MB đầy trong khoảng một ngày. Lô 10 s ≈ 8 640 lô/ngày ≈ 95 000 dòng ghi/ngày (ghi + chỉ mục + xóa theo hạn), sát hạn 100 000 dòng/ngày chỉ với một thiết bị |
| D1 đầy hoặc hết dòng ghi trong ngày | Mọi lệnh ghi thất bại, **kể cả cảnh báo**, tới khi có chỗ hoặc qua 00:00 UTC |
| Bảo vệ đã có | IMU thô bị từ chối rõ ràng (507 `imu_storage_budget_exceeded`) khi DB vượt `IMU_STORAGE_SOFT_LIMIT_MB` (400). Burst, kích hoạt, quyết định, cảnh báo, lệnh vẫn chạy. `admin.py status` → `storage.d1_size_bytes`, `storage.imu_ingest` |
| Chưa có bảo vệ | Hạn dòng ghi mỗi ngày: theo dõi trong dashboard D1 (Metrics → Rows written) |

- [ ] Trên Free: firmware chỉ gửi IMU quanh burst và kích hoạt, không gửi liên tục.
- [ ] Muốn IMU liên tục: chuyển Workers Paid (D1 10 GB/DB) hoặc giảm `IMU_RAW_RETENTION_HOURS`, sau khi đo lưu lượng thật (A33, D08).

## 14. Rollback

| Thành phần | Cách quay lại |
| --- | --- |
| Worker | `npx wrangler deployments list` → `npx wrangler rollback <version-id>` (chỉ code và config; không đổi dữ liệu D1/R2) |
| Dữ liệu D1 | D1 Time Travel: `npx wrangler d1 time-travel info care_monitoring`, `npx wrangler d1 time-travel restore care_monitoring --timestamp <RFC3339>` (ghi đè DB hiện tại; kiểm thời hạn lưu của gói) |
| Schema | Migration không có bản đảo; sửa bằng migration mới. Thử trước bằng `npm run db:migrate:local` |
| Frontend | Vercel → Deployments → bản trước → "Promote to Production" (Instant Rollback) |
| Tạm dừng nhanh | Xóa origin khỏi `ALLOWED_ORIGINS` rồi `npm run deploy` (web ngừng gọi được); `revoke-grant` / `login` cho tài khoản giám khảo; thu hồi token thiết bị và agent; `scripts\stop_agent.ps1` trên PC |
| Gỡ hẳn | `npx wrangler delete` (Worker), xóa bucket R2 và D1 trong dashboard — **không hoàn tác được** |

## 15. Hoãn tới giai đoạn firmware ESP32-S3

Không làm, không tuyên bố đã đạt trong đợt này:

- Firmware khớp `docs/DEVICE_API.md`; nhận ảnh thật và thứ tự thời gian.
- Lô MPU6050 thật: nhịp, đồng hồ boot/uptime, cách ghi số thực (quyết định dung lượng ở mục 13).
- Căn IMU–hình ảnh thật, hiệu chỉnh và quy tắc đã duyệt (D11). Trước đó không có cảnh báo nghi ngã.
- Loa I2S: phát và xác nhận âm thanh, còi.
- Độ trễ đầu-cuối thật, mất mạng, khởi động lại.
- Chốt hoặc sửa ADR-017, ADR-019, D10, D11, A30, A33 theo bằng chứng thiết bị.

## 16. Phát hành bảng điều khiển admin (Phase B + 0004 + 0005) và ADR-022/024 (0006 + 0007) — chờ owner duyệt từng bước

**Hiện trạng đã đo (2026-10-19, chỉ đọc):** `GET /ready` của Worker production **không có** `capabilities.admin_signin` và `GET /api/admin/v1/me` trả 404, tức Worker production chưa có Phase B. Việc secret `ADMIN_BOOTSTRAP_EMAILS` đã được đặt (owner báo) **chưa làm** đăng nhập admin chạy: cần cả migration và bản Worker mới. Trong lúc đó trang `/admin/login` sẽ báo "Máy chủ này chưa hỗ trợ đăng nhập quản trị" thay vì hiện nút không dùng được.

Không bước nào dưới đây đã được chạy. Mỗi bước cần owner đồng ý riêng. **Owner chưa duyệt** (2026-10-19: "không deploy Worker mới, không áp 0004/0005 lên production cho tới khi tôi duyệt rõ ràng").

**Lệch thứ tự đã xảy ra (đo chỉ đọc 2026-10-19):** frontend production đã có khu `/admin` (header A40, bundle chứa `voice-commands`, `admin/login`) vì Vercel tự deploy khi push `main`, trong khi Worker production chưa có route admin mới (`/api/admin/v1/me` → 404, `GET /api/admin/v1/devices` → 405). Giao diện báo "máy chủ chưa hỗ trợ đăng nhập quản trị", không hỏng. Bước 7 dưới đây vì vậy chỉ còn là kiểm lại frontend sau khi Worker mới lên.

### 16.1 Kiểm tương thích migration (diễn tập cục bộ 2026-10-19)

Script `wrangler d1 migrations apply --local` trên một D1 cục bộ (Miniflare) dựng đúng trạng thái production (0001–0003) và có dữ liệu tổng hợp (hồ sơ, thiết bị, nhắc lịch, OAuth state đang chờ), rồi áp 0004 + 0005:

| Kiểm | Kết quả |
| --- | --- |
| Áp 0004 + 0005 lên DB có dữ liệu | Đạt; `d1_migrations` có đủ 5 mục |
| Dữ liệu cũ | Giữ nguyên (đếm hàng trước/sau như nhau) |
| `oauth_states.purpose` của hàng cũ | `viewer` (giá trị mặc định) |
| `reminder_schedules.paused_at` của hàng cũ | `NULL` (đang chạy) |
| Bảng/chỉ mục mới | `admins`, `admin_sessions`, `admin_login_exchanges`, 4 chỉ mục mới |
| Lệnh INSERT kiểu Worker cũ (không có `purpose`) sau migration | Chạy, nhận `viewer` → **Worker cũ chạy được trên schema mới**, nên quay lại mã Worker không cần đảo migration |
| CHECK `purpose` với giá trị lạ | Bị từ chối |

Giới hạn: đây là SQLite cục bộ của Miniflare, không phải D1 production. Hành vi `ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT … CHECK` trên D1 thật chưa kiểm.

**Thứ tự bắt buộc và lý do:** migration trước Worker. Worker mới trên DB chưa có 0004/0005: route admin lỗi 500 (thiếu bảng `admins`), và bước nhắc lịch của cron lỗi `no such column: paused_at` mỗi phút — vì `runMaintenance` chạy tuần tự, lỗi này cũng chặn tạo job báo cáo ngày và dọn dữ liệu hết hạn chạy sau nó (`src/maintenance.ts`).

**Giới hạn quay lại:** mã Worker quay lại được bằng `wrangler rollback` (dữ liệu không đổi). Migration không có bản đảo; D1 Time Travel ghi đè **toàn bộ** DB về một thời điểm, mất mọi ghi sau đó (đăng nhập, audit, sự kiện). Secret (`ADMIN_BOOTSTRAP_EMAILS`) đổi riêng, có hiệu lực ngay.

**ADR-022 và ADR-024 (đã triển khai cục bộ 2026-10-19, chưa duyệt):** thêm `0006_command_receipts.sql` (3 cột `device_commands`) và `0007_device_speaker_volume.sql` (3 cột `devices`, có CHECK), cả hai chỉ cộng thêm, áp sau 0005 và trước Worker mới. Diễn tập cục bộ: mã Worker ở HEAD (trước thay đổi) chạy toàn bộ 254 test của nó trên schema 0001–0007 và đạt, nên Worker cũ chạy được trên schema mới. Worker mới trên schema thiếu 0006/0007 sẽ lỗi (thiếu cột `ack_deadline_at`, `speaker_volume`). Kế hoạch đầy đủ, rủi ro và giới hạn quay lại: `docs/PRODUCTION_ROLLOUT_READINESS.md`.

| # | Bước | Lệnh (PowerShell, từ `backend/care-monitoring/worker`) | Kỳ vọng | Quay lại |
| --- | --- | --- | --- | --- |
| 0 | Xem trước | `npx wrangler d1 migrations list care_monitoring --remote` | chờ áp: `0004_admin_auth.sql`, `0005_admin_ops.sql`, `0006_command_receipts.sql`, `0007_device_speaker_volume.sql` | — |
| 1 | Sao lưu mốc thời gian D1 | `npx wrangler d1 time-travel info care_monitoring` | in ra thời điểm khôi phục được; ghi lại | — |
| 2 | Kiểm secret (không in giá trị) | `npx wrangler secret list` | có `ADMIN_BOOTSTRAP_EMAILS`, `GOOGLE_CLIENT_SECRET`; **không** có `ADMIN_TOKEN_SHA256` | — |
| 3 | Áp migration **trước** Worker | `npm run db:migrate:remote` | `0004`–`0007` đạt. Cột `reminder_schedules.paused_at`, `device_commands.received_at/device_boot_id/ack_deadline_at`, `devices.speaker_volume`, bảng `admins`, `admin_sessions`, `admin_login_exchanges` tồn tại | Migration không có bản đảo: sửa bằng migration mới hoặc Time Travel (ghi đè DB) |
| 4 | Kiểm bundle | `npm run deploy:dry-run` | thành công, không đổi gì | — |
| 5 | Deploy Worker | `npm run deploy` | `GET /ready` → `"status":"ready"`, `admin_signin":"configured"`, `simulated_sources":"rejected"` | `npx wrangler rollback <version-id>` (mã, không phải dữ liệu) |
| 6 | Kiểm không đổi hành vi cũ | `curl.exe --tls-max 1.2 -s -i https://<worker>/api/admin/v1/me` | 401 (không còn 404) | — |
| 7 | Deploy frontend | đẩy lên `main` (Vercel tự build); **trước đó** xác nhận `connect-src` trong `frontend/vercel.json` đúng origin Worker | trang `/`, `/login` hoạt động; DevTools Console không có lỗi CSP | Vercel → Deployments → Promote bản trước |
| 8 | Đăng nhập admin thật, một lần | mở `/admin/login`, đăng nhập bằng Google của owner | `/admin` hiện đúng email và "Chủ sở hữu"; `GET /api/admin/v1/me` 200 | `DELETE /api/admin/v1/session` hoặc đổi `ADMIN_BOOTSTRAP_EMAILS` (thu hồi owner ngay) |
| 9 | Kiểm các trang chỉ đọc | Thiết bị, Báo cáo ngày, Agent, Nhật ký | sổ thiết bị phản ánh đúng DB; thiết bị chưa đăng ký thì "Chưa có thiết bị nào được đăng ký" | — |

Thứ tự bắt buộc: **migration → Worker → frontend**. Worker mới trên DB chưa có `paused_at` làm bước nhắc lịch của cron lỗi (`no such column`); frontend mới trên Worker cũ hiện "chưa có API này" ở các trang mới nhưng không hỏng.

Chỉ sau khi owner đồng ý riêng và có thiết bị thật:

| # | Bước | Ghi chú |
| --- | --- | --- |
| 10 | Cấp phát thiết bị đầu tiên | Dùng route cấp phát có sẵn (§8), **không** qua giao diện. Credential hiện một lần, đặt vào bộ nhớ an toàn của firmware; không đưa vào mã nguồn chung |
| 11 | Gửi một lệnh âm thanh thử | Chỉ khi firmware đã nạp và trả lời được `commands/next`. Kết luận "đã phát" chỉ khi thiết bị tự báo `completed` |
| 12 | Một nhắc lịch thử | Chọn giờ cách vài phút. Bằng chứng cron chạy: xuất hiện lệnh `reminder` cho lần hẹn đó; không có lệnh nghĩa là cron chưa chạy hoặc thiết bị bị coi là ngoại tuyến quá hạn |

**Đã kiểm cục bộ, không thay cho các bước trên:** test Worker trong runtime Workers (309 sau ADR-022/024), `deploy:dry-run`, test giao diện và Playwright với Worker giả, và (2026-10-19) firmware ESP32-S3 thật qua HTTPS với backend cục bộ (`docs/E2E_TEST_RESULTS.md`). Chưa có bằng chứng nào từ Google thật, D1 production hay cron production. Bước 10–11 với firmware tích hợp: `firmware/carelens-esp32s3/README.md` (nạp `api` = URL Worker, không nạp `ca` để dùng bộ chứng chỉ ESP-IDF).
