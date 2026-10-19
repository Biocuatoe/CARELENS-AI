import { useEffect, useRef, useState } from "react";
import { Info, Play, RefreshCw, Send, Upload, Volume2 } from "lucide-react";
import { useAdminAuth } from "../../app/adminAuth";
import { TERMINAL_COMMAND_STATUSES, type AdminCapabilities, type AdminCommand, type AdminDevice, type VoiceMessage } from "../../data/admin/adminClient";
import { Dialog } from "../../design-system/overlays";
import { EmptyState, InlineError, LoadingState, Notice, StatusLabel } from "../../design-system/feedback";
import { Choice, InsetField, InsetSelect, SoftButton } from "../../design-system/primitives";
import { formatDateTime } from "../../lib/time";
import { Card } from "./AdminParts";
import { DeviceScope } from "./DeviceScope";
import { COMMAND_STATUS_LABELS, COMMAND_TYPE_LABELS, REASON_LABELS } from "./labels";
import { errorMessage, useAdminLoad } from "./useAdminLoad";
import { inspectWav, newIdempotencyKey } from "./wav";

const EXPIRY_CHOICES: Array<{ seconds: number; label: string }> = [
  { seconds: 60, label: "1 phút" },
  { seconds: 300, label: "5 phút" },
  { seconds: 900, label: "15 phút" },
  { seconds: 3600, label: "1 giờ" },
];

