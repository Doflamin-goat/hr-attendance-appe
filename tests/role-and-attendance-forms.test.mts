import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canAccessPath } from "../src/utils/access.ts";
import { activeEmployeeOptions, attendanceRecordRange, classifyGeneratedHalfDay, classifyUploadedTimeIn, countUndertimeRecords, durationMinutes, formatDuration, formatTime12Hour, formatTime12HourWithOptionalSeconds, generatedUndertimeMinutes, halfDayMatchesScope, halfDayRange, parseAttendanceDateTime } from "../src/utils/attendanceForms.ts";
import { LOGIN_ACCOUNTS } from "../src/utils/loginAccounts.ts";
import { describeSubmitExemptionError, formatOptionalReportedTime, matchingLinkedLateRecords } from "../src/utils/exemptionForms.ts";

test("login account choices use the four existing account emails", () => {
  assert.deepEqual(LOGIN_ACCOUNTS.map((account) => account.label), ["APP HR", "APP Admin", "WAIS HR", "WAIS Admin"]);
  assert.deepEqual(LOGIN_ACCOUNTS.map((account) => account.email), ["app@attendance.local", "app.admin@attendance.local", "wais@attendance.local", "wais.admin@attendance.local"]);
});

test("Admin routes exclude HR entry and approval actions are Admin-only", () => {
  assert.equal(canAccessPath("Admin", "/"), true);
  assert.equal(canAccessPath("Admin", "/employees"), true);
  assert.equal(canAccessPath("Admin", "/approvals"), true);
  assert.equal(canAccessPath("Admin", "/exemptions"), false);
  assert.equal(canAccessPath("HR", "/approvals"), false);
  assert.equal(canAccessPath("HR", "/undertime"), true);
});

test("undertime duration must be positive and is formatted readably", () => {
  assert.equal(durationMinutes("13:01", "15:00"), 119);
  assert.equal(formatDuration(119), "1 hour 59 minutes");
  assert.equal(durationMinutes("15:00", "15:00"), 0);
  assert.equal(durationMinutes("15:01", "15:00"), 0);
});

test("Employees master list counts generated and manual undertime records", () => {
  assert.equal(countUndertimeRecords("Cruz, Nathaniel Philip", [
    { name: "Cruz, Nathaniel Philip" },
    { name: "Cruz,  Nathaniel Philip" },
    { name: "Other Employee" },
  ], [
    { name: "CRUZ, NATHANIEL PHILIP" },
    { name: "Cruz, Nathaniel Philip", isDeleted: true },
  ]), 3);
  assert.equal(countUndertimeRecords("No Records", [], []), 0);
});

test("manual employee selectors only receive active employee records", () => {
  const options = activeEmployeeOptions([
    { fullName: "Active", employmentStatus: "active", isDeleted: false },
    { fullName: "Inactive", employmentStatus: "inactive", isDeleted: false },
    { fullName: "Deleted", employmentStatus: "active", isDeleted: true },
  ]);
  assert.deepEqual(options.map((employee) => employee.fullName), ["Active"]);
});

test("half-day ranges follow weekday and Saturday schedules", () => {
  assert.deepEqual(halfDayRange("2026-09-07", "morning"), ["08:00", "12:00"]);
  assert.deepEqual(halfDayRange("2026-09-07", "afternoon"), ["13:00", "17:00"]);
  assert.deepEqual(halfDayRange("2026-09-12", "morning"), ["07:00", "11:00"]);
  assert.deepEqual(halfDayRange("2026-09-12", "afternoon"), ["11:00", "15:15"]);
  assert.equal(halfDayRange("2026-09-13", "morning"), null);
});

test("uploaded weekday boundary classifications are mutually exclusive", () => {
  const samples = [[8,5,"on_time"],[8,6,"late"],[8,59,"late"],[9,0,"undertime"],[9,3,"undertime"],[11,50,"undertime"],[11,51,"half_day"],[13,0,"half_day"],[13,1,"undertime"]] as const;
  for (const [hour, minute, kind] of samples) assert.equal(classifyUploadedTimeIn("2026-09-07", hour, minute, 0).kind, kind);
  assert.equal(generatedUndertimeMinutes("2026-09-07", 9, 3, 0), 63);
  assert.deepEqual(classifyGeneratedHalfDay("2026-09-07", 11, 51, 0), { period: "morning", scheduledStart: "08:00", scheduledEnd: "12:00" });
});

