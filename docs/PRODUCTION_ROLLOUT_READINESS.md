# Triển khai production có kiểm soát — 2026-10-20

Owner cho phép triển khai production theo từng cổng (yêu cầu ngày 2026-10-20). Tài liệu này ghi lệnh đã chạy, tài nguyên bị đổi, bằng chứng, rủi ro và cách quay lại của từng cổng. Bản kế hoạch trước (2026-10-19, chỉ đọc) đã được thay bằng nhật ký này; khác biệt cục bộ/production cũ nằm ở mục 9.

## 1. Trạng thái các cổng

| Cổng | Nội dung | Trạng thái | Bằng chứng chính |
| --- | --- | --- | --- |
| 1 | Kiểm tra trước, chuẩn bị khôi phục | **Xong** | Schema production trùng bản dựng 0001–0003 (60 đối tượng); diễn tập 0004–0007; mã Worker đang chạy qua 210/210 test của nó trên schema mới |
| 2 | Migration D1 | **Xong** 2026-10-20 00:56–00:57 UTC | 0004→0007 áp từng file; sau mỗi bước schema trùng bản tham chiếu; dữ liệu cũ giữ nguyên |
| 3 | Deploy Worker | **Xong** 00:59 UTC, bản `d0820d7f-6909-4366-96c9-54d1072a3543` | `/ready` có `admin_signin: configured`; mọi route admin/thiết bị/agent từ chối khi thiếu hoặc sai token; cron chạy mã mới không lỗi |
| 4 | Deploy frontend | **Xong** 01:04 UTC, `dpl_EVQCjwGi5qRBuoQxUwc53wNdNGhk` | Bundle công khai trùng byte bản build cục bộ; 6/6 header bảo mật; Chromium: 0 lỗi console, chặn trang khi chưa đăng nhập |
| 5 | Credential production cho ESP32 và agent | **Xong** 01:23 UTC | Lần kiểm đầu thiếu tệp token và secret → dừng. Owner tạo xong: tệp có, `ADMIN_TOKEN_SHA256` có (bản `9692741c` = đổi secret trên mã `d0820d7f`), `GET /api/admin/v1/me` bằng token trong tệp → 200 `static_token`. Cấp `esp32s3-chest-01` (`rcp-showcase`) và `agt_f7b92286d0c344f0b7b10fd76d0551e8`; dùng chéo token → 401 ở cả 6 phép thử |
| 6 | Đầu-cuối online với thiết bị thật | **Đạt cho các luồng đã thử, trong hai khung giờ có hạn** (01:26–02:06 và 04:01–04:06 UTC; thiết bị đã về cục bộ) | Heartbeat, burst thật → agent → Vision → kết quả, xóa ảnh, IMU liên tục, agent tắt rồi bật, Wi-Fi rớt 20 s (mục 6b). Đăng nhập admin owner và từ chối tài khoản khác. Lời nhắn MP3 owner tải lên từ dashboard → thiết bị phát xong 3/3 lần, owner nghe thấy (mục 6c). Chưa thử trên production: báo cáo ngày qua LLM, cảnh báo (tắt theo thiết kế) |

Phạm vi của chữ "đạt" ở cổng 6: hai luồng thật đã chạy trên production với thiết bị thật (ảnh → Vision → sự kiện; dashboard → lệnh âm thanh → loa). Thiết bị **không** nối production thường trực (gói D1, mục 8). Kết quả AI chưa được kiểm chứng độ đúng (mục 8).

## 2. Cổng 1 — kiểm tra trước (chỉ đọc)

