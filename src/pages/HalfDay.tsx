import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Clock3, Trash2 } from "lucide-react";
import { useEmployees } from "../context/EmployeesContext";
import { formatTime12Hour, halfDayRange, type HalfDayPeriod } from "../utils/attendanceForms";
import { createStagedHalfDay, deleteStagedHalfDay, loadStagedHalfDays, type StagedHalfDayRecord } from "../services/attendanceService";
import { AlertMessage, Button, Card, PageHeader, SectionHeader, Select } from "../components/ui";

export function HalfDay() {
  const { activeEmployees } = useEmployees();
  const [employee, setEmployee] = useState("");
  const [date, setDate] = useState("");
  const [period, setPeriod] = useState<HalfDayPeriod>("morning");
  const range = useMemo(() => (date ? halfDayRange(date, period) : null), [date, period]);
  const selectedEmployee = activeEmployees.find((item) => item.id === employee);
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [savedRecords, setSavedRecords] = useState<StagedHalfDayRecord[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const refreshSavedRecords = useCallback(async () => {
    try { setSavedRecords(await loadStagedHalfDays()); }
    catch { setFeedback({ type: "error", message: "Could not refresh saved half-day records." }); }
  }, []);
  useEffect(() => {
    const load = async () => { await refreshSavedRecords(); };
    void load();
  }, [refreshSavedRecords]);
  const save = async () => {
    if (!selectedEmployee || !date || !range || !reason.trim()) { setFeedback({ type: "error", message: "Select an employee, date, valid period, and reason." }); return; }
    try { await createStagedHalfDay({ employeeId: selectedEmployee.id, date, period, reason: reason.trim() }); await refreshSavedRecords(); setFeedback({ type: "success", message: "Half-day saved." }); setReason(""); }
    catch (error) { setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not save half-day." }); }
  };
  const remove = async (id: string) => {
    setDeletingId(id);
    setFeedback(null);
    try { await deleteStagedHalfDay(id); await refreshSavedRecords(); setFeedback({ type: "success", message: "Half-day record deleted." }); }
    catch { setFeedback({ type: "error", message: "Could not delete the half-day record." }); }
    finally { setDeletingId(null); }
  };

  return <div className="mx-auto max-w-3xl space-y-6">
    <PageHeader title="Half-Day" description="Record a scheduled morning or afternoon absence for an active employee." />
    <Card>
      <SectionHeader icon={<CalendarRange className="w-5 h-5" />} iconTone="brand" title="Add Half-Day" description="Half-day is its own attendance record and does not require approval." />
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <Select label="Employee Name" hint="Only active employees are available." value={employee} onChange={(event) => setEmployee(event.target.value)}><option value="">Select active employee</option>{activeEmployees.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</Select>
        <label className="block text-sm font-medium text-slate-700">Date<input className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <Select label="Absent period" value={period} onChange={(event) => setPeriod(event.target.value as HalfDayPeriod)}><option value="morning">Morning absent</option><option value="afternoon">Afternoon absent</option></Select>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected employee</p><p className="mt-1 text-sm font-semibold text-slate-900">{selectedEmployee?.fullName ?? "Select an employee"}</p></div>
      </div>
      <label className="mt-5 block text-sm font-medium text-slate-700">Reason<textarea className="mt-1.5 min-h-20 w-full rounded-lg border border-slate-300 p-3 text-sm" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {date && !range && <div className="mt-5"><AlertMessage tone="error" title="No standard Sunday half-day" message="Choose a Monday–Saturday date for a scheduled half-day period." /></div>}
      {range && <div className="mt-5 flex gap-3 rounded-xl border border-brand-100 bg-brand-50/50 p-4"><Clock3 className="mt-0.5 h-5 w-5 flex-none text-brand-700" /><div><p className="text-sm font-semibold text-slate-900">{period === "morning" ? "Morning absent" : "Afternoon absent"}</p><p className="mt-1 text-sm text-slate-600">Scheduled absence: <strong>{formatTime12Hour(range[0])} – {formatTime12Hour(range[1])}</strong></p><p className="mt-1 text-xs text-slate-500">Weekdays: 8:00 AM–12:00 PM or 1:00 PM–5:00 PM. Saturday: 7:00 AM–11:00 AM or 11:00 AM–3:15 PM.</p></div></div>}
      {feedback && <div className="mt-5"><AlertMessage tone={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} /></div>}
      <Button className="mt-5" disabled={!employee || !date || !range || !reason.trim()} onClick={() => void save()}>Save Half-Day</Button>
    </Card>
    <Card>
      <SectionHeader title="Saved Half-Days" description="Saved APP and WAIS half-day records." />
      {savedRecords.length === 0 ? <p className="mt-4 text-sm text-slate-500">No saved half-day records yet.</p> : <div className="mt-4 space-y-3">{savedRecords.map((record) => <div key={record.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700"><div><p className="font-semibold text-slate-900">{activeEmployees.find((item) => item.id === record.employeeId)?.fullName ?? "Employee"} · {record.workDate}</p><p>{record.absentPeriod === "morning" ? "Morning" : "Afternoon"} absent: {formatTime12Hour(record.scheduledStart)} – {formatTime12Hour(record.scheduledEnd)}</p><p className="mt-1 text-slate-500">{record.reason}</p></div><Button variant="danger" size="sm" disabled={deletingId === record.id} leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => void remove(record.id)}>Delete</Button></div>)}</div>}
    </Card>
  </div>;
}
