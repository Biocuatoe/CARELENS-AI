# AGENTS.md

Điểm vào bắt buộc cho mọi coding agent (Claude Code, Codex, Cursor…) và lập trình viên mới. Đọc hết file này trước khi sửa bất cứ thứ gì. Claude Code nạp file này qua `CLAUDE.md`.

## 1. Dự án

**CareLens AI** là hệ thống giám sát chăm sóc người cao tuổi dùng thật (không phải demo), lấy **người được chăm sóc** (`care_recipient`) làm trung tâm, có nhiều người chăm sóc và một trung tâm cảnh báo. Frontend hiện có vẫn gồm UI của CareLens và EcoPatch; **backend EcoPatch đã ngừng** (ADR-015, Proposed).

| Sản phẩm | Bản chất | Dữ liệu được phép vào backend |
| --- | --- | --- |
| CareLens | **Yêu cầu PRD:** camera ESP32-S3 + AI chạy local, không cloud. **Hiện có:** Module 1 là gói nhận diện cục bộ (kiểm tra ngã R3D-18, uống nước/thuốc YOLO11n), Module 2 là LLM cục bộ tóm tắt theo ngày | D1 và API người chăm sóc: kết quả nhận diện dạng số và nhãn, dữ liệu IMU thô, sự kiện, cảnh báo, báo cáo văn bản. Frame JPEG chỉ đi qua API upload thiết bị vào R2 riêng tư **tạm thời** cho agent cục bộ, xóa sau suy luận hoặc tối đa 15 phút (D10, Proposed) |
| EcoPatch | Miếng dán sinh học, BLE → gateway | Backend đã ngừng. Chỉ còn UI trong frontend (ngoài phạm vi sửa) |

**Hiện trạng (2026-10-19):**

- `frontend/`: landing và UI S01–S14 chạy trên adapter mô phỏng (`docs/UI_IMPLEMENTATION_STATUS.md`); đăng nhập và app dùng bảng màu landing (A35); riêng Live Demo nối backend (xem dưới).
- `backend/care-monitoring/worker/` **(đã kiểm chứng bằng test cục bộ, chưa deploy)**: Cloudflare Worker + D1 + R2 + Durable Object (ADR-016, Proposed). Hợp đồng thiết bị v2 (ADR-019: đồng hồ boot/uptime, burst theo phiên/chunk, lô IMU thô, kích hoạt, heartbeat), hàng đợi job bền cho agent, hợp nhất IMU thô–hình ảnh `fusion-rules.v2` (ADR-017), cảnh báo tạm thời độc lập với LLM, lệnh thiết bị có xác nhận đủ vòng đời (còi, nhắc thuốc/nước, lời nhắn thoại), báo cáo ngày, API người chăm sóc có bearer token và grant, đăng nhập web bằng thông tin owner cấp + vé stream (ADR-018), adapter `/api/demo/*` cho Live Demo.
- `integrations/carelens/local-agent/` **(đã kiểm chứng 2026-10-19 với gói mô hình thật và Qwen thật, qua `wrangler dev` cục bộ)**: agent Python thư viện chuẩn trên PC, kéo việc qua HTTPS đi ra, gọi Vision API `127.0.0.1:8080` và Ollama. `tools/sample_device.py` là harness thiết bị chỉ dùng cho test.
- `frontend/` Live Demo **đã nối backend thật** qua biểu mẫu đăng nhập (đã kiểm bằng Chromium với backend cục bộ). Từ 2026-10-19 (A35) giao diện chỉ còn **một tài khoản Live Demo dùng chung**: không còn chọn người dùng mô phỏng, tạo hồ sơ hay trang vận hành; đăng nhập vào thẳng tổng quan hồ sơ do máy chủ cấp quyền xem. Landing, đăng nhập và app dùng chung bảng màu landing. Persona mô phỏng của `DemoAdapter` chỉ còn cho unit test. Lớp dữ liệu: `src/data/demo/demoAdapter.ts` (A34); `vercel.json` (rewrite SPA). Giám khảo dùng chung một tài khoản chỉ xem (`docs/DEPLOYMENT_RUNBOOK.md` §8.1).
- Module 1 và Module 2 cài ngoài repo tại `D:\AI`. Gói Module 1 **chưa hiệu chỉnh trên thiết bị** và chưa có quy tắc IMU đã duyệt: mặc định **không tạo cảnh báo nghi ngã** (D11).
- **Chưa có:** deploy Cloudflare/Vercel (cần tài khoản, D1, R2, secret), firmware ESP32 và kiểm thử trên thiết bị thật, adapter `http` đầy đủ cho các màn hình khác, `backend/api` FastAPI/PostgreSQL theo ADR-002. Báo cáo kiểm thử: `docs/TEST_REPORT_2026-10-19.md`; runbook: `docs/DEPLOYMENT_RUNBOOK.md`.

