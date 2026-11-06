import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { ArrowRight, Building2, CircleCheck, ClipboardList, HeartHandshake, LoaderCircle, MessagesSquare, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { cn } from "../../design-system/cn";
import { Eyebrow, landingButtonClasses } from "../../design-system/landing";
import { Choice, InsetField, InsetSelect, InsetTextarea } from "../../design-system/primitives";
import { ContactSubmitError, submitContactRequest, type ContactSubmitResult } from "../../data/contact/contactClient";
import { CONTACT, SECTION_IDS } from "./content";
import { EMPTY_VALUES, FIELDS, buildPayload, defaultMessages, serverFieldErrors, validate, type ContactValues, type FieldName, type Group, type Variant } from "./contactForm";
import { Reveal } from "./Reveal";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string }
  | { kind: "success"; result: ContactSubmitResult; variant: Variant };

const GROUP_ICON: Record<Group, typeof HeartHandshake> = { individual: HeartHandshake, facility: Building2 };
const isPurchase = (v: Variant) => v === "individual_purchase" || v === "facility_purchase";

/**
 * Liên hệ và yêu cầu đặt mua (A43). Ba bước trong cùng một phần: chọn nhóm khách hàng, chọn nhu cầu, điền biểu mẫu tương ứng.
 * Gửi tới máy chủ CareLens AI (lưu trong D1, báo đội ngũ qua email). Không có giỏ hàng, giá hay thanh toán.
 * Đổi nhóm hoặc nhu cầu không xóa nội dung đã nhập; mỗi biểu mẫu giữ lời nhắn riêng, sửa được.
 */
