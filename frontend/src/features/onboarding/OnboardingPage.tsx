import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, HeartHandshake, X } from "lucide-react";
import { useAdapter } from "../../data";
import type { Device, Invitation, NotificationDelivery, Product, RecipientSummary } from "../../data/contracts";
import { errorMessage, isApiError } from "../../data/errors";
import { qk } from "../../data/queryKeys";
import { cn } from "../../design-system/cn";
import { BrandIdentity } from "../../design-system/BrandIdentity";
import { ConcentricDecoration, DemoBadge, InlineError, Notice, StatusLabel } from "../../design-system/feedback";
import { buttonClasses, Choice, InsetField, InsetSelect, SoftButton, SoftSurface } from "../../design-system/primitives";
import { formatDateTime } from "../../lib/time";
import { useSession, useDemoBadgeLabel } from "../../app/auth";
import { PRODUCT_LABELS } from "../common/labels";
import { PairingForm } from "../common/PairingForm";

const STEPS = ["Hồ sơ chăm sóc", "Chọn giải pháp", "Kết nối thiết bị", "Người chăm sóc", "Kiểm tra thông báo"] as const;
const NEW_HOUSEHOLD = "__new__";

export function OnboardingPage() {
  const adapter = useAdapter();
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const demoBadgeLabel = useDemoBadgeLabel();
  const [step, setStep] = useState(0);
  const households = useQuery({ queryKey: qk.households(), queryFn: () => adapter.listManagedHouseholds(), enabled: !session.user.isPlatformAdmin });

  const [householdId, setHouseholdId] = useState<string>("");
  const [newHouseholdName, setNewHouseholdName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [recipient, setRecipient] = useState<RecipientSummary | null>(null);
  const [paired, setPaired] = useState<Partial<Record<Product, Device>>>({});
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [testDelivery, setTestDelivery] = useState<NotificationDelivery | null>(null);

  const effectiveHousehold = householdId || (households.data?.[0]?.id ?? NEW_HOUSEHOLD);

  const create = useMutation({
    mutationFn: () =>
      adapter.createRecipient({
        householdId: effectiveHousehold === NEW_HOUSEHOLD ? null : effectiveHousehold,
        newHouseholdName: effectiveHousehold === NEW_HOUSEHOLD ? newHouseholdName : null,
        displayName,
        products,
      }),
    onSuccess: (r) => {
      setRecipient(r);
      void queryClient.invalidateQueries({ queryKey: qk.recipients() });
      setStep(2);
    },
  });
  const serverErrors = isApiError(create.error) ? (create.error.fieldErrors ?? {}) : {};
  const errors = { ...serverErrors, ...localErrors };

  if (session.user.isPlatformAdmin) return <Navigate to="/admin" replace />;

  const validateStep0 = () => {
    const e: Record<string, string> = {};
    if (displayName.trim().length < 2) e.displayName = "Nhập tên hiển thị của hồ sơ (ít nhất 2 ký tự).";
    if (effectiveHousehold === NEW_HOUSEHOLD && newHouseholdName.trim().length < 2) e.newHouseholdName = "Nhập tên nhóm gia đình (ít nhất 2 ký tự).";
    setLocalErrors(e);
    return Object.keys(e).length === 0;
  };

  const exitLink = (
    <Link to="/people" className={buttonClasses({ size: "sm" })}>
      <X className="size-4" aria-hidden />
      {recipient ? "Hoàn tất sau" : "Thoát"}
    </Link>
  );

  return (
    <main className="min-h-dvh bg-surface px-4 py-8 text-fg md:py-12">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <BrandIdentity />
          <div className="flex items-center gap-3">
            {adapter.mode === "demo" ? <DemoBadge label={demoBadgeLabel} /> : null}
            {exitLink}
          </div>
        </header>

        <div className="flex flex-col items-center gap-4 text-center">
          <ConcentricDecoration>
            <HeartHandshake aria-hidden />
          </ConcentricDecoration>
          <h1 className="text-3xl font-extrabold md:text-4xl">Thiết lập hồ sơ chăm sóc</h1>
          <p className="max-w-2xl">Có thể bỏ qua bước kết nối thiết bị và hoàn tất sau. Hồ sơ chưa có thiết bị sẽ được đánh dấu chưa hoàn tất thiết lập.</p>
        </div>

        <nav aria-label="Các bước thiết lập">
          <ol className="flex flex-wrap justify-center gap-3">
            {STEPS.map((label, i) => {
              const done = i < step;
              const current = i === step;
              return (
                <li
                  key={label}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-full px-4 text-sm",
                    current ? "font-bold shadow-inset-sm" : "shadow-extruded-sm",
                  )}
                >
                  <span aria-hidden className={cn("inline-flex size-6 items-center justify-center rounded-full shadow-inset-sm", done && "text-accent")}>
                    {done ? <Check className="size-4" /> : i + 1}
                  </span>
                  <span>{label}</span>
                  {done ? <span className="sr-only">(đã xong)</span> : null}
                </li>
              );
            })}
          </ol>
        </nav>

        <SoftSurface as="section" aria-labelledby="step-title" padding="lg" className="flex flex-col gap-6">
          <h2 id="step-title" className="text-2xl font-bold">
            Bước {step + 1}. {STEPS[step]}
          </h2>

          {step === 0 ? (
            <form
              noValidate
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (validateStep0()) setStep(1);
              }}
            >
              <InsetSelect label="Nhóm gia đình" value={effectiveHousehold} onChange={(e) => setHouseholdId(e.target.value)}>
                {(households.data ?? []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
                <option value={NEW_HOUSEHOLD}>Tạo nhóm mới</option>
              </InsetSelect>
              {effectiveHousehold === NEW_HOUSEHOLD ? (
                <InsetField label="Tên nhóm gia đình" required value={newHouseholdName} onChange={(e) => setNewHouseholdName(e.target.value)} error={errors.newHouseholdName} />
              ) : null}
              <InsetField
                label="Tên hiển thị của hồ sơ"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                error={errors.displayName}
                hint="Chỉ nhập thông tin tối thiểu cần để nhận ra người được chăm sóc. Bản demo không dùng thông tin người thật."
              />
              <SoftButton type="submit" variant="primary" className="self-end">
                Tiếp tục
              </SoftButton>
            </form>
          ) : null}

          {step === 1 ? (
            <form
              noValidate
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (products.length === 0) {
                  setLocalErrors({ products: "Chọn ít nhất một giải pháp." });
                  return;
                }
                setLocalErrors({});
                create.mutate();
              }}
            >
              <fieldset className="flex flex-col gap-3" aria-describedby={errors.products ? "products-error" : undefined}>
                <legend className="mb-2 font-medium">Hồ sơ sẽ dùng giải pháp nào?</legend>
                <Choice
                  label="CareLens"
                  description="Ghi nhận sự kiện chăm sóc từ AI tại hub trong nhà. Ứng dụng chỉ nhận mô tả dạng văn bản."
                  checked={products.includes("carelens")}
                  onChange={() => setProducts((p) => (p.includes("carelens") ? p.filter((x) => x !== "carelens") : [...p, "carelens"]))}
                />
                <Choice
                  label="EcoPatch"
                  description="Chỉ số được thiết bị hỗ trợ qua miếng dán và lõi tái sử dụng."
                  checked={products.includes("ecopatch")}
                  onChange={() => setProducts((p) => (p.includes("ecopatch") ? p.filter((x) => x !== "ecopatch") : [...p, "ecopatch"]))}
                />
                {errors.products ? (
                  <p id="products-error" className="text-sm font-bold">
                    {errors.products}
                  </p>
                ) : null}
              </fieldset>
              {create.isError && !isApiError(create.error) ? <InlineError>{errorMessage(create.error)}</InlineError> : null}
              {create.isError && isApiError(create.error) && !create.error.fieldErrors ? <InlineError>{errorMessage(create.error)}</InlineError> : null}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <SoftButton onClick={() => setStep(0)} disabled={create.isPending}>
                  Quay lại
                </SoftButton>
                <SoftButton type="submit" variant="primary" loading={create.isPending}>
                  Tạo hồ sơ và tiếp tục
                </SoftButton>
              </div>
            </form>
          ) : null}

          {step === 2 && recipient ? (
            <div className="flex flex-col gap-6">
              <Notice title="Hồ sơ đã được tạo">{recipient.displayName} đã được tạo. Các bước sau có thể hoàn tất sau.</Notice>
              {recipient.enrollments.map((e) => (
                <div key={e.product} className="flex flex-col gap-4 rounded-container p-5 shadow-inset-sm md:p-6">
                  <h3 className="text-lg font-bold">{PRODUCT_LABELS[e.product]}</h3>
                  {paired[e.product] ? (
                    <StatusLabel tone="success">
                      Đã xác minh và gán {paired[e.product]!.serialMasked}
                    </StatusLabel>
                  ) : (
                    <PairingForm
                      recipientId={recipient.id}
                      products={[e.product]}
                      showDemoHints={adapter.mode === "demo"}
                      onPaired={(device) => setPaired((p) => ({ ...p, [e.product]: device }))}
                    />
                  )}
                </div>
              ))}
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <SoftButton variant={Object.keys(paired).length === recipient.enrollments.length ? "primary" : "secondary"} onClick={() => setStep(3)}>
                  {Object.keys(paired).length === recipient.enrollments.length ? "Tiếp tục" : "Bỏ qua, kết nối sau"}
                </SoftButton>
              </div>
            </div>
          ) : null}

          {step === 3 && recipient ? (
            <InviteStep recipientId={recipient.id} invites={invites} onInvited={(i) => setInvites((list) => [...list, i])} onNext={() => setStep(4)} />
          ) : null}

          {step === 4 && recipient ? (
            <div className="flex flex-col gap-5">
              <p>Gửi một thông báo thử để kiểm tra luồng thông báo. Thông báo thử có nhãn “Thử”, không chứa dữ liệu sức khỏe và không tính vào báo cáo.</p>
              <TestNotification delivery={testDelivery} onSent={setTestDelivery} />
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <SoftButton onClick={() => setStep(3)}>Quay lại</SoftButton>
                <SoftButton variant="primary" onClick={() => navigate(`/people/${recipient.id}/overview`, { replace: true })}>
                  Hoàn tất và mở tổng quan
                </SoftButton>
              </div>
            </div>
          ) : null}
        </SoftSurface>
      </div>
    </main>
  );
}

