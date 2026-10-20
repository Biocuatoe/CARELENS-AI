import { useMemo, useState } from "react";
import { BellRing, CalendarClock, Info, Pause, Play, RefreshCw, XCircle } from "lucide-react";
import { useAdminAuth } from "../../app/adminAuth";
import type { AdminDevice, AdminReminder, ReminderSchedule } from "../../data/admin/adminClient";
import { EmptyState, InlineError, LoadingState, Notice, StatusLabel } from "../../design-system/feedback";
import { Choice, InsetField, InsetSelect, SoftButton } from "../../design-system/primitives";
import { formatDateTime, localDateKey } from "../../lib/time";
import { Card } from "./AdminParts";
import { DeviceScope } from "./DeviceScope";
import { COMMAND_STATUS_LABELS, REASON_LABELS, REMINDER_KIND_LABELS, REMINDER_STATE_LABELS, WEEKDAY_LABELS } from "./labels";
import { errorMessage, useAdminLoad } from "./useAdminLoad";
import { newIdempotencyKey } from "./idempotency";

const DEADLINES = [5, 15, 30, 60, 120, 240];

function scheduleText(r: AdminReminder): string {
  const times = r.timesLocal.join(", ");
  if (r.scheduleKind === "once") return `Một lần, ${r.startDate ?? "?"} lúc ${times}`;
  const days = r.daysOfWeek.map((d) => WEEKDAY_LABELS[d] ?? String(d)).join(" ");
  return `Lặp hằng tuần (${days}) lúc ${times}, từ ${r.startDate ?? "?"}${r.endDate ? ` đến ${r.endDate}` : " không giới hạn"}`;
}

function ReminderItem({ reminder, onChanged }: { reminder: AdminReminder; onChanged: () => void }) {
  const { run } = useAdminAuth();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const info = REMINDER_STATE_LABELS[reminder.state];
  const last = reminder.lastDispatch;
  const lastInfo = last ? COMMAND_STATUS_LABELS[(last.status in COMMAND_STATUS_LABELS ? last.status : "unknown") as keyof typeof COMMAND_STATUS_LABELS] : null;
  const act = async (op: "pause" | "resume" | "cancel") => {
    setBusy(true);
    setNote(null);
    try {
      await run((client, token) => client.changeReminder(token, reminder.reminderId, op));
      setConfirmCancel(false);
      onChanged();
    } catch (error) {
      setNote(errorMessage(error, "Không thay đổi được nhắc lịch."));
    } finally {
      setBusy(false);
    }
  };
  const open = reminder.state === "scheduled" || reminder.state === "paused";
  return (
    <li className="rounded-control bg-surface p-4 shadow-inset-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold">
            {REMINDER_KIND_LABELS[reminder.kind] ?? reminder.kind}: {reminder.label}
          </p>
          <p className="text-xs">{scheduleText(reminder)} · giờ Việt Nam · giữ hiệu lực {reminder.deadlineMinutes ?? "?"} phút sau giờ hẹn</p>
        </div>
        <StatusLabel tone={info.tone}>{info.label}</StatusLabel>
      </div>
      <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs">Lần tới</dt>
          <dd className="font-bold">
            {reminder.nextOccurrenceAt ? formatDateTime(reminder.nextOccurrenceAt) : "Không còn lần nào"}
            {reminder.state === "paused" && reminder.nextOccurrenceAt ? " (đang tạm dừng, sẽ không chạy)" : ""}
            {reminder.windowOpen && reminder.state === "scheduled" ? " (đang trong thời gian giao)" : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs">Lần giao gần nhất</dt>
          <dd className="font-bold">
            {last && lastInfo ? (
              <>
                {formatDateTime(last.occurrenceAt)} · {lastInfo.label}
                {last.statusReason ? ` (${REASON_LABELS[last.statusReason] ?? last.statusReason})` : ""}
                {last.playedConfirmedByDevice ? "" : " · chưa có xác nhận phát xong từ thiết bị"}
              </>
            ) : (
              "Chưa có lần nào được giao"
            )}
          </dd>
        </div>
      </dl>
      {open ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {reminder.state === "paused" ? (
            <SoftButton size="sm" variant="secondary" onClick={() => void act("resume")} disabled={busy}>
              <Play className="size-4" aria-hidden />
              Tiếp tục
            </SoftButton>
          ) : (
            <SoftButton size="sm" variant="secondary" onClick={() => void act("pause")} disabled={busy}>
              <Pause className="size-4" aria-hidden />
              Tạm dừng
            </SoftButton>
          )}
          {confirmCancel ? (
            <>
              <SoftButton size="sm" onClick={() => void act("cancel")} disabled={busy}>
                Xác nhận hủy hẳn
              </SoftButton>
              <SoftButton size="sm" variant="secondary" onClick={() => setConfirmCancel(false)} disabled={busy}>
                Giữ lại
              </SoftButton>
            </>
          ) : (
            <SoftButton size="sm" variant="secondary" onClick={() => setConfirmCancel(true)} disabled={busy}>
              <XCircle className="size-4" aria-hidden />
              Hủy
            </SoftButton>
          )}
        </div>
      ) : null}
      {note ? <p role="alert" className="mt-2 text-sm font-bold">{note}</p> : null}
    </li>
  );
}