const seconds = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1).replace(".", ",")} giây`);

/** Plays a stored recording from a blob in this browser. The recording has no shareable URL; the blob is revoked on leaving. */
function Preview({ voiceMessageId }: { voiceMessageId: string }) {
  const { run } = useAdminAuth();
  const [view, setView] = useState<{ status: "idle" } | { status: "loading" } | { status: "ready"; url: string } | { status: "error"; message: string }>({ status: "idle" });
  const urlRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );
  const load = async () => {
    setView({ status: "loading" });
    try {
      const blob = await run((client, token) => client.voiceAudio(token, voiceMessageId));
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setView({ status: "ready", url: urlRef.current });
    } catch (error) {
      setView({ status: "error", message: errorMessage(error, "Không tải được bản ghi để nghe thử.") });
    }
  };
  if (view.status === "ready") return <audio controls src={view.url} className="w-full max-w-xs" aria-label="Nghe thử bản ghi" />;
  return (
    <span className="flex flex-col items-start gap-1">
      <SoftButton size="sm" variant="secondary" onClick={() => void load()} disabled={view.status === "loading"}>
        <Play className="size-4" aria-hidden />
        {view.status === "loading" ? "Đang tải…" : "Nghe thử"}
      </SoftButton>
      {view.status === "error" ? <span role="alert" className="text-xs">{view.message}</span> : null}
    </span>
  );
}

function UploadForm({ device, caps, capsError, onUploaded }: { device: AdminDevice; caps: AdminCapabilities | null; capsError: string | null; onUploaded: (v: VoiceMessage) => void }) {
  const { run } = useAdminAuth();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (f: File | null) => {
    setFile(null);
    setProblem(null);
    setDone(null);
    if (!f || !caps) return;
    const checked = inspectWav(new Uint8Array(await f.arrayBuffer()), {
      sampleRatesHz: caps.audio.sampleRatesHz,
      maxBytes: caps.audio.maxBytes ?? 2_200_000,
      minDurationMs: caps.audio.minDurationMs ?? 500,
      maxDurationMs: caps.audio.maxDurationMs ?? 60_000,
    });
    if (typeof checked === "string") setProblem(checked);
    else setFile(f);
  };

  const submit = async () => {
    if (!file || !title.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const v = await run((client, token) => client.uploadVoice(token, device.deviceId, title.trim(), file));
      setDone(`Đã lưu “${v.title}”. Bản ghi nằm trong kho riêng tư; chưa có gì được gửi tới thiết bị.`);
      setFile(null);
      setTitle("");
      if (inputRef.current) inputRef.current.value = "";
      onUploaded(v);
    } catch (error) {
      setProblem(errorMessage(error, "Không tải lên được."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <InsetField label="Tên bản ghi" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
      <InsetField
        ref={inputRef}
        label="Tệp âm thanh WAV"
        type="file"
        accept=".wav,audio/wav,audio/x-wav"
        hint={
          caps
            ? `WAV PCM 16-bit mono, ${caps.audio.sampleRatesHz.join(" / ")} Hz, ${(caps.audio.minDurationMs ?? 500) / 1000}–${(caps.audio.maxDurationMs ?? 60000) / 1000} giây, tối đa ${((caps.audio.maxBytes ?? 2_200_000) / 1_000_000).toFixed(1).replace(".", ",")} MB. Đổi định dạng khác bằng ffmpeg: ffmpeg -i vao.m4a -ac 1 -ar 16000 -sample_fmt s16 ra.wav`
            : (capsError ?? "Đang tải giới hạn của máy chủ…")
        }
        disabled={!caps || device.status !== "active"}
        onChange={(e) => void pick(e.target.files?.[0] ?? null)}
        error={problem ?? undefined}
      />
      {done ? <Notice role="status">{done}</Notice> : null}
      <div>
        <SoftButton type="submit" disabled={!file || !title.trim() || busy || !caps || device.status !== "active"}>
          <Upload className="size-4" aria-hidden />
          {busy ? "Đang tải lên…" : "Tải lên kho riêng tư"}
        </SoftButton>
      </div>
    </form>
  );
}

function CommandRow({ command, onChanged }: { command: AdminCommand; onChanged: () => void }) {
  const { run } = useAdminAuth();
  const info = COMMAND_STATUS_LABELS[command.status];
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = !TERMINAL_COMMAND_STATUSES.includes(command.status) && command.status !== "unknown";
  const cancel = async () => {
    setBusy(true);
    try {
      const result = await run((client, token) => client.cancelCommand(token, command.commandId));
      setNote(result.cancelPendingDeviceConfirmation ? "Đã gửi yêu cầu hủy; thiết bị phải xác nhận mới coi là đã dừng." : "Đã hủy.");
      onChanged();
    } catch (error) {
      setNote(errorMessage(error, "Không hủy được."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-control bg-surface p-3 shadow-inset-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">{COMMAND_TYPE_LABELS[command.commandType] ?? command.commandType}</span>
        <StatusLabel tone={info.tone}>{info.label}</StatusLabel>
      </div>
      <p className="text-xs">
        {command.commandId} · tạo {formatDateTime(command.createdAt)} · hết hạn {formatDateTime(command.expiresAt)}
        {command.statusReason ? ` · ${REASON_LABELS[command.statusReason] ?? command.statusReason}` : ""}
      </p>
      <p className="text-xs">
        {command.playedConfirmedByDevice
          ? "Thiết bị đã báo phát xong."
          : "Chưa có xác nhận phát xong từ thiết bị — không được coi là đã phát."}
        {command.cancelRequestedAt ? " Đã yêu cầu hủy, chờ thiết bị xác nhận." : ""}
      </p>
      {live ? (
        <div className="mt-2">
          <SoftButton size="sm" variant="secondary" onClick={() => void cancel()} disabled={busy}>
            Hủy lệnh
          </SoftButton>
        </div>
      ) : null}
      {note ? <p role="status" className="mt-1 text-xs">{note}</p> : null}
    </li>
  );
}

function CommandTracker({ deviceId, version }: { deviceId: string; version: number }) {
  const { state, reload, refresh } = useAdminLoad((client, token) => client.commands(token, deviceId), `commands|${deviceId}|${version}`);
  const hasLive = state.status === "ready" && state.data.items.some((c) => !TERMINAL_COMMAND_STATUSES.includes(c.status) && c.status !== "unknown");
  // While a command is still open, look again every few seconds: the only way to learn the device's acknowledgement is to ask the server.
  useEffect(() => {
    if (!hasLive) return;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [hasLive, refresh]);
  return (
    <Card
      icon={<Send aria-hidden />}
      title="Lệnh đã gửi và xác nhận từ thiết bị"
    >
      <div>
        <SoftButton size="sm" variant="secondary" onClick={reload} disabled={state.status === "loading"}>
          <RefreshCw className="size-4" aria-hidden />
          Làm mới
        </SoftButton>
      </div>
      {state.status === "loading" ? <LoadingState label="Đang tải lệnh…" /> : null}
      {state.status === "error" ? (
        <InlineError title="Không tải được danh sách lệnh" onRetry={reload}>
          {state.message}
        </InlineError>
      ) : null}
      {state.status === "ready" && state.data.items.length === 0 ? <p>Chưa có lệnh nào được tạo cho thiết bị này.</p> : null}
      {state.status === "ready" && state.data.items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {state.data.items.map((c) => (
            <CommandRow key={c.commandId} command={c} onChanged={refresh} />
          ))}
        </ul>
      ) : null}
      {hasLive ? <p className="text-xs">Trang tự kiểm tra lại mỗi 5 giây khi còn lệnh chưa kết thúc.</p> : null}
    </Card>
  );
}

function Messages({ device }: { device: AdminDevice }) {
  const { run } = useAdminAuth();
  const caps = useAdminLoad((client, token) => client.capabilities(token), "capabilities");
  const voices = useAdminLoad((client, token) => client.voiceMessages(token, device.deviceId), `voices|${device.deviceId}`);
  const [selected, setSelected] = useState<string | null>(null);
  const [expiry, setExpiry] = useState(300);
  const [confirming, setConfirming] = useState<{ key: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<AdminCommand | null>(null);
  const [version, setVersion] = useState(0);

  const list = voices.state.status === "ready" ? voices.state.data : [];
  const chosen = list.find((v) => v.voiceMessageId === selected) ?? null;
  const active = device.status === "active";
  const capabilities = caps.state.status === "ready" ? caps.state.data : null;

  const send = async () => {
    if (!confirming || !chosen) return;
    setSending(true);
    setSendError(null);
    try {
      const { command } = await run((client, token) => client.createVoiceCommand(token, device.deviceId, { voiceMessageId: chosen.voiceMessageId, idempotencyKey: confirming.key, expiresInSeconds: expiry }));
      setSent(command);
      setConfirming(null);
      setVersion((n) => n + 1);
    } catch (error) {
      setSendError(errorMessage(error, "Không gửi được lệnh."));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Notice icon={<Info aria-hidden />} title="Chuyển văn bản thành giọng nói chưa được hỗ trợ">
        {capabilities && !capabilities.tts.available
          ? (capabilities.tts.note ?? "Máy chủ không có dịch vụ chuyển văn bản thành giọng nói.")
          : caps.state.status === "error"
            ? "Không đọc được khả năng của máy chủ, nên không thể xác nhận có dịch vụ chuyển văn bản thành giọng nói hay không."
            : "Đang kiểm tra máy chủ…"}{" "}
        Vì vậy không có ô nhập văn bản: chỉ phát được bản ghi WAV đã tải lên. Thiết bị cũng không hiển thị văn bản.
        {capabilities?.devicePlayback === "not_verified_with_hardware" ? " Việc phát trên loa của ESP32 thật chưa được kiểm chứng." : ""}
      </Notice>

      {!active ? (
        <Notice role="status" title="Thiết bị này đã bị thu hồi">Không thể tải lên hay gửi lệnh tới thiết bị đã thu hồi.</Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card icon={<Volume2 aria-hidden />} title="Bản ghi âm của hồ sơ này">
          {voices.state.status === "loading" ? <LoadingState label="Đang tải bản ghi…" /> : null}
          {voices.state.status === "error" ? (
            <InlineError title="Không tải được bản ghi âm" onRetry={voices.reload}>
              {voices.state.message}
            </InlineError>
          ) : null}
          {voices.state.status === "ready" && list.length === 0 ? (
            <EmptyState icon={<Volume2 />} title="Chưa có bản ghi âm nào">
              <p>Tải lên một tệp WAV ở bên phải để có thứ gửi tới thiết bị.</p>
            </EmptyState>
          ) : null}
          {list.length > 0 ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">Chọn bản ghi để gửi</legend>
              {list.map((v) => (
                <div key={v.voiceMessageId} className="flex flex-col gap-2">
                  <Choice
                    type="radio"
                    name="voice"
                    checked={selected === v.voiceMessageId}
                    onChange={() => setSelected(v.voiceMessageId)}
                    label={v.title}
                    description={`${seconds(v.durationMs)} · ${v.sampleRateHz ?? "?"} Hz · ${v.createdBy?.startsWith("admin:") ? "do quản trị viên tải lên" : "do người chăm sóc tải lên"}`}
                  />
                  <div className="pl-3">
                    <Preview voiceMessageId={v.voiceMessageId} />
                  </div>
                </div>
              ))}
            </fieldset>
          ) : null}
        </Card>

        <Card icon={<Upload aria-hidden />} title="Tải bản ghi mới">
          <UploadForm
            device={device}
            caps={capabilities}
            capsError={caps.state.status === "error" ? caps.state.message : null}
            onUploaded={(v) => {
              setSelected(v.voiceMessageId);
              voices.refresh();
            }}
          />
        </Card>
      </div>

      <Card icon={<Send aria-hidden />} title="Gửi tới thiết bị">
        <div className="flex flex-wrap items-end gap-4">
          <InsetSelect label="Còn hiệu lực trong" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} wrapperClassName="min-w-48" hint="Quá thời hạn mà thiết bị chưa nhận thì lệnh hết hạn và không bao giờ được phát lại.">
            {EXPIRY_CHOICES.map((c) => (
              <option key={c.seconds} value={c.seconds}>
                {c.label}
              </option>
            ))}
          </InsetSelect>
          <SoftButton onClick={() => { setSendError(null); setConfirming({ key: newIdempotencyKey() }); }} disabled={!chosen || !active}>
            <Send className="size-4" aria-hidden />
            Gửi tới thiết bị…
          </SoftButton>
        </div>
        {!chosen ? <p className="text-sm">Chọn một bản ghi ở trên để gửi.</p> : null}
        {sent ? (
          <Notice role="status" title="Lệnh đã được máy chủ nhận">
            Mã lệnh {sent.commandId}. Trạng thái hiện tại: {COMMAND_STATUS_LABELS[sent.status].label}. Điều này chưa có nghĩa là thiết bị đã phát: chỉ khi thiết bị báo “đã phát xong” mới được tính là đã phát.
          </Notice>
        ) : null}
      </Card>

      <CommandTracker deviceId={device.deviceId} version={version} />

      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        busy={sending}
        title="Xác nhận gửi tới thiết bị thật"
        description="Lệnh sẽ được đặt vào hàng đợi của thiết bị và phát trên loa khi thiết bị nhận được."
        footer={
          <>
            <SoftButton variant="secondary" onClick={() => setConfirming(null)} disabled={sending}>
              Không gửi
            </SoftButton>
            <SoftButton onClick={() => void send()} disabled={sending}>
              {sending ? "Đang gửi…" : "Xác nhận gửi"}
            </SoftButton>
          </>
        }
      >
        <dl className="flex flex-col gap-1">
          <div className="flex justify-between gap-4"><dt>Thiết bị</dt><dd className="font-bold">{device.label} ({device.deviceId})</dd></div>
          <div className="flex justify-between gap-4"><dt>Bản ghi</dt><dd className="font-bold">{chosen?.title} · {seconds(chosen?.durationMs ?? null)}</dd></div>
          <div className="flex justify-between gap-4"><dt>Hiệu lực</dt><dd className="font-bold">{EXPIRY_CHOICES.find((c) => c.seconds === expiry)?.label}</dd></div>
        </dl>
        <p className="mt-3 text-sm">Việc gửi được ghi vào nhật ký quản trị. Bấm hai lần không tạo hai lệnh.</p>
        {sendError ? <p role="alert" className="mt-3 font-bold">{sendError}</p> : null}
      </Dialog>
    </>
  );
}

export function AdminMessagesPage() {
  return (
    <DeviceScope title="Gửi âm thanh tới thiết bị" intro="Tải lên bản ghi âm, nghe thử, rồi gửi tới thiết bị sau khi xác nhận. Trạng thái bên dưới là thứ thiết bị tự báo về máy chủ.">
      {(device) => <Messages device={device} />}
    </DeviceScope>
  );
}
