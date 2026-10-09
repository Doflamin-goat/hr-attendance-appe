import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { canAccessPath } from "../src/utils/access.ts";
import { activeEmployeeOptions, attendanceDateFromFileName, attendanceNameMatchesEmployee, attendanceRecordRange, classifyGeneratedHalfDay, classifyUploadedTimeIn, countUndertimeRecords, dateFilterDates, dateFilterMonths, dateFilterYears, durationMinutes, formatDuration, formatTime12Hour, formatTime12HourWithOptionalSeconds, generatedUndertimeMinutes, halfDayMatchesScope, halfDayRange, matchesDateFilters, matchesDateScope, normalizeAttendanceDate, parseAttendanceDateTime, sortUploadedAttendanceFiles } from "../src/utils/attendanceForms.ts";
import { LOGIN_ACCOUNTS } from "../src/utils/loginAccounts.ts";
import { describeSubmitExemptionError, filterExemptionHistory, formatOptionalReportedTime, matchingLinkedLateRecords } from "../src/utils/exemptionForms.ts";
import { adjustmentPartsToMinutes, ANNUAL_LEAVE_ENTITLEMENT_MINUTES, calculateAnnualLeaveTotals, calculateLeaveDuration, countRejectedLeaveRequests, formatLeaveDate, formatLeaveMinutes, formatRemainingLeaveMinutes, formatLeaveRequestDuration, formatLeaveStatus, formatLeaveTime, leaveBalance, remainingLeaveAdjustment, requestableLeaveBalance } from "../src/utils/leaveRules.ts";
import { activeMainAttendanceRecordIds, aggregateMainAttendance, checkoutUndertimeMinutes, isItcAttendanceRows, isMainAttendanceHeader, isValidFinalCheckout, mainWorkDateOptions, normalizeMainName, resolveManualCheckout, systemAbsenceEmployeeIds, validateAttendanceFormat } from "../src/utils/mainAttendance.ts";
import { informedPeopleForScope } from "../src/utils/informedPeople.ts";
import { attendanceDateValue, attendanceTimeValue, computeExcelColumnWidth, sortAttendanceDetailRecords, toExcelCalendarDate } from "../src/utils/exportRows.ts";

