import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Palmtree } from "lucide-react";
import { useEmployees } from "../../context/EmployeesContext";
import { listEmployeeLeaveAdjustments, listLeaveRequests, reviewLeaveRequest, type AttendanceClassification, type EmployeeLeaveAdjustment, type LeaveRequest } from "../../services/leaveService";
import { formatLeaveDate, formatLeaveRequestDuration, formatLeaveStatus, formatLeaveTime } from "../../utils/leaveRules";
import { AlertMessage, Badge, Button, Card, EmptyState, Input, SectionHeader } from "../ui";
import { LeaveRegistry } from "./LeaveRegistry";
import { useAuth } from "../../context/AuthContext";
import { EmployeeAvatar } from "../employees/EmployeeAvatar";

export function AdminLeaveApprovals() {
  const { workspace, hrScope } = useAuth();
  const { activeEmployees } = useEmployees();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [adjustments, setAdjustments] = useState<EmployeeLeaveAdjustment[]>([]);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [classifications, setClassifications] = useState<Record<string, AttendanceClassification | "">>({});
  const [decisions, setDecisions] = useState<Record<string, "approved" | "rejected" | "">>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const refresh = useCallback(async () => {
    if (!workspace) return;
    const [leaveRequests, leaveAdjustments] = await Promise.all([listLeaveRequests(workspace), listEmployeeLeaveAdjustments(workspace)]);
    setRequests(leaveRequests); setAdjustments(leaveAdjustments); setLoading(false);
  }, [workspace]);
  useEffect(() => { void refresh().catch(() => { setLoading(false); setFeedback({ type: "error", message: "Could not load leave requests." }); }); }, [refresh]);
  const pending = requests.filter((item) => item.status === "pending");
  const act = async (id: string, status: "approved" | "rejected") => {
    const classification = classifications[id];
    if (workspace === "WAIS" && (!classification || !decisions[id])) {
      setFeedback({ type: "error", message: "Select an Attendance Classification and Leave Decision before submitting the review." });
      return;
    }
    setBusy(id); setFeedback(null);
    try { await reviewLeaveRequest(id, status, remarks[id] ?? "", workspace === "WAIS" ? classification as AttendanceClassification : undefined); await refresh(); window.dispatchEvent(new Event("attendance-notifications-changed")); setFeedback({ type: "success", message: `Leave request ${status}.` }); }
    catch (error) { setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not review leave request." }); }
    finally { setBusy(null); }
  };
  return <div className="space-y-6">
    {feedback && <AlertMessage tone={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />}
    <Card><SectionHeader icon={<Palmtree className="h-5 w-5" />} iconTone="info" title="Pending Leave Requests" description="Approve or reject leave without directly editing employee balances." />{pending.length ? <ul className="mt-5 space-y-3">{pending.map((item) => <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><div className="flex items-center gap-3"><EmployeeAvatar employeeId={item.employeeId} name={item.employeeName} /><div><p className="font-semibold text-slate-900">{item.employeeName}</p><p className="text-xs text-slate-500">{formatLeaveDate(item.leaveDate)} · {formatLeaveTime(item.startTime)}–{formatLeaveTime(item.endTime)} · {formatLeaveRequestDuration(item.leaveDate, item.startTime, item.endTime, item.durationMinutes)}</p></div></div><Badge tone="warning">{formatLeaveStatus(item.status)}</Badge></div><div className="mt-3 grid gap-1 text-sm text-slate-700 sm:grid-cols-2"><p><span className="text-slate-500">Reason:</span> {item.reason}</p><p><span className="text-slate-500">Informed:</span> {item.informedParties.join(", ") || "Not recorded"}</p><p><span className="text-slate-500">Submitted:</span> {formatLeaveDate(item.submittedAt.slice(0, 10))}</p></div>{workspace === "WAIS" && <div className="mt-4 grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"><div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Attendance Classification</p><div className="flex gap-2"><Button type="button" variant={classifications[item.id] === "excused" ? "success" : "secondary"} onClick={() => setClassifications({ ...classifications, [item.id]: "excused" })}>Excused</Button><Button type="button" variant={classifications[item.id] === "unexcused" ? "warning" : "secondary"} onClick={() => setClassifications({ ...classifications, [item.id]: "unexcused" })}>Unexcused</Button></div></div><div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Leave Decision</p><div className="flex gap-2"><Button type="button" variant={decisions[item.id] === "approved" ? "success" : "secondary"} onClick={() => setDecisions({ ...decisions, [item.id]: "approved" })}>Approved</Button><Button type="button" variant={decisions[item.id] === "rejected" ? "danger" : "secondary"} onClick={() => setDecisions({ ...decisions, [item.id]: "rejected" })}>Rejected</Button></div></div></div>}<div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]"><Input placeholder="Review Remarks (optional)" value={remarks[item.id] ?? ""} onChange={(event) => setRemarks({ ...remarks, [item.id]: event.target.value })} /><Button variant="success" disabled={busy === item.id || (workspace === "WAIS" && (!classifications[item.id] || !decisions[item.id]))} onClick={() => void act(item.id, workspace === "WAIS" ? decisions[item.id] as "approved" | "rejected" : "approved")}>{workspace === "WAIS" ? "Submit Review" : "Approve"}</Button>{workspace !== "WAIS" && <Button variant="danger" disabled={busy === item.id} onClick={() => void act(item.id, "rejected")}>Reject</Button>}</div></li>)}</ul> : <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="No pending leave requests" bordered={false} />}</Card>
    {loading ? <Card><p className="text-sm text-slate-500">Loading leave registry…</p></Card> : <LeaveRegistry employees={activeEmployees} requests={requests} adjustments={adjustments} year={year} onYearChange={setYear} showRejectedRequests={hrScope === "MAIN"} />}
  </div>;
}
