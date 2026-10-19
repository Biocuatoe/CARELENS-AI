import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import { safeAdminReturnTo, useAdminAuth, type AdminSignedOutReason } from "../../app/adminAuth";
import { isAdminApiError, type SignInAvailability } from "../../data/admin/adminClient";
import { Wordmark } from "../../design-system/Brand";
import { startFullPageNavigation } from "../../lib/navigation";
import { SoftButton, SoftSurface, buttonClasses } from "../../design-system/primitives";
import { cn } from "../../design-system/cn";
import { GoogleMark } from "../auth/LoginPage";

/** Reasons the server puts in the fragment when the Google flow ends without a code (no detail, nothing sensitive). */
const FRAGMENT_ERRORS: Record<string, string> = {
  google_denied: "Bạn đã hủy đăng nhập bằng Google.",
  google_state: "Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.",
  google_unauthorized: "Tài khoản Google này không có quyền quản trị CareLens AI.",
};
const FRAGMENT_ERROR_FALLBACK = "Không hoàn tất được đăng nhập Google. Vui lòng thử lại sau.";

const SIGNED_OUT_NOTICE: Record<NonNullable<AdminSignedOutReason>, string> = {
  expired: "Phiên quản trị đã hết hạn hoặc không còn hợp lệ. Vui lòng đăng nhập lại.",
  forbidden: "Máy chủ từ chối quyền quản trị của tài khoản này.",
  logout: "Đã đăng xuất khỏi khu quản trị.",
  logout_unconfirmed: "Đã đăng xuất trên trình duyệt này, nhưng máy chủ chưa xác nhận việc kết thúc phiên. Phiên sẽ tự hết hạn.",
};

const UNAVAILABLE_TEXT: Record<Extract<SignInAvailability, { state: "unavailable" }>["reason"], string> = {
  google_off: "Đăng nhập bằng Google chưa được cấu hình trên máy chủ này.",
  admin_off: "Đăng nhập quản trị chưa được bật trên máy chủ này.",
  misconfigured: "Cấu hình đăng nhập trên máy chủ chưa đúng. Người vận hành cần kiểm tra.",
  old_server: "Máy chủ này chưa hỗ trợ đăng nhập quản trị.",
};

/** What the Google callback left in the address bar. Read once; the fragment is removed from the address bar at once. */
interface CallbackResult {
  code: string | null;
  error: string | null;
  present: boolean;
}

function readCallback(): CallbackResult {
  const raw = window.location.hash;
  const fragment = new URLSearchParams(raw.slice(1));
  const code = fragment.get("admin_code");
  return {
    // Only the shape of an admin exchange code is accepted: a viewer code (`code=clx_…`) is never exchanged here.
    code: code && /^cax_[A-Za-z0-9_-]{8,200}$/.test(code) ? code : null,
    error: fragment.get("error"),
    present: raw.length > 1,
  };
}

/**
 * Admin sign-in. The only way in is the server's Google flow (`mode=admin`); this page never sees a password, never decides
 * who may be an admin, and treats the one-time code as nothing but a ticket to exchange once.
 */
