import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ChevronRight, Eye, EyeOff, FlaskConical, KeyRound, UserRound } from "lucide-react";
import { useAdapter, useDemoControls } from "../../data";
import { errorMessage } from "../../data/errors";
import { DemoBadge, InlineError, Notice } from "../../design-system/feedback";
import { BrandIdentity } from "../../design-system/BrandIdentity";
import { IconWell, InsetField, SoftButton, SoftSurface } from "../../design-system/primitives";
import { useAuth } from "../../app/auth";

const schema = z.object({
  email: z.string().trim().min(1, "Nhập email.").email("Nhập địa chỉ email hợp lệ."),
  password: z.string().min(1, "Nhập mật khẩu."),
});
type FormValues = z.infer<typeof schema>;

/** Chỉ cho phép quay về đường dẫn nội bộ để tránh open redirect. */
export function safeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (value.startsWith("/login")) return null;
  return value;
}

export function LoginPage() {
  const { state, login, enterDemo } = useAuth();
  const adapter = useAdapter();
  const demo = useDemoControls();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const returnTo = safeReturnTo(params.get("returnTo"));
  const expired = params.get("reason") === "expired";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  if (state.status === "signed_in") {
    return <Navigate to={returnTo ?? (state.session.user.isPlatformAdmin ? "/admin" : "/people")} replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const session = await login(values.email, values.password);
      navigate(returnTo ?? (session.user.isPlatformAdmin ? "/admin" : "/people"), { replace: true });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  const onDemo = async (personaId: string) => {
    setEnteringId(personaId);
    setFormError(null);
    try {
      const session = await enterDemo(personaId);
      const fallback = session.user.isPlatformAdmin ? "/admin" : "/people";
      navigate(returnTo && !session.user.isPlatformAdmin ? returnTo : fallback, { replace: true });
    } catch (error) {
      setFormError(errorMessage(error));
      setEnteringId(null);
    }
  };

  return (
    <main className="min-h-dvh bg-surface px-4 py-10 text-fg md:py-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <Link
            to="/"
            className="self-start rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <BrandIdentity />
          </Link>
          <h1 className="text-3xl font-extrabold md:text-4xl">Đăng nhập để theo dõi người thân</h1>
          <p className="max-w-2xl">Nền tảng chung giúp người chăm sóc xem thông tin, quản lý thiết bị và phối hợp xử lý cảnh báo.</p>
        </header>

        {expired ? (
          <Notice role="alert" title="Phiên đăng nhập đã hết hạn">
            Vui lòng đăng nhập lại. Sau khi vào lại, bạn sẽ quay về trang đang xem.
          </Notice>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-2">
          <SoftSurface as="section" aria-labelledby="login-title" className="flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <IconWell>
                <KeyRound />
              </IconWell>
              <h2 id="login-title" className="text-xl font-bold">
                Tài khoản
              </h2>
            </div>

            {adapter.mode === "demo" ? (
              <Notice title="Chưa kết nối máy chủ xác thực">
                Bản demo chưa có máy chủ xác thực nên biểu mẫu này sẽ báo không khả dụng. Dùng “Vào bản demo” để xem thử với người dùng mô phỏng.
              </Notice>
            ) : null}

            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
              <InsetField label="Email" type="email" autoComplete="username" required error={errors.email?.message} {...register("email")} />
              <InsetField
                label="Mật khẩu"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                error={errors.password?.message}
                trailing={
                  <SoftButton
                    size="icon"
                    className="size-11"
                    aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
                  </SoftButton>
                }
                {...register("password")}
              />
              {formError ? <InlineError title="Không đăng nhập được">{formError}</InlineError> : null}
              <SoftButton type="submit" variant="primary" loading={isSubmitting}>
                {isSubmitting ? "Đang đăng nhập…" : "Đăng nhập"}
              </SoftButton>

              {/* Vào demo trực tiếp — bỏ qua biểu mẫu, vào app ở trạng thái trống. */}
              {demo ? (
                <>
                  <hr className="border-fg/10" />
                </>
              ) : null}
            </form>
            <p className="text-sm">Khôi phục mật khẩu và tạo tài khoản sẽ có khi kết nối máy chủ xác thực.</p>
          </SoftSurface>

          {demo ? (
            <SoftSurface as="section" aria-labelledby="demo-title" className="flex flex-col gap-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <IconWell>
                    <FlaskConical />
                  </IconWell>
                  <h2 id="demo-title" className="text-xl font-bold">
                    Vào bản demo
                  </h2>
                </div>
                <DemoBadge />
              </div>
              <p>
                Chọn một người dùng mô phỏng.
              </p>
              <ul className="flex flex-col gap-4">
                {demo.listPersonas().map((persona) => (
                  <li key={persona.id}>
                    <button
                      type="button"
                      onClick={() => onDemo(persona.id)}
                      disabled={enteringId !== null}
                      aria-busy={enteringId === persona.id || undefined}
                      className="group flex w-full items-center gap-4 rounded-control bg-surface p-4 text-left shadow-extruded-sm transition-[transform,box-shadow] duration-300 ease-out enabled:hover:-translate-y-px enabled:hover:shadow-extruded enabled:active:translate-y-[0.5px] enabled:active:shadow-inset-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
                    >
                      <IconWell size="sm" depth="inset">
                        <UserRound />
                      </IconWell>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-bold">
                          {persona.id === "u_liveshowcase" ? persona.displayName : `Vào bản demo với ${persona.displayName}`}
                        </span>
                        <span className="text-sm">{persona.description}</span>
                      </span>
                      <ChevronRight className="size-5 shrink-0 text-accent" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </SoftSurface>
          ) : null}
        </div>
      </div>
    </main>
  );
}
