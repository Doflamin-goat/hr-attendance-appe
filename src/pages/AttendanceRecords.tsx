import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useAttendance } from "../context/AttendanceContext";
import { useEmployees } from "../context/EmployeesContext";
import { EmployeeAvatar } from "../components/employees/EmployeeAvatar";
import { Button, Card, EmptyState, Input, PageHeader, Select, Textarea, toast } from "../components/ui";
import { formatTime12HourWithOptionalSeconds } from "../utils/attendanceForms";
import { mainWorkDateOptions, type MainDailyAttendance } from "../utils/mainAttendance";

const dateLabel = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const monthLabel = (value: string) => {
  const [year, month] = value.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};
const checkoutLabel = (record: MainDailyAttendance) => record.effectiveLastOutAt
  ? new Date(record.effectiveLastOutAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
  : record.lastOut ? formatTime12HourWithOptionalSeconds(record.lastOut) : "—";

type EditMode = "checkin" | "checkout";

function AttendanceEditDialog({
  mode,
  record,
  time,
  note,
  error,
  saving,
  onTimeChange,
  onNoteChange,
  onSave,
  onClose,
}: {
  mode: EditMode;
  record: MainDailyAttendance;
  time: string;
  note: string;
  error: string;
  saving: boolean;
  onTimeChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const isCheckin = mode === "checkin";
  const title = isCheckin ? (record.firstIn ? "Update Check-In" : "Add Check-In") : (record.lastOut ? "Update Check-Out" : "Add Check-Out");
  return <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="attendance-edit-title">
    <button type="button" className="absolute inset-0 bg-slate-950/40" aria-label="Close dialog" onClick={saving ? undefined : onClose} />
    <div className="relative z-10 max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="attendance-edit-title" className="font-semibold text-slate-900">{title}</h2><p className="text-sm text-slate-500">{record.employeeName} · {dateLabel(record.workDate)}</p></div>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <p className="text-xs font-medium uppercase text-slate-500">Employee</p><p className="mt-1 font-semibold text-slate-900">{record.employeeName}</p>
          <p className="mt-3 text-xs font-medium uppercase text-slate-500">Attendance Date</p><p className="mt-1 font-medium text-slate-700">{dateLabel(record.workDate)}</p>
          {isCheckin ? <>
            <p className="mt-3 text-xs font-medium uppercase text-slate-500">Current Effective First In</p><p className="mt-1 font-semibold text-slate-900">{record.firstIn ? formatTime12HourWithOptionalSeconds(record.firstIn) : "Not recorded"}</p>
            <p className="mt-3 text-xs font-medium uppercase text-slate-500">Original Biometric First In</p><p className="mt-1 font-medium text-slate-700">{record.biometricFirstIn ? formatTime12HourWithOptionalSeconds(record.biometricFirstIn) : "Not recorded"}</p>
            <p className="mt-3 text-xs font-medium uppercase text-slate-500">Check-In Source</p><p className="mt-1 font-medium capitalize text-slate-700">{record.checkinSource ?? "biometric"}</p>
          </> : <>
            <p className="mt-3 text-xs font-medium uppercase text-slate-500">Current Last Out</p><p className="mt-1 font-semibold text-slate-900">{record.lastOut ? formatTime12HourWithOptionalSeconds(record.lastOut) : "Not recorded"}</p>
            <p className="mt-3 text-xs font-medium uppercase text-slate-500">Current Source</p><p className="mt-1 font-medium capitalize text-slate-700">{record.checkoutSource ?? "Not recorded"}</p>
            <p className="mt-3 text-xs font-medium uppercase text-slate-500">Current Note</p><p className="mt-1 font-medium text-slate-700">{record.manualCheckoutNote || "Not recorded"}</p>
          </>}
        </div>
        <div className="space-y-3">
          <Input label={isCheckin ? "First Check-In Time" : "Final Check-Out Time"} type="time" step="1" value={time} onChange={(e) => onTimeChange(e.target.value)} autoFocus />
          <Textarea label="Optional Note" value={note} onChange={(e) => onNoteChange(e.target.value)} placeholder={isCheckin ? "Corrected from attendance record" : "Returned from field service"} />
          {error && <p className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">{error}</p>}
          <Button onClick={onSave} disabled={!time || saving}>{saving ? "Saving..." : isCheckin ? "Save Check-In" : "Save Check-Out"}</Button>
        </div>
      </div>
    </div>
  </div>;
}

export function AttendanceRecords() {
  const { hrScope, role } = useAuth();
  const { mainDailyAttendance, mapMainEmployee, reconcileMainUnmatched, cleanMainStaleRecords, saveManualCheckin, saveManualCheckout } = useAttendance();
  const { activeEmployees } = useEmployees();
  const [month, setMonth] = useState("all"), [day, setDay] = useState("all"), [employee, setEmployee] = useState("all"), [status, setStatus] = useState("all"), [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState<EditMode | null>(null);
  const [editRecord, setEditRecord] = useState<MainDailyAttendance | null>(null);
  const [editTime, setEditTime] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const restoreFocusRef = useRef<HTMLButtonElement | null>(null);
  const workDates = useMemo(() => mainWorkDateOptions(mainDailyAttendance), [mainDailyAttendance]);
  const months = useMemo(() => [...new Set(workDates.map((date) => date.slice(0, 7)))], [workDates]);
  const days = useMemo(() => workDates.filter((date) => month === "all" || date.startsWith(month)), [workDates, month]);
  const names = useMemo(() => [...new Set(mainDailyAttendance.map((r) => r.employeeName))].sort(), [mainDailyAttendance]);
  const records = useMemo(() => mainDailyAttendance.filter((r) => (month === "all" || r.workDate.startsWith(month)) && (day === "all" || r.workDate === day) && (employee === "all" || r.employeeName === employee) && (status === "all" || r.status === status) && r.employeeName.toLowerCase().includes(search.trim().toLowerCase())), [mainDailyAttendance, month, day, employee, status, search]);
  const activeModal = editMode && editRecord ? { mode: editMode, record: editRecord } : null;

  useEffect(() => {
    if (!activeModal) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) closeEditor(); };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [activeModal, saving]);

  if (hrScope !== "MAIN") return <EmptyState title="MAIN Office only" description="Attendance Records is available to the MAIN Office workspace." bordered />;
  const canManage = role === "HR";
  function closeEditor(force = false) { if (!saving || force) { setEditMode(null); setEditRecord(null); setEditError(""); restoreFocusRef.current?.focus(); } }
  const openEditor = (mode: EditMode, record: MainDailyAttendance, button?: HTMLButtonElement) => {
    restoreFocusRef.current = button ?? null;
    setEditMode(mode); setEditRecord(record); setEditError("");
    setEditTime((mode === "checkin" ? record.firstIn : record.lastOut)?.slice(0, 5) ?? "");
    setEditNote(mode === "checkin" ? record.manualCheckinNote ?? "" : record.manualCheckoutNote ?? "");
  };
  const handleSave = async () => {
    if (!editRecord?.id || !editMode || !editTime) return;
    setSaving(true); setEditError("");
    const result = editMode === "checkin" ? await saveManualCheckin(editRecord.id, editTime, editNote) : await saveManualCheckout(editRecord.id, editTime, editNote);
    setSaving(false);
    if (result.success) { toast.success(editMode === "checkin" ? "Check-In saved" : "Check-Out saved", result.message); closeEditor(true); }
    else setEditError(result.message);
  };
  const handleCleanStaleRecords = async () => {
    const result = await cleanMainStaleRecords();
    if (result.success) toast.success("Stale records reconciled", result.message);
    else toast.error("Reconciliation failed", result.message);
  };

  return <div className="space-y-6">
    <PageHeader title="Attendance Records" description={canManage ? "Review and resolve MAIN Office daily attendance history." : "View MAIN Office daily attendance history."} />
    {canManage && <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">Maintenance</h2><p className="text-sm text-slate-500">Use these tools to reconcile imported attendance data.</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void reconcileMainUnmatched().then((result) => result.success ? toast.success("Reconciliation complete", result.message) : toast.error("Reconciliation failed", result.message))}>Reconcile Known Mappings</Button><Button variant="secondary" onClick={() => void handleCleanStaleRecords()}>Clean Stale Records</Button></div></div></Card>}
    <Card><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee" /><Select value={month} onChange={(e) => { setMonth(e.target.value); setDay("all"); }}><option value="all">All months</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</Select><Select value={day} onChange={(e) => setDay(e.target.value)}><option value="all">All dates</option>{days.map((d) => <option key={d} value={d}>{dateLabel(d)}</option>)}</Select><Select value={employee} onChange={(e) => setEmployee(e.target.value)}><option value="all">All employees</option>{names.map((n) => <option key={n}>{n}</option>)}</Select><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="complete">Complete</option><option value="missing_checkout">Missing Check-Out</option><option value="unmatched_employee">Unmatched</option></Select></div></Card>
    <Card padded={false}><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-900">MAIN Attendance History</h2><p className="text-sm text-slate-500">{records.length} record{records.length === 1 ? "" : "s"}</p></div>{records.length === 0 ? <EmptyState title="No attendance records" description="No records match the selected filters." bordered={false} /> : <div className="min-w-0 overflow-x-auto md:overflow-x-visible"><table className="w-full table-fixed text-sm"><colgroup><col style={{ width: "22%" }} /><col style={{ width: "15%" }} /><col style={{ width: "16%" }} /><col style={{ width: "15%" }} /><col style={{ width: "15%" }} />{canManage && <col style={{ width: "17%" }} />}</colgroup><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Employee", "Date", "First In", "Last Out", "Check-Out Source", ...(canManage ? ["Action"] : [])].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{records.map((r) => <tr key={r.id}><td className="break-words px-4 py-3 font-medium"><div className="flex min-w-0 items-center gap-2"><EmployeeAvatar employeeId={r.employeeId} name={r.employeeName} size="sm" /><span className="min-w-0">{r.employeeName}</span></div></td><td className="whitespace-nowrap px-4 py-3">{dateLabel(r.workDate)}</td><td className="whitespace-nowrap px-4 py-3"><div>{r.firstIn ? formatTime12HourWithOptionalSeconds(r.firstIn) : "—"}</div>{canManage && r.employeeId && <span className="text-xs text-slate-500">{r.checkinSource === "manual" ? "Manual" : "Biometric"}</span>}</td><td className="whitespace-nowrap px-4 py-3">{checkoutLabel(r)}</td><td className="break-words px-4 py-3 capitalize">{r.checkoutSource ?? "—"}</td>{canManage && <td className="px-4 py-3"><div className="flex min-w-0 flex-wrap items-center gap-1.5">{r.employeeId && <><Button size="sm" className="h-8 px-2 text-[11px] whitespace-nowrap" title={`${r.firstIn ? "Update Check-In" : "Add Check-In"} for ${r.employeeName}`} aria-label={`${r.firstIn ? "Update Check-In" : "Add Check-In"} for ${r.employeeName}`} onClick={(event) => openEditor("checkin", r, event.currentTarget)}>Check-In</Button><Button size="sm" variant="secondary" className="h-8 px-2 text-[11px] whitespace-nowrap" title={`${r.lastOut ? "Update Check-Out" : "Add Check-Out"} for ${r.employeeName}`} aria-label={`${r.lastOut ? "Update Check-Out" : "Add Check-Out"} for ${r.employeeName}`} onClick={(event) => openEditor("checkout", r, event.currentTarget)}>Check-Out</Button></>}{!r.employeeId && r.status === "unmatched_employee" && r.id ? <div className="flex min-w-0 flex-wrap gap-2"><Select className="min-w-0 flex-1" value={matches[r.id] ?? ""} onChange={(e) => setMatches({ ...matches, [r.id!]: e.target.value })}><option value="">Match MAIN employee</option>{activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.attendanceName ?? e.fullName}</option>)}</Select><Button size="sm" disabled={!matches[r.id]} onClick={() => void mapMainEmployee(r.id!, matches[r.id!]!).then((result) => result.success ? toast.success("Mapping saved", result.message) : toast.error("Mapping failed", result.message))}>Save</Button></div> : null}</div></td>}</tr>)}</tbody></table></div>}</Card>
    {canManage && activeModal && <AttendanceEditDialog mode={activeModal.mode} record={activeModal.record} time={editTime} note={editNote} error={editError} saving={saving} onTimeChange={setEditTime} onNoteChange={setEditNote} onSave={() => void handleSave()} onClose={closeEditor} />}
  </div>;
}
