import { supabase } from "../../lib/supabase";
import type {
  AbsentRecord,
  Exemption,
  GeneratedUndertime,
  LateRecord,
  UndertimeRecord,
  UploadedAttendanceFile,
} from "../context/AttendanceContext";

type Workspace = "APP" | "WAIS";

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
    supabase.from("uploaded_files").select("*").eq("workspace", workspace),
    supabase.from("late_records").select("*").eq("workspace", workspace),
    supabase.from("generated_undertimes").select("*").eq("workspace", workspace),
    supabase.from("exemptions").select("*").eq("workspace", workspace),
    supabase.from("absences").select("*").eq("workspace", workspace),
    supabase.from("manual_undertimes").select("*").eq("workspace", workspace),
    supabase.from("memo_reads").select("*").eq("workspace", workspace),
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

export async function saveUploadedAttendanceFile(
  workspace: Workspace,
  fileName: string,
  lateRecords: LateRecord[],
  generatedUndertimes: GeneratedUndertime[]
) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const { data: insertedFile, error: fileError } = await supabase
    .from("uploaded_files")
    .insert({
      workspace,
      file_name: fileName,
    })
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

export async function deleteUploadedAttendanceFile(fileId: string) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const { error: lateError } = await supabase
    .from("late_records")
    .delete()
    .eq("source_file_id", fileId);

  if (lateError) throw lateError;

  const { error: undertimeError } = await supabase
    .from("generated_undertimes")
    .delete()
    .eq("source_file_id", fileId);

  if (undertimeError) throw undertimeError;

  const { error } = await supabase.from("uploaded_files").delete().eq("id", fileId);

  if (error) throw error;
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

export async function deleteExemptionRecord(id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.from("exemptions").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteManualUndertimeRecord(id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.from("manual_undertimes").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteAbsencesByMonthFromDatabase(
  workspace: Workspace,
  monthKey: string
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { start, end } = getMonthRange(monthKey);

  const { error } = await supabase
    .from("absences")
    .delete()
    .eq("workspace", workspace)
    .gte("work_date", start)
    .lt("work_date", end);

  if (error) throw error;
}

export async function deleteExemptionsByMonthFromDatabase(
  workspace: Workspace,
  monthKey: string
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { start, end } = getMonthRange(monthKey);

  const { error } = await supabase
    .from("exemptions")
    .delete()
    .eq("workspace", workspace)
    .gte("work_date", start)
    .lt("work_date", end);

  if (error) throw error;
}

export async function deleteManualUndertimesByMonthFromDatabase(
  workspace: Workspace,
  monthKey: string
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { start, end } = getMonthRange(monthKey);

  const { error } = await supabase
    .from("manual_undertimes")
    .delete()
    .eq("workspace", workspace)
    .gte("work_date", start)
    .lt("work_date", end);

  if (error) throw error;
}

export async function deleteAttendanceAdjustmentsByDates(
  workspace: Workspace,
  dates: string[]
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const dbDates = dates.map(toDbDate);

  if (dbDates.length === 0) return;

  const tables = ["exemptions", "absences", "manual_undertimes"];

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("workspace", workspace)
      .in("work_date", dbDates);

    if (error) throw error;
  }
}

export async function saveMemoReads(workspace: Workspace, names: string[]) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));

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
    const { error } = await supabase.from(table).delete().eq("workspace", workspace);
    if (error) throw error;
  }
}