| Mục | Lệnh (PowerShell, `backend/care-monitoring/worker`) | Kết quả |
| --- | --- | --- |
| Git | `git rev-parse HEAD`, `git status` | HEAD `d76a45e` = `origin/main`; 44 mục chưa commit (giữ nguyên, không commit) |
| Tài khoản | `npx wrangler whoami` | OAuth `hungleduc2005@gmail.com`, account `abefdbbcb86182b9117ff5d50f1e841c`, quyền `d1 (write)`, `workers (write)` |
| Worker đang chạy | `npx wrangler deployments list` | Bản `f64e2003-e3ff-40f0-b91d-86502fbe5597` (đổi secret 2026-10-19 10:46 UTC) trên mã `b2e7726f` (08:25 UTC ≈ commit `d4a80c9`) |
| Migration | `npx wrangler d1 migrations list care_monitoring --remote` + `SELECT … FROM d1_migrations` | Đã áp 0001–0003; chờ 0004–0007 |
| Schema thật | `SELECT type,name,sql FROM sqlite_master` (remote) so với D1 cục bộ dựng từ 0001–0003 | 60/60 đối tượng, SQL giống hệt (đã chuẩn hóa khoảng trắng) |
| Dữ liệu | `SELECT COUNT(*)` từng bảng (không đọc nội dung) | 1 hồ sơ `rcp-showcase`, 0 thiết bị, 0 agent, 5 người xem Google, 5 grant, 34 dòng audit, 0 sự kiện/ảnh/IMU/lệnh |
| D1 | `npx wrangler d1 info care_monitoring` | 479 kB, APAC, 1 746 dòng ghi/24 h |
| Time Travel | `npx wrangler d1 time-travel info care_monitoring` | Bookmark trước migration: `00000007-00000006-0000510a-41b3cc37e5a442a3aec11c38195e6ffa` (00:56:08 UTC) |
| Secret (chỉ tên) | `npx wrangler secret list` | `ADMIN_BOOTSTRAP_EMAILS`, `GOOGLE_CLIENT_SECRET`, và **một secret đặt nhầm tên** (mục 8, S-3); không có `ADMIN_TOKEN_SHA256` |
| R2 | `r2 bucket list`, `dev-url get`, `domain list`, `lifecycle list` | Hai bucket, r2.dev tắt, không custom domain; `carelens-capture-media` xóa sau 1 ngày; `carelens-voice-audio` không có hạn xóa (D08) |
| Vercel | `vercel whoami`, `vercel ls --prod`, `vercel env ls`, `vercel api /v9/projects/carelens-ai` | User `biocuatoe`, team `dayone7`; production `dpl_A4sYrXSycM3PXXgeE6QhzYXDzEtD` từ git `d76a45e`; biến duy nhất `VITE_API_BASE_URL` (Production); Root Directory `frontend`; bảo vệ SSO cho URL deployment |
| OAuth | `GET /api/app/v1/auth/google/config`, `wrangler.jsonc` | Google bật, chế độ người xem mở; admin dùng cùng redirect URI (`google.ts`, `ADMIN_POST_LOGIN_PATH`), không cần sửa Google Console |
| Agent → production | Python của agent, `ssl.create_default_context()` | `certificate has expired` (gốc `ISRG Root X2` hết hạn trong kho Windows). Thêm bộ gốc Mozilla của `certifi` (biến `SSL_CERT_FILE`) → bắt tay và xác minh đạt, xác minh vẫn bật |
| Công cụ cấp phát | `admin.py` với token sai | Cloudflare chặn User-Agent mặc định của urllib (403, mã 1010). Đã sửa `admin.py` gửi `User-Agent: carelens-admin-cli/1`; sau sửa nhận đúng 401 `invalid_credential` |

Diễn tập (D1 cục bộ dựng giống production, có dữ liệu tổng hợp): `wrangler d1 migrations apply --local` áp 0004–0007; hàng cũ nhận `purpose='viewer'`, `paused_at`, `received_at`, `speaker_volume` = `NULL`; CHECK từ chối `speaker_volume=0.9` và `purpose='root'`. Mã Worker `d4a80c9` (gần nhất với bản đang chạy) chạy 210/210 test của nó trên schema 0001–0007, nên quay lại mã Worker không cần đảo migration.

