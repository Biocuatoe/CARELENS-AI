import { createBrowserRouter, Navigate, useParams } from "react-router";
import { LoginPage } from "../features/auth/LoginPage";
import { LandingPage } from "../features/landing/LandingPage";
import { LiveDemoHome } from "../features/recipients/LiveDemoHome";
import { OverviewPage } from "../features/overview/OverviewPage";
import { CareLensPage } from "../features/carelens/CareLensPage";
import { EcoPatchPage } from "../features/ecopatch/EcoPatchPage";
import { AlertListPage } from "../features/alerts/AlertListPage";
import { AlertDetailPage } from "../features/alerts/AlertDetailPage";
import { DevicesPage } from "../features/devices/DevicesPage";
import { HistoryPage } from "../features/history/HistoryPage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { SharingPage } from "../features/sharing/SharingPage";
import { NotificationSettingsPage } from "../features/settings/NotificationSettingsPage";
import { RequireAdmin } from "./adminAuth";
import { NotFoundPage } from "./NotFoundPage";
import { GeneralLayout, RecipientLayout, RequireAuth, RequireProduct, RequireRecipientPermission } from "./layouts";

function RecipientIndex() {
  const { recipientId } = useParams();
  return <Navigate to={`/people/${recipientId}/overview`} replace />;
}

export const routes = [
  { path: "/", element: <LandingPage /> },
  { path: "/login", element: <LoginPage /> },
  // Trang nội bộ, không có liên kết điều hướng. Tải lười để three.js không vào bundle chính.
  {
    path: "/hardware-inspector",
    lazy: async () => ({ Component: (await import("../features/hardware/HardwareInspectorPage")).HardwareInspectorPage }),
  },
  {
    path: "/hardware-story",
    lazy: async () => ({ Component: (await import("../features/hardware/HardwareStoryPage")).HardwareStoryPage }),
  },
  // Khu quản trị: trạng thái phiên riêng (app/adminAuth.tsx), tách khỏi RequireAuth của người xem. Tải lười để không vào bundle chính.
  { path: "/admin/login", lazy: async () => ({ Component: (await import("../features/admin/AdminLoginPage")).AdminLoginPage }) },
  {
    element: <RequireAdmin />,
    children: [
      {
        lazy: async () => ({ Component: (await import("../features/admin/AdminLayout")).AdminLayout }),
        children: [
          { path: "/admin", lazy: async () => ({ Component: (await import("../features/admin/AdminOverviewPage")).AdminOverviewPage }) },
          { path: "/admin/devices", lazy: async () => ({ Component: (await import("../features/admin/AdminDevicesPage")).AdminDevicesPage }) },
          { path: "/admin/devices/:deviceId", lazy: async () => ({ Component: (await import("../features/admin/AdminDevicesPage")).AdminDevicesPage }) },
          { path: "/admin/reports", lazy: async () => ({ Component: (await import("../features/admin/AdminReportPage")).AdminReportPage }) },
          { path: "/admin/messages", lazy: async () => ({ Component: (await import("../features/admin/AdminMessagesPage")).AdminMessagesPage }) },
          { path: "/admin/reminders", lazy: async () => ({ Component: (await import("../features/admin/AdminRemindersPage")).AdminRemindersPage }) },
          { path: "/admin/agents", lazy: async () => ({ Component: (await import("../features/admin/AdminAgentsPage")).AdminAgentsPage }) },
          { path: "/admin/audit", lazy: async () => ({ Component: (await import("../features/admin/AdminAuditPage")).AdminAuditPage }) },
          { path: "/admin/*", element: <NotFoundPage inline /> },
        ],
      },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <GeneralLayout />,
        children: [
          { path: "/people", element: <LiveDemoHome /> },
          { path: "/settings/notifications", element: <NotificationSettingsPage /> },
        ],
      },
      {
        path: "/people/:recipientId",
        element: <RecipientLayout />,
        children: [
          { index: true, element: <RecipientIndex /> },
          { path: "overview", element: <OverviewPage /> },
          {
            path: "carelens",
            element: (
              <RequireProduct product="carelens">
                <CareLensPage />
              </RequireProduct>
            ),
          },
          {
            path: "ecopatch",
            element: (
              <RequireProduct product="ecopatch">
                <EcoPatchPage />
              </RequireProduct>
            ),
          },
          {
            path: "alerts",
            element: (
              <RequireRecipientPermission permission="data.read">
                <AlertListPage />
              </RequireRecipientPermission>
            ),
          },
          {
            path: "alerts/:alertId",
            element: (
              <RequireRecipientPermission permission="data.read">
                <AlertDetailPage />
              </RequireRecipientPermission>
            ),
          },
          { path: "devices", element: <DevicesPage /> },
          {
            path: "history",
            element: (
              <RequireRecipientPermission permission="data.read">
                <HistoryPage />
              </RequireRecipientPermission>
            ),
          },
          {
            path: "reports",
            element: (
              <RequireRecipientPermission permission="data.read">
                <ReportsPage />
              </RequireRecipientPermission>
            ),
          },
          { path: "sharing", element: <SharingPage /> },
          { path: "*", element: <NotFoundPage inline /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
];

export const createAppRouter = () => createBrowserRouter(routes);
