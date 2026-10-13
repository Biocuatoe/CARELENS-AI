import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailPlus, ShieldCheck, UserMinus, UsersRound } from "lucide-react";
import { useAdapter } from "../../data";
import type { Grant, Invitation } from "../../data/contracts";
import { errorMessage, isApiError } from "../../data/errors";
import { PERMISSION_LABELS, ROLE_LABELS, ROLE_PERMISSIONS } from "../../data/permissions";
import { qk } from "../../data/queryKeys";
import { DemoBadge, InlineError, Notice, StatusLabel } from "../../design-system/feedback";
import { Dialog } from "../../design-system/overlays";
import { Choice, InsetField, SoftButton, SoftSurface } from "../../design-system/primitives";
import { formatDate, formatDateTime } from "../../lib/time";
import { useSession } from "../../app/auth";
import { PageHeader, QueryState, SectionTitle } from "../common/components";
import { useRecipient } from "../common/recipient";
import { useDemoBadgeLabel } from "../../app/auth";

const INVITATION_STATUS = {
  pending: { label: "Đang chờ chấp nhận", tone: "attention" },
  accepted: { label: "Đã chấp nhận", tone: "neutral" },
  expired: { label: "Đã hết hạn", tone: "inactive" },
  cancelled: { label: "Đã hủy", tone: "inactive" },
} as const;

