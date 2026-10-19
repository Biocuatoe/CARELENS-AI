# CareLens Local AI Agent

Tiến trình Python chạy trên PC Windows tại nhà. Kéo việc từ cloud backend (`backend/care-monitoring`, ADR-016) qua HTTPS **đi ra**, chạy Vision package (Module 1) và Qwen trên Ollama (Module 2) **trên chính máy này**, gửi kết quả số và nhãn về. Không mở cổng vào, không đưa Vision API hay Ollama ra Internet.

Chỉ dùng thư viện chuẩn Python (3.11+). Mặc định chạy bằng Python 3.14 của môi trường Vision có sẵn `D:\AI\Envs\CareLens-VLM` mà **không cài thêm gì** vào môi trường đó.

## Trạng thái

| Hạng mục | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Logic agent (claim, lease, retry, chia 40 khung, gộp, dọn dẹp, ưu tiên, tóm tắt) | **Đã kiểm chứng** | `python -m pytest -q`: 38 test với Vision/Ollama/backend giả trên loopback, gồm kiểm kết quả thật của agent theo JSON Schema đã công bố |
| Agent + gói Vision thật + Qwen thật + backend cục bộ + trình duyệt | **Đã kiểm chứng 2026-10-19** | `python -m pytest -m e2e tests/integration`: 11/11. Điểm ngã khớp `samples/expected.json` trong 1e-3; nhãn `med1_5s` = `uong_thuoc`; IMU thô phủ burst trên đồng hồ thiết bị; không còn media; lời nhắn thoại tới harness thiết bị và chỉ "đã phát" khi thiết bị báo; đường cảnh báo đầy đủ với chính sách chỉ để thử đường đi; Chromium đăng nhập Live Demo; báo cáo ngày bằng Qwen thật |
| ESP32 thật, mạng thật, độ chính xác | **Chưa kiểm chứng** | Mẫu là burst đi kèm gói; lần chụp 40 khung là ghép 24 + 16 khung mẫu, chỉ để thử đường ống |

Đo trên RTX 2060 6 GB (2026-10-19, backend cục bộ, lần chạy cuối): việc 24 khung 0,58 s, việc 40 khung 0,76 s (gồm tải media, 1 hoặc 3 fall-check, 1 hoặc 3 object-check, dọn dẹp, nộp kết quả); báo cáo ngày 5,5 s. Qwen (num_ctx 6144) + Vision cùng nạp: 5.297/6.144 MiB (A32). Không phải benchmark.

## Cách agent xử lý

1. **Kết nối:** gọi `/api/agent/v1/*` bằng token `cla_…`; nhận gợi ý việc qua SSE `/api/agent/v1/events`, vẫn poll dự phòng (`CARELENS_POLL_INTERVAL_S`). Lỗi mạng: lùi thời gian có jitter, tự nối lại.
2. **Việc Vision:** tải chunk vào bộ nhớ, kiểm lại thứ tự, SHA-256, header JPEG, kích thước và nhịp 8 fps. Mất khung (> 187 ms) → ghi `skipped: cadence_gap`, không suy luận. 24 khung → một `/v1/fall-check` + một `/v1/object-check`. 40 khung → ba yêu cầu chồng nhau 0–23, 8–31, 16–39 cho mỗi loại; gộp ở mức lần chụp: điểm ngã = max ba điểm yêu cầu (logit chưa hiệu chỉnh), nhãn uống theo thứ tự `uong_thuoc > uong_nuoc > khong`, lần nâng cốc trùng trong vùng chồng chỉ tính một lần, vỉ thuốc ở đoạn này + nâng cốc ở đoạn khác → `cross_window_review` (không tự gán `uong_thuoc`).
3. **Dọn dẹp:** sau mỗi việc có object-check, gửi một khung xám trung tính 160×120 để predictor Ultralytics 8.3.253 của server (tái sử dụng giữa các lần gọi, giữ ảnh của lần gọi cuối trong `dataset.im0`, `batch`, `results[*].orig_img`) không còn giữ ảnh thật. Bộ đệm frame của agent được ghi đè bằng 0 rồi giải phóng. Không ghi đĩa, không log nội dung. Backend xóa media R2 khi nhận kết quả.
4. **Báo cáo ngày:** gọi Ollama `/api/chat` dạng stream với JSON Schema, `temperature 0`, `keep_alive 0`; kiểm id, khoảng trống và mọi con số trong văn bản phải có trong đầu vào; sai thì sửa một lần, vẫn sai thì báo lỗi để thử lại sau.
5. **Ưu tiên GPU:** làn báo cáo chỉ nhận việc khi không còn việc Vision; việc Vision đến thì cắt báo cáo đang sinh (trả job, không tính lượt) và chạy ngay.
6. **Lỗi:** Vision không trả lời / 5xx → `vision_unavailable` (thử lại); 4xx → `vision_rejected_input`; media hỏng → `invalid_media`; lỗi không bao giờ thành "không ngã".
7. **IMU:** payload job có `imu_window` (độ phủ IMU thô của burst lúc nhận việc). Agent chỉ ghi log; hợp nhất IMU thô–hình ảnh chạy ở backend (`fusion-rules.v2`), vì không mô hình cục bộ nào dùng IMU. Phản hồi hoàn tất cho biết `imu_state` và `fusion_pending`.
8. **Tình trạng:** heartbeat mỗi 60 s gửi phiên bản, tình trạng Vision/Ollama, thống kê và `health{last_vision_completed_at, last_report_completed_at, last_failure}` (mã lỗi, không payload) để owner xem ở `/api/admin/v1/status`.

