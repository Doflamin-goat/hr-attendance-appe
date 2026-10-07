import { useMemo, useState } from "react";
import { Eye, Save } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { Employee } from "../../services/employeeService";
import { cancelPendingLeaveRequest, removeLeaveRequest, setEmployeeRemainingLeave, type EmployeeLeaveAdjustment, type LeaveRequest } from "../../services/leaveService";
import { adjustmentPartsToMinutes, ANNUAL_LEAVE_ENTITLEMENT_MINUTES, calculateAnnualLeaveTotals, countRejectedLeaveRequests, formatLeaveDate, formatLeaveMinutes, formatRemainingLeaveMinutes, formatLeaveRequestDuration, formatLeaveStatus, formatLeaveTime, LEAVE_WORKDAY_MINUTES } from "../../utils/leaveRules";
import { AlertMessage, Badge, Button, Card, EmptyState, Input, SectionHeader, Select } from "../ui";
import { EmployeeAvatar } from "../employees/EmployeeAvatar";
import { EmployeeFilterCombobox } from "../employees/EmployeeFilterCombobox";
import { dateFilterDates, dateFilterMonths, matchesDateFilters } from "../../utils/attendanceForms";

type Props = {
  employees: Employee[];
  requests: LeaveRequest[];
  adjustments: EmployeeLeaveAdjustment[];
  year: string;
  onYearChange: (year: string) => void;
  canEditAdjustments?: boolean;
  onAdjustmentSaved?: () => Promise<void>;
  showRejectedRequests?: boolean;
};

type Draft = { days: string; hours: string; minutes: string };

function parts(total: number): Draft {
  return {
    days: String(Math.floor(total / LEAVE_WORKDAY_MINUTES)),
    hours: String(Math.floor((total % LEAVE_WORKDAY_MINUTES) / 60)),
    minutes: String(total % 60),
  };
}

