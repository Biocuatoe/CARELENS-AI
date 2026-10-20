import { useEffect, useRef, useState } from "react";
import { Info, Play, RefreshCw, Send, Upload, Volume2 } from "lucide-react";
import { useAdminAuth } from "../../app/adminAuth";
import { TERMINAL_COMMAND_STATUSES, isAdminApiError, type AdminCapabilities, type AdminCommand, type AdminDevice, type CommandPage, type VoiceMessage } from "../../data/admin/adminClient";
import { Dialog } from "../../design-system/overlays";
import { EmptyState, InlineError, LoadingState, Notice, StatusLabel } from "../../design-system/feedback";
import { Choice, InsetField, InsetSelect, SoftButton } from "../../design-system/primitives";
import { formatDateTime } from "../../lib/time";
import { Card } from "./AdminParts";
import { DeviceScope } from "./DeviceScope";
import { COMMAND_TYPE_LABELS, REASON_LABELS, commandStateLabel } from "./labels";
import { errorMessage, useAdminLoad, type Load } from "./useAdminLoad";
import { newIdempotencyKey } from "./idempotency";
import { DEFAULT_MP3_LIMITS, describeMp3, formatBytes, inspectMp3, mimeProblem, type Mp3FileInfo, type Mp3Limits } from "./mp3";

const EXPIRY_CHOICES: Array<{ seconds: number; label: string }> = [
  { seconds: 60, label: "1 phút" },
  { seconds: 300, label: "5 phút" },
  { seconds: 900, label: "15 phút" },
  { seconds: 3600, label: "1 giờ" },
];