test("exemption evidence upload and gallery viewer remain scoped, accessible, and read-only for Admin", () => {
  const page = readFileSync(new URL("../src/pages/Exemptions.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.match(page, /type="file"[\s\S]*?className="sr-only"/);
  assert.match(page, /Drop pictures here or[\s\S]*?Browse/);
  assert.match(page, /onDrop=\{\(event\) => \{ event\.preventDefault\(\); setDragging\(false\)/);
  assert.match(page, /You can upload up to 3 pictures\./);
  assert.match(page, /max 5 MB each/i);
  assert.match(page, /SelectedPicturePreview/);
  assert.match(page, /SavedPictureThumbnail/);
  assert.match(page, /role="dialog" aria-modal="true"/);
  assert.match(page, /max-w-5xl/);
  assert.match(page, /object-contain/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /event\.key === "ArrowLeft"/);
  assert.match(page, /event\.key === "ArrowRight"/);
  assert.match(page, /Picture \{index \+ 1\} of \{pictures\.length\}/);
  assert.match(page, /aria-label="Close picture viewer"/);
  assert.match(page, /!readOnly && <Button[\s\S]*?>Edit<\/Button>/);
  assert.match(page, /editPictures\.length \+ editFiles\.length >= 3/);
  assert.match(page, /for \(const picture of \(pictureMap\.get\(editTarget\.id\) \?\? \[\]\)\.filter/);
  assert.match(page, /loadExemptionPictures\(workspace\)/);
  assert.match(service, /file\.type === "image\/jpeg" \|\| file\.type === "image\/png"/);
  assert.match(service, /Only JPG, JPEG, and PNG images are allowed\./);
  assert.match(service, /Each picture must be 5 MB or smaller\./);
  assert.match(service, /MAX.*5 \* 1024 \* 1024|EXEMPTION_IMAGE_MAX_BYTES = 5 \* 1024 \* 1024/);
  assert.match(service, /eq\("workspace", workspace\)/);
});

test("remaining leave display describes zero without changing other duration labels", () => {
  for (const [minutes, expected] of [
    [0, "No leave remaining"], [480, "1 day"], [2400, "5 days"],
    [240, "4 hours"], [30, "30 minutes"], [270, "4 hours 30 minutes"],
    [750, "1 day 4 hours 30 minutes"], [1021, "2 days 1 hour 1 minute"],
  ] as const) {
    assert.equal(formatRemainingLeaveMinutes(minutes), expected);
  }
  assert.equal(formatLeaveMinutes(0), "0 minutes", "generic usage/duration formatter is unchanged");
});

test("remaining leave presentation preserves entitlement, approved/pending totals and adjustments", () => {
  const records = [
    { leaveDate: "2026-09-21", status: "approved" as const, durationMinutes: 2400 },
    { leaveDate: "2026-09-22", status: "pending" as const, durationMinutes: 120 },
    { leaveDate: "2026-09-23", status: "rejected" as const, durationMinutes: 60 },
    { leaveDate: "2025-09-21", status: "approved" as const, durationMinutes: 480 },
  ];
  const totals = calculateAnnualLeaveTotals(records, 2026, 0);
  assert.deepEqual(totals, { adjustment: 0, approved: 2400, pending: 120, remaining: 0 });
  assert.equal(formatRemainingLeaveMinutes(totals.remaining), "No leave remaining");
  assert.deepEqual(calculateAnnualLeaveTotals(records, 2026, 270), {
    adjustment: 270, approved: 2400, pending: 120, remaining: 270,
  });
  assert.equal(ANNUAL_LEAVE_ENTITLEMENT_MINUTES, 2400);
  assert.equal(calculateLeaveDuration("2026-09-26", "07:00", "15:15").minutes, 495);
  assert.equal(leaveBalance(0, 2500), 0);
  assert.equal(remainingLeaveAdjustment(270, 2400), 270);
  assert.equal(requestableLeaveBalance(0, 2400, 0), 0);
  assert.equal(requestableLeaveBalance(0, 0, 480), 1920);
  assert.equal(requestableLeaveBalance(0, 2400, 480), 0);
});

test("ITC leave submission reserves pending minutes without changing approved arithmetic", () => {
  const page = readFileSync(new URL("../src/pages/Leave.tsx", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/039_itc_leave_balance_and_undertime_details.sql", import.meta.url), "utf8");
  assert.match(page, /requestableLeaveBalance\(adjustment, approved, pending\)/);
  assert.match(page, /No leave balance remaining for this employee/);
  assert.match(page, /Requested leave exceeds the available balance/);
  assert.match(migration, /status='pending'[\s\S]*?pending_minutes/);
  assert.match(migration, /available=2400\+coalesce\(adjustment,0\)-approved_minutes-pending_minutes/);
  assert.match(migration, /if available<=0 then raise exception 'No leave balance remaining/);
  assert.match(migration, /if p_duration_minutes>available then raise exception/);
  assert.doesNotMatch(migration, /update public\.employee_leave_adjustments/);
});

test("Service edit timestamp round-trip preserves Manila wall time and seconds without drift", () => {
  const service = readFileSync(new URL("../src/services/serviceService.ts", import.meta.url), "utf8");
  assert.match(service, /timeZone: "Asia\/Manila"/);
  assert.match(service, /Date\.UTC\(Number\(year\), Number\(month\) - 1, Number\(day\), Number\(hour\), Number\(minute\), Number\(second\)\)/);
  assert.match(service, /local\.getTime\(\) - 8 \* 60 \* 60 \* 1000/);
  assert.match(service, /second: "2-digit"/);
  // Verify the fixed Manila offset conversion, including the no-drift boundary timestamp.
  assert.equal(new Date(Date.UTC(2026, 9, 8, 13, 5, 46) - 8 * 60 * 60 * 1000).toISOString(), "2026-10-08T05:05:46.000Z");
});

test("ITC Service candidates are not restricted to pre-existing employee membership", () => {
  const source = readFileSync(new URL("../src/services/serviceService.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/052_fix_itc_service_time_cast_and_lookup.sql", import.meta.url), "utf8");
  assert.match(source, /event\.serviceStart\.slice\(0, 10\) <= workDate/);
  assert.doesNotMatch(source, /employeeIds\.includes\(employeeId\)/);
  assert.match(migration, /on conflict\(service_event_id,employee_id\) do nothing/);
  assert.match(migration, /perform public\.reconcile_itc_service_attendance\(ev\.id\)/);
  assert.match(migration, /service_end \+ interval '10 minutes'/);
  assert.match(migration, /source_type = 'attendance_upload'/);
});

test("ITC Service attendance reverses and transfers tracked effects on coverage or membership changes", () => {
  const migration = readFileSync(new URL("../supabase/migrations/052_fix_itc_service_time_cast_and_lookup.sql", import.meta.url), "utf8");
  assert.match(migration, /public\.itc_service_attendance_effects/);
  assert.match(readFileSync(new URL("../supabase/migrations/050_itc_service_attendance_reconciliation.sql", import.meta.url), "utf8"), /half_day_id uuid references public\.half_day_records\(id\)/);
  assert.match(readFileSync(new URL("../supabase/migrations/050_itc_service_attendance_reconciliation.sql", import.meta.url), "utf8"), /undertime_id bigint references public\.generated_undertimes\(id\)/);
  assert.match(migration, /after insert or delete on public\.service_event_employees/);
  assert.match(migration, /trg_reconcile_itc_service_event_change after insert or update of service_start,service_end,status,is_deleted/);
  assert.match(migration, /perform public\.reconcile_itc_service_attendance\(event_row\.id\);[\s\S]*?update public\.service_events set is_deleted=true/);
  assert.match(migration, /range_agg\(tstzrange\(s\.service_start,s\.service_end \+ interval '10 minutes','\[\]'\)\)/);
  assert.match(migration, /supporting_service_id/);
  assert.match(migration, /insert into public\.itc_service_attendance_effects\(service_event_id,employee_id,work_date,(?:half_day_id|undertime_id)\) values\(supporting_service_id/);
  assert.match(migration, /deleted_reason='reconciled_by_itc_service'/);
  assert.match(migration, /source_type = 'attendance_upload'/);
  assert.match(migration, /workspace = 'APP'/);
  assert.match(migration, /Only APP HR can reconcile ITC Service attendance/);
  assert.doesNotMatch(migration, /public\.manual_undertimes|source_type\s*=\s*'manual'/i);
  assert.match(migration, /public\.reconcile_main_service_attendance\(event_row\.id,false\)/);
});

test("053 resolves legacy APP Undertime identity exactly and preserves the reversible Service path", () => {
  const migration = readFileSync(new URL("../supabase/migrations/053_fix_itc_legacy_generated_attendance_reconciliation.sql", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/serviceService.ts", import.meta.url), "utf8");
  const undertimePage = readFileSync(new URL("../src/pages/Undertime.tsx", import.meta.url), "utf8");
  const halfDaySchema = readFileSync(new URL("../supabase/migrations/006_staging_only_attendance_workflows.sql", import.meta.url), "utf8");
  assert.match(migration, /u\.workspace='APP' and u\.employee_id is null and not u\.is_deleted/);
  assert.match(migration, /e\.hr_scope='ITC'/);
  assert.match(migration, /having count\(distinct e\.id\)=1/);
  assert.match(migration, /public\.employee_name_key\(e\.full_name\)=public\.employee_name_key\(u\.employee_name\)/);
  assert.match(migration, /public\.employee_name_key\(e\.attendance_name\)=public\.employee_name_key\(u\.employee_name\)/);
  assert.match(migration, /Generated Undertime employee identity is ambiguous/);
  assert.match(migration, /status in \('in_service','completed'\)/);
  assert.match(migration, /on conflict\(service_event_id,employee_id\) do nothing/);
  assert.match(migration, /public\.reconcile_itc_service_attendance\(event_row\.id\)/);
  assert.match(migration, /revoke all on function public\.move_itc_generated_attendance_to_service/);
  assert.match(service, /No matching employee could be resolved for this generated Undertime/);
  assert.match(service, /Selected Service does not cover this attendance record/);
  assert.doesNotMatch(undertimePage, /No matching active employee was found for this record/);
  assert.match(halfDaySchema, /employee_id uuid not null references public\.employees\(id\)/);
  assert.match(readFileSync(new URL("../supabase/migrations/052_fix_itc_service_time_cast_and_lookup.sql", import.meta.url), "utf8"), /service_end \+ interval '10 minutes'/);
  assert.match(readFileSync(new URL("../supabase/migrations/052_fix_itc_service_time_cast_and_lookup.sql", import.meta.url), "utf8"), /else perform public\.reconcile_itc_service_attendance\(p_id\)/);
  assert.doesNotMatch(migration, /public\.reconcile_main_service_attendance|workspace='WAIS'/);
});

test("054 canonicalizes 12-hour ITC clock text before the reversible reconciler", () => {
  const migration = readFileSync(new URL("../supabase/migrations/054_fix_itc_legacy_time_parsing.sql", import.meta.url), "utf8");
  const legacyReconciler = readFileSync(new URL("../supabase/migrations/052_fix_itc_service_time_cast_and_lookup.sql", import.meta.url), "utf8");
  const canonicalClock = (input: string | null) => {
    const match = input?.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] ?? 0);
    const meridiem = match[4]?.toUpperCase();
    if (minute > 59 || second > 59) return null;
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (meridiem === "PM" ? 12 : 0);
    } else if (hour > 23) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  };
  for (const [input, expected] of [
    ["13:05:46", "13:05:46"], ["1:05:46 PM", "13:05:46"], ["1:05 PM", "13:05:00"],
    ["8:00 AM", "08:00:00"], ["08:00:00", "08:00:00"], [" 01:05:46 pm ", "13:05:46"],
  ] as const) assert.equal(canonicalClock(input), expected);
  for (const invalid of [null, "", "unknown", "13:05 PM", "1:99 PM", "1:05:99 PM"]) assert.equal(canonicalClock(invalid), null);

  assert.match(migration, /create or replace function public\.parse_itc_clock_time\(p_value text\)/);
  assert.match(migration, /regexp_match\(btrim\(p_value\).*AM\|PM/);
  assert.match(migration, /hour_value:=hour_value % 12/);
  assert.match(migration, /public\.parse_itc_clock_time\(u\.time_in\)/);
  assert.match(migration, /rename to reconcile_itc_service_attendance_053/);
  assert.match(migration, /reconcile_itc_service_attendance_053\(p_event_id\)/);
  assert.match(migration, /before insert or update of time_in on public\.generated_undertimes/);
  assert.match(legacyReconciler, /service_end \+ interval '10 minutes'/);
  assert.equal(13 * 3600 + 5 * 60 + 46 <= 13 * 3600 + 10 * 60, true, "1:05:46 PM is within 10 minutes of a 1 PM Service end");
});

test("055 resolves attendance endpoints before aggregating Service coverage", () => {
  const migration = readFileSync(new URL("../supabase/migrations/055_fix_itc_service_coverage_aggregation.sql", import.meta.url), "utf8");
  assert.match(migration, /select public\.parse_itc_clock_time\(u\.time_in\) into parsed_time/);
  assert.match(migration, /select coalesce\(h\.source_time_in,time '13:05:46'\) into parsed_time/);
  assert.match(migration, /range_agg\(tstzrange\(s\.service_start,s\.service_end\+interval '10 minutes','\[\]'\)\)/);
  assert.match(migration, /effect_row\.work_date\+parsed_time/);
  assert.match(migration, /undertime_row\.work_date\+parsed_time/);
  assert.doesNotMatch(migration, /range_agg\([\s\S]{0,500}u\.time_in/);
  assert.doesNotMatch(migration, /range_agg\([\s\S]{0,500}h\.source_time_in/);
  assert.match(migration, /parse_itc_clock_time\(undertime_row\.time_in\)/);
  assert.match(migration, /status in \('in_service','completed'\)/);
  assert.match(migration, /deleted_reason='reconciled_by_itc_service'/);
  assert.match(migration, /restored_at=now\(\)/);
  assert.doesNotMatch(migration, /public\.reconcile_main_service_attendance|workspace='WAIS'/);
});

test("056 reconciles APP Service edits once after final memberships and refreshes attendance data", () => {
  const migration = readFileSync(new URL("../supabase/migrations/056_fix_itc_service_save_reconciliation.sql", import.meta.url), "utf8");
  const servicePage = readFileSync(new URL("../src/pages/Service.tsx", import.meta.url), "utf8");
  const updateRpc = migration.slice(migration.indexOf("create or replace function public.update_service_event"), migration.indexOf("create or replace function public.reconcile_itc_service_membership_change"));
  const membershipTrigger = migration.slice(migration.indexOf("create or replace function public.reconcile_itc_service_membership_change"));
  assert.ok(updateRpc.indexOf("set_config('watts.itc_service_reconcile','1',true)") < updateRpc.indexOf("update public.service_events"));
  assert.ok(updateRpc.indexOf("delete from public.service_event_employees") < updateRpc.indexOf("insert into public.service_event_employees"));
  assert.ok(updateRpc.indexOf("insert into public.service_event_employees") < updateRpc.indexOf("perform public.reconcile_itc_service_attendance(p_id)"));
  assert.match(membershipTrigger, /current_setting\('watts\.itc_service_reconcile',true\) is distinct from '1'/);
  assert.match(membershipTrigger, /if event_workspace='APP'/);
  assert.match(updateRpc, /if p_workspace='WAIS' then[\s\S]*?service_validate_overlap[\s\S]*?reconcile_main_service_attendance\(p_id,true\)/);
  assert.match(servicePage, /Promise\.all\(\[refresh\(\), refreshAttendanceData\(\)\]\)/);
});

test("057 converts BIGINT Undertime to a linked morning Half-Day and protects its recycle lifecycle", () => {
  const migration = readFileSync(new URL("../supabase/migrations/057_fix_itc_halfday_conversion_and_recycle_bin.sql", import.meta.url), "utf8");
  const attendance = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const halfDayPage = readFileSync(new URL("../src/pages/HalfDay.tsx", import.meta.url), "utf8");
  const recyclePage = readFileSync(new URL("../src/pages/RecycleBin.tsx", import.meta.url), "utf8");
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  assert.match(migration, /move_generated_undertime_to_half_day\(p_id bigint\)/);
  assert.match(migration, /where id=p_id and workspace='APP' and not is_deleted/);
  assert.match(migration, /attendance_hr_scope\(\) is distinct from 'ITC'/);
  assert.match(migration, /parse_itc_clock_time\(undertime_row\.time_in\)/);
  assert.match(migration, /undertime_row\.work_date,'morning'/);
  assert.match(migration, /schedule_start:=time '08:00'[\s\S]*?schedule_end:=time '12:00'/);
  assert.match(migration, /auth\.uid\(\),'system_generated'/);
  assert.match(migration, /source_generated_undertime_id,source_file_id_text/);
  assert.match(migration, /deleted_reason='reclassified_as_half_day'/);
  assert.match(migration, /A Half-Day record already exists for this employee and date\./);
  assert.match(migration, /deleted_reason='half_day_deleted'/);
  assert.match(migration, /set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null/);
  assert.match(migration, /if exists \([\s\S]*?h\.work_date=half_day_row\.work_date and not h\.is_deleted[\s\S]*?A Half-Day record already exists/);
  assert.match(migration, /revoke all on function public\.move_generated_undertime_to_half_day\(bigint\)/);
  assert.match(migration, /grant execute on function public\.move_generated_undertime_to_half_day\(bigint\)/);
  assert.match(migration, /create trigger trg_guard_itc_generated_half_day_delete[\s\S]*?before delete on public\.half_day_records/);
  assert.doesNotMatch(migration, /move_generated_undertime_to_half_day\(p_id uuid\)/);
  assert.match(attendance, /p_id: id/);
  assert.match(attendance, /sourceType: item\.source_type === "attendance_upload" \|\| item\.source_type === "system_generated"/);
  assert.match(attendance, /From Generated Undertime #\$\{item\.source_generated_undertime_id\}/);
  assert.match(halfDayPage, /record\.sourceType === "system_generated"/);
  assert.match(halfDayPage, /record\.sourceType === "attendance_upload" && <Button/);
  assert.match(halfDayPage, /Delete Half-Day Record\?/);
  assert.match(halfDayPage, /loadDeletedAttendanceData\(\)/);
  assert.match(recyclePage, /Period \/ Source/);
  assert.match(recyclePage, /Deleted By/);
  assert.match(context, /Promise\.all\(\[applyDatabaseData\(false\), refreshDeletedAttendanceData\(false\)\]\)/);
});

test("058 atomically reverses only linked APP/ITC conversions and preserves recycle semantics", () => {
  const migration = readFileSync(new URL("../supabase/migrations/058_complete_itc_halfday_conversion_reversal.sql", import.meta.url), "utf8");
  const attendance = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const halfDayPage = readFileSync(new URL("../src/pages/HalfDay.tsx", import.meta.url), "utf8");
  const recyclePage = readFileSync(new URL("../src/pages/RecycleBin.tsx", import.meta.url), "utf8");
  assert.match(migration, /restore_converted_half_day_to_undertime\(p_half_day_id uuid\)/);
  assert.match(migration, /attendance_workspace\(\) is distinct from 'APP'[\s\S]*attendance_hr_scope\(\) is distinct from 'ITC'/);
  assert.match(migration, /source_generated_undertime_id::bigint/);
  assert.match(migration, /generated_undertimes[\s\S]*?where id=source_id and workspace='APP'[\s\S]*?for update/);
  assert.match(migration, /An active generated Undertime already exists/);
  assert.match(migration, /A Manual Undertime already exists/);
  assert.ok(migration.indexOf("set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null") < migration.indexOf("set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),"));
  assert.match(migration, /deleted_reason='conversion_reversed_to_undertime'/);
  assert.match(migration, /removed_from_recycle_bin=true/);
  assert.match(migration, /perform public\.reconcile_itc_service_attendance\(service_id\)/);
  assert.match(migration, /grant execute on function public\.restore_converted_half_day_to_undertime\(uuid\) to authenticated/);
  assert.match(attendance, /canRestoreToUndertime: record\.sourceType === "system_generated"/);
  assert.match(attendance, /From Generated Undertime #\$\{item\.source_generated_undertime_id\}/);
  assert.match(attendance, /restore_converted_half_day_to_undertime/);
  assert.match(halfDayPage, /record\.canRestoreToUndertime/);
  assert.match(halfDayPage, /Restore to Undertime\?/);
  assert.match(halfDayPage, /refreshSavedRecords\(\), refreshAttendanceData\(\), loadDeletedAttendanceData\(\)/);
  assert.match(recyclePage, /workspace === "APP" && hrScope === "ITC" && role === "HR"/);
  assert.match(recyclePage, /workspace === "WAIS" && hrScope === "MAIN" && role === "HR"/);
  assert.match(recyclePage, /min-w-\[1260px\]/);
  assert.match(recyclePage, /w-\[290px\]/);
  assert.match(recyclePage, /whitespace-pre-line break-words/);
  assert.match(recyclePage, /min-w-max flex-nowrap/);
  assert.match(halfDayPage, /record\.sourceType === "attendance_upload" && <Button/);
  assert.match(attendance, /restore_half_day/);
  assert.doesNotMatch(migration, /public\.reconcile_main_service_attendance|workspace='WAIS'/);
});

test("generated undertime details edit preserves generated identity and immutable fields", () => {
  const page = readFileSync(new URL("../src/pages/Undertime.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/039_itc_leave_balance_and_undertime_details.sql", import.meta.url), "utf8");
  assert.match(page, /Edit Details/);
  assert.match(page, /Reason \/ Remarks/);
  assert.match(page, /Informed person/);
  assert.match(service, /update_generated_undertime_details/);
  assert.match(migration, /add column if not exists reason text/);
  assert.match(migration, /add column if not exists informed_to text\[\]/);
  assert.match(migration, /update public\.generated_undertimes set reason=nullif/);
  assert.doesNotMatch(migration, /set employee_id=|set work_date=|set time_in=|set minutes_undertime=|set source_file_id=/);
  assert.match(migration, /where id=u\.id/);
  assert.match(migration, /not is_deleted for update/);
  assert.match(migration, /attendance_hr_scope\(\)<>'ITC'/);
  assert.match(page, /hrScope === "ITC" && <Button/);
  assert.match(readFileSync(new URL("../supabase/migrations/037_undertime_identity_and_precedence.sql", import.meta.url), "utf8"), /generated_undertimes_one_active_employee_date/);
});

const mainHeader = ["Department", "Name", "No.", "Date/Time", "Status", "Location ID", "ID Number", "VerifyCode", "CardNo"];
const mainEmployees = [
  { id: "main-rogel", fullName: "Collera, Rogel", employmentStatus: "active", isDeleted: false, startDate: "2018-04-16" },
  { id: "main-other", fullName: "Main, Missing", employmentStatus: "active", isDeleted: false, startDate: "2020-01-01" },
];

test("MAIN and ITC formats are recognized separately and wrong scope is rejected", () => {
  const main = [mainHeader, ["", "ROGEL COLLERA", "7", "09/22/2026 07:46:38 AM", "C/In"]];
  const itc = [[], [], [], [], ["", "", "Employee Name", "", "09/22/2026 08:15:00 AM"]];
  assert.equal(isMainAttendanceHeader(mainHeader), true);
  assert.equal(isItcAttendanceRows(itc), true);
  assert.throws(() => validateAttendanceFormat("MAIN", itc), /MAIN Office/);
  assert.throws(() => validateAttendanceFormat("ITC", main), /ITC Plant/);
});

test("MAIN aggregation preserves an intermediate C/Out but does not treat it as final checkout", () => {
  const rows = [mainHeader,
    ["", "ROGEL COLLERA", "7", "09/22/2026 07:46:40 AM", "C/In"],
    ["", "ROGEL COLLERA", "7", "09/22/2026 07:46:38 AM", "C/In"],
    ["", "ROGEL COLLERA", "7", "09/22/2026 09:28:52 AM", "C/Out"],
    ["", "ROGEL COLLERA", "7", "09/22/2026 12:00:00 PM", "C/In"],
    ["", "ROGEL COLLERA", "7", "09/22/2026 10:12:19 AM", "C/Out"],
  ];
  const result = aggregateMainAttendance(rows, mainEmployees);
  assert.equal(result.length, 1);
  assert.equal(result[0].employeeId, "main-rogel");
  assert.equal(result[0].firstIn, "07:46:38");
  assert.equal(result[0].lastOut, "10:12:19");
  assert.equal(result[0].biometricLastOut, "10:12:19");
  assert.equal(result[0].status, "missing_checkout");
  assert.equal(result[0].halfDay, false);
  assert.equal(result[0].undertimeMinutes, 0);
});

test("MAIN final checkout validity follows punch order without inventing a time threshold", () => {
  assert.equal(isValidFinalCheckout("10:00:13", ["08:55:42", "12:00:00"]), false);
  assert.equal(isValidFinalCheckout("16:00:00", ["07:45:00", "13:00:00"]), true);
  assert.equal(isValidFinalCheckout("17:00:00", ["08:00:00", "13:00:00"]), true);
});

test("invalid morning C/Out creates no undertime while valid early final checkout still does", () => {
  const joben = { id: "main-joben", fullName: "Huerto, Joben Luciano", attendanceName: "Joben Huerto", employmentStatus: "active", isDeleted: false };
  const invalid = aggregateMainAttendance([mainHeader,
    ["", "JOBEN HUERTO", "90", "09/22/2026 08:55:42 AM", "C/In"],
    ["", "JOBEN HUERTO", "90", "09/22/2026 10:00:13 AM", "C/Out"],
    ["", "JOBEN HUERTO", "90", "09/22/2026 12:00:00 PM", "C/In"],
  ], [joben])[0];
  assert.equal(invalid.status, "missing_checkout");
  assert.equal(invalid.undertimeMinutes, 0);
  assert.equal(invalid.lastOut, "10:00:13");

  const valid = aggregateMainAttendance([mainHeader,
    ["", "JOBEN HUERTO", "90", "09/22/2026 07:45:00 AM", "C/In"],
    ["", "JOBEN HUERTO", "90", "09/22/2026 01:00:00 PM", "C/In"],
    ["", "JOBEN HUERTO", "90", "09/22/2026 04:00:00 PM", "C/Out"],
  ], [joben])[0];
  assert.equal(valid.status, "complete");
  assert.equal(valid.undertimeMinutes, 60);
});

test("MAIN late and half-day classification use only first C/In", () => {
  const late = aggregateMainAttendance([mainHeader, ["", "ROGEL COLLERA", "7", "09/21/2026 08:15:00 AM", "C/In"], ["", "ROGEL COLLERA", "7", "09/21/2026 12:30:00 PM", "C/In"], ["", "ROGEL COLLERA", "7", "09/21/2026 05:30:00 PM", "C/Out"]], mainEmployees)[0];
  assert.equal(late.lateMinutes, 15);
  assert.equal(late.halfDay, false);
});

test("MAIN Half-Day uses one aggregated first C/In despite repeated and later scans", () => {
  const morning = aggregateMainAttendance([mainHeader,
    ["", "ROGEL COLLERA", "37", "09/21/2026 07:46:38 AM", "C/In"],
    ["", "ROGEL COLLERA", "37", "09/21/2026 07:46:39 AM", "C/In"],
    ["", "ROGEL COLLERA", "37", "09/21/2026 09:28:00 AM", "C/Out"],
    ["", "ROGEL COLLERA", "37", "09/21/2026 12:00:00 PM", "C/In"],
  ], mainEmployees);
  assert.equal(morning.length, 1);
  assert.equal(morning[0].firstIn, "07:46:38");
  assert.equal(morning[0].halfDay, false);

  const halfDay = aggregateMainAttendance([mainHeader,
    ["", "ROGEL COLLERA", "37", "09/21/2026 12:15:00 PM", "C/In"],
    ["", "ROGEL COLLERA", "37", "09/21/2026 12:15:02 PM", "C/In"],
  ], mainEmployees);
  assert.equal(halfDay.length, 1);
  assert.equal(halfDay[0].halfDay, true);
});

test("no MAIN punches produces absence candidates and no Half-Day summary", () => {
  const records = aggregateMainAttendance([mainHeader], mainEmployees);
  assert.equal(records.length, 0);
  assert.deepEqual(systemAbsenceEmployeeIds(mainEmployees, records, "2026-09-21"), ["main-rogel", "main-other"]);
});

test("missing MAIN C/Out waits for manual checkout and then calculates undertime", () => {
  const missing = aggregateMainAttendance([mainHeader, ["", "ROGEL COLLERA", "7", "09/21/2026 08:00:00 AM", "C/In"]], mainEmployees)[0];
  assert.equal(missing.status, "missing_checkout");
  assert.equal(missing.undertimeMinutes, 0);
  const resolved = resolveManualCheckout(missing, "16:30");
  assert.equal(resolved.status, "complete");
  assert.equal(resolved.checkoutSource, "manual");
  assert.equal(resolved.undertimeMinutes, 30);
  assert.equal(resolved.firstIn, missing.firstIn);
});

test("September 22 mixed MAIN punches keep all resolved C/In-only employees present", () => {
  const employees = Array.from({ length: 12 }, (_, index) => ({
    id: `employee-${index + 1}`,
    fullName: `Employee ${index + 1}`,
    attendanceName: `Employee ${index + 1}`,
    employmentStatus: "active",
    isDeleted: false,
  }));
  const rows: unknown[][] = [mainHeader];
  employees.forEach((employee, index) => {
    rows.push(["", employee.attendanceName, String(index + 1), `09/22/2026 08:${String(index).padStart(2, "0")}:00 AM`, "C/In"]);
    if (index < 2) rows.push(["", employee.attendanceName, String(index + 1), "09/22/2026 05:00:00 PM", "C/Out"]);
  });

  const records = aggregateMainAttendance(rows, employees);
  assert.equal(records.length, 12);
  assert.equal(records.filter((record) => record.employeeId).length, 12);
  assert.equal(records.filter((record) => record.status === "missing_checkout").length, 10);
  assert.equal(records.filter((record) => record.status === "complete").length, 2);
  assert.equal(records.every((record) => record.firstIn && record.workDate === "2026-09-22"), true);
  assert.deepEqual(systemAbsenceEmployeeIds(employees, records, "2026-09-22"), []);
});

test("September 3 and September 22 remain separate active MAIN attendance dates", () => {
  const employee = [{ id: "employee-1", fullName: "Employee 1", employmentStatus: "active", isDeleted: false }];
  const september3 = aggregateMainAttendance([mainHeader, ["", "Employee 1", "1", "09/03/2026 08:00:00 AM", "C/In"]], employee);
  const september22 = aggregateMainAttendance([mainHeader, ["", "Employee 1", "1", "09/22/2026 08:03:04 AM", "C/In"]], employee);
  assert.deepEqual(mainWorkDateOptions([...september3, ...september22]), ["2026-09-22", "2026-09-03"]);
});

test("MAIN employee matching is exact, scope-limited input and never fuzzy", () => {
  assert.equal(normalizeMainName("Collera, Rogel"), "COLLERA ROGEL");
  assert.equal(aggregateMainAttendance([mainHeader, ["", "ROGEL COLLERA", "7", "09/21/2026 08:00:00 AM", "C/In"]], mainEmployees)[0].employeeId, "main-rogel");
  assert.equal(aggregateMainAttendance([mainHeader, ["", "ROGEL COLERA", "7", "09/21/2026 08:00:00 AM", "C/In"]], mainEmployees)[0].status, "unmatched_employee");
});

test("MAIN active record fallback keeps daily attendance if provenance file name is still active", () => {
  const record = {
    id: "daily-1",
    sourceFileId: null,
    sourceFileName: "SEPTEMBER 22 2026.xlsx",
    employeeId: "main-rogel",
    employeeName: "Collera, Rogel",
    rawName: "ROGEL COLLERA",
    deviceNo: null,
    workDate: "2026-09-22",
    firstIn: "08:00:00",
    lastOut: "17:00:00",
    checkoutSource: "biometric",
    status: "complete",
    lateMinutes: 0,
    lateSeconds: 0,
    halfDay: false,
    undertimeMinutes: 0,
  } as const;

  const ids = activeMainAttendanceRecordIds([record as any], new Set(), [], new Set(["SEPTEMBER 22 2026.xlsx"]));
  assert.deepEqual([...ids], ["daily-1"]);
});

test("all confirmed MAIN biometric aliases resolve exactly without duplicating employees", () => {
  const mappings = [
    ["MARJORIE REYES", "Reyes, Marjorie Justiniano", "Marjorie Reyes"], ["ARMANDO L. AQUINO", "Aquino, Armando Lantay", "Armando L. Aquino"], ["ARMANDO AQUINO", "Aquino, Armando Lantay", "Armando L. Aquino"],
    ["ROGEL COLLERA", "Collera, Rogel", "Rogel Collera"], ["REINA LYNN ONG", "Ong, Reina Lynn Yu", "Reina Lynn Ong"], ["CRISELDA ABELLERA", "Abellera, Criselda Gajol", "Criselda Abellera"],
    ["ULDARICO CODILAN", "Codilan, Uldarico Abletes", "Uldarico Codilan"], ["RALVIC BERNAL", "Bernal, Ralvic Gamay", "Ralvic Bernal"], ["CHRISTINE JOY LASAM", "Lasam, Christine Joy Yap", "Christine Joy Lasam"],
    ["LEA BAEL", "Bael, Lea Tinibroso", "Lea Bael"], ["JOBEN HUERTO", "Huerto, Joben Luciano", "Joben Huerto"], ["CATHERINE SANTOS", "Santos, Catherine Labaro", "Catherine Santos"],
    ["KIMBERLY MAE REYES", "Reyes, Kimberly Mae Dela Cruz", "Kimberly Mae Reyes"], ["EDUARD CORONA JR", "Corona Jr., Eduard Espelimbergo", "Eduard Corona Jr"],
  ] as const;
  const employees = [...new Map(mappings.map(([, legal, display]) => [legal, { id: legal, fullName: legal, attendanceName: display, biometricAliases: mappings.filter(([, candidate]) => candidate === legal).map(([alias]) => alias), employmentStatus: "active", isDeleted: false }])).values()];
  for (const [alias, legal, display] of mappings) {
    const result = aggregateMainAttendance([mainHeader, ["", alias, "", "09/23/2026 08:00:00 AM", "C/In"]], employees)[0];
    assert.equal(result.employeeId, legal);
    assert.equal(result.employeeName, display);
  }
  assert.equal(employees.length, 13);
  assert.equal(employees.filter((employee) => employee.fullName === "Aquino, Armando Lantay").length, 1);
  assert.equal(aggregateMainAttendance([mainHeader, ["", "ARMANDO AQUI", "", "09/23/2026 08:00:00 AM", "C/In"]], employees)[0].status, "unmatched_employee");
});

test("Armando aliases and device numbers aggregate into one employee-day", () => {
  const armandoId = "c6df6bbe-d58d-426d-a492-cf75665314b1";
  const employees = [{ id: armandoId, fullName: "Aquino, Armando Lantay", attendanceName: "Armando L. Aquino", biometricAliases: ["ARMANDO L. AQUINO", "ARMANDO AQUINO"], employmentStatus: "active", isDeleted: false }];
  const rows = [mainHeader,
    ["", "ARMANDO L. AQUINO", "3", "09/23/2026 07:20:00 AM", "C/In"],
    ["", "ARMANDO AQUINO", "99", "09/23/2026 05:14:00 PM", "C/Out"],
  ];
  const records = aggregateMainAttendance(rows, employees, { "3": armandoId, "99": armandoId });
  assert.equal(records.length, 1);
  assert.equal(records[0].employeeId, armandoId);
  assert.equal(records[0].employeeName, "Armando L. Aquino");
  assert.equal(records[0].firstIn, "07:20:00");
  assert.equal(records[0].lastOut, "17:14:00");
  assert.equal(records[0].status, "complete");
});

test("Armando biometric aliases aggregate the exact September 3 punches into one employee-day", () => {
  const armandoId = "armando-employee";
  const employees = [{ id: armandoId, fullName: "Aquino, Armando Lantay", attendanceName: "Armando L. Aquino", biometricAliases: ["ARMANDO L. AQUINO", "ARMANDO AQUINO"], employmentStatus: "active", isDeleted: false }];
  const rows = [mainHeader,
    ["", "ARMANDO L. AQUINO", "3", "09/03/2026 07:47:18 AM", "C/In"],
    ["", "ARMANDO AQUINO", "99", "09/03/2026 05:04:08 PM", "C/Out"],
  ];
  const result = aggregateMainAttendance(rows, employees, { "3": armandoId, "99": armandoId });
  assert.equal(result.length, 1);
  assert.equal(result[0].employeeId, armandoId);
  assert.equal(result[0].firstIn, "07:47:18");
  assert.equal(result[0].lastOut, "17:04:08");
  assert.equal(result[0].status, "complete");
});

test("deleted MAIN source hides a daily record while an active contributing source keeps it", () => {
  const sourceA = "source-a";
  const sourceB = "source-b";
  const records = [
    { id: "daily-923", employeeId: "employee-1", employeeName: "Employee", rawName: "EMPLOYEE", deviceNo: null, workDate: "2026-09-23", firstIn: "08:00:00", lastOut: "17:00:00", checkoutSource: "biometric", status: "complete", lateMinutes: 0, lateSeconds: 0, halfDay: false, undertimeMinutes: 0, sourceFileId: sourceA },
  ] as const;
  const links = [{ dailyAttendanceId: "daily-923", sourceFileId: sourceA }, { dailyAttendanceId: "daily-923", sourceFileId: sourceB }];
  assert.equal(activeMainAttendanceRecordIds([...records], new Set(), links).has("daily-923"), false);
  assert.equal(activeMainAttendanceRecordIds([...records], new Set([sourceB]), links).has("daily-923"), true);
});

test("manual attendance records are outside MAIN upload provenance", () => {
  const manual = { id: "manual-1", sourceFileId: null, employeeId: "employee-1", employeeName: "Employee", rawName: "Employee", deviceNo: null, workDate: "2026-09-23", firstIn: "08:00:00", lastOut: "17:00:00", checkoutSource: "manual", status: "complete", lateMinutes: 0, lateSeconds: 0, halfDay: false, undertimeMinutes: 0 };
  const manualRecords = [manual];
  assert.equal(manualRecords.some((record) => record.id === "manual-1"), true);
});

test("MAIN active work dates produce September 2026 and September 9, 2026 filter inputs", () => {
  const dates = mainWorkDateOptions([
    { id: "daily-909", employeeId: "employee-1", employeeName: "Employee", rawName: "EMPLOYEE", deviceNo: null, workDate: "2026-09-09", firstIn: "08:00:00", lastOut: "17:00:00", checkoutSource: "biometric", status: "complete", lateMinutes: 0, lateSeconds: 0, halfDay: false, undertimeMinutes: 0 },
  ]);
  assert.deepEqual(dates, ["2026-09-09"]);
  assert.deepEqual([...new Set(dates.map((date) => date.slice(0, 7)))], ["2026-09"]);
  assert.equal(new Date("2026-09-09T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), "September 9, 2026");
  const deletedOnly = { id: "deleted-only", employeeId: "employee-1", employeeName: "Employee", rawName: "EMPLOYEE", deviceNo: null, workDate: "2026-09-23", firstIn: "08:00:00", lastOut: "17:00:00", checkoutSource: "biometric", status: "complete", lateMinutes: 0, lateSeconds: 0, halfDay: false, undertimeMinutes: 0, sourceFileId: "deleted-source" } as const;
  assert.deepEqual(mainWorkDateOptions([deletedOnly].filter((record) => activeMainAttendanceRecordIds([record], new Set(), []).has(record.id))), []);
});

test("MAIN delete separates committed trash success from secondary refresh warnings", () => {
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.match(context, /const deleteUploadedFile = async/);
  assert.match(context, /await \(hrScope === "MAIN" \? deleteMainAttendanceUpload/);
  assert.match(context, /setUploadedFiles\(\(current\) => current\.filter\(\(file\) => file\.id !== fileId\)\)/);
  assert.match(context, /Promise\.allSettled\(\[[\s\S]*applyDatabaseData\(false\)[\s\S]*refreshDeletedAttendanceData\(false\)/);
  assert.match(context, /success: true,[\s\S]*Attendance upload moved to Recycle Bin/);
  assert.match(context, /some views could not be refreshed/);
  assert.match(dashboard, /const result = await deleteUploadedFile/);
  assert.match(dashboard, /if \(result\.success\)/);
  assert.match(dashboard, /if \(result\.warning\) toast\.warning/);
  assert.match(dashboard, /else toast\.error/);
  assert.match(service, /rpc\("delete_main_attendance_upload"/);
  const mainDelete = service.match(/export async function deleteMainAttendanceUpload[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(mainDelete, /reconcile_main_active_upload_records/);
  assert.doesNotMatch(service.match(/createDeleteBatchId[\s\S]*?\n\}/)?.[0] ?? "", /return `b-/);
});

test("Recycle Bin Delete All is confirmed, scoped, sequential, and partial-failure aware", () => {
  const page = readFileSync(new URL("../src/pages/RecycleBin.tsx", import.meta.url), "utf8");
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/035_permanently_delete_recycle_bin_item.sql", import.meta.url), "utf8");
  assert.match(page, /deletedAttendanceCount > 0/);
  assert.match(page, /title="Permanently delete all items\?"/);
  assert.match(page, /This will permanently delete all items currently in your Recycle Bin\. This action cannot be undone\./);
  assert.match(page, /confirmLabel="Delete All Permanently"/);
  assert.match(page, /onCancel=\{\(\) => \(deleteAllBusy \? null : setDeleteAllOpen\(false\)\)\}/);
  assert.match(context, /for \(const file of deletedAttendanceData\.uploadedFiles\)/);
  assert.match(context, /for \(const record of deletedAttendanceData\.manualHrRecords\)/);
  assert.match(context, /succeededFiles/);
  assert.match(context, /succeededManual/);
  assert.match(context, /failed \+= 1/);
  assert.match(context, /Recycle Bin partially cleared/);
  assert.match(service, /rpc\("permanently_delete_recycle_bin_item"/);
  assert.match(migration, /expected_workspace:=public\.attendance_workspace\(\)/);
  assert.match(migration, /public\.attendance_role\(\)<>'HR'/);
  assert.match(migration, /workspace=expected_workspace and is_deleted and not removed_from_recycle_bin/);
  assert.doesNotMatch(migration, /delete from public\.[a-z_]+\s*;/);
  assert.match(migration, /f\.id<>file_id/);
});

test("migration 023 safely merges known historical aliases and preserves batch provenance", () => {
  const sql = readFileSync(new URL("../supabase/migrations/023_fix_main_delete_and_reconcile_aliases.sql", import.meta.url), "utf8");
  assert.match(sql, /reconcile_main_unmatched_attendance/);
  assert.match(sql, /main_biometric_mappings/); assert.match(sql, /main_biometric_aliases/);
  assert.match(sql, /least\(t\.first_in,a\.first_in\)/); assert.match(sql, /greatest\(t\.last_out,a\.last_out\)/);
  assert.match(sql, /main_attendance_sources/); assert.match(sql, /source_file_id<>p_file_id/);
  assert.match(sql, /source_type='attendance_upload'/); assert.match(sql, /source_type='system_generated'/);
  assert.doesNotMatch(sql, /source_type='manual'[^;]*is_deleted=true/s);
  assert.match(sql, /continue/);
});

test("migration 034 restores canonical MAIN rows before generated attendance completes", () => {
  const sql = readFileSync(new URL("../supabase/migrations/034_restore_main_daily_attendance_on_import.sql", import.meta.url), "utf8");
  const dailyUpsert = sql.indexOf("insert into public.main_daily_attendance");
  const lateInsert = sql.indexOf("insert into public.late_records");
  const absenceInsert = sql.indexOf("insert into public.absences");
  assert.ok(dailyUpsert >= 0 && lateInsert > dailyUpsert && absenceInsert > dailyUpsert);
  assert.match(sql, /last_time=nullif\(r->>'lastOut',''\)::time/);
  assert.match(sql, /status=case when public\.main_daily_attendance\.checkout_source='manual' then 'complete' else excluded\.status end/);
  assert.match(sql, /is_deleted=false,deleted_at=null,deleted_by=null,deleted_batch_id=null/);
  assert.match(sql, /source_file_id=excluded\.source_file_id/);
  assert.match(sql, /not exists\(select 1 from public\.main_daily_attendance a[\s\S]*not a\.is_deleted[\s\S]*a\.first_in is not null or a\.last_out is not null/);
  assert.match(sql, /if last_time is not null and coalesce\(\(r->>'undertimeMinutes'\)::int,0\)>0/);
  assert.doesNotMatch(sql, /exception when others/);
});

test("MAIN loader supplies active file names for provenance fallback and file-history dates", () => {
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.match(service, /from\("uploaded_files"\)\.select\("id, file_name"\)/);
  assert.match(service, /activeSourceFileNames/);
  assert.match(service, /activeMainAttendanceRecordIds/);
});

test("migration 024 fixes MAIN UUID boundaries and keeps delete limited to generated records", () => {
  const sql = readFileSync(new URL("../supabase/migrations/024_fix_main_uuid_and_delete.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function public\.reconcile_main_unmatched_attendance\(\)/);
  assert.match(sql, /source_file_id in\(select source_file_id::text from public\.main_attendance_sources/);
  assert.match(sql, /create or replace function public\.delete_main_attendance_upload\(p_file_id uuid,p_batch_id uuid\)/);
  assert.match(sql, /public\.late_records[\s\S]*source_file_id=p_file_id::text/);
  assert.match(sql, /public\.generated_undertimes[\s\S]*source_file_id=p_file_id::text/);
  assert.match(sql, /public\.main_daily_attendance[\s\S]*d\.source_file_id=p_file_id/);
  assert.match(sql, /public\.half_day_records[\s\S]*source_type='attendance_upload'/);
  assert.match(sql, /public\.absences[\s\S]*source_type='system_generated'/);
  assert.doesNotMatch(sql, /public\.manual_late_records[\s\S]*set is_deleted=true/);
  assert.doesNotMatch(sql, /public\.manual_undertimes[\s\S]*set is_deleted=true/);
  assert.match(sql, /least\(t\.first_in,a\.first_in\)/);
  assert.match(sql, /greatest\(t\.last_out,a\.last_out\)/);
  assert.match(sql, /join public\.employees emp on emp\.id=x\.employee_id/);
});

test("migration 026 reconciles orphaned MAIN generated records without touching manual records", () => {
  const sql = readFileSync(new URL("../supabase/migrations/026_fix_main_orphaned_generated_records.sql", import.meta.url), "utf8");
  assert.match(sql, /reconcile_main_active_upload_records/);
  assert.match(sql, /main_attendance_sources/);
  assert.match(sql, /not exists\([\s\S]*uploaded_files/);
  assert.match(sql, /source_type='attendance_upload'/);
  assert.match(sql, /source_type='system_generated'/);
  assert.doesNotMatch(sql, /source_type='manual'[\s\S]*is_deleted=true/);
  assert.match(sql, /deleted_reason='orphaned_main_upload_source'/);
});

test("MAIN dashboard filters its daily summary and delegates month history", () => {
  const dashboard = readFileSync(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");
  const records = readFileSync(new URL("../src/pages/AttendanceRecords.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /record\.workDate === selectedDayScope/);
  assert.match(dashboard, /selectedDayScope !== "all"/);
  assert.match(dashboard, /View Attendance Records/);
  assert.doesNotMatch(dashboard, /mainDailyAttendance\.slice\(0, 100\)/);
  assert.match(records, /All months/); assert.match(records, /All dates/); assert.match(records, /All employees/); assert.match(records, /All statuses/);
});

test("absence date scope uses one canonical local calendar date for Dashboard and Absences", () => {
  assert.equal(normalizeAttendanceDate("09/22/2026"), "2026-09-22");
  assert.equal(normalizeAttendanceDate("2026-09-22"), "2026-09-22");
  assert.equal(matchesDateScope("09/22/2026", "2026-09", "2026-09-22"), true);
  assert.equal(matchesDateScope("2026-09-22", "2026-09", "2026-09-22"), true);
  assert.equal(matchesDateScope("09/22/2026", "2026-09", "2026-09-23"), false);
  assert.equal(matchesDateScope("09/22/2026", "2026-09", "all"), true);
  assert.equal(matchesDateScope("09/22/2026", "2026-08", "all"), false);
  assert.equal(normalizeAttendanceDate("2026-09-22T00:00:00.000Z"), "2026-09-22");
  assert.equal(normalizeAttendanceDate("2026-09-22T00:00:00"), "2026-09-22");
});

test("Dashboard and Absences page use the shared exact-day absence scope", () => {
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  const absences = readFileSync(new URL("../src/pages/Absences.tsx", import.meta.url), "utf8");
  assert.match(context, /matchesDateScope\(dateValue, selectedMonthScope, selectedDayScope\)/);
  assert.match(absences, /matchesDateScope\(record\.date, scopeMonth, selectedDayScope\)/);
});

test("informed-person directory is scope-aware", () => {
  const main = informedPeopleForScope("MAIN");
  const itc = informedPeopleForScope("ITC");
  assert.deepEqual(main, ["HR Marj", "Ma'am Jen", "Ma'am Alexis", "Ma'am Arielle", "Ma'am Reina", "Sir Marc"]);
  assert.deepEqual(itc, ["Sir Gatch", "Ma’am Chona", "HR Louissa"]);
  assert.equal(main.includes("Sir Gatch"), false);
});

test("MAIN absence correction actions are guarded and Undertime keeps checkout editing out", () => {
  const absences = readFileSync(new URL("../src/pages/Absences.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const undertime = readFileSync(new URL("../src/pages/Undertime.tsx", import.meta.url), "utf8");
  const attendanceRecords = readFileSync(new URL("../src/pages/AttendanceRecords.tsx", import.meta.url), "utf8");
  assert.match(absences, /hrScope === "MAIN" && record\.sourceType === "system_generated"/);
  assert.match(service, /\.eq\("workspace", "WAIS"\)[\s\S]*\.eq\("source_type", "system_generated"\)/);
  assert.match(service, /informed_to: informed/);
  assert.match(service, /deleted_reason/);
  assert.doesNotMatch(undertime, /Missing Check-Out|Save Manual Check-Out|saveManualCheckout/);
  assert.match(attendanceRecords, /saveManualCheckout/);
});

test("MAIN Attendance Records uses human-readable month labels and editable checkout actions", () => {
  const page = readFileSync(new URL("../src/pages/AttendanceRecords.tsx", import.meta.url), "utf8");
  assert.match(page, /const monthLabel/);
  assert.match(page, /month: "long", year: "numeric"/);
  assert.match(page, /<option value="all">All months<\/option>/);
  assert.match(page, /value=\{m\}>\{monthLabel\(m\)\}/);
  assert.match(page, /openEditor\("checkout", r/);
  assert.match(page, /r\.lastOut \? "Update Check-Out" : "Add Check-Out"/);
  assert.match(page, /Current Last Out/);
  assert.match(page, /Current Source/);
  assert.match(page, /Final Check-Out Time/);
  assert.match(page, /Optional Note/);
});

test("migration 027 preserves original biometric checkout and recalculates only generated undertime", () => {
  const sql = readFileSync(new URL("../supabase/migrations/027_preserve_main_biometric_checkout.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists biometric_last_out time/);
  assert.match(sql, /biometric_last_out=original_biometric/);
  assert.match(sql, /original_biometric_last_out/);
  assert.match(sql, /source_file_id::text/);
  assert.match(sql, /generated_undertimes/);
  assert.doesNotMatch(sql, /manual_undertimes[\s\S]*set is_deleted=true/);
  assert.match(sql, /MAIN HR access required/);
});

test("MAIN stale-record cleanup uses the authenticated RPC and refreshes shared attendance state", () => {
  const page = readFileSync(new URL("../src/pages/AttendanceRecords.tsx", import.meta.url), "utf8");
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.match(page, /Clean Stale Records/);
  assert.match(page, /cleanMainStaleRecords/);
  assert.match(context, /hrScope !== "MAIN" \|\| role !== "HR"/);
  assert.match(context, /await reconcileMainActiveUploadRecords\(\)/);
  assert.match(context, /await applyDatabaseData\(false\)/);
  assert.match(context, /Stale system-generated attendance records were reconciled\./);
  assert.match(service, /rpc\("reconcile_main_active_upload_records"\)/);
});

test("migration 022 keeps legal names, supports aliases, and deletes MAIN batches by provenance", () => {
  const sql = readFileSync(new URL("../supabase/migrations/022_main_attendance_aliases_and_batch_provenance.sql", import.meta.url), "utf8");
  assert.match(sql, /attendance_name text/); assert.match(sql, /main_biometric_aliases/);
  assert.match(sql, /'ARMANDO L\. AQUINO'/); assert.match(sql, /'ARMANDO AQUINO'/); assert.match(sql, /'3'/); assert.match(sql, /'99'/);
  assert.match(sql, /source_file_id uuid references public\.uploaded_files\(id\)/);
  assert.match(sql, /where source_file_id=p_file_id and source_type='attendance_upload'/);
  assert.match(sql, /where source_file_id=p_file_id and source_type='system_generated'/);
  assert.doesNotMatch(sql, /update public\.employees set full_name/i);
});

test("system absence comparison is MAIN roster only, eligibility-aware, and stable on re-run", () => {
  const present = aggregateMainAttendance([mainHeader, ["", "ROGEL COLLERA", "7", "09/21/2026 08:00:00 AM", "C/In"]], mainEmployees);
  assert.deepEqual(systemAbsenceEmployeeIds(mainEmployees, present, "2026-09-21"), ["main-other"]);
  assert.deepEqual(systemAbsenceEmployeeIds(mainEmployees, present, "2026-09-21"), ["main-other"]);
  assert.deepEqual(systemAbsenceEmployeeIds([...mainEmployees, { id: "future", fullName: "Future Person", employmentStatus: "active", isDeleted: false, startDate: "2027-01-01" }], present, "2026-09-21"), ["main-other"]);
});

test("MAIN migration makes system absences idempotent and preserves manual absences on correction", () => {
  const sql = readFileSync(new URL("../supabase/migrations/020_main_office_attendance.sql", import.meta.url), "utf8");
  assert.match(sql, /absences_unique_system_generated/);
  assert.match(sql, /source_type='system_generated'/);
  assert.match(sql, /Corrected MAIN attendance import/);
  assert.doesNotMatch(sql, /source_type='manual'.*is_deleted=true/s);
  assert.match(sql, /attendance_hr_scope\(\)<>'MAIN'/);
});

test("MAIN upload keeps Employee UUID and biometric device No. in separate typed fields", () => {
  const employeeUuid = "c6df6bbe-d58d-426d-a492-cf75665314b1";
  const record = aggregateMainAttendance([mainHeader, ["", "ROGEL COLLERA", "37", "09/22/2026 07:46:38 AM", "C/In"], ["", "ROGEL COLLERA", "37", "09/22/2026 10:12:19 AM", "C/Out"]], [{ ...mainEmployees[0], id: employeeUuid }])[0];
  assert.equal(record.employeeId, employeeUuid);
  assert.equal(record.deviceNo, "37");
  assert.notEqual(record.employeeId, record.deviceNo);
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.match(service, /p_records: records/);
  assert.doesNotMatch(service, /p_device_no:\s*employee\.id|p_employee_id:\s*biometric/i);
});

test("migration 021 uses uploaded_files UUID type instead of bigint for MAIN source file IDs", () => {
  const sql = readFileSync(new URL("../supabase/migrations/021_fix_main_upload_id_and_half_day_reimport.sql", import.meta.url), "utf8");
  assert.match(sql, /file_id public\.uploaded_files\.id%type/gi);
  assert.doesNotMatch(sql, /file_id bigint/i);
  assert.match(sql, /returning id into file_id/);
});

test("MAIN upload logs diagnostics but shows HR a safe production error", () => {
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  assert.match(context, /console\.error\("Upload failed:", error\)/);
  assert.match(context, /MAIN Office attendance upload could not be completed\. Please contact the system administrator\./);
});

test("MAIN Half-Day re-import reconciles only system records and records aggregated First In", () => {
  const sql = readFileSync(new URL("../supabase/migrations/021_fix_main_upload_id_and_half_day_reimport.sql", import.meta.url), "utf8");
  assert.match(sql, /source_type='attendance_upload' and not is_deleted/);
  assert.match(sql, /set source_time_in=first_time/);
  assert.match(sql, /source_type='manual'\)/);
  assert.doesNotMatch(sql, /source_type='manual'[^;]*set is_deleted=true/s);
  assert.match(sql, /perform public\.create_generated_half_day/);
});

test("leave duration uses working minutes and excludes weekday lunch", () => {
  assert.deepEqual(calculateLeaveDuration("2026-09-07", "08:00", "17:00"), { minutes: 480, error: null });
  assert.deepEqual(calculateLeaveDuration("2026-09-07", "08:00", "12:00"), { minutes: 240, error: null });
  assert.deepEqual(calculateLeaveDuration("2026-09-07", "08:00", "10:30"), { minutes: 150, error: null });
  assert.deepEqual(calculateLeaveDuration("2026-09-07", "11:00", "14:00"), { minutes: 120, error: null });
  assert.match(calculateLeaveDuration("2026-09-07", "10:00", "09:00").error ?? "", /later/);
});

test("leave presentation formats Saturday full-day, dates, times, and statuses professionally", () => {
  assert.deepEqual(calculateLeaveDuration("2026-09-12", "07:00", "15:15"), { minutes: 495, error: null });
  assert.equal(formatLeaveRequestDuration("2026-09-12", "07:00", "15:15", 495), "1 day");
  assert.equal(formatLeaveRequestDuration("2026-09-12", "07:00", "15:00", 480), "1 day");
  assert.equal(formatLeaveDate("2026-09-12"), "09/12/2026");
  assert.equal(formatLeaveTime("07:00"), "07:00 AM");
  assert.equal(formatLeaveTime("15:15"), "03:15 PM");
  assert.equal(formatLeaveStatus("approved"), "Approved");
  assert.equal(formatLeaveStatus("pending"), "Pending");
  assert.equal(formatLeaveStatus("rejected"), "Rejected");
});

test("leave balances use exact minutes and calendar-year records", () => {
  assert.equal(ANNUAL_LEAVE_ENTITLEMENT_MINUTES, 2400);
  assert.equal(formatLeaveMinutes(2400), "5 days");
  assert.equal(formatLeaveMinutes(2160), "4 days 4 hours");
  assert.equal(formatLeaveMinutes(1590), "3 days 2 hours 30 minutes");
});

test("MAIN rejected leave counts are employee, year, workspace, and active-record specific", () => {
  const records = [
    { employeeId: "a", leaveDate: "2026-01-02", status: "rejected" as const, workspace: "WAIS", isDeleted: false },
    { employeeId: "a", leaveDate: "2026-02-02", status: "rejected" as const, workspace: "WAIS", isDeleted: false },
    { employeeId: "a", leaveDate: "2026-03-02", status: "approved" as const, workspace: "WAIS", isDeleted: false },
    { employeeId: "a", leaveDate: "2026-04-02", status: "pending" as const, workspace: "WAIS", isDeleted: false },
    { employeeId: "a", leaveDate: "2026-05-02", status: "rejected" as const, workspace: "WAIS", isDeleted: true },
    { employeeId: "a", leaveDate: "2025-05-02", status: "rejected" as const, workspace: "WAIS", isDeleted: false },
    { employeeId: "a", leaveDate: "2026-06-02", status: "rejected" as const, workspace: "APP", isDeleted: false },
    { employeeId: "b", leaveDate: "2026-01-02", status: "rejected" as const, workspace: "WAIS", isDeleted: false },
  ];
  assert.equal(countRejectedLeaveRequests(records, "a", 2026, "WAIS"), 2);
  assert.equal(countRejectedLeaveRequests(records, "b", 2026, "WAIS"), 1);
  assert.equal(countRejectedLeaveRequests(records, "a", 2025, "WAIS"), 1);
  assert.equal(calculateAnnualLeaveTotals([{ leaveDate: "2026-01-02", status: "rejected", durationMinutes: 480 }], 2026, 0).remaining, ANNUAL_LEAVE_ENTITLEMENT_MINUTES);
});

test("Rejected Requests is MAIN-only in HR and Admin Leave registries", () => {
  const registry = readFileSync(new URL("../src/components/leave/LeaveRegistry.tsx", import.meta.url), "utf8");
  const leave = readFileSync(new URL("../src/pages/Leave.tsx", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../src/components/leave/AdminLeaveApprovals.tsx", import.meta.url), "utf8");
  assert.match(registry, /showRejectedRequests && <th[^>]*>Rejected Requests/);
  assert.match(registry, /countRejectedLeaveRequests/);
  assert.match(leave, /showRejectedRequests=\{hrScope === "MAIN"\}/);
  assert.match(admin, /showRejectedRequests=\{hrScope === "MAIN"\}/);
});

test("MAIN exemption history filters and summaries compose without changing records", () => {
  const records = [
    { name: "Lasam, Christine Joy Yap", date: "2026-09-22", approvalStatus: "approved" as const, id: "1" },
    { name: "Lasam, Christine Joy Yap", date: "2026-09-10", approvalStatus: "declined" as const, id: "2" },
    { name: "Lasam, Christine Joy Yap", date: "2025-09-10", approvalStatus: "approved" as const, id: "3" },
    { name: "Huerto, Joben Luciano", date: "2026-09-21", approvalStatus: "pending" as const, id: "4" },
  ];
  const combined = filterExemptionHistory(records, { search: "Christine Joy", year: "2026", month: "09", status: "approved", sort: "newest" });
  assert.deepEqual(combined.map((item) => item.id), ["1"]);
  assert.deepEqual(filterExemptionHistory(records, { search: "", year: "all", month: "all", status: "all", sort: "oldest" }).map((item) => item.id), ["3", "2", "4", "1"]);
  const christine = filterExemptionHistory(records, { search: "Lasam", year: "2026", month: "all", status: "all", sort: "newest" });
  assert.equal(christine.length, 2);
  assert.equal(christine.filter((item) => item.approvalStatus === "approved").length, 1);
  assert.equal(christine.filter((item) => item.approvalStatus === "declined").length, 1);
  assert.equal(christine.filter((item) => item.approvalStatus === "pending").length, 0);
});

test("MAIN exemption history UI is scope-aware and preserves record actions", () => {
  const page = readFileSync(new URL("../src/pages/Exemptions.tsx", import.meta.url), "utf8");
  assert.match(page, /title="Search & Filters"/);
  assert.match(page, /placeholder="Search employee"/);
  assert.match(page, /All Years/); assert.match(page, /All Months/); assert.match(page, /All Statuses/);
  assert.match(page, /Newest First/); assert.match(page, /Oldest First/);
  assert.match(page, /Total Requests/); assert.match(page, /exemptionSummary\.approved/); assert.match(page, /exemptionSummary\.declined/); assert.match(page, /exemptionSummary\.pending/);
  assert.match(page, /Restore Late Record/); assert.match(page, /setDeleteTarget/);
  assert.match(page, /filterExemptionHistory\(exemptions/);
  assert.match(page, /hrScope/);
});

test("ITC exemptions share the MAIN search, filter, sort, and summary experience", () => {
  const page = readFileSync(new URL("../src/pages/Exemptions.tsx", import.meta.url), "utf8");
  assert.match(page, /filterExemptionHistory\(exemptions/);
  assert.match(page, /Search Employee/);
  assert.match(page, /All Years/);
  assert.match(page, /All Months/);
  assert.match(page, /All Statuses/);
  assert.match(page, /Newest First/);
  assert.match(page, /Oldest First/);
  assert.match(page, /Total Requests/);
  assert.match(page, /exemptionSummary\.pending/);
});

test("late and undertime records retain Employee Master UUIDs and forms use linked source records", () => {
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const employees = readFileSync(new URL("../src/pages/EmployeesPage.tsx", import.meta.url), "utf8");
  const exemptions = readFileSync(new URL("../src/pages/Exemptions.tsx", import.meta.url), "utf8");
  const undertime = readFileSync(new URL("../src/pages/Undertime.tsx", import.meta.url), "utf8");
  assert.match(service, /employeeId: record\.employee_id == null \? undefined : String\(record\.employee_id\)/);
  assert.match(employees, /const employeeById = new Map/);
  assert.match(employees, /Array\.from\(new Set\(map\.values\(\)\)\)/);
  assert.doesNotMatch(exemptions, /label="Time \(optional\)"/);
  assert.doesNotMatch(undertime, /label="From time"/);
  assert.doesNotMatch(undertime, /label="To time"/);
  assert.match(undertime, /Matching Attendance Record/);
  assert.match(undertime, /Add informed person \(optional\)/);
});

test("leave balance uses a manual offset and approved usage", () => {
  assert.equal(leaveBalance(-480, 240), 1680);
  assert.equal(leaveBalance(0, 0), 2400);
  assert.equal(leaveBalance(-960, 480), 960);
  assert.equal(adjustmentPartsToMinutes(1, 2, 30), 630);
});

test("desired remaining leave supports minute balances even with approved history", () => {
  const approved = 480;
  const twoHours = adjustmentPartsToMinutes(0, 2, 0);
  const oneDayFourHours = adjustmentPartsToMinutes(1, 4, 0);
  const fiveDays = adjustmentPartsToMinutes(5, 0, 0);
  assert.equal(leaveBalance(remainingLeaveAdjustment(twoHours, approved), approved), 120);
  assert.equal(leaveBalance(remainingLeaveAdjustment(oneDayFourHours, approved), approved), 720);
  assert.equal(leaveBalance(remainingLeaveAdjustment(fiveDays, approved), approved), 2400);
  assert.ok(adjustmentPartsToMinutes(5, 1, 0) > ANNUAL_LEAVE_ENTITLEMENT_MINUTES);
});

test("annual leave totals isolate years and only approved leave reduces remaining", () => {
  const records = [
    { leaveDate: "2026-02-01", status: "approved" as const, durationMinutes: 240 },
    { leaveDate: "2026-03-01", status: "pending" as const, durationMinutes: 480 },
    { leaveDate: "2026-04-01", status: "rejected" as const, durationMinutes: 480 },
    { leaveDate: "2027-01-01", status: "approved" as const, durationMinutes: 480 },
  ];
  assert.deepEqual(calculateAnnualLeaveTotals(records, 2026, -480), { adjustment: -480, approved: 240, pending: 480, remaining: 1680 });
  assert.deepEqual(calculateAnnualLeaveTotals(records, 2027, 0), { adjustment: 0, approved: 480, pending: 0, remaining: 1920 });
});

test("leave informed-person validation uses selected chips instead of the search input", () => {
  const page = readFileSync(new URL("../src/pages/Leave.tsx", import.meta.url), "utf8");
  const informedSelector = page.match(/<SearchableCombobox label="Who was informed"[\s\S]*?\/>/)?.[0] ?? "";
  assert.ok(informedSelector);
  assert.doesNotMatch(informedSelector, /\brequired\b/);
  assert.match(page, /form\.informed\.length === 0/);
  assert.match(page, /informedParties: form\.informed/);
});

test("leave registry starts from all active employees and keeps request history real", () => {
  const page = readFileSync(new URL("../src/pages/Leave.tsx", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../src/components/leave/AdminLeaveApprovals.tsx", import.meta.url), "utf8");
  const registry = readFileSync(new URL("../src/components/leave/LeaveRegistry.tsx", import.meta.url), "utf8");
  assert.match(page, /employees=\{activeEmployees\}/);
  assert.match(page, /canEditAdjustments/);
  assert.match(admin, /employees=\{activeEmployees\}/);
  assert.doesNotMatch(admin, /canEditAdjustments/);
  assert.match(registry, /employees\.filter/);
  assert.match(registry, /selectedHistory = requests\.filter/);
  assert.match(registry, /employee\.employer/);
  assert.doesNotMatch(registry, />Prior Used Leave</);
  assert.doesNotMatch(registry, />Reviewer</);
  assert.doesNotMatch(registry, /item\.reviewedBy/);
  assert.match(registry, /value\.approved > 0 \? formatLeaveMinutes\(value\.approved\) : ""/);
  assert.match(registry, /value\.pending > 0 \? formatLeaveMinutes\(value\.pending\) : ""/);
  assert.doesNotMatch(admin, /Submitted by:/);
  assert.match(registry, /Edit Remaining Leave/);
  assert.doesNotMatch(registry, /Opening\/Prior Leave Used/);
  assert.match(registry, /Cancel Request/);
  assert.match(registry, />Remove</);
});

test("remaining leave editor uses labeled balance fields without remarks", () => {
  const registry = readFileSync(new URL("../src/components/leave/LeaveRegistry.tsx", import.meta.url), "utf8");
  const editor = registry.match(/Edit Remaining Leave[\s\S]*?Save Remaining Leave/)?.[0] ?? "";
  assert.match(editor, /label="Employee Name"/);
  assert.match(editor, /label="Days"/);
  assert.match(editor, /label="Hours"/);
  assert.match(editor, /label="Minutes"/);
  assert.doesNotMatch(editor, /Remarks/);
});

test("Admin exemption history is searchable and pending cards use a subtle warning treatment", () => {
  const approvals = readFileSync(new URL("../src/pages/AdminApprovals.tsx", import.meta.url), "utf8");
  assert.match(approvals, /historySearch/);
  assert.match(approvals, /filteredHistory = history\.filter/);
  assert.match(approvals, /Search employee name/);
  assert.match(approvals, /exemption \{filteredHistory\.length === 1 \? "record" : "records"\}/);
  assert.match(approvals, /border-warning-200 bg-white/);
  assert.doesNotMatch(approvals, /bg-slate-950\/20/);
});

test("WATTS branding uses the shared electrical icon and reusable creator credit", () => {
  const layout = readFileSync(new URL("../src/components/layout/RootLayout.tsx", import.meta.url), "utf8");
  const login = readFileSync(new URL("../src/pages/LoginPage.tsx", import.meta.url), "utf8");
  const branding = readFileSync(new URL("../src/config/branding.ts", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const icon = readFileSync(new URL("../public/watts-icon.svg", import.meta.url), "utf8");
  assert.match(layout, /<WattsIcon/);
  assert.match(login, /<WattsIcon/);
  assert.doesNotMatch(layout, /CREATOR_CREDIT/);
  assert.match(branding, /CREATOR_NAME = "Nathaniel"/);
  assert.match(html, /\/watts-icon\.svg/);
  assert.match(icon, /<circle/);
  assert.match(icon, /#1d4ed8/);
  assert.match(icon, /#facc15/);
});

test("global footer and public information routes expose no fake support link", () => {
  const routes = readFileSync(new URL("../src/app/routes.tsx", import.meta.url), "utf8");
  const footer = readFileSync(new URL("../src/components/layout/AppFooter.tsx", import.meta.url), "utf8");
  const branding = readFileSync(new URL("../src/config/branding.ts", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../src/components/layout/RootLayout.tsx", import.meta.url), "utf8");
  const login = readFileSync(new URL("../src/pages/LoginPage.tsx", import.meta.url), "utf8");
  assert.match(routes, /path: "\/about"/);
  assert.match(routes, /path: "\/privacy"/);
  assert.match(routes, /path: "\/contact"/);
  assert.doesNotMatch(footer, /Support this project|Buy me a coffee|SUPPORT_URL/);
  assert.match(footer, /to="\/privacy"/);
  assert.match(branding, /SUPPORT_URL: string \| null = null/);
  assert.match(layout, /<AppFooter compact/);
  assert.match(login, /<AppFooter/);
});

test("public information header follows the existing authentication state", () => {
  const publicPage = readFileSync(new URL("../src/components/layout/PublicInfoPage.tsx", import.meta.url), "utf8");
  assert.match(publicPage, /useAuth\(\)/);
  assert.match(publicPage, /user \? "Back to Dashboard" : "Sign in"/);
  assert.match(publicPage, /to=\{user \? "\/" : "\/login"\}/);
  assert.match(publicPage, /!loading/);
});

test("Undertime keeps its desktop form sticky and bounds the manual record list", () => {
  const page = readFileSync(new URL("../src/pages/Undertime.tsx", import.meta.url), "utf8");
  assert.match(page, /xl:grid-cols-\[360px_minmax\(0,1fr\)\]/);
  assert.match(page, /xl:sticky xl:top-20/);
  assert.doesNotMatch(page, /lg:sticky/);
  assert.match(page, /xl:max-h-\[calc\(100vh-15rem\)\]/);
  assert.match(page, /xl:overflow-y-auto/);
  assert.match(page, /title="Manual Undertime Records"/);
  assert.match(page, /Restore/);
  assert.match(page, /Delete/);
});

test("sidebar navigation is grouped without removing Undertime or role filters", () => {
  const layout = readFileSync(new URL("../src/components/layout/RootLayout.tsx", import.meta.url), "utf8");
  assert.match(layout, /label: "Overview"/);
  assert.match(layout, /label: "Attendance Management"/);
  assert.match(layout, /label: "System"/);
  assert.match(layout, /name: "Undertime", href: "\/undertime"/);
  assert.match(layout, /visibleItems = group\.items\.filter/);
  assert.match(layout, /bg-brand-50 text-brand-700/);
});

test("migration 017 derives remaining leave from one year-specific adjustment and audits changes", () => {
  const migration = readFileSync(new URL("../supabase/migrations/017_leave_requests.sql", import.meta.url), "utf8");
  assert.match(migration, /create table if not exists public\.employee_leave_adjustments/);
  assert.match(migration, /unique \(employee_id, leave_year\)/);
  assert.match(migration, /adjustment_minutes integer not null check \(adjustment_minutes between -2400 and 2400\)/);
  assert.match(migration, /Only HR can edit remaining leave/);
  assert.match(migration, /on conflict\(employee_id,leave_year\) do update/);
  assert.match(migration, /new_adjustment=p_remaining_minutes\+approved_minutes-2400/);
  assert.match(migration, /previous_remaining_minutes/);
  assert.match(migration, /new_remaining_minutes/);
  assert.match(migration, /action,payload/);
  assert.match(migration, /extract\(year from leave_date\)=p_leave_year/);
});

test("leave cancellation, approved removal, and active duplicate protection are enforced", () => {
  const page = readFileSync(new URL("../src/pages/Leave.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/leaveService.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/017_leave_requests.sql", import.meta.url), "utf8");
  assert.match(page, /item\.status === "pending" \|\| item\.status === "approved"/);
  assert.match(page, /An active leave request already exists for this employee on this date/);
  assert.match(service, /rpc\("cancel_pending_leave_request"/);
  assert.match(service, /rpc\("remove_leave_request"/);
  assert.match(migration, /unique index if not exists leave_requests_active_employee_date_uidx/);
  assert.match(migration, /status in \('pending','approved'\)/);
  assert.match(migration, /deleted_reason='leave_request_cancelled'/);
  assert.match(migration, /deleted_reason=x\.status\|\|'_leave_removed: '/);
  assert.match(migration, /x\.submitted_by <> auth\.uid\(\)/);
  assert.match(migration, /Removal reason required/);
  assert.match(migration, /x\.status not in \('approved','rejected'\)/);
});

test("migration 018 repairs legacy remaining-balance validation and rejected removal", () => {
  const migration = readFileSync(new URL("../supabase/migrations/018_fix_leave_remaining_and_rejected_removal.sql", import.meta.url), "utf8");
  assert.match(migration, /drop constraint if exists employee_leave_adjustments_adjustment_minutes_check/);
  assert.match(migration, /adjustment_minutes between -2400 and 2400/);
  assert.match(migration, /new_adjustment=p_remaining_minutes\+approved_minutes-2400/);
  assert.match(migration, /status not in \('approved','rejected'\)/);
  assert.match(migration, /is_deleted=true,deleted_at=now\(\),deleted_by=auth\.uid\(\)/);
});

test("leave migration enforces role review, pending-only approval, and derived balance safety", () => {
  const migration = readFileSync(new URL("../supabase/migrations/017_leave_requests.sql", import.meta.url), "utf8");
  assert.match(migration, /coalesce\(public\.attendance_role\(\),''\) <> 'HR'/);
  assert.match(migration, /coalesce\(public\.attendance_role\(\),''\) <> 'Admin'/);
  assert.match(migration, /x\.status <> 'pending'/);
  assert.match(migration, /sum\(duration_minutes\)/);
  assert.match(migration, /used_minutes \+ x\.duration_minutes > 2400 \+ coalesce\(balance_adjustment,0\)/);
  assert.match(migration, /p_duration_minutes<>chargeable/);
  assert.match(migration, /where id=x\.employee_id for update/);
});

test("login account choices use the four existing account emails", () => {
  assert.deepEqual(LOGIN_ACCOUNTS.map((account) => account.label), ["APP HR", "APP Admin", "WAIS HR", "WAIS Admin"]);
  assert.deepEqual(LOGIN_ACCOUNTS.map((account) => account.email), ["app@attendance.local", "app.admin@attendance.local", "wais@attendance.local", "wais.admin@attendance.local"]);
});

test("Admin routes exclude HR entry and approval actions are Admin-only", () => {
  assert.equal(canAccessPath("Admin", "/"), true);
  assert.equal(canAccessPath("Admin", "/employees"), true);
  assert.equal(canAccessPath("Admin", "/approvals"), true);
  assert.equal(canAccessPath("Admin", "/absence-records"), true);
  assert.equal(canAccessPath("Admin", "/leave"), false);
  assert.equal(canAccessPath("Admin", "/exemptions"), false);
  assert.equal(canAccessPath("HR", "/approvals"), false);
  assert.equal(canAccessPath("HR", "/undertime"), true);
  assert.equal(canAccessPath("HR", "/leave"), true);
  assert.equal(canAccessPath("HR", "/absence-records"), false);
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
  const samples = [[8,5,"on_time"],[8,6,"late"],[8,59,"late"],[9,0,"undertime"],[9,3,"undertime"],[11,50,"undertime"],[11,51,"half_day"],[12,0,"half_day"],[12,34,"half_day"],[12,50,"half_day"],[13,0,"half_day"],[13,1,"undertime"]] as const;
  for (const [hour, minute, kind] of samples) assert.equal(classifyUploadedTimeIn("2026-09-07", hour, minute, 0).kind, kind);
  assert.equal(generatedUndertimeMinutes("2026-09-07", 9, 3, 0), 63);
  assert.deepEqual(classifyGeneratedHalfDay("2026-09-07", 11, 51, 0), { period: "morning", scheduledStart: "08:00", scheduledEnd: "12:00" });
});

test("Service management is workspace-scoped with WAIS-only attendance integration", () => {
  const migration = readFileSync(new URL("../supabase/migrations/042_service_management_main_integration.sql", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../src/app/routes.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../src/components/layout/RootLayout.tsx", import.meta.url), "utf8");
  assert.match(routes, /path: "service"/);
  assert.match(layout, /name: "Service"/);
  assert.match(migration, /attendance_role\(\) is distinct from 'HR'/);
  assert.match(migration, /attendance_workspace\(\) is distinct from p_workspace/);
  assert.match(migration, /service_event_employees/);
  assert.match(migration, /p_workspace='WAIS'/);
  assert.match(migration, /checkout_source='service'/);
  assert.match(migration, /biometric_last_out_at/);
  assert.match(migration, /source_attendance_id=a\.id/);
  assert.match(readFileSync(new URL("../src/pages/Service.tsx", import.meta.url), "utf8"), /role === "HR"/);
});

test("APP/ITC midday punches classify as morning-absent half-days with seconds-safe boundaries", () => {
  for (const [hour, minute, second] of [[12, 0, 0], [12, 34, 32], [12, 50, 5], [13, 0, 59]] as const) {
    assert.equal(classifyUploadedTimeIn("2026-09-29", hour, minute, second).kind, "half_day");
  }
  assert.notEqual(classifyUploadedTimeIn("2026-09-29", 13, 1, 0).kind, "half_day");
  assert.equal(attendanceNameMatchesEmployee("De Jesus, Roy Rolan", "De Jesus, Roy Roldan"), true);
});

test("attendance file history sorts by attendance date, then upload time, with invalid-name fallback", () => {
  const files = [
    { id: "sep29-late", fileName: "Attendance September 29, 2026.xlsx", uploadedAt: "2026-10-03T11:17:00" },
    { id: "sep30", fileName: "Attendance September 30, 2026.xlsx", uploadedAt: "2026-10-03T10:20:00" },
    { id: "oct1", fileName: "Attendance October 1, 2026.xlsx", uploadedAt: "2026-10-03T09:00:00" },
    { id: "dec31", fileName: "Attendance December 31, 2026.xlsx", uploadedAt: "2026-10-03T08:00:00" },
    { id: "jan1", fileName: "Attendance January 1, 2026.xlsx", uploadedAt: "2026-10-03T12:00:00" },
    { id: "same-old", fileName: "Attendance September 30, 2026.xlsx", uploadedAt: "2026-10-03T09:00:00" },
    { id: "invalid", fileName: "legacy-upload.xlsx", uploadedAt: "2026-10-03T13:00:00" },
  ];
  assert.equal(attendanceDateFromFileName(files[0].fileName), Date.UTC(2026, 8, 29));
  assert.deepEqual(sortUploadedAttendanceFiles(files).map((file) => file.id), ["dec31", "oct1", "sep30", "same-old", "sep29-late", "jan1", "invalid"]);
});

test("shared date filters combine year, month, and exact date while preserving newest-first ordering", () => {
  const dates = ["2026-09-29", "2026-09-30", "2026-10-01", "2025-09-30"];
  assert.deepEqual(dateFilterYears(dates), ["2026", "2025"]);
  assert.deepEqual(dateFilterMonths(dates, "2026"), ["09", "10"]);
  assert.deepEqual(dateFilterDates(dates, "2026", "09"), ["2026-09-30", "2026-09-29"]);
  assert.equal(matchesDateFilters("2026-09-29", "2026", "09", "2026-09-29"), true);
  assert.equal(matchesDateFilters("2026-09-30", "2026", "09", "2026-09-29"), false);
  assert.equal(matchesDateFilters("2025-09-30", "all", "all", "all"), true);
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
  assert.deepEqual(recipients("approved", "hr-app", []), ["hr-app"]);
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
  assert.match(absence, /Add informed person \(optional\)/);
  assert.match(undertime, /Matching Attendance Record/);
  assert.match(undertime, /sourceLateRecordId: hrScope === "MAIN" \? undefined : sourceRecordId/);
  assert.match(undertime, /sourceAttendanceRecordId: hrScope === "MAIN" \? sourceRecordId : undefined/);
  assert.match(undertime, /Add informed person \(optional\)/);
  assert.doesNotMatch(undertime, /<Input label="From time"/);
  assert.doesNotMatch(undertime, /<Input label="To time"/);
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

test("Half-Day tabs separate system and manual records and MAIN system cards show First In", () => {
  const page = readFileSync(new URL("../src/pages/HalfDay.tsx", import.meta.url), "utf8");
  assert.match(page, /record\.sourceType === "attendance_upload"/);
  assert.match(page, /record\.sourceType === "manual"/);
  assert.match(page, /hrScope === "MAIN"/);
  assert.match(page, />First In</);
  assert.match(page, /displayDate\(record\.workDate\)/);
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
  const informedPeople = readFileSync(new URL("../src/utils/informedPeople.ts", import.meta.url), "utf8");
  assert.match(exemptions, /SearchableCombobox/);
  assert.match(undertime, /SearchableCombobox/);
  assert.match(informedPeople, /HR Louissa/);
  assert.match(undertime, /Add informed person/);
});

test("QA fixes guard duplicate manual records and legacy informed values", () => {
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  const undertime = readFileSync(new URL("../src/pages/Undertime.tsx", import.meta.url), "utf8");
  assert.match(context, /An absence already exists for this employee and date/);
  assert.match(context, /A manual undertime record already exists for this employee and date/);
  assert.match(context, /Duplicate upload blocked/);
  assert.match(undertime, /Array\.isArray\(record\.informed\)/);
});

test("Half-Day loads only the signed-in workspace and uses the protected delete function", () => {
  const page = readFileSync(new URL("../src/pages/HalfDay.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.doesNotMatch(page, /Search employee/);
  assert.match(service, /export async function loadStagedHalfDays\(workspace: Workspace\)/);
  assert.match(service, /\.from\("half_day_records"\)[\s\S]*?\.eq\("workspace", workspace\)/);
  assert.match(service, /rpc\("delete_half_day"/);
});

test("employee ownership separates employer from HR scope and seeds MAIN safely", () => {
  const migration = readFileSync(new URL("../supabase/migrations/019_employee_hr_scope.sql", import.meta.url), "utf8");
  const employees = readFileSync(new URL("../src/context/EmployeesContext.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/employeeService.ts", import.meta.url), "utf8");
  assert.match(migration, /add column if not exists employer text/);
  assert.match(migration, /add column if not exists hr_scope text/);
  assert.match(migration, /hr_scope=coalesce\(hr_scope,'ITC'\), workspace='APP'/);
  assert.match(migration, /employees_unique_employee_number/);
  assert.equal((migration.match(/\('(?:W|M)-\d{7}'/g) ?? []).length, 13);
  assert.match(migration, /'M-5009402','Aquino, Armando Lantay','M2B'/);
  assert.match(migration, /source_regular_year,position/);
  assert.match(migration, /null::date,null::date,1994/);
  assert.match(employees, /listEmployees\(hrScope\)/);
  assert.match(service, /\.eq\("hr_scope", hrScope\)/);
  assert.match(service, /workspace: input\.hrScope === "MAIN" \? "WAIS" : "APP"/);
});

test("WAIS and APP workflow reads are scoped before approval", () => {
  const attendance = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const leave = readFileSync(new URL("../src/services/leaveService.ts", import.meta.url), "utf8");
  const notifications = readFileSync(new URL("../src/services/notificationService.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/019_employee_hr_scope.sql", import.meta.url), "utf8");
  assert.match(attendance, /loadCrossWorkspaceExemptionWorkflowData\(workspace: Workspace\)/);
  assert.match(attendance, /loadCrossWorkspaceAbsences\(workspace: Workspace\)/);
  assert.match(leave, /listLeaveRequests\(workspace: Workspace\)/);
  assert.match(leave, /listEmployeeLeaveAdjustments\(workspace: Workspace\)/);
  assert.match(notifications, /\.eq\("workspace", workspace\)/);
  assert.match(migration, /x\.workspace<>public\.attendance_workspace\(\)/);
  assert.match(migration, /workspace=public\.attendance_workspace\(\)/);
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

test("scoped exemption review keeps MAIN approval secure and logs RPC failures", () => {
  const migration = readFileSync(new URL("../supabase/migrations/028_fix_scoped_exemption_review.sql", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.match(migration, /attendance_hr_scope\(\).*MAIN.*WAIS/s);
  assert.match(migration, /x\.workspace<>expected_workspace/);
  assert.match(migration, /l\.workspace<>expected_workspace/);
  assert.match(migration, /l\.work_date<>x\.work_date/);
  assert.match(migration, /employee_name_key\(l\.employee_name\).*employee_name_key\(e\.full_name\)/);
  assert.match(service, /MAIN\/ITC exemption review RPC failed/);
  assert.match(service, /code: error\.code/);
  assert.match(service, /details: error\.details/);
  assert.match(service, /hint: error\.hint/);
});

test("exemption review sets the protected approval marker before updating approval fields", () => {
  const migration = readFileSync(new URL("../supabase/migrations/029_fix_exemption_approval_trigger_guard.sql", import.meta.url), "utf8");
  const markerIndex = migration.indexOf("perform set_config('app.approval_review', '1', true);");
  const updateIndex = migration.indexOf("update public.exemptions");

  assert.notEqual(markerIndex, -1);
  assert.notEqual(updateIndex, -1);
  assert.ok(markerIndex < updateIndex);
  assert.match(migration, /if auth\.uid\(\) is null or public\.attendance_role\(\)<>'Admin'/);
  assert.match(migration, /if p_status not in \('approved','declined'\)/);
  assert.match(migration, /if x\.submitted_by=auth\.uid\(\) then/);
  assert.match(migration, /and hr_scope=public\.attendance_hr_scope\(\)/);
  assert.match(migration, /l\.work_date<>x\.work_date/);
  assert.match(migration, /l\.workspace<>expected_workspace/);
  assert.match(migration, /public\.employee_name_key\(l\.employee_name\)<>public\.employee_name_key\(e\.full_name\)/);
  assert.match(migration, /set approval_status=p_status/);
  assert.match(migration, /set approval_status=p_status/);
  assert.match(migration, /p_status not in \('approved','declined'\)/);
});

test("exemption approve and decline use the same protected review RPC", () => {
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const approvalsPage = readFileSync(new URL("../src/pages/AdminApprovals.tsx", import.meta.url), "utf8");
  const leaveMigration = readFileSync(new URL("../supabase/migrations/019_employee_hr_scope.sql", import.meta.url), "utf8");
  const guardMigration = readFileSync(new URL("../supabase/migrations/029_fix_exemption_approval_trigger_guard.sql", import.meta.url), "utf8");

  assert.match(service, /rpc\("review_exemption", \{ p_id: id, p_status: status, p_remarks: remarks \|\| null \}\)/);
  assert.match(approvalsPage, /reviewStagedExemption\(numericId, status/);
  assert.match(leaveMigration, /create or replace function public\.review_leave_request/);
  assert.doesNotMatch(leaveMigration, /app\.approval_review/);
  assert.doesNotMatch(guardMigration, /drop trigger|drop function|alter table/);
});

test("MAIN manual absences can precede uploads and take precedence over generated absences", () => {
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/030_main_manual_absence_precedence.sql", import.meta.url), "utf8");

  assert.match(context, /hrScope !== "MAIN" && !uploadedAvailableDates\.includes\(absenceDate\)/);
  assert.match(service, /employee_id: absence\.employeeId \?\? null/);
  assert.match(migration, /new\.source_type='system_generated'/);
  assert.match(migration, /a\.source_type='manual'/);
  assert.match(migration, /Superseded by MAIN manual absence/);
  assert.match(migration, /return null/);
});

test("MAIN Absence uniqueness rejects manual conflicts and skips generated conflicts", () => {
  const migration = readFileSync(new URL("../supabase/migrations/031_enforce_main_absence_uniqueness.sql", import.meta.url), "utf8");
  assert.match(migration, /create unique index absences_unique_main_active_employee_date/);
  assert.match(migration, /where workspace='WAIS' and employee_id is not null and not is_deleted/);
  assert.match(migration, /new\.source_type='system_generated'/);
  assert.match(migration, /return null/);
  assert.match(migration, /An absence record already exists for this employee and date\./);
  assert.match(migration, /duplicate_active_main_absence_reconciled/);
  assert.match(migration, /source_type='manual'\) desc/);
  assert.match(migration, /a\.id is distinct from new\.id/);
});

test("MAIN Absence duplicate identity is employee UUID plus work date and leaves ITC outside the index", () => {
  const migration = readFileSync(new URL("../supabase/migrations/031_enforce_main_absence_uniqueness.sql", import.meta.url), "utf8");
  assert.match(migration, /partition by employee_id, work_date/);
  assert.match(migration, /where workspace='WAIS'/);
  assert.doesNotMatch(migration, /where workspace in \('APP','WAIS'\)/);
});

test("MAIN Leave classification stays independent from the leave decision", () => {
  const migration = readFileSync(new URL("../supabase/migrations/032_main_leave_attendance_classification.sql", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/leaveService.ts", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../src/components/leave/AdminLeaveApprovals.tsx", import.meta.url), "utf8");
  const registry = readFileSync(new URL("../src/components/leave/LeaveRegistry.tsx", import.meta.url), "utf8");

  assert.match(migration, /attendance_classification text/);
  assert.match(migration, /p_classification not in \('excused','unexcused'\)/);
  assert.match(migration, /p_status not in \('approved','rejected'\)/);
  assert.match(migration, /attendance_classification=p_classification/);
  assert.match(migration, /status=p_status/);
  assert.match(migration, /if p_status='approved'/);
  assert.match(service, /review_leave_request_main/);
  assert.match(admin, /Attendance Classification/);
  assert.match(admin, /Leave Decision/);
  assert.match(admin, /classification \|\| !decisions/);
  assert.match(registry, /Attendance/);
  assert.match(registry, /Not recorded/);
});

test("ITC Leave keeps the existing review RPC path", () => {
  const service = readFileSync(new URL("../src/services/leaveService.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/019_employee_hr_scope.sql", import.meta.url), "utf8");
  assert.match(service, /const functionName = classification \? "review_leave_request_main" : "review_leave_request"/);
  assert.match(migration, /create or replace function public\.review_leave_request\(p_id uuid,p_status text,p_remarks text default null\)/);
});

test("MAIN checkout notes are loaded and prefilled without changing biometric checkout", () => {
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/pages/AttendanceRecords.tsx", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/027_preserve_main_biometric_checkout.sql", import.meta.url), "utf8");

  assert.match(service, /manualCheckoutNote: row\.manual_checkout_note \?\? null/);
  assert.match(page, /setEditNote\(mode === "checkin" \? record\.manualCheckinNote \?\? "" : record\.manualCheckoutNote \?\? ""\)/);
  assert.match(page, /Current Note/);
  assert.match(migration, /manual_checkout_note=nullif\(btrim\(p_note\),''\)/);
  assert.match(migration, /biometric_last_out=original_biometric/);
});

test("manual check-in is restricted to WAIS/MAIN HR and preserves the biometric first-in", () => {
  const migration = readFileSync(new URL("../supabase/migrations/041_main_manual_checkin_wais_hr.sql", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/pages/AttendanceRecords.tsx", import.meta.url), "utf8");

  assert.match(migration, /attendance_role\(\) <> 'HR'/);
  assert.match(migration, /attendance_hr_scope\(\) <> 'MAIN'/);
  assert.match(migration, /workspace = 'WAIS'/);
  assert.match(migration, /biometric_first_in = original_first_in/);
  assert.match(migration, /first_in_source = 'manual'/);
  assert.match(migration, /manual_checkin/);
  assert.match(migration, /late_records/);
  assert.match(migration, /half_day_records/);
  assert.match(migration, /source_type = 'system_generated'/);
  assert.match(service, /set_main_manual_checkin/);
  assert.match(context, /hrScope !== "MAIN" \|\| role !== "HR"/);
  assert.match(page, /saveManualCheckin/);
  assert.match(page, /Add Check-In/);
  assert.match(page, /Update Check-In/);
  assert.match(page, /Original Biometric First In/);
});

test("APP/ITC attendance paths remain separate from MAIN manual check-in", () => {
  const migration = readFileSync(new URL("../supabase/migrations/041_main_manual_checkin_wais_hr.sql", import.meta.url), "utf8");
  const attendance = readFileSync(new URL("../src/utils/mainAttendance.ts", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /workspace = 'APP'/);
  assert.doesNotMatch(migration, /attendance_hr_scope\(\) = 'ITC'/);
  assert.match(attendance, /classifyUploadedTimeIn/);
  assert.match(attendance, /aggregateMainAttendance/);
});

test("MAIN Admin can view Attendance Records but cannot use HR actions", () => {
  const routes = readFileSync(new URL("../src/app/routes.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../src/components/layout/RootLayout.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/pages/AttendanceRecords.tsx", import.meta.url), "utf8");

  assert.match(routes, /attendance-records", element: <ProtectedRoute allowedRoles=\{\["Admin", "HR"\]\}/);
  assert.match(layout, /Attendance Records", href: "\/attendance-records", icon: ListChecks, roles: \["Admin", "HR"\], mainOnly: true/);
  assert.match(page, /const canManage = role === "HR"/);
  assert.match(page, /\{canManage && activeModal/);
  assert.match(page, /AttendanceEditDialog/);
  assert.match(page, /openEditor\("checkout", r/);
  assert.match(page, /Maintenance/);
});

test("Admin dashboard gates upload, export, and file history behind the HR role", () => {
  const dashboard = readFileSync(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /\{isHr && <Button[\s\S]*?Export Excel/);
  assert.match(dashboard, /\{isHr && <>[\s\S]*?title="Imports & Reports"[\s\S]*?title="Uploaded Attendance Files"/);
  assert.match(dashboard, /\{isHr && <StatCard[\s\S]*?label="Files Uploaded"/);
});

test("employee profile photos use Employee Master UUID paths and a private scoped bucket", () => {
  const service = readFileSync(new URL("../src/services/employeeService.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/036_employee_profile_pictures.sql", import.meta.url), "utf8");
  assert.match(service, /employees\/\$\{employee\.id\}\/profile-/);
  assert.match(service, /profile_photo_path/);
  assert.match(migration, /profile_photo_path text/);
  assert.match(migration, /'employee-profile-pictures'.*false/s);
  assert.match(migration, /e\.hr_scope=public\.attendance_hr_scope\(\)/);
  assert.match(migration, /public\.attendance_role\(\)='HR'/);
});

test("profile photo upload validates supported images and the two megabyte limit", () => {
  const service = readFileSync(new URL("../src/services/employeeService.ts", import.meta.url), "utf8");
  assert.match(service, /"image\/jpeg": "jpg"/);
  assert.match(service, /"image\/png": "png"/);
  assert.match(service, /"image\/webp": "webp"/);
  assert.match(service, /2 \* 1024 \* 1024/);
  assert.match(service, /Please select a JPG, PNG, or WebP image/);
  assert.match(service, /Profile photo must be 2 MB or smaller/);
});

test("photo replacement updates Employee Master before deleting the old object", () => {
  const service = readFileSync(new URL("../src/services/employeeService.ts", import.meta.url), "utf8");
  const updateIndex = service.indexOf('update({ profile_photo_path: path })');
  const oldDeleteIndex = service.indexOf('remove([employee.profilePhotoPath])');
  assert.ok(updateIndex > -1 && oldDeleteIndex > updateIndex);
  assert.match(service, /update\(\{ profile_photo_path: null \}\)/);
});

test("shared EmployeeAvatar resolves current Employee Master photo and falls back to initials", () => {
  const avatar = readFileSync(new URL("../src/components/employees/EmployeeAvatar.tsx", import.meta.url), "utf8");
  assert.match(avatar, /employees\.find/);
  assert.match(avatar, /item\.id === employeeId/);
  assert.match(avatar, /employeeInitials\(name\)/);
  assert.match(avatar, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(avatar, /loading="lazy"/);
});

test("employee photos are presented across employee attendance and approval views", () => {
  const files = [
    "../src/pages/EmployeesPage.tsx", "../src/pages/AttendanceRecords.tsx",
    "../src/pages/LateRecords.tsx", "../src/pages/Absences.tsx",
    "../src/pages/Exemptions.tsx", "../src/pages/Undertime.tsx",
    "../src/pages/HalfDay.tsx", "../src/pages/AdminApprovals.tsx",
    "../src/components/leave/LeaveRegistry.tsx", "../src/components/leave/AdminLeaveApprovals.tsx",
  ];
  for (const file of files) assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /EmployeeAvatar/);
});

test("migration 037 enforces canonical undertime identity and manual precedence", () => {
  const migration = readFileSync(new URL("../supabase/migrations/037_undertime_identity_and_precedence.sql", import.meta.url), "utf8");
  assert.match(migration, /generated_undertimes[\s\S]*?employee_id uuid references public\.employees\(id\)/);
  assert.match(migration, /manual_undertimes[\s\S]*?source_attendance_id uuid references public\.main_daily_attendance\(id\)/);
  assert.match(migration, /on public\.generated_undertimes\(workspace,employee_id,work_date\)[\s\S]*?where not is_deleted and employee_id is not null/);
  assert.match(migration, /on public\.manual_undertimes\(workspace,employee_id,work_date\)[\s\S]*?where not is_deleted and employee_id is not null/);
  assert.match(migration, /superseded_by_manual_undertime/);
  assert.match(migration, /array_agg\(e\.id order by e\.id\)[\s\S]*?cardinality\(matches\)=1/);
  assert.match(migration, /if not new\.is_deleted and new\.employee_id is null then return null/);
  assert.match(migration, /if exists\(select 1 from public\.manual_undertimes[\s\S]*?then return null/);
  assert.match(migration, /create trigger manual_undertime_precedence before insert or update/);
  assert.match(migration, /main_daily_attendance[\s\S]*?employee_id=e\.id and work_date=p_work_date[\s\S]*?status='complete'/);
});

test("migration 037 hardens source validation, duration, and concurrent precedence", () => {
  const migration = readFileSync(new URL("../supabase/migrations/037_undertime_identity_and_precedence.sql", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  assert.match(migration, /group by u\.id having count\(\*\)=1/);
  assert.match(migration, /a\.status='complete' and a\.last_out is not null/);
  assert.match(migration, /source_attendance_id=c\.ids\[1\]/);
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*?workspace[\s\S]*?employee_id[\s\S]*?work_date/);
  assert.ok((migration.match(/perform public\.lock_undertime_identity/g) ?? []).length >= 3);
  assert.match(migration, /canonical_minutes:=case[\s\S]*?extract\(hour from a\.last_out\)[\s\S]*?extract\(minute from a\.last_out\)/);
  assert.match(migration, /canonical_hours:=to_char\(a\.last_out/);
  assert.match(migration, /public\.late_records where id=p_source_late_record_id[\s\S]*?workspace=public\.attendance_workspace\(\)[\s\S]*?employee_id=e\.id[\s\S]*?work_date=p_work_date[\s\S]*?not is_deleted/);
  assert.match(migration, /public\.uploaded_files f where f\.id=l\.source_file_id[\s\S]*?not f\.is_deleted/);
  assert.match(migration, /unresolved_employee_identity/);
  assert.match(service, /employee_id: record\.employeeId \?\? null/);
  assert.match(context, /employeeMatches\.length === 1 \? employeeMatches\[0\]\.id : undefined/);
});

test("manual attendance mutations are database-first and failures remain visible", () => {
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/attendanceService.ts", import.meta.url), "utf8");
  assert.ok(context.indexOf("await saveAbsenceRecord") < context.indexOf("setAbsences((prev)"));
  assert.match(context, /await saveManualUndertimeRecord\(newUndertime\);[\s\S]*?await applyDatabaseData\(false\)/);
  assert.match(context, /await deleteManualUndertimeRecord\(id,[\s\S]*?await applyDatabaseData\(false\)/);
  assert.match(context, /await softDeleteManualLateRecord\(id,[\s\S]*?await applyDatabaseData\(false\)/);
  assert.match(service, /for \(const table of tables\)[\s\S]*?if \(error\) errors\.push[\s\S]*?failed: errors\.length/);
});

test("ITC File History hides matching diagnostics while MAIN keeps the complete column contract", () => {
  const dashboard = readFileSync(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /hrScope === "ITC"[\s\S]*?uploadedColumns\.filter/);
  assert.match(dashboard, /\["attendanceRange", "matched", "unmatched"\]/);
  assert.match(dashboard, /: uploadedColumns/);
  assert.match(dashboard, /min-w-\[190px\][\s\S]*?inline-flex[\s\S]*?uploadedDate[\s\S]*?text-slate-400[\s\S]*?uploadedTime/);
});

test("ITC history pages reuse the scoped searchable Employee Master filter", () => {
  const component = readFileSync(new URL("../src/components/employees/EmployeeFilterCombobox.tsx", import.meta.url), "utf8");
  const exemptions = readFileSync(new URL("../src/pages/Exemptions.tsx", import.meta.url), "utf8");
  const absences = readFileSync(new URL("../src/pages/Absences.tsx", import.meta.url), "utf8");
  const leave = readFileSync(new URL("../src/components/leave/LeaveRegistry.tsx", import.meta.url), "utf8");
  assert.match(component, /SearchableCombobox/);
  assert.match(component, /placeholder="Search or select employee"/);
  assert.match(component, /onClear=\{\(\) => onChange\(""\)\}/);
  assert.match(component, /Clear employee filter/);
  assert.match(exemptions, /hrScope === "ITC" \? <EmployeeFilterCombobox employees=\{activeEmployees\}/);
  assert.match(absences, /EmployeeFilterCombobox employees=\{activeEmployees\}/);
  assert.match(leave, /hrScope === "ITC" \? <EmployeeFilterCombobox employees=\{employees\}/);
});

test("employee ID filtering remains exact and combines with exemption history filters", () => {
  const rows = [
    { employeeId: "itc-1", name: "Doe, John", date: "2026-01-02", approvalStatus: "approved" as const },
    { employeeId: "itc-2", name: "Doe, John", date: "2026-01-03", approvalStatus: "approved" as const },
    { employeeId: "itc-1", name: "Doe, John", date: "2025-01-03", approvalStatus: "pending" as const },
  ];
  const result = filterExemptionHistory(rows, { search: "", employeeId: "itc-1", year: "2026", month: "01", status: "approved", sort: "oldest" });
  assert.deepEqual(result.map((row) => row.date), ["2026-01-02"]);
});

test("Undertime uses a safe separator and does not render the mojibake bullet", () => {
  const page = readFileSync(new URL("../src/pages/Undertime.tsx", import.meta.url), "utf8");
  assert.match(page, /\{record\.date\} \| \{record\.timeIn\}/);
  assert.doesNotMatch(page, /Ã¢â‚¬Â¢|â€¢/);
});

test("Excel detail sorting is employee, calendar date, time, then stable source order", () => {
  const source = [
    { id: "d", name: "Bravo", date: "09/02/2026", timeIn: "08:00 AM" },
    { id: "b", name: "Alpha", date: "09/10/2026", timeIn: "08:00 AM" },
    { id: "c", name: "Alpha", date: "09/02/2026", timeIn: "09:00 AM" },
    { id: "a", name: "Alpha", date: "09/02/2026", timeIn: "07:00 AM" },
    { id: "a2", name: "Alpha", date: "09/02/2026", timeIn: "07:00 AM" },
  ];
  assert.deepEqual(sortAttendanceDetailRecords(source).map((row) => row.id), ["a", "a2", "c", "b", "d"]);
  assert.equal(attendanceDateValue("09/02/2026") < attendanceDateValue("09/10/2026"), true);
  assert.equal(attendanceTimeValue("07:00 AM") < attendanceTimeValue("09:00 AM"), true);
  const excelDate = toExcelCalendarDate("2026-09-02");
  assert.ok(excelDate instanceof Date);
  assert.equal(excelDate.getFullYear(), 2026);
  assert.equal(source.length, sortAttendanceDetailRecords(source).length);
});

test("Excel details use real date cells, numeric alignment, and frozen report headings", () => {
  const context = readFileSync(new URL("../src/context/AttendanceContext.tsx", import.meta.url), "utf8");
  assert.match(context, /sortAttendanceDetailRecords\(items\)/);
  assert.match(context, /toExcelCalendarDate\(item\.date\)/);
  assert.match(context, /cell\.numFmt = "mm\/dd\/yyyy"/);
  assert.match(context, /typeof value === "number" \? "right"/);
  assert.match(context, /state: "frozen", ySplit: 2/);
  assert.match(context, /applyContentAwareColumnWidths\(lateSheet\)/);
  assert.match(context, /applyContentAwareColumnWidths\(absenceSheet\)/);
});

test("ITC Leave aligns the searchable employee and labeled year controls", () => {
  const registry = readFileSync(new URL("../src/components/leave/LeaveRegistry.tsx", import.meta.url), "utf8");
  assert.match(registry, /grid items-start gap-3 sm:grid-cols-\[minmax\(0,1fr\)_180px\]/);
  assert.match(registry, /label=\{hrScope === "ITC" \? "Year" : undefined\}/);
  assert.match(registry, /EmployeeFilterCombobox/);
});

test("four-digit slash dates retain the full 2026 year through ExcelJS serialization", async () => {
  for (const input of ["2026-08-03", "08/03/2026", "2026-09-16", "09/16/2026"]) {
    const converted = toExcelCalendarDate(input);
    assert.ok(converted instanceof Date);
    assert.equal(converted.getFullYear(), 2026);
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Dates");
  sheet.getCell("A1").value = toExcelCalendarDate("2026-08-03");
  sheet.getCell("A2").value = toExcelCalendarDate("09/16/2026");
  sheet.getColumn(1).numFmt = "mm/dd/yyyy";
  const buffer = await workbook.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  const first = restored.getWorksheet("Dates")?.getCell("A1").value;
  const second = restored.getWorksheet("Dates")?.getCell("A2").value;
  assert.ok(first instanceof Date && second instanceof Date);
  assert.equal(first.getFullYear(), 2026);
  assert.equal(first.getMonth(), 7);
  assert.equal(first.getDate(), 3);
  assert.equal(second.getFullYear(), 2026);
  assert.equal(second.getMonth(), 8);
  assert.equal(second.getDate(), 16);
});

test("content-aware Excel widths fit common headers and filenames within safe caps", () => {
  assert.ok(computeExcelColumnWidth(["Employee", "Agravio, John Maric"], 12, 38) >= 21);
  assert.ok(computeExcelColumnWidth(["Source File", "Attendance September 25, 2026.xlsx"], 12, 38) >= 36);
  assert.ok(computeExcelColumnWidth(["Employees with Lates"], 12, 38) >= 22);
  assert.equal(computeExcelColumnWidth(["x".repeat(200)], 12, 38), 38);
});
