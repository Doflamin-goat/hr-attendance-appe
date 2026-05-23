import { useMemo, useState } from "react";
import {
  Search,
  Users,
  UserPlus,
  Pencil,
  Power,
  RefreshCw,
  AlertCircle,
  UserMinus,
  Building2,
} from "lucide-react";
import { useAttendance } from "../context/AttendanceContext";
import { useEmployees } from "../context/EmployeesContext";
import { useAuth } from "../context/AuthContext";
import {
  PageHeader,
  StatCard,
  Card,
  Input,
  Select,
  Button,
  DataTable,
  ConfirmModal,
  AlertMessage,
  StatusBadge,
  SkeletonTable,
  toast,
  type Column,
} from "../components/ui";
import { EmployeeFormModal } from "../components/employees/EmployeeFormModal";
import {
  normalizeEmployeeName,
  type Employee,
  type EmployeeInput,
  type Workspace,
} from "../services/employeeService";

type StatusFilter = "active" | "inactive" | "all";
type WorkspaceFilter = "all" | Workspace;

type EmployeeRow = {
  id: string;
  employee: Employee | null;
  fullName: string;
  workspace: Workspace | null;
  employeeNumber: string | null;
  department: string | null;
  position: string | null;
  status: "active" | "inactive" | "unregistered";
  latesCount: number;
  absenceCount: number;
  lateExemptionsCount: number;
  totalUndertime: number;
};

type ConfirmState =
  | { kind: "deactivate"; id: string; name: string }
  | { kind: "restore"; id: string; name: string }
  | null;

function formatMinutes(minutes: number) {
  if (!minutes || minutes <= 0) return "—";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs > 0 && mins > 0) return `${hrs} hr ${mins} min`;
  if (hrs > 0) return `${hrs} hr`;
  return `${mins} min`;
}

function formatCount(value: number) {
  return value > 0 ? value : "—";
}

function getInitials(name: string) {
  const parts = name
    .replace(/,/g, " ")
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getEmployeePhoto(name: string) {
  const fileName = name
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "-");
  return `/employees/${fileName}.jpg`;
}

function EmployeeAvatar({ name }: { name: string }) {
  const [hasError, setHasError] = useState(false);
  const photo = getEmployeePhoto(name);

  if (!hasError) {
    return (
      <img
        src={photo}
        alt={name}
        onError={() => setHasError(true)}
        className="h-10 w-10 rounded-full border border-slate-200 object-cover flex-shrink-0"
      />
    );
  }

  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 border border-brand-100 flex-shrink-0">
      {getInitials(name)}
    </div>
  );
}

function RowStatusBadge({ status }: { status: EmployeeRow["status"] }) {
  if (status === "active") return <StatusBadge kind="active" />;
  if (status === "inactive") return <StatusBadge kind="inactive" />;
  return <StatusBadge kind="unregistered" />;
}

function CompanyBadge({ workspace }: { workspace: Workspace | null }) {
  if (!workspace) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  return <StatusBadge kind={workspace === "APP" ? "app" : "wais"} />;
}

