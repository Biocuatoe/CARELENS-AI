import { createBrowserRouter, Navigate, useParams } from "react-router";
import { LoginPage } from "../features/auth/LoginPage";
import { LandingPage } from "../features/landing/LandingPage";
import { OnboardingPage } from "../features/onboarding/OnboardingPage";
import { PeoplePage } from "../features/recipients/PeoplePage";
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
import { AdminPage } from "../features/admin/AdminPage";
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
  {
    element: <RequireAuth />,
    children: [
      { path: "/onboarding", element: <OnboardingPage /> },
      {
        element: <GeneralLayout />,
        children: [
          { path: "/people", element: <PeoplePage /> },
          { path: "/settings/notifications", element: <NotificationSettingsPage /> },
          { path: "/admin", element: <AdminPage /> },
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
