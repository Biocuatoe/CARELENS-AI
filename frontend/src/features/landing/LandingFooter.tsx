import { Link } from "react-router";
import { Wordmark } from "../../design-system/Brand";
import { CTA, FOOTER, NAV_ITEMS, TAGLINE } from "./content";

const link =
  "inline-flex min-h-11 items-center rounded-full px-1 text-sm text-ivory/85 underline decoration-ivory/25 underline-offset-4 transition-colors hover:text-mint hover:decoration-mint focus-visible:outline-2 focus-visible:outline-offset-2";

export function LandingFooter() {
  return (
    <footer data-tone="dark" className="border-t border-ivory/10 bg-midnight py-12 text-ivory">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 md:px-6">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex max-w-lg flex-col gap-4">
            <Wordmark />
            <p className="font-display text-sm font-bold tracking-[0.18em]">{TAGLINE.join(" ")}</p>
          </div>
          <nav aria-label="Liên kết cuối trang">
            <ul className="flex flex-wrap gap-x-5">
              {NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} className={link}>
                    {item.label}
                  </a>
                </li>
              ))}
              <li>
                <Link to="/login" className={link}>
                  {CTA.login}
                </Link>
              </li>
              <li>
                <Link to="/hardware-inspector" className={link}>
                  {FOOTER.inspector}
                </Link>
              </li>
              <li>
                <a href={FOOTER.attributionHref} className={link}>
                  {FOOTER.attribution}
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <p className="max-w-3xl border-t border-ivory/12 pt-6 text-xs text-ivory/75">{FOOTER.status}</p>
      </div>
    </footer>
  );
}