function InviteStep({
  recipientId,
  invites,
  onInvited,
  onNext,
}: {
  recipientId: string;
  invites: Invitation[];
  onInvited: (i: Invitation) => void;
  onNext: () => void;
}) {
  const adapter = useAdapter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"caregiver" | "viewer">("caregiver");
  const mutation = useMutation({
    mutationFn: () => adapter.createInvitation(recipientId, { email, role }),
    onSuccess: (i) => {
      onInvited(i);
      setEmail("");
    },
  });
  const fe = isApiError(mutation.error) ? mutation.error.fieldErrors : undefined;
  return (
    <div className="flex flex-col gap-5">
      <p>Mời thêm người chăm sóc hoặc người xem. Bản demo ghi lời mời vào hộp thông báo nội bộ, không gửi email.</p>
      <form
        noValidate
        className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem_auto] md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <InsetField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fe?.email} />
        <InsetSelect label="Vai trò" value={role} onChange={(e) => setRole(e.target.value as "caregiver" | "viewer")}>
          <option value="caregiver">Người chăm sóc</option>
          <option value="viewer">Người xem</option>
        </InsetSelect>
        <SoftButton type="submit" loading={mutation.isPending}>
          Tạo lời mời
        </SoftButton>
      </form>
      {mutation.isError && !fe ? <InlineError>{errorMessage(mutation.error)}</InlineError> : null}
      {invites.length ? (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {invites.map((i) => (
            <li key={i.id} className="rounded-control p-3 shadow-inset-sm">
              {i.email} · {i.role === "caregiver" ? "Người chăm sóc" : "Người xem"} · chờ chấp nhận đến {formatDateTime(i.expiresAt)}
            </li>
          ))}
        </ul>
      ) : null}
      <SoftButton variant={invites.length ? "primary" : "secondary"} className="self-end" onClick={onNext}>
        {invites.length ? "Tiếp tục" : "Bỏ qua bước này"}
      </SoftButton>
    </div>
  );
}

