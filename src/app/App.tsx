import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AttendanceProvider } from "../context/AttendanceContext";
import { AuthProvider } from "../context/AuthContext";
import { EmployeesProvider } from "../context/EmployeesContext";
import { ToastProvider } from "../components/ui";

export default function App() {
  return (
    <AuthProvider>
      <EmployeesProvider>
        <AttendanceProvider>
          <RouterProvider router={router} />
          <ToastProvider />
        </AttendanceProvider>
      </EmployeesProvider>
    </AuthProvider>
  );
}
