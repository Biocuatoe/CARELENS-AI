import { Link, NavLink, Outlet } from "react-router";
import { LogOut } from "lucide-react";
import { useAdminAuth } from "../../app/adminAuth";
import { Wordmark } from "../../design-system/Brand";
import { buttonClasses } from "../../design-system/primitives";
import { ADMIN_ROLE_LABELS } from "./labels";

const NAV: Array<{ to: string; label: string; end?: boolean }> = [
  { to: "/admin", label: "Tổng quan", end: true },
  { to: "/admin/devices", label: "Thiết bị" },
  { to: "/admin/reports", label: "Báo cáo ngày" },
  { to: "/admin/messages", label: "Gửi âm thanh" },
  { to: "/admin/reminders", label: "Nhắc lịch" },
  { to: "/admin/agents", label: "Agent" },
  { to: "/admin/audit", label: "Nhật ký" },
];

/**
 * Khung khu quản trị: thanh đầu trang tông tối như ứng dụng, nội dung tông sáng. Danh tính và vai trò hiển thị đúng như máy chủ
 * trả về từ GET /api/admin/v1/me; giao diện không tự suy ra hay lưu vai trò nào.
 */
export function AdminLayout() {
  const { state, signOut } = useAdminAuth();
  const profile = state.status === "signed_in" ? state.profile : null;

  return (
    <div className="min-h-dvh bg-surface text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-teal-deep focus:px-5 focus:py-3 focus:font-bold focus:text-paper"
      >
        Bỏ qua điều hướng
      </a>
      <header data-tone="dark" className="sticky top-0 z-20 border-b border-ivory/10 bg-midnight text-ivory">
        <div className="mx-auto flex min-h-(--landing-header-h) w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 md:px-6 lg:px-8">
          <Link to="/admin" aria-label="CareLens AI, quản trị" className="inline-flex min-h-11 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-4">
            <Wordmark />
          </Link>
          <span className="font-mono text-xs font-medium tracking-[0.18em] text-signal uppercase">Quản trị</span>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-3">
            {profile ? (
              <div className="min-w-0 text-right" aria-label="Tài khoản quản trị đang đăng nhập">
                <p className="truncate text-sm font-bold">{profile.email}</p>
                <p className="text-xs">{ADMIN_ROLE_LABELS[profile.role]}</p>
              </div>
            ) : null}
            <button type="button" onClick={() => void signOut()} className={buttonClasses({ tone: "dark", variant: "secondary", size: "sm" })}>
              <LogOut className="size-4" aria-hidden />
              Đăng xuất
            </button>
          </div>
        </div>
        <nav aria-label="Khu quản trị" className="mx-auto w-full max-w-7xl overflow-x-auto px-4 pb-2 md:px-6 lg:px-8">
          <ul className="flex min-w-max gap-2">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold ${isActive ? "bg-ivory text-midnight" : "text-ivory shadow-extruded-sm"}`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pt-6 pb-16 focus:outline-none md:px-6 md:pt-8 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
