import type { AppRole } from "../context/AuthContext";
import { supabase } from "../lib/supabase";

export type AttendanceNotification = { id: string; audience: AppRole; status: "pending" | "approved" | "declined" | "restored"; title: string; employeeName: string; workDate: string; lateTime: string; createdAt: string };

/** Derived inbox: no notification table, trigger, realtime subscription, or read state. */
export async function loadAttendanceNotifications(role: AppRole, workspace: string | null): Promise<AttendanceNotification[]> {
  void workspace;
  if (!supabase) return [];
  let query = supabase.from("exemptions").select("id, employee_name, work_date, approval_status, submitted_by, submitted_at, reviewed_at, late_record_id, late_restored_at").eq("is_deleted", false);
  if (role === "Admin") query = query.eq("approval_status", "pending");
  else {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return [];
    query = query.eq("submitted_by", data.user.id).in("approval_status", ["approved", "declined"]);
  }
  const { data, error } = await query.order(role === "Admin" ? "submitted_at" : "reviewed_at", { ascending: false });
  if (error) return [];
  const lateIds = (data ?? []).map((item) => item.late_record_id).filter((id): id is number => id != null);
  const lateResult = lateIds.length ? await supabase.from("late_records").select("id, time_in").in("id", lateIds) : { data: [], error: null };
  const lateTimes = new Map((lateResult.data ?? []).map((late) => [String(late.id), String(late.time_in ?? "")]));
  return (data ?? []).map((item) => {
    const restored = Boolean(item.late_restored_at);
    const status = restored ? "restored" : item.approval_status as AttendanceNotification["status"];
    return { id: String(item.id), audience: role, status,
      title: restored ? "Late Record Restored" : role === "Admin" ? "Exemption needs approval" : item.approval_status === "approved" ? "Exemption approved" : "Exemption declined",
      employeeName: item.employee_name, workDate: item.work_date, lateTime: lateTimes.get(String(item.late_record_id)) ?? "Not recorded",
      createdAt: item.late_restored_at ?? item.reviewed_at ?? item.submitted_at ?? "" };
  });
}