export function SharingPage() {
  const adapter = useAdapter();
  const { recipient, recipientId, can, role, permissions } = useRecipient();
  const demoBadgeLabel = useDemoBadgeLabel();
  const access = useQuery({
    queryKey: qk.access(recipientId),
    queryFn: () => adapter.getAccess(recipientId),
    enabled: can("sharing.manage"),
  });
  const [revokeTarget, setRevokeTarget] = useState<Grant | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Gia đình & quyền truy cập"
        eyebrow={<DemoBadge label={demoBadgeLabel} />}
        description={`Ai được xem và xử lý thông tin của ${recipient.displayName}. Thành viên nhóm gia đình không tự động có quyền trên hồ sơ.`}
        actions={
          can("sharing.manage") ? (
            <SoftButton variant="primary" onClick={() => setInviteOpen(true)}>
              <MailPlus className="size-5" aria-hidden />
              Mời người chăm sóc
            </SoftButton>
          ) : null
        }
      />

      <div className="flex flex-col gap-8">
        <SoftSurface as="section" aria-labelledby="my-access">
          <SectionTitle id="my-access">Quyền của bạn</SectionTitle>
          <p className="mb-3 font-bold">{ROLE_LABELS[role]}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {permissions.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <ShieldCheck className="size-4 shrink-0 text-accent" aria-hidden />
                {PERMISSION_LABELS[p]}
              </li>
            ))}
          </ul>
        </SoftSurface>

        {!can("sharing.manage") ? (
          <Notice title="Không có quyền quản lý chia sẻ">
            Chỉ người có quyền quản lý chia sẻ mới xem được danh sách người truy cập, gửi lời mời hoặc thu hồi quyền.
          </Notice>
        ) : (
          <QueryState query={access}>
            {(data) => (
              <>
                <SoftSurface as="section" aria-labelledby="grants-title">
                  <SectionTitle id="grants-title">Người có quyền trên hồ sơ</SectionTitle>
                  <ul className="flex flex-col gap-4">
                    {data.grants.map((g) => (
                      <GrantRow key={g.id} grant={g} onRevoke={() => setRevokeTarget(g)} />
                    ))}
                  </ul>
                </SoftSurface>

                <SoftSurface as="section" aria-labelledby="invites-title">
                  <SectionTitle id="invites-title">Lời mời</SectionTitle>
                  {data.invitations.length === 0 ? (
                    <p>Chưa có lời mời nào.</p>
                  ) : (
                    <ul className="flex flex-col gap-4">
                      {data.invitations.map((i) => (
                        <InvitationRow key={i.id} invitation={i} />
                      ))}
                    </ul>
                  )}
                  <p className="mt-4 text-sm">
                    Bản demo không gửi email. Lời mời được ghi vào hộp thông báo nội bộ. Luồng chấp nhận lời mời cần máy chủ xác thực và chưa khả dụng.
                  </p>
                </SoftSurface>

                <SoftSurface as="section" aria-labelledby="members-title">
                  <SectionTitle id="members-title">Thành viên {data.householdName}</SectionTitle>
                  <ul className="grid gap-4 md:grid-cols-2">
                    {data.householdMembers.map((m) => (
                      <li key={m.userId} className="flex items-center gap-3 rounded-control p-4 shadow-inset-sm">
                        <UsersRound className="size-5 shrink-0 text-accent" aria-hidden />
                        <div>
                          <p className="font-bold">{m.displayName}</p>
                          <p className="text-sm">
                            {m.role === "manager" ? "Quản lý nhóm" : "Thành viên nhóm"} ·{" "}
                            {m.hasRecipientAccess ? "Có quyền trên hồ sơ này" : "Không có quyền trên hồ sơ này"}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </SoftSurface>
              </>
            )}
          </QueryState>
        )}
      </div>

      <RevokeDialog grant={revokeTarget} onClose={() => setRevokeTarget(null)} />
      {inviteOpen ? <InviteDialog onClose={() => setInviteOpen(false)} /> : null}
    </>
  );
}

function GrantRow({ grant, onRevoke }: { grant: Grant; onRevoke: () => void }) {
  const session = useSession();
  const isSelf = grant.userId === session.user.id;
  const revoked = Boolean(grant.revokedAt);
  return (
    <li className="flex flex-col gap-3 rounded-control p-4 shadow-inset-sm md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-bold">
          {grant.userDisplayName}
          {isSelf ? " (bạn)" : ""}
        </p>
        <p className="text-sm break-all">{grant.userEmail}</p>
        <p className="mt-1 text-sm">
          {ROLE_LABELS[grant.role]} · {grant.permissions.length} quyền · cấp ngày {formatDate(grant.grantedAt)}
          {grant.expiresAt ? ` · hết hạn ${formatDate(grant.expiresAt)}` : ""}
        </p>
      </div>
      {revoked ? (
        <StatusLabel tone="inactive">Đã thu hồi {formatDateTime(grant.revokedAt)}</StatusLabel>
      ) : isSelf ? (
        <StatusLabel tone="neutral">Đang có hiệu lực</StatusLabel>
      ) : (
        <SoftButton size="sm" onClick={onRevoke}>
          <UserMinus className="size-4" aria-hidden />
          Thu hồi quyền
        </SoftButton>
      )}
    </li>
  );
}

function InvitationRow({ invitation }: { invitation: Invitation }) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const { recipientId } = useRecipient();
  const cancel = useMutation({
    mutationFn: () => adapter.cancelInvitation(recipientId, invitation.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.access(recipientId) }),
  });
  const status = INVITATION_STATUS[invitation.status];
  return (
    <li className="flex flex-col gap-3 rounded-control p-4 shadow-inset-sm md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-bold break-all">{invitation.email}</p>
        <p className="text-sm">
          {ROLE_LABELS[invitation.role]} · mời bởi {invitation.invitedByName} ngày {formatDate(invitation.createdAt)} · hạn {formatDate(invitation.expiresAt)}
        </p>
        {cancel.isError ? <p className="text-sm font-bold">{errorMessage(cancel.error)}</p> : null}
      </div>
      <StatusLabel tone={status.tone}>{status.label}</StatusLabel>
      {invitation.status === "pending" ? (
        <SoftButton size="sm" loading={cancel.isPending} onClick={() => cancel.mutate()}>
          Hủy lời mời
        </SoftButton>
      ) : null}
    </li>
  );
}

