import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Inbox, LogOut, MonitorSmartphone, Radio, Send, UserRound } from "lucide-react";
import { useNavigate } from "react-router";
import { useAdapter } from "../../data";
import type { NotificationSettings } from "../../data/contracts";
import { errorMessage, isApiError } from "../../data/errors";
import { qk } from "../../data/queryKeys";
import { DemoBadge, InlineError, Notice, StatusLabel } from "../../design-system/feedback";
import { IconWell, InsetField, InsetSelect, SoftButton, SoftSurface } from "../../design-system/primitives";
import { formatDateTime } from "../../lib/time";
import { useAuth, useDemoBadgeLabel, useSession } from "../../app/auth";
import { PageHeader, QueryState, SectionTitle } from "../common/components";

const DELIVERY_STATUS = {
  queued: { label: "Đang chờ", tone: "neutral" },
  provider_accepted: { label: "Đã ghi vào hộp nội bộ", tone: "success" },
  failed: { label: "Thất bại", tone: "urgent" },
} as const;

function browserPermission(): "granted" | "denied" | "default" | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

const PERMISSION_TEXT = {
  granted: "Trình duyệt đã cho phép thông báo",
  denied: "Trình duyệt đang chặn thông báo",
  default: "Trình duyệt chưa được hỏi quyền thông báo",
  unsupported: "Trình duyệt này không hỗ trợ thông báo",
};

export function NotificationSettingsPage() {
  const adapter = useAdapter();
  const session = useSession();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const demoBadgeLabel = useDemoBadgeLabel();
  const settings = useQuery({ queryKey: qk.notificationSettings(), queryFn: () => adapter.getNotificationSettings(), enabled: !session.user.isPlatformAdmin });
  const sink = useQuery({ queryKey: qk.notificationSink(), queryFn: () => adapter.listNotificationSink(), refetchInterval: 2_000, enabled: !session.user.isPlatformAdmin });

  const test = useMutation({
    mutationFn: () => adapter.sendTestNotification(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.notificationSink() }),
  });

  return (
    <>
      <PageHeader title="Thông báo & tài khoản" eyebrow={adapter.mode === "demo" ? <DemoBadge label={demoBadgeLabel} /> : null} />
      <div className="grid gap-8 lg:grid-cols-2">
        <SoftSurface as="section" aria-labelledby="channels-title" className="flex flex-col gap-4">
          <SectionTitle id="channels-title">Kênh nhận thông báo</SectionTitle>
          <div className="flex gap-3 rounded-control p-4 shadow-inset-sm">
            <IconWell size="sm">
              <Radio />
            </IconWell>
            <div>
              <p className="font-bold">Cập nhật trong trang</p>
              <p>Khi trang đang mở, danh sách và cảnh báo tự nhận tín hiệu thay đổi. Khi đóng trang, bạn không nhận được cập nhật này.</p>
              <StatusLabel tone="neutral" className="mt-2">
                Đang hoạt động khi trang mở
              </StatusLabel>
            </div>
          </div>
          <div className="flex gap-3 rounded-control p-4 shadow-inset-sm">
            <IconWell size="sm">
              <MonitorSmartphone />
            </IconWell>
            <div>
              <p className="font-bold">Thông báo đẩy ngoài trang (Web Push)</p>
              <p>Chưa cấu hình nhà cung cấp thông báo, nên kênh này chưa khả dụng. Không có kênh nào bảo đảm thông báo chắc chắn đến người nhận.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusLabel tone="inactive">Chưa cấu hình</StatusLabel>
                <StatusLabel tone="unknown">{PERMISSION_TEXT[browserPermission()]}</StatusLabel>
              </div>
            </div>
          </div>
        </SoftSurface>

        <SoftSurface as="section" aria-labelledby="account-title" className="flex flex-col gap-4">
          <SectionTitle id="account-title">Tài khoản</SectionTitle>
          <div className="flex items-center gap-3 rounded-control p-4 shadow-inset-sm">
            <IconWell size="sm">
              <UserRound />
            </IconWell>
            <div className="min-w-0">
              <p className="font-bold">{session.user.displayName}</p>
              {session.user.email ? <p className="break-all">{session.user.email}</p> : null}
              <p className="text-sm">Tài khoản Demo trực tiếp dùng chung · phiên chỉ tồn tại trong trình duyệt này</p>
            </div>
          </div>
          <SoftButton
            className="self-start"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            <LogOut className="size-5" aria-hidden />
            Đăng xuất
          </SoftButton>
        </SoftSurface>

        {!session.user.isPlatformAdmin ? (
          <>
            <SoftSurface as="section" aria-labelledby="escalation-title">
              <SectionTitle id="escalation-title">Nhắc lại và người dự phòng</SectionTitle>
              <QueryState query={settings}>{(data) => <EscalationForm initial={data} />}</QueryState>
            </SoftSurface>

            <SoftSurface as="section" aria-labelledby="sink-title" className="flex flex-col gap-4">
              <SectionTitle id="sink-title">Hộp thông báo nội bộ</SectionTitle>
              <p>Bản demo không gửi thông báo ra ngoài. Mọi thông báo, kể cả thông báo thử, được ghi vào đây.</p>
              <SoftButton className="self-start" loading={test.isPending} onClick={() => test.mutate()}>
                <Send className="size-5 text-accent" aria-hidden />
                Gửi thông báo thử
              </SoftButton>
              {test.isError ? <InlineError>{errorMessage(test.error)}</InlineError> : null}
              <QueryState query={sink}>
                {(items) =>
                  items.length === 0 ? (
                    <p className="flex items-center gap-2">
                      <Inbox className="size-5 text-accent" aria-hidden />
                      Chưa có thông báo nào.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-3" aria-live="polite">
                      {items.map((d) => (
                        <li key={d.id} className="flex flex-col gap-2 rounded-control p-4 shadow-inset-sm sm:flex-row sm:items-center">
                          <BellRing className="size-5 shrink-0 text-accent" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">
                              {d.isTest ? "[Thử] " : ""}
                              {d.title}
                            </p>
                            <p className="text-sm break-all">
                              Tới {d.recipientUserName} · {formatDateTime(d.createdAt)}
                            </p>
                          </div>
                          <StatusLabel tone={DELIVERY_STATUS[d.status].tone}>{DELIVERY_STATUS[d.status].label}</StatusLabel>
                        </li>
                      ))}
                    </ul>
                  )
                }
              </QueryState>
              <p className="text-sm">“Đã ghi vào hộp nội bộ” không có nghĩa người nhận đã đọc.</p>
            </SoftSurface>
          </>
        ) : null}
      </div>
    </>
  );
}

