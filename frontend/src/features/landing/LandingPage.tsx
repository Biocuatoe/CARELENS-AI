import { lazy, Suspense, useCallback, useEffect } from "react";
import { HERO, SECTION_IDS } from "./content";
import { FallSection } from "./FallSection";
import { HeroIntro } from "./HeroIntro";
import { ContactSection } from "./ContactSection";
import { LandingFooter } from "./LandingFooter";
import { LandingHeader } from "./LandingHeader";
import { MedicationSection } from "./MedicationSection";
import { PrivacySection } from "./PrivacySection";
import { TeamSection } from "./TeamSection";

// Cảnh 3D (three.js, vỏ STL) nằm ở chunk riêng: chữ hero và phần còn lại của trang hiện ngay, cảnh tải sau.
const HardwareScrollStory = lazy(() => import("../common/HardwareScrollStory").then((m) => ({ default: m.HardwareScrollStory })));

/** Cuộn tới một tiến trình của cảnh 3D (đoạn mở nắp), theo cùng công thức mà cảnh dùng để đọc vị trí cuộn. */
function scrollToStory(progress: number) {
  const section = document.getElementById(SECTION_IDS.device);
  const stage = section?.firstElementChild as HTMLElement | null;
  if (!section || !stage) return;
  const total = section.offsetHeight - stage.clientHeight;
  const stickyTop = parseFloat(getComputedStyle(stage).top) || 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const target = reduced ? Math.max(progress, 0.4) : progress;
  window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top + target * total - stickyTop, behavior: reduced ? "auto" : "smooth" });
}

/** Tiêu đề tab, màu thanh trình duyệt và nền khi cuộn quá mép đều theo landing; trả lại khi rời trang. */
function useLandingDocument() {
  useEffect(() => {
    const prevTitle = document.title;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevMeta = meta?.content;
    const prevBg = document.documentElement.style.backgroundColor;
    const midnight = getComputedStyle(document.documentElement).getPropertyValue("--color-midnight").trim();
    document.title = "CareLens AI · Thiết bị đeo hỗ trợ chăm sóc";
    if (meta && midnight) meta.content = midnight;
    if (midnight) document.documentElement.style.backgroundColor = midnight;
    return () => {
      document.title = prevTitle;
      if (meta && prevMeta !== undefined) meta.content = prevMeta;
      document.documentElement.style.backgroundColor = prevBg;
    };
  }, []);
}

/** Khung chờ trong lúc chunk 3D tải: cùng bố cục hero nên không có cú nhảy khi cảnh xuất hiện. */
function StoryFallback({ onExplore }: { onExplore: () => void }) {
  return (
    <section id={SECTION_IDS.device} aria-label="Thiết bị CareLens AI" data-tone="dark" className="relative h-[calc(100svh-var(--landing-header-h))] overflow-hidden bg-midnight">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(70%_65%_at_50%_52%,var(--color-graphite)_0%,var(--color-midnight)_72%)] opacity-90" />
      <div className="absolute inset-0">
        <HeroIntro active onExplore={onExplore} />
      </div>
    </section>
  );
}

/**
 * Landing CareLens AI (A19). Thiết bị 3D là trung tâm: hero và cảnh mở nắp là một khung cố định duy nhất, nên thiết bị không bao giờ
 * là vật trang trí nhỏ bên cạnh chữ. Các phần sau xen kẽ nền tối (kỹ thuật) và nền sáng (giải thích).
 */
export function LandingPage() {
  useLandingDocument();
  const explore = useCallback(() => scrollToStory(0.15), []);

  return (
    <div className="min-h-dvh bg-midnight text-ivory">
      <a
        href="#noi-dung"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-signal focus:px-5 focus:py-3 focus:font-bold focus:text-midnight"
      >
        Bỏ qua điều hướng
      </a>
      <LandingHeader />

      <main id="noi-dung" tabIndex={-1} className="focus:outline-none">
        <Suspense fallback={<StoryFallback onExplore={explore} />}>
          <HardwareScrollStory id={SECTION_IDS.device} headerOffset outro={HERO.outro} intro={(active) => <HeroIntro active={active} onExplore={explore} />} />
        </Suspense>
        <FallSection />
        {/* Cảnh quan sát kết thúc bằng chương bảo vệ dữ liệu trên cùng khung 3D, nên phần Riêng tư đứng ngay sau. */}
        <MedicationSection />
        <PrivacySection />
        <TeamSection />
        <ContactSection />
      </main>

      <LandingFooter />
    </div>
  );
}