Bản sao mã nguồn được deploy (chưa commit) lưu ngoài repo: `D:\AI\Cache\carelens-rollout\20261020\` (`working-tree.patch` sha256 `8eebb2ad…e7bc`, `untracked.tar` sha256 `0ae529ec…aa5d`, trên HEAD `d76a45e`).

## 3. Cổng 2 — migration D1 production

Mỗi bước dùng một cấu hình tạm (ngoài repo) có thư mục migration chứa đúng các file 0001…N, sao chép từng byte từ repo (so hash), nên `migrations apply` chỉ áp một file và ghi đúng tên của repo:

```powershell
npx wrangler d1 migrations apply care_monitoring --remote -c wrangler.step<N>.jsonc
```

| File | Áp lúc (UTC) | Lệnh SQL | Kiểm sau bước |
| --- | --- | --- | --- |
| `0004_admin_auth.sql` | 00:56:13 | 6 | Schema = bản tham chiếu 0004 (64 đối tượng); `/health` 200, `/ready` ready (Worker cũ) |
| `0005_admin_ops.sql` | 00:56:49 | 5 | = tham chiếu 0005 (67); Worker cũ khỏe |
| `0006_command_receipts.sql` | 00:57:13 | 5 | = tham chiếu 0006 (68); Worker cũ khỏe |
| `0007_device_speaker_volume.sql` | 00:57:38 | 4 | = tham chiếu 0007 (68); Worker cũ khỏe |

Sau cổng: `migrations list --remote` với cấu hình repo → "No migrations to apply"; đếm hàng không đổi (34 audit, 5 người xem, 5 grant, 1 hồ sơ); hàng `oauth_states` cũ nhận `viewer`; `admins` rỗng.

## 4. Cổng 3 — Worker

| Bước | Lệnh | Kết quả |
| --- | --- | --- |
| Kiểm mã | `npm run typecheck`; `npx vitest run`; `npm run deploy:dry-run` | sạch; 309/309; bundle 1 110 KiB, binding đúng (`FUSION_POLICY_JSON` rỗng, `ACCEPT_SIMULATED_SOURCES=false`, `PASSWORD_SIGN_IN=disabled`) |
| Deploy | `npm run deploy` (00:59:02–00:59:10 UTC) | Bản `d0820d7f-6909-4366-96c9-54d1072a3543`, cron `* * * * *` và `15 17 * * *` |
| Sẵn sàng | `GET /ready` | `ready`, D1 ok, 2 bucket + Durable Object bound, `admin_signin: configured`, `admin_api: not_configured` (không có token tĩnh), `alerts: none_until_both_rules_are_approved`, `simulated_sources: rejected` |
| Xác thực từ chối | `/api/admin/v1/me`, `/devices`, `PUT …/speaker-volume`, `/api/device/v1/heartbeat`, `/commands/next`, `/api/agent/v1/jobs/claim`, không token và token giả | tất cả 401 `invalid_credential` |
| Đăng nhập admin | `GET /api/app/v1/auth/google/start?mode=admin` (không theo redirect) | 302 tới `accounts.google.com`, đúng client ID, đúng redirect URI, scope `openid email`, PKCE S256, có `state` |
| CORS | preflight `POST /api/admin/v1/session/exchange` | Origin Vercel → 204 + đúng origin; origin lạ → 403 |
| Cron | `npx wrangler tail care-monitoring --format json` | Lần chạy trên `d0820d7f` kết thúc `ok`: `expired_uploads, media_deleted, finalized_vision_jobs, decisions_made, reminders_queued, report_jobs_created, imu_batches_purged` đều 0, `stream_tickets_purged` 1; không lỗi `no such column` |

Chưa kiểm được ở cổng này (cần credential, làm ở cổng 6): luồng việc của agent, ghi/đọc R2, chuyển trạng thái lệnh.

## 5. Cổng 4 — frontend

Không commit/push nên không dùng đường tự deploy từ GitHub. Bản production được build cục bộ từ cây làm việc và tải lên dạng **prebuilt**: chỉ tệp tĩnh, không tải mã nguồn hay `.env`.

| Bước | Lệnh | Kết quả |
| --- | --- | --- |
| Build | `npm run build` trong `frontend` với `VITE_API_BASE_URL=https://care-monitoring.care-monitoring-worker.workers.dev` (không có biến `VITE_*` nào khác, không có `.env` trong `frontend`) | 33 tệp; bundle chứa đúng 1 URL Worker, không `localhost`, không chuỗi giống token/secret |
| Đóng gói | script tạo `.vercel/output` (Build Output API v3) từ `frontend/dist` và `frontend/vercel.json`: khối header áp mọi đường dẫn trước filesystem, rewrite SPA sau filesystem | `.vercel/` bị git bỏ qua |
| Deploy chờ | `vercel deploy --prebuilt --prod --skip-domain --yes` | `dpl_EVQCjwGi5qRBuoQxUwc53wNdNGhk`, READY; API liệt kê 34 tệp, không tệp nào ngoài `.vercel/output` |
| Lên domain | `vercel promote dpl_EVQCjwGi5qRBuoQxUwc53wNdNGhk --yes` (01:04:51 UTC) | `carelens-ai-eta.vercel.app` phục vụ `index-BvkDoA3Z.js`, sha256 trùng bản build |
| Header | `curl` `/`, `/login`, `/admin/login`, `/admin/devices`, asset, đường dẫn lạ | 200; 6/6 header (CSP, nosniff, DENY, no-referrer, Permissions-Policy, HSTS); `connect-src` chỉ `'self'` + Worker |
| Trình duyệt | Chromium (Playwright), không đăng nhập | `/login` và `/admin/login` có nút Google (không còn "máy chủ chưa hỗ trợ"); `/admin/devices` → `/admin/login`; `/people` → `/login`; web storage rỗng; 0 lỗi console (không vi phạm CSP); 0 request lỗi |

