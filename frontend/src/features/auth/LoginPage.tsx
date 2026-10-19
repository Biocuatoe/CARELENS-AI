import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, LoaderCircle, TriangleAlert } from "lucide-react";
import { useAdapter } from "../../data";
import { errorMessage } from "../../data/errors";
import { Wordmark } from "../../design-system/Brand";
import { InsetField, SoftButton, SoftSurface, buttonClasses } from "../../design-system/primitives";
import { cn } from "../../design-system/cn";
import { useAuth } from "../../app/auth";

const schema = z.object({
  // Tên đăng nhập thuần (ví dụ DAYONE) hoặc email đều hợp lệ: máy chủ quyết định tài khoản có tồn tại hay không.
  username: z.string().trim().min(1, "Nhập tài khoản."),
  password: z.string().min(1, "Nhập mật khẩu."),
});
type FormValues = z.infer<typeof schema>;

/** Chỉ cho phép quay về đường dẫn nội bộ để tránh open redirect. */
export function safeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (value.startsWith("/login")) return null;
  return value;
}

/** Sau đăng nhập vào thẳng Live Demo: `/people` chuyển tới hồ sơ duy nhất mà máy chủ cấp quyền xem. */
const HOME = "/people";

/** Lý do máy chủ gắn vào phần fragment khi đưa người dùng từ Google về trang này (không có chi tiết nhạy cảm). */
const GOOGLE_ERRORS: Record<string, string> = {
  google_denied: "Bạn đã hủy đăng nhập bằng Google.",
  google_state: "Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.",
  google_unauthorized: "Tài khoản Google này chưa được cấp quyền vào Demo trực tiếp.",
  google_exchange: "Không hoàn tất được đăng nhập Google. Vui lòng thử lại sau.",
  google_token: "Không hoàn tất được đăng nhập Google. Vui lòng thử lại sau.",
  google_unavailable: "Không hoàn tất được đăng nhập Google. Vui lòng thử lại sau.",
};
export const googleErrorMessage = (reason: string): string => GOOGLE_ERRORS[reason] ?? "Không hoàn tất được đăng nhập Google. Vui lòng thử lại sau.";

function readGoogleFragment(): { code: string | null; reason: string | null } {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  return { code: fragment.get("code"), reason: fragment.get("error") };
}

/** Biểu tượng "G" nhiều màu theo hướng dẫn thương hiệu của Google; không đổi màu hay hình dạng. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-5 shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Phương thức đăng nhập máy chủ cho phép. `error`: không hỏi được máy chủ; khi đó vẫn hiện biểu mẫu (máy chủ vẫn là bên quyết định). */
type SignInOptions = { status: "loading" } | { status: "ready"; googleEnabled: boolean; passwordSignIn: boolean } | { status: "error" };

/**
 * Đăng nhập Live Demo. Google là lối chính; biểu mẫu mật khẩu chỉ hiện khi máy chủ còn nhận mật khẩu (bản deploy chỉ nhận Google).
 * Bố cục theo landing: khu thương hiệu midnight cạnh khu biểu mẫu ivory/paper; cả nhóm bên phải được căn giữa ngang và dọc.
 * Lỗi hiện trong một vùng cố định dưới các nút để bố cục không nhảy.
 */
