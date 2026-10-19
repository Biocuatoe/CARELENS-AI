import { useId, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Cpu,
  FileText,
  HeartPulse,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ScanEye,
  Users,
  X,
} from "lucide-react";
import type { RecipientContext } from "../data/contracts";
import { hasPermission } from "../data/permissions";
import type { StreamStatus } from "../data/stream";
import { cn } from "../design-system/cn";
import { Wordmark } from "../design-system/Brand";
import { DemoBadge } from "../design-system/feedback";
import { useAuth } from "./auth";

type NavItem = { to: string; label: string; short: string; icon: ReactNode; badge?: number | null; end?: boolean };

function recipientNav(ctx: RecipientContext): NavItem[] {
  const id = ctx.recipient.id;
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(ctx.permissions, p);
  const enrolled = (p: "carelens" | "ecopatch") => ctx.recipient.enrollments.some((e) => e.product === p);
  const items: NavItem[] = [];
  if (can("data.read")) items.push({ to: `/people/${id}/overview`, label: "Tổng quan", short: "Tổng quan", icon: <LayoutDashboard aria-hidden /> });
  if (can("data.read") && enrolled("carelens")) items.push({ to: `/people/${id}/carelens`, label: "CareLens", short: "CareLens", icon: <ScanEye aria-hidden /> });
  if (can("data.read") && enrolled("ecopatch")) items.push({ to: `/people/${id}/ecopatch`, label: "EcoPatch", short: "EcoPatch", icon: <HeartPulse aria-hidden /> });
  if (can("data.read"))
    items.push({ to: `/people/${id}/alerts`, label: "Cảnh báo", short: "Cảnh báo", icon: <Bell aria-hidden />, badge: ctx.recipient.openAlertCount });
  items.push({ to: `/people/${id}/devices`, label: "Thiết bị & hướng dẫn", short: "Thiết bị", icon: <Cpu aria-hidden /> });
  if (can("data.read")) items.push({ to: `/people/${id}/history`, label: "Lịch sử", short: "Lịch sử", icon: <History aria-hidden /> });
  if (can("data.read")) items.push({ to: `/people/${id}/reports`, label: "Báo cáo", short: "Báo cáo", icon: <FileText aria-hidden /> });
  items.push({ to: `/people/${id}/sharing`, label: "Gia đình & quyền truy cập", short: "Quyền", icon: <Users aria-hidden /> });
  return items;
}

/** Tài khoản Live Demo chỉ có một hồ sơ nên không có trang danh sách hồ sơ; mục tài khoản duy nhất là thông báo và đăng xuất. */
const ACCOUNT_NAV: NavItem[] = [{ to: "/settings/notifications", label: "Thông báo & tài khoản", short: "Tài khoản", icon: <Settings aria-hidden /> }];

const PAGE_TITLES: Array<[RegExp, string]> = [
  [/\/overview$/, "Tổng quan"],
  [/\/carelens$/, "CareLens"],
  [/\/ecopatch$/, "EcoPatch"],
  [/\/alerts\/[^/]+$/, "Chi tiết cảnh báo"],
  [/\/alerts$/, "Cảnh báo"],
  [/\/devices$/, "Thiết bị & hướng dẫn"],
  [/\/history$/, "Lịch sử"],
  [/\/reports$/, "Báo cáo"],
  [/\/sharing$/, "Gia đình & quyền truy cập"],
  [/^\/settings\/notifications$/, "Thông báo & tài khoản"],
];

function usePageTitle() {
  const { pathname } = useLocation();
  return PAGE_TITLES.find(([re]) => re.test(pathname))?.[1] ?? "CareLens AI";
}

/* Thanh điều hướng dùng tông tối của landing (midnight/ivory/signal); nội dung bên phải dùng tông sáng (ivory/paper/ink). */
const navItemBase =
  "flex min-h-12 items-center gap-3 rounded-2xl border px-4 text-sm font-medium whitespace-nowrap transition-colors duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 [&_svg]:size-5 [&_svg]:shrink-0";
const navItemIdle = "border-transparent text-ivory/85 hover:text-mint";
const navItemActive = "border-signal/60 bg-graphite font-bold text-ivory [&_svg]:text-signal";

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(navItemBase, isActive ? navItemActive : navItemIdle);
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink to={item.to} end={item.end} className={navLinkClass} onClick={onNavigate}>
            {item.icon}
            <span className="min-w-0 flex-1 whitespace-nowrap">{item.label}</span>
            {item.badge ? (
              <>
                <span aria-hidden className="rounded-full border border-ivory/40 px-2 py-0.5 text-xs font-bold">
                  {item.badge}
                </span>
                <span className="sr-only">({item.badge} cảnh báo đang mở)</span>
              </>
            ) : null}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

