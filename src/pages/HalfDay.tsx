import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Clock3, Trash2 } from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { useAttendance } from "../context/AttendanceContext";
import { MainMoveToService } from "../components/attendance/MainMoveToService";
import { useEmployees } from "../context/EmployeesContext";
import { listEligibleItcServices, moveItcGeneratedAttendanceToService, refreshMainServiceAttendance, type ServiceEvent } from "../services/serviceService";
import { EmployeeAvatar } from "../components/employees/EmployeeAvatar";

import {
  formatTime12Hour,
  formatTime12HourWithOptionalSeconds,
  dateFilterDates,
  dateFilterMonths,
  dateFilterYears,
  halfDayRange,
  matchesDateFilters,
  type HalfDayPeriod,
} from "../utils/attendanceForms";

import {
  createStagedHalfDay,
  describeSupabaseError,
  deleteStagedHalfDay,
  loadStagedHalfDays,
  restoreConvertedHalfDayToUndertime,
  type StagedHalfDayRecord,
} from "../services/attendanceService";

import {
  AlertMessage,
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  PageHeader,
  SectionHeader,
  Select,
} from "../components/ui";

const displayDate = (value: string) =>
  new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export function HalfDay() {
  const { workspace, hrScope, role } = useAuth();
  const { activeEmployees } = useEmployees();
  const { loadDeletedAttendanceData, refreshAttendanceData } = useAttendance();

  const [activeTab, setActiveTab] = useState<"system" | "manual">("system");
  const [employee, setEmployee] = useState("");
  const [date, setDate] = useState("");
  const [period, setPeriod] = useState<HalfDayPeriod>("morning");
  const [systemYear, setSystemYear] = useState("all");
  const [systemMonth, setSystemMonth] = useState("all");
  const [systemDate, setSystemDate] = useState("all");

  const range = useMemo(
    () => (date ? halfDayRange(date, period) : null),
    [date, period],
  );

  const selectedEmployee = activeEmployees.find(
    (item) => item.id === employee,
  );

  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [savedRecords, setSavedRecords] = useState<StagedHalfDayRecord[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StagedHalfDayRecord | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<StagedHalfDayRecord | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [serviceTarget, setServiceTarget] = useState<StagedHalfDayRecord | null>(null);
  const [serviceOptions, setServiceOptions] = useState<ServiceEvent[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState("");

  const refreshSavedRecords = useCallback(async () => {
    try {
      if (!workspace) {
        setSavedRecords([]);
        return;
      }

      if (workspace === "WAIS" && hrScope === "MAIN" && role === "HR") await refreshMainServiceAttendance();
      const records = await loadStagedHalfDays(workspace);
      setSavedRecords(records);
    } catch {
      setFeedback({
        type: "error",
        message: "Could not refresh saved half-day records.",
      });
    }
  }, [workspace, hrScope, role]);

  useEffect(() => {
    void refreshSavedRecords();
  }, [refreshSavedRecords]);

  const isSystemGenerated = (record: StagedHalfDayRecord) => record.sourceType === "attendance_upload" || record.sourceType === "system_generated";
  const systemDates = useMemo(() => savedRecords.filter(isSystemGenerated).map((record) => record.workDate), [savedRecords]);
  const systemYears = useMemo(() => dateFilterYears(systemDates), [systemDates]);
  const systemMonths = useMemo(() => dateFilterMonths(systemDates, systemYear), [systemDates, systemYear]);
  const systemExactDates = useMemo(() => dateFilterDates(systemDates, systemYear, systemMonth), [systemDates, systemYear, systemMonth]);
  const scopedRecords = useMemo(
    () => savedRecords
        .filter((record) => !isSystemGenerated(record) || matchesDateFilters(record.workDate, systemYear, systemMonth, systemDate))
        .sort(
          (a, b) =>
            b.workDate.localeCompare(a.workDate) ||
            (b.sourceTimeIn ?? "").localeCompare(a.sourceTimeIn ?? ""),
        ),
    [savedRecords, systemYear, systemMonth, systemDate],
  );

  const systemRecords = scopedRecords.filter(isSystemGenerated);

  const manualRecords = scopedRecords.filter(
    (record) => record.sourceType === "manual",
  );

  const save = async () => {
    if (!selectedEmployee || !date || !range || !reason.trim()) {
      setFeedback({
        type: "error",
        message: "Select an employee, date, valid period, and reason.",
      });
      return;
    }

    try {
      await createStagedHalfDay({
        employeeId: selectedEmployee.id,
        date,
        period,
        reason: reason.trim(),
      });

      await refreshSavedRecords();

      setFeedback({
        type: "success",
        message: "Half-day saved.",
      });

      setReason("");
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not save half-day.",
      });
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    setFeedback(null);

    try {
      await deleteStagedHalfDay(id);
      await Promise.all([refreshSavedRecords(), loadDeletedAttendanceData()]);

      setFeedback({
        type: "success",
        message: "Half-day record moved to Recycle Bin.",
      });
      return true;
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not delete the half-day record.",
      });
      return false;
    } finally {
      setDeletingId(null);
    }
  };

  const employeeName = (record: StagedHalfDayRecord) =>
    activeEmployees.find((item) => item.id === record.employeeId)?.fullName ??
    record.employeeName;

  const openMoveToService = async (record: StagedHalfDayRecord) => {
    if (hrScope !== "ITC" || role !== "HR") return;
    try { const options = await listEligibleItcServices(record.employeeId, record.workDate); setServiceOptions(options); setSelectedServiceId(options[0]?.id ?? ""); setServiceTarget(record); } catch { setFeedback({ type: "error", message: "Could not load eligible Service records." }); }
  };

  const restoreConversion = async () => {
    if (!restoreTarget || !restoreTarget.canRestoreToUndertime) return;
    const target = restoreTarget;
    setRestoringId(target.id);
    setFeedback(null);
    try {
      await restoreConvertedHalfDayToUndertime(target.id);
      await Promise.all([refreshSavedRecords(), refreshAttendanceData(), loadDeletedAttendanceData()]);
      setRestoreTarget(null);
      setFeedback({ type: "success", message: "Original generated Undertime restored." });
    } catch (error) {
      setFeedback({ type: "error", message: describeSupabaseError(error) });
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Half-Day"
        description="Review system-generated classifications or manage manual half-day entries."
        actions={
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("system")}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${
                activeTab === "system"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              System Generated
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("manual")}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${
                activeTab === "manual"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              Manual Entry
            </button>
          </div>
        }
      />

      {feedback && (
        <AlertMessage
          tone={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {activeTab === "system" ? (
        <Card>
          <SectionHeader
            icon={<Clock3 className="h-5 w-5" />}
            iconTone="brand"
            title="System Generated Half-Days"
            description="System- and upload-generated classifications in the current Dashboard date scope."
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-3"><Select label="Year" value={systemYear} onChange={(event) => { setSystemYear(event.target.value); setSystemMonth("all"); setSystemDate("all"); }}><option value="all">All Years</option>{systemYears.map((item) => <option key={item}>{item}</option>)}</Select><Select label="Month" value={systemMonth} onChange={(event) => { setSystemMonth(event.target.value); setSystemDate("all"); }}><option value="all">All Months</option>{systemMonths.map((item) => <option key={item} value={item}>{new Date(2000, Number(item) - 1, 1).toLocaleDateString("en-US", { month: "long" })}</option>)}</Select><Select label="Exact Date" value={systemDate} onChange={(event) => setSystemDate(event.target.value)}><option value="all">All Dates</option>{systemExactDates.map((item) => <option key={item} value={item}>{new Date(`${item}T00:00:00`).toLocaleDateString("en-US")}</option>)}</Select></div>
          <p className="mt-3 text-xs font-medium text-slate-500">{systemRecords.length} record{systemRecords.length === 1 ? "" : "s"}</p>

          {systemRecords.length === 0 ? (
            <EmptyState
              icon={<CalendarRange className="h-6 w-6" />}
              title="No system-generated half-days"
              description="No uploaded Half-Day classifications match the current Dashboard scope."
              bordered={false}
            />
          ) : (
            <ul className="mt-5 grid gap-3 md:grid-cols-2">
              {systemRecords.map((record) => (
                <li
                  key={record.id}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <EmployeeAvatar employeeId={record.employeeId} name={employeeName(record)} />
                      <div>
                      <p className="font-semibold text-slate-900">
                        {employeeName(record)}
                      </p>

                      <p className="mt-0.5 text-xs text-slate-500">
                        {displayDate(record.workDate)}
                      </p>
                      </div>
                    </div>

                    <Badge tone="info">System Generated</Badge>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {isSystemGenerated(record) && <MainMoveToService type="half_day" recordId={record.id} onMoved={refreshSavedRecords} />}
                    {hrScope === "ITC" && role === "HR" && record.sourceType === "attendance_upload" && <Button size="sm" variant="secondary" onClick={() => void openMoveToService(record)}>Move to Service</Button>}
                    {workspace === "APP" && hrScope === "ITC" && role === "HR" && record.canRestoreToUndertime && <Button size="sm" variant="secondary" disabled={restoringId === record.id} onClick={() => setRestoreTarget(record)}>Restore to Undertime</Button>}
                    {workspace === "APP" && hrScope === "ITC" && role === "HR" && record.sourceType === "system_generated" && <Button size="sm" variant="danger" disabled={deletingId === record.id} onClick={() => setDeleteTarget(record)}>Delete</Button>}
                  </div>

                  <dl className="mt-4 grid gap-2 text-sm">
                    {hrScope === "MAIN" && (
                      <div>
                        <dt className="text-xs font-medium text-slate-500">First In</dt>

                        <dd className="font-semibold text-slate-900">
                          {record.sourceTimeIn ? formatTime12HourWithOptionalSeconds(record.sourceTimeIn) : "Not recorded"}
                        </dd>
                      </div>
                    )}

                    <div>
                      <dt className="text-xs font-medium text-slate-500">
                        Classification
                      </dt>

                      <dd className="text-slate-700">
                        {record.absentPeriod === "morning"
                          ? "Morning Absent"
                          : "Afternoon Absent"}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium text-slate-500">
                        Schedule
                      </dt>

                      <dd className="text-slate-700">
                        {formatTime12Hour(record.scheduledStart)}–
                        {formatTime12Hour(record.scheduledEnd)}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium text-slate-500">
                        Source
                      </dt>

                      <dd className="break-words text-slate-700">
                        {record.sourceType === "system_generated" && record.sourceGeneratedUndertimeId
                          ? `From Generated Undertime #${record.sourceGeneratedUndertimeId}`
                          : record.sourceFileName || "Attendance upload"}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <>
          <Card>
            <SectionHeader
              icon={<CalendarRange className="h-5 w-5" />}
              iconTone="brand"
              title="Add Manual Half-Day"
              description="Create a manual half-day record for an active employee. No approval is required."
            />

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <Select
                label="Employee Name"
                hint="Only active employees are available."
                value={employee}
                onChange={(event) => setEmployee(event.target.value)}
              >
                <option value="">Select active employee</option>

                {activeEmployees.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName}
                  </option>
                ))}
              </Select>

              <label className="block text-sm font-medium text-slate-700">
                Date
                <input
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>

              <Select
                label="Absent period"
                value={period}
                onChange={(event) =>
                  setPeriod(event.target.value as HalfDayPeriod)
                }
              >
                <option value="morning">Morning absent</option>
                <option value="afternoon">Afternoon absent</option>
              </Select>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Selected employee
                </p>

                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {selectedEmployee?.fullName ?? "Select an employee"}
                </p>
              </div>
            </div>

            <label className="mt-5 block text-sm font-medium text-slate-700">
              Reason
              <textarea
                className="mt-1.5 min-h-20 w-full rounded-lg border border-slate-300 p-3 text-sm"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>

            {date && !range && (
              <div className="mt-5">
                <AlertMessage
                  tone="error"
                  title="No standard Sunday half-day"
                  message="Choose a Monday–Saturday date for a scheduled half-day period."
                />
              </div>
            )}

            {range && (
              <div className="mt-5 flex gap-3 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                <Clock3 className="mt-0.5 h-5 w-5 flex-none text-brand-700" />

                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {period === "morning"
                      ? "Morning absent"
                      : "Afternoon absent"}
                  </p>

                  <p className="mt-1 text-sm text-slate-600">
                    Scheduled absence:{" "}
                    <strong>
                      {formatTime12Hour(range[0])}–
                      {formatTime12Hour(range[1])}
                    </strong>
                  </p>
                </div>
              </div>
            )}

            <Button
              className="mt-5"
              disabled={
                !employee ||
                !date ||
                !range ||
                !reason.trim()
              }
              onClick={() => void save()}
            >
              Save Half-Day
            </Button>
          </Card>

          <Card>
            <SectionHeader
              title="Manual Half-Day Records"
              description="Manually created records in the current Dashboard date scope."
            />

            {manualRecords.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No manual half-day records match the current scope.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {manualRecords.map((record) => (
                  <div
                    key={record.id}
                    className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 text-sm text-slate-700 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <EmployeeAvatar employeeId={record.employeeId} name={employeeName(record)} size="sm" />
                      <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-900">
                          {employeeName(record)} · {displayDate(record.workDate)}
                        </p>

                        <Badge tone="neutral">Manual</Badge>
                      </div>

                      <p className="mt-1">
                        {record.absentPeriod === "morning"
                          ? "Morning"
                          : "Afternoon"}{" "}
                        absent: {formatTime12Hour(record.scheduledStart)}–
                        {formatTime12Hour(record.scheduledEnd)}
                      </p>
                      </div>

                      <p className="mt-1 text-slate-500">
                        {record.reason}
                      </p>
                    </div>

                    <Button
                      variant="danger"
                      size="sm"
                      disabled={deletingId === record.id}
                      leftIcon={<Trash2 className="h-4 w-4" />}
                      onClick={() => void remove(record.id)}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {serviceTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><Card className="w-full max-w-lg"><SectionHeader title="Move to Service" description={`${employeeName(serviceTarget)} — ${displayDate(serviceTarget.workDate)}`} />{serviceOptions.length === 0 ? <p className="mt-4 text-sm text-slate-600">No eligible Service record was found for this employee and date.</p> : <Select className="mt-4" label="Eligible Service" value={selectedServiceId} onChange={(event) => setSelectedServiceId(event.target.value)}>{serviceOptions.map((event) => <option key={event.id} value={event.id}>{event.serviceRef} — {new Date(event.serviceStart).toLocaleString()} to {event.serviceEnd ? new Date(event.serviceEnd).toLocaleString() : "In Service"}</option>)}</Select>}<div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setServiceTarget(null)}>Cancel</Button>{serviceOptions.length > 0 && <Button onClick={async () => { try { await moveItcGeneratedAttendanceToService("half_day", serviceTarget.id, selectedServiceId); setServiceTarget(null); await refreshSavedRecords(); setFeedback({ type: "success", message: "Generated Half-Day reconciled with Service." }); } catch (error) { setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not move Half-Day to Service." }); } }}>Move to Service</Button>}</div></Card></div>}
      <ConfirmModal open={Boolean(deleteTarget)} tone="danger" title="Delete Half-Day Record?" description={deleteTarget ? <div><p className="font-semibold">{employeeName(deleteTarget)}</p><p>{displayDate(deleteTarget.workDate)} · {deleteTarget.absentPeriod === "morning" ? "Morning" : "Afternoon"} Half-Day</p><p className="mt-3">This record will be moved to the Recycle Bin. Its source Undertime will remain deleted.</p></div> : null} confirmLabel="Delete" loading={Boolean(deleteTarget && deletingId === deleteTarget.id)} onConfirm={async () => { if (!deleteTarget) return; if (await remove(deleteTarget.id)) setDeleteTarget(null); }} onCancel={() => { if (!deletingId) setDeleteTarget(null); }} />
      <ConfirmModal open={Boolean(restoreTarget)} tone="primary" title="Restore to Undertime?" description={restoreTarget ? <div><p className="font-semibold">{employeeName(restoreTarget)}</p><p>{displayDate(restoreTarget.workDate)}</p><p className="mt-3">This will remove the converted Half-Day and return the original System Generated Undertime record.</p></div> : null} confirmLabel="Restore to Undertime" loading={Boolean(restoreTarget && restoringId === restoreTarget.id)} onConfirm={() => void restoreConversion()} onCancel={() => { if (!restoringId) setRestoreTarget(null); }} />
    </div>
  );
}