export function AdminLoginPage() {
  const { state, client, signInWithCode, verify } = useAdminAuth();
  const [params] = useSearchParams();
  const [callback] = useState(readCallback);
  const [busy, setBusy] = useState(callback.code !== null);
  const [error, setError] = useState<string | null>(() => {
    if (callback.error) return FRAGMENT_ERRORS[callback.error] ?? FRAGMENT_ERROR_FALLBACK;
    if (callback.present && !callback.code) return "Mã đăng nhập không hợp lệ. Vui lòng đăng nhập lại bằng Google.";
    return null;
  });
  const [availability, setAvailability] = useState<{ status: "loading" } | { status: "ready"; value: SignInAvailability } | { status: "error"; message: string }>({ status: "loading" });
  const handled = useRef(false);
  const returnTo = safeAdminReturnTo(params.get("returnTo"));
  const reason = params.get("reason");

  // Take the fragment out of the address bar before anything else, then exchange the code exactly once.
  useEffect(() => {
    if (!callback.present || handled.current) return;
    handled.current = true;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!callback.code) return;
    signInWithCode(callback.code)
      .catch((e: unknown) => setError(isAdminApiError(e) ? e.message : "Không hoàn tất được đăng nhập. Vui lòng thử lại."))
      .finally(() => setBusy(false));
  }, [callback, signInWithCode]);

  const fetchAvailability = useCallback(() => {
    client
      .signInAvailability()
      .then((value) => setAvailability({ status: "ready", value }))
      .catch((e: unknown) => setAvailability({ status: "error", message: isAdminApiError(e) ? e.message : "Không kiểm tra được máy chủ." }));
  }, [client]);
  const retryAvailability = () => {
    setAvailability({ status: "loading" });
    fetchAvailability();
  };
  // Coming back from Google the page is busy exchanging a code; otherwise ask whether the server can sign anyone in.
  useEffect(() => {
    if (!callback.present) fetchAvailability();
  }, [callback.present, fetchAvailability]);

  if (state.status === "signed_in") return <Navigate to={returnTo ?? "/admin"} replace />;

  const noticeKey = state.status === "signed_out" ? state.reason : null;
  const notice = noticeKey ? SIGNED_OUT_NOTICE[noticeKey] : reason === "expired" ? SIGNED_OUT_NOTICE.expired : reason === "forbidden" ? SIGNED_OUT_NOTICE.forbidden : null;
  const verifying = state.status === "verifying";
  const unverified = state.status === "unverified";
  const canStart = availability.status === "ready" && availability.value.state === "available" && client.startUrl !== null;

  const start = () => {
    if (!client.startUrl) return;
    setError(null);
    setBusy(true);
    // A full-page navigation: the server redirects to Google and, afterwards, back here with the one-time code.
    startFullPageNavigation(client.startUrl);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-surface text-fg lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside
        data-tone="dark"
        className="flex items-center justify-between gap-4 border-b border-ivory/10 bg-[radial-gradient(90%_70%_at_30%_20%,var(--color-graphite)_0%,var(--color-midnight)_85%)] px-4 py-3 text-ivory md:px-6 lg:sticky lg:top-0 lg:h-dvh lg:flex-col lg:items-start lg:justify-between lg:border-r lg:border-b-0 lg:p-12"
      >
        <Link to="/" aria-label="CareLens AI, về trang chủ" className="inline-flex min-h-11 w-fit items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-4">
          <Wordmark large />
        </Link>
        <p className="hidden max-w-md font-display text-3xl leading-tight font-extrabold tracking-tight text-balance lg:block">Khu vực vận hành dành cho người quản trị hệ thống.</p>
        <Link to="/login" className={buttonClasses({ tone: "dark", variant: "secondary", size: "sm", className: "lg:self-start" })}>
          Đăng nhập xem dữ liệu
        </Link>
      </aside>

      <main className="flex min-w-0 flex-1 items-start justify-center px-4 py-8 sm:px-8 sm:py-12 md:items-center lg:px-12 lg:py-10">
        <div className="flex w-full max-w-[34rem] flex-col gap-6">
          <header className="flex flex-col gap-2">
            <p className="inline-flex items-center gap-2 font-mono text-xs font-medium tracking-[0.18em] uppercase">
              <ShieldCheck className="size-4 text-accent" aria-hidden />
              Quản trị
            </p>
            <h1 className="font-display text-3xl leading-tight font-extrabold tracking-tight text-balance">Đăng nhập quản trị</h1>
            <p className="md:text-lg">Chỉ tài khoản Google đã được chủ sở hữu cho phép mới vào được. Quyền do máy chủ quyết định.</p>
          </header>

          {notice ? (
            <p role="status" className="flex items-start gap-2 text-sm font-bold">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              {notice}
            </p>
          ) : null}

          <SoftSurface as="section" aria-label="Đăng nhập quản trị" padding="sm" className="flex flex-col gap-5 sm:p-7">
            {verifying || (busy && callback.code !== null) ? (
              <p role="status" className="flex items-center gap-3">
                <LoaderCircle className="size-5 animate-spin text-accent" aria-hidden />
                {verifying ? "Đang xác minh phiên quản trị với máy chủ…" : "Đang hoàn tất đăng nhập…"}
              </p>
            ) : null}

            {/* Nút Google theo hướng dẫn thương hiệu của Google, cùng ngoại lệ có chủ ý như trang đăng nhập người xem. */}
            <button
              type="button"
              onClick={start}
              disabled={!canStart || busy || verifying}
              aria-busy={busy || undefined}
              className={cn(
                "inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-[#747775] bg-white px-6 text-sm font-medium text-[#1F1F1F] transition-colors duration-300",
                "hover:bg-[#F8FAFF] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
              )}
              style={{ fontFamily: "Roboto, 'DM Sans', ui-sans-serif, system-ui, sans-serif" }}
            >
              {busy && callback.code === null ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <GoogleMark />}
              Đăng nhập quản trị bằng Google
            </button>

            {availability.status === "loading" && !callback.present ? (
              <p role="status" className="text-sm">
                Đang kiểm tra máy chủ…
              </p>
            ) : null}
            {availability.status === "ready" && availability.value.state === "unavailable" ? (
              <p role="alert" className="flex items-start gap-2 text-sm font-bold">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                {UNAVAILABLE_TEXT[availability.value.reason]}
              </p>
            ) : null}
            {availability.status === "error" ? (
              <div role="alert" className="flex flex-col gap-3 text-sm">
                <p className="flex items-start gap-2 font-bold">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  {availability.message}
                </p>
                <SoftButton size="sm" variant="secondary" onClick={retryAvailability} className="self-start">
                  Thử lại
                </SoftButton>
              </div>
            ) : null}

            {unverified ? (
              <div role="alert" className="flex flex-col gap-3 text-sm">
                <p className="flex items-start gap-2 font-bold">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  {state.error.message}
                </p>
                <SoftButton size="sm" variant="secondary" onClick={() => void verify().catch(() => undefined)} className="self-start">
                  Thử xác minh lại
                </SoftButton>
              </div>
            ) : null}

            {/* Lỗi sau khi quay về từ Google hoặc khi đổi mã. Mã chỉ dùng được một lần nên không có nút "thử lại cùng mã": đăng nhập lại là luồng mới. */}
            <div aria-live="polite" className="min-h-11">
              {error && !unverified ? (
                <p role="alert" className="flex items-start gap-2 text-sm font-bold">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  {error}
                </p>
              ) : null}
            </div>
          </SoftSurface>
        </div>
      </main>
    </div>
  );
}