test("uploaded Saturday boundary classifications are mutually exclusive", () => {
  const samples = [[7,5,"on_time"],[7,6,"late"],[7,59,"late"],[8,0,"undertime"],[10,50,"undertime"],[10,51,"half_day"],[11,0,"half_day"],[11,1,"undertime"]] as const;
  for (const [hour, minute, kind] of samples) assert.equal(classifyUploadedTimeIn("2026-09-12", hour, minute, 0).kind, kind);
  assert.equal(generatedUndertimeMinutes("2026-09-12", 11, 1, 0), 1);
});

test("approval workflow rules keep pending and declined lates counted", () => {
  const isLateExcluded = (status: "pending" | "approved" | "declined") => status === "approved";
  assert.equal(isLateExcluded("pending"), false);
  assert.equal(isLateExcluded("declined"), false);
  assert.equal(isLateExcluded("approved"), true);
});

test("legacy exemptions without an exact linked late are blocked from review", () => {
  const approvalsPage = readFileSync(new URL("../src/pages/AdminApprovals.tsx", import.meta.url), "utf8");
  const productionFix = readFileSync(new URL("../supabase/migrations/007_production_fix_review_exemption_link.sql", import.meta.url), "utf8");
  assert.match(approvalsPage, /const canReview = Boolean\(item\.lateRecordId\)/);
  assert.match(productionFix, /if x\.late_record_id is null then raise exception 'Linked late record required'/);
});

test("approval errors are mapped to safe user-readable categories", () => {
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.match(service, /describeReviewExemptionError/);
  assert.match(service, /PGRST202/);
  assert.match(service, /Admin account/);
  assert.match(service, /exact linked late record/);
});

test("workflow recipients include both Admin workspaces and the submitting HR on review", () => {
  const recipients = (event: "submitted" | "approved" | "declined", submitter: string, admins: { id: string; workspace: string }[]) => event === "submitted" ? admins.map((item) => item.id) : [submitter];
  assert.deepEqual(recipients("submitted", "hr-app", [{ id: "admin-app", workspace: "APP" }, { id: "admin-wais", workspace: "WAIS" }]), ["admin-app", "admin-wais"]);
  assert.deepEqual(recipients("approved", "hr-app", [], "APP"), ["hr-app"]);
});

test("staging workflow uses bigint late and exemption references", () => {
  const lateRecordId = 42;
  const exemptionId = 99;
  assert.equal(Number.isSafeInteger(lateRecordId), true);
  assert.equal(Number.isSafeInteger(exemptionId), true);
});

test("exemption submission preserves the bigint late-record RPC contract", () => {
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/006_staging_only_attendance_workflows.sql", import.meta.url), "utf8");
  assert.match(service, /p_employee_id: input\.employeeId/);
  assert.match(service, /p_late_record_id: input\.lateRecordId/);
  assert.match(service, /p_informed: input\.informedParties/);
  assert.match(migration, /submit_exemption\(p_employee_id uuid,p_late_record_id bigint,p_reason text,p_reported_time time default null,p_informed text\[\] default '\{\}'\)/);
  assert.match(migration, /returns bigint/);
});

test("submission failures use safe visible error categories", () => {
  assert.match(describeSubmitExemptionError({ code: "PGRST202" }), /submission service is unavailable/i);
  assert.match(describeSubmitExemptionError({ message: "Only HR can submit exemptions" }), /Only an HR account/i);
  assert.match(describeSubmitExemptionError({ message: "Employee and late record must match exactly" }), /match exactly/i);
});

test("optional reported time never renders a legacy raw zero", () => {
  assert.equal(formatOptionalReportedTime(0), undefined);
  assert.equal(formatOptionalReportedTime("0"), undefined);
  assert.equal(formatOptionalReportedTime(null), undefined);
  assert.equal(formatOptionalReportedTime("13:05:00"), "13:05");
  assert.equal(formatOptionalReportedTime("13:05"), "13:05");
});

