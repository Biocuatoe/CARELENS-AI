import { useId, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
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
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import type { RecipientContext } from "../data/contracts";
import { useAdapter } from "../data";
import { hasPermission } from "../data/permissions";
import { qk } from "../data/queryKeys";
import type { StreamStatus } from "../data/stream";
import { cn } from "../design-system/cn";
import { BrandIdentity } from "../design-system/BrandIdentity";
import { DemoBadge, StatusLabel } from "../design-system/feedback";
import { SoftButton } from "../design-system/primitives";
import { useAuth, useSession } from "./auth";

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
  [/^\/people$/, "Hồ sơ chăm sóc"],
  [/^\/settings\/notifications$/, "Thông báo & tài khoản"],
  [/^\/admin$/, "Vận hành"],
];

function usePageTitle() {
  const { pathname } = useLocation();
  return PAGE_TITLES.find(([re]) => re.test(pathname))?.[1] ?? "Day1Care";
}

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    "flex min-h-12 items-center gap-3 rounded-control px-4 font-medium whitespace-nowrap text-fg transition-[box-shadow,transform] duration-300 ease-out",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-5 [&_svg]:shrink-0",
    isActive ? "font-bold shadow-inset-sm [&_svg]:text-accent" : "hover:-translate-y-px hover:shadow-extruded-sm",
  );
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
                <span aria-hidden className="rounded-full px-2 py-0.5 text-sm font-bold shadow-extruded-sm">
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

function accountNav(isAdmin: boolean): NavItem[] {
  const items: NavItem[] = [];
  if (!isAdmin) items.push({ to: "/people", label: "Hồ sơ chăm sóc", short: "Hồ sơ", icon: <UsersRound aria-hidden />, end: true });
  items.push({ to: "/settings/notifications", label: "Thông báo & tài khoản", short: "Tài khoản", icon: <Settings aria-hidden /> });
  if (isAdmin) items.push({ to: "/admin", label: "Vận hành", short: "Vận hành", icon: <Wrench aria-hidden /> });
  return items;
}

