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
import { Leave } from "../pages/Leave";
import { About } from "../pages/About";
import { Privacy } from "../pages/Privacy";
import { Contact } from "../pages/Contact";
import { AttendanceRecords } from "../pages/AttendanceRecords";
import { Service } from "../pages/Service";

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: LoginPage,
  },
  { path: "/about", Component: About },
  { path: "/privacy", Component: Privacy },
  { path: "/contact", Component: Contact },
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
      { path: "lates", element: <ProtectedRoute allowedRoles={["Admin", "HR"]}><LateRecords /></ProtectedRoute> },
      { path: "attendance-records", element: <ProtectedRoute allowedRoles={["Admin", "HR"]}><AttendanceRecords /></ProtectedRoute> },
      { path: "exemptions", element: <ProtectedRoute allowedRoles={["Admin", "HR"]}><Exemptions /></ProtectedRoute> },
      { path: "absences", element: <ProtectedRoute allowedRoles={["HR"]}><Absences /></ProtectedRoute> },
      { path: "absence-records", element: <ProtectedRoute allowedRoles={["Admin"]}><Absences readOnly /></ProtectedRoute> },
      { path: "leave", element: <ProtectedRoute allowedRoles={["HR"]}><Leave /></ProtectedRoute> },
      { path: "undertime", element: <ProtectedRoute allowedRoles={["HR"]}><Undertime /></ProtectedRoute> },
      { path: "half-day", element: <ProtectedRoute allowedRoles={["HR"]}><HalfDay /></ProtectedRoute> },
      { path: "service", element: <ProtectedRoute allowedRoles={["Admin", "HR"]}><Service /></ProtectedRoute> },
      { path: "recycle-bin", element: <ProtectedRoute allowedRoles={["HR"]}><RecycleBin /></ProtectedRoute> },
      { path: "approvals", element: <ProtectedRoute allowedRoles={["Admin"]}><AdminApprovals /></ProtectedRoute> },
    ],
  },
]);