function EscalationForm({ initial }: { initial: NotificationSettings }) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const [backupUserId, setBackupUserId] = useState(initial.backupUserId ?? "");
  const [reminder, setReminder] = useState(initial.reminderMinutes?.toString() ?? "");
  const [saved, setSaved] = useState(false);


  const mutation = useMutation({
    mutationFn: () =>
      adapter.updateNotificationSettings({
        backupUserId: backupUserId || null,
        reminderMinutes: reminder ? Number(reminder) : null,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.notificationSettings(), data);
      setSaved(true);
    },
  });
  const fe = isApiError(mutation.error) ? mutation.error.fieldErrors : undefined;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <InsetSelect label="Người dự phòng" value={backupUserId} onChange={(e) => {
        setBackupUserId(e.target.value);
        setSaved(false);
      }} error={fe?.backupUserId}>
        <option value="">Không chọn</option>
        {initial.backupCandidates.map((c) => (
          <option key={c.userId} value={c.userId}>
            {c.displayName}
          </option>
        ))}
      </InsetSelect>
      <InsetField
        label="Nhắc lại cảnh báo chưa tiếp nhận sau (phút)"
        type="number"
        inputMode="numeric"
        min={5}
        max={120}
        value={reminder}
        onChange={(e) => {
          setReminder(e.target.value);
          setSaved(false);
        }}
        error={fe?.reminderMinutes}
        hint="Cấu hình vận hành cho bản demo, không phải cam kết thời gian phản hồi y khoa. Để trống để tắt nhắc lại."
      />
      {saved ? (
        <div role="status">
          <Notice>Đã lưu cài đặt.</Notice>
        </div>
      ) : null}
      {mutation.isError && !fe ? <InlineError>{errorMessage(mutation.error)}</InlineError> : null}
      <SoftButton type="submit" variant="primary" className="self-start" loading={mutation.isPending}>
        Lưu cài đặt
      </SoftButton>
    </form>
  );
}