## 2. Nguồn sự thật

Khi tài liệu mâu thuẫn, mục trên thắng mục dưới. Ghi mâu thuẫn vào `docs/DECISIONS.md`, không tự chọn im lặng.

| # | Tài liệu | Dùng cho |
| --- | --- | --- |
| 1 | Yêu cầu mới nhất của người dùng trong phiên | Mọi thứ |
| 2 | `docs/DECISIONS.md` (chỉ mục **Accepted**) | Quyết định đã chốt |
| 3 | `docs/IMPLEMENTATION_PLAN.md` (v1.2+) | Nghiệp vụ, dữ liệu, quyền, mốc M0–M5, nghiệm thu AC01–AC18 |
| 4 | `docs/CARELENS_ECOPATCH_SYSTEM_UI_PROMPT.md` | 14 nhóm màn hình app S01–S14, state matrix |
| 5 | `docs/CARELENS_ECOPATCH_LANDING_PROMPT.md` | Landing page, copy tiếng Việt |
| 6 | `docs/ARCHITECTURE.md` | Kiến trúc kỹ thuật, cấu trúc code |
| 7 | `Carelens/*.docx`, `EcoPatch/*.docx` | PRD nháp: chỉ là **yêu cầu PRD**, không phải năng lực đã kiểm chứng |

PRD là file `.docx`. Trích văn bản để đọc (PowerShell):

