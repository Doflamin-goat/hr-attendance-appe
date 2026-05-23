import { createBrowserRouter } from "react-router";
import { RootLayout } from "../components/layout/RootLayout";
import { ProtectedRoute } from "../components/layout/ProtectedRoute";
import { Dashboard } from "../pages/Dashboard";
import { LateRecords } from "../pages/LateRecords";
import { Exemptions } from "../pages/Exemptions";
import { Absences } from "../pages/Absences";
import { Undertime } from "../pages/Undertime";
import { RecycleBin } from "../pages/RecycleBin";
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
      { path: "employees", Component: EmployeesPage },
      { path: "lates", Component: LateRecords },
      { path: "exemptions", Component: Exemptions },
      { path: "absences", Component: Absences },
      { path: "undertime", Component: Undertime },
      { path: "recycle-bin", Component: RecycleBin },
    ],
  },
]);