import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  Plus,
  CalendarDays,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { useAttendance, type Exemption, type LateRecord } from "../context/AttendanceContext";
import { useEmployees } from "../context/EmployeesContext";
import { loadCrossWorkspaceExemptionWorkflowData, submitLinkedExemption } from "../services/attendanceService";
import { describeSubmitExemptionError, formatOptionalReportedTime, matchingLinkedLateRecords } from "../utils/exemptionForms";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
  SearchableCombobox,
  Textarea,
  Badge,
  EmptyState,
  AlertMessage,
  ConfirmModal,
  SectionHeader,
  SkeletonTable,
  toast,
} from "../components/ui";

function getSafeDate(dateValue: string) {
  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime())
    ? new Date(`${dateValue}T00:00:00`)
    : parsed;
}

function getMonthKey(dateValue: string) {
  const date = getSafeDate(dateValue);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

type RestoreTarget = { id: string; name: string; date: string } | null;
type DeleteTarget = { id: string; name: string; date: string } | null;

export function Exemptions() {
  const {
    loading,
    exemptions,
    refreshAttendanceData,
    deleteExemptionsByMonth,
    restoreExemptionLate,
    deleteExemption,
  } = useAttendance();
  const { activeEmployees } = useEmployees();

  const [formData, setFormData] = useState({ employeeId: "", employeeName: "", reason: "", date: "", time: "", informed: [] as string[] });
  const [lateRecordId, setLateRecordId] = useState("");
  const [workflowData, setWorkflowData] = useState<{ lateRecords: LateRecord[]; exemptions: Exemption[] }>({ lateRecords: [], exemptions: [] });
  const employeeOptions = useMemo(() => [...activeEmployees].sort((a, b) => a.fullName.localeCompare(b.fullName)), [activeEmployees]);
  const informedOptions = ["Sir Gatch", "Ma’am Chona", "HR Louissa"];
  const selectedEmployee = useMemo(() => activeEmployees.find((employee) => employee.id === formData.employeeId), [activeEmployees, formData.employeeId]);
  const matchingLates = useMemo(() => matchingLinkedLateRecords(workflowData.lateRecords, workflowData.exemptions, selectedEmployee?.fullName ?? "", formData.date), [workflowData, formData.date, selectedEmployee?.fullName]);
  const selectedLate = matchingLates.find((item) => item.id === lateRecordId);
  const lateLabelCounts = useMemo(() => matchingLates.reduce((counts, late) => {
    const key = `${late.timeIn}|${late.minutesLate}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()), [matchingLates]);
  const refreshWorkflowData = async () => setWorkflowData(await loadCrossWorkspaceExemptionWorkflowData());
  useEffect(() => {
    const load = async () => { await refreshWorkflowData(); };
    void load();
  }, []);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [confirmDeleteMonth, setConfirmDeleteMonth] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const monthOptions = useMemo(() => {
    const uniqueMonths = Array.from(
      new Set(exemptions.map((record) => getMonthKey(record.date)))
    );
    return uniqueMonths.sort((a, b) => b.localeCompare(a));
  }, [exemptions]);

  const [selectedMonth, setSelectedMonth] = useState<string>("all");

  const filteredExemptions = useMemo(() => {
    const filtered =
      selectedMonth === "all"
        ? exemptions
        : exemptions.filter(
            (record) => getMonthKey(record.date) === selectedMonth
          );

    return [...filtered].sort(
      (a, b) => getSafeDate(b.date).getTime() - getSafeDate(a.date).getTime()
    );
  }, [exemptions, selectedMonth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!formData.employeeId || !formData.reason || !formData.date) {
      setFeedback({
        type: "error",
        message: "Please complete employee name, date, and reason.",
      });
      return;
    }

    if (!selectedEmployee || !selectedLate || !Number.isSafeInteger(Number(selectedLate.id))) {
      setFeedback({ type: "error", message: "Choose an eligible late record before submitting." });
      return;
    }
    try {
      await submitLinkedExemption({ employeeId: selectedEmployee.id, lateRecordId: Number(selectedLate.id), reason: formData.reason, reportedTime: formData.time || undefined, informedParties: formData.informed });
      await refreshAttendanceData();
      await refreshWorkflowData();
      setFeedback({ type: "success", message: "Exemption submitted as Pending. The linked late remains counted until approval." });
      setSelectedMonth(getMonthKey(formData.date));
      setFormData({ employeeId: "", employeeName: "", reason: "", date: "", time: "", informed: [] });
      setLateRecordId("");
    } catch (error) {
      setFeedback({ type: "error", message: describeSubmitExemptionError(error) });
    }
  };

  const handleDeleteMonth = () => {
    deleteExemptionsByMonth(selectedMonth);
    setFeedback({
      type: "success",
      message: `All exemption records for ${formatMonthLabel(
        selectedMonth
      )} were moved to Trash. Their late records are back in Late Records.`,
    });
    setSelectedMonth("all");
    setConfirmDeleteMonth(false);
  };

  const handleRestoreConfirm = async () => {
    if (!restoreTarget) return;
    try {
      await restoreExemptionLate(restoreTarget.id);
      await refreshWorkflowData();
      setFeedback({ type: "success", message: `${restoreTarget.name}'s exact linked late is counted in Late Records again. The approved exemption remains in history.` });
      setRestoreTarget(null);
    } catch { setFeedback({ type: "error", message: "Could not restore the linked late record." }); }
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    deleteExemption(deleteTarget.id);
    setDeleteTarget(null);
    toast.success("Record moved to Trash.");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Late Exemptions"
        description="Submit a linked late exemption for Admin review. Pending requests leave the late counted."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card className="lg:sticky lg:top-24">
            <SectionHeader
              icon={<ShieldCheck className="w-5 h-5" />}
              iconTone="brand"
              title="Add Exemption"
              description="Choose an active employee, supply the attendance details, then submit for review."
            />

            {feedback && (
              <div className="mt-4">
                <AlertMessage
                  tone={feedback.type}
                  message={feedback.message}
                  onDismiss={() => setFeedback(null)}
                />
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 mt-5">
              <SearchableCombobox label="Employee Name" required value={formData.employeeName} placeholder="Search active employees" options={employeeOptions.map((employee) => ({ id: employee.id, label: employee.fullName }))} onClear={() => { if (formData.employeeId) setFormData({ ...formData, employeeId: "", employeeName: "" }); setLateRecordId(""); }} onSelect={(employee) => { setFormData({ ...formData, employeeId: employee.id, employeeName: employee.label }); setLateRecordId(""); }} />

              <Input
                label="Date"
                type="date"
                required
                value={formData.date}
                onChange={(e) => { setFormData({ ...formData, date: e.target.value }); setLateRecordId(""); }}
              />

              <Select label="Matching Late Record" required value={lateRecordId} disabled={!formData.employeeId || !formData.date || matchingLates.length === 0} onChange={(event) => setLateRecordId(event.target.value)} hint="Choose the exact late arrival to exempt."><option value="">{matchingLates.length === 0 ? "No eligible late record" : "Select matching late"}</option>{matchingLates.map((late) => { const key = `${late.timeIn}|${late.minutesLate}`; return <option key={late.id} value={late.id}>{late.timeIn ?? "Recorded late"} — {late.minutesLate ?? 0} minutes late{(lateLabelCounts.get(key) ?? 0) > 1 ? ` • Record ${late.id}` : ""}</option>; })}</Select>
              {formData.employeeName && formData.date && matchingLates.length === 0 && <p className="-mt-2 text-xs text-slate-500">No active, unlinked uploaded late record matches this employee and date.</p>}

              <Input label="Time (optional)" type="time" value={formData.time} onChange={(e) => setFormData({ ...formData, time: e.target.value })} />

              <fieldset>
                <legend className="text-sm font-medium text-slate-700">Who was informed</legend>
                <div className="mt-2 space-y-2"><SearchableCombobox label="Informed to" placeholder="Search or add a name" options={informedOptions.filter((person) => !formData.informed.includes(person)).map((person) => ({ id: person, label: person }))} onSelect={(person) => setFormData({ ...formData, informed: [...formData.informed, person.label] })} onCreateCustom={(person) => setFormData({ ...formData, informed: [...formData.informed, person] })} /><div className="flex flex-wrap gap-2">{formData.informed.map((person) => <button key={person} type="button" onClick={() => setFormData({ ...formData, informed: formData.informed.filter((value) => value !== person) })} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">{person} ×</button>)}</div></div>
              </fieldset>

              <Textarea
                label="Reason"
                required
                rows={3}
                placeholder="Official reason for exemption..."
                value={formData.reason}
                onChange={(e) =>
                  setFormData({ ...formData, reason: e.target.value })
                }
              />

              <Button
                type="submit"
                variant="primary"
                disabled={!lateRecordId || !formData.reason.trim() || formData.informed.length === 0}
                fullWidth
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Submit for Approval
              </Button>
            </form>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <Card>
            <SectionHeader
              icon={<CalendarDays className="w-5 h-5" />}
              iconTone="neutral"
              title="Month Filter"
              description="View and manage exemptions by month."
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
          </Card>

          {loading ? (
            <Card padded={false}>
              <SkeletonTable rows={4} columns={4} />
            </Card>
          ) : filteredExemptions.length === 0 ? (
            <Card>
              <EmptyState
                icon={<ShieldCheck className="w-6 h-6" />}
                title={
                  selectedMonth === "all"
                    ? "No exemptions found"
                    : `No exemptions for ${formatMonthLabel(selectedMonth)}`
                }
                description={
                  selectedMonth === "all"
                    ? "Use the form on the left to submit an exemption for approval."
                    : "Switch the filter or add an exemption from the form on the left."
                }
                bordered={false}
              />
            </Card>
          ) : (
            <>
              <p className="text-sm text-slate-500 px-1">
                Showing{" "}
                <span className="font-semibold text-slate-900">
                  {filteredExemptions.length}
                </span>{" "}
                record(s)
                {selectedMonth !== "all" && (
                  <>
                    {" "}for{" "}
                    <span className="font-semibold text-slate-900">
                      {formatMonthLabel(selectedMonth)}
                    </span>
                  </>
                )}
              </p>

              <ul className="space-y-2">
                {filteredExemptions.map((record) => {
                  const recordDate = getSafeDate(record.date);
                  const reportedTime = formatOptionalReportedTime(record.time);
                  const informedPeople = Array.isArray(record.informed)
                    ? record.informed.filter((person) => typeof person === "string" && person.trim())
                    : [];
                  const hasOptionalDetails = Boolean(reportedTime || informedPeople.length > 0);

                  return (
                    <li
                      key={record.id}
                      className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors relative overflow-hidden"
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-500" />
                      <div className="flex items-start gap-4 pl-2">
                        <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-700 border border-brand-100 flex items-center justify-center font-semibold text-xs uppercase flex-shrink-0">
                          {record.name.substring(0, 2)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="text-sm font-semibold text-slate-900 truncate">
                                {record.name}
                              </h3>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {recordDate.toLocaleDateString("en-US")}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                              <Badge tone={record.approvalStatus === "approved" ? "success" : record.approvalStatus === "declined" ? "danger" : "warning"}>{record.approvalStatus === "approved" ? "Approved" : record.approvalStatus === "declined" ? "Declined" : "Pending"}</Badge>
                              {record.approvalStatus === "approved" && !record.lateRestoredAt && <Button
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
                                Restore Late Record
                              </Button>}
                              <Button
                                variant="danger"
                                size="sm"
                                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                                onClick={() =>
                                  setDeleteTarget({
                                    id: record.id,
                                    name: record.name,
                                    date: record.date,
                                  })
                                }
                              >
                                Delete
                              </Button>
                            </div>
                          </div>

                          <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-sm text-slate-700 leading-5">
                            <span className="font-medium text-slate-900">
                              Reason:
                            </span>{" "}
                            {record.reason}
                          </div>
                          <p className="mt-2 text-xs text-slate-500">Linked late: {record.lateTime || "Not recorded"} • {record.minutesLate ?? 0} minute(s)</p>
                          {hasOptionalDetails && <p className="mt-2 text-xs text-slate-500">{reportedTime ? `Time: ${reportedTime}` : ""}{reportedTime && informedPeople.length > 0 ? " • " : ""}{informedPeople.length > 0 ? `Informed: ${informedPeople.join(", ")}` : ""}</p>}
                          {record.reviewedAt && <p className="mt-2 text-xs text-slate-500">Reviewer: {record.reviewedBy ? "Admin" : "Not recorded"} • Reviewed: {new Date(record.reviewedAt).toLocaleString()} • Remarks: {record.reviewRemarks || "None"}</p>}
                          {record.lateRestoredAt && <p className="mt-2 text-xs font-medium text-warning-700">Late Record Restored • {new Date(record.lateRestoredAt).toLocaleString()}</p>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmDeleteMonth}
        tone="danger"
        title={`Move exemptions for ${formatMonthLabel(selectedMonth)} to Trash?`}
        description="The exemption rows for this month will be moved to Trash, and their underlying late records will reappear in Late Records. You can restore the exemptions later from the Recycle Bin."
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
              counted in Late Records again. The approved exemption remains in Approval History.
            </>
          ) : null
        }
        confirmLabel="Restore Late"
        onConfirm={() => void handleRestoreConfirm()}
        onCancel={() => setRestoreTarget(null)}
      />

      <ConfirmModal
        open={!!deleteTarget}
        tone="danger"
        title="Move this record to Trash?"
        description="This will only remove this selected HR record. It will not affect uploaded files, Late Records, or other HR records."
        confirmLabel="Move to Trash"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
