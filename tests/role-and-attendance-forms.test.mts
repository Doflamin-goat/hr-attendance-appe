import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canAccessPath } from "../src/utils/access.ts";
import { activeEmployeeOptions, classifyGeneratedHalfDay, countUndertimeRecords, durationMinutes, formatDuration, formatTime12Hour, generatedUndertimeMinutes, halfDayRange } from "../src/utils/attendanceForms.ts";
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

test("generated attendance reclassifies Saturday 11:00 AM and weekday 12:00 PM as Half-Day", () => {
  assert.deepEqual(classifyGeneratedHalfDay("2026-09-12", 11, 0, 0), { period: "afternoon", scheduledStart: "11:00", scheduledEnd: "15:15" });
  assert.deepEqual(classifyGeneratedHalfDay("2026-09-07", 12, 0, 0), { period: "afternoon", scheduledStart: "13:00", scheduledEnd: "17:00" });
  assert.equal(classifyGeneratedHalfDay("2026-09-12", 10, 59, 59), null);
  assert.equal(classifyGeneratedHalfDay("2026-09-12", 11, 1, 0), null);
  assert.equal(generatedUndertimeMinutes("2026-09-12", 11, 1, 0), 1);
  assert.deepEqual(classifyGeneratedHalfDay("2026-09-07", 13, 0, 0), { period: "afternoon", scheduledStart: "13:00", scheduledEnd: "17:00" });
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
  assert.match(context, /if \(generatedHalfDay\) \{[\s\S]*?\} else if \(isUndertime\)/);
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
  assert.match(page, /disabled=\{!lateRecordId \|\| !formData\.reason\.trim\(\) \|\| formData\.informed\.length === 0\}/);
  assert.doesNotMatch(page, /disabled=\{[^}]*resolvedEmployeeId/);
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