export default function EmployeesPage() {
  const { workspace: currentWorkspace } = useAuth();
  const {
    employees,
    activeEmployeeCount,
    inactiveEmployeeCount,
    appActiveCount,
    waisActiveCount,
    loading,
    error,
    refresh,
    addEmployee,
    updateEmployee,
    deactivateEmployee,
    restoreEmployee,
  } = useEmployees();

  const {
    lateRecords = [],
    exemptions = [],
    absences = [],
    generatedUndertimes = [],
    manualUndertimes = [],
  } = useAttendance();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [workspaceFilter, setWorkspaceFilter] =
    useState<WorkspaceFilter>("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [actionPending, setActionPending] = useState(false);

  const rows = useMemo<EmployeeRow[]>(() => {
    const map = new Map<string, EmployeeRow>();

    employees.forEach((emp) => {
      const status: EmployeeRow["status"] =
        emp.isDeleted || emp.employmentStatus === "inactive"
          ? "inactive"
          : "active";

      map.set(normalizeEmployeeName(emp.fullName), {
        id: emp.id,
        employee: emp,
        fullName: emp.fullName,
        workspace: emp.workspace,
        employeeNumber: emp.employeeNumber,
        department: emp.department,
        position: emp.position,
        status,
        latesCount: 0,
        absenceCount: 0,
        lateExemptionsCount: 0,
        totalUndertime: 0,
      });
    });

    const ensureUnregistered = (name: string) => {
      const cleanName = name?.trim();
      if (!cleanName) return null;

      const key = normalizeEmployeeName(cleanName);
      let row = map.get(key);

      if (!row) {
        row = {
          id: `unregistered-${key}`,
          employee: null,
          fullName: cleanName,
          workspace: null,
          employeeNumber: null,
          department: null,
          position: null,
          status: "unregistered",
          latesCount: 0,
          absenceCount: 0,
          lateExemptionsCount: 0,
          totalUndertime: 0,
        };
        map.set(key, row);
      }

      return row;
    };

    lateRecords.forEach((rec) => {
      const row = ensureUnregistered(rec.name);
      if (row) row.latesCount += 1;
    });

    exemptions.forEach((rec) => {
      const row = ensureUnregistered(rec.name);
      if (row) row.lateExemptionsCount += 1;
    });

    absences.forEach((rec) => {
      const row = ensureUnregistered(rec.name);
      if (row) row.absenceCount += 1;
    });

    generatedUndertimes.forEach((rec) => {
      const row = ensureUnregistered(rec.name);
      if (row) row.totalUndertime += 1;
    });

    manualUndertimes.forEach((rec) => {
      const row = ensureUnregistered(rec.name);
      if (row) {
        const hours = Number(rec.undertimeHours || 0);
        row.totalUndertime += hours * 60;
      }
    });

    return Array.from(map.values()).sort((a, b) =>
      a.fullName.localeCompare(b.fullName)
    );
  }, [
    employees,
    lateRecords,
    exemptions,
    absences,
    generatedUndertimes,
    manualUndertimes,
  ]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (statusFilter === "active" && row.status !== "active") return false;
      if (statusFilter === "inactive" && row.status !== "inactive") return false;

      if (workspaceFilter !== "all") {
        // Unregistered rows have no workspace; only show them on "All" to avoid
        // hiding legitimate attendance data unexpectedly.
        if (!row.workspace) return false;
        if (row.workspace !== workspaceFilter) return false;
      }

      if (!keyword) return true;

      const haystack = [
        row.fullName,
        row.workspace ?? "",
        row.employeeNumber ?? "",
        row.department ?? "",
        row.position ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(keyword);
    });
  }, [rows, search, statusFilter, workspaceFilter]);

  const handleOpenAdd = () => {
    setModalMode("add");
    setEditing(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (emp: Employee) => {
    setModalMode("edit");
    setEditing(emp);
    setModalOpen(true);
  };

  const handleOpenRegister = (name: string) => {
    setModalMode("add");
    setEditing({
      id: "",
      workspace: (currentWorkspace ?? "APP") as Workspace,
      employeeNumber: null,
      fullName: name,
      department: null,
      position: null,
      employmentStatus: "active",
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdAt: "",
      updatedAt: "",
    });
    setModalOpen(true);
  };

  const handleSubmit = async (input: EmployeeInput) => {
    if (modalMode === "add") {
      await addEmployee(input);
      toast.success(
        "Employee added",
        `${input.fullName} was added to ${input.workspace}.`
      );
    } else if (editing) {
      await updateEmployee(editing.id, input);
      toast.success("Employee updated", `${input.fullName}'s details were saved.`);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmState) return;
    setActionPending(true);

    try {
      if (confirmState.kind === "deactivate") {
        await deactivateEmployee(confirmState.id);
        toast.success(
          "Employee deactivated",
          `${confirmState.name} is now inactive. Attendance history is preserved.`
        );
      } else {
        await restoreEmployee(confirmState.id);
        toast.success(
          "Employee restored",
          `${confirmState.name} is active again.`
        );
      }
      setConfirmState(null);
    } catch (err) {
      toast.error(
        "Action failed",
        err instanceof Error ? err.message : "Failed to complete the action."
      );
    } finally {
      setActionPending(false);
    }
  };

  const columns: Column<EmployeeRow>[] = [
    {
      key: "employee",
      header: "Employee",
      render: (row) => (
        <div className="flex items-center gap-3 min-w-0">
          <EmployeeAvatar name={row.fullName} />
          <p className="font-medium text-slate-900 truncate min-w-0">
            {row.fullName}
          </p>
        </div>
      ),
    },
    {
      key: "company",
      header: "Company",
      render: (row) => <CompanyBadge workspace={row.workspace} />,
    },
    {
      key: "position",
      header: "Position",
      render: (row) => (
        <span className="text-sm text-slate-700 truncate block">
          {row.position || "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <RowStatusBadge status={row.status} />,
    },
    {
      key: "lates",
      header: "Lates",
      align: "right",
      render: (row) => (
        <span className="font-semibold text-slate-900">
          {formatCount(row.latesCount)}
        </span>
      ),
    },
    {
      key: "absences",
      header: "Absences",
      align: "right",
      render: (row) => formatCount(row.absenceCount),
    },
    {
      key: "exemptions",
      header: "Exemptions",
      align: "right",
      render: (row) => formatCount(row.lateExemptionsCount),
    },
    {
      key: "undertime",
      header: "Undertime",
      align: "right",
      render: (row) => formatMinutes(row.totalUndertime),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (row) => {
        if (!row.employee) {
          return (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<UserPlus className="w-3.5 h-3.5" />}
              onClick={(e) => {
                e.preventDefault();
                handleOpenRegister(row.fullName);
              }}
            >
              Register
            </Button>
          );
        }

        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<Pencil className="w-3.5 h-3.5" />}
              onClick={(e) => {
                e.preventDefault();
                handleOpenEdit(row.employee!);
              }}
            >
              Edit
            </Button>
            {row.status === "active" ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                leftIcon={<Power className="w-3.5 h-3.5" />}
                onClick={(e) => {
                  e.preventDefault();
                  setConfirmState({
                    kind: "deactivate",
                    id: row.employee!.id,
                    name: row.employee!.fullName,
                  });
                }}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                type="button"
                variant="success"
                size="sm"
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                onClick={(e) => {
                  e.preventDefault();
                  setConfirmState({
                    kind: "restore",
                    id: row.employee!.id,
                    name: row.employee!.fullName,
                  });
                }}
              >
                Restore
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employee Directory"
        description="Manage APP and WAIS employees in one HR master list. Attendance history is preserved when employees are deactivated."
        actions={
          <>
            <Button
              variant="secondary"
              leftIcon={<RefreshCw className="w-4 h-4" />}
              onClick={() => void refresh()}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              leftIcon={<UserPlus className="w-4 h-4" />}
              onClick={handleOpenAdd}
            >
              Add Employee
            </Button>
          </>
        }
      />

      {error && (
        <AlertMessage
          tone="error"
          title="Could not load employees"
          message={error}
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Active Employees"
          value={activeEmployeeCount}
          icon={Users}
          tone="brand"
          accent
          hint="APP & WAIS"
        />
        <StatCard
          label="APP Employees"
          value={appActiveCount}
          icon={Building2}
          tone="brand"
          accent
          hint="Production"
        />
        <StatCard
          label="WAIS Employees"
          value={waisActiveCount}
          icon={Building2}
          tone="info"
          accent
          hint="Admin"
        />
        <StatCard
          label="Inactive Employees"
          value={inactiveEmployeeCount}
          icon={UserMinus}
          tone="neutral"
          accent
          hint="Deleted records"
        />
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              Master List
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Showing employees across all companies. Counts reflect uploaded
              attendance and manual entries.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="w-full sm:w-40">
              <Select
                aria-label="Company filter"
                value={workspaceFilter}
                onChange={(e) =>
                  setWorkspaceFilter(e.target.value as WorkspaceFilter)
                }
              >
                <option value="all">All</option>
                <option value="APP">APP</option>
                <option value="WAIS">WAIS</option>
              </Select>
            </div>

            <div className="w-full sm:w-40">
              <Select
                aria-label="Status filter"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as StatusFilter)
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="all">All</option>
              </Select>
            </div>

            <div className="w-full sm:w-64">
              <Input
                type="search"
                placeholder="Search name, company, dept..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leftIcon={<Search className="w-4 h-4" />}
              />
            </div>
          </div>
        </div>

        {loading && employees.length === 0 ? (
          <SkeletonTable rows={6} columns={5} />
        ) : (
          <DataTable
            columns={columns}
            rows={filteredRows}
            rowKey={(row) => row.id}
            emptyTitle="No employee found"
            emptyDescription={
              search
                ? "Try adjusting your search or filters."
                : statusFilter === "inactive"
                ? "No deactivated employees yet."
                : workspaceFilter !== "all"
                ? `No employees in ${workspaceFilter} for the selected status.`
                : "Add your first employee to get started."
            }
            emptyIcon={
              statusFilter === "inactive" ? (
                <UserMinus className="w-6 h-6" />
              ) : search ? (
                <AlertCircle className="w-6 h-6" />
              ) : (
                <Users className="w-6 h-6" />
              )
            }
          />
        )}
      </Card>

      <EmployeeFormModal
        open={modalOpen}
        mode={modalMode}
        defaultWorkspace={currentWorkspace ?? null}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        open={confirmState?.kind === "deactivate"}
        tone="danger"
        title="Deactivate this employee?"
        description={
          confirmState?.kind === "deactivate" ? (
            <>
              <span className="font-semibold">{confirmState.name}</span> will
              be marked as inactive. Their past attendance, late records,
              absences, exemptions, and undertime history will be preserved.
            </>
          ) : null
        }
        confirmLabel="Deactivate"
        loading={actionPending && confirmState?.kind === "deactivate"}
        onConfirm={handleConfirmAction}
        onCancel={() => (actionPending ? null : setConfirmState(null))}
      />

      <ConfirmModal
        open={confirmState?.kind === "restore"}
        tone="primary"
        title="Restore this employee?"
        description={
          confirmState?.kind === "restore" ? (
            <>
              <span className="font-semibold">{confirmState.name}</span> will
              be set back to active status.
            </>
          ) : null
        }
        confirmLabel="Restore"
        loading={actionPending && confirmState?.kind === "restore"}
        onConfirm={handleConfirmAction}
        onCancel={() => (actionPending ? null : setConfirmState(null))}
      />
    </div>
  );
}
