import { useMemo, useRef, useState } from "react";
import { useAttendance } from "../context/AttendanceContext";
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
  AlertMessage,
  ConfirmModal,
  DataTable,
  DashboardCard,
  DashboardSection,
  FilterToolbar,
  type Column,
} from "../components/ui";
import { MASTER_EMPLOYEE_COUNT } from "../data/masterEmployees";

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

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

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
    setFeedback({
      type: result.success ? "success" : "error",
      message: result.message,
    });
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
      setFeedback({
        type: "success",
        message:
          "All uploaded attendance history and related records were cleared.",
      });
    } else if (confirmState.kind === "delete-file") {
      deleteUploadedFile(confirmState.fileId);
      setFeedback({
        type: "success",
        message:
          "Uploaded file deleted. Related exemption, absence, and manual undertime records for removed dates were also cleaned.",
      });
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

      {feedback && (
        <AlertMessage
          tone={feedback.type}
          title="System message"
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      <DashboardSection
        eyebrow="Overview"
        title="Key Attendance Metrics"
        description="Headline figures for the current scope."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Total Employees"
            value={MASTER_EMPLOYEE_COUNT}
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
              onInvalidFile={(message) =>
                setFeedback({ type: "error", message })
              }
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
