import { useMemo, useState } from "react";
import { useAttendance } from "../context/AttendanceContext";
import {
  Clock3,
  Plus,
  CalendarDays,
  Timer,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
  Textarea,
  EmptyState,
  AlertMessage,
  ConfirmModal,
  SectionHeader,
  SkeletonTable,
} from "../components/ui";

function getMonthKey(dateValue: string) {
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

type RestoreTarget = { id: string; name: string; date: string } | null;

export function Undertime() {
  const {
    loading,
    generatedUndertimes,
    manualUndertimes,
    addUndertime,
    deleteManualUndertimesByMonth,
    removeManualUndertimeAdjustment,
  } = useAttendance();

  const [activeTab, setActiveTab] = useState<"system" | "manual">("manual");
  const [employeeName, setEmployeeName] = useState("");
  const [date, setDate] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [period, setPeriod] = useState("AM");
  const [reason, setReason] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [confirmDeleteMonth, setConfirmDeleteMonth] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget>(null);

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    manualUndertimes.forEach((record) => {
      months.add(getMonthKey(record.date));
    });
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [manualUndertimes]);

  const filteredManualUndertimes = useMemo(() => {
    const filtered =
      selectedMonth === "all"
        ? manualUndertimes
        : manualUndertimes.filter(
            (record) => getMonthKey(record.date) === selectedMonth
          );

    return [...filtered].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [manualUndertimes, selectedMonth]);

  const handleSave = () => {
    if (
      !employeeName.trim() ||
      !date ||
      !fromTime.trim() ||
      !toTime.trim() ||
      !reason.trim()
    ) {
      setFeedback({
        type: "error",
        message: "Please complete all manual undertime fields.",
      });
      return;
    }

    const undertimeHours = `${fromTime} to ${toTime} ${period}`;

    const result = addUndertime({
      name: employeeName.trim(),
      date,
      reason: reason.trim(),
      undertimeHours,
    });

    setFeedback({
      type: result.success ? "success" : "error",
      message: result.message,
    });

    if (result.success) {
      setEmployeeName("");
      setDate("");
      setFromTime("");
      setToTime("");
      setPeriod("AM");
      setReason("");
      setSelectedMonth(getMonthKey(date));
    }
  };

  const handleDeleteMonth = () => {
    deleteManualUndertimesByMonth(selectedMonth);
    setFeedback({
      type: "success",
      message: `All manual undertime records for ${formatMonthLabel(
        selectedMonth
      )} were moved to Trash. Their late records are back in Late Records.`,
    });
    setSelectedMonth("all");
    setConfirmDeleteMonth(false);
  };

  const handleRestoreConfirm = () => {
    if (!restoreTarget) return;
    removeManualUndertimeAdjustment(restoreTarget.id);
    setFeedback({
      type: "success",
      message: `${restoreTarget.name}'s late on ${new Date(
        restoreTarget.date
      ).toLocaleDateString(
        "en-US"
      )} is back in Late Records. The undertime row was moved to Trash and can be restored from Recycle Bin.`,
    });
    setRestoreTarget(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Undertime Records"
        description="View system-detected undertime and add manual undertime adjustments."
        actions={
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("system")}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "system"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              System Generated
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("manual")}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "manual"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Manual Entry
            </button>
          </div>
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

      {activeTab === "system" ? (
        <Card>
          <SectionHeader
            icon={<Timer className="w-5 h-5" />}
            iconTone="brand"
            title="System Generated Undertime"
            description="Auto-detected from uploaded attendance files."
          />

          <div className="mt-5">
            {loading ? (
              <SkeletonTable rows={4} columns={3} />
            ) : generatedUndertimes.length === 0 ? (
              <EmptyState
                icon={<Timer className="w-6 h-6" />}
                title="No undertime detected"
                description="Records will appear automatically when uploaded attendance files indicate undertime."
                bordered
              />
            ) : (
              <ul className="space-y-2">
                {generatedUndertimes.map((record) => (
                  <li
                    key={record.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors"
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {record.name}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {record.date} • {record.timeIn}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Source: {record.sourceFileName}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6">
          <Card>
            <SectionHeader
              icon={<Clock3 className="w-5 h-5" />}
              iconTone="brand"
              title="Add Undertime"
              description="Record an approved manual adjustment."
            />

            <div className="space-y-4 mt-5">
              <Input
                label="Employee Name"
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                placeholder="e.g. Dela Cruz, Juan"
              />

              <Input
                label="Date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />

              <div>
                <p className="text-sm font-medium text-slate-700 mb-1.5">
                  Undertime Hours
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={fromTime}
                    onChange={(e) => setFromTime(e.target.value)}
                    placeholder="From"
                  />
                  <Input
                    value={toTime}
                    onChange={(e) => setToTime(e.target.value)}
                    placeholder="To"
                  />
                </div>
              </div>

              <Select
                label="Period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </Select>

              <Textarea
                label="Reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Official reason for undertime..."
                rows={4}
              />

              <Button
                variant="primary"
                fullWidth
                leftIcon={<Plus className="w-4 h-4" />}
                onClick={handleSave}
              >
                Save Entry
              </Button>
            </div>
          </Card>

          <Card>
            <SectionHeader
              icon={<CalendarDays className="w-5 h-5" />}
              iconTone="neutral"
              title="Manual Undertime Records"
              description="View and manage manual undertime by month."
              actions={
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <Select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="sm:w-52"
                  >
                    <option value="all">All Months</option>
                    {monthOptions.map((month) => (
                      <option key={month} value={month}>
                        {formatMonthLabel(month)}
                      </option>
                    ))}
                  </Select>

                  {selectedMonth !== "all" && (
                    <Button
                      variant="danger"
                      leftIcon={<Trash2 className="w-4 h-4" />}
                      onClick={() => setConfirmDeleteMonth(true)}
                    >
                      Delete Month
                    </Button>
                  )}
                </div>
              }
            />

            <div className="mt-5">
              {loading ? (
                <SkeletonTable rows={4} columns={3} />
              ) : filteredManualUndertimes.length === 0 ? (
                <EmptyState
                  icon={<Timer className="w-6 h-6" />}
                  title={
                    selectedMonth === "all"
                      ? "No manual undertime entries"
                      : `No entries for ${formatMonthLabel(selectedMonth)}`
                  }
                  description="Use the form on the left to add an approved manual undertime."
                  bordered
                />
              ) : (
                <ul className="space-y-2">
                  {filteredManualUndertimes.map((record) => (
                    <li
                      key={record.id}
                      className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">
                            {record.name}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {record.date}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Hours: {record.undertimeHours}
                          </p>
                        </div>

                        <div className="flex flex-col items-start sm:items-end gap-2 flex-shrink-0">
                          <p className="text-sm text-slate-600 max-w-sm">
                            {record.reason}
                          </p>
                          <Button
                            variant="warning"
                            size="sm"
                            leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                            onClick={() =>
                              setRestoreTarget({
                                id: record.id,
                                name: record.name,
                                date: record.date,
                              })
                            }
                          >
                            Restore
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      )}

      <ConfirmModal
        open={confirmDeleteMonth}
        tone="danger"
        title={`Move manual undertime for ${formatMonthLabel(selectedMonth)} to Trash?`}
        description="The manual undertime rows for this month will be moved to Trash, and their underlying late records will reappear in Late Records. You can restore the undertime entries later from the Recycle Bin."
        confirmLabel="Move to Trash"
        onConfirm={handleDeleteMonth}
        onCancel={() => setConfirmDeleteMonth(false)}
      />

      <ConfirmModal
        open={!!restoreTarget}
        tone="warning"
        title="Restore this late record?"
        description={
          restoreTarget ? (
            <>
              <span className="font-semibold">{restoreTarget.name}</span> on{" "}
              {new Date(restoreTarget.date).toLocaleDateString("en-US")} will be
              moved back to Late Records. The manual undertime row will be
              moved to Trash and can be restored from the Recycle Bin.
            </>
          ) : null
        }
        confirmLabel="Restore Late"
        onConfirm={handleRestoreConfirm}
        onCancel={() => setRestoreTarget(null)}
      />
    </div>
  );
}
