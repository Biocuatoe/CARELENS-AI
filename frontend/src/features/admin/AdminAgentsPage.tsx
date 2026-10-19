import { RefreshCw, Server } from "lucide-react";
import { EmptyState, InlineError, LoadingState, Notice, StatusLabel } from "../../design-system/feedback";
import { SoftButton } from "../../design-system/primitives";
import { formatDateTime } from "../../lib/time";
import { Card, PageTitle, Row, dash } from "./AdminParts";
import { JOB_KIND_LABELS, ROW_STATUS_LABELS } from "./labels";
import { useAdminLoad } from "./useAdminLoad";

/**
 * Agent and processing health, from GET /api/admin/v1/status only. The Worker cannot see the Vision API or Ollama directly: it
 * knows when an agent last spoke, what the agent said about its own versions, how many jobs wait, and how the last jobs ended.
 */
export function AdminAgentsPage() {
  const { state, reload } = useAdminLoad((client, token) => client.status(token), "status");
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        actions={
          <SoftButton size="sm" variant="secondary" onClick={reload} disabled={state.status === "loading"}>
            <RefreshCw className="size-4" aria-hidden />
            Làm mới
          </SoftButton>
        }
      >
        Agent và dịch vụ xử lý
      </PageTitle>
      {state.status === "loading" ? <LoadingState label="Đang tải trạng thái…" /> : null}
      {state.status === "error" ? (
        <InlineError title="Không tải được trạng thái" onRetry={reload}>
          {state.message}
        </InlineError>
      ) : null}
      {state.status === "ready" ? (
        <>
          <Notice title="Máy chủ không có thông tin trực tiếp về Vision API hay Ollama">
            Hai dịch vụ này chạy trên máy tính của bạn và chỉ nghe địa chỉ nội bộ. Máy chủ chỉ biết agent liên lạc lần cuối khi nào, agent tự báo phiên bản gì, và các việc suy luận đã kết thúc ra sao. Trạng thái Vision API riêng: <strong>không có thông tin</strong>.
          </Notice>
          <Card icon={<Server aria-hidden />} title="Local AI Agent">
            {state.data.agents.length === 0 ? (
              <EmptyState icon={<Server />} title="Chưa có agent nào được đăng ký">
                <p>Không có Local AI Agent nào nối với máy chủ này, nên chưa có suy luận hình ảnh.</p>
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {state.data.agents.map((a) => (
                  <li key={a.agentId} className="rounded-control bg-surface p-4 shadow-inset-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-bold">{a.label}</p>
                        <p className="text-xs">
                          {a.agentId} · {ROW_STATUS_LABELS[a.status] ?? a.status}
                        </p>
                      </div>
                      <StatusLabel tone={a.connected ? "neutral" : "inactive"}>{a.connected ? "Có liên lạc gần đây" : "Không có liên lạc gần đây"}</StatusLabel>
                    </div>
                    <p className="mt-1 text-xs">{a.lastSeenAt ? `Liên lạc gần nhất: ${formatDateTime(a.lastSeenAt)}` : "Chưa từng liên lạc"}</p>
                    {a.reported.length > 0 ? (
                      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                        {a.reported.map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2 border-b border-ink/10 py-1">
                            <dt>{k}</dt>
                            <dd className="font-mono break-all">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="mt-1 text-xs">{a.hasReport ? "Agent đã gửi báo cáo nhưng không có trường đơn giản để hiển thị." : "Agent chưa gửi báo cáo phiên bản."}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card icon={<Server aria-hidden />} title="Hàng đợi và kết quả suy luận">
            <dl>
              <Row label="Việc đang chờ">
                {state.data.queue.length === 0
                  ? "Không có việc chờ"
                  : state.data.queue.map((q) => `${JOB_KIND_LABELS[q.kind] ?? q.kind}: ${q.waiting}${q.oldestAgeSeconds === null ? "" : ` (cũ nhất ${q.oldestAgeSeconds} giây)`}`).join("; ")}
              </Row>
              <Row label="Việc lỗi, hết hạn hoặc chờ thử lại (24 giờ)">{state.data.failures24h}</Row>
              <Row label="Lần suy luận thành công gần nhất">
                {state.data.lastInference.length === 0 ? "Chưa có" : state.data.lastInference.map((r) => `${JOB_KIND_LABELS[r.kind] ?? r.kind}: ${r.completedAt ? formatDateTime(r.completedAt) : dash}`).join("; ")}
              </Row>
              <Row label="Giờ máy chủ">{formatDateTime(state.data.serverTime)}</Row>
            </dl>
          </Card>
        </>
      ) : null}
    </div>
  );
}
