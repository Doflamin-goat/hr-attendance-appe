import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AttendanceProvider } from "../context/AttendanceContext";
import { AuthProvider } from "../context/AuthContext";
import { EmployeesProvider } from "../context/EmployeesContext";
import { ThemeProvider } from "../context/ThemeContext";
import { ToastProvider } from "../components/ui";

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <EmployeesProvider>
          <AttendanceProvider>
            <RouterProvider router={router} />
            <ToastProvider />
          </AttendanceProvider>
        </EmployeesProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