function RecipientSwitcher({ ctx }: { ctx: RecipientContext }) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const id = useId();
  const recipients = useQuery({ queryKey: qk.recipients(), queryFn: () => adapter.listRecipients() });
  const options = recipients.data ?? [];

  if (options.length <= 1) {
    return (
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Hồ sơ đang xem</p>
        <p className="truncate font-display text-lg font-bold">{ctx.recipient.displayName}</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <label htmlFor={id} className="text-sm font-medium">
        Hồ sơ đang xem
      </label>
      <select
        id={id}
        value={ctx.recipient.id}
        onChange={async (e) => {
          const next = e.target.value;
          const previous = ctx.recipient.id;
          // Hủy request và xóa cache của hồ sơ cũ để phản hồi đến muộn không hiển thị sai người (ARCHITECTURE §7.2).
          await queryClient.cancelQueries({ queryKey: qk.recipient(previous) });
          queryClient.removeQueries({ queryKey: qk.recipient(previous) });
          navigate(`/people/${next}/overview`);
        }}
        className="min-h-11 w-full truncate rounded-control bg-surface py-1 pr-8 pl-3 font-display text-base font-bold text-fg shadow-extruded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:text-lg"
      >
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

const STREAM_LABEL: Record<StreamStatus, { text: string; tone: "neutral" | "attention" }> = {
  open: { text: "Cập nhật trực tiếp khi trang mở", tone: "neutral" },
  closed_error: { text: "Mất luồng cập nhật, đang thử lại", tone: "attention" },
  closed_revoked: { text: "Quyền truy cập đã bị thu hồi", tone: "attention" },
  closed_session: { text: "Phiên đã hết hạn", tone: "attention" },
};

export function AppShell({
  children,
  recipientContext,
  streamStatus,
}: {
  children: ReactNode;
  recipientContext?: RecipientContext;
  streamStatus?: StreamStatus;
}) {
  const session = useSession();
  const { logout } = useAuth();
  const adapter = useAdapter();
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
  const accountItems = accountNav(session.user.isPlatformAdmin);

  const signOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const brand = (
    <Link to={session.user.isPlatformAdmin ? "/admin" : "/people"} className="rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <BrandIdentity />
    </Link>
  );

  return (
    <div className="min-h-dvh bg-surface text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-3 focus:shadow-extruded"
      >
        Bỏ qua điều hướng
      </a>

      {/* Desktop sidebar ≥ 1024px */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden w-80 p-4 transition-transform duration-300 ease-out lg:block",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <nav aria-label="Điều hướng chính" className="flex h-full flex-col gap-4 overflow-hidden rounded-container bg-surface p-4 shadow-extruded">
          {brand}
          {recipientItems.length ? (
            <div className="shrink-0">
              <p className="mb-1 px-4 text-sm font-bold">Hồ sơ</p>
              <NavList items={recipientItems} />
            </div>
          ) : null}
          <div className="mt-auto shrink-0">
            <p className="mb-1 px-4 text-sm font-bold">Tài khoản</p>
            <NavList items={accountItems} />
            <button type="button" onClick={signOut} className={cn(navLinkClass({ isActive: false }), "mt-1 w-full")}>
              <LogOut aria-hidden />
              Đăng xuất
            </button>
          </div>
        </nav>
      </aside>

      <button
        type="button"
        className={cn(
          "fixed top-1/2 z-40 hidden size-12 -translate-y-1/2 items-center justify-center bg-surface text-fg shadow-extruded-sm transition-[transform,box-shadow] duration-300 ease-out hover:shadow-extruded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:inline-flex",
          sidebarOpen ? "left-80 -translate-x-1/2 rounded-full" : "left-0 rounded-r-control hover:translate-x-px",
        )}
        aria-label={sidebarOpen ? "Ẩn thanh điều hướng" : "Hiện thanh điều hướng"}
        aria-pressed={sidebarOpen}
        onClick={() => setSidebarOpen((open) => !open)}
      >
        {sidebarOpen ? <ChevronLeft className="size-6" aria-hidden /> : <ChevronRight className="size-6" aria-hidden />}
      </button>

      {/* Tablet rail 768–1023px (giả định A07) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-28 p-3 md:block lg:hidden">
        <nav aria-label="Điều hướng chính" className="flex h-full flex-col items-stretch gap-2 overflow-y-auto rounded-container bg-surface px-2 py-4 shadow-extruded">
          {[...recipientItems, ...accountItems].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              aria-label={item.label}
              className={({ isActive }) =>
                cn(
                  "relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-control px-1 text-center text-sm leading-tight font-medium transition-[box-shadow,transform] duration-300 ease-out [&_svg]:size-5",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  isActive ? "font-bold shadow-inset-sm [&_svg]:text-accent" : "hover:-translate-y-px hover:shadow-extruded-sm",
                )
              }
            >
              {item.icon}
              <span>{item.short}</span>
              {item.badge ? (
                <span aria-hidden className="absolute top-1 right-2 text-sm font-bold">
                  {item.badge}
                </span>
              ) : null}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={signOut}
            className="mt-auto flex min-h-16 flex-col items-center justify-center gap-1 rounded-control text-sm font-medium hover:shadow-extruded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-5"
          >
            <LogOut aria-hidden />
            Đăng xuất
          </button>
        </nav>
      </aside>

      <div className={cn("transition-[padding] duration-300 ease-out md:pl-28", sidebarOpen ? "lg:pl-80" : "lg:pl-0")}>
        <header className="sticky top-0 z-20 bg-surface/80 px-4 pt-3 pb-2 backdrop-blur md:px-6 lg:px-8">
          <div className="flex items-center gap-3 rounded-container bg-surface px-4 py-3 shadow-extruded md:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-6">
              <div className="md:hidden">{recipientContext ? null : brand}</div>
              {recipientContext ? <RecipientSwitcher ctx={recipientContext} /> : null}
              <div className="hidden min-w-0 xl:block">
                <p className="text-sm font-medium">Trang</p>
                <p className="truncate font-bold">{title}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {recipientContext && streamStatus ? (
                <span className="hidden 2xl:block">
                  <StatusLabel tone={STREAM_LABEL[streamStatus].tone}>{STREAM_LABEL[streamStatus].text}</StatusLabel>
                </span>
              ) : null}
              <SoftButton
                size="icon"
                className="md:hidden"
                aria-expanded={menuOpen}
                aria-controls={menuId}
                aria-label={menuOpen ? "Đóng menu" : "Mở menu"}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                {menuOpen ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
              </SoftButton>
            </div>
          </div>

          {/* Mobile slide-down menu < 768px */}
          <div
            id={menuId}
            hidden={!menuOpen}
            className="mt-3 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-container bg-surface p-4 shadow-extruded md:hidden"
          >
            <nav aria-label="Điều hướng chính" className="flex flex-col gap-4">
              {recipientContext ? <div className="px-2">{brand}</div> : null}
              {recipientItems.length ? <NavList items={recipientItems} onNavigate={() => setMenuOpen(false)} /> : null}
              <div>
                <p className="mb-2 px-4 text-sm font-bold">Tài khoản</p>
                <NavList items={accountItems} onNavigate={() => setMenuOpen(false)} />
                <button type="button" onClick={signOut} className={cn(navLinkClass({ isActive: false }), "mt-2 w-full")}>
                  <LogOut aria-hidden />
                  Đăng xuất
                </button>
              </div>
            </nav>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pt-4 pb-16 focus:outline-none md:px-6 lg:px-8">
          {adapter.mode === "demo" ? (
            <p className="sr-only">Toàn bộ dữ liệu trên trang là dữ liệu mô phỏng.</p>
          ) : null}
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
