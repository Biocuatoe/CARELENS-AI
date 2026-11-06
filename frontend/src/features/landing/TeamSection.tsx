import { useEffect, useState } from "react";
import { cn } from "../../design-system/cn";
import { Eyebrow } from "../../design-system/landing";
import { SECTION_IDS, TEAM, type Expert } from "./content";
import { Reveal } from "./Reveal";

/**
 * Ảnh chân dung dùng trực tiếp từ thư mục `members/` ở gốc dự án (không sao chép, không đổi tên). Khớp không phân biệt hoa thường
 * (có tệp đuôi `.JPG`). Mỗi người trỏ tới đúng tên tệp qua `TEAM` trong `content.ts`.
 */
const portraits = import.meta.glob("../../../../members/*.{jpg,JPG,jpeg,JPEG}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** Tìm URL ảnh theo tên tệp. Trả `undefined` nếu tệp không có, để test bắt được thay vì hiện ảnh sai. */
export function portraitFor(file: string, files: Record<string, string> = portraits): string | undefined {
  const want = file.normalize("NFC").toLowerCase();
  for (const [path, src] of Object.entries(files)) {
    const base = path.normalize("NFC").split(/[/\\]/).pop()!.toLowerCase();
    if (base === want) return src;
  }
  return undefined;
}

/** Thứ tự cột trên màn rộng (0–4). CEO luôn ở giữa (2). */
function slot(role: string): number {
  return TEAM.core.findIndex((m) => m.role === role);
}

/**
 * Chế độ xem bản nháp lời chuyên gia: chỉ trong `npm run dev` kèm `?team-quotes=draft`. Trong bản build `import.meta.env.DEV` là false nên
 * cả nhánh nạp tệp nháp bị loại khỏi gói JS.
 */
function useDraftQuotes(): Readonly<Record<string, string>> {
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(window.location.search).get("team-quotes") !== "draft") return;
    let live = true;
    void import("./teamQuotes.draft").then((m) => {
      if (live) setDrafts(m.TEAM_QUOTE_DRAFTS);
    });
    return () => {
      live = false;
    };
  }, []);
  return drafts;
}

function QuoteMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-7 shrink-0 text-signal" fill="currentColor">
      <path d="M9.4 5C5.9 6.6 4 9.5 4 13.2V19h6.2v-6H7.1c.1-2 1.1-3.5 3-4.5L9.4 5Zm9 0c-3.5 1.6-5.4 4.5-5.4 8.2V19h6.2v-6h-3.1c.1-2 1.1-3.5 3-4.5L18.4 5Z" />
    </svg>
  );
}

function ExpertCard({ expert, draft }: { expert: Expert; draft?: string }) {
  const src = portraitFor(expert.file);
  const approved = expert.quote?.approvedBy && expert.quote.approvedAt ? expert.quote.text : undefined;
  const quote = approved ?? draft;
  return (
    <li data-expert={expert.id} className="flex flex-col gap-5 rounded-2xl border border-ivory/15 bg-midnight/40 p-5 transition-[border-color] duration-300 hover:border-ivory/40 motion-reduce:transition-none md:p-6">
      <div className="flex items-center gap-5">
        <img
          src={src}
          alt={`${expert.name}, ${TEAM.expertsRole}`}
          width={112}
          height={140}
          loading="lazy"
          decoding="async"
          className="aspect-[4/5] w-24 shrink-0 rounded-xl border border-ivory/15 object-cover object-top sm:w-28"
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="font-display text-lg leading-snug font-bold text-balance md:text-xl">{expert.name}</p>
          <p className="font-mono text-xs tracking-[0.16em] text-ivory/80 uppercase">{TEAM.expertsRole}</p>
        </div>
      </div>
      {quote ? (
        <figure data-quote-state={approved ? "approved" : "draft"} className="flex flex-col gap-3 border-t border-ivory/10 pt-5">
          {!approved ? (
            <figcaption className="font-mono text-xs tracking-[0.12em] text-mint uppercase">Bản nháp đề xuất · chưa được chuyên gia xác nhận</figcaption>
          ) : null}
          <div className="flex gap-3">
            <QuoteMark />
            <blockquote className="max-w-[60ch] text-base leading-relaxed text-ivory/90">{quote}</blockquote>
          </div>
          {approved ? <figcaption className="text-sm text-ivory/80">Đã được {expert.quote!.approvedBy} duyệt ngày {expert.quote!.approvedAt}.</figcaption> : null}
        </figure>
      ) : null}
    </li>
  );
}

