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
import { EmployeeAvatar } from "../components/employees/EmployeeAvatar";
import { useAuth } from "../context/AuthContext";
import { loadCrossWorkspaceExemptionWorkflowData, submitLinkedExemption } from "../services/attendanceService";
import { describeSubmitExemptionError, filterExemptionHistory, formatOptionalReportedTime, matchingLinkedLateRecords } from "../utils/exemptionForms";
import { informedPeopleForScope } from "../utils/informedPeople";
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
  const { workspace, hrScope } = useAuth();
  const {
    loading,
    exemptions,
    refreshAttendanceData,
    deleteExemptionsByMonth,
    restoreExemptionLate,
    deleteExemption,
  } = useAttendance();
  const { activeEmployees } = useEmployees();

  const [formData, setFormData] = useState({ employeeId: "", employeeName: "", reason: "", date: "", informed: [] as string[] });
  const [lateRecordId, setLateRecordId] = useState("");
  const [workflowData, setWorkflowData] = useState<{ lateRecords: LateRecord[]; exemptions: Exemption[] }>({ lateRecords: [], exemptions: [] });
  const employeeOptions = useMemo(() => [...activeEmployees].sort((a, b) => a.fullName.localeCompare(b.fullName)), [activeEmployees]);
  const informedOptions = informedPeopleForScope(hrScope);
  const selectedEmployee = useMemo(() => activeEmployees.find((employee) => employee.id === formData.employeeId), [activeEmployees, formData.employeeId]);
  const matchingLates = useMemo(() => matchingLinkedLateRecords(workflowData.lateRecords, workflowData.exemptions, selectedEmployee?.fullName ?? "", formData.date), [workflowData, formData.date, selectedEmployee?.fullName]);
  const selectedLate = matchingLates.find((item) => item.id === lateRecordId);
  const lateLabelCounts = useMemo(() => matchingLates.reduce((counts, late) => {
    const key = `${late.timeIn}|${late.minutesLate}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()), [matchingLates]);
  const refreshWorkflowData = async () => { if (workspace) setWorkflowData(await loadCrossWorkspaceExemptionWorkflowData(workspace)); };
  useEffect(() => {
    const load = async () => { await refreshWorkflowData(); };
    void load();
  }, [workspace]);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [confirmDeleteMonth, setConfirmDeleteMonth] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyYear, setHistoryYear] = useState("all");
  const [historyMonth, setHistoryMonth] = useState("all");
  const [historyStatus, setHistoryStatus] = useState<"all" | "pending" | "approved" | "declined">("all");
  const [historySort, setHistorySort] = useState<"newest" | "oldest">("newest");

  const monthOptions = useMemo(() => {
    const uniqueMonths = Array.from(
      new Set(exemptions.map((record) => getMonthKey(record.date)))
    );
    return uniqueMonths.sort((a, b) => b.localeCompare(a));
  }, [exemptions]);

  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const historyYears = useMemo(() => [...new Set(exemptions.map((record) => String(getSafeDate(record.date).getFullYear())))].sort((a, b) => b.localeCompare(a)), [exemptions]);

  const filteredExemptions = useMemo(() => filterExemptionHistory(exemptions, {
    search: historySearch,
    year: historyYear,
    month: historyMonth,
    status: historyStatus,
    sort: historySort,
  }), [exemptions, historySearch, historyYear, historyMonth, historyStatus, historySort]);
  const exemptionSummary = useMemo(() => ({
    total: filteredExemptions.length,
    approved: filteredExemptions.filter((record) => record.approvalStatus === "approved").length,
    declined: filteredExemptions.filter((record) => record.approvalStatus === "declined").length,
    pending: filteredExemptions.filter((record) => !record.approvalStatus || record.approvalStatus === "pending").length,
  }), [filteredExemptions]);

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
      await submitLinkedExemption({ employeeId: selectedEmployee.id, lateRecordId: Number(selectedLate.id), reason: formData.reason, informedParties: formData.informed });
      await refreshAttendanceData();
      await refreshWorkflowData();
      setFeedback({ type: "success", message: "Exemption submitted as Pending. The linked late remains counted until approval." });
      setSelectedMonth(getMonthKey(formData.date));
      setFormData({ employeeId: "", employeeName: "", reason: "", date: "", informed: [] });
      setLateRecordId("");
    } catch (error) {
      setFeedback({ type: "error", message: describeSubmitExemptionError(error) });
    }
  };

  const handleDeleteMonth = async () => {
    const result = await deleteExemptionsByMonth(selectedMonth);
    setFeedback({
      type: result.success ? "success" : "error",
      message: result.success ? `All exemption records for ${formatMonthLabel(selectedMonth)} were moved to Trash. Their late records are back in Late Records.` : result.message,
    });
    if (result.success) setSelectedMonth("all");
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

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const result = await deleteExemption(deleteTarget.id);
    if (!result.success) { toast.error("Delete failed", result.message); return; }
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

              <fieldset>
              <div className="space-y-2"><SearchableCombobox label="Add informed person (optional)" placeholder="Search or add a name" options={informedOptions.filter((person) => !formData.informed.includes(person)).map((person) => ({ id: person, label: person }))} onSelect={(person) => setFormData({ ...formData, informed: [...formData.informed, person.label] })} onCreateCustom={(person) => setFormData({ ...formData, informed: [...formData.informed, person] })} /><div className="flex flex-wrap gap-2">{formData.informed.map((person) => <button key={person} type="button" onClick={() => setFormData({ ...formData, informed: formData.informed.filter((value) => value !== person) })} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">{person} ×</button>)}</div></div>
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
                disabled={!lateRecordId || !formData.reason.trim()}
                fullWidth
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Submit for Approval
              </Button>
            </form>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <>
            <Card>
              <SectionHeader icon={<CalendarDays className="w-5 h-5" />} iconTone="neutral" title="Search & Filters" description="Review exemption history by employee, date, status, and order." />
              <div className="mt-4 space-y-3">
                <Input label="Search Employee" type="search" placeholder="Search employee" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Select label="Year" value={historyYear} onChange={(event) => setHistoryYear(event.target.value)}><option value="all">All Years</option>{historyYears.map((item) => <option key={item}>{item}</option>)}</Select>
                  <Select label="Month" value={historyMonth} onChange={(event) => setHistoryMonth(event.target.value)}><option value="all">All Months</option>{Array.from({ length: 12 }, (_, index) => { const value = String(index + 1).padStart(2, "0"); return <option key={value} value={value}>{new Date(2000, index, 1).toLocaleDateString("en-US", { month: "long" })}</option>; })}</Select>
                  <Select label="Status" value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value as typeof historyStatus)}><option value="all">All Statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="declined">Declined</option></Select>
                  <Select label="Sort By" value={historySort} onChange={(event) => setHistorySort(event.target.value as typeof historySort)}><option value="newest">Newest First</option><option value="oldest">Oldest First</option></Select>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Select label="Delete Month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="sm:w-52">
                    <option value="all">Select month</option>
                    {monthOptions.map((month) => <option key={month} value={month}>{formatMonthLabel(month)}</option>)}
                  </Select>
                  {selectedMonth !== "all" && <Button variant="danger" leftIcon={<Trash2 className="w-4 h-4" />} onClick={() => setConfirmDeleteMonth(true)}>Delete {formatMonthLabel(selectedMonth)}</Button>}
                </div>
              </div>
            </Card>
            <Card>
              <SectionHeader title="Exemption Summary" description={historySearch.trim() ? `Counts for employees matching “${historySearch.trim()}”.` : "Counts for the currently filtered record set."} />
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Total Requests", exemptionSummary.total], ["Approved", exemptionSummary.approved], ["Declined", exemptionSummary.declined], ["Pending", exemptionSummary.pending]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold text-slate-900">{value}</p></div>)}</div>
            </Card>
          <div className="px-1"><SectionHeader title="Saved Exemption Records" description={`${filteredExemptions.length} record${filteredExemptions.length === 1 ? "" : "s"} match the current filters.`} /></div>

          {loading ? (
            <Card padded={false}>
              <SkeletonTable rows={4} columns={4} />
            </Card>
          ) : filteredExemptions.length === 0 ? (
            <Card>
              <EmptyState
                icon={<ShieldCheck className="w-6 h-6" />}
                title={
                  "No exemptions found"
                }
                description={
                  "Use the form on the left to submit an exemption for approval."
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
              </p>

              <ul className="space-y-2">
                {filteredExemptions.map((record) => {
                  const recordDate = getSafeDate(record.date);
                  const reportedTime = formatOptionalReportedTime(record.time);
                  const informedPeople = Array.isArray(record.informed)
                    ? record.informed.filter((person) => typeof person === "string" && person.trim())
                    : [];

                  return (
                    <li
                      key={record.id}
                      className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors relative overflow-hidden"
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-500" />
                      <div className="flex items-start gap-4 pl-2">
                        <EmployeeAvatar name={record.name} />

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
                          {(reportedTime || informedPeople.length > 0) && <p className="mt-2 text-xs text-slate-500">{reportedTime ? `Time: ${reportedTime}` : ""}{reportedTime && informedPeople.length > 0 ? " • " : ""}{informedPeople.length > 0 ? `Informed: ${informedPeople.join(", ")}` : ""}</p>}
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
          </>
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
