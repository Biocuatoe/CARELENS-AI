import { useState } from "react";
import { ArrowRight, Check, Copy, Mail } from "lucide-react";
import { Link } from "react-router";
import { cn } from "../../design-system/cn";
import { Eyebrow, landingButtonClasses } from "../../design-system/landing";
import { CONTACT, SECTION_IDS } from "./content";
import { Reveal } from "./Reveal";

type Audience = (typeof CONTACT.audiences)[number];

/** Liên kết thư soạn sẵn theo nhóm người liên hệ, hoặc `null` khi bản dựng chưa có địa chỉ chính thức. Không bao giờ tự bịa địa chỉ. */
export function contactMailto(email: string | undefined, audience: Audience): string | null {
  const to = email?.trim();
  if (!to) return null;
  return `mailto:${to}?subject=${encodeURIComponent(`${CONTACT.mailSubject} · ${audience.title}`)}&body=${encodeURIComponent(audience.draft)}`;
}

/**
 * Phần liên hệ cuối trang: ba nhóm người liên hệ và một nút chính. Có địa chỉ chính thức (`VITE_CONTACT_EMAIL`) thì nút mở thư soạn sẵn theo nhóm;
 * chưa có thì nút sao chép nội dung trao đổi để người xem tự gửi. Trang không có biểu mẫu, không gửi và không thu thập gì.
 */
export function ContactSection() {
  const [selected, setSelected] = useState<Audience["id"]>(CONTACT.audiences[0].id);
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const audience = CONTACT.audiences.find((a) => a.id === selected) ?? CONTACT.audiences[0];
  const href = contactMailto(import.meta.env.VITE_CONTACT_EMAIL, audience);

  const choose = (id: Audience["id"]) => {
    setSelected(id);
    setCopy("idle");
  };
  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(audience.draft);
      setCopy("done");
    } catch {
      setCopy("failed");
    }
  };

  return (
    <section id={SECTION_IDS.contact} aria-labelledby="contact-title" data-tone="dark" className="scroll-mt-(--landing-header-h) border-t border-ivory/10 bg-midnight py-16 text-ivory md:py-24">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 md:px-6">
        <div className="flex max-w-3xl flex-col gap-5">
          <Eyebrow tone="dark">{CONTACT.eyebrow}</Eyebrow>
          <h2 id="contact-title" className="font-display text-4xl leading-[1.05] font-extrabold tracking-tight text-balance md:text-5xl">
            {CONTACT.heading}
          </h2>
          <p className="max-w-xl text-ivory/85 md:text-lg">{CONTACT.body}</p>
        </div>

        <Reveal>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
            <div role="group" aria-label="Chọn nhóm liên hệ" className="flex flex-col gap-3">
              {CONTACT.audiences.map((a, i) => {
                const on = a.id === selected;
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => choose(a.id)}
                    className={cn(
                      "grid min-h-11 grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 md:p-5",
                      on ? "border-signal bg-graphite" : "border-ivory/15 hover:border-signal/70",
                    )}
                  >
                    <span aria-hidden className={cn("font-mono text-sm", on ? "text-mint" : "text-ivory/70")}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="font-display text-lg leading-snug font-bold">{a.title}</span>
                      <span className="text-sm text-ivory/85">{a.why}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-5 rounded-3xl border border-ivory/15 bg-graphite p-5 md:p-8" data-testid="contact-panel">
              <div className="flex flex-col gap-2">
                <p className="font-mono text-[11px] tracking-[0.14em] text-mint uppercase">{CONTACT.draftTitle}</p>
                <p className="font-display text-xl leading-snug font-bold">{audience.title}</p>
              </div>
              <p data-testid="contact-draft" className="text-sm whitespace-pre-line text-ivory/90">
                {audience.draft}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                {href ? (
                  <a href={href} className={landingButtonClasses({ tone: "dark" })}>
                    <Mail className="size-4" aria-hidden />
                    {CONTACT.send}
                  </a>
                ) : (
                  <button type="button" onClick={copyDraft} className={landingButtonClasses({ tone: "dark" })}>
                    {copy === "done" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                    {CONTACT.copy}
                  </button>
                )}
                <a href={`#${SECTION_IDS.team}`} className={landingButtonClasses({ tone: "dark", variant: "secondary" })}>
                  {CONTACT.team}
                </a>
              </div>
              <p role="status" className="min-h-10 text-sm text-ivory/85">
                {href ? "" : copy === "done" ? CONTACT.copied : copy === "failed" ? CONTACT.copyFailed : CONTACT.noChannel}
              </p>
            </div>
          </div>
        </Reveal>

        <Link to="/login" className={landingButtonClasses({ tone: "dark", variant: "secondary", className: "self-start" })}>
          {CONTACT.app}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
