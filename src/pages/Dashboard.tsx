import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAttendance } from "../context/AttendanceContext";
import { useEmployees } from "../context/EmployeesContext";
import { normalizeEmployeeName } from "../services/employeeService";
import DragDropUpload, {
  type DragDropUploadHandle,
} from "../components/layout/DragDropUpload";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  CalendarRange,
  CheckCircle,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Hourglass,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Trash2,
  UploadCloud,
  UserPlus,
  UserSearch,
  Users,
  UserX,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Badge,
  Button,
  ConfirmModal,
  DashboardCard,
  DashboardSection,
  DataTable,
  EmptyState,
  FilterToolbar,
  PageHeader,
  SkeletonDashboardCard,
  SkeletonStatGrid,
  StatCard,
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

  const { activeEmployeeCount, employees, loading: employeesLoading } =
    useEmployees();

  const navigate = useNavigate();
  const uploadRef = useRef<DragDropUploadHandle | null>(null);

  const isLoading =
    attendanceLoading || (employeesLoading && employees.length === 0);

  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [showRepeatedLatesModal, setShowRepeatedLatesModal] = useState(false);
  const [showPendingMemoModal, setShowPendingMemoModal] = useState(false);

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

  const monthOptions = useMemo(
    () => [
      { value: "all", label: "All Months" },
      ...monthScopeOptions.map((month) => ({
        value: month,
        label: formatMonthLabel(month),
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
      ...dayScopeOptions.map((day) => ({
        value: day,
        label: formatDayLabel(day),
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
      employees.map((employee) => normalizeEmployeeName(employee.fullName))
    );
    const seen = new Set<string>();

    const collect = (name: string) => {
      const clean = name?.trim();
      if (!clean) return;

      const key = normalizeEmployeeName(clean);
      if (!key || registered.has(key) || seen.has(key)) return;

      seen.add(key);
    };

    lateRecords.forEach((record) => collect(record.name));
    absences.forEach((record) => collect(record.name));

    return Array.from(seen);
  }, [employees, lateRecords, absences]);

  const uploadedRows = useMemo<UploadedFileRow[]>(
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
    }

    if (confirmState.kind === "delete-file") {
      deleteUploadedFile(confirmState.fileId);
      toast.success(
        "File deleted",
        "Exemption, absence, and manual undertime records for the removed dates were also cleaned."
      );
    }

    setConfirmState(null);
  };

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
        cta: { label: "Review", onClick: () => setShowPendingMemoModal(true) },
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
        cta: {
          label: "View lates",
          onClick: () => setShowRepeatedLatesModal(true),
        },
      });
    }

    if (absences.length > 0) {
      items.push({
        id: "absences",
        tone: "warning",
        icon: UserX,
        title: `${absences.length} absence${
          absences.length === 1 ? "" : "s"
        } logged`,
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
        cta: { label: "Register", onClick: () => navigate("/employees") },
      });
    }

    return items;
  }, [
    absences.length,
    memoAlerts.length,
    navigate,
    repeatedLateOffenders.length,
    unreadMemoCount,
    unregisteredEmployeeNames.length,
  ]);

  const attentionToneClasses: Record<
    "warning" | "danger" | "info",
    { wrap: string; icon: string }
  > = {
    warning: {
      wrap: "border-warning-100 bg-warning-50/40",
      icon: "border border-warning-100 bg-warning-50 text-warning-700",
    },
    danger: {
      wrap: "border-danger-100 bg-danger-50/40",
      icon: "border border-danger-100 bg-danger-50 text-danger-700",
    },
    info: {
      wrap: "border-sky-100 bg-sky-50/40",
      icon: "border border-sky-100 bg-sky-50 text-sky-700",
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
    brand:
      "border-brand-100 bg-brand-50 text-brand-700 group-hover:bg-brand-100",
    success:
      "border-success-100 bg-success-50 text-success-700 group-hover:bg-success-100",
    warning:
      "border-warning-100 bg-warning-50 text-warning-700 group-hover:bg-warning-100",
    info: "border-sky-100 bg-sky-50 text-sky-700 group-hover:bg-sky-100",
  };

  const uploadedColumns: Column<UploadedFileRow>[] = [
    {
      key: "fileName",
      header: "File Name",
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-brand-100 bg-brand-50 text-brand-700">
            <FileSpreadsheet className="h-4 w-4" />
          </div>
          <span className="truncate font-medium text-slate-900">
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
        <span className="font-semibold text-slate-900">{row.lates}</span>
      ),
    },
    {
      key: "undertime",
      header: "Undertime",
      align: "right",
      render: (row) => (
        <span className="font-semibold text-slate-900">{row.undertime}</span>
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
          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
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
      <div className="flex h-7 w-7 items-center justify-center rounded-md border border-brand-100 bg-brand-50 text-brand-700">
        <CalendarRange className="h-3.5 w-3.5" />
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="HR Attendance Dashboard"
          description="Loading attendance analytics and uploaded records."
          endMeta={scopeChip}
        />
        <SkeletonStatGrid count={4} />
        <SkeletonDashboardCard lines={6} />
      </div>
    );
  }

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
              leftIcon={<UploadCloud className="h-4 w-4" />}
              onClick={() => uploadRef.current?.open()}
            >
              Upload Attendance
            </Button>
            <Button
              variant="primary"
              leftIcon={<Download className="h-4 w-4" />}
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
        onChangeMonth={(value) => {
          setSelectedMonthScope(value);
          setSelectedDayScope("all");
        }}
        onChangeDay={(value) => setSelectedDayScope(value)}
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
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border transition-colors ${quickActionTones[action.tone]}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight text-slate-900">
                    {action.label}
                  </p>
                  <p className="mt-1 text-xs leading-snug text-slate-500">
                    {action.description}
                  </p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 flex-shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" />
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
              <ShieldAlert className="h-4.5 w-4.5" />
            ) : (
              <CheckCircle className="h-4.5 w-4.5" />
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
              <CheckCircle className="h-5 w-5 flex-shrink-0 text-success-700" />
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
                    className={`flex items-start gap-3 border-l-2 px-5 py-3.5 transition-colors ${tones.wrap}`}
                  >
                    <div
                      className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${tones.icon}`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-slate-600">
                        {item.description}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
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
              unreadMemoCount > 0 ? `${unreadMemoCount} unread` : "All reviewed"
            }
          />
        </div>
      </DashboardSection>

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
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <DashboardCard
            className="xl:col-span-2"
            icon={<BarChart3 className="h-4.5 w-4.5" />}
            iconTone="brand"
            title="Top 5 Most Frequent Lates"
            description="Employees with the most late records in the selected scope."
            actions={
              topLates.length > 0 ? (
                <Badge tone="neutral">{lateSummary.length} tracked</Badge>
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
                icon={<BarChart3 className="h-6 w-6" />}
                title="No chart data yet"
                description="Upload attendance files to populate this chart."
                bordered={false}
                className="py-12"
              />
            )}
          </DashboardCard>

          <DashboardCard
            icon={<Users className="h-4.5 w-4.5" />}
            iconTone="brand"
            title="Top Employees"
            description="Most lates in the current report scope."
          >
            {topLates.length > 0 ? (
              <ol className="space-y-2">
                {topLates.map((employee, index) => (
                  <li
                    key={employee.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 transition-colors hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-brand-100 bg-brand-50 text-xs font-semibold text-brand-700">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
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
      </DashboardSection>

      <DashboardSection
        eyebrow="Data Management"
        title="Imports & Reports"
        description="Upload daily attendance files and export the current scope."
      >
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <DashboardCard
            className="xl:col-span-2"
            icon={<UploadCloud className="h-4.5 w-4.5" />}
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
                <CheckCircle2 className="h-3.5 w-3.5" />
                {fileName} loaded
              </div>
            )}
          </DashboardCard>

          <DashboardCard
            icon={<Download className="h-4.5 w-4.5" />}
            iconTone="brand"
            title="Export Report"
            description="Generate an Excel report for the current scope."
          >
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Current scope
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                {filterLabel}
              </p>
            </div>

            <Button
              variant="primary"
              fullWidth
              leftIcon={<FileSpreadsheet className="h-4 w-4" />}
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
          icon={<FolderOpen className="h-4.5 w-4.5" />}
          iconTone="neutral"
          title="File History"
          description="All attendance files imported into the system."
          padded={false}
          actions={
            uploadedFiles.length > 0 && (
              <Button
                variant="danger"
                size="sm"
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
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
                icon={<FolderOpen className="h-6 w-6" />}
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
            icon={<Bell className="h-4.5 w-4.5" />}
            iconTone="warning"
            title={`${memoAlerts.length} pending memo${
              memoAlerts.length === 1 ? "" : "s"
            }`}
            description="Review each employee and issue the appropriate memo."
            actions={<Badge tone="warning">{unreadMemoCount} unread</Badge>}
            padded={false}
          >
            <ul className="divide-y divide-slate-100">
              {memoAlerts.map((alert) => (
                <li
                  key={alert.id}
                  className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50/60"
                >
                  <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-warning-100 bg-warning-50 text-warning-700">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {alert.name}
                      </p>
                      <Badge tone="danger">{alert.totalLates} lates</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {alert.message}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Total late minutes: {alert.totalMinutesLate}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </DashboardCard>
        </DashboardSection>
      )}

      {showPendingMemoModal && (
        <div
          className="ui-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowPendingMemoModal(false)}
        >
          <div
            className="ui-modal-in flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-danger-100 bg-danger-50 text-danger-700">
                  <Bell className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-slate-900">
                    Pending Memo Reviews
                  </h3>
                  <p className="mt-0.5 text-xs leading-snug text-slate-500">
                    Employees who reached the memo threshold in the selected scope.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowPendingMemoModal(false)}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close pending memo reviews"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto">
              {memoAlerts.length === 0 ? (
                <EmptyState
                  icon={<Bell className="h-6 w-6" />}
                  title="No pending memo reviews"
                  description="No employees reached the memo threshold for the selected scope."
                  bordered={false}
                  className="py-10"
                />
              ) : (
                <DataTable
                  columns={[
                    {
                      key: "name",
                      header: "Employee",
                      render: (row) => (
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">
                            {row.name}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                            {row.message}
                          </p>
                        </div>
                      ),
                    },
                    {
                      key: "totalLates",
                      header: "Total Lates",
                      align: "right",
                      render: (row) => (
                        <Badge tone="danger">{row.totalLates}</Badge>
                      ),
                    },
                    {
                      key: "totalMinutesLate",
                      header: "Late Minutes",
                      align: "right",
                      render: (row) => (
                        <span className="tabular-nums text-sm font-semibold text-slate-900">
                          {row.totalMinutesLate}
                        </span>
                      ),
                    },
                    {
                      key: "status",
                      header: "Status",
                      render: (row) => (
                        <Badge tone={row.isRead ? "success" : "warning"}>
                          {row.isRead ? "Reviewed" : "Needs review"}
                        </Badge>
                      ),
                    },
                  ]}
                  rows={memoAlerts}
                  rowKey={(row) => row.id}
                  dense
                />
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
              <p className="text-xs text-slate-500">
                {memoAlerts.length} employee
                {memoAlerts.length === 1 ? "" : "s"} need memo review.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowPendingMemoModal(false)}
                >
                  Close
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setShowPendingMemoModal(false);
                    navigate("/lates");
                  }}
                >
                  Open Late Records
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRepeatedLatesModal && (
        <div
          className="ui-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowRepeatedLatesModal(false)}
        >
          <div
            className="ui-modal-in flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-warning-100 bg-warning-50 text-warning-700">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-slate-900">
                    Employees with Repeated Lates
                  </h3>
                  <p className="mt-0.5 text-xs leading-snug text-slate-500">
                    Employees with 3 or more late arrivals in the selected scope.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowRepeatedLatesModal(false)}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close repeated lates"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto">
              {repeatedLateOffenders.length === 0 ? (
                <EmptyState
                  icon={<AlertTriangle className="h-6 w-6" />}
                  title="No repeated lates"
                  description="No employees currently meet the 3+ late threshold for the selected scope."
                  bordered={false}
                  className="py-10"
                />
              ) : (
                <DataTable
                  columns={[
                    {
                      key: "name",
                      header: "Employee",
                      render: (row) => (
                        <span className="truncate font-medium text-slate-900">
                          {row.name}
                        </span>
                      ),
                    },
                    {
                      key: "totalLates",
                      header: "Total Lates",
                      align: "right",
                      render: (row) => (
                        <Badge tone="warning">{row.totalLates}</Badge>
                      ),
                    },
                    {
                      key: "totalMinutesLate",
                      header: "Late Minutes",
                      align: "right",
                      render: (row) => (
                        <span className="tabular-nums text-sm font-semibold text-slate-900">
                          {row.totalMinutesLate}
                        </span>
                      ),
                    },
                  ]}
                  rows={repeatedLateOffenders}
                  rowKey={(row) => row.name}
                  dense
                />
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
              <p className="text-xs text-slate-500">
                {repeatedLateOffenders.length} employee
                {repeatedLateOffenders.length === 1 ? "" : "s"} flagged.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowRepeatedLatesModal(false)}
                >
                  Close
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setShowRepeatedLatesModal(false);
                    navigate("/lates");
                  }}
                >
                  Open Late Records
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmState?.kind === "clear-all"}
        tone="danger"
        title="Move all attendance history to Trash?"
        description="This will move every uploaded file and all related late, undertime, exemption, and absence records to Trash. You can restore them later from the Recycle Bin."
        confirmLabel="Move to Trash"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmState(null)}
      />

      <ConfirmModal
        open={confirmState?.kind === "delete-file"}
        tone="danger"
        title="Move this attendance file to Trash?"
        description={
          confirmState?.kind === "delete-file" ? (
            <>
              <span className="font-semibold">{confirmState.fileName}</span>{" "}
              and its late / undertime records will be moved to Trash.
              Exemptions, absences, and manual undertimes tied to dates that
              no longer have any other file coverage will be moved together
              as a batch. You can restore everything from the Recycle Bin.
            </>
          ) : null
        }
        confirmLabel="Move to Trash"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}