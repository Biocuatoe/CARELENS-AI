import { Link, Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell, ChevronRight, Plus, UsersRound } from "lucide-react";
import { useAdapter } from "../../data";
import { qk } from "../../data/queryKeys";
import { DemoBadge, EmptyState } from "../../design-system/feedback";
import { buttonClasses, SoftSurface } from "../../design-system/primitives";
import { useDemoBadgeLabel, useSession } from "../../app/auth";
import { PageHeader, ProductTag, QueryState, SourceFreshness } from "../common/components";

export function PeoplePage() {
  const adapter = useAdapter();
  const session = useSession();
  const demoBadgeLabel = useDemoBadgeLabel();
  const recipients = useQuery({ queryKey: qk.recipients(), queryFn: () => adapter.listRecipients() });
  const households = useQuery({
    queryKey: qk.households(),
    queryFn: () => adapter.listManagedHouseholds(),
    enabled: !session.user.isPlatformAdmin,
  });

  if (session.user.isPlatformAdmin) return <Navigate to="/admin" replace />;

  const canCreate = (households.data?.length ?? 0) > 0 || (recipients.data?.length ?? 0) === 0;
  const createLink = (
    <Link to="/onboarding" className={buttonClasses({ variant: "primary" })}>
      <Plus className="size-5" aria-hidden />
      Tạo hồ sơ chăm sóc
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Hồ sơ chăm sóc"
        description="Chỉ hiển thị những hồ sơ bạn được cấp quyền. Chọn một hồ sơ để xem tổng quan."
        actions={canCreate && recipients.isSuccess ? createLink : null}
      />
      <QueryState query={recipients}>
        {(items) =>
          items.length === 0 ? (
            <SoftSurface>
              <EmptyState icon={<UsersRound />} title="Chưa có hồ sơ nào" decorative action={createLink}>
                <p>Bạn chưa được cấp quyền trên hồ sơ nào. Hãy tạo hồ sơ mới hoặc nhờ người quản lý gia đình gửi lời mời.</p>
              </EmptyState>
            </SoftSurface>
          ) : (
            <ul className="grid gap-8 md:grid-cols-2">
              {items.map((r) => (
                <li key={r.id}>
                  <SoftSurface as="article" aria-labelledby={`r-${r.id}`} className="flex h-full flex-col gap-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 id={`r-${r.id}`} className="text-xl font-bold">
                          {r.displayName}
                        </h2>
                        <p className="text-sm">{r.householdName}</p>
                      </div>
                      {r.sourceMode === "simulated" ? <DemoBadge label={demoBadgeLabel} /> : null}
                    </div>
                    <div className="flex flex-wrap gap-4">
                      {r.enrollments.map((e) => (
                        <span key={e.product} className="inline-flex items-center gap-2">
                          <ProductTag product={e.product} />
                          {e.status === "setup_incomplete" ? <span className="text-sm">(chưa hoàn tất thiết lập)</span> : null}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-col gap-3">
                      {r.sources.map((s) => (
                        <SourceFreshness key={s.product} source={s} compact />
                      ))}
                    </div>
                    <p className="inline-flex items-center gap-2 font-medium">
                      <Bell className="size-5 text-accent" aria-hidden />
                      {r.openAlertCount === null
                        ? "Bạn không có quyền xem cảnh báo"
                        : r.openAlertCount === 0
                          ? "Không có cảnh báo đang mở"
                          : `${r.openAlertCount} cảnh báo đang mở`}
                    </p>
                    <Link to={`/people/${r.id}/overview`} className={buttonClasses({ className: "mt-auto self-start" })}>
                      Mở hồ sơ
                      <ChevronRight className="size-4" aria-hidden />
                    </Link>
                  </SoftSurface>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </>
  );
}
