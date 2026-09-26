import { supabase } from "../lib/supabase";
import type { Workspace } from "./employeeService";

export type LeaveStatus = "pending" | "approved" | "rejected";
export type AttendanceClassification = "excused" | "unexcused";

export type LeaveRequest = {
  id: string;
  workspace: Workspace;
  employeeId: string;
  employeeName: string;
  leaveDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  informedParties: string[];
  reason: string;
  status: LeaveStatus;
  attendanceClassification: AttendanceClassification | null;
  submittedBy: string;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewRemarks: string | null;
};

export type EmployeeLeaveAdjustment = {
  id: string;
  workspace: Workspace;
  employeeId: string;
  leaveYear: number;
  adjustmentMinutes: number;
  remarks: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function throwServiceError(error: { message?: string } | null, fallback: string): asserts error is null {
  if (error) throw new Error(error.message || fallback);
}

function mapLeave(row: Record<string, unknown>): LeaveRequest {
  return {
    id: String(row.id),
    workspace: row.workspace as Workspace,
    employeeId: String(row.employee_id),
    employeeName: String(row.employee_name),
    leaveDate: String(row.leave_date),
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    durationMinutes: Number(row.duration_minutes),
    informedParties: Array.isArray(row.informed_parties) ? row.informed_parties.filter((item): item is string => typeof item === "string") : [],
    reason: String(row.reason),
    status: row.status as LeaveStatus,
    attendanceClassification: row.attendance_classification === "excused" || row.attendance_classification === "unexcused" ? row.attendance_classification : null,
    submittedBy: String(row.submitted_by),
    submittedAt: String(row.submitted_at),
    reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by),
    reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at),
    reviewRemarks: row.review_remarks == null ? null : String(row.review_remarks),
  };
}

export async function listLeaveRequests(workspace: Workspace): Promise<LeaveRequest[]> {
  const { data, error } = await requireClient().from("leave_requests").select("*").eq("workspace", workspace).eq("is_deleted", false).order("leave_date", { ascending: false });
  throwServiceError(error, "Could not load leave requests.");
  return (data ?? []).map((row) => mapLeave(row));
}

export async function listEmployeeLeaveAdjustments(workspace: Workspace): Promise<EmployeeLeaveAdjustment[]> {
  const { data, error } = await requireClient().from("employee_leave_adjustments").select("*").eq("workspace", workspace).order("leave_year", { ascending: false });
  throwServiceError(error, "Could not load leave adjustments.");
  return (data ?? []).map((row) => ({
    id: String(row.id),
    workspace: row.workspace as Workspace,
    employeeId: String(row.employee_id),
    leaveYear: Number(row.leave_year),
    adjustmentMinutes: Number(row.adjustment_minutes),
    remarks: row.remarks == null ? null : String(row.remarks),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export async function setEmployeeRemainingLeave(input: { employeeId: string; leaveYear: number; remainingMinutes: number; remarks: string }) {
  const { error } = await requireClient().rpc("set_employee_remaining_leave", {
    p_employee_id: input.employeeId,
    p_leave_year: input.leaveYear,
    p_remaining_minutes: input.remainingMinutes,
    p_remarks: input.remarks.trim() || null,
  });
  throwServiceError(error, "Could not save remaining leave.");
}

export async function cancelPendingLeaveRequest(id: string) {
  const { error } = await requireClient().rpc("cancel_pending_leave_request", { p_id: id });
  throwServiceError(error, "Could not cancel leave request.");
}

export async function removeLeaveRequest(id: string, reason: string) {
  const { error } = await requireClient().rpc("remove_leave_request", { p_id: id, p_reason: reason.trim() });
  throwServiceError(error, "Could not remove leave request.");
}

export async function submitLeaveRequest(input: {
  employeeId: string;
  leaveDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  informedParties: string[];
  reason: string;
}) {
  const { data, error } = await requireClient().rpc("submit_leave_request", {
    p_employee_id: input.employeeId,
    p_leave_date: input.leaveDate,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_duration_minutes: input.durationMinutes,
    p_informed: input.informedParties,
    p_reason: input.reason,
  });
  throwServiceError(error, "Could not submit leave request.");
  return String(data);
}

export async function reviewLeaveRequest(id: string, status: "approved" | "rejected", remarks: string, classification?: AttendanceClassification) {
  const functionName = classification ? "review_leave_request_main" : "review_leave_request";
  const args = classification
    ? { p_id: id, p_classification: classification, p_status: status, p_remarks: remarks.trim() || null }
    : { p_id: id, p_status: status, p_remarks: remarks.trim() || null };
  const { error } = await requireClient().rpc(functionName, args);
  throwServiceError(error, "Could not review leave request.");
}
