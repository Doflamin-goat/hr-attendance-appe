import { supabase } from "../lib/supabase";
import type {
  AbsentRecord,
  Exemption,
  GeneratedUndertime,
  LateRecord,
  UndertimeRecord,
  UploadedAttendanceFile,
} from "../context/AttendanceContext";

type Workspace = "APP" | "WAIS";

const ATTENDANCE_STORAGE_BUCKET = "attendance-files";

function rowId(value: unknown) {
  return String(value ?? "");
}

function toDisplayDate(value: string) {
  if (!value) return new Date().toLocaleDateString("en-US");
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US");
}

function toDbDate(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getMonthRange(monthKey: string) {
  const [yearValue, monthValue] = monthKey.split("-");
  const year = Number(yearValue);
  const month = Number(monthValue);

  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonthDate = new Date(year, month, 1);
  const end = `${nextMonthDate.getFullYear()}-${String(
    nextMonthDate.getMonth() + 1
  ).padStart(2, "0")}-01`;

  return { start, end };
}

function sortByDateTime<T extends { date: string; timeIn?: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const aTime = new Date(`${a.date} ${a.timeIn ?? ""}`).getTime();
    const bTime = new Date(`${b.date} ${b.timeIn ?? ""}`).getTime();
    return bTime - aTime;
  });
}

// ---------------------------------------------------------------------------
// Recycle-bin helpers
// ---------------------------------------------------------------------------