function RevokeDialog({ grant, onClose }: { grant: Grant | null; onClose: () => void }) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const { recipient, recipientId } = useRecipient();
  const mutation = useMutation({
    mutationFn: (id: string) => adapter.revokeGrant(recipientId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.access(recipientId) });
      onClose();
    },
  });
  return (
    <Dialog
      open={Boolean(grant)}
      onClose={() => {
        mutation.reset();
        onClose();
      }}
      busy={mutation.isPending}
      title="Thu hồi quyền truy cập?"
      footer={
        <>
          <SoftButton onClick={onClose} disabled={mutation.isPending}>
            Hủy
          </SoftButton>
          <SoftButton variant="primary" loading={mutation.isPending} onClick={() => grant && mutation.mutate(grant.id)}>
            Thu hồi quyền
          </SoftButton>
        </>
      }
    >
      {grant ? (
        <>
          <p>
            <span className="font-bold">{grant.userDisplayName}</span> ({grant.userEmail}) sẽ mất quyền {ROLE_LABELS[grant.role].toLowerCase()} đối với hồ sơ{" "}
            <span className="font-bold">{recipient.displayName}</span>.
          </p>
          <ul className="list-disc pl-5">
            <li>Yêu cầu mới, luồng cập nhật đang mở và bản xuất của người này bị chặn.</li>
            <li>Thông báo chưa gửi cho người này sẽ không được gửi.</li>
            <li>Lịch sử thao tác trước đây của người này vẫn được giữ.</li>
          </ul>
          <Notice>Trong bản demo, các bảo đảm trên chỉ được mô phỏng trong trình duyệt. Backend thật cần thực thi và kiểm thử riêng.</Notice>
          {mutation.isError ? <InlineError title="Chưa thu hồi được">{errorMessage(mutation.error)}</InlineError> : null}
        </>
      ) : null}
    </Dialog>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const { recipient, recipientId } = useRecipient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"caregiver" | "viewer">("caregiver");
  const [reviewing, setReviewing] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();
  const mutation = useMutation({
    mutationFn: () => adapter.createInvitation(recipientId, { email, role }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.access(recipientId) }),
  });
  const fe = isApiError(mutation.error) ? mutation.error.fieldErrors : undefined;

  return (
    <Dialog open onClose={onClose} busy={mutation.isPending} title="Mời người chăm sóc" description={`Hồ sơ: ${recipient.displayName}`}>
      {mutation.isSuccess ? (
        <>
          <Notice title="Đã tạo lời mời">
            Lời mời cho {mutation.data.email} có hiệu lực tới {formatDateTime(mutation.data.expiresAt)}. Bản demo không gửi email thật.
          </Notice>
          <SoftButton variant="primary" onClick={onClose}>
            Xong
          </SoftButton>
        </>
      ) : !reviewing ? (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
              setLocalError("Nhập địa chỉ email hợp lệ.");
              return;
            }
            setLocalError(undefined);
            setReviewing(true);
          }}
        >
          <InsetField label="Email người được mời" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={localError ?? fe?.email} />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-medium">Vai trò</legend>
            <Choice type="radio" name="role" checked={role === "caregiver"} onChange={() => setRole("caregiver")} label="Người chăm sóc" description="Xem dữ liệu, tiếp nhận và xử lý cảnh báo, ghi chú." />
            <Choice type="radio" name="role" checked={role === "viewer"} onChange={() => setRole("viewer")} label="Người xem" description="Chỉ xem dữ liệu được chia sẻ." />
          </fieldset>
          <SoftButton type="submit" variant="primary">
            Xem lại phạm vi quyền
          </SoftButton>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <p>
            <span className="font-bold break-all">{email.trim()}</span> sẽ nhận các quyền sau trên hồ sơ <span className="font-bold">{recipient.displayName}</span> khi chấp nhận lời mời:
          </p>
          <ul className="flex flex-col gap-2 rounded-control p-4 shadow-inset-sm">
            {ROLE_PERMISSIONS[role].map((p) => (
              <li key={p} className="flex items-center gap-2">
                <ShieldCheck className="size-4 shrink-0 text-accent" aria-hidden />
                {PERMISSION_LABELS[p]}
              </li>
            ))}
          </ul>
          <p className="text-sm">Lời mời dùng một lần, hết hạn sau 7 ngày và cần xác minh người nhận khi chấp nhận.</p>
          {mutation.isError ? <InlineError title="Chưa tạo được lời mời">{fe ? Object.values(fe).join(" ") : errorMessage(mutation.error)}</InlineError> : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <SoftButton onClick={() => setReviewing(false)} disabled={mutation.isPending}>
              Quay lại
            </SoftButton>
            <SoftButton variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Tạo lời mời
            </SoftButton>
          </div>
        </div>
      )}
    </Dialog>
  );
}