function CreateForm({ device, onCreated }: { device: AdminDevice; onCreated: () => void }) {
  const { run } = useAdminAuth();
  const today = useMemo(() => localDateKey(), []);
  const voices = useAdminLoad((client, token) => client.voiceMessages(token, device.deviceId), `voices|${device.deviceId}`);
  const [kind, setKind] = useState<"water" | "medication">("water");
  const [label, setLabel] = useState("");
  const [voice, setVoice] = useState("");
  const [mode, setMode] = useState<"once" | "weekly">("once");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [endDate, setEndDate] = useState("");
  const [deadline, setDeadline] = useState(15);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  // One key per intent: a double click or a retry after a lost reply returns the reminder already made instead of a second one.
  const [key, setKey] = useState(newIdempotencyKey);

  const valid = label.trim() !== "" && /^\d{2}:\d{2}$/.test(time) && /^\d{4}-\d{2}-\d{2}$/.test(date) && (mode === "once" || days.length > 0) && ack;
  const active = device.status === "active";

  const submit = async () => {
    const schedule: ReminderSchedule = mode === "once" ? { type: "once", local_date: date, local_time: time } : { type: "weekly", days_of_week: [...days].sort(), times_local: [time], start_date: date, end_date: endDate || null };
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const r = await run((client, token) =>
        client.createReminder(token, device.deviceId, { idempotencyKey: key, kind, label: label.trim(), voiceMessageId: voice || null, deadlineMinutes: deadline, schedule }),
      );
      setCreated(r.created ? "Đã tạo nhắc lịch. Máy chủ sẽ tự giao đúng giờ, không cần giữ trang này mở." : "Nhắc lịch này đã được tạo trước đó (gửi lặp), không tạo thêm bản mới.");
      setLabel("");
      setTime("");
      setAck(false);
      setKey(newIdempotencyKey());
      onCreated();
    } catch (e) {
      setError(errorMessage(e, "Không tạo được nhắc lịch."));
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
      <div className="grid gap-4 sm:grid-cols-2">
        <InsetSelect label="Loại nhắc" value={kind} onChange={(e) => setKind(e.target.value as "water" | "medication")}>
          <option value="water">Uống nước</option>
          <option value="medication">Uống thuốc</option>
        </InsetSelect>
        <InsetField label="Nội dung nhắc" value={label} maxLength={120} onChange={(e) => { setLabel(e.target.value); setKey(newIdempotencyKey()); }} required hint="Do bạn nhập; hệ thống không kiểm tra tên thuốc hay liều." />
      </div>
      <InsetSelect
        label="Bản ghi âm kèm theo (tùy chọn)"
        value={voice}
        onChange={(e) => { setVoice(e.target.value); setKey(newIdempotencyKey()); }}
        hint={voices.state.status === "error" ? voices.state.message : "Không chọn thì thiết bị chỉ phát âm báo mặc định. Thiết bị không hiển thị văn bản và chưa có giọng đọc tự động."}
      >
        <option value="">Chỉ âm báo mặc định</option>
        {voices.state.status === "ready"
          ? voices.state.data.map((v) => (
              <option key={v.voiceMessageId} value={v.voiceMessageId}>
                {v.title}
              </option>
            ))
          : null}
      </InsetSelect>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-bold">Kiểu lịch</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice type="radio" name="mode" checked={mode === "once"} onChange={() => { setMode("once"); setKey(newIdempotencyKey()); }} label="Một lần" />
          <Choice type="radio" name="mode" checked={mode === "weekly"} onChange={() => { setMode("weekly"); setKey(newIdempotencyKey()); }} label="Lặp hằng tuần" />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <InsetField label={mode === "once" ? "Ngày" : "Bắt đầu từ ngày"} type="date" min={today} value={date} onChange={(e) => { setDate(e.target.value); setKey(newIdempotencyKey()); }} required />
        <InsetField label="Giờ (giờ Việt Nam)" type="time" value={time} onChange={(e) => { setTime(e.target.value); setKey(newIdempotencyKey()); }} required hint="Múi giờ cố định: Asia/Ho_Chi_Minh (UTC+7)." />
      </div>
      {mode === "weekly" ? (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-bold">Các ngày trong tuần</legend>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <Choice
                  key={d}
                  label={WEEKDAY_LABELS[d]}
                  checked={days.includes(d)}
                  onChange={(e) => { setDays((cur) => (e.target.checked ? [...cur, d] : cur.filter((x) => x !== d))); setKey(newIdempotencyKey()); }}
                />
              ))}
            </div>
          </fieldset>
          <InsetField label="Kết thúc ngày (tùy chọn)" type="date" min={date} value={endDate} onChange={(e) => { setEndDate(e.target.value); setKey(newIdempotencyKey()); }} wrapperClassName="max-w-xs" hint="Để trống nếu lặp không giới hạn." />
        </>
      ) : null}

      <InsetSelect
        label="Thời gian giao tối đa sau giờ hẹn"
        value={deadline}
        onChange={(e) => { setDeadline(Number(e.target.value)); setKey(newIdempotencyKey()); }}
        wrapperClassName="max-w-xs"
        hint="Thiết bị ngoại tuyến quá thời gian này sẽ bỏ qua lần nhắc, không phát muộn."
      >
        {DEADLINES.map((m) => (
          <option key={m} value={m}>
            {m} phút
          </option>
        ))}
      </InsetSelect>

      <Choice label="Tôi xác nhận tạo nhắc lịch này cho thiết bị thật" description={`${device.label} (${device.deviceId})`} checked={ack} onChange={(e) => setAck(e.target.checked)} />
      {error ? <InlineError title="Chưa tạo được nhắc lịch">{error}</InlineError> : null}
      {created ? <Notice role="status">{created}</Notice> : null}
      <div>
        <SoftButton type="submit" disabled={!valid || busy || !active}>
          <CalendarClock className="size-4" aria-hidden />
          {busy ? "Đang tạo…" : "Tạo nhắc lịch"}
        </SoftButton>
        {!active ? <p className="mt-2 text-sm">Thiết bị đã bị thu hồi nên không tạo được nhắc lịch.</p> : null}
      </div>
    </form>
  );
}

