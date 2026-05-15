import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import {
  addEmployee as addEmployeeService,
  deactivateEmployee as deactivateEmployeeService,
  listEmployees,
  normalizeEmployeeName,
  restoreEmployee as restoreEmployeeService,
  updateEmployee as updateEmployeeService,
  type Employee,
  type EmployeeInput,
  type Workspace,
} from "../services/employeeService";

interface EmployeesState {
  employees: Employee[];
  activeEmployees: Employee[];
  inactiveEmployees: Employee[];
  activeEmployeeCount: number;
  inactiveEmployeeCount: number;
  appActiveCount: number;
  waisActiveCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addEmployee: (input: EmployeeInput) => Promise<Employee>;
  updateEmployee: (id: string, input: EmployeeInput) => Promise<Employee>;
  deactivateEmployee: (id: string) => Promise<Employee>;
  restoreEmployee: (id: string) => Promise<Employee>;
  findActiveByName: (name: string) => Employee | undefined;
}

const EmployeesContext = createContext<EmployeesState | undefined>(undefined);

export function EmployeesProvider({ children }: { children: ReactNode }) {
  const { user, email, loading: authLoading } = useAuth();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const actor = useMemo(
    () => ({ userId: user?.id ?? null, email: email ?? user?.email ?? null }),
    [user, email]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await listEmployees();
      setEmployees(data);
    } catch (err) {
      console.error("Failed to load employees:", err);
      setError(err instanceof Error ? err.message : "Failed to load employees");
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setEmployees([]);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authLoading, user, refresh]);

  const addEmployee = useCallback(
    async (input: EmployeeInput) => {
      const created = await addEmployeeService(input, actor);
      setEmployees((prev) =>
        [...prev, created].sort((a, b) => a.fullName.localeCompare(b.fullName))
      );
      return created;
    },
    [actor]
  );

  const updateEmployee = useCallback(
    async (id: string, input: EmployeeInput) => {
      const updated = await updateEmployeeService(id, input, actor);
      setEmployees((prev) =>
        prev
          .map((emp) => (emp.id === id ? updated : emp))
          .sort((a, b) => a.fullName.localeCompare(b.fullName))
      );
      return updated;
    },
    [actor]
  );

  const deactivateEmployee = useCallback(
    async (id: string) => {
      const updated = await deactivateEmployeeService(id, actor);
      setEmployees((prev) =>
        prev.map((emp) => (emp.id === id ? updated : emp))
      );
      return updated;
    },
    [actor]
  );

  const restoreEmployee = useCallback(
    async (id: string) => {
      const updated = await restoreEmployeeService(id, actor);
      setEmployees((prev) =>
        prev.map((emp) => (emp.id === id ? updated : emp))
      );
      return updated;
    },
    [actor]
  );

  const {
    activeEmployees,
    inactiveEmployees,
    appActiveCount,
    waisActiveCount,
  } = useMemo(() => {
    const active: Employee[] = [];
    const inactive: Employee[] = [];
    let app = 0;
    let wais = 0;

    employees.forEach((emp) => {
      const isInactive = emp.isDeleted || emp.employmentStatus === "inactive";

      if (isInactive) {
        inactive.push(emp);
        return;
      }

      active.push(emp);

      if (emp.workspace === "APP") app += 1;
      else if (emp.workspace === "WAIS") wais += 1;
    });

    return {
      activeEmployees: active,
      inactiveEmployees: inactive,
      appActiveCount: app,
      waisActiveCount: wais,
    };
  }, [employees]);

  const findActiveByName = useCallback(
    (name: string) => {
      const key = normalizeEmployeeName(name);
      if (!key) return undefined;
      return activeEmployees.find(
        (emp) => normalizeEmployeeName(emp.fullName) === key
      );
    },
    [activeEmployees]
  );

  const value: EmployeesState = {
    employees,
    activeEmployees,
    inactiveEmployees,
    activeEmployeeCount: activeEmployees.length,
    inactiveEmployeeCount: inactiveEmployees.length,
    appActiveCount,
    waisActiveCount,
    loading,
    error,
    refresh,
    addEmployee,
    updateEmployee,
    deactivateEmployee,
    restoreEmployee,
    findActiveByName,
  };

  return (
    <EmployeesContext.Provider value={value}>
      {children}
    </EmployeesContext.Provider>
  );
}

export function useEmployees() {
  const ctx = useContext(EmployeesContext);
  if (!ctx) {
    throw new Error("useEmployees must be used within an EmployeesProvider");
  }
  return ctx;
}

export type { Workspace };
