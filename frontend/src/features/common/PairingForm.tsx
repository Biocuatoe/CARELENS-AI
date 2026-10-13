import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdapter } from "../../data";
import type { Device, PairingChallenge, Product } from "../../data/contracts";
import { errorMessage, isApiError } from "../../data/errors";
import { qk } from "../../data/queryKeys";
import { InlineError, Notice } from "../../design-system/feedback";
import { InsetField, InsetSelect, SoftButton } from "../../design-system/primitives";
import { formatDateTime } from "../../lib/time";
import { PRODUCT_LABELS } from "./labels";

const DEMO_HINTS: Record<Product, { serial: string; code: string }> = {
  carelens: { serial: "CL-HUB-DEMO-3001", code: "246810" },
  ecopatch: { serial: "EP-CORE-DEMO-5002", code: "135790" },
};

/**
 * Ghép thiết bị hai bước: serial → mã kích hoạt (challenge). QR/serial một mình không đủ để nhận thiết bị (AC17).
 * Không báo "đã kết nối" cho tới khi server xác nhận.
 */
export function PairingForm({
  recipientId,
  products,
  onPaired,
  showDemoHints,
}: {
  recipientId: string;
  products: Product[];
  onPaired: (device: Device) => void;
  showDemoHints: boolean;
}) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const [product, setProduct] = useState<Product>(products[0] ?? "carelens");
  const [serial, setSerial] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<PairingChallenge | null>(null);
  const [cancelledMessage, setCancelledMessage] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => adapter.startPairing(recipientId, { product, serial }),
    onMutate: () => setCancelledMessage(null),
    onSuccess: (c) => {
      setChallenge(c);
      setCode("");
    },
  });
  const confirm = useMutation({
    mutationFn: () => adapter.confirmPairing(recipientId, challenge!.id, code),
    onSuccess: (device) => {
      void queryClient.invalidateQueries({ queryKey: qk.recipient(recipientId) });
      void queryClient.invalidateQueries({ queryKey: qk.recipients() });
      onPaired(device);
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409) {
        setChallenge(null);
        setCancelledMessage(error.message);
      }
    },
  });
  const fieldError = (error: unknown, key: string) => (isApiError(error) ? error.fieldErrors?.[key] : undefined);

  if (challenge) {
    return (
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          confirm.mutate();
        }}
      >
        <p role="status" className="font-medium">
          Đang chờ xác minh {PRODUCT_LABELS[challenge.product]} {challenge.serial}. Mã hết hạn lúc {formatDateTime(challenge.expiresAt)}.
        </p>
        <InsetField
          label="Mã kích hoạt"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={fieldError(confirm.error, "code")}
          hint={showDemoHints ? `Bản demo: mã là ${DEMO_HINTS[challenge.product].code}.` : "Mã đi kèm thiết bị."}
        />
        {confirm.isError && !fieldError(confirm.error, "code") ? <InlineError>{errorMessage(confirm.error)}</InlineError> : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <SoftButton onClick={() => setChallenge(null)} disabled={confirm.isPending}>
            Nhập serial khác
          </SoftButton>
          <SoftButton type="submit" variant="primary" loading={confirm.isPending}>
            {confirm.isPending ? "Đang xác minh…" : "Xác minh và gán"}
          </SoftButton>
        </div>
      </form>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start.mutate();
      }}
    >
      {cancelledMessage ? <InlineError title="Phiên ghép đã kết thúc">{cancelledMessage}</InlineError> : null}
      {products.length > 1 ? (
        <InsetSelect label="Giải pháp" value={product} onChange={(e) => setProduct(e.target.value as Product)}>
          {products.map((p) => (
            <option key={p} value={p}>
              {PRODUCT_LABELS[p]}
            </option>
          ))}
        </InsetSelect>
      ) : (
        <Notice>Thiết bị {PRODUCT_LABELS[product]}</Notice>
      )}
      <InsetField
        label="Số serial"
        required
        autoComplete="off"
        value={serial}
        onChange={(e) => setSerial(e.target.value)}
        error={fieldError(start.error, "serial")}
        hint={showDemoHints ? `Bản demo: dùng ${DEMO_HINTS[product].serial}.` : "In trên thiết bị hoặc hộp."}
      />
      {start.isError && !fieldError(start.error, "serial") ? <InlineError title="Không bắt đầu được">{errorMessage(start.error)}</InlineError> : null}
      <SoftButton type="submit" variant="primary" loading={start.isPending} className="self-start">
        Tiếp tục
      </SoftButton>
    </form>
  );
}
