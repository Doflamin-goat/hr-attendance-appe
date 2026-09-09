import { createBrowserRouter } from "react-router";
import { RootLayout } from "../components/layout/RootLayout";
import { ProtectedRoute } from "../components/layout/ProtectedRoute";
import { Dashboard } from "../pages/Dashboard";
import { LateRecords } from "../pages/LateRecords";
import { Exemptions } from "../pages/Exemptions";
import { Absences } from "../pages/Absences";
import { Undertime } from "../pages/Undertime";
import { RecycleBin } from "../pages/RecycleBin";
import { HalfDay } from "../pages/HalfDay";
import { AdminApprovals } from "../pages/AdminApprovals";
import EmployeesPage from "../pages/EmployeesPage";
import LoginPage from "../pages/LoginPage";

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: LoginPage,
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <RootLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, Component: Dashboard },
      { path: "employees", element: <ProtectedRoute allowedRoles={["Admin", "HR"]}><EmployeesPage /></ProtectedRoute> },
      { path: "lates", element: <ProtectedRoute allowedRoles={["HR"]}><LateRecords /></ProtectedRoute> },
      { path: "exemptions", element: <ProtectedRoute allowedRoles={["HR"]}><Exemptions /></ProtectedRoute> },
      { path: "absences", element: <ProtectedRoute allowedRoles={["HR"]}><Absences /></ProtectedRoute> },
      { path: "undertime", element: <ProtectedRoute allowedRoles={["HR"]}><Undertime /></ProtectedRoute> },
      { path: "half-day", element: <ProtectedRoute allowedRoles={["HR"]}><HalfDay /></ProtectedRoute> },
      { path: "recycle-bin", element: <ProtectedRoute allowedRoles={["HR"]}><RecycleBin /></ProtectedRoute> },
      { path: "approvals", element: <ProtectedRoute allowedRoles={["Admin"]}><AdminApprovals /></ProtectedRoute> },
    ],
  },
]);