## Cài đặt và chạy (Windows)

```powershell
cd integrations\carelens\local-agent
copy agent.env.example agent.env      # điền CARELENS_BACKEND_URL và CARELENS_AGENT_TOKEN (cấp bằng scripts/admin.py agent)

# 1. Vision server của gói (chỉ 127.0.0.1:8080, CUDA, không bao giờ -SaveDir)
powershell -ExecutionPolicy Bypass -File scripts\start_vision_server.ps1 -Device cuda -Background
# 2. Ollama: ứng dụng đã cài sẵn tự chạy; kiểm tra model
ollama list                            # cần qwen3:4b-instruct-2507-q4_K_M
# 3. Kiểm tra sẵn sàng (không nhận việc)
powershell -ExecutionPolicy Bypass -File scripts\check_agent.ps1
# 4. Chạy agent
powershell -ExecutionPolicy Bypass -File scripts\start_agent.ps1              # tiền cảnh, Ctrl+C để dừng
powershell -ExecutionPolicy Bypass -File scripts\start_agent.ps1 -Background  # nền, PID ở run\agent.pid
powershell -ExecutionPolicy Bypass -File scripts\stop_agent.ps1               # dừng êm (tối đa 30 s)
```

Script không đăng ký Windows service, không đổi biến môi trường hệ thống, không mở firewall. Muốn tự chạy khi đăng nhập, người dùng tự tạo lối tắt trong Startup trỏ tới `start_agent.ps1 -Background`.

## Cấu hình

Xem `agent.env.example`. Bắt buộc: `CARELENS_BACKEND_URL` (https, trừ backend cục bộ), `CARELENS_AGENT_TOKEN`. `CARELENS_VISION_URL` và `CARELENS_OLLAMA_URL` phải là địa chỉ loopback; agent từ chối khởi động nếu không.

## Log

`run\agent.log` (xoay vòng 1 MB × 5): id việc, mã lỗi, thời gian, số lượng. Không có token (bộ lọc che `cla_…`, `lease_…`), không có frame, không có nội dung báo cáo. Xem nhanh: `Get-Content run\agent.log -Tail 50`.

## Sự cố thường gặp

| Hiện tượng | Xử lý |
| --- | --- |
| `configuration error: … loopback` | Vision/Ollama phải là `127.0.0.1`/`localhost` |
| `agent credential: REJECTED (401)` | Token sai hoặc đã thu hồi; cấp lại bằng `scripts/admin.py agent` |
| `vision … UNAVAILABLE` | Chạy `start_vision_server.ps1`, đợi `/health` trả `fall_heads=3, drink=true` |
| `ollama … not installed` | `ollama pull qwen3:4b-instruct-2507-q4_K_M` (model đã có ở `D:\AI\Models\Ollama`) |
| Việc Vision `expired` | Agent offline quá `MEDIA_MAX_AGE_SECONDS`; media đã bị xóa theo thiết kế |
| `llm_output_invalid` lặp lại | Xem `run\agent.log`; backend thử lại tối đa 6 lần rồi đánh dấu báo cáo `failed`; admin có thể `POST /api/admin/v1/daily-reports/{id}/retry` |

## Test

```powershell
python -m pytest -q                                   # nhanh, không cần GPU
python -m pytest -m e2e tests/integration -q          # cần Vision server + Ollama + npm ci ở backend/care-monitoring/worker
```

Test e2e dựng `wrangler dev` với D1/R2 tạm, dùng `tools/sample_device.py` (harness thiết bị giả: đồng hồ mô phỏng, IMU tổng hợp, `source_mode="simulated"`, chỉ chấp nhận backend cục bộ) để tải mẫu của gói, chạy giao thức lệnh/âm thanh, rồi xóa thư mục tạm. `test_e2e_browser_live_demo.py` build frontend với `VITE_API_BASE_URL` trỏ backend tạm, chạy `vite preview` ở cổng 4173 và Playwright `frontend/e2e/live-demo-backend.spec.ts` (cổng 4173 phải trống; `frontend/dist` bị ghi đè, là thư mục build bị git bỏ qua).
