import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { Cpu } from "lucide-react";
import type { AdminDevice } from "../../data/admin/adminClient";
import { EmptyState, InlineError, LoadingState } from "../../design-system/feedback";
import { InsetSelect } from "../../design-system/primitives";
import { ROW_STATUS_LABELS } from "./labels";
import { useAdminLoad } from "./useAdminLoad";

/**
 * Shared frame of the pages that act on one registered device (report, messages, reminders). The device list is the server's
 * registry, not a constant: with nothing registered the page says so and offers nothing to act on. The choice lives in the
 * `?device=` query so a link, a reload of the SPA route, or the back button keeps the same device.
 */
export function DeviceScope({ title, intro, children }: { title: string; intro?: ReactNode; children: (device: AdminDevice) => ReactNode }) {
  const { state, reload } = useAdminLoad((client, token) => client.devices(token), "devices");
  const [params, setParams] = useSearchParams();
  const wanted = params.get("device");

  const header = (picker: ReactNode) => (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl leading-tight font-extrabold tracking-tight">{title}</h1>
      {intro ? <p className="max-w-3xl">{intro}</p> : null}
      {picker}
    </div>
  );

  if (state.status === "loading") return header(<LoadingState label="Đang tải danh sách thiết bị…" />);
  if (state.status === "error") {
    return header(
      <InlineError title="Không tải được danh sách thiết bị" onRetry={reload}>
        {state.message}
      </InlineError>,
    );
  }
  const devices = state.data.items;
  if (devices.length === 0) {
    return header(
      <EmptyState icon={<Cpu />} title="Chưa có thiết bị nào được đăng ký">
        <p>Máy chủ báo sổ thiết bị trống nên không có thiết bị để chọn. Đăng ký thiết bị chưa có trong giao diện này.</p>
      </EmptyState>,
    );
  }
  const selected = devices.find((d) => d.deviceId === wanted) ?? devices.find((d) => d.status === "active") ?? devices[0]!;
  return (
    <div className="flex flex-col gap-6">
      {header(
        <div className="flex flex-wrap items-end gap-4">
          <InsetSelect
            label="Thiết bị"
            wrapperClassName="min-w-64"
            value={selected.deviceId}
            onChange={(e) => setParams({ device: e.target.value }, { replace: true })}
            hint="Mã thiết bị là định danh thật do máy chủ cấp; nhãn chỉ để dễ nhìn."
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label === d.deviceId ? d.deviceId : `${d.label} (${d.deviceId})`}
                {d.status === "active" ? "" : ` · ${ROW_STATUS_LABELS[d.status] ?? d.status}`}
              </option>
            ))}
          </InsetSelect>
          <Link to={`/admin/devices/${encodeURIComponent(selected.deviceId)}`} className="min-h-11 py-2 font-bold underline">
            Xem chi tiết thiết bị
          </Link>
        </div>,
      )}
      {/* A different device starts every page-level state (selected recording, form, dialog) from scratch. */}
      <div key={selected.deviceId} className="flex flex-col gap-6">
        {children(selected)}
      </div>
    </div>
  );
}