Chưa kiểm: đăng nhập Google thật (người xem và admin) và trang dashboard sau đăng nhập. Cần owner (mục 6).

Lưu ý: production frontend giờ chạy mã **chưa commit**. Lần push `main` tiếp theo sẽ tự deploy bản trong git; nếu bản đó thiếu thay đổi này thì frontend lùi lại (Worker không lùi theo).

## 6. Cổng 5 — việc owner cần làm

Dashboard không có giao diện cấp thiết bị/agent; route cấp phát chỉ nhận phiên admin (Google, chỉ nằm trong bộ nhớ trình duyệt) hoặc token tĩnh `ADMIN_TOKEN_SHA256`. Theo runbook §6/§8, owner tạo token tĩnh; Claude không tạo secret production.

Owner chạy trong PowerShell (từ `D:\CARELENS-AI`):

```powershell
python backend\care-monitoring\scripts\make_admin_token.py --out D:\AI\Cache\carelens-device\admin-token.txt
cd backend\care-monitoring\worker
npx wrangler secret put ADMIN_TOKEN_SHA256     # dán chuỗi 64 ký tự sau "ADMIN_TOKEN_SHA256=" ở dòng nhắc ẩn
```

Trước khi cấp phát, Claude kiểm lại (không in giá trị): tệp token tồn tại; `wrangler secret list` có `ADMIN_TOKEN_SHA256`; `deployments list` vẫn là mã `d0820d7f` (đặt secret tạo một phiên bản mới trên cùng mã); và **phép thử khớp** `GET /api/admin/v1/me` bằng token trong tệp phải trả 200 `{"auth_method":"static_token"}` (chỉ đọc, không ghi gì). Thiếu một điều kiện thì dừng, không tự xoay token.

Sau đó Claude chạy `admin.py` (đã sửa) qua script cấp phát: token thiết bị (`cld_`) vào `D:\AI\Cache\carelens-device\secrets.production.json`, token agent (`cla_`) vào `D:\AI\Cache\carelens-device\agent.production.env`, không in ra. Admin token chỉ dùng cho hai lệnh cấp phát này; thiết bị và agent mỗi bên có credential riêng, quyền tối thiểu. Xong cấp phát, owner gỡ token tĩnh: `npx wrangler secret delete ADMIN_TOKEN_SHA256` và xóa `admin-token.txt`.

Quyết định của owner (2026-10-20): gói Cloudflare "không rõ / Free" → thiết bị chỉ nối production trong lúc thử (khoảng 1 giờ), sau đó trả về backend cục bộ.

## 6b. Cổng 5–6 — bằng chứng production (2026-10-20)

