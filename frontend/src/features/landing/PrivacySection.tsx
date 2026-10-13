import { Check, Minus } from "lucide-react";
import { Eyebrow } from "../../design-system/landing";
import { HERO, PRIVACY, SECTION_IDS, TAGLINE } from "./content";
import { Reveal } from "./Reveal";

/**
 * Riêng tư, phẩm giá và nhận thức của người chăm sóc. Khẩu hiệu được trình bày là định hướng, kèm lời giải thích rõ rằng
 * đây không phải bảo đảm kỹ thuật.
 */
export function PrivacySection() {
  return (
    <section id={SECTION_IDS.privacy} aria-labelledby="privacy-title" data-tone="light" className="scroll-mt-(--landing-header-h) bg-ivory py-20 text-ink md:py-28">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-14 px-4 md:px-6">
        <div className="flex max-w-3xl flex-col gap-5">
          <Eyebrow>{PRIVACY.eyebrow}</Eyebrow>
          <h2 id="privacy-title" className="font-display text-3xl leading-tight font-extrabold tracking-tight text-balance md:text-5xl">
            {PRIVACY.heading}
          </h2>
        </div>

        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
          <ol className="border-t border-ink/15">
            {PRIVACY.principles.map((p, i) => (
              <li key={p.id} className="border-b border-ink/15">
                <Reveal className="grid gap-x-6 gap-y-3 py-7 sm:grid-cols-[3rem_minmax(0,1fr)]">
                  <span className="font-mono text-sm text-teal-deep" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex flex-col gap-3">
                    <h3 className="font-display text-xl leading-snug font-bold">{p.title}</h3>
                    <p className="text-ink/90">{p.body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-10">
            <Reveal>
              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <ListBlock title={PRIVACY.shows.title} items={PRIVACY.shows.items} kind="yes" />
                <ListBlock title={PRIVACY.hides.title} items={PRIVACY.hides.items} kind="no" />
              </div>
            </Reveal>

            <Reveal>
              <figure className="flex flex-col gap-4 rounded-3xl bg-midnight p-6 text-ivory md:p-8" data-tone="dark">
                <p className="font-display text-lg leading-snug font-extrabold tracking-[0.12em] text-balance md:text-xl">{TAGLINE.join(" ")}</p>
                <figcaption className="flex flex-col gap-2 text-sm text-ivory/85">
                  <span className="font-mono text-[11px] tracking-[0.16em] text-signal uppercase">{PRIVACY.taglineTitle}</span>
                  <span>{PRIVACY.taglineBody}</span>
                  <span className="text-ivory/75">{HERO.taglineNote}</span>
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

function ListBlock({ title, items, kind }: { title: string; items: readonly string[]; kind: "yes" | "no" }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-lg font-bold">{title}</h3>
      <ul className="flex flex-col gap-2.5 text-sm">
        {items.map((it) => (
          <li key={it} className="flex gap-3">
            <span
              aria-hidden
              className={
                kind === "yes"
                  ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-teal-deep text-paper"
                  : "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-ink/55 text-ink"
              }
            >
              {kind === "yes" ? <Check className="size-3" strokeWidth={3} /> : <Minus className="size-3" strokeWidth={3} />}
            </span>
            <span>
              <span className="sr-only">{kind === "yes" ? "Có: " : "Không có: "}</span>
              {it}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