function Reminders({ device }: { device: AdminDevice }) {
  const { state, reload, refresh } = useAdminLoad((client, token) => client.reminders(token, device.deviceId), `reminders|${device.deviceId}`);
  return (
    <>
      <Notice icon={<Info aria-hidden />} title="Cách lịch được thực hiện">
        Lịch nằm trong cơ sở dữ liệu của máy chủ và do tác vụ định kỳ của Worker (mỗi phút) biến thành lệnh gửi thiết bị; không dùng bộ hẹn giờ của trình duyệt, đóng trang hay đăng xuất không hủy lịch. Mỗi lần hẹn chỉ tạo đúng một lệnh. Tác vụ định kỳ chỉ chạy khi bản Worker đã triển khai có bật nó; bằng chứng duy nhất là cột “Lần giao gần nhất” có lệnh. Chưa có thiết bị thật nào xác nhận phát.
      </Notice>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card icon={<BellRing aria-hidden />} title="Nhắc lịch của thiết bị này">
          <div>
            <SoftButton size="sm" variant="secondary" onClick={reload} disabled={state.status === "loading"}>
              <RefreshCw className="size-4" aria-hidden />
              Làm mới
            </SoftButton>
          </div>
          {state.status === "loading" ? <LoadingState label="Đang tải nhắc lịch…" /> : null}
          {state.status === "error" ? (
            <InlineError title="Không tải được nhắc lịch" onRetry={reload}>
              {state.message}
            </InlineError>
          ) : null}
          {state.status === "ready" && state.data.items.length === 0 ? (
            <EmptyState icon={<BellRing />} title="Chưa có nhắc lịch nào">
              <p>Tạo nhắc lịch đầu tiên ở bên phải.</p>
            </EmptyState>
          ) : null}
          {state.status === "ready" && state.data.items.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {state.data.items.map((r) => (
                <ReminderItem key={r.reminderId} reminder={r} onChanged={refresh} />
              ))}
            </ul>
          ) : null}
        </Card>
        <Card icon={<CalendarClock aria-hidden />} title="Tạo nhắc lịch">
          <CreateForm device={device} onCreated={refresh} />
        </Card>
      </div>
    </>
  );
}

export function AdminRemindersPage() {
  return (
    <DeviceScope title="Nhắc lịch cho thiết bị" intro="Hẹn giờ phát âm báo hoặc bản ghi âm trên thiết bị, một lần hoặc lặp hằng tuần.">
      {(device) => <Reminders device={device} />}
    </DeviceScope>
  );
}