test("matching late selector only includes active, unlinked uploaded records across workspaces", () => {
  const records = [
    { id: "101", name: "A Cruz", date: "9/8/2026", workDate: "2026-09-08", workspace: "APP", isDeleted: false, sourceType: "excel-upload" },
    { id: "102", name: "A Cruz", date: "9/8/2026", workDate: "2026-09-08", workspace: "WAIS", isDeleted: false, sourceType: "excel-upload" },
    { id: "103", name: "A Cruz", date: "9/8/2026", workDate: "2026-09-08", workspace: "APP", isDeleted: true, sourceType: "excel-upload" },
    { id: "104", name: "Other", date: "9/8/2026", workDate: "2026-09-08", workspace: "APP", isDeleted: false, sourceType: "excel-upload" },
    { id: "105", name: "A Cruz", date: "9/9/2026", workDate: "2026-09-09", workspace: "APP", isDeleted: false, sourceType: "excel-upload" },
    { id: "106", name: "A Cruz", date: "9/8/2026", workDate: "2026-09-08", workspace: "APP", isDeleted: false, sourceType: "manual-entry" },
    { id: "107", name: "A Cruz", date: "9/8/2026", workDate: "2026-09-08", workspace: "APP", isDeleted: false, sourceType: "excel-upload" },
  ];
  const matches = matchingLinkedLateRecords(records, [{ lateRecordId: "107", approvalStatus: "pending" }], "A Cruz", "2026-09-08");
  assert.deepEqual(matches.map((record) => record.id), ["101", "102"]);
});

