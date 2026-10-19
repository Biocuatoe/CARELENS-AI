import { useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { useAdminAuth } from "../../app/adminAuth";
import type { AuditEntry } from "../../data/admin/adminClient";
import { EmptyState, InlineError, LoadingState } from "../../design-system/feedback";
import { InsetSelect, SoftButton } from "../../design-system/primitives";
import { formatDateTime } from "../../lib/time";
import { Card, PageTitle } from "./AdminParts";
import { AUDIT_ACTION_LABELS, AUDIT_FILTERS, GENERIC_STATUS_LABELS } from "./labels";
import { errorMessage, useAdminLoad } from "./useAdminLoad";

export function AuditList({ items }: { items: AuditEntry[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((a) => (
        <li key={a.auditId} className="rounded-control bg-surface p-3 shadow-inset-sm">
          <p className="font-bold">{AUDIT_ACTION_LABELS[a.action] ?? a.action}</p>
          <p className="text-xs">
            <time dateTime={a.at}>{formatDateTime(a.at)}</time> · {a.actorType === "admin" ? "quản trị viên" : a.actorType}
            {a.actorId ? ` ${a.actorId}` : ""} · {GENERIC_STATUS_LABELS[a.outcome] ?? a.outcome}
            {a.targetId ? ` · ${a.targetType ?? "đối tượng"} ${a.targetId}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Nhật ký quản trị từ GET /api/admin/v1/audit: chỉ id và loại thao tác, không có nội dung nhắc, token hay âm thanh. */
export function AdminAuditPage() {
  const { run } = useAdminAuth();
  const [filter, setFilter] = useState("");
  const first = useAdminLoad((client, token) => client.audit(token, { actionPrefix: filter || undefined }), `audit|${filter}`);
  // Later pages are appended; a new filter or a reload starts again from the newest entry.
  const [more, setMore] = useState<{ forKey: string; items: AuditEntry[]; next: string | null } | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = `${filter}`;
  const extra = more && more.forKey === key ? more : null;

  const loadMore = async () => {
    const cursor = extra ? extra.next : first.state.status === "ready" ? first.state.data.nextCursor : null;
    if (!cursor) return;
    setBusy(true);
    setMoreError(null);
    try {
      const page = await run((client, token) => client.audit(token, { actionPrefix: filter || undefined, cursor }));
      setMore({ forKey: key, items: [...(extra?.items ?? []), ...page.items], next: page.nextCursor });
    } catch (error) {
      setMoreError(errorMessage(error, "Không tải thêm được."));
    } finally {
      setBusy(false);
    }
  };

  const items = first.state.status === "ready" ? [...first.state.data.items, ...(extra?.items ?? [])] : [];
  const next = extra ? extra.next : first.state.status === "ready" ? first.state.data.nextCursor : null;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        actions={
          <SoftButton
            size="sm"
            variant="secondary"
            onClick={() => {
              setMore(null);
              first.reload();
            }}
            disabled={first.state.status === "loading"}
          >
            <RefreshCw className="size-4" aria-hidden />
            Làm mới
          </SoftButton>
        }
      >
        Nhật ký quản trị
      </PageTitle>
      <InsetSelect label="Loại thao tác" value={filter} onChange={(e) => { setFilter(e.target.value); setMore(null); }} wrapperClassName="max-w-xs">
        {AUDIT_FILTERS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </InsetSelect>
      {first.state.status === "loading" ? <LoadingState label="Đang tải nhật ký…" /> : null}
      {first.state.status === "error" ? (
        <InlineError title="Không tải được nhật ký" onRetry={first.reload}>
          {first.state.message}
        </InlineError>
      ) : null}
      {first.state.status === "ready" ? (
        <Card icon={<History aria-hidden />} title="Thao tác gần đây (mới nhất trước)">
          {items.length === 0 ? (
            <EmptyState icon={<History />} title="Chưa có thao tác nào khớp">
              <p>Nhật ký trống cho bộ lọc này.</p>
            </EmptyState>
          ) : (
            <AuditList items={items} />
          )}
          {moreError ? <p role="alert" className="font-bold">{moreError}</p> : null}
          {next ? (
            <div>
              <SoftButton variant="secondary" onClick={() => void loadMore()} disabled={busy}>
                {busy ? "Đang tải…" : "Tải thêm"}
              </SoftButton>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