| Mục | Bằng chứng (production, chỉ đọc trừ khi ghi khác) |
| --- | --- |
| Cấp phát | `provision_production.py` gọi `admin.py device/agent`; token `cld_`/`cla_` ghi thẳng vào `D:\AI\Cache\carelens-device\secrets.production.json` và `agent.production.env` (độ dài 47, không in). D1 chỉ giữ SHA-256; audit `device.create`, `agent.create` |
| Agent production | `check_agent.ps1 -EnvFile …agent.production.env`: backend ready, **credential accepted**, Vision ok (3 nhánh ngã, uống nước), Ollama có model. TLS dùng thêm gốc Mozilla qua `SSL_CERT_FILE`, xác minh bật |
| Thiết bị lên production | `provision.py --secrets secrets.production.json --keys api,device,token,ca` (Wi-Fi giữ nguyên; `ca` rỗng → bộ chứng chỉ ESP-IDF). Boot `b-6ecc90fdbd15`, SNTP, heartbeat `ok` mỗi 60 s, 0 lỗi truyền, 0 lần khởi động lại trong 15 phút ghi log |
| Ảnh → agent → Vision → kết quả | `cap-b-6ecc90fdbd15-n1`: 24/24 khung, nhịp `ok` → `job_ad603eac…` hoàn tất lần 1 → `evt_a438b190…` (`fall_check`, −0,371, `uncalibrated_output`, `unverified`) + `evt_6a552128…` (`drink_check`, `none_observed`, `unverified`), không cảnh báo. Ảnh xóa 0,65 s sau suy luận; bucket media 0 đối tượng |
| Dashboard | `GET /api/admin/v1/devices/esp32s3-chest-01` (token tĩnh, chỉ đọc): `connected: true`, âm lượng báo 0,70, lần chụp và sự kiện cuối, `has_simulated_records_7d: false`; owner xác nhận trang Thiết bị hiện "đang kết nối" |
| Agent tắt | Agent dừng → burst `cap-b-6ecc90fdbd15-n2` `uploaded`, job `queued` không lease, ảnh hết hạn lúc 02:18:20 → bật lại agent → hoàn tất sau 4 s, ảnh xóa 02:04:17 |
| Wi-Fi rớt 20 s (`wifidrop 20`) | Kết nối lại sau 1,5 s, heartbeat `ok`; IMU 214 lô `batch_seq` 0–213 liền, **0 khoảng trống** |
| Đăng nhập admin | Lần đầu owner dùng `/login` (lối người xem) → vào hồ sơ trình diễn; audit chỉ có `session.google_login`, không có `admin.google_login`. Sửa: thêm liên kết "Đăng nhập quản trị" ở `/login` → `/admin/login` (frontend `dpl_AkBEGSdBiPwveMLPDZerx19uCVNw`). Sau đó: `admin.google_login` **success** `role: owner` (01:48:36); tài khoản khác **denied** `not_allowlisted` (01:48:28); `admins` có đúng 1 hàng, email khớp `hungleduc2005@gmail.com` |
| Dung lượng | 107 lô IMU = 2,66 MB (24,8 KB/lô); D1 479 kB → 3,33 MB trong khoảng 20 phút |

## 6c. Âm thanh MP3 trên production (ADR-025, 2026-10-20)

Owner không tải được WAV (tệp quá lớn, yêu cầu mono) nên yêu cầu chuyển cả đường âm thanh sang MP3 (ADR-025, Proposed). Không cần migration: `bits_per_sample` lưu 0 cho MP3, cột cũ giữ nguyên. Firmware 0.2.0 vẫn phát WAV cũ đã lưu.