const STREAM_LABEL: Record<StreamStatus, { text: string; attention: boolean }> = {
  open: { text: "Cập nhật trực tiếp khi trang mở", attention: false },
  closed_error: { text: "Mất luồng cập nhật, đang thử lại", attention: true },
  closed_revoked: { text: "Quyền truy cập đã bị thu hồi", attention: true },
  closed_session: { text: "Phiên đã hết hạn", attention: true },
};

/** Nhãn trạng thái luồng trên thanh tiêu đề tối. Mức chú ý nhận biết bằng icon, chữ và viền đậm, không chỉ bằng màu. */
function StreamStatusLabel({ status }: { status: StreamStatus }) {
  const { text, attention } = STREAM_LABEL[status];
  const Icon = attention ? CircleAlert : CircleDot;
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm text-ivory [&_svg]:size-4 [&_svg]:shrink-0",
        attention ? "border-2 border-ivory font-bold" : "border-ivory/40 font-medium",
      )}
    >
      <Icon aria-hidden className="text-signal" />
      {text}
    </span>
  );
}

export function AppShell({
  children,
  recipientContext,
  streamStatus,
}: {
  children: ReactNode;
  recipientContext?: RecipientContext;
  streamStatus?: StreamStatus;
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const title = usePageTitle();
  // Menu mobile gắn với đường dẫn lúc mở: đổi trang thì menu tự đóng.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === location.pathname;
  const setMenuOpen = (open: boolean) => setMenuPath(open ? location.pathname : null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const menuId = useId();

  const recipientItems = recipientContext ? recipientNav(recipientContext) : [];

  const signOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const brand = (
    <Link to="/people" aria-label="CareLens AI, về tổng quan" className="inline-flex min-h-11 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-4">
      <Wordmark />
    </Link>
  );

  const signOutButton = (
    <button type="button" onClick={signOut} className={cn(navLinkClass({ isActive: false }), "w-full")}>
      <LogOut aria-hidden />
      Đăng xuất
    </button>
  );

  return (
    <div className="min-h-dvh bg-surface text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-teal-deep focus:px-5 focus:py-3 focus:font-bold focus:text-paper"
      >
        Bỏ qua điều hướng
      </a>

      {/* Desktop sidebar ≥ 1024px */}
      <aside
        data-tone="dark"
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-ivory/10 bg-midnight text-ivory transition-transform duration-300 ease-out lg:block",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <nav aria-label="Điều hướng chính" className="flex h-full flex-col gap-5 overflow-y-auto p-4">
          <div className="px-1">{brand}</div>
          {recipientItems.length ? (
            <div className="shrink-0">
              <p className="mb-1 px-4 font-mono text-xs font-medium tracking-[0.18em] text-signal uppercase">Hồ sơ</p>
              <NavList items={recipientItems} />
            </div>
          ) : null}
          <div className="mt-auto shrink-0">
            <p className="mb-1 px-4 font-mono text-xs font-medium tracking-[0.18em] text-signal uppercase">Tài khoản</p>
            <NavList items={ACCOUNT_NAV} />
            <div className="mt-1">{signOutButton}</div>
          </div>
        </nav>
      </aside>

      <button
        type="button"
        data-tone="dark"
        className={cn(
          "fixed top-1/2 z-40 hidden size-11 -translate-y-1/2 items-center justify-center border border-ivory/25 bg-midnight text-ivory transition-[transform,color,border-color] duration-300 ease-out hover:border-signal hover:text-mint focus-visible:outline-2 focus-visible:outline-offset-2 lg:inline-flex",
          sidebarOpen ? "left-72 -translate-x-1/2 rounded-full" : "left-0 rounded-r-2xl border-l-0",
        )}
        aria-label={sidebarOpen ? "Ẩn thanh điều hướng" : "Hiện thanh điều hướng"}
        aria-pressed={sidebarOpen}
        onClick={() => setSidebarOpen((open) => !open)}
      >
        {sidebarOpen ? <ChevronLeft className="size-5" aria-hidden /> : <ChevronRight className="size-5" aria-hidden />}
      </button>

      {/* Tablet rail 768–1023px (giả định A07) */}
      <aside data-tone="dark" className="fixed inset-y-0 left-0 z-30 hidden w-28 border-r border-ivory/10 bg-midnight text-ivory md:block lg:hidden">
        <nav aria-label="Điều hướng chính" className="flex h-full flex-col items-stretch gap-2 overflow-y-auto px-2 py-4">
          {[...recipientItems, ...ACCOUNT_NAV].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              aria-label={item.label}
              className={({ isActive }) =>
                cn(
                  "relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border px-1 text-center text-xs leading-tight font-medium transition-colors duration-300 ease-out [&_svg]:size-5",
                  "focus-visible:outline-2 focus-visible:outline-offset-2",
                  isActive ? navItemActive : navItemIdle,
                )
              }
            >
              {item.icon}
              <span>{item.short}</span>
              {item.badge ? (
                <span aria-hidden className="absolute top-1 right-2 text-xs font-bold">
                  {item.badge}
                </span>
              ) : null}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={signOut}
            className="mt-auto flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border border-transparent text-xs font-medium text-ivory/85 transition-colors duration-300 hover:text-mint focus-visible:outline-2 focus-visible:outline-offset-2 [&_svg]:size-5"
          >
            <LogOut aria-hidden />
            Đăng xuất
          </button>
        </nav>
      </aside>

      <div className={cn("transition-[padding] duration-300 ease-out md:pl-28", sidebarOpen ? "lg:pl-72" : "lg:pl-0")}>
        <header data-tone="dark" className="sticky top-0 z-20 h-(--landing-header-h) border-b border-ivory/10 bg-midnight text-ivory">
          <div className="flex h-full items-center gap-3 px-4 md:px-6 lg:px-8">
            <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-6">
              <div className="md:hidden">{brand}</div>
              {recipientContext ? (
                <div className="hidden min-w-0 md:block">
                  <p className="font-mono text-xs font-medium tracking-[0.18em] text-signal uppercase">Hồ sơ đang xem</p>
                  <p className="truncate font-display text-lg leading-tight font-bold">{recipientContext.recipient.displayName}</p>
                </div>
              ) : null}
              <div className="hidden min-w-0 xl:block">
                <p className="font-mono text-xs font-medium tracking-[0.18em] text-signal uppercase">Trang</p>
                <p className="truncate font-bold">{title}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {recipientContext && streamStatus ? (
                <span className="hidden 2xl:block">
                  <StreamStatusLabel status={streamStatus} />
                </span>
              ) : null}
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-full text-ivory transition-colors hover:text-mint focus-visible:outline-2 focus-visible:outline-offset-2 md:hidden"
                aria-expanded={menuOpen}
                aria-controls={menuId}
                aria-label={menuOpen ? "Đóng menu" : "Mở menu"}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                {menuOpen ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
              </button>
            </div>
          </div>

          {/* Mobile slide-down menu < 768px */}
          <div
            id={menuId}
            hidden={!menuOpen}
            className="absolute inset-x-0 top-full max-h-[calc(100dvh-var(--landing-header-h))] overflow-y-auto border-b border-ivory/10 bg-midnight px-4 pt-3 pb-5 md:hidden"
          >
            <nav aria-label="Điều hướng chính" className="flex flex-col gap-4">
              {recipientContext ? (
                <p className="px-1 font-display text-lg font-bold">
                  <span className="block font-mono text-xs font-medium tracking-[0.18em] text-signal uppercase">Hồ sơ đang xem</span>
                  {recipientContext.recipient.displayName}
                </p>
              ) : null}
              {recipientItems.length ? <NavList items={recipientItems} onNavigate={() => setMenuOpen(false)} /> : null}
              <div>
                <p className="mb-1 px-4 font-mono text-xs font-medium tracking-[0.18em] text-signal uppercase">Tài khoản</p>
                <NavList items={ACCOUNT_NAV} onNavigate={() => setMenuOpen(false)} />
                <div className="mt-1">{signOutButton}</div>
              </div>
            </nav>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pt-6 pb-16 focus:outline-none md:px-6 md:pt-8 lg:px-8">
          <p className="mb-2 text-sm font-medium xl:hidden" aria-hidden>
            {title}
          </p>
          {children}
        </main>
      </div>
    </div>
  );
}

export { DemoBadge };
