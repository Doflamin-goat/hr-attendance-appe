// =============================================================================
// Manual late records service.
//
// Isolated CRUD + recycle-bin helpers for the `manual_late_records` table
// (migration 005). Follows the same soft-delete + recycle-bin bookkeeping
// pattern as the other attendance tables.
// =============================================================================

import { supabase } from "../lib/supabase";
import type { ManualLateRecord } from "../context/AttendanceContext";

type Workspace = "APP" | "WAIS";

type SoftDeleteMeta = {
  batchId?: string;
  reason?: string;
};

async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "42P01" || e.code === "PGRST205") return true;
  return /relation .* does not exist/i.test(e.message ?? "");
}

function toDisplayDate(value: string): string {
  if (!value) return new Date().toLocaleDateString("en-US");
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US");
}

function rowId(value: unknown): string {
  return String(value ?? "");
}

function mapRow(row: Record<string, unknown>): ManualLateRecord {
  return {
    id: rowId(row.id),
    name: String(row.employee_name ?? ""),
    date: toDisplayDate(String(row.work_date ?? "")),
    timeIn: String(row.time_in ?? ""),
    officialStartTime:
      typeof row.official_start_time === "string"
        ? row.official_start_time
        : null,
    graceMinutes: Number(row.grace_minutes ?? 6),
    minutesLate: Number(row.minutes_late ?? 0),
    secondsLate: Number(row.seconds_late ?? 0),
    totalSecondsLate: Number(row.total_seconds_late ?? 0),
    reason: typeof row.reason === "string" ? row.reason : null,
    sourceType: String(row.source_type ?? "manual-entry"),
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Active (non-deleted) manual late records for the given workspace.
 * Degrades to an empty list when the `manual_late_records` relation does
 * not exist yet (migration 005 not yet applied).
 */
export async function loadManualLateRecords(
  workspace: Workspace
): Promise<ManualLateRecord[]> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase
    .from("manual_late_records")
    .select("*")
    .eq("workspace", workspace)
    .eq("is_deleted", false)
    .order("work_date", { ascending: false });

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }

  return (data ?? []).map(mapRow);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface AddManualLateInput {
  workspace: Workspace;
  name: string;
  workDate: string;                    // ISO yyyy-mm-dd
  timeIn: string;                      // 12h display, e.g. "8:11:01 AM"
  officialStartTime: string | null;    // "HH:mm"
  graceMinutes: number;
  minutesLate: number;
  secondsLate: number;
  totalSecondsLate: number;
  reason: string | null;
  sourceType?: string;
}

export async function addManualLateRecord(
  input: AddManualLateInput
): Promise<ManualLateRecord> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const createdBy = await getCurrentUserId();

  const { data, error } = await supabase
    .from("manual_late_records")
    .insert({
      workspace: input.workspace,
      employee_name: input.name,
      work_date: input.workDate,
      time_in: input.timeIn,
      official_start_time: input.officialStartTime,
      grace_minutes: input.graceMinutes,
      minutes_late: input.minutesLate,
      seconds_late: input.secondsLate,
      total_seconds_late: input.totalSecondsLate,
      reason: input.reason,
      source_type: input.sourceType ?? "manual-entry",
      created_by: createdBy,
    })
    .select("*")
    .single();

  if (error) throw error;
  return mapRow(data);
}

// ---------------------------------------------------------------------------
// Soft-delete + Recycle Bin operations
// ---------------------------------------------------------------------------

export async function softDeleteManualLateRecord(
  id: string,
  meta: SoftDeleteMeta = {}
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const deletedBy = await getCurrentUserId();

  const { error } = await supabase
    .from("manual_late_records")
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
      deleted_batch_id: meta.batchId ?? null,
      deleted_reason: meta.reason ?? "manual_late_deleted",
      restored_at: null,
      restored_by: null,
      removed_from_recycle_bin: false,
      removed_from_recycle_bin_at: null,
      removed_from_recycle_bin_by: null,
    })
    .eq("id", id)
    .eq("is_deleted", false);

  if (error) throw error;
}

export async function restoreManualLateRecord(id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const restoredBy = await getCurrentUserId();

  const { error } = await supabase
    .from("manual_late_records")
    .update({
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
      deleted_batch_id: null,
      deleted_reason: null,
      restored_at: new Date().toISOString(),
      restored_by: restoredBy,
      removed_from_recycle_bin: false,
      removed_from_recycle_bin_at: null,
      removed_from_recycle_bin_by: null,
    })
    .eq("id", id)
    .eq("is_deleted", true);

  if (error) throw error;
}

export async function removeManualLateRecordFromRecycleBin(id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const removedBy = await getCurrentUserId();

  const { error } = await supabase
    .from("manual_late_records")
    .update({
      removed_from_recycle_bin: true,
      removed_from_recycle_bin_at: new Date().toISOString(),
      removed_from_recycle_bin_by: removedBy,
    })
    .eq("id", id)
    .eq("is_deleted", true);

  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Recycle bin listing (soft-deleted rows that are still in the bin)
// ---------------------------------------------------------------------------

export async function loadDeletedManualLateRecords(workspace: Workspace) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase
    .from("manual_late_records")
    .select("*")
    .eq("workspace", workspace)
    .eq("is_deleted", true)
    .eq("removed_from_recycle_bin", false)
    .order("deleted_at", { ascending: false });

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }

  return data ?? [];
}