| Bước | Lệnh / thao tác | Kết quả |
| --- | --- | --- |
| Kiểm mã | `npx vitest run` (02:35 UTC, sau lần sửa mã Worker cuối 02:28); ngay trước deploy: `npm run typecheck`, `npm run contracts:check`, `npm run deploy:dry-run` | 319/319; typecheck sạch; "contracts up to date"; bundle 1 115 KiB (gzip 205 KiB) |
| Deploy Worker | `npm run deploy` (03:36:35 UTC) | Bản `934bcb18-29d6-42a9-8f6c-b08753500e1b` (100%) |
| Kiểm Worker | `prod_mp3_checks.py` (token tĩnh, chỉ đọc trừ phép thử từ chối) | `/ready` ready; capabilities `audio/mpeg`, `mp3`, 9 tần số 8–48 kHz, 1–2 kênh, ≤ 2 000 000 B, ≤ 60 s, `device_requirement: audio_codecs_reports_mp3`; tải WAV → **415 `mp3_required`**, không lưu gì |
| Deploy frontend | build như cổng 4, `vercel deploy --prebuilt --prod --skip-domain`, `vercel promote` (03:59:58 UTC) | `dpl_AvuBn88Rkgb2FLNUsXyE9XztYVmu`, domain phục vụ `index-C7DwLaaU.js` |
| Thiết bị lên production | `provision.py --secrets secrets.production.json --keys api,device,token,ca` | Boot `b-c6dfc797f866`, lời chào MP3 phát xong; heartbeat 04:01:03 có `audio_codecs: ["pcm_s16le","mp3"]`, âm lượng báo 0,70 |
| Owner tải lên | Dashboard → Lời nhắn thoại, tệp MP3 của owner | `vm_78d75cf6e7424114a09aa736b093177d`: 24 kHz, 2 kênh, 160 kbps, 122 400 B, sha256 `0946637c…6111` |
| Phát 3 lần | Owner bấm gửi từ dashboard | `cmd_94cc7c5733f94b81b32ca02e3fbbf7e3`, `cmd_f24f255ea2ef420486697b201af81138`, `cmd_ca1be7472d8649db8f6ae5be9056e10d`: mỗi lệnh đủ `queued → delivered → received → accepted → started → completed` (bốn bước cuối do thiết bị báo); firmware ghi 146 880 khung/lần, phát 6,2–6,3 s. Owner: "Loa phát, báo đã phát xong" |
| Trả thiết bị về cục bộ | `provision.py --keys api,device,token,ca` (04:06:39 UTC) | Boot `b-93c67c7478ff` báo về backend cục bộ lúc 04:06:45; production nhận heartbeat cuối 04:06:05 |

Đếm trên D1 production sau thử (chỉ đọc): 1 phiên bản âm thanh (MP3), 3 lệnh `play_voice_message` `completed`.

## 7. Khôi phục

| Thành phần | Quay lại | Giới hạn |
| --- | --- | --- |
| Worker (bỏ MP3) | `npx wrangler rollback 9692741c-c6af-449b-8ccc-63593d2fc53c` (mã `d0820d7f`, đường WAV) | Tải lên lại đòi WAV; thiết bị 0.2.0 vẫn phát WAV. Bản ghi MP3 đã lưu sẽ không phát được trên mã cũ |
| Worker (trước triển khai) | `npx wrangler rollback f64e2003-e3ff-40f0-b91d-86502fbe5597` | Chỉ mã và cấu hình. Mã cũ chạy được trên schema mới (210/210) |
| Schema D1 | Không có bản đảo; giữ schema (chỉ cộng thêm). Sửa bằng migration mới | — |
| Dữ liệu D1 | `npx wrangler d1 time-travel restore care_monitoring --bookmark=00000007-00000006-0000510a-41b3cc37e5a442a3aec11c38195e6ffa` | Ghi đè **toàn bộ** DB, mất mọi ghi sau 00:56 UTC (đăng nhập, audit, dữ liệu thiết bị). Chỉ khi hỏng dữ liệu |
| Frontend (bỏ MP3) | `vercel promote dpl_AkBEGSdBiPwveMLPDZerx19uCVNw --yes` | Tức thì; chỉ khớp với Worker WAV |
| Frontend (trước triển khai) | `vercel promote dpl_A4sYrXSycM3PXXgeE6QhzYXDzEtD --yes` (bản git `d76a45e`) | Tức thì |
| Thiết bị | `python firmware\carelens-esp32s3\tools\provision.py --keys api,device,token,ca` (mặc định đọc `secrets.local.json`) → về backend cục bộ | Cần cáp COM6 |
| Credential | `POST /api/admin/v1/devices/{id}/revoke`, `/agents/{id}/revoke` | Có hiệu lực ngay |

