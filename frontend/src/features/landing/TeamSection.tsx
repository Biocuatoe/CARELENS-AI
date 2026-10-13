import { cn } from "../../design-system/cn";
import { Eyebrow } from "../../design-system/landing";
import { SECTION_IDS, TEAM } from "./content";
import { Reveal } from "./Reveal";

/**
 * Ảnh chân dung dùng trực tiếp từ thư mục `members/` ở gốc dự án (không sao chép, không đổi tên). Tên tệp có dạng "Họ tên - VAI TRÒ.jpg"
 * và là nguồn duy nhất cho tên và vai trò, nên ảnh, tên và vai trò không thể lệch nhau.
 */
const portraits = import.meta.glob("../../../../members/*.jpg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export interface Member {
  name: string;
  role: string;
  src: string;
}

/** Danh sách thành viên đọc từ tên tệp. Vai trò không có trong `desktopOrder` thì xếp cuối. */
export function readMembers(files: Record<string, string>): Member[] {
  const out: Member[] = [];
  for (const [path, src] of Object.entries(files)) {
    const m = /([^/\\]+) - ([A-Za-z]+)\.jpe?g$/i.exec(path.normalize("NFC"));
    if (m) out.push({ name: m[1]!.trim(), role: m[2]!.toUpperCase(), src });
  }
  return out;
}

/** Vị trí theo thứ tự màn rộng (0–4); CEO luôn ở giữa (2). */
function slot(role: string): number {
  const i = (TEAM.desktopOrder as readonly string[]).indexOf(role);
  return i < 0 ? 99 : i;
}

export function TeamSection() {
  const members = readMembers(portraits);
  // DOM bắt đầu bằng CEO (thứ tự đọc và thứ tự trên màn hẹp), rồi tới những người còn lại theo vị trí màn rộng.
  const ordered = [...members].sort((a, b) => (a.role === "CEO" ? -1 : b.role === "CEO" ? 1 : slot(a.role) - slot(b.role)));
  return (
    <section id={SECTION_IDS.team} aria-labelledby="team-title" data-tone="dark" className="scroll-mt-(--landing-header-h) bg-graphite py-20 text-ivory md:py-28">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 md:px-6">
        <div className="flex max-w-3xl flex-col gap-5">
          <Eyebrow tone="dark">{TEAM.eyebrow}</Eyebrow>
          <h2 id="team-title" className="font-display text-3xl leading-tight font-extrabold tracking-tight text-balance md:text-5xl">
            {TEAM.heading}
          </h2>
        </div>

        <Reveal>
          {/* Lưới đều: mọi thẻ cùng cỡ ảnh (4:5), cùng bo góc, cùng đường cơ sở. Màn rộng năm cột với CEO ở cột giữa; tablet và điện thoại CEO một hàng riêng ở đầu rồi lưới 2 × 2. */}
          <ul data-testid="team-grid" className="mx-auto grid w-full max-w-[22rem] grid-cols-2 items-start gap-x-4 gap-y-8 sm:max-w-xl md:gap-x-6 lg:max-w-none lg:grid-cols-5 lg:gap-x-6">
            {ordered.map((m, i) => {
              const ceo = m.role === "CEO";
              return (
                <li
                  key={m.role}
                  data-role={m.role}
                  // Màn rộng: đặt theo `desktopOrder` (CEO ở cột giữa). Nhấp nhô lệch pha theo vị trí (độ trễ âm: không có khoảng đứng yên lúc đầu).
                  style={{ ["--slot" as string]: slot(m.role) + 1, animationDelay: `${-(slot(m.role) % 5) * 1.6}s` }}
                  className={cn("group motion-safe:animate-sway lg:order-(--slot)", ceo ? "col-span-2 mx-auto w-[calc(50%-0.5rem)] md:w-[calc(50%-0.75rem)] lg:col-span-1 lg:w-full" : "")}
                  data-index={i}
                >
                  <div className="flex flex-col gap-4 transition-transform duration-300 ease-out group-hover:-translate-y-1.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 lg:origin-top lg:data-[ceo=true]:scale-[1.04]" data-ceo={ceo}>
                    <div
                      className={cn(
                        "overflow-hidden rounded-2xl border transition-[border-color,box-shadow] duration-300 group-hover:shadow-stage-card",
                        ceo ? "border-signal/70 group-hover:border-signal" : "border-ivory/15 group-hover:border-ivory/45",
                      )}
                    >
                      <img src={m.src} alt={`${m.name}, ${m.role}`} width={400} height={500} loading="lazy" decoding="async" className="aspect-[4/5] w-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
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
      </div>
    </section>
  );
}