function TestNotification({ delivery, onSent }: { delivery: NotificationDelivery | null; onSent: (d: NotificationDelivery) => void }) {
  const adapter = useAdapter();
  const sink = useQuery({
    queryKey: qk.notificationSink(),
    queryFn: () => adapter.listNotificationSink(),
    enabled: Boolean(delivery),
    refetchInterval: (q) => (q.state.data?.find((d) => d.id === delivery?.id)?.status === "queued" ? 600 : false),
  });
  const mutation = useMutation({ mutationFn: () => adapter.sendTestNotification(), onSuccess: onSent });
  const current = sink.data?.find((d) => d.id === delivery?.id) ?? delivery;
  return (
    <div className="flex flex-col gap-3">
      <SoftButton className="self-start" loading={mutation.isPending} onClick={() => mutation.mutate()}>
        Gửi thông báo thử
      </SoftButton>
      {mutation.isError ? <InlineError>{errorMessage(mutation.error)}</InlineError> : null}
      {current ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-control p-4 shadow-inset-sm">
          <span className="font-medium">[Thử] {current.title}</span>
          <StatusLabel tone={current.status === "provider_accepted" ? "success" : "neutral"}>
            {current.status === "provider_accepted" ? "Đã ghi vào hộp nội bộ" : current.status === "queued" ? "Đang chờ" : "Thất bại"}
          </StatusLabel>
        </div>
      ) : null}
    </div>
  );
}
