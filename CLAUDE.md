@AGENTS.md

# Dành riêng cho Claude Code

## Rules tự nạp theo đường dẫn

`.claude/rules/` chứa quy tắc chi tiết. Claude Code tự nạp khi làm việc với file khớp đường dẫn.

| File | Áp dụng cho |
| --- | --- |
| `frontend.md` | `frontend/**` |
| `backend.md` | `backend/**` |
| `data-contracts.md` | `contracts/**`, `integrations/**`, module ingest |
| `testing.md` | File test mọi nơi |
| `docs.md` | `docs/**`, `README.md` |

## Skills dự án

| Lệnh | Khi nào dùng |
| --- | --- |
| `/milestone [M0..M5]` | Thực hiện hoặc tiếp tục một mốc, kết thúc bằng báo cáo |
| `/ui-screen [S01..S14 \| landing:<section> \| component:<Name>]` | Dựng màn hình, section landing hoặc primitive |
| `/api-endpoint <METHOD> <path>` | Thêm hoặc sửa endpoint nghiệp vụ |
| `/ingest-adapter <carelens\|ecopatch> <simulator\|real>` | Thêm simulator, adapter, contract nguồn |
| `/decision-log <chủ đề>` | Ghi quyết định, giả định, mâu thuẫn tài liệu |
| `/guardrail-check [path\|branch]` | Rà thay đổi theo AGENTS.md §6 trước khi báo xong |

Built-in nên dùng kèm: `/code-review` cho lỗi logic, `/security-review` trước khi merge phần auth/quyền, `/run` để mở app kiểm tra UI.

## Môi trường

- Windows 11. Bash tool là Git Bash. PowerShell 5.1 không hỗ trợ `&&`.
- Đã cài (2026-09-14): Node 24, npm 11, Python 3.11 và 3.14, Docker 29, Git. Chưa cài: `uv` (cần cho ADR-003, cài ở M0 bằng `winget install astral-sh.uv` hoặc `pip install uv`).
- `.claude/settings.json` chặn đọc `.env` và file khóa, `git push` luôn hỏi. Cấu hình cá nhân đặt ở `.claude/settings.local.json` (không commit).
