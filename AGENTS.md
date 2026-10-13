# AGENTS.md

Điểm vào bắt buộc cho mọi coding agent (Claude Code, Codex, Cursor…) và lập trình viên mới. Đọc hết file này trước khi sửa bất cứ thứ gì. Claude Code nạp file này qua `CLAUDE.md`.

## 1. Dự án

Webapp chung cho **CareLens** và **EcoPatch**, lấy **người được chăm sóc** (`care_recipient`) làm trung tâm. Một hồ sơ dùng một hoặc cả hai sản phẩm, có nhiều người chăm sóc và một trung tâm cảnh báo chung.

| Sản phẩm | Bản chất (theo PRD nháp) | Dữ liệu được phép vào webapp |
| --- | --- | --- |
| CareLens | Hub AI chạy local trong nhà (YOLOv10 → VLM) nhận frame từ camera đeo ESP32-S3, không cloud | Care event dạng văn bản: thời điểm, loại, care level 0–10, mô tả AI. **Không bao giờ có ảnh/video/frame** |
| EcoPatch | Miếng dán sinh học + lõi nRF52832 đọc ECG/GSR, BLE → điện thoại/gateway → backend | Phép đo có đơn vị và chất lượng tín hiệu, heartbeat, phiên miếng dán |

**Hiện trạng (2026-09-15):** có `frontend/` gồm landing và UI hệ thống S01–S14 chạy trên adapter mô phỏng (xem `docs/UI_IMPLEMENTATION_STATUS.md`). Chưa có `backend/api`, API hub, schema BLE/telemetry hoặc thiết bị đã xác minh. Mọi nguồn dữ liệu dùng adapter mô phỏng có nhãn cho tới mốc M5.

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

- Modular monolith: `frontend/` (React + TypeScript + Vite SPA, Tailwind v4) · `backend/api/` (FastAPI + SQLAlchemy 2 + Alembic) · PostgreSQL · worker Python đọc outbox.
- Nguồn thiết bị đi qua `integrations/*` (simulator hoặc adapter thật) → `POST /api/app/v1/ingest/*` bằng credential thiết bị, giống hệt đường nguồn thật.
- `contracts/` là nguồn sự thật cho schema dữ liệu nguồn. OpenAPI của API sinh type TypeScript cho web.
- Realtime bằng SSE theo hồ sơ, reconnect bằng `Last-Event-ID`. SSE chỉ mang gợi ý thay đổi, web refetch qua REST.

Repo map mục tiêu. Chỉ tạo thư mục khi có nội dung thật, không tạo khung rỗng.

```
frontend/              SPA: landing + app (S01–S14), design system dùng chung
backend/api/           API nghiệp vụ, phân quyền, migrations, worker
backend/services/      Services như demo-bridge
integrations/carelens/ simulator + adapter hub CareLens (adapter thật ở M5)
integrations/ecopatch/ simulator + adapter gateway EcoPatch (adapter thật ở M5)
contracts/             JSON Schema nguồn có version + fixtures tổng hợp
tests/e2e/             Playwright cho luồng xuyên suốt và AC
docs/                  Kế hoạch, kiến trúc, quyết định, trạng thái
Carelens/ EcoPatch/   PRD gốc (.docx), giữ nguyên
```

## 4. Lệnh

Chạy từ thư mục gốc. Các lệnh dưới đây đã chạy thành công ngày 2026-09-14 (chỉ có `frontend/`).

| Mục đích | Lệnh |
| --- | --- |
| Cài đặt | `npm install` |
| Cài trình duyệt cho e2e (một lần) | `npx -w @istartup/web playwright install chromium` |
| Chạy web với adapter mô phỏng | `npm run dev` rồi mở http://localhost:5173 |
| Build production | `npm run build` |
| Unit test (Vitest) | `npm test` |
| E2E và responsive (Playwright, tự build và chạy preview ở cổng 4173) | `npm run test:e2e` |
| Lint · typecheck | `npm run lint` · `npm run typecheck` |

Lệnh backend dự kiến, **CHƯA tồn tại** (M1): `uv sync`, `docker compose up -d db`, `npm run db:migrate`, `npm run demo:reset`, `npm run test:api`, `npm run gen:api-types`.

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

- Ảnh, video, frame CareLens không đi vào API nghiệp vụ, database, log, export hay analytics. Không có trang camera, thumbnail hay nhận diện khuôn mặt.
- Mọi list/detail/export/stream/mutation kiểm tra quyền **phía server** theo `care_recipient_id`. Ẩn UI không phải bảo mật.
- Actor lấy từ phiên xác thực. Hồ sơ đích của dữ liệu thiết bị lấy từ credential và lịch sử gán thiết bị, không tin ID do client gửi.
- Không `localStorage.isLoggedIn`, không token hay dữ liệu sức khỏe trong web storage. Không tự viết thuật toán mã hóa.
- Không commit secrets, `.env`, dữ liệu sức khỏe thật hay ảnh người thật. Chỉ dùng fixture tổng hợp.
- Log không chứa token, mật khẩu, cookie, payload sức khỏe đầy đủ hay waveform.
- Không thêm analytics hoặc session replay bên thứ ba.

### Demo và hành động ra bên ngoài

- Dữ liệu tổng hợp luôn có `source_mode = "simulated"` và nhãn `Dữ liệu mô phỏng` trên trang và trong bản xuất.
- Không gửi thông báo, email, SMS tới người thật. Demo dùng notification sink nội bộ.
- Không deploy public, không bật dịch vụ trả phí, không `git push` khi người dùng chưa yêu cầu.
- Ngoài phạm vi MVP: thanh toán/subscription, tích hợp EHR, chatbot y khoa, huấn luyện AI trên dữ liệu người dùng, kho video.

### Thiết kế

- Neumorphism là phong cách duy nhất cho landing và app (người dùng đã chọn, ADR-001). Không hỏi lại style.
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
