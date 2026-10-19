import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { Menu, X } from "lucide-react";
import { cn } from "../../design-system/cn";
import { landingButtonClasses } from "../../design-system/landing";
import { useAuth } from "../../app/auth";
import { Wordmark } from "../../design-system/Brand";
import { CTA, NAV_ITEMS, SECTION_IDS } from "./content";

const navLink =
  "inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-medium text-ivory/85 transition-colors duration-300 hover:text-mint focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * Header cố định cao `--landing-header-h`. Dưới `lg` điều hướng gập thành menu; nút chính luôn nằm ngoài menu.
 * Cảnh 3D bắt đầu ngay dưới header nên header không che mô hình.
 */
export function LandingHeader() {
  const { state } = useAuth();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const signedIn = state.status === "signed_in";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const appLink = (
    <Link to={signedIn ? "/people" : "/login"} className={cn(navLink, "px-3")}>
      {signedIn ? CTA.app : CTA.login}
    </Link>
  );

  return (
    <header data-tone="dark" className="sticky top-0 z-40 h-(--landing-header-h) border-b border-ivory/10 bg-midnight text-ivory">
      <div className="mx-auto flex h-full w-full max-w-7xl items-center gap-4 px-4 md:px-6">
        <Link to="/" aria-label="CareLens AI, về đầu trang" className="inline-flex min-h-11 shrink-0 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-4">
          <Wordmark />
        </Link>

        <nav aria-label="Các phần của trang" className="ml-6 hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className={navLink}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline-flex">{appLink}</span>
          {/* Bọc ngoài để ẩn/hiện: class `inline-flex` của nút sẽ thắng `hidden` nếu đặt chung một phần tử. */}
          <span className="hidden sm:inline-flex">
            <a href={`#${SECTION_IDS.contact}`} className={landingButtonClasses({ tone: "dark", className: "min-h-11 px-5" })}>
              {CTA.contact}
            </a>
          </span>
          <button
            ref={toggleRef}
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full text-ivory transition-colors hover:text-mint focus-visible:outline-2 focus-visible:outline-offset-2 lg:hidden"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? "Đóng menu" : "Mở menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
          </button>
        </div>
      </div>

      <div id={menuId} hidden={!open} className="absolute inset-x-0 top-full max-h-[calc(100dvh-var(--landing-header-h))] overflow-y-auto border-b border-ivory/10 bg-midnight px-4 pt-2 pb-5 lg:hidden">
        <nav aria-label="Các phần của trang">
          <ul className="flex flex-col">
            {NAV_ITEMS.map((item) => (
              <li key={item.id} className="border-b border-ivory/10">
                <a href={`#${item.id}`} className={cn(navLink, "w-full rounded-none px-1 text-base")} onClick={() => setOpen(false)}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-4 flex flex-col gap-3">
          <a href={`#${SECTION_IDS.contact}`} className={landingButtonClasses({ tone: "dark" })} onClick={() => setOpen(false)}>
            {CTA.contact}
          </a>
          <Link to={signedIn ? "/people" : "/login"} className={landingButtonClasses({ tone: "dark", variant: "secondary" })}>
            {signedIn ? CTA.app : CTA.login}
          </Link>
        </div>
      </div>
    </header>
  );
}