export function LoginPage() {
  const { state, login, completeGoogleSignIn } = useAuth();
  const adapter = useAdapter();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  // Máy chủ đưa người dùng từ Google về `/login#code=…` (mã đổi phiên dùng một lần) hoặc `/login#error=…`.
  const [fromGoogle] = useState(readGoogleFragment);
  const [formError, setFormError] = useState<string | null>(() => (fromGoogle.reason ? googleErrorMessage(fromGoogle.reason) : null));
  const [googleBusy, setGoogleBusy] = useState(fromGoogle.code !== null);
  const [options, setOptions] = useState<SignInOptions>({ status: "loading" });
  const fragmentHandled = useRef(false);
  const returnTo = safeReturnTo(params.get("returnTo"));
  const expired = params.get("reason") === "expired";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
    // Chỉ báo thiếu trường sau khi người dùng bấm Đăng nhập, không báo khi biểu mẫu vừa hiện hay vừa rời ô trống.
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  // Fragment bị xóa khỏi thanh địa chỉ ngay khi đọc để mã không nằm lại trong lịch sử trình duyệt; mã chỉ được đổi một lần.
  useEffect(() => {
    if (!fromGoogle.code && !fromGoogle.reason) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!fromGoogle.code || fragmentHandled.current) return;
    fragmentHandled.current = true;
    completeGoogleSignIn(fromGoogle.code)
      .then(() => navigate(HOME, { replace: true }))
      .catch((error: unknown) => setFormError(errorMessage(error)))
      .finally(() => setGoogleBusy(false));
  }, [fromGoogle, completeGoogleSignIn, navigate]);

  useEffect(() => {
    let active = true;
    adapter
      .getGoogleSignIn()
      .then((g) => active && setOptions({ status: "ready", googleEnabled: g.enabled, passwordSignIn: g.passwordSignIn }))
      .catch(() => active && setOptions({ status: "error" }));
    return () => {
      active = false;
    };
  }, [adapter]);

  if (state.status === "signed_in") return <Navigate to={returnTo ?? HOME} replace />;

  const busy = isSubmitting || googleBusy;
  const showPasswordForm = options.status === "error" || (options.status === "ready" && options.passwordSignIn);
  const googleOnly = options.status === "ready" && !options.passwordSignIn;
  const nothingEnabled = googleOnly && !options.googleEnabled;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.username, values.password);
      navigate(returnTo ?? HOME, { replace: true });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  const onGoogle = async () => {
    setFormError(null);
    setGoogleBusy(true);
    try {
      const google = await adapter.getGoogleSignIn();
      if (!google.enabled) {
        setFormError("Đăng nhập bằng Google chưa được cấu hình trên máy chủ này.");
        setGoogleBusy(false);
        return;
      }
      // Rời trang: máy chủ chuyển tiếp tới Google, rồi đưa người dùng về lại đây cùng mã đổi phiên.
      window.location.assign(google.startUrl);
    } catch (error) {
      setFormError(errorMessage(error));
      setGoogleBusy(false);
    }
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
        <p className="hidden max-w-md font-display text-3xl leading-tight font-extrabold tracking-tight text-balance lg:block">Một nơi chung để người chăm sóc cùng theo dõi và phối hợp.</p>
        <Link to="/" className={buttonClasses({ tone: "dark", variant: "secondary", size: "sm", className: "lg:self-start" })}>
          Về trang chủ
        </Link>
      </aside>

      {/* Cả nhóm (tiêu đề, mô tả, thẻ đăng nhập) trong một khối có bề rộng tối đa, căn giữa ngang và dọc trong khu bên phải. */}
      <main className="flex min-w-0 flex-1 items-start justify-center px-4 py-8 sm:px-8 sm:py-12 md:items-center lg:px-12 lg:py-10">
        <div className="flex w-full max-w-[34rem] flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="font-display text-3xl leading-tight font-extrabold tracking-tight text-balance">Đăng nhập</h1>
            <p className="md:text-lg">
              {googleOnly ? "Dùng tài khoản Google để vào Demo trực tiếp ở chế độ chỉ xem." : "Vào Demo trực tiếp bằng tài khoản Google hoặc tài khoản do ban tổ chức cấp."}
            </p>
          </header>

          {expired ? (
            <p role="alert" className="flex items-start gap-2 text-sm font-bold">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.
            </p>
          ) : null}

          <SoftSurface as="section" aria-label="Đăng nhập" padding="sm" className="flex flex-col gap-5 sm:p-7">
            {/* Nút Google theo hướng dẫn thương hiệu của Google (nền trắng, viền #747775, chữ #1F1F1F, biểu tượng G nhiều màu).
                Đây là ngoại lệ có chủ ý của quy tắc "không bg-white": màu do Google quy định, không phải màu của hệ thiết kế. */}
            <button
              type="button"
              onClick={onGoogle}
              disabled={busy}
              aria-busy={googleBusy || undefined}
              className={cn(
                "inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-[#747775] bg-white px-6 text-sm font-medium text-[#1F1F1F] transition-colors duration-300",
                "hover:bg-[#F8FAFF] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
              )}
              style={{ fontFamily: "Roboto, 'DM Sans', ui-sans-serif, system-ui, sans-serif" }}
            >
              {googleBusy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <GoogleMark />}
              Đăng nhập bằng Google
            </button>

            {showPasswordForm ? (
              <>
                <div className="flex items-center gap-3 text-sm" aria-hidden>
                  <span className="h-px flex-1 bg-ink/20" />
                  hoặc
                  <span className="h-px flex-1 bg-ink/20" />
                </div>
                <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
                  <InsetField label="Tài khoản" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required error={errors.username?.message} {...register("username")} />
                  <InsetField
                    label="Mật khẩu"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    error={errors.password?.message}
                    trailing={
                      <button
                        type="button"
                        className="inline-flex size-11 items-center justify-center rounded-full text-fg transition-colors duration-300 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2"
                        aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
                      </button>
                    }
                    {...register("password")}
                  />
                  <SoftButton type="submit" variant="primary" loading={isSubmitting} disabled={busy} className="w-full">
                    {isSubmitting ? "Đang đăng nhập…" : "Đăng nhập"}
                  </SoftButton>
                </form>
              </>
            ) : null}

            {/* Vùng thông báo cố định (hai dòng): lỗi xuất hiện không làm bố cục dịch chuyển. */}
            <div aria-live="polite" className="min-h-11">
              {formError ? (
                <p role="alert" className="flex items-start gap-2 text-sm font-bold">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  {formError}
                </p>
              ) : nothingEnabled ? (
                <p className="flex items-start gap-2 text-sm font-bold">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  Máy chủ chưa bật phương thức đăng nhập nào: đăng nhập bằng Google đang chờ người vận hành cấu hình.
                </p>
              ) : null}
            </div>
          </SoftSurface>
        </div>
      </main>
    </div>
  );
}