## 8. Rủi ro và phát hiện còn mở

- **S-3 (mới, cần owner):** danh sách secret của Worker có một secret mà **tên** của nó trông như giá trị Client secret của Google (tiền tố `GOCSPX-`), có lẽ do gõ `wrangler secret put <giá trị>`. Tên secret hiện trong dashboard Cloudflare và trong đầu ra `wrangler secret list` của phiên này. Coi như đã lộ: owner tạo Client secret mới ở Google Cloud Console, `npx wrangler secret put GOOGLE_CLIENT_SECRET`, kiểm đăng nhập Google, vô hiệu secret cũ ở Console, rồi xóa secret đặt nhầm tên trong dashboard Cloudflare (Workers → care-monitoring → Settings → Variables and Secrets).
- **Dung lượng D1:** firmware gửi IMU liên tục (lô 10 s, 50 Hz). Đo trên D1 cục bộ: 24,3 KB/lô → ≈ 210 MB/ngày, ≈ 8 640 lô/ngày; mỗi lô ≈ 5 dòng ghi (hàng + 4 chỉ mục) và ≈ 5 khi xóa theo hạn → ≈ 86 000 dòng/ngày chỉ riêng IMU. Gói D1 Free (100 000 dòng ghi/ngày, 500 MB) sẽ cạn trong khoảng một ngày và khi đó **mọi lệnh ghi lỗi**, kể cả đăng nhập. Chưa biết tài khoản là Free hay Paid (không đọc được bằng lệnh chỉ đọc).
- Mô hình ngã và uống nước chưa hiệu chỉnh cho camera đeo ngực; Vision báo "có cốc" ở 24/24 khung một bức tường trống (`docs/E2E_TEST_RESULTS.md`). `FUSION_POLICY_JSON` rỗng: không có cảnh báo nghi ngã. Kết quả uống nước chỉ là quan sát AI chưa xác nhận, không tạo cảnh báo, không phải xác nhận uống thuốc.
- IMU là chip báo `0x70` (D16); luật kích hoạt firmware chưa hiệu chỉnh. XCLK 20 MHz chưa đo nhiệt (A41).
- NVS không mã hóa: ai cầm bo đọc được Wi-Fi và token thiết bị (ADR-023).
- `rcp-showcase` mở cho mọi tài khoản Google đã xác minh (A38): thiết bị gán vào đây chỉ được dùng cho thử nghiệm không có người thật (camera hướng vào tường trống). Khi đeo cho người thật phải chuyển sang hồ sơ khác.
- Lời nhắn thoại trong R2 `carelens-voice-audio` không có hạn xóa (D08). Tệp MP3 "test" owner tải lên nằm ở `rcp-showcase`, nên mọi tài khoản Google người xem đều nghe được; owner xóa nếu là giọng hay nội dung riêng.
- `ADMIN_TOKEN_SHA256` vẫn đặt trên Worker (dùng cho kiểm tra chỉ đọc và cấp phát); owner gỡ khi xong (mục 6).
- Worker `934bcb18` và frontend `dpl_AvuBn88R…` chạy mã **chưa commit** (bản sao cây làm việc lúc triển khai cổng 1–4 ở `D:\AI\Cache\carelens-rollout\20261020\`; thay đổi MP3 sau đó chỉ có trong cây làm việc).
- Token Telegram cũ trong lịch sử git đã push (S-2): owner thu hồi.

## 9. Bối cảnh trước triển khai (2026-10-19)

Toàn bộ luồng đầu-cuối đã chạy với thiết bị thật trên backend cục bộ (`docs/E2E_TEST_RESULTS.md`). Tương thích đã kiểm trước khi triển khai: firmware mới với Worker cũ chạy được (mất tính năng mới); frontend mới với Worker cũ không hỏng; frontend cũ với Worker mới không hỏng; Worker mới trên schema thiếu 0006/0007 hỏng (vì vậy migration đi trước Worker).