const seconds = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1).replace(".", ",")} giây`);

/** One intended send: the idempotency key belongs to this recording and expiry. */
interface Attempt {
  key: string;
  voiceMessageId: string;
  expiry: number;
}

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

/** Limits of the server's upload contract, with the MP3 defaults for any value an older server does not state. */
function limitsOf(caps: AdminCapabilities): Mp3Limits {
  return {
    sampleRatesHz: caps.audio.sampleRatesHz.length > 0 ? caps.audio.sampleRatesHz : DEFAULT_MP3_LIMITS.sampleRatesHz,
    maxBytes: caps.audio.maxBytes ?? DEFAULT_MP3_LIMITS.maxBytes,
    minDurationMs: caps.audio.minDurationMs ?? DEFAULT_MP3_LIMITS.minDurationMs,
    maxDurationMs: caps.audio.maxDurationMs ?? DEFAULT_MP3_LIMITS.maxDurationMs,
  };
}

/** "MP3" for recordings since ADR-025; recordings stored before it are WAV and are labelled so, never as MP3. */
const codecLabel = (v: VoiceMessage) => (v.contentType === "audio/mpeg" ? "MP3" : v.contentType === "audio/wav" ? "WAV (định dạng cũ)" : (v.contentType ?? "?"));

function UploadForm({ device, caps, capsError, onUploaded }: { device: AdminDevice; caps: AdminCapabilities | null; capsError: string | null; onUploaded: (v: VoiceMessage) => void }) {
  const { run } = useAdminAuth();
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<{ file: File; info: Mp3FileInfo } | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bytes sent while uploading; null = the transport reports no progress (the fetch fallback).
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // A server before ADR-025 states audio/wav: it would refuse an MP3, so the form says so instead of failing on upload.
  const serverTakesMp3 = caps !== null && caps.audio.codec === "mp3";
  const limits = caps ? limitsOf(caps) : DEFAULT_MP3_LIMITS;

  const pick = async (f: File | null) => {
    setPicked(null);
    setProblem(null);
    setDone(null);
    if (!f || !caps) return;
    // The browser's type and the size are known without reading the file: a WAV or a too-large file is refused at once.
    const mime = mimeProblem(f.type);
    if (mime) {
      setProblem(mime);
      return;
    }
    if (f.size > limits.maxBytes) {
      setProblem(`Tệp ${formatBytes(f.size)} lớn hơn giới hạn ${formatBytes(limits.maxBytes)}.`);
      return;
    }
    setChecking(true);
    try {
      // Read once to walk the frame headers; nothing is decoded and nothing is kept after this check.
      const checked = inspectMp3(new Uint8Array(await f.arrayBuffer()), limits);
      if (typeof checked === "string") setProblem(checked);
      else setPicked({ file: f, info: checked });
    } catch {
      setProblem("Không đọc được tệp đã chọn.");
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    if (!picked || !title.trim()) return;
    const { file } = picked;
    setBusy(true);
    setProblem(null);
    setProgress(null);
    try {
      const v = await run((client, token) => client.uploadVoice(token, device.deviceId, title.trim(), file, (sent, total) => setProgress({ sent, total })));
      setDone(`Đã lưu “${v.title}” (MP3 ${formatBytes(v.byteSize ?? file.size)}, giữ nguyên tệp gốc). Bản ghi nằm trong kho riêng tư; chưa có gì được gửi tới thiết bị.`);
      setPicked(null);
      setTitle("");
      if (inputRef.current) inputRef.current.value = "";
      onUploaded(v);
    } catch (error) {
      setProblem(errorMessage(error, "Không tải lên được."));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.sent / progress.total) * 100)) : null;

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
        label="Tệp âm thanh MP3"
        type="file"
        accept=".mp3,audio/mpeg"
        hint={
          caps
            ? serverTakesMp3
              ? `MP3 (MPEG Layer III), mono hoặc stereo, ${(limits.minDurationMs / 1000).toLocaleString("vi-VN")}–${limits.maxDurationMs / 1000} giây, tối đa ${formatBytes(limits.maxBytes)}. Tệp được gửi nguyên vẹn; thiết bị tự giải mã MP3.`
              : "Máy chủ này chưa nhận MP3 (cần bản Worker có ADR-025). Chưa thể tải lên."
            : (capsError ?? "Đang tải giới hạn của máy chủ…")
        }
        disabled={!caps || !serverTakesMp3 || device.status !== "active" || busy}
        onChange={(e) => void pick(e.target.files?.[0] ?? null)}
        error={problem ?? undefined}
      />
      {checking ? <p role="status" className="text-sm">Đang kiểm tra tệp…</p> : null}
      {picked ? (
        <dl aria-label="Tệp đã chọn" className="grid gap-1 rounded-control bg-surface p-3 text-sm shadow-inset-sm">
          <div className="flex justify-between gap-4"><dt>Tệp</dt><dd className="truncate font-bold">{picked.file.name}</dd></div>
          <div className="flex justify-between gap-4"><dt>Kích thước tải lên</dt><dd className="font-bold">{formatBytes(picked.file.size)} (nguyên vẹn, không chuyển đổi)</dd></div>
          <div className="flex justify-between gap-4"><dt>Định dạng</dt><dd className="font-bold">{describeMp3(picked.info)}</dd></div>
          <div className="flex justify-between gap-4"><dt>Thời lượng</dt><dd className="font-bold">{seconds(picked.info.durationMs)}</dd></div>
        </dl>
      ) : null}
      {busy ? (
        <div role="status" className="flex flex-col gap-1 text-sm">
          {percent !== null ? (
            <>
              <progress className="w-full" max={100} value={percent} aria-label="Tiến độ tải lên" />
              <span>
                Đang tải lên {percent}% ({formatBytes(progress?.sent ?? 0)} / {formatBytes(progress?.total ?? 0)})
                {percent === 100 ? ". Máy chủ đang kiểm tra tệp…" : ""}
              </span>
            </>
          ) : (
            <span>Đang tải lên {picked ? formatBytes(picked.file.size) : ""}… (trình duyệt không báo tiến độ cho kiểu tải này)</span>
          )}
        </div>
      ) : null}
      {done ? <Notice role="status">{done}</Notice> : null}
      <div>
        <SoftButton type="submit" disabled={!picked || !title.trim() || busy || checking || !serverTakesMp3 || device.status !== "active"}>
          <Upload className="size-4" aria-hidden />
          {busy ? "Đang tải lên…" : "Tải lên kho riêng tư"}
        </SoftButton>
      </div>
    </form>
  );
}

function CommandRow({ command, onChanged }: { command: AdminCommand; onChanged: () => void }) {
  const { run } = useAdminAuth();
  const info = commandStateLabel(command);
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
      {command.status === "delivered" && command.receivedAt ? (
        <p className="text-xs">
          Thiết bị báo đã nhận lúc {formatDateTime(command.receivedAt)}
          {command.downloadDeadlineAt ? `; phải tải và kiểm tra xong trước ${formatDateTime(command.downloadDeadlineAt)}, nếu không lệnh được ghi là lỗi.` : "."}
        </p>
      ) : null}
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

const isLive = (c: AdminCommand) => !TERMINAL_COMMAND_STATUSES.includes(c.status) && c.status !== "unknown";

function CommandTracker({ state, reload, refresh }: { state: Load<CommandPage>; reload: () => void; refresh: () => void }) {
  const hasLive = state.status === "ready" && state.data.items.some(isLive);
  // While a command is still open, look again every few seconds: the only way to learn the device's acknowledgement is to ask the server.
  // Bounded: it stops when every command reached a final state (the server ends each one by its deadline), when a load fails (the
  // error state replaces the list), and it skips while the tab is hidden.
  useEffect(() => {
    if (!hasLive) return;
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 5000);
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
  const [confirming, setConfirming] = useState<Attempt | null>(null);
  // The last send whose outcome is unknown (timeout, lost connection, 5xx): retrying the same recording and expiry reuses its
  // idempotency key, so the server returns the command it may already have stored instead of creating a second one.
  const [uncertain, setUncertain] = useState<Attempt | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ command: AdminCommand; created: boolean } | null>(null);
  const commandsLoad = useAdminLoad((client, token) => client.commands(token, device.deviceId), `commands|${device.deviceId}`);

  const list = voices.state.status === "ready" ? voices.state.data : [];
  const chosen = list.find((v) => v.voiceMessageId === selected) ?? null;
  const confirmingVoice = confirming ? (list.find((v) => v.voiceMessageId === confirming.voiceMessageId) ?? null) : null;
  const active = device.status === "active";
  const capabilities = caps.state.status === "ready" ? caps.state.data : null;
  // What the server says now about the command just sent (refreshed with the list), not what it said when it was created.
  const sentNow = sent ? ((commandsLoad.state.status === "ready" ? commandsLoad.state.data.items.find((c) => c.commandId === sent.command.commandId) : undefined) ?? sent.command) : null;

  const openConfirm = () => {
    if (!chosen) return;
    setSendError(null);
    const again = uncertain && uncertain.voiceMessageId === chosen.voiceMessageId && uncertain.expiry === expiry ? uncertain : null;
    setConfirming(again ?? { key: newIdempotencyKey(), voiceMessageId: chosen.voiceMessageId, expiry });
  };

  const send = async () => {
    if (!confirming) return;
    const attempt = confirming;
    setSending(true);
    setSendError(null);
    try {
      const result = await run((client, token) =>
        client.createVoiceCommand(token, device.deviceId, { voiceMessageId: attempt.voiceMessageId, idempotencyKey: attempt.key, expiresInSeconds: attempt.expiry }),
      );
      setSent(result);
      setUncertain(null);
      setConfirming(null);
      commandsLoad.refresh();
    } catch (error) {
      const unknownOutcome = isAdminApiError(error) && (error.code === "timeout" || error.code === "unavailable");
      if (unknownOutcome) {
        setUncertain(attempt);
        setSendError(
          `${errorMessage(error, "Không gửi được lệnh.")} Chưa biết máy chủ đã lưu lệnh hay chưa; xem danh sách lệnh bên dưới. Gửi lại bản ghi này với cùng thời hạn sẽ dùng lại mã chống trùng, nên không tạo lệnh thứ hai.`,
        );
        commandsLoad.refresh();
      } else {
        setUncertain(null);
        setSendError(errorMessage(error, "Không gửi được lệnh."));
      }
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
        Vì vậy không có ô nhập văn bản: chỉ phát được bản ghi MP3 đã tải lên. Thiết bị cũng không hiển thị văn bản.
        {capabilities?.devicePlayback === "not_verified_with_hardware" ? " Việc phát trên loa của ESP32 thật chưa được kiểm chứng." : ""}
      </Notice>

      {active && !device.audioCodecs.includes("mp3") ? (
        <Notice role="status" title="Thiết bị chưa báo phát được MP3">
          {device.audioCodecs.length > 0
            ? `Thiết bị chỉ báo phát được: ${device.audioCodecs.join(", ")}.`
            : "Heartbeat gần nhất của thiết bị không có danh sách định dạng (firmware trước carelens-fw-0.2.0, hoặc thiết bị chưa liên lạc)."}{" "}
          Máy chủ sẽ từ chối lệnh phát bản ghi MP3 tới thiết bị này cho tới khi thiết bị báo hỗ trợ MP3.
        </Notice>
      ) : null}

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
              <p>Tải lên một tệp MP3 ở bên phải để có thứ gửi tới thiết bị.</p>
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
                    description={`${codecLabel(v)} · ${seconds(v.durationMs)} · ${v.sampleRateHz ?? "?"} Hz${v.channels === 2 ? " stereo" : v.channels === 1 ? " mono" : ""} · ${v.byteSize !== null ? formatBytes(v.byteSize) : "?"} · ${v.createdBy?.startsWith("admin:") ? "do quản trị viên tải lên" : "do người chăm sóc tải lên"}`}
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
          <SoftButton onClick={openConfirm} disabled={!chosen || !active}>
            <Send className="size-4" aria-hidden />
            Gửi tới thiết bị…
          </SoftButton>
        </div>
        {!chosen ? <p className="text-sm">Chọn một bản ghi ở trên để gửi.</p> : null}
        {!confirming && sendError ? <p role="alert" className="font-bold">{sendError}</p> : null}
        {sent && sentNow ? (
          <Notice role="status" title="Lệnh đã được máy chủ nhận">
            Mã lệnh {sentNow.commandId}
            {sent.created ? "" : " (máy chủ đã có lệnh này từ lần gửi trước, không tạo lệnh mới)"}. Trạng thái hiện tại: {commandStateLabel(sentNow).label}.{" "}
            {sentNow.playedConfirmedByDevice
              ? "Thiết bị đã tự báo phát xong."
              : "Điều này chưa có nghĩa là thiết bị đã phát: chỉ khi thiết bị báo “đã phát xong” mới được tính là đã phát."}
          </Notice>
        ) : null}
      </Card>

      <CommandTracker state={commandsLoad.state} reload={commandsLoad.reload} refresh={commandsLoad.refresh} />

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
          <div className="flex justify-between gap-4"><dt>Bản ghi</dt><dd className="font-bold">{confirmingVoice?.title} · {seconds(confirmingVoice?.durationMs ?? null)}</dd></div>
          <div className="flex justify-between gap-4"><dt>Hiệu lực</dt><dd className="font-bold">{EXPIRY_CHOICES.find((c) => c.seconds === confirming?.expiry)?.label}</dd></div>
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