export function ContactSection({ submit = submitContactRequest }: { submit?: typeof submitContactRequest } = {}) {
  const [group, setGroup] = useState<Group | null>(null);
  const [variant, setVariant] = useState<Variant | null>(null);
  const [values, setValues] = useState<ContactValues>(EMPTY_VALUES);
  const [messages, setMessages] = useState<Record<Variant, string>>(defaultMessages);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (status.kind === "success") resultRef.current?.focus();
  }, [status.kind]);

  const pickGroup = (g: Group) => {
    if (status.kind === "submitting") return;
    setGroup(g);
    // Giữ nhu cầu tương ứng nếu đã chọn trước đó cho nhóm này; nếu khác nhóm thì chờ chọn lại.
    setVariant((v) => (v && v.startsWith(g) ? v : null));
    setErrors({});
    if (status.kind !== "idle") setStatus({ kind: "idle" });
  };
  const pickVariant = (v: Variant) => {
    if (status.kind === "submitting") return;
    setVariant(v);
    // Màn hẹp: biểu mẫu nằm dưới phần chọn, đưa nó vào tầm nhìn (tôn trọng giảm chuyển động).
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() => panelRef.current?.scrollIntoView?.({ behavior: smooth ? "smooth" : "auto", block: "start" }));
    }
    setErrors({});
    if (status.kind !== "idle") setStatus({ kind: "idle" });
  };

  const set = <K extends keyof ContactValues>(name: K, value: ContactValues[K]) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    if (errors[name as FieldName]) setErrors((prev) => ({ ...prev, [name]: undefined }));
  };
  const setMessage = (text: string) => {
    if (!variant) return;
    setMessages((prev) => ({ ...prev, [variant]: text }));
    if (errors.message) setErrors((prev) => ({ ...prev, message: undefined }));
  };

  const focusFirstError = (errs: Partial<Record<FieldName, string>>) => {
    if (!variant) return;
    const first = FIELDS[variant].find((s) => errs[s.name]);
    if (first) requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[name="${first.name}"]`)?.focus());
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!variant || status.kind === "submitting") return;
    const message = messages[variant];
    const errs = validate(variant, values, message);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setStatus({ kind: "idle" });
      focusFirstError(errs);
      return;
    }
    setStatus({ kind: "submitting" });
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await submit(buildPayload(variant, values, message), { signal: controller.signal });
      if (controller.signal.aborted) return;
      setStatus({ kind: "success", result, variant });
    } catch (err) {
      if (controller.signal.aborted) return;
      const kind = err instanceof ContactSubmitError ? err.kind : "server";
      if (err instanceof ContactSubmitError && kind === "invalid") {
        const serverErrs = serverFieldErrors(variant, err.fields);
        setErrors(serverErrs);
        focusFirstError(serverErrs);
      }
      setStatus({ kind: "failed", message: CONTACT.failure[kind] });
    }
  };

  const startOver = () => {
    // Giữ thông tin liên hệ để gửi tiếp; lời nhắn trở về nội dung gợi ý, cần đồng ý lại.
    setMessages(defaultMessages());
    setValues((prev) => ({ ...prev, consent: false }));
    setErrors({});
    setStatus({ kind: "idle" });
    // Nút vừa bấm biến mất cùng bảng kết quả: đưa focus vào ô đầu của biểu mẫu thay vì để rơi về <body>.
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("input:not([tabindex='-1']), select, textarea")?.focus());
  };

  const submitting = status.kind === "submitting";
  const errorCount = Object.values(errors).filter(Boolean).length;

  return (
    <section id={SECTION_IDS.contact} aria-labelledby="contact-title" data-tone="light" className="scroll-mt-(--landing-header-h) bg-paper py-16 text-ink md:py-24">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 md:px-6">
        <div className="flex max-w-3xl flex-col gap-4">
          <Eyebrow tone="light">{CONTACT.eyebrow}</Eyebrow>
          <h2 id="contact-title" className="font-display text-4xl leading-[1.05] font-extrabold tracking-tight text-balance text-midnight md:text-5xl">
            {CONTACT.heading}
          </h2>
          <p className="max-w-2xl text-ink/80 md:text-lg">{CONTACT.body}</p>
        </div>

        <Reveal>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
            <div className="flex flex-col gap-8 lg:sticky lg:top-[calc(var(--landing-header-h)+2rem)] lg:self-start">
              <Step index={1} title={CONTACT.stepGroup}>
                <div role="group" aria-label="Chọn nhóm khách hàng" className="flex flex-col gap-3">
                  {CONTACT.groups.map((g) => {
                    const on = group === g.id;
                    const Icon = GROUP_ICON[g.id];
                    return (
                      <button
                        key={g.id}
                        type="button"
                        aria-pressed={on}
                        disabled={submitting}
                        onClick={() => pickGroup(g.id)}
                        className={cn(
                          "grid min-h-11 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-4 rounded-container bg-paper p-4 text-left transition-shadow duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed md:p-5",
                          on ? "shadow-[0_0_0_2px_var(--color-teal-deep)]" : "shadow-extruded hover:shadow-extruded-hover",
                        )}
                      >
                        <span aria-hidden className={cn("inline-flex size-11 items-center justify-center rounded-full", on ? "bg-teal-deep text-paper" : "bg-ivory text-teal-deep")}>
                          <Icon className="size-5" />
                        </span>
                        <span className="flex flex-col gap-0.5">
                          <span className="font-display text-lg leading-snug font-bold text-midnight">{g.title}</span>
                          <span className="text-sm text-ink/80">{g.why}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Step>

              {group ? (
                <Step index={2} title={CONTACT.stepAction}>
                  <div role="group" aria-label="Chọn nhu cầu" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    {CONTACT.actions[group].map((a) => {
                      const on = variant === a.id;
                      const Icon = isPurchase(a.id) ? ClipboardList : MessagesSquare;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          aria-pressed={on}
                          disabled={submitting}
                          onClick={() => pickVariant(a.id)}
                          className={cn(
                            "flex min-h-11 items-start gap-3 rounded-control p-4 text-left transition-[background-color,box-shadow] duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed",
                            on ? "bg-teal-deep text-paper" : "bg-paper shadow-extruded-sm hover:shadow-[0_0_0_1px_var(--color-teal-deep)]",
                          )}
                        >
                          <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", on ? "text-mint" : "text-teal-deep")} />
                          <span className="flex flex-col gap-0.5">
                            <span className="font-bold">{a.title}</span>
                            <span className={cn("text-sm", on ? "text-paper/85" : "text-ink/75")}>{a.why}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Step>
              ) : null}

              <div className="flex flex-col gap-2 text-sm text-ink/75" data-testid="contact-privacy">
                <p className="font-bold text-ink">{CONTACT.privacyTitle}</p>
                <ul className="flex list-disc flex-col gap-1.5 pl-5">
                  {CONTACT.privacy.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div ref={panelRef} className="scroll-mt-[calc(var(--landing-header-h)+1rem)] rounded-container bg-paper p-5 shadow-extruded md:p-8" data-testid="contact-panel">
              {status.kind === "success" ? (
                <SuccessPanel focusRef={resultRef} result={status.result} variant={status.variant} onAgain={startOver} />
              ) : !group || !variant ? (
                <div className="flex min-h-56 flex-col items-start justify-center gap-3 text-ink/80">
                  <span className="font-mono text-xs tracking-[0.14em] text-teal-deep uppercase">{group ? "Bước 2" : "Bước 1"}</span>
                  <p className="font-display text-xl font-bold text-midnight">{group ? CONTACT.placeholderAction : CONTACT.placeholderPick}</p>
                </div>
              ) : (
                <form ref={formRef} noValidate onSubmit={onSubmit} aria-labelledby="contact-form-title" aria-busy={submitting} className="flex flex-col gap-6">
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-xs tracking-[0.14em] text-teal-deep uppercase">Bước 3</span>
                    <h3 id="contact-form-title" className="font-display text-2xl leading-snug font-bold text-midnight">
                      {CONTACT.formTitle[variant]}
                    </h3>
                    <p className="text-sm text-ink/75">{CONTACT.requiredNote}</p>
                  </div>

                  {errorCount > 0 && status.kind !== "failed" ? (
                    <p role="alert" className="flex items-center gap-2 rounded-control bg-ivory p-3 text-sm font-bold text-ink">
                      <TriangleAlert aria-hidden className="size-4 shrink-0 text-teal-deep" />
                      {CONTACT.errors.summary.replace("{n}", String(errorCount))}
                    </p>
                  ) : null}

                  <fieldset disabled={submitting} className="flex min-w-0 flex-col gap-6">
                    <VariantFields variant={variant} values={values} message={messages[variant]} errors={errors} set={set} setMessage={setMessage} />
                    {/* Ô bẫy chống spam: ẩn khỏi người dùng và trình đọc màn hình. */}
                    <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
                      <label>
                        Website
                        <input name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => set("website", e.target.value)} />
                      </label>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Choice name="consent" checked={values.consent} onChange={(e) => set("consent", e.target.checked)} label={`${CONTACT.labels.consent} *`} aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? "contact-consent-error" : undefined} />
                      {errors.consent ? <FieldError id="contact-consent-error">{errors.consent}</FieldError> : null}
                    </div>
                  </fieldset>

                  {status.kind === "failed" ? (
                    <p role="alert" className="flex items-start gap-2 rounded-control bg-ivory p-3 text-sm font-bold text-ink">
                      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-teal-deep" />
                      {status.message}
                    </p>
                  ) : null}

                  <button type="submit" disabled={submitting} className={landingButtonClasses({ tone: "light", className: "w-full sm:w-auto sm:self-start" })}>
                    {submitting ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                    {submitting ? CONTACT.submitting : CONTACT.submit}
                  </button>
                  <p role="status" className="sr-only">
                    {submitting ? CONTACT.submitting : ""}
                  </p>
                </form>
              )}
            </div>
          </div>
        </Reveal>

        <Link to="/login" className={landingButtonClasses({ tone: "light", variant: "secondary", className: "self-start" })}>
          {CONTACT.app}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function Step({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-sm font-bold text-midnight">
        <span aria-hidden className="inline-flex size-6 items-center justify-center rounded-full bg-ivory font-mono text-xs text-teal-deep">
          {index}
        </span>
        {title}
      </p>
      {children}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm font-bold text-ink">
      <TriangleAlert className="size-4 shrink-0 text-teal-deep" aria-hidden />
      {children}
    </p>
  );
}

function Optional() {
  return <span className="ml-1 font-normal text-ink/65">({CONTACT.optional.toLowerCase()})</span>;
}

interface VariantFieldsProps {
  variant: Variant;
  values: ContactValues;
  message: string;
  errors: Partial<Record<FieldName, string>>;
  set: <K extends keyof ContactValues>(name: K, value: ContactValues[K]) => void;
  setMessage: (text: string) => void;
}

function VariantFields({ variant, values, message, errors, set, setMessage }: VariantFieldsProps) {
  const L = CONTACT.labels;
  const specs = new Map(FIELDS[variant].map((s) => [s.name, s]));
  const has = (n: FieldName) => specs.has(n);
  const req = (n: FieldName) => specs.get(n)?.required ?? false;
  const label = (n: FieldName, text: string) => (
    <>
      {text}
      {req(n) ? null : <Optional />}
    </>
  );
  const facility = variant.startsWith("facility");

  const text = (n: Exclude<FieldName, "interests" | "consent" | "message">, labelText: string, props: { type?: string; autoComplete?: string; inputMode?: "numeric" | "tel" | "email"; hint?: string; className?: string } = {}) =>
    has(n) ? (
      <InsetField
        key={n}
        name={n}
        label={label(n, labelText)}
        required={req(n)}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        hint={props.hint}
        wrapperClassName={props.className}
        value={values[n] as string}
        onChange={(e) => set(n, e.target.value)}
        error={errors[n]}
        maxLength={specs.get(n)?.kind === "count" ? 6 : (specs.get(n)?.max ?? 254) + 20}
      />
    ) : null;
  const select = (n: "relationship" | "facility_type" | "timeline", labelText: string, options: ReadonlyArray<{ id: string; label: string }>, className?: string) =>
    has(n) ? (
      <InsetSelect key={n} name={n} label={label(n, labelText)} required={req(n)} value={values[n]} onChange={(e) => set(n, e.target.value)} error={errors[n]} wrapperClassName={className}>
        <option value="">{CONTACT.choose}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </InsetSelect>
    ) : null;
  const area = (n: "delivery_notes" | "integration_requirements", labelText: string, className?: string) =>
    has(n) ? (
      <InsetTextarea key={n} name={n} label={label(n, labelText)} required={req(n)} rows={3} value={values[n]} onChange={(e) => set(n, e.target.value)} error={errors[n]} maxLength={(specs.get(n)?.max ?? 500) + 20} wrapperClassName={className} />
    ) : null;

  const messageLabel = variant === "facility_consultation" ? L.message_needs : isPurchase(variant) ? L.message_extra : L.message;

  return (
    <>
      {facility ? (
        <Group title={CONTACT.sections.organization}>
          {text("organization", L.organization, { autoComplete: "organization", className: "sm:col-span-2" })}
          {select("facility_type", L.facility_type, CONTACT.facilityTypes)}
          {text("job_title", L.job_title, { autoComplete: "organization-title" })}
          {text("address", L.address, { autoComplete: "street-address", className: "sm:col-span-2" })}
        </Group>
      ) : null}

      <Group title={CONTACT.sections.contact}>
        {text("full_name", facility ? L.contact_name : L.full_name, { autoComplete: "name", className: "sm:col-span-2" })}
        {text("phone", L.phone, { type: "tel", autoComplete: "tel", inputMode: "tel" })}
        {text("email", facility ? L.work_email : L.email, { type: "email", autoComplete: "email", inputMode: "email" })}
        {select("relationship", L.relationship, CONTACT.relationships, "sm:col-span-2")}
      </Group>

      <Group title={CONTACT.sections.needs}>
        {has("interests") ? (
          <fieldset className="flex min-w-0 flex-col gap-2 sm:col-span-2">
            <legend className="mb-2 text-sm font-bold text-ink">
              {L.interests}
              <Optional />
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {CONTACT.interests.map((i) => (
                <Choice
                  key={i.id}
                  name="interests"
                  value={i.id}
                  checked={values.interests.includes(i.id)}
                  onChange={(e) => set("interests", e.target.checked ? [...values.interests, i.id] : values.interests.filter((x) => x !== i.id))}
                  label={i.label}
                />
              ))}
            </div>
          </fieldset>
        ) : null}
        {text("product_interest", L.product_interest, { hint: CONTACT.hints.product_interest, className: "sm:col-span-2" })}
        {text("quantity", L.quantity, { inputMode: "numeric", hint: CONTACT.hints.quantity })}
        {text("device_quantity", L.device_quantity, { inputMode: "numeric" })}
        {text("care_recipients_estimate", L.care_recipients_estimate, { inputMode: "numeric" })}
        {select("timeline", L.timeline, CONTACT.timelines)}
        {area("integration_requirements", L.integration_requirements, "sm:col-span-2")}
        <InsetTextarea
          name="message"
          label={label("message", messageLabel)}
          required={req("message")}
          rows={5}
          hint={CONTACT.hints.message}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          error={errors.message}
          maxLength={2020}
          wrapperClassName="sm:col-span-2"
        />
      </Group>

      {variant === "individual_purchase" ? (
        <Group title={CONTACT.sections.delivery}>
          {text("recipient_name", L.recipient_name, { autoComplete: "shipping name" })}
          {text("recipient_phone", L.recipient_phone, { type: "tel", autoComplete: "shipping tel", inputMode: "tel" })}
          {text("delivery_address", L.delivery_address, { autoComplete: "shipping street-address", className: "sm:col-span-2" })}
          {area("delivery_notes", L.delivery_notes, "sm:col-span-2")}
        </Group>
      ) : null}
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4">
      <legend className="mb-4 font-mono text-xs tracking-[0.14em] text-teal-deep uppercase">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function SuccessPanel({ focusRef, result, variant, onAgain }: { focusRef: Ref<HTMLDivElement>; result: ContactSubmitResult; variant: Variant; onAgain: () => void }) {
  // "sent" chỉ nghĩa là nhà cung cấp email đã nhận thư báo đội ngũ; không nói gì thêm về việc đã gửi tới nơi.
  const status = result.notification.status;
  const delayed = status === "sent" ? null : status === "not_configured" ? CONTACT.success.notificationNotConfigured : CONTACT.success.notificationPending;
  return (
    <div ref={focusRef} tabIndex={-1} role="status" aria-labelledby="contact-success-title" className="flex flex-col gap-5 focus:outline-none" data-testid="contact-success">
      <CircleCheck aria-hidden className="size-10 text-teal-deep" />
      <h3 id="contact-success-title" className="font-display text-2xl leading-snug font-bold text-midnight">
        {CONTACT.success.title}
      </h3>
      <div className="flex flex-col gap-1 rounded-control bg-ivory p-4">
        <span className="text-sm font-bold text-ink">{CONTACT.success.reference}</span>
        <span className="font-mono text-xl font-bold tracking-[0.06em] break-all text-midnight" data-testid="contact-reference">
          {result.request_id}
        </span>
      </div>
      {result.duplicate ? <p className="text-ink">{CONTACT.success.duplicate}</p> : null}
      <p className="text-ink">{CONTACT.success.body}</p>
      {isPurchase(variant) ? <p className="text-ink">{CONTACT.success.purchase}</p> : null}
      {delayed ? (
        <p className="flex items-start gap-2 rounded-control bg-ivory p-3 text-sm text-ink" data-testid="contact-notification-delayed">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-teal-deep" />
          {delayed}
        </p>
      ) : null}
      <button type="button" onClick={onAgain} className={landingButtonClasses({ tone: "light", variant: "secondary", className: "w-full sm:w-auto sm:self-start" })}>
        {CONTACT.success.again}
      </button>
    </div>
  );
}
