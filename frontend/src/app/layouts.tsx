import { useCallback, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useAdapter } from "../data";
import type { Product } from "../data/contracts";
import { errorMessage, isAccessError } from "../data/errors";
import { qk } from "../data/queryKeys";
import { useRecipientStream, type StreamStatus } from "../data/stream";
import { EmptyState, ForbiddenState, InlineError, LoadingState } from "../design-system/feedback";
import { buttonClasses } from "../design-system/primitives";
import { Link } from "react-router";
import { Lock } from "lucide-react";
import { RecipientProvider, useRecipient } from "../features/common/recipient";
import { PRODUCT_LABELS } from "../features/common/labels";
import { AppShell } from "./AppShell";
import { useAuth } from "./auth";

export function FullPageLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface">
      <LoadingState label="Đang kiểm tra phiên đăng nhập…" />
    </div>
  );
}

export function RequireAuth({ children }: { children?: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === "loading") return <FullPageLoading />;
  if (state.status === "signed_out") {
    // Sau khi chủ động đăng xuất không giữ đường dẫn cũ, để người đăng nhập tiếp theo không bị đưa vào trang của người trước.
    if (state.reason === "logout") return <Navigate to="/login" replace />;
    const params = new URLSearchParams({ returnTo: `${location.pathname}${location.search}` });
    if (state.reason === "expired") params.set("reason", "expired");
    return <Navigate to={`/login?${params.toString()}`} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

export function GeneralLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export function RecipientLayout() {
  const { recipientId = "" } = useParams();
  const adapter = useAdapter();
  const { markExpired } = useAuth();
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("open");
  const context = useQuery({
    queryKey: qk.context(recipientId),
    queryFn: () => adapter.getRecipientContext(recipientId),
  });

  const onStatus = useCallback(
    (status: StreamStatus) => {
      setStreamStatus(status);
      if (status === "closed_session") markExpired();
    },
    [markExpired],
  );

  if (context.isPending) {
    return (
      <AppShell>
        <LoadingState label="Đang tải hồ sơ…" />
      </AppShell>
    );
  }
  if (context.isError) {
    return (
      <AppShell>
        {isAccessError(context.error) ? (
          <ForbiddenState>
            <p>{errorMessage(context.error)}</p>
            <Link to="/people" className={buttonClasses({ className: "mt-4" })}>
              Về danh sách hồ sơ
            </Link>
          </ForbiddenState>
        ) : (
          <InlineError onRetry={() => void context.refetch()}>{errorMessage(context.error)}</InlineError>
        )}
      </AppShell>
    );
  }

  return (
    <RecipientProvider value={context.data}>
      <RecipientStream recipientId={recipientId} onStatus={onStatus} />
      <AppShell recipientContext={context.data} streamStatus={streamStatus}>
        {/* key theo hồ sơ: đổi hồ sơ sẽ unmount toàn bộ state, dialog và form của hồ sơ trước */}
        <div key={recipientId}>
          <Outlet />
        </div>
      </AppShell>
    </RecipientProvider>
  );
}

function RecipientStream({ recipientId, onStatus }: { recipientId: string; onStatus: (s: StreamStatus) => void }) {
  useRecipientStream(recipientId, onStatus);
  return null;
}

/** Route theo sản phẩm: chỉ hiển thị khi hồ sơ đã bật sản phẩm. API vẫn tự kiểm tra (AC01). */
export function RequireProduct({ product, children }: { product: Product; children: ReactNode }) {
  const { enrolled, can, recipientId } = useRecipient();
  if (!enrolled(product)) {
    return (
      <EmptyState icon={<Lock />} title={`Hồ sơ chưa kích hoạt ${PRODUCT_LABELS[product]}`}>
        <p>Trang này chỉ khả dụng khi hồ sơ sử dụng {PRODUCT_LABELS[product]}.</p>
        <Link to={`/people/${recipientId}/overview`} className={buttonClasses({ className: "mt-4" })}>
          Về tổng quan
        </Link>
      </EmptyState>
    );
  }
  if (!can("data.read")) return <ForbiddenState>Bạn không có quyền xem dữ liệu của hồ sơ này.</ForbiddenState>;
  return <>{children}</>;
}

export function RequireRecipientPermission({ permission, children }: { permission: Parameters<ReturnType<typeof useRecipient>["can"]>[0]; children: ReactNode }) {
  const { can, recipientId } = useRecipient();
  if (!can(permission)) {
    return (
      <ForbiddenState>
        <p>Bạn không có quyền xem mục này của hồ sơ.</p>
        <Link to={`/people/${recipientId}/devices`} className={buttonClasses({ className: "mt-4" })}>
          Xem thiết bị
        </Link>
      </ForbiddenState>
    );
  }
  return <>{children}</>;
}