export function createDeleteBatchId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback, fine for batch grouping
  return `b-${Date.now().toString(16)}-${Math.random()
    .toString(16)
    .slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Format any error thrown by Supabase (PostgrestError, AuthError, Storage
 * error) or by JavaScript into a single readable string. Supabase errors
 * are plain objects so `error instanceof Error` is `false`, which causes
 * naive catch blocks to drop the real message.
 *
 * Detects the "column does not exist" case (Postgres SQLSTATE 42703 /
 * PostgREST PGRST204) and tells the user that migration 003 still needs
 * to be applied.
 */
export function describeSupabaseError(error: unknown): string {
  if (!error) return "Unknown error.";

  if (typeof error === "string") return error;

  if (error instanceof Error && error.message) return error.message;

  if (typeof error === "object") {
    const e = error as {
      message?: string;
      code?: string;
      details?: string;
      hint?: string;
      status?: number;
      error?: string;
    };

    const looksLikeMissingColumn =
      e.code === "42703" ||
      e.code === "PGRST204" ||
      /column .* does not exist/i.test(e.message ?? "") ||
      /column .* does not exist/i.test(e.details ?? "");

    if (looksLikeMissingColumn) {
      return `Database schema is missing required columns (${
        e.message ?? "column does not exist"
      }). Run supabase/migrations/003_attendance_soft_delete.sql and 004_recycle_bin_soft_hide.sql in the Supabase SQL editor, then refresh.`;
    }

    const pieces = [
      e.message ?? e.error,
      e.code ? `code: ${e.code}` : null,
      e.details ? `details: ${e.details}` : null,
      e.hint ? `hint: ${e.hint}` : null,
    ].filter(Boolean);

    if (pieces.length > 0) return pieces.join(" — ");
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

type SoftDeleteMeta = {
  batchId?: string;
  reason?: string;
};

function buildSoftDeletePatch(
  meta: SoftDeleteMeta,
  deletedBy: string | null
): Record<string, unknown> {
  return {
    is_deleted: true,
    deleted_at: new Date().toISOString(),
    deleted_by: deletedBy,
    deleted_batch_id: meta.batchId ?? null,
    deleted_reason: meta.reason ?? null,
    restored_at: null,
    restored_by: null,
    // a freshly-deleted record is always visible in the Recycle Bin
    removed_from_recycle_bin: false,
    removed_from_recycle_bin_at: null,
    removed_from_recycle_bin_by: null,
  };
}

function buildRestorePatch(restoredBy: string | null): Record<string, unknown> {
  return {
    is_deleted: false,
    deleted_at: null,
    deleted_by: null,
    deleted_batch_id: null,
    deleted_reason: null,
    restored_at: new Date().toISOString(),
    restored_by: restoredBy,
    // restoring also un-hides — defensive in case the row was hidden
    removed_from_recycle_bin: false,
    removed_from_recycle_bin_at: null,
    removed_from_recycle_bin_by: null,
  };
}

function buildRemoveFromRecycleBinPatch(
  removedBy: string | null
): Record<string, unknown> {
  return {
    removed_from_recycle_bin: true,
    removed_from_recycle_bin_at: new Date().toISOString(),
    removed_from_recycle_bin_by: removedBy,
  };
}

// ---------------------------------------------------------------------------
// Active data loader
// ---------------------------------------------------------------------------

export async function loadAttendanceData(workspace: Workspace) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const [
    uploadedFilesResult,
    lateRecordsResult,
    generatedUndertimesResult,
    exemptionsResult,
    absencesResult,
    manualUndertimesResult,
    memoReadsResult,
  ] = await Promise.all([
    supabase
      .from("uploaded_files")
      .select("*")
      .eq("workspace", workspace)
      .eq("is_deleted", false),
    supabase
      .from("late_records")
      .select("*")
      .eq("workspace", workspace)
      .eq("is_deleted", false),
    supabase
      .from("generated_undertimes")
      .select("*")
      .eq("workspace", workspace)
      .eq("is_deleted", false),
    supabase
      .from("exemptions")
      .select("*")
      .eq("workspace", workspace)
      .eq("is_deleted", false),
    supabase
      .from("absences")
      .select("*")
      .eq("workspace", workspace)
      .eq("is_deleted", false),
    supabase
      .from("manual_undertimes")
      .select("*")
      .eq("workspace", workspace)
      .eq("is_deleted", false),
    supabase
      .from("memo_reads")
      .select("*")
      .eq("workspace", workspace)
      .eq("is_deleted", false),
  ]);

  if (uploadedFilesResult.error) throw uploadedFilesResult.error;
  if (lateRecordsResult.error) throw lateRecordsResult.error;
  if (generatedUndertimesResult.error) throw generatedUndertimesResult.error;
  if (exemptionsResult.error) throw exemptionsResult.error;
  if (absencesResult.error) throw absencesResult.error;
  if (manualUndertimesResult.error) throw manualUndertimesResult.error;
  if (memoReadsResult.error) throw memoReadsResult.error;

  const fileMap = new Map<string, UploadedAttendanceFile>();

  (uploadedFilesResult.data ?? []).forEach((file) => {
    const id = rowId(file.id);

    fileMap.set(id, {
      id,
      fileName: file.file_name ?? file.filename ?? file.name ?? "Uploaded File",
      uploadedAt: file.uploaded_at ?? file.created_at ?? new Date().toISOString(),
      lateRecords: [],
      generatedUndertimes: [],
    });
  });

  (lateRecordsResult.data ?? []).forEach((record) => {
    const sourceFileId = rowId(record.source_file_id);

    const mappedRecord: LateRecord = {
      id: rowId(record.id),
      name: record.employee_name,
      date: toDisplayDate(record.work_date),
      timeIn: record.time_in ?? "",
      minutesLate: record.minutes_late ?? 0,
      secondsLate: record.seconds_late ?? 0,
      totalSecondsLate: record.total_seconds_late ?? 0,
      sourceFileId,
      sourceFileName: record.source_file_name ?? "",
    };

    const file = fileMap.get(sourceFileId);

    if (file) {
      file.lateRecords.push(mappedRecord);
    }
  });

  (generatedUndertimesResult.data ?? []).forEach((record) => {
    const sourceFileId = rowId(record.source_file_id);

    const mappedRecord: GeneratedUndertime = {
      id: rowId(record.id),
      name: record.employee_name,
      date: toDisplayDate(record.work_date),
      timeIn: record.time_in ?? "",
      sourceFileId,
      sourceFileName: record.source_file_name ?? "",
    };

    const file = fileMap.get(sourceFileId);

    if (file) {
      file.generatedUndertimes.push(mappedRecord);
    }
  });

  const uploadedFiles = Array.from(fileMap.values())
    .map((file) => ({
      ...file,
      lateRecords: sortByDateTime(file.lateRecords),
      generatedUndertimes: sortByDateTime(file.generatedUndertimes),
    }))
    .sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

  const exemptions: Exemption[] = (exemptionsResult.data ?? []).map((item) => ({
    id: rowId(item.id),
    name: item.employee_name,
    date: toDisplayDate(item.work_date),
    reason: item.reason,
    minutesLate: item.minutes_late ?? undefined,
  }));

  const absences: AbsentRecord[] = (absencesResult.data ?? []).map((item) => ({
    id: rowId(item.id),
    name: item.employee_name,
    date: toDisplayDate(item.work_date),
    reason: item.reason,
  }));

  const manualUndertimes: UndertimeRecord[] = (
    manualUndertimesResult.data ?? []
  ).map((item) => ({
    id: rowId(item.id),
    name: item.employee_name,
    date: toDisplayDate(item.work_date),
    reason: item.reason,
    undertimeHours: item.undertime_hours,
    sourceLateRecordId: item.source_late_record_id ?? undefined,
    originalTimeIn: item.original_time_in ?? undefined,
    sourceType: item.source_type ?? undefined,
    isManualOverride: item.is_manual_override ?? false,
  }));

  const readMemoEmployeeNames = (memoReadsResult.data ?? []).map(
    (item) => item.employee_name
  );

  return {
    fileName: uploadedFiles[0]?.fileName ?? "",
    uploadedFiles,
    exemptions,
    absences,
    manualUndertimes,
    readMemoEmployeeNames,
  };
}

// ---------------------------------------------------------------------------
// Upload (with optional raw .xlsx Storage backup)
// ---------------------------------------------------------------------------

async function tryUploadOriginalFile(
  workspace: Workspace,
  fileName: string,
  file?: File | null
): Promise<string | null> {
  if (!supabase || !file) return null;

  try {
    const safeName = fileName.replace(/[^\w.\-]+/g, "_");
    const path = `${workspace}/${Date.now()}-${safeName}`;

    const { error } = await supabase.storage
      .from(ATTENDANCE_STORAGE_BUCKET)
      .upload(path, file, {
        upsert: false,
        contentType:
          file.type ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    if (error) {
      const message = error.message ?? String(error);
      const bucketMissing =
        /bucket not found/i.test(message) ||
        /the resource was not found/i.test(message);

      if (bucketMissing) {
        // Bucket creation is optional — uploads must succeed without it.
        console.info(
          `Storage bucket "${ATTENDANCE_STORAGE_BUCKET}" not configured; ` +
            `skipping raw .xlsx backup for ${fileName}.`
        );
      } else {
        console.warn(
          `Skipping Supabase Storage backup for ${fileName}: ${message}`
        );
      }
      return null;
    }

    return path;
  } catch (error) {
    console.warn(
      "Supabase Storage backup failed:",
      describeSupabaseError(error)
    );
    return null;
  }
}

export async function saveUploadedAttendanceFile(
  workspace: Workspace,
  fileName: string,
  lateRecords: LateRecord[],
  generatedUndertimes: GeneratedUndertime[],
  originalFile?: File | null
) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const storagePath = await tryUploadOriginalFile(
    workspace,
    fileName,
    originalFile ?? null
  );

  const insertPayload: Record<string, unknown> = {
    workspace,
    file_name: fileName,
  };
  if (storagePath) {
    insertPayload.storage_path = storagePath;
  }

  const { data: insertedFile, error: fileError } = await supabase
    .from("uploaded_files")
    .insert(insertPayload)
    .select("*")
    .single();

  if (fileError) throw fileError;

  const sourceFileId = rowId(insertedFile.id);

  const lateRows = lateRecords.map((record) => ({
    workspace,
    employee_name: record.name,
    work_date: toDbDate(record.date),
    time_in: record.timeIn,
    minutes_late: record.minutesLate,
    seconds_late: record.secondsLate,
    total_seconds_late: record.totalSecondsLate,
    source_file_id: sourceFileId,
    source_file_name: fileName,
  }));

  const undertimeRows = generatedUndertimes.map((record) => ({
    workspace,
    employee_name: record.name,
    work_date: toDbDate(record.date),
    time_in: record.timeIn,
    source_file_id: sourceFileId,
    source_file_name: fileName,
  }));

  if (lateRows.length > 0) {
    const { error } = await supabase.from("late_records").insert(lateRows);
    if (error) throw error;
  }

  if (undertimeRows.length > 0) {
    const { error } = await supabase
      .from("generated_undertimes")
      .insert(undertimeRows);

    if (error) throw error;
  }

  return sourceFileId;
}

// ---------------------------------------------------------------------------
// Soft deletes (the old hard-delete API names are preserved, behaviour swapped)
// ---------------------------------------------------------------------------

export async function deleteUploadedAttendanceFile(
  fileId: string,
  meta: SoftDeleteMeta = {}
) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const deletedBy = await getCurrentUserId();
  const batchId = meta.batchId ?? createDeleteBatchId();
  const reason = meta.reason ?? "uploaded_file_deleted";
  const patch = buildSoftDeletePatch({ batchId, reason }, deletedBy);

  const { error: lateError } = await supabase
    .from("late_records")
    .update(patch)
    .eq("source_file_id", fileId)
    .eq("is_deleted", false);

  if (lateError) throw lateError;

  const { error: undertimeError } = await supabase
    .from("generated_undertimes")
    .update(patch)
    .eq("source_file_id", fileId)
    .eq("is_deleted", false);

  if (undertimeError) throw undertimeError;

  const { error } = await supabase
    .from("uploaded_files")
    .update(patch)
    .eq("id", fileId)
    .eq("is_deleted", false);

  if (error) throw error;

  return batchId;
}

export async function saveExemptionRecord(workspace: Workspace, exemption: Exemption) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase.from("exemptions").insert({
    workspace,
    employee_name: exemption.name,
    work_date: toDbDate(exemption.date),
    reason: exemption.reason,
    minutes_late: exemption.minutesLate ?? null,
  });

  if (error) throw error;
}

export async function saveAbsenceRecord(workspace: Workspace, absence: AbsentRecord) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase.from("absences").insert({
    workspace,
    employee_name: absence.name,
    work_date: toDbDate(absence.date),
    reason: absence.reason,
  });

  if (error) throw error;
}

export async function saveManualUndertimeRecord(
  workspace: Workspace,
  undertime: UndertimeRecord
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase.from("manual_undertimes").insert({
    workspace,
    employee_name: undertime.name,
    work_date: toDbDate(undertime.date),
    reason: undertime.reason,
    undertime_hours: undertime.undertimeHours,
    source_late_record_id: undertime.sourceLateRecordId ?? null,
    original_time_in: undertime.originalTimeIn ?? null,
    source_type: undertime.sourceType ?? null,
    is_manual_override: undertime.isManualOverride ?? false,
  });

  if (error) throw error;
}

export async function deleteExemptionRecord(
  id: string,
  meta: SoftDeleteMeta = {}
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const deletedBy = await getCurrentUserId();
  const patch = buildSoftDeletePatch(
    { ...meta, reason: meta.reason ?? "exemption_deleted" },
    deletedBy
  );

  const { error } = await supabase
    .from("exemptions")
    .update(patch)
    .eq("id", id)
    .eq("is_deleted", false);

  if (error) throw error;
}

export async function deleteManualUndertimeRecord(
  id: string,
  meta: SoftDeleteMeta = {}
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const deletedBy = await getCurrentUserId();
  const patch = buildSoftDeletePatch(
    { ...meta, reason: meta.reason ?? "manual_undertime_deleted" },
    deletedBy
  );

  const { error } = await supabase
    .from("manual_undertimes")
    .update(patch)
    .eq("id", id)
    .eq("is_deleted", false);

  if (error) throw error;
}

export async function deleteAbsenceRecord(
  id: string,
  meta: SoftDeleteMeta = {}
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const deletedBy = await getCurrentUserId();
  const patch = buildSoftDeletePatch(
    { ...meta, reason: meta.reason ?? "absence_deleted" },
    deletedBy
  );

  const { error } = await supabase
    .from("absences")
    .update(patch)
    .eq("id", id)
    .eq("is_deleted", false);

  if (error) throw error;
}

export async function deleteAbsencesByMonthFromDatabase(
  workspace: Workspace,
  monthKey: string,
  meta: SoftDeleteMeta = {}
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { start, end } = getMonthRange(monthKey);

  const deletedBy = await getCurrentUserId();
  const batchId = meta.batchId ?? createDeleteBatchId();
  const patch = buildSoftDeletePatch(
    { batchId, reason: meta.reason ?? "month_deleted" },
    deletedBy
  );

  const { error } = await supabase
    .from("absences")
    .update(patch)
    .eq("workspace", workspace)
    .eq("is_deleted", false)
    .gte("work_date", start)
    .lt("work_date", end);

  if (error) throw error;
  return batchId;
}

export async function deleteExemptionsByMonthFromDatabase(
  workspace: Workspace,
  monthKey: string,
  meta: SoftDeleteMeta = {}
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { start, end } = getMonthRange(monthKey);

  const deletedBy = await getCurrentUserId();
  const batchId = meta.batchId ?? createDeleteBatchId();
  const patch = buildSoftDeletePatch(
    { batchId, reason: meta.reason ?? "month_deleted" },
    deletedBy
  );

  const { error } = await supabase
    .from("exemptions")
    .update(patch)
    .eq("workspace", workspace)
    .eq("is_deleted", false)
    .gte("work_date", start)
    .lt("work_date", end);

  if (error) throw error;
  return batchId;
}

export async function deleteManualUndertimesByMonthFromDatabase(
  workspace: Workspace,
  monthKey: string,
  meta: SoftDeleteMeta = {}
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { start, end } = getMonthRange(monthKey);

  const deletedBy = await getCurrentUserId();
  const batchId = meta.batchId ?? createDeleteBatchId();
  const patch = buildSoftDeletePatch(
    { batchId, reason: meta.reason ?? "month_deleted" },
    deletedBy
  );

  const { error } = await supabase
    .from("manual_undertimes")
    .update(patch)
    .eq("workspace", workspace)
    .eq("is_deleted", false)
    .gte("work_date", start)
    .lt("work_date", end);

  if (error) throw error;
  return batchId;
}

export async function deleteAttendanceAdjustmentsByDates(
  workspace: Workspace,
  dates: string[],
  meta: SoftDeleteMeta = {}
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const dbDates = dates.map(toDbDate);

  if (dbDates.length === 0) return meta.batchId ?? null;

  const deletedBy = await getCurrentUserId();
  const batchId = meta.batchId ?? createDeleteBatchId();
  const patch = buildSoftDeletePatch(
    { batchId, reason: meta.reason ?? "uploaded_file_cascade" },
    deletedBy
  );

  const tables = ["exemptions", "absences", "manual_undertimes"];

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .update(patch)
      .eq("workspace", workspace)
      .eq("is_deleted", false)
      .in("work_date", dbDates);

    if (error) throw error;
  }

  return batchId;
}

export async function saveMemoReads(workspace: Workspace, names: string[]) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const uniqueNames = Array.from(
    new Set(names.map((name) => name.trim()).filter(Boolean))
  );

  if (uniqueNames.length === 0) return;

  const rows = uniqueNames.map((employeeName) => ({
    workspace,
    employee_name: employeeName,
  }));

  const { error } = await supabase.from("memo_reads").insert(rows);

  if (error) throw error;
}

export async function clearWorkspaceAttendanceData(workspace: Workspace) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const deletedBy = await getCurrentUserId();
  const batchId = createDeleteBatchId();
  const patch = buildSoftDeletePatch(
    { batchId, reason: "workspace_cleared" },
    deletedBy
  );

  const tables = [
    "memo_reads",
    "manual_undertimes",
    "absences",
    "exemptions",
    "generated_undertimes",
    "late_records",
    "uploaded_files",
  ];

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .update(patch)
      .eq("workspace", workspace)
      .eq("is_deleted", false);

    if (error) throw error;
  }

  return batchId;
}

// ---------------------------------------------------------------------------
// Trash / Recycle Bin loader
// ---------------------------------------------------------------------------

export type DeletedRecord<T> = T & {
  deletedAt: string | null;
  deletedReason: string | null;
  deletedBatchId: string | null;
};

export type DeletedUploadedFileRow = DeletedRecord<{
  id: string;
  fileName: string;
  uploadedAt: string;
  lateCount: number;
  undertimeCount: number;
  storagePath: string | null;
}>;

export type DeletedManualHrType = "exemption" | "absence" | "manual_undertime";

export type DeletedManualHrRow = DeletedRecord<{
  id: string;
  type: DeletedManualHrType;
  name: string;
  date: string;
  reason: string;
  details: string | null;
}>;

export interface DeletedAttendanceData {
  uploadedFiles: DeletedUploadedFileRow[];
  manualHrRecords: DeletedManualHrRow[];
}

const ALL_ATTENDANCE_TABLES = [
  "uploaded_files",
  "late_records",
  "generated_undertimes",
  "exemptions",
  "absences",
  "manual_undertimes",
  "memo_reads",
] as const;

/**
 * Load only the uploaded-file rows that are currently visible in the
 * Recycle Bin (in Trash AND not yet hidden via "Remove from Recycle Bin").
 * Cascade rows (lates / undertimes / exemptions / absences / manual
 * undertimes / memo_reads) live in the database but never surface in
 * the UI — they ride with the uploaded file via deleted_batch_id and
 * source_file_id.
 */
export async function loadDeletedAttendanceData(
  workspace: Workspace
): Promise<DeletedAttendanceData> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const [
    filesResult,
    latesResult,
    undertimesResult,
    exemptionsResult,
    absencesResult,
    manualUndertimesResult,
  ] = await Promise.all([
    supabase
      .from("uploaded_files")
      .select("*")
      .eq("workspace", workspace)
      .eq("is_deleted", true)
      .eq("removed_from_recycle_bin", false)
      .order("deleted_at", { ascending: false }),
    supabase
      .from("late_records")
      .select("source_file_id")
      .eq("workspace", workspace)
      .eq("is_deleted", true)
      .eq("removed_from_recycle_bin", false),
    supabase
      .from("generated_undertimes")
      .select("source_file_id")
      .eq("workspace", workspace)
      .eq("is_deleted", true)
      .eq("removed_from_recycle_bin", false),
    supabase
      .from("exemptions")
      .select("*")
      .eq("workspace", workspace)
      .eq("is_deleted", true)
      .eq("removed_from_recycle_bin", false)
      .order("deleted_at", { ascending: false }),
    supabase
      .from("absences")
      .select("*")
      .eq("workspace", workspace)
      .eq("is_deleted", true)
      .eq("removed_from_recycle_bin", false)
      .order("deleted_at", { ascending: false }),
    supabase
      .from("manual_undertimes")
      .select("*")
      .eq("workspace", workspace)
      .eq("is_deleted", true)
      .eq("removed_from_recycle_bin", false)
      .order("deleted_at", { ascending: false }),
  ]);

  if (filesResult.error) throw filesResult.error;
  if (latesResult.error) throw latesResult.error;
  if (undertimesResult.error) throw undertimesResult.error;
  if (exemptionsResult.error) throw exemptionsResult.error;
  if (absencesResult.error) throw absencesResult.error;
  if (manualUndertimesResult.error) throw manualUndertimesResult.error;

  const lateCountByFile = new Map<string, number>();
  (latesResult.data ?? []).forEach((row) => {
    const key = rowId(row.source_file_id);
    lateCountByFile.set(key, (lateCountByFile.get(key) ?? 0) + 1);
  });

  const undertimeCountByFile = new Map<string, number>();
  (undertimesResult.data ?? []).forEach((row) => {
    const key = rowId(row.source_file_id);
    undertimeCountByFile.set(key, (undertimeCountByFile.get(key) ?? 0) + 1);
  });

  const uploadedFiles: DeletedUploadedFileRow[] = (filesResult.data ?? []).map(
    (file) => {
      const id = rowId(file.id);
      return {
        id,
        fileName:
          file.file_name ?? file.filename ?? file.name ?? "Uploaded File",
        uploadedAt:
          file.uploaded_at ?? file.created_at ?? new Date().toISOString(),
        lateCount: lateCountByFile.get(id) ?? 0,
        undertimeCount: undertimeCountByFile.get(id) ?? 0,
        storagePath: file.storage_path ?? null,
        deletedAt: file.deleted_at ?? null,
        deletedReason: file.deleted_reason ?? null,
        deletedBatchId: file.deleted_batch_id ?? null,
      };
    }
  );

  const manualHrRecords: DeletedManualHrRow[] = [];

  (exemptionsResult.data ?? []).forEach((item) => {
    manualHrRecords.push({
      id: rowId(item.id),
      type: "exemption",
      name: item.employee_name ?? "",
      date: toDisplayDate(item.work_date),
      reason: item.reason ?? "",
      details: null,
      deletedAt: item.deleted_at ?? null,
      deletedReason: item.deleted_reason ?? null,
      deletedBatchId: item.deleted_batch_id ?? null,
    });
  });

  (absencesResult.data ?? []).forEach((item) => {
    manualHrRecords.push({
      id: rowId(item.id),
      type: "absence",
      name: item.employee_name ?? "",
      date: toDisplayDate(item.work_date),
      reason: item.reason ?? "",
      details: null,
      deletedAt: item.deleted_at ?? null,
      deletedReason: item.deleted_reason ?? null,
      deletedBatchId: item.deleted_batch_id ?? null,
    });
  });

  (manualUndertimesResult.data ?? []).forEach((item) => {
    manualHrRecords.push({
      id: rowId(item.id),
      type: "manual_undertime",
      name: item.employee_name ?? "",
      date: toDisplayDate(item.work_date),
      reason: item.reason ?? "",
      details: item.undertime_hours ?? null,
      deletedAt: item.deleted_at ?? null,
      deletedReason: item.deleted_reason ?? null,
      deletedBatchId: item.deleted_batch_id ?? null,
    });
  });

  manualHrRecords.sort((a, b) => {
    const aTime = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
    const bTime = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
    return bTime - aTime;
  });

  return { uploadedFiles, manualHrRecords };
}

const MANUAL_HR_TABLE_BY_TYPE: Record<DeletedManualHrType, string> = {
  exemption: "exemptions",
  absence: "absences",
  manual_undertime: "manual_undertimes",
};

export async function restoreManualHrRecord(
  type: DeletedManualHrType,
  id: string
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const restoredBy = await getCurrentUserId();
  const patch = buildRestorePatch(restoredBy);

  const { error } = await supabase
    .from(MANUAL_HR_TABLE_BY_TYPE[type])
    .update(patch)
    .eq("id", id)
    .eq("is_deleted", true);

  if (error) throw error;
}

export async function removeManualHrRecordFromRecycleBin(
  type: DeletedManualHrType,
  id: string
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const removedBy = await getCurrentUserId();
  const patch = buildRemoveFromRecycleBinPatch(removedBy);

  const { error } = await supabase
    .from(MANUAL_HR_TABLE_BY_TYPE[type])
    .update(patch)
    .eq("id", id)
    .eq("is_deleted", true);

  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Recycle Bin actions (batch-first, with source_file_id fallback)
// ---------------------------------------------------------------------------

async function lookupDeletedFileBatchId(
  fileId: string
): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("uploaded_files")
    .select("deleted_batch_id")
    .eq("id", fileId)
    .eq("is_deleted", true)
    .maybeSingle();

  if (error || !data) return null;
  return (data.deleted_batch_id as string | null) ?? null;
}

async function applyPatchByBatchId(
  patch: Record<string, unknown>,
  batchId: string
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  for (const table of ALL_ATTENDANCE_TABLES) {
    const { error } = await supabase
      .from(table)
      .update(patch)
      .eq("deleted_batch_id", batchId)
      .eq("is_deleted", true);

    if (error) throw error;
  }
}

async function applyPatchByFileFallback(
  patch: Record<string, unknown>,
  fileId: string
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  // late_records + generated_undertimes share source_file_id
  const { error: lateError } = await supabase
    .from("late_records")
    .update(patch)
    .eq("source_file_id", fileId)
    .eq("is_deleted", true);
  if (lateError) throw lateError;

  const { error: undertimeError } = await supabase
    .from("generated_undertimes")
    .update(patch)
    .eq("source_file_id", fileId)
    .eq("is_deleted", true);
  if (undertimeError) throw undertimeError;

  // the file row itself
  const { error: fileError } = await supabase
    .from("uploaded_files")
    .update(patch)
    .eq("id", fileId)
    .eq("is_deleted", true);
  if (fileError) throw fileError;
}

/**
 * Restore everything that was moved to Trash together with this uploaded
 * file. Uses the deleted_batch_id if present, otherwise falls back to
 * restoring the file row plus late_records / generated_undertimes by
 * source_file_id.
 */
export async function restoreUploadedFileBatch(fileId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const restoredBy = await getCurrentUserId();
  const patch = buildRestorePatch(restoredBy);

  const batchId = await lookupDeletedFileBatchId(fileId);

  if (batchId) {
    await applyPatchByBatchId(patch, batchId);
    // Also cover the file row itself in case it doesn't carry the same
    // batch id (defensive).
    const { error } = await supabase
      .from("uploaded_files")
      .update(patch)
      .eq("id", fileId)
      .eq("is_deleted", true);
    if (error) throw error;
  } else {
    await applyPatchByFileFallback(patch, fileId);
  }
}

/**
 * Soft-hide everything that belongs to this uploaded file's delete batch
 * from the Recycle Bin UI. Rows remain in the database for emergency
 * retrieval — nothing is hard-deleted.
 */
export async function removeUploadedFileBatchFromRecycleBin(fileId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const removedBy = await getCurrentUserId();
  const patch = buildRemoveFromRecycleBinPatch(removedBy);

  const batchId = await lookupDeletedFileBatchId(fileId);

  if (batchId) {
    await applyPatchByBatchId(patch, batchId);
    const { error } = await supabase
      .from("uploaded_files")
      .update(patch)
      .eq("id", fileId)
      .eq("is_deleted", true);
    if (error) throw error;
  } else {
    await applyPatchByFileFallback(patch, fileId);
  }
}
