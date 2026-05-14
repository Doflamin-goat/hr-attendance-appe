import { useState } from "react";
import { useAttendance } from "../context/AttendanceContext";
import DragDropUpload from "../components/layout/DragDropUpload";
import {
  FileSpreadsheet,
  Users,
  Clock,
  Timer,
  ShieldAlert,
  BarChart3,
  Bell,
  AlertTriangle,
  Trash2,
  FolderOpen,
  CheckCircle2,
  Download,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  PageHeader,
  StatCard,
  Card,
  Button,
  Badge,
  EmptyState,
  AlertMessage,
  ConfirmModal,
  SectionHeader,
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

export function Dashboard() {
  const {
    handleFileUpload,
    fileName,
    uploadedFiles,
    lateRecords,
    lateSummary,
    generatedUndertimes,
    absences,
    exemptions,
    manualUndertimes,
    memoAlerts,
    unreadMemoCount,
    deleteUploadedFile,
    clearAllAttendanceHistory,
    selectedMonthScope,
    selectedDayScope,
    exportFilteredWorkbook,
  } = useAttendance();

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  const topLates = [...lateSummary].slice(0, 5);

  const filterLabel =
    selectedDayScope !== "all"
      ? formatDayLabel(selectedDayScope)
      : selectedMonthScope !== "all"
      ? formatMonthLabel(selectedMonthScope)
      : "All Records";

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of employee attendance, stored records, uploaded files, and memo alerts."
        actions={
          <Badge tone="info" icon={<FileSpreadsheet className="w-3.5 h-3.5" />}>
            Current scope: {filterLabel}
          </Badge>
        }
      />

      {feedback && (
        <AlertMessage
          tone={feedback.type}
          title="System message"
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Total Late Records"
          value={lateRecords.length}
          icon={Clock}
          tone="warning"
        />
        <StatCard
          label="Employees Late"
          value={lateSummary.length}
          icon={Users}
          tone="brand"
        />
        <StatCard
          label="Undertime Cases"
          value={generatedUndertimes.length + manualUndertimes.length}
          icon={Timer}
          tone="neutral"
        />
        <StatCard
          label="Total Exceptions"
          value={absences.length + exemptions.length}
          icon={ShieldAlert}
          tone="danger"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <SectionHeader
            icon={<FileSpreadsheet className="w-5 h-5" />}
            iconTone="brand"
            title="Upload Attendance Data"
            description="Import daily biometric Excel files. Each upload is saved and can be deleted separately."
          />

          <div className="mt-5">
            <DragDropUpload
              onFileSelect={handleDragDropUpload}
              onInvalidFile={(message) =>
                setFeedback({ type: "error", message })
              }
            />
          </div>

          {fileName && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-success-100 bg-success-50 px-3 py-1.5 text-xs font-medium text-success-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {fileName} loaded successfully
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader
            icon={<Download className="w-5 h-5" />}
            iconTone="brand"
            title="Reports"
            description="Export the current report scope to Excel."
          />

          <Button
            variant="primary"
            fullWidth
            leftIcon={<FileSpreadsheet className="w-4 h-4" />}
            onClick={handleExcelExport}
            className="mt-5"
          >
            Export Excel Report
          </Button>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-slate-900">Current export scope</p>
            <p className="mt-1 text-slate-600">
              The Excel export follows your selected report scope:{" "}
              <span className="font-semibold text-slate-900">
                {filterLabel}
              </span>
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2 min-h-[360px]">
          <SectionHeader
            icon={<BarChart3 className="w-5 h-5" />}
            iconTone="brand"
            title="Top 5 Most Frequent Lates"
            description="Employees with the highest number of late records in the current scope."
          />

          <div className="mt-6">
            {topLates.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={topLates}
                  margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                >
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
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(36,81,224,0.06)" }}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="totalLates"
                    fill="var(--color-brand-600)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={<BarChart3 className="w-6 h-6" />}
                title="No chart data yet"
                description="Upload attendance files to populate this chart."
                bordered={false}
                className="py-10"
              />
            )}
          </div>
        </Card>

        <Card>
          <SectionHeader
            icon={<Users className="w-5 h-5" />}
            iconTone="brand"
            title="Top Employees"
            description="In the current report scope."
          />

          <div className="mt-5">
            {topLates.length > 0 ? (
              <ul className="space-y-2">
                {topLates.map((employee, index) => (
                  <li
                    key={employee.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center font-semibold text-xs">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {employee.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {employee.totalMinutesLate} total late minutes
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-base font-semibold text-slate-900">
                        {employee.totalLates}
                      </p>
                      <p className="text-[11px] text-slate-500 uppercase tracking-wide">
                        lates
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No summary available"
                description="Upload attendance files to populate this list."
                bordered
              />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <SectionHeader
          icon={<FolderOpen className="w-5 h-5" />}
          iconTone="neutral"
          title="Uploaded Attendance Files"
          description="Delete one file or clear all attendance history."
          actions={
            uploadedFiles.length > 0 && (
              <Button
                variant="danger"
                size="sm"
                leftIcon={<Trash2 className="w-4 h-4" />}
                onClick={() => setConfirmState({ kind: "clear-all" })}
              >
                Clear All History
              </Button>
            )
          }
        />

        <div className="mt-5 space-y-2">
          {uploadedFiles.length === 0 ? (
            <EmptyState
              icon={<FolderOpen className="w-6 h-6" />}
              title="No uploaded attendance files yet"
              description="Drop an Excel file above to get started."
              bordered
            />
          ) : (
            uploadedFiles.map((file) => (
              <div
                key={file.id}
                className="rounded-lg border border-slate-200 bg-white p-4 flex items-center justify-between gap-4 flex-col sm:flex-row hover:border-slate-300 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {file.fileName}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Uploaded{" "}
                    {new Date(file.uploadedAt).toLocaleString("en-US")}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {file.lateRecords.length} late record(s) •{" "}
                    {file.generatedUndertimes.length} undertime record(s)
                  </p>
                </div>

                <Button
                  variant="danger"
                  size="sm"
                  leftIcon={<Trash2 className="w-4 h-4" />}
                  onClick={() =>
                    setConfirmState({
                      kind: "delete-file",
                      fileId: file.id,
                      fileName: file.fileName,
                    })
                  }
                >
                  Delete
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      {memoAlerts.length > 0 && (
        <Card className="border-warning-100 bg-warning-50/40">
          <SectionHeader
            icon={<Bell className="w-5 h-5" />}
            iconTone="warning"
            title="Penalty Reminder"
            description="Employees with 4+ lates are visible in the notification bell."
            actions={
              <Badge tone="warning">
                {unreadMemoCount} unread alert(s)
              </Badge>
            }
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-5">
            {memoAlerts.map((alert) => (
              <div
                key={alert.id}
                className="bg-white rounded-lg border border-warning-100 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-warning-50 text-warning-700 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {alert.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {alert.totalMinutesLate} total late minutes
                      </p>
                    </div>
                  </div>

                  <Badge tone="danger">{alert.totalLates} lates</Badge>
                </div>

                <p className="text-sm text-slate-600 mt-3 leading-5">
                  {alert.message}
                </p>
              </div>
            ))}
          </div>
        </Card>
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
