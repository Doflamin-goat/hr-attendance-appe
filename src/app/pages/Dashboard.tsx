import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAttendance } from "../context/AttendanceContext";
import { useEmployees } from "../context/EmployeesContext";
import { normalizeEmployeeName } from "../services/employeeService";
import DragDropUpload, {
  type DragDropUploadHandle,
} from "../components/layout/DragDropUpload";
import {
  FileSpreadsheet,
  Users,
  Clock,
  Timer,
  UserX,
  BarChart3,
  Bell,
  AlertTriangle,
  Trash2,
  FolderOpen,
  CheckCircle2,
  Download,
  UploadCloud,
  Hourglass,
  CalendarRange,
  TrendingUp,
  ShieldCheck,
  UserPlus,
  ShieldAlert,
  CheckCircle,
  ArrowRight,
  UserSearch,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  PageHeader,
  StatCard,
  Button,
  Badge,
  EmptyState,
  ConfirmModal,
  DataTable,
  DashboardCard,
  DashboardSection,
  FilterToolbar,
  SkeletonStatGrid,
  SkeletonDashboardCard,
  toast,
  type Column,
} from "../components/ui";

function formatMonthLabel(monthKey: string) {
  if (monthKey === "all") return "All Months";
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatDayLabel(dayValue: string) {
  if (dayValue === "all") return "All Dates";
  return new Date(dayValue).toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

type ConfirmState =
  | { kind: "clear-all" }
  | { kind: "delete-file"; fileId: string; fileName: string }
  | null;

type UploadedFileRow = {
  id: string;
  fileName: string;
  uploadedAt: string;
  lates: number;
  undertime: number;
};

export function Dashboard() {
  const {
    loading: attendanceLoading,
    handleFileUpload,
    fileName,
    uploadedFiles,
    lateRecords,
    lateSummary,
    generatedUndertimes,
    absences,
    manualUndertimes,
    memoAlerts,
    unreadMemoCount,
    deleteUploadedFile,
    clearAllAttendanceHistory,
    selectedMonthScope,
    selectedDayScope,
    setSelectedMonthScope,
    setSelectedDayScope,
    monthScopeOptions,
    dayScopeOptions,
    exportFilteredWorkbook,
  } = useAttendance();

  const { activeEmployeeCount, employees, loading: employeesLoading } = useEmployees();
  const navigate = useNavigate();
  const isLoading = attendanceLoading || (employeesLoading && employees.length === 0);

  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const uploadRef = useRef<DragDropUploadHandle | null>(null);

  const topLates = useMemo(() => lateSummary.slice(0, 5), [lateSummary]);

  const totalLateMinutes = useMemo(
    () =>
      lateSummary.reduce(
        (sum, entry) => sum + (entry.totalMinutesLate || 0),
        0
      ),
    [lateSummary]
  );

  const totalUndertime = generatedUndertimes.length + manualUndertimes.length;

  const filterLabel =
    selectedDayScope !== "all"
      ? formatDayLabel(selectedDayScope)
      : selectedMonthScope !== "all"
      ? formatMonthLabel(selectedMonthScope)
      : "All Records";

  const canResetFilters =
    selectedMonthScope !== "all" || selectedDayScope !== "all";

  const handleResetFilters = () => {
    setSelectedMonthScope("all");
    setSelectedDayScope("all");
  };

  const handleExcelExport = async () => {
    const result = await exportFilteredWorkbook();
    if (result.success) {
      toast.success("Report exported", result.message);
    } else {
      toast.error("Export failed", result.message);
    }
  };

  const handleDragDropUpload = (file: File) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const input = document.createElement("input");
    input.type = "file";
    input.files = dataTransfer.files;

    handleFileUpload({
      target: input,
      currentTarget: input,
    } as React.ChangeEvent<HTMLInputElement>);
  };

  const handleConfirm = () => {
    if (!confirmState) return;

    if (confirmState.kind === "clear-all") {
      clearAllAttendanceHistory();
      toast.success(
        "History cleared",
        "All uploaded attendance and related records were cleared."
      );
    } else if (confirmState.kind === "delete-file") {
      deleteUploadedFile(confirmState.fileId);
      toast.success(
        "File deleted",
        "Exemption, absence, and manual undertime records for the removed dates were also cleaned."
      );
    }

    setConfirmState(null);
  };

  const monthOptions = useMemo(
    () => [
      { value: "all", label: "All Months" },
      ...monthScopeOptions.map((m) => ({
        value: m,
        label: formatMonthLabel(m),
      })),
    ],
    [monthScopeOptions]
  );

  const dayOptions = useMemo(
    () => [
      {
        value: "all",
        label:
          selectedMonthScope === "all" ? "All Dates" : "All Dates in Month",
      },
      ...dayScopeOptions.map((d) => ({
        value: d,
        label: formatDayLabel(d),
      })),
    ],
    [dayScopeOptions, selectedMonthScope]
  );

  const repeatedLateOffenders = useMemo(
    () => lateSummary.filter((entry) => entry.totalLates >= 3),
    [lateSummary]
  );

  const unregisteredEmployeeNames = useMemo(() => {
    if (lateRecords.length === 0 && absences.length === 0) return [] as string[];

    const registered = new Set(
      employees.map((emp) => normalizeEmployeeName(emp.fullName))
    );

    const seen = new Set<string>();
    const collect = (name: string) => {
      const clean = name?.trim();
      if (!clean) return;
      const key = normalizeEmployeeName(clean);
      if (!key || registered.has(key) || seen.has(key)) return;
      seen.add(key);
    };

    lateRecords.forEach((r) => collect(r.name));
    absences.forEach((r) => collect(r.name));

    return Array.from(seen);
  }, [employees, lateRecords, absences]);

  const attentionItems = useMemo(() => {
    const items: Array<{
      id: string;
      tone: "warning" | "danger" | "info";
      icon: typeof AlertTriangle;
      title: string;
      description: string;
      cta: { label: string; onClick: () => void };
    }> = [];

    if (memoAlerts.length > 0) {
      items.push({
        id: "memo",
        tone: "danger",
        icon: Bell,
        title: `${memoAlerts.length} pending memo${
          memoAlerts.length === 1 ? "" : "s"
        }`,
        description:
          unreadMemoCount > 0
            ? `${unreadMemoCount} unread. Employees crossed the 4-late threshold.`
            : "Employees crossed the 4-late threshold and need review.",
        cta: { label: "Review", onClick: () => navigate("/lates") },
      });
    }

    if (repeatedLateOffenders.length > 0) {
      items.push({
        id: "repeated-lates",
        tone: "warning",
        icon: AlertTriangle,
        title: `${repeatedLateOffenders.length} employee${
          repeatedLateOffenders.length === 1 ? "" : "s"
        } with repeated lates`,
        description: "Three or more late arrivals in the selected scope.",
        cta: { label: "View lates", onClick: () => navigate("/lates") },
      });
    }

    if (absences.length > 0) {
      items.push({
        id: "absences",
        tone: "warning",
        icon: UserX,
        title: `${absences.length} absence${absences.length === 1 ? "" : "s"} logged`,
        description: "Recorded absences in the current scope.",
        cta: { label: "View absences", onClick: () => navigate("/absences") },
      });
    }

    if (unregisteredEmployeeNames.length > 0) {
      items.push({
        id: "unregistered",
        tone: "info",
        icon: UserSearch,
        title: `${unregisteredEmployeeNames.length} unregistered employee${
          unregisteredEmployeeNames.length === 1 ? "" : "s"
        }`,
        description:
          "Names found in attendance uploads are not in the employee directory yet.",
        cta: {
          label: "Register",
          onClick: () => navigate("/employees"),
        },
      });
    }

    return items;
  }, [
    memoAlerts.length,
    unreadMemoCount,
    repeatedLateOffenders.length,
    absences.length,
    unregisteredEmployeeNames.length,
    navigate,
  ]);

  const attentionToneClasses: Record<
    "warning" | "danger" | "info",
    { wrap: string; icon: string }
  > = {
    warning: {
      wrap: "border-warning-100 bg-warning-50/40",
      icon: "bg-warning-50 text-warning-700 border border-warning-100",
    },
    danger: {
      wrap: "border-danger-100 bg-danger-50/40",
      icon: "bg-danger-50 text-danger-700 border border-danger-100",
    },
    info: {
      wrap: "border-sky-100 bg-sky-50/40",
      icon: "bg-sky-50 text-sky-700 border border-sky-100",
    },
  };

  const quickActions = [
    {
      label: "Upload Attendance",
      description: "Import a daily biometric Excel file.",
      icon: UploadCloud,
      tone: "brand" as const,
      onClick: () => uploadRef.current?.open(),
    },
    {
      label: "Add Employee",
      description: "Register a new APP or WAIS employee.",
      icon: UserPlus,
      tone: "info" as const,
      onClick: () => navigate("/employees"),
    },
    {
      label: "Add Exemption",
      description: "Excuse a late arrival on record.",
      icon: ShieldCheck,
      tone: "success" as const,
      onClick: () => navigate("/exemptions"),
    },
    {
      label: "Export Report",
      description: "Generate Excel for the current scope.",
      icon: Download,
      tone: "warning" as const,
      onClick: () => {
        void handleExcelExport();
      },
    },
  ];

  const quickActionTones: Record<
    "brand" | "success" | "warning" | "info",
    string
  > = {
    brand: "bg-brand-50 text-brand-700 border-brand-100 group-hover:bg-brand-100",
    success:
      "bg-success-50 text-success-700 border-success-100 group-hover:bg-success-100",
    warning:
      "bg-warning-50 text-warning-700 border-warning-100 group-hover:bg-warning-100",
    info: "bg-sky-50 text-sky-700 border-sky-100 group-hover:bg-sky-100",
  };

  const uploadedRows: UploadedFileRow[] = useMemo(
    () =>
      uploadedFiles.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        uploadedAt: new Date(file.uploadedAt).toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
        lates: file.lateRecords.length,
        undertime: file.generatedUndertimes.length,
      })),
    [uploadedFiles]
  );

  const uploadedColumns: Column<UploadedFileRow>[] = [
    {
      key: "fileName",
      header: "File Name",
      render: (row) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 text-brand-700 border border-brand-100 flex-shrink-0">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <span className="font-medium text-slate-900 truncate">
            {row.fileName}
          </span>
        </div>
      ),
    },
    {
      key: "uploadedAt",
      header: "Uploaded",
      render: (row) => (
        <span className="text-sm text-slate-600">{row.uploadedAt}</span>
      ),
    },
    {
      key: "lates",
      header: "Lates",
      align: "right",
      render: (row) => (
        <span className="text-sm font-semibold text-slate-900">
          {row.lates}
        </span>
      ),
    },
    {
      key: "undertime",
      header: "Undertime",
      align: "right",
      render: (row) => (
        <span className="text-sm font-semibold text-slate-900">
          {row.undertime}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (row) => (
        <Button
          variant="danger"
          size="sm"
          leftIcon={<Trash2 className="w-3.5 h-3.5" />}
          onClick={() =>
            setConfirmState({
              kind: "delete-file",
              fileId: row.id,
              fileName: row.fileName,
            })
          }
        >
          Delete
        </Button>
      ),
    },
  ];

  const scopeChip = (
    <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-700 border border-brand-100">
        <CalendarRange className="w-3.5 h-3.5" />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          Current Scope
        </span>
        <span className="text-sm font-semibold text-slate-900">
          {filterLabel}
        </span>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR Attendance Dashboard"
        description="Monitor daily attendance, late records, absences, undertime, and memo alerts across the organization."
        endMeta={scopeChip}
        actions={
          <>
            <Button
              variant="secondary"
              leftIcon={<UploadCloud className="w-4 h-4" />}
              onClick={() => uploadRef.current?.open()}
            >
              Upload Attendance
            </Button>
            <Button
              variant="primary"
              leftIcon={<Download className="w-4 h-4" />}
              onClick={handleExcelExport}
            >
              Export Excel
            </Button>
          </>
        }
      />

      <FilterToolbar
        monthValue={selectedMonthScope}
        dayValue={selectedDayScope}
        monthOptions={monthOptions}
        dayOptions={dayOptions}
        scopeLabel={filterLabel}
        onChangeMonth={(v) => {
          setSelectedMonthScope(v);
          setSelectedDayScope("all");
        }}
        onChangeDay={(v) => setSelectedDayScope(v)}
        onReset={handleResetFilters}
        canReset={canResetFilters}
      />

      <DashboardSection
        eyebrow="Shortcuts"
        title="Quick Actions"
        description="Jump straight to the most common HR tasks."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className="group relative flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors flex-shrink-0 ${quickActionTones[action.tone]}`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 leading-tight">
                    {action.label}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 leading-snug">
                    {action.description}
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-300 transition-colors group-hover:text-slate-500 flex-shrink-0 mt-1" />
              </button>
            );
          })}
        </div>
      </DashboardSection>

      <DashboardSection
        eyebrow="Action Required"
        title="Needs Attention"
        description="Important HR alerts for the current scope."
      >
        <DashboardCard
          icon={
            attentionItems.length > 0 ? (
              <ShieldAlert className="w-4.5 h-4.5" />
            ) : (
              <CheckCircle className="w-4.5 h-4.5" />
            )
          }
          iconTone={attentionItems.length > 0 ? "warning" : "success"}
          title={
            attentionItems.length > 0
              ? `${attentionItems.length} item${
                  attentionItems.length === 1 ? "" : "s"
                } need attention`
              : "All clear"
          }
          description={
            attentionItems.length > 0
              ? "Review and resolve to keep records up to date."
              : "No urgent attendance issues for the selected scope."
          }
          padded={attentionItems.length === 0}
        >
          {attentionItems.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-success-100 bg-success-50/60 px-4 py-3">
              <CheckCircle className="w-5 h-5 text-success-700 flex-shrink-0" />
              <p className="text-sm text-success-700">
                All clear. No urgent attendance issues for the selected scope.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {attentionItems.map((item) => {
                const Icon = item.icon;
                const tones = attentionToneClasses[item.tone];
                return (
                  <li
                    key={item.id}
                    className={`flex items-start gap-3 px-5 py-3.5 border-l-2 transition-colors ${tones.wrap}`}
                  >
                    <div
                      className={`mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${tones.icon}`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {item.title}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5 leading-5">
                        {item.description}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                      onClick={item.cta.onClick}
                    >
                      {item.cta.label}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </DashboardCard>
      </DashboardSection>

      {isLoading ? (
        <DashboardSection
          eyebrow="Overview"
          title="Key Attendance Metrics"
          description="Loading the latest figures..."
        >
          <SkeletonStatGrid count={4} />
        </DashboardSection>
      ) : (
        <DashboardSection
          eyebrow="Overview"
          title="Key Attendance Metrics"
          description="Headline figures for the current scope."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total Employees"
              value={activeEmployeeCount}
              icon={Users}
              tone="brand"
              accent
              hint="Active roster"
            />
            <StatCard
              label="Late Records"
              value={lateRecords.length}
              icon={Clock}
              tone="warning"
              accent
              hint="In selected scope"
            />
            <StatCard
              label="Absences"
              value={absences.length}
              icon={UserX}
              tone="danger"
              accent
              hint="In selected scope"
            />
            <StatCard
              label="Memo Alerts"
              value={memoAlerts.length}
              icon={Bell}
              tone="warning"
              accent
              hint={
                unreadMemoCount > 0
                  ? `${unreadMemoCount} unread`
                  : "All reviewed"
              }
            />
          </div>
        </DashboardSection>
      )}

      <DashboardSection
        eyebrow="Secondary"
        title="Supporting Metrics"
        description="Detailed timing figures and supporting counts."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Late Minutes"
            value={totalLateMinutes}
            icon={Hourglass}
            tone="warning"
            size="sm"
            hint="Cumulative across records"
          />
          <StatCard
            label="Undertime"
            value={totalUndertime}
            icon={Timer}
            tone="info"
            size="sm"
            hint="Generated + manual"
          />
          <StatCard
            label="Files Uploaded"
            value={uploadedFiles.length}
            icon={FolderOpen}
            tone="neutral"
            size="sm"
            hint="Attendance imports"
          />
        </div>
      </DashboardSection>

      <DashboardSection
        eyebrow="Insights"
        title="Late Activity Analysis"
        description="Top late offenders and their cumulative late minutes."
      >
        {isLoading ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <SkeletonDashboardCard lines={6} />
            </div>
            <SkeletonDashboardCard lines={4} />
          </div>
        ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <DashboardCard
            className="xl:col-span-2"
            icon={<BarChart3 className="w-4.5 h-4.5" />}
            iconTone="brand"
            title="Top 5 Most Frequent Lates"
            description="Employees with the most late records in the selected scope."
            padded
            actions={
              topLates.length > 0 ? (
                <Badge tone="neutral" icon={<TrendingUp className="w-3 h-3" />}>
                  {lateSummary.length} tracked
                </Badge>
              ) : null
            }
          >
            {topLates.length > 0 ? (
              <div className="-mx-1 h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={topLates}
                    margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                    barCategoryGap="22%"
                  >
                    <defs>
                      <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="var(--color-brand-500)"
                          stopOpacity={0.95}
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--color-brand-700)"
                          stopOpacity={0.95}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--color-border)" }}
                      interval={0}
                      angle={-12}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      tickLine={false}
                      axisLine={false}
                      width={28}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(36,81,224,0.06)" }}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        fontSize: 12,
                        boxShadow: "0 4px 16px rgba(15,23,42,0.08)",
                      }}
                      formatter={(value) => [`${value} lates`, "Total"]}
                    />
                    <Bar
                      dataKey="totalLates"
                      fill="url(#barFill)"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={56}
                    >
                      {topLates.map((entry) => (
                        <Cell key={entry.name} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                icon={<BarChart3 className="w-6 h-6" />}
                title="No chart data yet"
                description="Upload attendance files to populate this chart."
                bordered={false}
                className="py-12"
              />
            )}
          </DashboardCard>

          <DashboardCard
            icon={<Users className="w-4.5 h-4.5" />}
            iconTone="brand"
            title="Top Employees"
            description="Most lates in the current report scope."
          >
            {topLates.length > 0 ? (
              <ol className="space-y-2">
                {topLates.map((employee, index) => (
                  <li
                    key={employee.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-700 border border-brand-100 flex items-center justify-center font-semibold text-xs flex-shrink-0">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {employee.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {employee.totalMinutesLate} late minutes
                        </p>
                      </div>
                    </div>
                    <Badge tone="warning">{employee.totalLates}×</Badge>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title="No summary yet"
                description="Upload attendance files to populate this list."
                bordered
              />
            )}
          </DashboardCard>
        </div>
        )}
      </DashboardSection>

      <DashboardSection
        eyebrow="Data Management"
        title="Imports & Reports"
        description="Upload daily attendance files and export the current scope."
      >
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <DashboardCard
            className="xl:col-span-2"
            icon={<UploadCloud className="w-4.5 h-4.5" />}
            iconTone="brand"
            title="Upload Attendance"
            description="Import daily biometric Excel files. Each upload is stored separately."
          >
            <DragDropUpload
              ref={uploadRef}
              density="compact"
              onFileSelect={handleDragDropUpload}
              onInvalidFile={(message) => toast.error("Upload error", message)}
            />

            {fileName && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-success-100 bg-success-50 px-2.5 py-1 text-xs font-medium text-success-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {fileName} loaded
              </div>
            )}
          </DashboardCard>

          <DashboardCard
            icon={<Download className="w-4.5 h-4.5" />}
            iconTone="brand"
            title="Export Report"
            description="Generate an Excel report for the current scope."
          >
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Current scope
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900 truncate">
                {filterLabel}
              </p>
            </div>

            <Button
              variant="primary"
              fullWidth
              leftIcon={<FileSpreadsheet className="w-4 h-4" />}
              onClick={handleExcelExport}
              className="mt-3"
            >
              Export Excel Report
            </Button>
          </DashboardCard>
        </div>
      </DashboardSection>

      <DashboardSection
        eyebrow="History"
        title="Uploaded Attendance Files"
        description="Manage individual imports or clear the full history."
      >
        <DashboardCard
          icon={<FolderOpen className="w-4.5 h-4.5" />}
          iconTone="neutral"
          title="File History"
          description="All attendance files imported into the system."
          padded={false}
          actions={
            uploadedFiles.length > 0 && (
              <Button
                variant="danger"
                size="sm"
                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => setConfirmState({ kind: "clear-all" })}
              >
                Clear All History
              </Button>
            )
          }
        >
          {uploadedRows.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                icon={<FolderOpen className="w-6 h-6" />}
                title="No uploaded attendance files yet"
                description="Drop an Excel file in the Upload Attendance card above to get started."
                bordered
              />
            </div>
          ) : (
            <DataTable
              columns={uploadedColumns}
              rows={uploadedRows}
              rowKey={(row) => row.id}
              dense
            />
          )}
        </DashboardCard>
      </DashboardSection>

      {memoAlerts.length > 0 && (
        <DashboardSection
          eyebrow="Action Required"
          title="Memo Reminders"
          description="Employees with 4 or more lates that need a memo review."
        >
          <DashboardCard
            icon={<Bell className="w-4.5 h-4.5" />}
            iconTone="warning"
            title={`${memoAlerts.length} pending memo${
              memoAlerts.length === 1 ? "" : "s"
            }`}
            description="Review each employee and issue the appropriate memo."
            actions={
              <Badge tone="warning">
                {unreadMemoCount} unread
              </Badge>
            }
            padded={false}
          >
            <ul className="divide-y divide-slate-100">
              {memoAlerts.map((alert) => (
                <li
                  key={alert.id}
                  className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50/60 transition-colors"
                >
                  <div className="mt-0.5 w-8 h-8 rounded-full bg-warning-50 text-warning-700 border border-warning-100 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {alert.name}
                      </p>
                      <Badge tone="danger">{alert.totalLates} lates</Badge>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-5">
                      {alert.message}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Total late minutes: {alert.totalMinutesLate}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </DashboardCard>
        </DashboardSection>
      )}

      <ConfirmModal
        open={confirmState?.kind === "clear-all"}
        tone="danger"
        title="Clear all attendance history?"
        description="This will remove every uploaded file and all related late, undertime, exemption, and absence records that depend on them."
        confirmLabel="Clear All"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmState(null)}
      />

      <ConfirmModal
        open={confirmState?.kind === "delete-file"}
        tone="danger"
        title="Delete this attendance file?"
        description={
          confirmState?.kind === "delete-file" ? (
            <>
              <span className="font-semibold">{confirmState.fileName}</span>{" "}
              will be removed. Exemption, absence, and manual undertime records
              tied to removed dates will also be cleaned.
            </>
          ) : null
        }
        confirmLabel="Delete File"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}
