import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Search } from "lucide-react";
import { useAttendance } from "../context/AttendanceContext";
import { describeReviewExemptionError, loadCrossWorkspaceExemptionWorkflowData, reviewStagedExemption } from "../services/attendanceService";
import { AlertMessage, Badge, Button, Card, EmptyState, Input, PageHeader, SectionHeader } from "../components/ui";
import { AdminLeaveApprovals } from "../components/leave/AdminLeaveApprovals";
import { EmployeeAvatar } from "../components/employees/EmployeeAvatar";
import { useAuth } from "../context/AuthContext";

export function AdminApprovals() {
  const { workspace, hrScope } = useAuth();
  const [activeCategory, setActiveCategory] = useState<"exemptions" | "leave">("exemptions");
  const { refreshAttendanceData } = useAttendance();
  const [exemptions, setExemptions] = useState<Awaited<ReturnType<typeof loadCrossWorkspaceExemptionWorkflowData>>["exemptions"]>([]);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const pending = exemptions.filter((item) => item.approvalStatus === "pending");
  const history = exemptions
    .filter((item) => item.approvalStatus === "approved" || item.approvalStatus === "declined")
    .sort((a, b) => new Date(b.reviewedAt ?? 0).getTime() - new Date(a.reviewedAt ?? 0).getTime());
  const filteredHistory = history.filter((item) => item.name.toLocaleLowerCase().includes(historySearch.trim().toLocaleLowerCase()));
  const refreshApprovals = async () => { if (workspace) setExemptions((await loadCrossWorkspaceExemptionWorkflowData(workspace)).exemptions); };
  useEffect(() => { void refreshApprovals(); }, [workspace]);
  const review = async (id: string, status: "approved" | "declined") => {
    const numericId = Number(id); if (!Number.isSafeInteger(numericId)) { setFeedback({ type: "error", message: "This exemption ID is not compatible with the review workflow." }); return; }
    setBusy(id); setFeedback(null);
    try { await reviewStagedExemption(numericId, status, remarks[id] ?? ""); await refreshAttendanceData(); await refreshApprovals(); setFeedback({ type: "success", message: status === "approved" ? "Exemption approved." : "Exemption declined." }); }
    catch (error) { setFeedback({ type: "error", message: describeReviewExemptionError(error) }); }
    finally { setBusy(null); }
  };
  const approveAll = async () => {
    const eligible = pending.filter((item) => item.lateRecordId && Number.isSafeInteger(Number(item.id)));
    if (eligible.length === 0) { setFeedback({ type: "error", message: "There are no eligible pending exemptions to approve." }); return; }
    setBusy("all");
    let succeeded = 0;
    let failed = 0;
    for (const item of eligible) {
      try { await reviewStagedExemption(Number(item.id), "approved", remarks[item.id] ?? ""); succeeded += 1; } catch { failed += 1; }
    }
    await refreshAttendanceData();
    await refreshApprovals();
    setBusy(null);
    setFeedback({ type: failed ? "error" : "success", message: `${succeeded} exemption${succeeded === 1 ? "" : "s"} approved${failed ? `; ${failed} failed and remain pending.` : "."}` });
  };
  return <div className="space-y-6"><PageHeader title="Approvals" description={`Review exemption and leave requests for ${hrScope === "MAIN" ? "Main Office" : "ITC Plant"}.`} actions={<div className="inline-flex rounded-lg bg-slate-100 p-1"><button type="button" onClick={() => setActiveCategory("exemptions")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${activeCategory === "exemptions" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Exemptions</button><button type="button" onClick={() => setActiveCategory("leave")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${activeCategory === "leave" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Leave</button></div>} />
    {activeCategory === "leave" ? <AdminLeaveApprovals /> : <>
    {feedback && <AlertMessage tone={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />}
    <Card><div className="flex flex-wrap items-start justify-between gap-3"><SectionHeader icon={<ClipboardCheck className="w-5 h-5" />} iconTone="brand" title="Pending exemptions" description="Approval changes the status of only the exact linked late record." /><Button variant="success" size="sm" disabled={busy !== null || pending.length === 0} onClick={() => void approveAll()}>Approve All Pending</Button></div>
      {pending.length === 0 ? <EmptyState icon={<CheckCircle2 className="w-6 h-6" />} title="No pending exemptions" description="New HR exemption submissions will appear here." bordered={false} /> : <ul className="mt-5 space-y-3">{pending.map((item) => {
        const canReview = Boolean(item.lateRecordId);
        return <li key={item.id} className="rounded-xl border border-warning-200 bg-white p-4 shadow-sm ring-1 ring-warning-100/60 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><EmployeeAvatar name={item.name} size="sm" /><p className="truncate font-semibold text-slate-900">{item.name}</p></div><Badge tone="warning">Pending</Badge></div><div className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2"><p className="text-slate-500">Attendance date: {item.date}</p><p className="text-slate-700"><span className="font-medium text-slate-500">Linked late:</span> {item.lateTime || "Not recorded"} • {item.minutesLate ?? 0} minute(s)</p><p className="text-slate-700"><span className="font-medium text-slate-500">Reason:</span> {item.reason}</p><p className="text-slate-700"><span className="font-medium text-slate-500">Informed:</span> {item.informed?.join(", ") || "Not recorded"}</p></div>{!canReview && <div className="mt-4"><AlertMessage tone="warning" title="Linked late record required" message="This request was created before linked exemptions were introduced. It cannot be reviewed safely until a late record is explicitly linked by an authorized data correction." /></div>}<div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><Input aria-label={`Review remarks for ${item.name}`} placeholder="Review remarks (optional)" value={remarks[item.id] ?? ""} onChange={(event) => setRemarks({ ...remarks, [item.id]: event.target.value })} /><Button variant="success" disabled={!canReview || busy === item.id} onClick={() => void review(item.id, "approved")}>Approve</Button><Button variant="danger" disabled={!canReview || busy === item.id} onClick={() => void review(item.id, "declined")}>Decline</Button></div></li>;
      })}</ul>}
    </Card>
    <Card><SectionHeader icon={<ClipboardCheck className="w-5 h-5" />} iconTone="neutral" title="Approval History" description="Read-only record of approved and declined exemptions." /><div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="w-full sm:max-w-md"><Input type="search" aria-label="Search exemption approval history by employee" placeholder="Search employee name" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} leftIcon={<Search className="h-4 w-4" />} /></div><p className="text-xs font-medium text-slate-500">{filteredHistory.length} exemption {filteredHistory.length === 1 ? "record" : "records"}</p></div>
      {filteredHistory.length === 0 ? <EmptyState icon={<CheckCircle2 className="w-6 h-6" />} title={history.length === 0 ? "No approval history" : "No matching exemption history"} description={history.length === 0 ? "Approved and declined exemptions remain visible here." : "Try another employee name."} bordered={false} /> : <ul className="mt-5 space-y-3">{filteredHistory.map((item) => <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><EmployeeAvatar name={item.name} size="sm" /><p className="font-semibold text-slate-900">{item.name}</p></div><Badge tone={item.approvalStatus === "approved" ? "success" : "danger"}>{item.approvalStatus === "approved" ? "Approved" : "Declined"}</Badge></div><div className="mt-3 grid gap-x-6 gap-y-2 text-slate-700 sm:grid-cols-2"><p><span className="font-medium text-slate-500">Attendance date:</span> {item.date}</p><p><span className="font-medium text-slate-500">Linked late:</span> {item.lateTime || "Not recorded"} • {item.minutesLate ?? 0} minute(s)</p><p><span className="font-medium text-slate-500">Reason:</span> {item.reason}</p><p><span className="font-medium text-slate-500">Reviewer:</span> {item.reviewedBy ? "Admin" : "Not recorded"}</p><p><span className="font-medium text-slate-500">Reviewed:</span> {item.reviewedAt ? new Date(item.reviewedAt).toLocaleString() : "Not recorded"}</p><p><span className="font-medium text-slate-500">Informed:</span> {item.informed?.join(", ") || "Not recorded"}</p><p className="sm:col-span-2"><span className="font-medium text-slate-500">Remarks:</span> {item.reviewRemarks || "None"}</p>{item.lateRestoredAt && <p className="sm:col-span-2 font-medium text-warning-700">Late Record Restored: {new Date(item.lateRestoredAt).toLocaleString()}</p>}</div></li>)}</ul>}
    </Card></>}</div>;
}
