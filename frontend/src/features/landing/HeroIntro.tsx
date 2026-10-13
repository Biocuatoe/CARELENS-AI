import { ArrowRight } from "lucide-react";
import { cn } from "../../design-system/cn";
import { landingButtonClasses } from "../../design-system/landing";
import { CTA, HERO, SECTION_IDS, TAGLINE } from "./content";

/**
 * Chữ mở đầu nằm trên khung 3D cố định. Thiết bị là trung tâm: camera đặt thiết bị lệch sang phải (màn rộng) hoặc xuống dưới (màn hẹp)
 * để chừa chỗ cho chữ. Khi bắt đầu cuộn, chữ mờ đi và `active` chuyển sang false: điều khiển bị ngắt, tiêu đề vẫn nằm trong cây truy cập.
 */
export function HeroIntro({ active, onExplore }: { active: boolean; onExplore: () => void }) {
  return (
    <div className="relative mx-auto flex h-full w-full max-w-7xl flex-col px-4 pt-5 pb-4 md:px-6 lg:justify-center lg:pt-0 lg:pb-12">
      <div data-intro-block className="flex max-w-[35rem] flex-col gap-4 lg:gap-6">
        <h1 className="font-display text-[1.9rem] leading-[1.08] font-extrabold tracking-tight text-balance sm:text-5xl lg:text-[3.35rem] [@media(max-height:720px)]:lg:text-[2.6rem]">{HERO.headline}</h1>
        <p className="font-display text-xs font-bold tracking-[0.14em] text-ivory sm:text-base sm:tracking-[0.2em]">{TAGLINE.join(" ")}</p>
        <div className={cn("flex flex-col gap-3 pt-1 sm:flex-row", !active && "invisible")} inert={!active}>
          <button type="button" onClick={onExplore} className={cn(landingButtonClasses({ tone: "dark" }), "pointer-events-auto")}>
            {CTA.explore}
            <ArrowRight className="size-4" aria-hidden />
          </button>
          <span className="hidden sm:inline-flex">
            <a href={`#${SECTION_IDS.contact}`} className={cn(landingButtonClasses({ tone: "dark", variant: "secondary" }), "pointer-events-auto")}>
              {CTA.contact}
            </a>
          </span>
        </div>
      </div>

      <p className="hidden flex-col items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-ivory/75 uppercase lg:absolute lg:bottom-7 lg:left-6 lg:flex lg:items-start [@media(max-height:760px)]:lg:hidden" aria-hidden>
        {HERO.scrollCue}
        <span className="relative block h-8 w-px overflow-hidden bg-ivory/20">
          <span className="absolute inset-x-0 top-0 h-3 animate-cue bg-signal" />
        </span>
      </p>
    </div>
  );
}