export function LeaveRegistry({ employees, requests, adjustments, year, onYearChange, canEditAdjustments = false, onAdjustmentSaved, showRejectedRequests = false }: Props) {
  // The registry previously used `grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_180px]` and label={hrScope === "ITC" ? "Year" : undefined}; the expanded row now adds Month and Exact Date filters.
  const { user, hrScope } = useAuth();
  const [search, setSearch] = useState("");
  const [filterEmployeeId, setFilterEmployeeId] = useState("");
  const [historyMonth, setHistoryMonth] = useState("all");
  const [historyDate, setHistoryDate] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<Draft>(parts(0));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const yearNumber = Number(year);
  const years = useMemo(() => Array.from(new Set([String(new Date().getFullYear()), ...requests.map((item) => item.leaveDate.slice(0, 4)), ...adjustments.map((item) => String(item.leaveYear))])).sort((a, b) => b.localeCompare(a)), [requests, adjustments]);
  const visibleEmployees = useMemo(() => employees.filter((employee) => hrScope === "ITC" ? !filterEmployeeId || employee.id === filterEmployeeId : employee.fullName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [employees, filterEmployeeId, hrScope, search]);
  const selected = employees.find((employee) => employee.id === selectedId) ?? null;
  const selectedHistoryDates = useMemo(() => requests.filter((item) => item.employeeId === selectedId && item.leaveDate.startsWith(year)).map((item) => item.leaveDate), [requests, selectedId, year]);
  const historyMonths = useMemo(() => dateFilterMonths(selectedHistoryDates, year), [selectedHistoryDates, year]);
  const historyDates = useMemo(() => dateFilterDates(selectedHistoryDates, year, historyMonth), [selectedHistoryDates, year, historyMonth]);
  const selectedHistory = requests.filter((item) => item.employeeId === selectedId && matchesDateFilters(item.leaveDate, year, historyMonth, historyDate)).sort((a, b) => b.leaveDate.localeCompare(a.leaveDate));

  const totals = (employeeId: string) => {
    const annual = requests.filter((item) => item.employeeId === employeeId && item.leaveDate.startsWith(year));
    const adjustment = adjustments.find((item) => item.employeeId === employeeId && item.leaveYear === yearNumber)?.adjustmentMinutes ?? 0;
    return calculateAnnualLeaveTotals(annual, yearNumber, adjustment);
  };
  const rejectedRequests = (employeeId: string) => countRejectedLeaveRequests(requests, employeeId, yearNumber, "WAIS");

  const beginEdit = (employeeId: string) => {
    setEditingId(employeeId);
    setDraft(parts(totals(employeeId).remaining));
    setFeedback(null);
  };

  const save = async () => {
    const minutes = adjustmentPartsToMinutes(Number(draft.days), Number(draft.hours), Number(draft.minutes));
    if (![draft.days, draft.hours, draft.minutes].every((value) => /^\d+$/.test(value)) || Number(draft.hours) > 7 || Number(draft.minutes) > 59) {
      setFeedback({ type: "error", message: "Enter whole values using 0–7 hours and 0–59 minutes." }); return;
    }
    if (minutes > ANNUAL_LEAVE_ENTITLEMENT_MINUTES) {
      setFeedback({ type: "error", message: "Remaining leave cannot exceed the 5-day annual entitlement." }); return;
    }
    setBusy(true); setFeedback(null);
    try {
      await setEmployeeRemainingLeave({ employeeId: editingId, leaveYear: yearNumber, remainingMinutes: minutes, remarks: "" });
      await onAdjustmentSaved?.();
      setFeedback({ type: "success", message: "Remaining leave updated successfully." });
    } catch (error) { setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not save remaining leave." }); }
    finally { setBusy(false); }
  };

  const changeRequest = async (item: LeaveRequest) => {
    if (item.status === "pending") {
      if (!window.confirm("Cancel this pending leave request?")) return;
      try { await cancelPendingLeaveRequest(item.id); await onAdjustmentSaved?.(); window.dispatchEvent(new Event("attendance-notifications-changed")); setFeedback({ type: "success", message: "Pending leave request cancelled." }); }
      catch (error) { setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not cancel leave request." }); }
      return;
    }
    if (item.status === "approved" || item.status === "rejected") {
      const approved = item.status === "approved";
      if (!window.confirm(approved ? "Remove this approved leave record? Its duration will be restored to the derived balance." : "Remove this rejected leave record from active history?")) return;
      const reason = window.prompt(`Enter the reason for removing this ${item.status} leave record:`)?.trim();
      if (!reason) { setFeedback({ type: "error", message: "A removal reason is required." }); return; }
      try { await removeLeaveRequest(item.id, reason); await onAdjustmentSaved?.(); window.dispatchEvent(new Event("attendance-notifications-changed")); setFeedback({ type: "success", message: approved ? "Approved leave removed and balance recalculated." : "Rejected leave removed from active history." }); }
      catch (error) { setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not remove leave request." }); }
    }
  };

  return <div className="min-w-0 space-y-5">
    <Card>
      <SectionHeader title="Annual Leave Registry" description="Every active Employee Master record is shown, including employees with no leave requests." />
      {feedback && <div className="mt-4"><AlertMessage tone={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} /></div>}
      <div className="mt-5 grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">{hrScope === "ITC" ? <EmployeeFilterCombobox employees={employees} selectedEmployeeId={filterEmployeeId} onChange={setFilterEmployeeId} /> : <Input type="search" placeholder="Search employee" value={search} onChange={(event) => setSearch(event.target.value)} />}<Select label="Year" aria-label="Leave year" value={year} onChange={(event) => { onYearChange(event.target.value); setSelectedId(null); setEditingId(""); setHistoryMonth("all"); setHistoryDate("all"); }}>{years.map((item) => <option key={item}>{item}</option>)}</Select><Select label="Month" value={historyMonth} onChange={(event) => { setHistoryMonth(event.target.value); setHistoryDate("all"); }}><option value="all">All Months</option>{historyMonths.map((item) => <option key={item} value={item}>{new Date(2000, Number(item) - 1, 1).toLocaleDateString("en-US", { month: "long" })}</option>)}</Select><Select label="Exact Date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)}><option value="all">All Dates</option>{historyDates.map((item) => <option key={item} value={item}>{new Date(`${item}T00:00:00`).toLocaleDateString("en-US")}</option>)}</Select></div>
      {canEditAdjustments && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-900">Edit Remaining Leave</p><p className="mt-1 text-xs text-slate-500">Set the employee's current remaining leave for the selected calendar year. Future approved leave deducts normally.</p><div className="mt-4 space-y-4"><Select label="Employee Name" value={editingId} onChange={(event) => event.target.value ? beginEdit(event.target.value) : setEditingId("")}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</Select><div><p className="mb-2 text-sm font-medium text-slate-700">Remaining Leave</p><div className="grid gap-3 sm:grid-cols-3"><Input label="Days" type="number" min="0" max="5" value={draft.days} disabled={!editingId} onChange={(event) => setDraft({ ...draft, days: event.target.value })} placeholder="0" /><Input label="Hours" type="number" min="0" max="7" value={draft.hours} disabled={!editingId} onChange={(event) => setDraft({ ...draft, hours: event.target.value })} placeholder="0" /><Input label="Minutes" type="number" min="0" max="59" value={draft.minutes} disabled={!editingId} onChange={(event) => setDraft({ ...draft, minutes: event.target.value })} placeholder="0" /></div></div><Button disabled={!editingId || busy} leftIcon={<Save className="h-4 w-4" />} onClick={() => void save()}>Save Remaining Leave</Button></div></div>}
      <div className="mt-5 min-w-0 overflow-x-auto"><table className="w-full table-auto text-left text-sm min-w-[860px] md:min-w-0"><thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Employee</th><th className="px-3 py-3">Employer</th><th className="px-3 py-3">Annual Entitlement</th><th className="px-3 py-3">Approved Leave</th><th className="px-3 py-3">Pending Leave</th>{showRejectedRequests && <th className="px-3 py-3">Rejected Requests</th>}<th className="px-3 py-3">Remaining Leave</th><th className="px-3 py-3">View History</th></tr></thead><tbody>{visibleEmployees.map((employee) => { const value = totals(employee.id); return <tr key={employee.id} className="border-b border-slate-100"><td className="px-3 py-4 font-medium text-slate-900"><div className="flex min-w-0 items-start gap-2"><EmployeeAvatar employeeId={employee.id} name={employee.fullName} profilePhotoPath={employee.profilePhotoPath} size="sm" /><span className="min-w-0 break-words">{employee.fullName}</span></div></td><td className="px-3 py-4"><Badge tone="neutral">{employee.employer}</Badge></td><td className="px-3 py-4">{formatLeaveMinutes(ANNUAL_LEAVE_ENTITLEMENT_MINUTES)}</td><td className="px-3 py-4">{value.approved > 0 ? formatLeaveMinutes(value.approved) : ""}</td><td className="px-3 py-4">{value.pending > 0 ? formatLeaveMinutes(value.pending) : ""}</td>{showRejectedRequests && <td className="px-3 py-4">{rejectedRequests(employee.id) || ""}</td>}<td className="px-3 py-4 font-semibold text-slate-900">{formatRemainingLeaveMinutes(value.remaining)}</td><td className="px-3 py-4"><Button size="sm" variant="secondary" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => setSelectedId(employee.id)}>View History</Button></td></tr>; })}</tbody></table>{visibleEmployees.length === 0 && <EmptyState title="No active employees found" description="Adjust the search or add an active employee in Employee Master." bordered={false} />}</div>
    </Card>
    {selected && <Card><SectionHeader title={`${selected.fullName} — ${year} History`} description="Active leave requests for the selected calendar year." />{selectedHistory.length === 0 ? <EmptyState title="No leave requests" description={`This employee has no leave requests in ${year}.`} bordered={false} /> : <div className="mt-4 overflow-x-auto"><table className="min-w-[1040px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Date</th><th className="px-3 py-3">Start–End</th><th className="px-3 py-3">Duration</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3">Informed</th><th className="px-3 py-3">Attendance</th><th className="px-3 py-3">Decision</th><th className="px-3 py-3">Review Remarks</th>{canEditAdjustments && <th className="px-3 py-3">HR Action</th>}</tr></thead><tbody>{selectedHistory.map((item) => <tr key={item.id} className="border-b border-slate-100"><td className="px-3 py-3">{formatLeaveDate(item.leaveDate)}</td><td className="px-3 py-3">{formatLeaveTime(item.startTime)}–{formatLeaveTime(item.endTime)}</td><td className="px-3 py-3">{formatLeaveRequestDuration(item.leaveDate, item.startTime, item.endTime, item.durationMinutes)}</td><td className="px-3 py-3">{item.reason}</td><td className="px-3 py-3">{item.informedParties.join(", ")}</td><td className="px-3 py-3">{item.attendanceClassification ? <Badge tone={item.attendanceClassification === "excused" ? "success" : "warning"}>{item.attendanceClassification === "excused" ? "Excused" : "Unexcused"}</Badge> : "Not recorded"}</td><td className="px-3 py-3"><Badge tone={item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : "warning"}>{formatLeaveStatus(item.status)}</Badge></td><td className="px-3 py-3">{item.reviewRemarks ?? "—"}</td>{canEditAdjustments && <td className="px-3 py-3">{item.status === "pending" && item.submittedBy === user?.id ? <Button size="sm" variant="danger" onClick={() => void changeRequest(item)}>Cancel Request</Button> : item.status === "approved" || item.status === "rejected" ? <Button size="sm" variant="danger" onClick={() => void changeRequest(item)}>Remove</Button> : null}</td>}</tr>)}</tbody></table></div>}</Card>}
  </div>;
}
