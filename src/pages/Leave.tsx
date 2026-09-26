import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { LeaveRegistry } from "../components/leave/LeaveRegistry";
import { AlertMessage, Button, Card, Input, PageHeader, SearchableCombobox, SectionHeader, Textarea } from "../components/ui";
import { useEmployees } from "../context/EmployeesContext";
import { useAuth } from "../context/AuthContext";
import { listEmployeeLeaveAdjustments, listLeaveRequests, submitLeaveRequest, type EmployeeLeaveAdjustment, type LeaveRequest } from "../services/leaveService";
import { calculateLeaveDuration, formatLeaveRequestDuration } from "../utils/leaveRules";
import { informedPeopleForScope } from "../utils/informedPeople";

export function Leave() {
  const { workspace, hrScope } = useAuth();
  const { activeEmployees } = useEmployees();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [adjustments, setAdjustments] = useState<EmployeeLeaveAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({ employeeId: "", employeeName: "", date: "", start: "08:00", end: "17:00", informed: [] as string[], reason: "" });
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const duration = useMemo(() => form.date ? calculateLeaveDuration(form.date, form.start, form.end) : { minutes: 0, error: null }, [form.date, form.start, form.end]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (!workspace) return;
      const [leaveRequests, leaveAdjustments] = await Promise.all([listLeaveRequests(workspace), listEmployeeLeaveAdjustments(workspace)]);
      setRequests(leaveRequests); setAdjustments(leaveAdjustments);
    } catch (error) { setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not load leave records." }); }
    finally { setLoading(false); }
  }, [workspace]);
  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setFeedback(null);
    if (!form.employeeId || !form.date || form.informed.length === 0 || !form.reason.trim() || duration.error || duration.minutes <= 0) {
      setFeedback({ type: "error", message: duration.error ?? "Complete all required leave fields, including at least one informed person." }); return;
    }
    if (requests.some((item) => item.employeeId === form.employeeId && item.leaveDate === form.date && (item.status === "pending" || item.status === "approved"))) {
      setFeedback({ type: "error", message: "An active leave request already exists for this employee on this date." }); return;
    }
    try {
      await submitLeaveRequest({ employeeId: form.employeeId, leaveDate: form.date, startTime: form.start, endTime: form.end, durationMinutes: duration.minutes, informedParties: form.informed, reason: form.reason.trim() });
      await refresh();
      window.dispatchEvent(new Event("attendance-notifications-changed"));
      setFeedback({ type: "success", message: "Leave request submitted as Pending. No leave balance has been deducted." });
      setYear(form.date.slice(0, 4));
      setForm({ employeeId: "", employeeName: "", date: "", start: "08:00", end: "17:00", informed: [], reason: "" });
    } catch (error) { setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not submit leave request." }); }
  };

  return <div className="space-y-6">
    <PageHeader title="Leave" description="Submit leave for Admin approval and review the annual employee leave registry." />
    {feedback && <AlertMessage tone={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />}
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="self-start lg:sticky lg:top-24"><SectionHeader icon={<CalendarDays className="h-5 w-5" />} iconTone="brand" title="Log Leave" description="Approved working minutes are deducted only after Admin review." />
        <form onSubmit={submit} className="mt-5 space-y-4">
          <SearchableCombobox label="Employee Name" required value={form.employeeName} options={activeEmployees.map((employee) => ({ id: employee.id, label: employee.fullName }))} onClear={() => setForm({ ...form, employeeId: "", employeeName: "" })} onSelect={(employee) => setForm({ ...form, employeeId: employee.id, employeeName: employee.label })} />
          <Input label="Date of Leave" required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          <div className="grid grid-cols-2 gap-3"><Input label="Start Time" required type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /><Input label="End Time" required type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} /></div>
          <div className={`rounded-lg border px-3 py-2 text-sm ${duration.error ? "border-danger-100 bg-danger-50 text-danger-700" : "border-brand-100 bg-brand-50 text-brand-700"}`}>{duration.error ?? `Chargeable duration: ${formatLeaveRequestDuration(form.date, form.start, form.end, duration.minutes)}`}</div>
          <SearchableCombobox label="Who was informed" placeholder="Search or add a name" options={informedPeopleForScope(hrScope).filter((person) => !form.informed.includes(person)).map((person) => ({ id: person, label: person }))} onSelect={(person) => setForm({ ...form, informed: [...form.informed, person.label] })} onCreateCustom={(person) => setForm({ ...form, informed: [...form.informed, person] })} />
          <div className="flex flex-wrap gap-2">{form.informed.map((person) => <button type="button" key={person} onClick={() => setForm({ ...form, informed: form.informed.filter((item) => item !== person) })} className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700">{person} ×</button>)}</div>
          <Textarea label="Reason for Leave" required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
          <Button type="submit" fullWidth leftIcon={<Plus className="h-4 w-4" />}>Submit for Approval</Button>
        </form>
      </Card>
      <div>{loading ? <Card><p className="text-sm text-slate-500">Loading leave registry…</p></Card> : <LeaveRegistry employees={activeEmployees} requests={requests} adjustments={adjustments} year={year} onYearChange={setYear} canEditAdjustments onAdjustmentSaved={refresh} showRejectedRequests={hrScope === "MAIN"} />}</div>
    </div>
  </div>;
}
