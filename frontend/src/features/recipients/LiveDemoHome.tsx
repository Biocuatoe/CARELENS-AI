import { Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { UsersRound } from "lucide-react";
import { useAdapter } from "../../data";
import { errorMessage } from "../../data/errors";
import { qk } from "../../data/queryKeys";
import { EmptyState, InlineError, LoadingState } from "../../design-system/feedback";
import { SoftSurface } from "../../design-system/primitives";

/**
 * Điểm vào sau đăng nhập. Tài khoản Live Demo dùng chung chỉ có một hồ sơ, nên không có trang chọn hồ sơ:
 * chuyển thẳng tới tổng quan của hồ sơ đầu tiên máy chủ cấp quyền xem. Không có quyền nào thì nói rõ, không dựng dữ liệu thay thế.
 */
export function LiveDemoHome() {
  const adapter = useAdapter();
  const recipients = useQuery({ queryKey: qk.recipients(), queryFn: () => adapter.listRecipients() });

  if (recipients.isPending) return <LoadingState label="Đang mở bảng theo dõi…" />;
  if (recipients.isError) return <InlineError onRetry={() => void recipients.refetch()}>{errorMessage(recipients.error)}</InlineError>;

  const first = recipients.data[0];
  if (first) return <Navigate to={`/people/${first.id}/overview`} replace />;

  return (
    <SoftSurface>
      <EmptyState icon={<UsersRound />} title="Tài khoản chưa được cấp hồ sơ nào">
        <p>Tài khoản đã đăng nhập nhưng chưa được cấp quyền xem hồ sơ chăm sóc nào. Liên hệ quản trị viên đã cấp tài khoản.</p>
      </EmptyState>
    </SoftSurface>
  );
}