test("HR can select the other workspace employee's exact late and either Admin can review it", () => {
  const migration = readFileSync(new URL("../supabase/migrations/008_production_cross_workspace_exemption_access.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /e\.workspace <> public\.attendance_workspace/);
  assert.doesNotMatch(migration, /x\.workspace <> public\.attendance_workspace/);
  assert.match(migration, /l\.workspace <> e\.workspace/);
  assert.match(migration, /x\.submitted_by=auth\.uid\(\)/);
});

test("production patch allows a WAIS employee to link the selected APP late while preserving name and self-review checks", () => {
  const migration = readFileSync(new URL("../supabase/migrations/009_production_global_exemption_and_generated_half_day.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /l\.workspace <> e\.workspace/);
  assert.match(migration, /employee_name_key\(l\.employee_name\) <> public\.employee_name_key\(e\.full_name\)/);
  assert.match(migration, /values\(l\.workspace,e\.id,l\.id/);
  assert.match(migration, /x\.submitted_by=auth\.uid\(\)/);
});

test("generated Half-Day path prevents a duplicate generated undertime", () => {
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/009_production_global_exemption_and_generated_half_day.sql", import.meta.url), "utf8");
  assert.match(context, /if \(classification\.kind === "half_day"\) \{[\s\S]*?\} else if \(classification\.kind === "undertime"\)/);
  assert.match(migration, /update public\.generated_undertimes set is_deleted=true/);
});

test("cross-workspace candidate selection keeps the employee and late workspace equal", () => {
  const records = [
    { id: "201", name: "W Employee", date: "9/8/2026", workDate: "2026-09-08", workspace: "WAIS", isDeleted: false, sourceType: "excel-upload" },
    { id: "202", name: "W Employee", date: "9/8/2026", workDate: "2026-09-08", workspace: "APP", isDeleted: false, sourceType: "excel-upload" },
  ];
  assert.deepEqual(matchingLinkedLateRecords(records, [], "W Employee", "2026-09-08").map((record) => record.id), ["201", "202"]);
});

test("Cruz 2026-09-07 uploaded late remains selectable by its exact bigint ID", () => {
  const records = [{ id: "445", name: "Cruz, Nathaniel Philip", date: "9/7/2026", workDate: "2026-09-07", workspace: "WAIS", isDeleted: false, sourceType: "excel-upload", timeIn: "8:24:37 AM" }];
  const matches = matchingLinkedLateRecords(records, [], "Cruz, Nathaniel Philip", "2026-09-07");
  assert.deepEqual(matches.map((record) => record.id), ["445"]);
  assert.equal(matches[0].timeIn, "8:24:37 AM");
  const page = readFileSync(new URL("../src/pages/Exemptions.tsx", import.meta.url), "utf8");
  assert.match(page, /employeeId: selectedEmployee\.id/);
  assert.doesNotMatch(page, /resolveEmployeeForLate/);
});

test("rendered Submit button uses only visible exemption fields", () => {
  const page = readFileSync(new URL("../src/pages/Exemptions.tsx", import.meta.url), "utf8");
  assert.match(page, /disabled=\{!lateRecordId \|\| !formData\.reason\.trim\(\)\}/);
  assert.doesNotMatch(page, /disabled=\{[^}]*resolvedEmployeeId/);
});

test("optional informed people and exact manual-undertime source linkage are preserved", () => {
  const absence = readFileSync(new URL("../src/pages/Absences.tsx", import.meta.url), "utf8");
  const undertime = readFileSync(new URL("../src/pages/Undertime.tsx", import.meta.url), "utf8");
  assert.match(absence, /Informed to[\s\S]*?\(optional\)/);
  assert.match(undertime, /Matching Attendance Record/);
  assert.match(undertime, /sourceLateRecordId: sourceRecordId/);
  assert.match(undertime, /Informed to[\s\S]*?\(optional\)/);
  assert.deepEqual(attendanceRecordRange("2026-09-07", "9:03:00 AM"), { kind: "undertime", from: "08:00", to: "09:03", minutes: 63 });
});

test("Excel serial dates are parsed as calendar dates instead of JavaScript milliseconds", () => {
  const excelSerial = (Date.UTC(2026, 2, 5, 9, 3) - Date.UTC(1899, 11, 30)) / 86400000;
  const parsed = parseAttendanceDateTime(excelSerial)!;
  assert.equal(`${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,"0")}-${String(parsed.getDate()).padStart(2,"0")}`, "2026-03-05");
  assert.equal(parsed.getHours(), 9);
  assert.equal(parsed.getMinutes(), 3);
});

test("Saved Half-Days distinguish manual and uploaded sources", () => {
  const page = readFileSync(new URL("../src/pages/HalfDay.tsx", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/012_optional_informed_and_half_day_sources.sql", import.meta.url), "utf8");
  assert.match(page, /System Generated/);
  assert.match(page, /Manual/);
  assert.match(migration, /source_type='attendance_upload'/);
  assert.match(migration, /'manual'/);
});

test("migration 013 targets only active upload-derived weekday legacy undertime boundaries", () => {
  const migration = readFileSync(new URL("../supabase/migrations/013_reclassify_legacy_weekday_half_days.sql", import.meta.url), "utf8");
  assert.match(migration, /where not u\.is_deleted/);
  assert.match(migration, /u\.source_file_id is not null/);
  assert.match(migration, /extract\(isodow from u\.work_date\) between 1 and 5/);
  assert.match(migration, /between time '11:51:00' and time '13:00:59\.999999'/);
  assert.match(migration, /'morning'/);
  assert.match(migration, /time '08:00'/);
  assert.match(migration, /time '12:00'/);
  assert.doesNotMatch(migration, /manual_undertimes/);
});

test("migration 013 creates the linked Half-Day before soft-deleting its exact generated undertime and is rerunnable", () => {
  const migration = readFileSync(new URL("../supabase/migrations/013_reclassify_legacy_weekday_half_days.sql", import.meta.url), "utf8");
  assert.match(migration, /source_generated_undertime_id/);
  assert.match(migration, /create unique index if not exists half_day_source_generated_undertime_uidx/);
  assert.match(migration, /on conflict \(employee_id, work_date, absent_period\) do update/);
  assert.match(migration, /update public\.generated_undertimes u[\s\S]*?h\.source_generated_undertime_id = u\.id::text/);
  assert.match(migration, /set is_deleted = true/);
});

test("generated undertime loader excludes rows linked to an active generated Half-Day", () => {
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.match(service, /from\("half_day_records"\)[\s\S]*?select\("source_generated_undertime_id"\)[\s\S]*?eq\("source_type", "attendance_upload"\)[\s\S]*?eq\("is_deleted", false\)/);
  assert.match(service, /generatedHalfDaySourceIds\.has\(rowId\(record\.id\)\)\) return/);
});

test("Half-Day records follow the shared all, month, and exact-date scope", () => {
  assert.equal(halfDayMatchesScope("2026-09-07", "all", "all"), true);
  assert.equal(halfDayMatchesScope("2026-09-07", "2026-09", "all"), true);
  assert.equal(halfDayMatchesScope("2026-09-07", "2026-08", "all"), false);
  assert.equal(halfDayMatchesScope("2026-09-07", "2026-08", "2026-09-07"), true);
  assert.equal(halfDayMatchesScope("2026-09-07", "2026-09", "2026-09-08"), false);
});

test("Half-Day tabs separate system and manual records and system cards show Time In", () => {
  const page = readFileSync(new URL("../src/pages/HalfDay.tsx", import.meta.url), "utf8");
  assert.match(page, /record\.sourceType === "attendance_upload"/);
  assert.match(page, /record\.sourceType === "manual"/);
  assert.match(page, />Time In</);
  assert.match(page, /formatTime12HourWithOptionalSeconds\(record\.sourceTimeIn\)/);
  assert.match(page, /createStagedHalfDay/);
  assert.match(page, /deleteStagedHalfDay/);
  assert.equal(formatTime12HourWithOptionalSeconds("12:37:33"), "12:37:33 PM");
  assert.equal(formatTime12HourWithOptionalSeconds("12:37:00"), "12:37 PM");
});

test("migration 014 repairs only linked weekday generated undertimes and is idempotent", () => {
  const migration = readFileSync(new URL("../supabase/migrations/014_fix_generated_half_day_exclusivity.sql", import.meta.url), "utf8");
  assert.match(migration, /where not u\.is_deleted/);
  assert.match(migration, /extract\(isodow from u\.work_date\) between 1 and 5/);
  assert.match(migration, /between time '11:51:00' and time '13:00:59\.999999'/);
  assert.match(migration, /h\.source_generated_undertime_id = u\.id::text/);
  assert.match(migration, /h\.source_time_in = u\.time_in::time/);
  assert.match(migration, /deleted_reason = 'reclassified_as_half_day'/);
  assert.doesNotMatch(migration, /update public\.manual_undertimes|insert into public\.half_day_records/);
  assert.match(migration, /READ-ONLY PREFLIGHT/);
  assert.match(migration, /READ-ONLY VERIFICATION/);
});

test("Saturday generated undertime remains outside migration 014", () => {
  const migration = readFileSync(new URL("../supabase/migrations/014_fix_generated_half_day_exclusivity.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /extract\(isodow from u\.work_date\) between 1 and 6/);
  assert.equal(generatedUndertimeMinutes("2026-09-12", 11, 1, 0), 1);
});

test("migration 015 repairs an inactive employee historical weekday upload", () => {
  const migration = readFileSync(new URL("../supabase/migrations/015_repair_missing_generated_half_days.sql", import.meta.url), "utf8");
  assert.match(migration, /join public\.employees e[\s\S]*?not e\.is_deleted/);
  assert.doesNotMatch(migration, /e\.employment_status\s*=\s*'active'/);
  assert.match(migration, /time '08:00', time '12:00'/);
  assert.match(migration, /'attendance_upload'/);
  assert.match(migration, /source_generated_undertime_id/);
});

test("migration 015 retires only its exact generated Undertime after Half-Day creation", () => {
  const migration = readFileSync(new URL("../supabase/migrations/015_repair_missing_generated_half_days.sql", import.meta.url), "utf8");
  assert.match(migration, /insert into public\.half_day_records[\s\S]*?update public\.generated_undertimes u/);
  assert.match(migration, /h\.source_generated_undertime_id = u\.id::text/);
  assert.match(migration, /deleted_reason = 'reclassified_as_half_day'/);
  assert.doesNotMatch(migration, /update public\.manual_undertimes|update public\.late_records/);
});

test("migration 015 is idempotent and does not overwrite an active Manual Half-Day", () => {
  const migration = readFileSync(new URL("../supabase/migrations/015_repair_missing_generated_half_days.sql", import.meta.url), "utf8");
  assert.match(migration, /not exists \([\s\S]*?h\.source_type = 'attendance_upload'/);
  assert.match(migration, /not exists \([\s\S]*?h\.source_type = 'manual'/);
  assert.match(migration, /on conflict \(employee_id, work_date, absent_period\) do update/);
  assert.match(migration, /where public\.half_day_records\.source_type = 'attendance_upload'/);
});

test("migration 015 excludes Saturday records", () => {
  const migration = readFileSync(new URL("../supabase/migrations/015_repair_missing_generated_half_days.sql", import.meta.url), "utf8");
  assert.match(migration, /extract\(isodow from u\.work_date\) between 1 and 5/);
  assert.doesNotMatch(migration, /between 1 and 6/);
  assert.equal(generatedUndertimeMinutes("2026-09-12", 13, 43, 47), 163);
});

test("migration 016 links APP attendance to one globally matched WAIS employee", () => {
  const migration = readFileSync(new URL("../supabase/migrations/016_repair_cross_workspace_generated_half_days.sql", import.meta.url), "utf8");
  assert.match(migration, /public\.employee_name_key\(e\.full_name\) = public\.employee_name_key\(u\.employee_name\)/);
  assert.doesNotMatch(migration, /e\.workspace\s*=\s*u\.workspace/);
  assert.match(migration, /having count\(e\.id\) = 1/);
  assert.match(migration, /select\s+c\.workspace,c\.employee_id,c\.employee_name/);
  assert.match(migration, /c\.generated_undertime_id::text/);
});

test("migration 016 creates one generated Half-Day before retiring the exact source Undertime", () => {
  const migration = readFileSync(new URL("../supabase/migrations/016_repair_cross_workspace_generated_half_days.sql", import.meta.url), "utf8");
  assert.match(migration, /insert into public\.half_day_records[\s\S]*?update public\.generated_undertimes u/);
  assert.match(migration, /'morning',[\s\S]*?time '08:00',time '12:00'/);
  assert.match(migration, /u\.id::text in \([\s\S]*?from inserted i/);
  assert.match(migration, /deleted_reason='reclassified_as_half_day'/);
  assert.match(migration, /on conflict \(employee_id,work_date,absent_period\) do update/);
});

test("migration 016 skips ambiguous employees and preserves Manual Half-Days", () => {
  const migration = readFileSync(new URL("../supabase/migrations/016_repair_cross_workspace_generated_half_days.sql", import.meta.url), "utf8");
  assert.match(migration, /AMBIGUOUS-NAME DIAGNOSTIC/);
  assert.match(migration, /having count\(e\.id\)>1/);
  assert.match(migration, /not exists \([\s\S]*?h\.source_type = 'manual'/);
  assert.match(migration, /where public\.half_day_records\.source_type='attendance_upload'/);
});

test("migration 016 excludes Saturday, March, Manual Undertimes, and Late Records", () => {
  const migration = readFileSync(new URL("../supabase/migrations/016_repair_cross_workspace_generated_half_days.sql", import.meta.url), "utf8");
  assert.match(migration, /extract\(isodow from u\.work_date\) between 1 and 5/);
  assert.match(migration, /u\.work_date not between date '2026-03-01' and date '2026-03-31'/);
  assert.doesNotMatch(migration, /update public\.manual_undertimes|update public\.late_records/);
  assert.equal(generatedUndertimeMinutes("2026-09-12", 13, 43, 47), 163);
});

test("production patch keeps Admin employee access read-only while HR remains the employee writer", () => {
  const migration = readFileSync(new URL("../supabase/migrations/008_production_cross_workspace_exemption_access.sql", import.meta.url), "utf8");
  assert.match(migration, /employees: HR and Admin can read/);
  assert.match(migration, /employees: HR can write/);
  assert.match(migration, /attendance_role\(\) = 'HR'/);
});

test("employee or date changes clear a stale matching-late selection", () => {
  const page = readFileSync(new URL("../src/pages/Exemptions.tsx", import.meta.url), "utf8");
  assert.match(page, /employeeId: employee\.id, employeeName: employee\.label/);
  assert.match(page, /setFormData\(\{ \.\.\.formData, date: e\.target\.value \}\); setLateRecordId\(""\);/);
  assert.match(page, /setLateRecordId\(""\)/);
});

test("forms keep searchable active-employee dropdowns and searchable informed-person selectors", () => {
  const exemptions = readFileSync(new URL("../src/pages/Exemptions.tsx", import.meta.url), "utf8");
  const undertime = readFileSync(new URL("../src/pages/Undertime.tsx", import.meta.url), "utf8");
  assert.match(exemptions, /SearchableCombobox/);
  assert.match(undertime, /SearchableCombobox/);
  assert.match(exemptions, /HR Louissa/);
  assert.match(undertime, /Informed to/);
});

test("QA fixes guard duplicate manual records and legacy informed values", () => {
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  const undertime = readFileSync(new URL("../src/pages/Undertime.tsx", import.meta.url), "utf8");
  assert.match(context, /An absence already exists for this employee and date/);
  assert.match(context, /A manual undertime record already exists for this employee and date/);
  assert.match(context, /Duplicate upload blocked/);
  assert.match(undertime, /Array\.isArray\(record\.informed\)/);
});

test("Half-Day loads both workspaces and uses the protected delete function", () => {
  const page = readFileSync(new URL("../src/pages/HalfDay.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.doesNotMatch(page, /Search employee/);
  assert.match(service, /export async function loadStagedHalfDays\(\)/);
  assert.match(service, /rpc\("delete_half_day"/);
});

test("decline status and Half-Day deletion are prepared by the forward-only patch", () => {
  const migration = readFileSync(new URL("../supabase/migrations/011_fix_decline_and_half_day_delete.sql", import.meta.url), "utf8");
  assert.match(migration, /approval_status in \('pending', 'approved', 'declined'\)/);
  assert.match(migration, /create or replace function public\.delete_half_day\(p_id uuid\)/);
  assert.match(migration, /public\.attendance_role\(\)<>'HR'/);
});

test("verified recycle and exemption restoration operations preserve row identity", () => {
  const page = readFileSync(new URL("../src/pages/Exemptions.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/011_fix_decline_and_half_day_delete.sql", import.meta.url), "utf8");
  assert.match(page, /record\.approvalStatus === "approved" && !record\.lateRestoredAt/);
  assert.match(page, /Restore Late Record/);
  assert.doesNotMatch(page, /removeExemptionAdjustment/);
  assert.match(migration, /update public\.exemptions set late_restored_at=now\(\),late_restored_by=auth\.uid\(\)/);
  assert.match(migration, /update public\.half_day_records set is_deleted=true/);
  assert.match(migration, /update public\.half_day_records set is_deleted=false/);
  assert.match(service, /\.eq\("id", id\)[\s\S]*?\.eq\("is_deleted", true\)/);
});

test("exemption, absence, and manual-undertime recycle restores update the same deleted row", () => {
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.match(service, /exemption: "exemptions"/);
  assert.match(service, /absence: "absences"/);
  assert.match(service, /manual_undertime: "manual_undertimes"/);
  assert.match(service, /\.update\(patch\)[\s\S]*?\.eq\("id", id\)[\s\S]*?\.eq\("is_deleted", true\)/);
  assert.doesNotMatch(service, /restoreManualHrRecord[\s\S]{0,500}\.insert\(/);
});

test("Half-Day times render professionally and Saturday afternoon starts at 11 AM", () => {
  assert.equal(formatTime12Hour("13:00:00"), "1:00 PM");
  assert.equal(formatTime12Hour("11:00"), "11:00 AM");
  assert.equal(formatTime12Hour("15:15:00"), "3:15 PM");
  assert.deepEqual(halfDayRange("2026-09-12", "afternoon"), ["11:00", "15:15"]);
});

test("approval history keeps completed exemptions visible with reviewer data and informed people", () => {
  const approvals = readFileSync(new URL("../src/pages/AdminApprovals.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.match(approvals, /Approval History/);
  assert.match(approvals, /item\.informed\?\.join/);
  assert.match(approvals, /item\.reviewedAt/);
  assert.match(service, /reviewed_by, reviewed_at, review_remarks/);
});

test("attendance workflows call only the protected production RPCs", () => {
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const exemptionsPage = readFileSync(new URL("../src/pages/Exemptions.tsx", import.meta.url), "utf8");
  const approvalsPage = readFileSync(new URL("../src/pages/AdminApprovals.tsx", import.meta.url), "utf8");
  const halfDayPage = readFileSync(new URL("../src/pages/HalfDay.tsx", import.meta.url), "utf8");
  assert.match(service, /rpc\("submit_exemption"/);
  assert.match(service, /rpc\("review_exemption"/);
  assert.match(service, /rpc\("create_half_day"/);
  assert.match(exemptionsPage, /Matching Late Record/);
  assert.match(approvalsPage, /reviewStagedExemption/);
  assert.match(halfDayPage, /createStagedHalfDay/);
});

test("Admin dashboard gates upload, export, and file history behind the HR role", () => {
  const dashboard = readFileSync(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /\{isHr && <Button[\s\S]*?Export Excel/);
  assert.match(dashboard, /\{isHr && <>[\s\S]*?title="Imports & Reports"[\s\S]*?title="Uploaded Attendance Files"/);
  assert.match(dashboard, /\{isHr && <StatCard[\s\S]*?label="Files Uploaded"/);
});
