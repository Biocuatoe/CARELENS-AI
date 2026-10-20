import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { useAdminAuth } from "../../app/adminAuth";
import type { AdminCapabilities, AdminDevice } from "../../data/admin/adminClient";
import { StatusLabel } from "../../design-system/feedback";
import { Dialog } from "../../design-system/overlays";
import { InsetSelect, SoftButton } from "../../design-system/primitives";
import { formatDateTime } from "../../lib/time";
import { Card, Row } from "./AdminParts";
import { errorMessage } from "./useAdminLoad";

const percent = (v: number) => `${Math.round(v * 100)}%`;
/** How long the page keeps asking for the device's own report after a change (the device applies it at its next heartbeat, 60 s). */
const WAIT_FOR_DEVICE_MS = 3 * 60_000;

/**
 * Speaker volume of one device. Two facts are shown apart and never merged: the value an admin set on the server (delivered with
 * the device's next heartbeat) and the value the device itself last reported applying. "Applied" is only ever the device's word.
 */
export function SpeakerVolumeCard({ device, caps, onChanged }: { device: AdminDevice; caps: AdminCapabilities | null; onChanged: () => void }) {
  const { run } = useAdminAuth();
  const range = caps?.speakerVolume ?? null;
  const speaker = device.speaker;
  const [choice, setChoice] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);

  const pending = speaker !== null && speaker.desiredVolume !== null && speaker.reportedVolume !== speaker.desiredVolume;
  // After a change, look at the device again every 10 s until it reports the new value, for at most three minutes.
  useEffect(() => {
    if (!pending || waitUntil === null) return;
    const timer = setInterval(() => {
      if (Date.now() > waitUntil) {
        setWaitUntil(null);
        return;
      }
      if (!document.hidden) onChanged();
    }, 10_000);
    return () => clearInterval(timer);
  }, [pending, waitUntil, onChanged]);

  if (!speaker || !range) {
    return (
      <Card icon={<Volume2 aria-hidden />} title="Âm lượng loa">
        <p>Máy chủ này chưa hỗ trợ chỉnh âm lượng loa từ xa (cần phiên bản Worker có thiết lập này).</p>
      </Card>
    );
  }

  const options: number[] = [];
  for (let v = range.min; v <= range.max + 1e-9; v += range.step) options.push(Math.round(v * 100) / 100);
  const current = choice ?? speaker.desiredVolume ?? speaker.reportedVolume ?? range.default;
  const active = device.status === "active";

  const apply = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await run((client, token) => client.setSpeakerVolume(token, device.deviceId, current));
      setConfirming(false);
      setChoice(null);
      setWaitUntil(Date.now() + WAIT_FOR_DEVICE_MS);
      setMessage(`Đã đặt ${percent(r.desiredVolume)} trên máy chủ. Thiết bị nhận ở lần heartbeat kế tiếp (thường trong vòng 60 giây); chỉ khi thiết bị tự báo mới tính là đã áp dụng.`);
      onChanged();
    } catch (error) {
      setMessage(errorMessage(error, "Không đổi được âm lượng."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card icon={<Volume2 aria-hidden />} title="Âm lượng loa">
      <dl>
        <Row label="Thiết bị báo đang dùng">
          {speaker.reportedVolume === null ? "Thiết bị chưa báo" : `${percent(speaker.reportedVolume)} (lúc ${formatDateTime(speaker.reportedAt)})`}
        </Row>
        <Row label="Mức đặt trên máy chủ">
          {speaker.desiredVolume === null ? "Chưa đặt (thiết bị dùng mức của nó)" : `${percent(speaker.desiredVolume)} (lúc ${formatDateTime(speaker.desiredSetAt)})`}
        </Row>
      </dl>
      {pending ? <StatusLabel tone="attention">Đang chờ thiết bị áp dụng mức mới</StatusLabel> : null}
      <div className="flex flex-wrap items-end gap-4">
        <InsetSelect label="Mức mới" value={current} onChange={(e) => setChoice(Number(e.target.value))} wrapperClassName="min-w-40" disabled={!active}>
          {options.map((v) => (
            <option key={v} value={v}>
              {percent(v)}
            </option>
          ))}
        </InsetSelect>
        <SoftButton onClick={() => setConfirming(true)} disabled={!active || busy}>
          Đặt âm lượng…
        </SoftButton>
      </div>
      <p className="text-xs">
        Phần trăm của biên độ số tối đa. Mức cao nhất {percent(range.max)} là giới hạn phần mềm thận trọng cho loa 8 Ω 1 W, không phải số đo công suất. Mức của
        bản sketch gốc là {percent(range.default)}.
      </p>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        busy={busy}
        title="Xác nhận đổi âm lượng loa"
        description="Âm lượng mới áp dụng cho mọi âm thanh của thiết bị: lời chào, lời nhắn, nhắc lịch và còi."
        footer={
          <>
            <SoftButton variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Không đổi
            </SoftButton>
            <SoftButton onClick={() => void apply()} disabled={busy}>
              {busy ? "Đang lưu…" : `Đặt ${percent(current)}`}
            </SoftButton>
          </>
        }
      >
        <p>
          {device.label} ({device.deviceId}): {speaker.reportedVolume === null ? "thiết bị chưa báo mức hiện tại" : `thiết bị báo đang dùng ${percent(speaker.reportedVolume)}`}; mức mới {percent(current)}.
        </p>
      </Dialog>
    </Card>
  );
}
