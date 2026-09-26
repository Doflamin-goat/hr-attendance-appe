import type { AppRole } from "../context/AuthContext";
import { supabase } from "../lib/supabase";

export type AttendanceNotification = { id: string; audience: AppRole; status: "pending" | "approved" | "declined" | "rejected" | "restored"; title: string; employeeName: string; workDate: string; lateTime: string; createdAt: string };

/** Derived inbox: no notification table, trigger, realtime subscription, or read state. */
export async function loadAttendanceNotifications(role: AppRole, workspace: string | null): Promise<AttendanceNotification[]> {
  if (!supabase || !workspace) return [];
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];
  let query = supabase.from("exemptions").select("id, employee_name, work_date, approval_status, submitted_by, submitted_at, reviewed_at, late_record_id, late_restored_at").eq("workspace", workspace).eq("is_deleted", false);
  if (role === "Admin") query = query.eq("approval_status", "pending");
  else {
    query = query.eq("submitted_by", userData.user.id).in("approval_status", ["approved", "declined"]);
  }
  const { data, error } = await query.order(role === "Admin" ? "submitted_at" : "reviewed_at", { ascending: false });
  const exemptionRows = error ? [] : data ?? [];
  const lateIds = exemptionRows.map((item) => item.late_record_id).filter((id): id is number => id != null);
  const lateResult = lateIds.length ? await supabase.from("late_records").select("id, time_in").in("id", lateIds) : { data: [], error: null };
  const lateTimes = new Map((lateResult.data ?? []).map((late) => [String(late.id), String(late.time_in ?? "")]));
  const exemptions = exemptionRows.map((item) => {
    const restored = Boolean(item.late_restored_at);
    const status = restored ? "restored" : item.approval_status as AttendanceNotification["status"];
    return { id: `exemption-${item.id}`, audience: role, status,
      title: restored ? "Late Record Restored" : role === "Admin" ? "Exemption needs approval" : item.approval_status === "approved" ? "Exemption approved" : "Exemption declined",
      employeeName: item.employee_name, workDate: item.work_date, lateTime: lateTimes.get(String(item.late_record_id)) ?? "Not recorded",
      createdAt: item.late_restored_at ?? item.reviewed_at ?? item.submitted_at ?? "" };
  });
  let leaveQuery = supabase.from("leave_requests").select("id, employee_name, leave_date, start_time, end_time, status, submitted_by, submitted_at, reviewed_at").eq("workspace", workspace).eq("is_deleted", false);
  if (role === "Admin") leaveQuery = leaveQuery.eq("status", "pending");
  else leaveQuery = leaveQuery.eq("submitted_by", userData.user.id).in("status", ["approved", "rejected"]);
  const leaveResult = await leaveQuery.order(role === "Admin" ? "submitted_at" : "reviewed_at", { ascending: false });
  const leaves: AttendanceNotification[] = leaveResult.error ? [] : (leaveResult.data ?? []).map((item) => ({ id: `leave-${item.id}`, audience: role, status: item.status as AttendanceNotification["status"], title: role === "Admin" ? "Leave request needs approval" : item.status === "approved" ? "Leave request approved" : "Leave request rejected", employeeName: item.employee_name, workDate: item.leave_date, lateTime: `${String(item.start_time).slice(0, 5)}–${String(item.end_time).slice(0, 5)}`, createdAt: item.reviewed_at ?? item.submitted_at ?? "" }));
  return [...exemptions, ...leaves].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
