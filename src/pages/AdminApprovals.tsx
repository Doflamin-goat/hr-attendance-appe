import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Clock3 } from "lucide-react";
import { useAttendance } from "../context/AttendanceContext";
import { describeReviewExemptionError, loadCrossWorkspaceExemptionWorkflowData, reviewStagedExemption } from "../services/attendanceService";
import { AlertMessage, Badge, Button, Card, EmptyState, Input, PageHeader, SectionHeader } from "../components/ui";

export function AdminApprovals() {
  const { refreshAttendanceData } = useAttendance();
  const [exemptions, setExemptions] = useState<Awaited<ReturnType<typeof loadCrossWorkspaceExemptionWorkflowData>>["exemptions"]>([]);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const pending = exemptions.filter((item) => item.approvalStatus === "pending");
  const history = exemptions
    .filter((item) => item.approvalStatus === "approved" || item.approvalStatus === "declined")
    .sort((a, b) => new Date(b.reviewedAt ?? 0).getTime() - new Date(a.reviewedAt ?? 0).getTime());
  const refreshApprovals = async () => setExemptions((await loadCrossWorkspaceExemptionWorkflowData()).exemptions);
  useEffect(() => { void refreshApprovals(); }, []);
  const review = async (id: string, status: "approved" | "declined") => {
    const numericId = Number(id); if (!Number.isSafeInteger(numericId)) { setFeedback({ type: "error", message: "This exemption ID is not compatible with the review workflow." }); return; }
    setBusy(id); setFeedback(null);
    try { await reviewStagedExemption(numericId, status, remarks[id] ?? ""); await refreshAttendanceData(); await refreshApprovals(); setFeedback({ type: "success", message: status === "approved" ? "Exemption approved." : "Exemption declined." }); }
    catch (error) { setFeedback({ type: "error", message: describeReviewExemptionError(error) }); }
    finally { setBusy(null); }
  };
  return <div className="space-y-6"><PageHeader title="Exemption Approvals" description="Review pending linked late exemptions across APP and WAIS." />
    {feedback && <AlertMessage tone={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />}
    <Card><SectionHeader icon={<ClipboardCheck className="w-5 h-5" />} iconTone="brand" title="Pending exemptions" description="Approval changes the status of only the exact linked late record." />
      {pending.length === 0 ? <EmptyState icon={<CheckCircle2 className="w-6 h-6" />} title="No pending exemptions" description="New HR exemption submissions will appear here." bordered={false} /> : <ul className="mt-5 space-y-3">{pending.map((item) => {
        const canReview = Boolean(item.lateRecordId);
        return <li key={item.id} className="rounded-xl border border-slate-200 bg-slate-950/20 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><Clock3 className="h-4 w-4 flex-none text-warning-600" /><p className="truncate font-semibold text-slate-900">{item.name}</p></div><Badge tone="warning">Pending</Badge></div><div className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2"><p className="text-slate-500">Attendance date: {item.date}</p><p className="text-slate-700"><span className="font-medium text-slate-500">Linked late:</span> {item.lateTime || "Not recorded"} • {item.minutesLate ?? 0} minute(s)</p><p className="text-slate-700"><span className="font-medium text-slate-500">Reason:</span> {item.reason}</p><p className="text-slate-700"><span className="font-medium text-slate-500">Informed:</span> {item.informed?.join(", ") || "Not recorded"}</p></div>{!canReview && <div className="mt-4"><AlertMessage tone="warning" title="Linked late record required" message="This request was created before linked exemptions were introduced. It cannot be reviewed safely until a late record is explicitly linked by an authorized data correction." /></div>}<div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><Input aria-label={`Review remarks for ${item.name}`} placeholder="Review remarks (optional)" value={remarks[item.id] ?? ""} onChange={(event) => setRemarks({ ...remarks, [item.id]: event.target.value })} /><Button variant="success" disabled={!canReview || busy === item.id} onClick={() => void review(item.id, "approved")}>Approve</Button><Button variant="danger" disabled={!canReview || busy === item.id} onClick={() => void review(item.id, "declined")}>Decline</Button></div></li>;
      })}</ul>}
    </Card>
    <Card><SectionHeader icon={<ClipboardCheck className="w-5 h-5" />} iconTone="neutral" title="Approval History" description="Read-only record of approved and declined exemptions." />
      {history.length === 0 ? <EmptyState icon={<CheckCircle2 className="w-6 h-6" />} title="No approval history" description="Approved and declined exemptions remain visible here." bordered={false} /> : <ul className="mt-5 space-y-3">{history.map((item) => <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-900">{item.name}</p><Badge tone={item.approvalStatus === "approved" ? "success" : "danger"}>{item.approvalStatus === "approved" ? "Approved" : "Declined"}</Badge></div><div className="mt-3 grid gap-x-6 gap-y-2 text-slate-700 sm:grid-cols-2"><p><span className="font-medium text-slate-500">Attendance date:</span> {item.date}</p><p><span className="font-medium text-slate-500">Linked late:</span> {item.lateTime || "Not recorded"} • {item.minutesLate ?? 0} minute(s)</p><p><span className="font-medium text-slate-500">Reason:</span> {item.reason}</p><p><span className="font-medium text-slate-500">Reviewer:</span> {item.reviewedBy ? "Admin" : "Not recorded"}</p><p><span className="font-medium text-slate-500">Reviewed:</span> {item.reviewedAt ? new Date(item.reviewedAt).toLocaleString() : "Not recorded"}</p><p><span className="font-medium text-slate-500">Informed:</span> {item.informed?.join(", ") || "Not recorded"}</p><p className="sm:col-span-2"><span className="font-medium text-slate-500">Remarks:</span> {item.reviewRemarks || "None"}</p>{item.lateRestoredAt && <p className="sm:col-span-2 font-medium text-warning-700">Late Record Restored: {new Date(item.lateRestoredAt).toLocaleString()}</p>}</div></li>)}</ul>}
    </Card></div>;
}
