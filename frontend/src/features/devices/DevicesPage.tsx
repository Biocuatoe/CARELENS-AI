import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Link2, RefreshCw, ScanEye, Sticker, Unlink } from "lucide-react";
import { useAdapter } from "../../data";
import type { Device, PatchSession, Product } from "../../data/contracts";
import { errorMessage, isApiError } from "../../data/errors";
import { qk } from "../../data/queryKeys";
import { DemoBadge, EmptyState, InlineError, Notice, StatusLabel } from "../../design-system/feedback";
import { Dialog, Disclosure } from "../../design-system/overlays";
import { IconWell, InsetField, SoftButton, SoftSurface } from "../../design-system/primitives";
import { formatDate, formatDateTime, formatRelative, fromDateInputValue, fromLocalInputValue, toLocalInputValue } from "../../lib/time";
import { ConnectionLabel, PageHeader, ProductTag, QueryState, SectionTitle } from "../common/components";
import { PRODUCT_LABELS } from "../common/labels";
import { useRecipient } from "../common/recipient";
import { PairingForm } from "../common/PairingForm";
import { useDemoBadgeLabel } from "../../app/auth";

const GUIDES: Record<Product, Array<{ title: string; steps: string[] }>> = {
  carelens: [
    {
      title: "Ghép hub CareLens",
      steps: [
        "Cắm nguồn cho hub và kết nối hub vào mạng gia đình.",
        "Nhập số serial in trên hub, sau đó nhập mã kích hoạt đi kèm thiết bị.",
        "Chờ ứng dụng xác minh. Chỉ khi xác minh thành công, hub mới được gán cho hồ sơ.",
      ],
    },
    {
      title: "Hub báo mất kết nối",
      steps: [
        "Kiểm tra hub còn nguồn điện và đèn trạng thái của thiết bị.",
        "Kiểm tra mạng gia đình. Hub chỉ truy cập được trong mạng gia đình nếu chưa có cấu hình truy cập từ xa.",
        "Trong lúc mất kết nối, ứng dụng không nhận sự kiện mới. Hãy chủ động kiểm tra người thân bằng cách khác.",
      ],
    },
  ],
  ecopatch: [
    {
      title: "Gắn lõi vào miếng dán mới",
      steps: [
        "Tháo lõi khỏi miếng dán cũ.",
        "Gắn lõi vào miếng dán mới theo hướng dẫn của nhà sản xuất.",
        "Ghi nhận thay miếng dán trong ứng dụng, sau đó kiểm tra chất lượng tín hiệu ở trang EcoPatch.",
      ],
    },
    {
      title: "Tín hiệu kém hoặc không có phép đo",
      steps: [
        "Kiểm tra lõi đã gắn chắc vào miếng dán và miếng dán tiếp xúc tốt.",
        "Kiểm tra điện thoại hoặc gateway nhận dữ liệu đang bật và ở gần.",
        "Tín hiệu kém có thể làm giá trị không chính xác. Không dùng giá trị khi tín hiệu kém để kết luận.",
      ],
    },
  ],
};