export function TeamSection() {
  const drafts = useDraftQuotes();
  // DOM bắt đầu bằng CEO (thứ tự đọc và thứ tự trên màn hẹp), rồi tới những người còn lại theo cột màn rộng.
  const ordered = [...TEAM.core].sort((a, b) => (a.role === "CEO" ? -1 : b.role === "CEO" ? 1 : slot(a.role) - slot(b.role)));
  return (
    <section id={SECTION_IDS.team} aria-labelledby="team-title" data-tone="dark" className="scroll-mt-(--landing-header-h) bg-graphite py-20 text-ivory md:py-28">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-14 px-4 md:px-6">
        <div className="flex max-w-3xl flex-col gap-5">
          <Eyebrow tone="dark">{TEAM.eyebrow}</Eyebrow>
          <h2 id="team-title" className="font-display text-3xl leading-tight font-extrabold tracking-tight text-balance md:text-5xl">
            {TEAM.heading}
          </h2>
        </div>

        <Reveal>
          <h3 className="sr-only">{TEAM.coreLabel}</h3>
          {/* Lưới đều: mọi thẻ cùng cỡ ảnh (4:5), cùng bo góc, cùng đường cơ sở. Màn rộng năm cột với CEO ở cột giữa; tablet và điện thoại CEO một hàng riêng ở đầu rồi lưới 2 × 2. */}
          <ul data-testid="team-grid" className="mx-auto grid w-full max-w-[22rem] grid-cols-2 items-start gap-x-4 gap-y-8 sm:max-w-xl md:gap-x-6 lg:max-w-none lg:grid-cols-5 lg:gap-x-6">
            {ordered.map((m) => {
              const ceo = m.role === "CEO";
              return (
                <li
                  key={m.role}
                  data-role={m.role}
                  // Màn rộng: đặt theo thứ tự cột của `TEAM.core` (CEO ở cột giữa). Nhấp nhô lệch pha theo vị trí (độ trễ âm: không có khoảng đứng yên lúc đầu).
                  style={{ ["--slot" as string]: slot(m.role) + 1, animationDelay: `${-(slot(m.role) % 5) * 1.6}s` }}
                  className={cn("group motion-safe:animate-sway lg:order-(--slot)", ceo ? "col-span-2 mx-auto w-[calc(50%-0.5rem)] md:w-[calc(50%-0.75rem)] lg:col-span-1 lg:w-full" : "")}
                >
                  <div className="flex flex-col gap-4 transition-transform duration-300 ease-out group-hover:-translate-y-1.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 lg:origin-top lg:data-[ceo=true]:scale-[1.04]" data-ceo={ceo}>
                    <div
                      className={cn(
                        "overflow-hidden rounded-2xl border transition-[border-color,box-shadow] duration-300 group-hover:shadow-stage-card",
                        ceo ? "border-signal/70 group-hover:border-signal" : "border-ivory/15 group-hover:border-ivory/45",
                      )}
                    >
                      <img src={portraitFor(m.file)} alt={`${m.name}, ${m.role}`} width={400} height={500} loading="lazy" decoding="async" className="aspect-[4/5] w-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
                    </div>
                    <div className="flex flex-col gap-1.5 text-center">
                      <p className="font-display text-base leading-snug font-bold md:text-lg">{m.name}</p>
                      <p className={cn("font-mono text-xs tracking-[0.16em] uppercase", ceo ? "text-mint" : "text-ivory/80")}>{m.role}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Reveal>

        <Reveal>
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 border-t border-ivory/15 pt-12">
            <h3 id="experts-title" className="font-display text-2xl leading-tight font-bold tracking-tight md:text-3xl">
              {TEAM.expertsHeading}
            </h3>
            <ul aria-labelledby="experts-title" data-testid="expert-grid" className="grid w-full grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
              {TEAM.experts.map((e) => (
                <ExpertCard key={e.id} expert={e} draft={drafts[e.id]} />
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
