import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useAttendance } from "../context/AttendanceContext";
import { useEmployees } from "../context/EmployeesContext";
import { EmployeeAvatar } from "../components/employees/EmployeeAvatar";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Textarea, toast } from "../components/ui";
import { formatTime12HourWithOptionalSeconds } from "../utils/attendanceForms";
import { mainWorkDateOptions, type MainDailyAttendance } from "../utils/mainAttendance";

const dateLabel = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const statusLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const monthLabel = (value: string) => {
  const [year, month] = value.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

export function AttendanceRecords() {
  const { hrScope, role } = useAuth();
  const { mainDailyAttendance, mapMainEmployee, reconcileMainUnmatched, cleanMainStaleRecords, saveManualCheckout } = useAttendance();
  const { activeEmployees } = useEmployees();
  const [month, setMonth] = useState("all"), [day, setDay] = useState("all"), [employee, setEmployee] = useState("all"), [status, setStatus] = useState("all"), [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [checkoutRecord, setCheckoutRecord] = useState<MainDailyAttendance | null>(null);
  const [checkoutTime, setCheckoutTime] = useState("");
  const [checkoutNote, setCheckoutNote] = useState("");
  const workDates = useMemo(() => mainWorkDateOptions(mainDailyAttendance), [mainDailyAttendance]);
  const months = useMemo(() => [...new Set(workDates.map((date) => date.slice(0, 7)))], [workDates]);
  const days = useMemo(() => workDates.filter((date) => month === "all" || date.startsWith(month)), [workDates, month]);
  const names = useMemo(() => [...new Set(mainDailyAttendance.map((r) => r.employeeName))].sort(), [mainDailyAttendance]);
  const records = useMemo(() => mainDailyAttendance.filter((r) => (month === "all" || r.workDate.startsWith(month)) && (day === "all" || r.workDate === day) && (employee === "all" || r.employeeName === employee) && (status === "all" || r.status === status) && r.employeeName.toLowerCase().includes(search.trim().toLowerCase())), [mainDailyAttendance, month, day, employee, status, search]);
  if (hrScope !== "MAIN") return <EmptyState title="MAIN Office only" description="Attendance Records is available to the MAIN Office workspace." bordered />;
  const handleCleanStaleRecords = async () => {
    const result = await cleanMainStaleRecords();
    if (result.success) toast.success("Stale records reconciled", result.message);
    else toast.error("Reconciliation failed", result.message);
  };
  const openCheckout = (record: MainDailyAttendance) => {
    setCheckoutRecord(record);
    setCheckoutTime(record.lastOut?.slice(0, 5) ?? "");
    setCheckoutNote(record.manualCheckoutNote ?? "");
  };
  const handleSaveCheckout = async () => {
    if (!checkoutRecord?.id) return;
    const result = await saveManualCheckout(checkoutRecord.id, checkoutTime, checkoutNote);
    if (result.success) {
      toast.success("Check-Out saved", result.message);
      setCheckoutRecord(null);
    } else {
      toast.error("Check-Out failed", result.message);
    }
  };
  const canManage = role === "HR";
  return <div className="space-y-6"><PageHeader title="Attendance Records" description={canManage ? "Review and resolve MAIN Office daily attendance history." : "View MAIN Office daily attendance history."} />
    {canManage && <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">Maintenance</h2><p className="text-sm text-slate-500">Use these tools to reconcile imported attendance data.</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void reconcileMainUnmatched().then((result) => result.success ? toast.success("Reconciliation complete", result.message) : toast.error("Reconciliation failed", result.message))}>Reconcile Known Mappings</Button><Button variant="secondary" onClick={() => void handleCleanStaleRecords()}>Clean Stale Records</Button></div></div></Card>}
    <Card><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee" /><Select value={month} onChange={(e) => { setMonth(e.target.value); setDay("all"); }}><option value="all">All months</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</Select><Select value={day} onChange={(e) => setDay(e.target.value)}><option value="all">All dates</option>{days.map((d) => <option key={d} value={d}>{dateLabel(d)}</option>)}</Select><Select value={employee} onChange={(e) => setEmployee(e.target.value)}><option value="all">All employees</option>{names.map((n) => <option key={n}>{n}</option>)}</Select><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="complete">Complete</option><option value="missing_checkout">Missing Check-Out</option><option value="unmatched_employee">Unmatched</option></Select></div></Card>
    <Card padded={false}><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-900">MAIN Attendance History</h2><p className="text-sm text-slate-500">{records.length} record{records.length === 1 ? "" : "s"}</p></div>{records.length === 0 ? <EmptyState title="No attendance records" description="No records match the selected filters." bordered={false} /> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Employee","Date","First In","Last Out","Check-Out Source","Status",...(canManage ? ["Action"] : [])].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{records.map((r) => <tr key={r.id}><td className="px-4 py-3 font-medium"><div className="flex items-center gap-2"><EmployeeAvatar employeeId={r.employeeId} name={r.employeeName} size="sm" /><span>{r.employeeName}</span></div></td><td className="px-4 py-3">{dateLabel(r.workDate)}</td><td className="px-4 py-3">{r.firstIn ? formatTime12HourWithOptionalSeconds(r.firstIn) : "—"}</td><td className="px-4 py-3">{r.lastOut ? formatTime12HourWithOptionalSeconds(r.lastOut) : "—"}</td><td className="px-4 py-3 capitalize">{r.checkoutSource ?? "—"}</td><td className="px-4 py-3"><Badge tone={r.status === "complete" ? "success" : r.status === "missing_checkout" ? "warning" : "danger"}>{statusLabel(r.status)}</Badge></td>{canManage && <td className="px-4 py-3">{r.employeeId ? <Button size="sm" onClick={() => openCheckout(r)}>{r.lastOut ? "Update Check-Out" : "Add Check-Out"}</Button> : r.status === "unmatched_employee" && r.id ? <div className="flex min-w-64 gap-2"><Select value={matches[r.id!] ?? ""} onChange={(e) => setMatches({ ...matches, [r.id!]: e.target.value })}><option value="">Match MAIN employee</option>{activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.attendanceName ?? e.fullName}</option>)}</Select><Button size="sm" disabled={!matches[r.id!]} onClick={() => void mapMainEmployee(r.id!, matches[r.id!]!).then((result) => result.success ? toast.success("Mapping saved", result.message) : toast.error("Mapping failed", result.message))}>Save</Button></div> : "—"}</td>}</tr>)}</tbody></table></div>}</Card>
    {canManage && checkoutRecord && <Card><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold text-slate-900">{checkoutRecord.lastOut ? "Update Check-Out" : "Add Check-Out"}</h2><p className="text-sm text-slate-500">{checkoutRecord.employeeName} · {dateLabel(checkoutRecord.workDate)}</p></div><Button variant="ghost" onClick={() => setCheckoutRecord(null)}>Cancel</Button></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="text-xs font-medium uppercase text-slate-500">Current Last Out</p><p className="mt-1 font-semibold text-slate-900">{checkoutRecord.lastOut ? formatTime12HourWithOptionalSeconds(checkoutRecord.lastOut) : "—"}</p><p className="mt-2 text-xs font-medium uppercase text-slate-500">Current Source</p><p className="font-medium capitalize text-slate-700">{checkoutRecord.checkoutSource ?? "—"}</p><p className="mt-2 text-xs font-medium uppercase text-slate-500">Current Note</p><p className="font-medium text-slate-700">{checkoutRecord.manualCheckoutNote || "—"}</p></div><div className="space-y-3"><Input label="Final Check-Out Time" type="time" step="1" value={checkoutTime} onChange={(e) => setCheckoutTime(e.target.value)} /><Textarea label="Optional Note" value={checkoutNote} onChange={(e) => setCheckoutNote(e.target.value)} placeholder="Returned from field service" /><Button onClick={() => void handleSaveCheckout()} disabled={!checkoutTime}>Save Check-Out</Button></div></div></Card>}
  </div>;
}