export function DevicesPage() {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const { recipient, recipientId, can, enrolled } = useRecipient();
  const demoBadgeLabel = useDemoBadgeLabel();
  const [params, setParams] = useSearchParams();
  const [pairingOpen, setPairingOpen] = useState(false);
  const [unassignTarget, setUnassignTarget] = useState<Device | null>(null);
  const [checkResult, setCheckResult] = useState<Record<string, string>>({});

  const devices = useQuery({ queryKey: qk.devices(recipientId), queryFn: () => adapter.listDevices(recipientId) });
  const patches = useQuery({
    queryKey: qk.patches(recipientId),
    queryFn: () => adapter.listPatchSessions(recipientId),
    enabled: enrolled("ecopatch") && can("data.read"),
  });

  const check = useMutation({
    mutationFn: (deviceId: string) => adapter.checkDevice(recipientId, deviceId),
    onSuccess: (device) => {
      queryClient.setQueryData<Device[]>(qk.devices(recipientId), (old) => old?.map((d) => (d.id === device.id ? device : d)));
      setCheckResult((r) => ({
        ...r,
        [device.id]: `Kết quả kiểm tra lúc ${formatDateTime(new Date().toISOString())}: tín hiệu gần nhất ${formatRelative(device.lastSeenAt)}.`,
      }));
    },
    onError: (error, deviceId) => setCheckResult((r) => ({ ...r, [deviceId]: errorMessage(error) })),
  });

  const replaceCoreId = params.get("replace");
  const closeReplace = () => {
    const next = new URLSearchParams(params);
    next.delete("replace");
    setParams(next, { replace: true });
  };

  const missingProducts = recipient.enrollments.filter((e) => !(devices.data ?? []).some((d) => d.product === e.product));

  return (
    <>
      <PageHeader
        title="Thiết bị & hướng dẫn"
        eyebrow={<DemoBadge label={demoBadgeLabel} />}
        description="Thiết bị được gán cho hồ sơ, trạng thái kết nối và thao tác được phép."
        actions={
          can("devices.manage") ? (
            <SoftButton variant="primary" onClick={() => setPairingOpen(true)}>
              <Link2 className="size-5" aria-hidden />
              Ghép thiết bị
            </SoftButton>
          ) : null
        }
      />

      <div className="flex flex-col gap-8">
        <SoftSurface as="section" aria-labelledby="devices-title">
          <SectionTitle id="devices-title">Thiết bị của hồ sơ</SectionTitle>
          <QueryState query={devices}>
            {(items) => (
              <div className="flex flex-col gap-4">
                {items.length === 0 ? (
                  <EmptyState icon={<Cpu />} title="Chưa ghép thiết bị nào">
                    <p>{can("devices.manage") ? "Dùng “Ghép thiết bị” để bắt đầu." : "Người quản lý hồ sơ cần ghép thiết bị."}</p>
                  </EmptyState>
                ) : (
                  <ul className="flex flex-col gap-4">
                    {items.map((d) => (
                      <li key={d.id} className="flex flex-col gap-4 rounded-control p-4 shadow-inset-sm md:p-5">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center">
                          <IconWell>{d.product === "carelens" ? <ScanEye /> : <Cpu />}</IconWell>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold">
                              {d.label} <span className="font-medium">· {d.serialMasked}</span>
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <ProductTag product={d.product} />
                              <ConnectionLabel state={d.connection} />
                            </div>
                          </div>
                        </div>
                        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <dt className="text-sm">Tín hiệu gần nhất</dt>
                            <dd className="font-medium">{d.lastSeenAt ? `${formatRelative(d.lastSeenAt)}` : "Chưa từng nhận"}</dd>
                          </div>
                          <div>
                            <dt className="text-sm">Pin</dt>
                            <dd className="font-medium">{d.batteryPercent !== null ? `${d.batteryPercent}%` : "Thiết bị không cung cấp"}</dd>
                          </div>
                          <div>
                            <dt className="text-sm">Gán từ</dt>
                            <dd className="font-medium">{formatDate(d.assignedFrom)}</dd>
                          </div>
                          <div>
                            <dt className="text-sm">Nguồn dữ liệu</dt>
                            <dd className="font-medium">{d.sourceMode === "simulated" ? "Mô phỏng" : "Thiết bị"}</dd>
                          </div>
                        </dl>
                        {checkResult[d.id] ? (
                          <p role="status" className="text-sm font-medium">
                            {checkResult[d.id]}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-3">
                          <SoftButton size="sm" loading={check.isPending && check.variables === d.id} onClick={() => check.mutate(d.id)}>
                            <RefreshCw className="size-4" aria-hidden />
                            Kiểm tra kết nối
                          </SoftButton>
                          {d.kind === "ecopatch_core" && can("patches.replace") ? (
                            <SoftButton
                              size="sm"
                              onClick={() => {
                                const next = new URLSearchParams(params);
                                next.set("replace", d.id);
                                setParams(next);
                              }}
                            >
                              <Sticker className="size-4" aria-hidden />
                              Thay miếng dán
                            </SoftButton>
                          ) : null}
                          {can("devices.manage") ? (
                            <SoftButton size="sm" onClick={() => setUnassignTarget(d)}>
                              <Unlink className="size-4" aria-hidden />
                              Gỡ khỏi hồ sơ
                            </SoftButton>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {missingProducts.length ? (
                  <Notice title="Giải pháp chưa có thiết bị">
                    {missingProducts.map((e) => PRODUCT_LABELS[e.product]).join(", ")} chưa có thiết bị gửi dữ liệu. Thiết lập chưa hoàn tất.
                  </Notice>
                ) : null}
              </div>
            )}
          </QueryState>
        </SoftSurface>

        {enrolled("ecopatch") && can("data.read") ? (
          <SoftSurface as="section" aria-labelledby="patch-history-title">
            <SectionTitle id="patch-history-title">Lịch sử miếng dán</SectionTitle>
            <QueryState query={patches}>
              {(sessions) => <PatchHistory sessions={sessions} />}
            </QueryState>
          </SoftSurface>
        ) : null}

        <SoftSurface as="section" aria-labelledby="guide-title">
          <SectionTitle id="guide-title">Hướng dẫn sử dụng</SectionTitle>
          <div className="flex flex-col gap-4">
            {recipient.enrollments.flatMap((e) =>
              GUIDES[e.product].map((g) => (
                <Disclosure key={`${e.product}-${g.title}`} leading={<ProductTag product={e.product} />} summary={g.title}>
                  <ol className="list-decimal pl-6">
                    {g.steps.map((s) => (
                      <li key={s} className="py-1">
                        {s}
                      </li>
                    ))}
                  </ol>
                </Disclosure>
              )),
            )}
          </div>
        </SoftSurface>
      </div>

      {pairingOpen ? <PairingDialog onClose={() => setPairingOpen(false)} /> : null}
      <UnassignDialog device={unassignTarget} onClose={() => setUnassignTarget(null)} />
      {replaceCoreId ? (
        <ReplacePatchDialog
          core={devices.data?.find((d) => d.id === replaceCoreId && d.kind === "ecopatch_core") ?? null}
          loading={devices.isPending}
          current={patches.data?.find((p) => p.coreDeviceId === replaceCoreId && !p.endedAt) ?? null}
          onClose={closeReplace}
        />
      ) : null}
    </>
  );
}

function PatchHistory({ sessions }: { sessions: PatchSession[] }) {
  if (sessions.length === 0) return <p>Chưa ghi nhận miếng dán nào.</p>;
  return (
    <>
      <ul className="flex flex-col gap-3 md:hidden">
        {sessions.map((s) => (
          <li key={s.id} className="rounded-control p-4 shadow-inset-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="font-medium">Bắt đầu</dt>
                <dd>{formatDateTime(s.startedAt)}</dd>
              </div>
              <div>
                <dt className="font-medium">Kết thúc</dt>
                <dd>{s.endedAt ? formatDateTime(s.endedAt) : <StatusLabel tone="neutral">Đang dùng</StatusLabel>}</dd>
              </div>
              <div>
                <dt className="font-medium">Dự kiến thay</dt>
                <dd>{s.expectedReplaceAt ? formatDate(s.expectedReplaceAt) : "Chưa đặt"}</dd>
              </div>
              <div>
                <dt className="font-medium">Mã lô</dt>
                <dd>{s.lotCode ?? "Không nhập"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="font-medium">Người ghi</dt>
                <dd>{s.createdByName}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[36rem] border-separate border-spacing-y-2 text-left">
          <caption className="sr-only">Lịch sử phiên miếng dán</caption>
          <thead>
            <tr className="text-sm">
              <th scope="col" className="px-4 font-bold">Bắt đầu</th>
              <th scope="col" className="px-4 font-bold">Kết thúc</th>
              <th scope="col" className="px-4 font-bold">Dự kiến thay</th>
              <th scope="col" className="px-4 font-bold">Mã lô</th>
              <th scope="col" className="px-4 font-bold">Người ghi</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="shadow-inset-sm [&>td:first-child]:rounded-l-control [&>td:last-child]:rounded-r-control">
                <td className="px-4 py-3">{formatDateTime(s.startedAt)}</td>
                <td className="px-4 py-3">{s.endedAt ? formatDateTime(s.endedAt) : <StatusLabel tone="neutral">Đang dùng</StatusLabel>}</td>
                <td className="px-4 py-3">{s.expectedReplaceAt ? formatDate(s.expectedReplaceAt) : "Chưa đặt"}</td>
                <td className="px-4 py-3">{s.lotCode ?? "Không nhập"}</td>
                <td className="px-4 py-3">{s.createdByName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PairingDialog({ onClose }: { onClose: () => void }) {
  const adapter = useAdapter();
  const { recipient, recipientId } = useRecipient();
  const [paired, setPaired] = useState<Device | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Ghép thiết bị"
      description="Số serial hoặc mã QR không đủ để nhận thiết bị. Cần mã kích hoạt để xác minh quyền sở hữu."
    >
      {paired ? (
        <>
          <Notice title="Đã gán thiết bị cho hồ sơ">
            {paired.label} · {paired.serialMasked} đã được xác minh và gán cho {recipient.displayName}.
            {paired.sourceMode === "simulated" ? " Đây là kết quả mô phỏng." : ""}
          </Notice>
          <SoftButton variant="primary" onClick={onClose}>
            Xong
          </SoftButton>
        </>
      ) : (
        <PairingForm
          recipientId={recipientId}
          products={recipient.enrollments.map((e) => e.product)}
          onPaired={setPaired}
          showDemoHints={adapter.mode === "demo"}
        />
      )}
    </Dialog>
  );
}

function UnassignDialog({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const { recipient, recipientId } = useRecipient();
  const mutation = useMutation({
    mutationFn: (id: string) => adapter.unassignDevice(recipientId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.recipient(recipientId) });
      onClose();
    },
  });

  return (
    <Dialog
      open={Boolean(device)}
      onClose={() => {
        mutation.reset();
        onClose();
      }}
      busy={mutation.isPending}
      title="Gỡ thiết bị khỏi hồ sơ?"
      footer={
        <>
          <SoftButton onClick={onClose} disabled={mutation.isPending}>
            Hủy
          </SoftButton>
          <SoftButton variant="primary" loading={mutation.isPending} onClick={() => device && mutation.mutate(device.id)}>
            Gỡ thiết bị
          </SoftButton>
        </>
      }
    >
      {device ? (
        <>
          <p>
            <span className="font-bold">
              {device.label} · {device.serialMasked}
            </span>{" "}
            sẽ ngừng gửi dữ liệu cho <span className="font-bold">{recipient.displayName}</span> từ bây giờ.
          </p>
          <ul className="list-disc pl-5">
            <li>Dữ liệu đã nhận trước thời điểm gỡ vẫn thuộc hồ sơ này.</li>
            {device.kind === "ecopatch_core" ? <li>Phiên miếng dán đang dùng sẽ được kết thúc.</li> : null}
            <li>Giải pháp {PRODUCT_LABELS[device.product]} sẽ ở trạng thái chưa hoàn tất thiết lập nếu không còn thiết bị.</li>
          </ul>
          {mutation.isError ? <InlineError title="Chưa gỡ được thiết bị">{errorMessage(mutation.error)}</InlineError> : null}
        </>
      ) : null}
    </Dialog>
  );
}

function ReplacePatchDialog({
  core,
  current,
  loading,
  onClose,
}: {
  core: Device | null;
  current: PatchSession | null;
  loading: boolean;
  onClose: () => void;
}) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const { recipient, recipientId, can } = useRecipient();
  const [startedAt, setStartedAt] = useState(() => toLocalInputValue(new Date().toISOString()));
  const [lotCode, setLotCode] = useState("");
  const [expected, setExpected] = useState("");
  // Khóa idempotency sinh một lần cho mỗi lần mở form: gửi lại không tạo phiên trùng (AC10).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<PatchSession | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      adapter.replacePatch(recipientId, core!.id, {
        startedAt: fromLocalInputValue(startedAt),
        lotCode: lotCode.trim() || null,
        expectedReplaceAt: expected ? fromDateInputValue(expected, true) : null,
        idempotencyKey,
      }),
    onSuccess: (session) => {
      setResult(session);
      void queryClient.invalidateQueries({ queryKey: qk.patches(recipientId) });
      void queryClient.invalidateQueries({ queryKey: qk.overview(recipientId) });
      void queryClient.invalidateQueries({ queryKey: qk.history(recipientId) });
    },
  });
  const fe = isApiError(mutation.error) ? mutation.error.fieldErrors : undefined;

  return (
    <Dialog open onClose={onClose} busy={mutation.isPending} title="Thay miếng dán EcoPatch">
      {loading ? (
        <p>Đang tải thiết bị…</p>
      ) : !core ? (
        <InlineError title="Không tìm thấy lõi EcoPatch">Thiết bị không thuộc hồ sơ này hoặc đã được gỡ.</InlineError>
      ) : !can("patches.replace") ? (
        <Notice>Bạn không có quyền ghi nhận thay miếng dán.</Notice>
      ) : result ? (
        <>
          <Notice title="Đã ghi nhận miếng dán mới (mô phỏng)">
            Phiên mới bắt đầu {formatDateTime(result.startedAt)}. Phiên trước đã kết thúc và vẫn nằm trong lịch sử. Hãy kiểm tra lại chất lượng tín hiệu.
          </Notice>
          <SoftButton variant="primary" onClick={onClose}>
            Xong
          </SoftButton>
        </>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <dl className="grid gap-2 rounded-control p-4 shadow-inset-sm">
            <div>
              <dt className="text-sm">Hồ sơ</dt>
              <dd className="font-medium">{recipient.displayName}</dd>
            </div>
            <div>
              <dt className="text-sm">Lõi thiết bị</dt>
              <dd className="font-medium">
                {core.label} · {core.serialMasked}
              </dd>
            </div>
            <div>
              <dt className="text-sm">Miếng dán hiện tại</dt>
              <dd className="font-medium">
                {current ? `Bắt đầu ${formatDateTime(current.startedAt)}${current.lotCode ? ` · ${current.lotCode}` : ""}` : "Chưa có"}
              </dd>
            </div>
          </dl>
          <InsetField
            label="Thời điểm bắt đầu miếng dán mới"
            type="datetime-local"
            required
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
            error={fe?.startedAt}
            hint="Giờ Việt Nam (UTC+7)"
          />
          <InsetField label="Mã lô (không bắt buộc)" value={lotCode} onChange={(e) => setLotCode(e.target.value)} maxLength={40} error={fe?.lotCode} />
          <InsetField
            label="Ngày dự kiến thay (không bắt buộc)"
            type="date"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            error={fe?.expectedReplaceAt}
            hint="Ứng dụng chỉ nhắc thay khi bạn nhập ngày. Không tự suy ra vòng đời miếng dán."
          />
          {mutation.isError && !fe ? <InlineError title="Chưa lưu được">{errorMessage(mutation.error)}</InlineError> : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <SoftButton onClick={onClose} disabled={mutation.isPending}>
              Hủy
            </SoftButton>
            <SoftButton type="submit" variant="primary" loading={mutation.isPending}>
              Ghi nhận thay miếng dán
            </SoftButton>
          </div>
        </form>
      )}
    </Dialog>
  );
}
