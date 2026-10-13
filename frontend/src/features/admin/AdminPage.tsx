import { useQuery } from "@tanstack/react-query";
import { Server, ShieldAlert } from "lucide-react";
import { useAdapter } from "../../data";
import type { ConnectionState } from "../../data/contracts";
import { qk } from "../../data/queryKeys";
import { DemoBadge, Notice, StatusLabel } from "../../design-system/feedback";
import { IconWell, SoftSurface } from "../../design-system/primitives";
import { formatDateTime } from "../../lib/time";
import { useSession, useDemoBadgeLabel } from "../../app/auth";
import { PageHeader, QueryState, SectionTitle } from "../common/components";
import { CONNECTION_LABELS } from "../common/labels";

const SERVICE_STATE = {
  operational: { label: "Hoạt động", tone: "neutral" },
  degraded: { label: "Hạn chế", tone: "attention" },
  unavailable: { label: "Không khả dụng", tone: "urgent" },
  not_configured: { label: "Chưa cấu hình", tone: "inactive" },
} as const;

export function AdminPage() {
  const adapter = useAdapter();
  const session = useSession();
  const demoBadgeLabel = useDemoBadgeLabel();
  const diagnostics = useQuery({ queryKey: qk.diagnostics(), queryFn: () => adapter.getDiagnostics(), enabled: session.user.isPlatformAdmin });

  if (!session.user.isPlatformAdmin) {
    return (
      <>
        <PageHeader title="Vận hành" />
        <Notice title="Không có quyền truy cập">Chỉ quản trị nền tảng được xem trang vận hành.</Notice>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Vận hành"
        eyebrow={<DemoBadge label={demoBadgeLabel} />}
        description="Chẩn đoán dịch vụ, thiết bị và tài khoản. Quyền quản trị nền tảng không bao gồm quyền xem dữ liệu sức khỏe."
      />
      <QueryState query={diagnostics}>
        {(d) => (
          <div className="flex flex-col gap-8">
            <SoftSurface as="section" aria-labelledby="services-title">
              <SectionTitle id="services-title">Dịch vụ</SectionTitle>
              <ul className="flex flex-col gap-3">
                {d.services.map((s) => (
                  <li key={s.name} className="flex flex-col gap-3 rounded-control p-4 shadow-inset-sm sm:flex-row sm:items-center">
                    <IconWell size="sm" depth="inset">
                      <Server />
                    </IconWell>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{s.name}</p>
                      <p className="text-sm">{s.detail}</p>
                    </div>
                    <StatusLabel tone={SERVICE_STATE[s.state].tone}>{SERVICE_STATE[s.state].label}</StatusLabel>
                  </li>
                ))}
              </ul>
            </SoftSurface>

            <div className="grid gap-8 lg:grid-cols-2">
              <SoftSurface as="section" aria-labelledby="fleet-title">
                <SectionTitle id="fleet-title">Thiết bị đang được gán</SectionTitle>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {(Object.keys(d.deviceCounts) as ConnectionState[]).map((k) => (
                    <div key={k} className="rounded-control p-4 shadow-inset-sm">
                      <dt className="text-sm font-medium">{CONNECTION_LABELS[k].label}</dt>
                      <dd className="font-display text-2xl font-extrabold">{d.deviceCounts[k]}</dd>
                    </div>
                  ))}
                </dl>
              </SoftSurface>

              <SoftSurface as="section" aria-labelledby="issues-title">
                <SectionTitle id="issues-title">Lỗi tích hợp</SectionTitle>
                {d.integrationIssues.length === 0 ? (
                  <p>Không có bản ghi bị cách ly.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {d.integrationIssues.map((i) => (
                      <li key={i.id} className="flex gap-3 rounded-control p-4 shadow-inset-sm">
                        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                        <div>
                          <p className="font-bold">
                            {i.deviceSerialMasked} · {formatDateTime(i.at)}
                          </p>
                          <p className="text-sm">{i.reason}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-sm">Chỉ hiển thị metadata. Nội dung gói dữ liệu không được hiển thị ở đây.</p>
              </SoftSurface>
            </div>

            <SoftSurface as="section" aria-labelledby="accounts-title">
              <SectionTitle id="accounts-title">Tài khoản</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] border-separate border-spacing-y-2 text-left">
                  <caption className="sr-only">Danh sách tài khoản</caption>
                  <thead>
                    <tr className="text-sm">
                      <th scope="col" className="px-4 font-bold">Tên</th>
                      <th scope="col" className="px-4 font-bold">Email</th>
                      <th scope="col" className="px-4 font-bold">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.accounts.map((a) => (
                      <tr key={a.id} className="shadow-inset-sm [&>td:first-child]:rounded-l-control [&>td:last-child]:rounded-r-control">
                        <td className="px-4 py-3 font-medium">{a.displayName}</td>
                        <td className="px-4 py-3">{a.email}</td>
                        <td className="px-4 py-3">{a.status === "active" ? "Hoạt động" : "Bị khóa"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SoftSurface>
          </div>
        )}
      </QueryState>
    </>
  );
}
