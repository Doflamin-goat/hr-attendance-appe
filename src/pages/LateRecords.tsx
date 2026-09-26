import { useMemo, useState } from "react";
import {
  Clock,
  Search,
  X,
  FileSpreadsheet,
  Plus,
  Trash2,
} from "lucide-react";
import { useAttendance, type LateRecord } from "../context/AttendanceContext";
import { useEmployees } from "../context/EmployeesContext";
import { EmployeeAvatar } from "../components/employees/EmployeeAvatar";
import { computeManualLate } from "../utils/manualLate";
import {
  PageHeader,
  Card,
  Button,
  Badge,
  Input,
  Select,
  SearchableCombobox,
  AlertMessage,
  ConfirmModal,
  DataTable,
  EmptyState,
  SkeletonTable,
  toast,
  type Column,
} from "../components/ui";

function getDefaultUndertimeStart(dateValue: string) {
  const day = new Date(dateValue).getDay();
  return day === 6 ? "7:00 AM" : "8:00 AM";
}

function getDefaultUndertimeRange(record: LateRecord) {
  return `${getDefaultUndertimeStart(record.date)} to ${record.timeIn}`;
}

export function LateRecords() {
  const {
    loading,
    lateRecords,
    lateSummary,
    convertLateToUndertime,
    addManualLate,
    deleteManualLate,
  } = useAttendance();
  const { activeEmployees } = useEmployees();

  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"detailed" | "summary">("detailed");
  const [selectedLateRecord, setSelectedLateRecord] = useState<LateRecord | null>(
    null
  );
  const [manualFromTime, setManualFromTime] = useState("");
  const [manualToTime, setManualToTime] = useState("");
  const [manualPeriod, setManualPeriod] = useState("AM");
  const [conversionReason, setConversionReason] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Delete-manual-late confirmation state
  const [deleteTarget, setDeleteTarget] = useState<LateRecord | null>(null);

  // Add Manual Late modal state
  const [isManualLateOpen, setIsManualLateOpen] = useState(false);
  const [mlName, setMlName] = useState("");
  const [mlEmployeeId, setMlEmployeeId] = useState("");
  const [mlDate, setMlDate] = useState("");
  const [mlTimeIn, setMlTimeIn] = useState("");
  const [mlOfficialStart, setMlOfficialStart] = useState("08:00");
  const [mlGrace, setMlGrace] = useState("6");
  const [mlReason, setMlReason] = useState("");
  const [mlFeedback, setMlFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [mlSaving, setMlSaving] = useState(false);

  const manualLatePreview = useMemo(() => {
    const grace = Number.parseInt(mlGrace, 10);
    if (!mlTimeIn.trim() || !mlOfficialStart.trim() || Number.isNaN(grace)) {
      return null;
    }
    return computeManualLate({
      timeIn: mlTimeIn,
      officialStartTime: mlOfficialStart,
      graceMinutes: grace,
    });
  }, [mlTimeIn, mlOfficialStart, mlGrace]);

  const filteredRecords = useMemo(
    () =>
      lateRecords.filter((r) =>
        r.name.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [lateRecords, searchTerm]
  );

  const filteredSummary = useMemo(
    () =>
      lateSummary.filter((s) =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [lateSummary, searchTerm]
  );

  const resetModal = () => {
    setSelectedLateRecord(null);
    setManualFromTime("");
    setManualToTime("");
    setManualPeriod("AM");
    setConversionReason("");
  };

  const openUndertimeModal = (record: LateRecord) => {
    setSelectedLateRecord(record);
    setManualFromTime("");
    setManualToTime("");
    setManualPeriod("AM");
    setConversionReason("");
    setFeedback(null);
  };

  const handleConfirmUndertime = async () => {
    if (!selectedLateRecord) return;

    const hasManualInput = manualFromTime.trim() || manualToTime.trim();

    if (hasManualInput && (!manualFromTime.trim() || !manualToTime.trim())) {
      setFeedback({
        type: "error",
        message: "Please complete both From and To fields for manual override.",
      });
      return;
    }

    const undertimeHours = hasManualInput
      ? `${manualFromTime.trim()} to ${manualToTime.trim()} ${manualPeriod}`
      : getDefaultUndertimeRange(selectedLateRecord);

    const result = await convertLateToUndertime({
      lateRecordId: selectedLateRecord.id,
      undertimeHours,
      isManualOverride: Boolean(hasManualInput),
      reason: conversionReason.trim(),
    });

    setFeedback({
      type: result.success ? "success" : "error",
      message: result.message,
    });

    if (result.success) resetModal();
  };

  const detailedColumns: Column<LateRecord>[] = [
    {
      key: "name",
      header: "Employee",
      render: (record) => (
        <div className="flex items-center gap-3 min-w-0">
          <EmployeeAvatar name={record.name} />
          <span className="font-medium text-slate-900 truncate">
            {record.name}
          </span>
        </div>
      ),
    },
    {
      key: "date",
      header: "Date",
      render: (record) => (
        <span className="text-slate-600 text-sm">{record.date}</span>
      ),
    },
    {
      key: "timeIn",
      header: "Time In",
      render: (record) => (
        <span className="text-slate-600 text-sm">{record.timeIn}</span>
      ),
    },
    {
      key: "source",
      header: "Source",
      render: (record) =>
        record.sourceType === "manual-entry" ? (
          <Badge tone="brand">Manual Entry</Badge>
        ) : (
          <Badge tone="neutral">Excel Upload</Badge>
        ),
    },
    {
      key: "lateBy",
      header: "Late By",
      align: "right",
      render: (record) => (
        <Badge tone="warning" icon={<Clock className="w-3 h-3" />}>
          {record.minutesLate > 0
            ? `${record.minutesLate} min ${record.secondsLate} sec`
            : `${record.secondsLate} sec`}
        </Badge>
      ),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (record) =>
        record.sourceType === "manual-entry" ? (
          <Button
            variant="danger"
            size="sm"
            leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            onClick={() => setDeleteTarget(record)}
          >
            Delete
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openUndertimeModal(record)}
          >
            Mark as Undertime
          </Button>
        ),
    },
  ];

  const handleConfirmDeleteManualLate = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const result = await deleteManualLate(target.id);
    if (!result.success) { toast.error("Delete failed", result.message); return; }
    setDeleteTarget(null);
    toast.success(
      "Manual late moved to Trash",
      `${target.name} on ${target.date} at ${target.timeIn} was moved to the Recycle Bin.`
    );
  };

  const resetManualLateForm = () => {
    setMlName("");
    setMlEmployeeId("");
    setMlDate("");
    setMlTimeIn("");
    setMlOfficialStart("08:00");
    setMlGrace("6");
    setMlReason("");
    setMlFeedback(null);
    if (!mlEmployeeId) {
      setMlFeedback({ type: "error", message: "Choose an active employee from the list." });
      return;
    }
  };

  const closeManualLateModal = () => {
    setIsManualLateOpen(false);
    resetManualLateForm();
  };

  const handleSaveManualLate = async () => {
    setMlFeedback(null);
    const grace = Number.parseInt(mlGrace, 10);

    setMlSaving(true);
    const result = await addManualLate({
      name: mlName,
      workDate: mlDate,
      timeIn: mlTimeIn,
      officialStartTime: mlOfficialStart,
      graceMinutes: Number.isFinite(grace) ? grace : 6,
      reason: mlReason,
    });
    setMlSaving(false);

    if (result.success) {
      toast.success("Manual late saved", result.message);
      closeManualLateModal();
    } else {
      setMlFeedback({ type: "error", message: result.message });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Late Arrivals"
        description="Detailed breakdown of late clock-ins based on shift rules."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("detailed")}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  activeTab === "detailed"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Detailed
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("summary")}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  activeTab === "summary"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Summary
              </button>
            </div>

            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="w-4 h-4" />}
              onClick={() => {
                resetManualLateForm();
                setIsManualLateOpen(true);
              }}
            >
              Add Manual Late
            </Button>
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

      <Card padded={false}>
        <div className="border-b border-slate-200 px-4 py-3 bg-slate-50/50">
          <div className="max-w-md">
            <Input
              type="search"
              placeholder="Search by employee name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
            />
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={6} columns={6} />
        ) : activeTab === "detailed" ? (
          <DataTable
            columns={detailedColumns}
            rows={filteredRecords}
            rowKey={(r) => r.id}
            emptyTitle={
              searchTerm ? "No matching late records" : "No late records found"
            }
            emptyDescription={
              searchTerm
                ? "Try a different employee name or clear the search."
                : "Upload a daily attendance Excel file from the dashboard to populate this view."
            }
            emptyIcon={<Clock className="w-6 h-6" />}
          />
        ) : filteredSummary.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
            {filteredSummary.map((item) => (
              <div
                key={item.name}
                className="bg-white rounded-lg border border-slate-200 p-4 hover:border-slate-300 hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)] transition-all duration-200"
              >
                <div className="flex justify-between items-start mb-3">
                  <EmployeeAvatar name={item.name} />
                  <Badge tone="danger">{item.totalLates} lates</Badge>
                </div>
                <h3 className="font-semibold text-slate-900 truncate">
                  {item.name}
                </h3>
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-sm">
                  <span className="text-slate-500">Total time lost</span>
                  <span className="font-semibold text-slate-900">
                    {item.totalMinutesLate} mins
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FileSpreadsheet className="w-6 h-6" />}
            title={searchTerm ? "No matching summary" : "No summary available"}
            description={
              searchTerm
                ? "Try a different employee name or clear the search."
                : "Upload a valid attendance file to generate the summary."
            }
            bordered={false}
            className="py-16"
          />
        )}
      </Card>

      <ConfirmModal
        open={!!deleteTarget}
        tone="danger"
        title="Move this manual late record to Trash?"
        description={
          deleteTarget ? (
            <>
              <span className="font-semibold">{deleteTarget.name}</span> on{" "}
              {deleteTarget.date} at {deleteTarget.timeIn} will be soft-deleted.
              You can restore it from the Recycle Bin. This does not affect
              Excel-uploaded records or other HR records.
            </>
          ) : null
        }
        confirmLabel="Move to Trash"
        onConfirm={handleConfirmDeleteManualLate}
        onCancel={() => setDeleteTarget(null)}
      />

      {isManualLateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Add Manual Late Record
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  Log an HR-verified late arrival. It will show up alongside
                  Excel-uploaded lates in this list.
                </p>
              </div>
              <button
                type="button"
                onClick={closeManualLateModal}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {mlFeedback && (
                <AlertMessage
                  tone={mlFeedback.type}
                  message={mlFeedback.message}
                  onDismiss={() => setMlFeedback(null)}
                />
              )}

              <SearchableCombobox label="Employee" required value={mlName} placeholder="Search active employees" options={activeEmployees.map((employee) => ({ id: employee.id, label: employee.fullName }))} onClear={() => { setMlEmployeeId(""); setMlName(""); }} onSelect={(employee) => { setMlEmployeeId(employee.id); setMlName(employee.label); }} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Date"
                  type="date"
                  value={mlDate}
                  onChange={(e) => setMlDate(e.target.value)}
                />
                <Input
                  label="Time In"
                  value={mlTimeIn}
                  onChange={(e) => setMlTimeIn(e.target.value)}
                  placeholder="e.g. 8:11:01 AM"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Official Start Time"
                  type="time"
                  value={mlOfficialStart}
                  onChange={(e) => setMlOfficialStart(e.target.value)}
                />
                <Input
                  label="Grace Minutes"
                  type="number"
                  min={0}
                  value={mlGrace}
                  onChange={(e) => setMlGrace(e.target.value)}
                />
              </div>

              <Input
                label="Reason / Remarks (optional)"
                value={mlReason}
                onChange={(e) => setMlReason(e.target.value)}
                placeholder="e.g. Missed biometric scan; verified by supervisor"
              />

              {manualLatePreview && (
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    manualLatePreview.isLate
                      ? "border-warning-100 bg-warning-50 text-warning-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                >
                  {manualLatePreview.isLate ? (
                    <span>
                      <span className="font-semibold">
                        Late by {manualLatePreview.minutesLate} min{" "}
                        {manualLatePreview.secondsLate} sec.
                      </span>{" "}
                      Late threshold: {manualLatePreview.lateStartTime}.
                    </span>
                  ) : (
                    <span>
                      This time-in is at or before the late threshold (
                      {manualLatePreview.lateStartTime}). Not a late arrival.
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-3 bg-slate-50">
              <Button variant="secondary" onClick={closeManualLateModal}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={mlSaving}
                onClick={handleSaveManualLate}
              >
                Save Manual Late
              </Button>
            </div>
          </div>
        </div>
      )}

      {selectedLateRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Convert Late Record to Undertime
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  Moves this record from Late Records to Undertime.
                </p>
              </div>
              <button
                type="button"
                onClick={resetModal}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">
                  {selectedLateRecord.name}
                </p>
                <p className="text-sm text-slate-600 mt-0.5">
                  {selectedLateRecord.date} • {selectedLateRecord.timeIn}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700 mb-1.5">
                  Suggested Undertime Range
                </p>
                <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700">
                  {getDefaultUndertimeRange(selectedLateRecord)}
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Mon–Fri starts 8:00 AM. Saturday starts 7:00 AM.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium text-slate-700 mb-2">
                  Manual Override (optional)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px] gap-2">
                  <Input
                    value={manualFromTime}
                    onChange={(e) => setManualFromTime(e.target.value)}
                    placeholder="From (e.g. 8:00)"
                  />
                  <Input
                    value={manualToTime}
                    onChange={(e) => setManualToTime(e.target.value)}
                    placeholder="To (e.g. 10:44:38)"
                  />
                  <Select
                    value={manualPeriod}
                    onChange={(e) => setManualPeriod(e.target.value)}
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </Select>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Leave blank to use the system-generated range.
                </p>
              </div>

              <Input
                label="Reason (optional)"
                value={conversionReason}
                onChange={(e) => setConversionReason(e.target.value)}
                placeholder="e.g. Approved undertime conversion"
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-3 bg-slate-50">
              <Button variant="secondary" onClick={resetModal}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleConfirmUndertime}>
                Confirm Undertime
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