```powershell
Add-Type -A System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead("EcoPatch/PRD_EcoPatch_EN.docx"); $r=New-Object IO.StreamReader($z.GetEntry("word/document.xml").Open()); ($r.ReadToEnd() -replace '</w:p>',"`n" -replace '<[^>]+>',''); $z.Dispose()
```

Luôn phân biệt ba trạng thái khi viết code, comment, tài liệu, báo cáo: **Yêu cầu PRD** · **Đề xuất trong tài liệu** · **Đã kiểm chứng** (kèm bằng chứng: lệnh, test, thiết bị).

## 3. Kiến trúc tóm tắt

Chi tiết ở `docs/ARCHITECTURE.md`. Trạng thái: **Accepted** (ADR-002…ADR-010, người dùng duyệt 2026-09-14). Riêng chữ trắng trên nút primary trong ADR-009 còn Open.

- Đích ban đầu (ADR-002, Accepted): `frontend/` (React + TypeScript + Vite SPA, Tailwind v4) · `backend/api/` (FastAPI + SQLAlchemy 2 + Alembic) · PostgreSQL · worker Python đọc outbox. **Đề xuất thay cho CareLens (ADR-016, Proposed):** Cloudflare Worker `care-monitoring` (TypeScript) + D1 + R2 + Durable Object, chi tiết `docs/ARCHITECTURE.md` §6.7 và `docs/API_CONTRACT.md`.
- ESP32 → `/api/device/v1/*` (token thiết bị) → R2 tạm thời + job trong D1 → Local AI Agent trên PC kéo job qua HTTPS đi ra → Vision API và Ollama cục bộ → `/api/agent/v1/jobs/{id}/complete`. Hồ sơ đích lấy từ credential, không từ payload. Harness thiết bị giả (`tools/sample_device.py`) chỉ dùng cho test, chỉ trỏ vào backend cục bộ.
- **Hợp nhất trên dữ liệu thô, cùng đồng hồ thiết bị (ADR-017, ADR-019).** Quyết định ngã dùng bằng chứng hình ảnh và mẫu gia tốc/con quay thô do backend tự đánh giá, căn theo `boot_id` + `uptime_ms`. Kích hoạt của firmware chỉ mở quyết định, không phải bằng chứng; không có cảnh báo đơn nguồn.
- **Cảnh báo tách khỏi báo cáo ngày.** Backend lưu sự kiện, quyết định hợp nhất và cảnh báo tạm thời trong cùng giao dịch khi bằng chứng đủ, rồi phát qua SSE. Báo cáo ngày do Cron tạo job riêng cho LLM; cảnh báo không bao giờ chờ hay cần LLM.
- **Web:** đăng nhập bằng thông tin owner cấp, token chỉ trong bộ nhớ, stream Live Demo mở bằng vé dùng một lần (ADR-018). Quyền theo grant ở máy chủ.
- Phân biệt: bằng chứng mô hình (`score`, `label`) · phân loại của hệ thống (`classification`) · xác nhận của con người (`verification`, mặc định `unverified`).
- `contracts/` là nguồn sự thật cho schema dữ liệu nguồn. OpenAPI của API sinh type TypeScript cho web.
- Realtime bằng SSE theo hồ sơ, reconnect bằng `Last-Event-ID`. SSE chỉ mang gợi ý thay đổi, web refetch qua REST.

Repo map mục tiêu. Chỉ tạo thư mục khi có nội dung thật, không tạo khung rỗng.

```
frontend/              SPA: landing + app (S01–S14), design system dùng chung
backend/api/           API nghiệp vụ, phân quyền, migrations, worker
backend/care-monitoring/ Cloud backend CareLens: worker/ (Cloudflare Worker, D1 migrations, test), start_backend.py, scripts/
integrations/carelens/ local-agent/: agent Python nối Vision (Module 1) và Ollama (Module 2) với backend
contracts/             JSON Schema nguồn có version + fixtures tổng hợp
tests/e2e/             Playwright cho luồng xuyên suốt và AC
docs/                  Kế hoạch, kiến trúc, quyết định, trạng thái
Carelens/ EcoPatch/   PRD gốc (.docx), giữ nguyên
```

## 4. Lệnh

Chạy từ thư mục gốc trừ khi ghi khác. Workspace gốc là `frontend` (D13, sửa 2026-10-19): các lệnh dưới đây chạy script của `frontend/` qua `-w @istartup/web` (đã chạy 2026-10-19). `npm install` ở gốc hay trong `frontend/` đều cài theo `package-lock.json` gốc.

| Mục đích | Lệnh |
| --- | --- |
| Cài đặt | `npm install` |
| Cài trình duyệt cho e2e (một lần) | `npx -w @istartup/web playwright install chromium` |
| Chạy web với adapter mô phỏng | `npm run dev` rồi mở http://localhost:5173 |
| Build production | `npm run build` |
| Unit test (Vitest) | `npm test` |
| E2E và responsive (Playwright, tự build và chạy preview ở cổng 4173) | `npm run test:e2e` |
| Lint · typecheck | `npm run lint` · `npm run typecheck` |
| Cài backend (một lần; lockfile riêng, không đụng lockfile gốc) | `cd backend/care-monitoring/worker` rồi `npm ci` |
| Cấp tài khoản Live Demo cục bộ (một lần: `init`; sau mỗi lần reset DB: `provision`; xem `docs/DEV_LOCAL.md`) | `python backend/care-monitoring/scripts/dev_setup.py init` rồi `... provision --login-id <tên>` |
| Chạy backend cục bộ (127.0.0.1:8787, D1/R2 cục bộ; đã chạy 2026-10-19) | `npm run dev:backend` (từ gốc); DB cục bộ cũ hơn schema hiện tại → `python backend/care-monitoring/start_backend.py --reset-local-db` |
| Test backend (Vitest trong runtime Workers; đã chạy 2026-10-19) | `cd backend/care-monitoring/worker` rồi `npm test` và `npm run typecheck` |
| Kiểm tra bundle deploy, không cần tài khoản (đã chạy 2026-10-19) | `cd backend/care-monitoring/worker` rồi `npm run deploy:dry-run` |
| Kiểm schema contract (đã chạy 2026-10-19) | `cd backend/care-monitoring/worker` rồi `npm run contracts:check` (sinh lại: `npm run contracts:generate`) |
| Test agent cục bộ (đã chạy 2026-10-19) | `cd integrations/carelens/local-agent` rồi `python -m pytest -q` |
| Test đầu-cuối với mô hình thật, gồm Chromium đăng nhập Live Demo (cần Vision server + Ollama, cổng 4173 trống; đã chạy 2026-10-19) | `cd integrations/carelens/local-agent` rồi `python -m pytest -m e2e tests/integration -q` |

Lệnh backend dự kiến, **CHƯA tồn tại** (M1): `uv sync`, `docker compose up -d db`, `npm run db:migrate`, `npm run test:api`, `npm run gen:api-types`.

## 5. Quy trình làm việc

1. **Đọc trước khi sửa:** file này → mục liên quan trong plan → rules của vùng code → code, schema, migrations, test hiện có.
2. **Theo mốc M0→M5** (plan §12). M1–M2 phải thành một luồng chạy được trước khi mở rộng. Làm lát dọc (DB → API → UI → test), không dựng component library lớn trước.
3. **Giữ stack và conventions đã có.** Không viết lại hay đổi công nghệ để khớp tên trong tài liệu. Thay đổi kiến trúc phải có ADR trong `docs/DECISIONS.md`.
4. **Thiếu thông tin không chặn:** chọn giả định an toàn, ghi vào `docs/DECISIONS.md` (Open/Proposed), làm tiếp. Chỉ hỏi khi thực sự bị chặn.
5. **Kiểm tra sau mỗi thay đổi:** lint, typecheck, test liên quan. Với UI, mở trình duyệt kiểm tra thật.
6. **Sau mỗi mốc:** cập nhật checklist trong plan, lệnh chạy, hạn chế; báo cáo theo §8.

## 6. Ranh giới bắt buộc

Vi phạm bất kỳ mục nào dưới đây là lỗi chặn, kể cả trong demo.

### An toàn y khoa và AI

- Không bịa số liệu: pin, ECG, SpO2, hydrat hóa, confidence, độ chính xác, độ trễ. Chỉ hiển thị thứ nguồn thực sự cung cấp.
- Care level là **điểm AI thử nghiệm**, không phải xác suất bệnh hay độ chính xác. Không suy ra confidence từ care level.
- GSR không phải mức hydrat hóa/điện giải. Không có dự đoán đột quỵ/mất nước. Không có điểm sức khỏe gộp hai sản phẩm.
- Mô tả AI là nhận định chưa được con người xác nhận. Không biến thành chẩn đoán hay lời khuyên điều trị.
- `Không có dữ liệu` khác `Không phát hiện bất thường`. Mất kết nối hoặc dữ liệu cũ không bao giờ hiển thị như bình thường hay "an toàn".
- `Đã tiếp nhận` khác `Đã xử lý` khác `AI đúng`. Đóng alert bắt buộc có `review_outcome` và ghi chú.
- Không tự đặt ngưỡng y khoa. Ngưỡng demo có `rule_version` và nhãn demo.

### Riêng tư và bảo mật

- Frame CareLens chỉ đi qua API upload thiết bị vào bucket R2 riêng tư, tạm thời, để agent cục bộ suy luận; xóa ngay khi xong, khi job thất bại hẳn hoặc khi hết `MEDIA_MAX_AGE_SECONDS` (D10, Proposed theo yêu cầu người dùng 2026-10-19). Frame không vào D1, API người chăm sóc, log, export hay analytics; không mã hóa base64/hex để lưu; không trang camera, thumbnail hay nhận diện khuôn mặt. Vision API và Ollama chỉ nghe loopback.
- Mọi list/detail/export/stream/mutation kiểm tra quyền **phía server** theo `care_recipient_id`. Ẩn UI không phải bảo mật.
- Actor lấy từ phiên xác thực. Hồ sơ đích của dữ liệu thiết bị lấy từ credential và lịch sử gán thiết bị, không tin ID do client gửi.
- Không `localStorage.isLoggedIn`, không token hay dữ liệu sức khỏe trong web storage. Không tự viết thuật toán mã hóa.
- Không commit secrets, `.env`, dữ liệu sức khỏe thật hay ảnh người thật. Chỉ dùng fixture tổng hợp.
- Log không chứa token, mật khẩu, cookie, payload sức khỏe đầy đủ hay waveform.
- Không thêm analytics hoặc session replay bên thứ ba.

### Nguồn dữ liệu và hành động ra bên ngoài

- Dữ liệu production mang provenance đúng nguồn thật (kênh ingest, credential, phiên bản mô hình). Không bao giờ đổi nhãn dữ liệu giả thành dữ liệu thật, không tuyên bố dữ liệu đến từ thiết bị hay mô hình khi chưa xác lập được nguồn.
- Dữ liệu tổng hợp chỉ nằm trong test/fixture và adapter mô phỏng của frontend, luôn có `source_mode = "simulated"` và nhãn `Dữ liệu mô phỏng`. Backend chạy thật không sinh, không seed và không fallback sang dữ liệu giả; tích hợp chưa có trả lỗi hoặc trạng thái "chưa có" rõ ràng.
- Không gửi thông báo, email, SMS tới người thật. Demo dùng notification sink nội bộ.
- Không deploy public, không bật dịch vụ trả phí, không `git push` khi người dùng chưa yêu cầu.
- Ngoài phạm vi MVP: thanh toán/subscription, tích hợp EHR, chatbot y khoa, huấn luyện AI trên dữ liệu người dùng, kho video.

### Thiết kế

- Một hệ thiết kế duy nhất cho landing, đăng nhập và app: bảng màu landing (A19, A35; ghi đè ADR-001 Neumorphism theo yêu cầu 2026-10-19). Không hỏi lại style.
- Token nằm ở một nguồn duy nhất trong code. Không card trắng, không viền, không theme riêng cho từng sản phẩm, không thêm palette đỏ/hổ phách khi chưa có quyết định.

## 7. Conventions

- **Ngôn ngữ:** chữ hiển thị tiếng Việt. Identifier, tên file, API, commit message tiếng Anh.
- **Thời gian:** lưu UTC (`timestamptz`), hiển thị theo múi giờ cấu hình (mặc định `Asia/Ho_Chi_Minh`, A01). Luôn hiện nguồn và thời điểm cập nhật cạnh dữ liệu.
- **Dữ liệu nguồn** luôn có `observed_at`, `received_at`, `source_mode`, `schema_version`, `source_record_id`.
- **Python:** snake_case, type hints đầy đủ, ruff + pyright. **TypeScript:** `strict`, không `any` nếu không có lý do ghi trong comment, ESLint + Prettier.
- **API:** prefix `/api/app/v1`, JSON snake_case, lỗi `application/problem+json` có `code` và `request_id`, pagination bằng cursor.
- **Git:** nhánh `feat/<milestone>-<slug>` hoặc `fix/<slug>`. Conventional Commits (`feat(api): add alert actions`). Commit nhỏ, mỗi commit build được.
- **Đa nền tảng:** máy dev chính chạy Windows. Script dùng npm scripts hoặc Python, không bash/Makefile. Line ending LF theo `.gitattributes`.

## 8. Definition of Done và báo cáo

Một hạng mục chỉ được gọi là xong khi:

- [ ] Chạy được từ checkout sạch theo lệnh ở §4.
- [ ] Lint, typecheck và test liên quan đã **thực sự chạy** và pass. Logic quyền, state machine, transaction có test mới.
- [ ] Không vi phạm §6 (Claude Code: chạy `/guardrail-check`).
- [ ] Tài liệu liên quan đã cập nhật: checklist mốc, `docs/DECISIONS.md`, lệnh chạy.

Báo cáo mỗi mốc hoặc tác vụ lớn gồm: phần đã làm · file thay đổi · cách chạy · kiểm tra đã chạy và kết quả thật · phần mô phỏng và phần tích hợp thật · điểm còn chặn. Không ghi test chưa chạy là pass. Không ghi "người dùng đã nghiệm thu" khi chưa có xác nhận.
