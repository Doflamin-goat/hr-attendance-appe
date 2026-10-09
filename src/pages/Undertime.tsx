import { useMemo, useState } from "react";
import { useAttendance, type GeneratedUndertime } from "../context/AttendanceContext";
import { useEmployees } from "../context/EmployeesContext";
import { EmployeeAvatar } from "../components/employees/EmployeeAvatar";
import { useAuth } from "../context/AuthContext";
import { attendanceRecordRange, dateFilterDates, dateFilterMonths, dateFilterYears, formatDuration, formatTime12Hour, matchesDateFilters } from "../utils/attendanceForms";
import { informedPeopleForScope } from "../utils/informedPeople";
import { checkoutUndertimeMinutes } from "../utils/mainAttendance";
import { listEligibleItcServices, moveItcGeneratedAttendanceToService, type ServiceEvent } from "../services/serviceService";
import { MainMoveToService } from "../components/attendance/MainMoveToService";
import {
  Clock3,
  Plus,
  CalendarDays,
  Timer,
  RotateCcw,
  Trash2,
  Pencil,
} from "lucide-react";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
  SearchableCombobox,
  Textarea,
  EmptyState,
  AlertMessage,
  ConfirmModal,
  SectionHeader,
  SkeletonTable,
  toast,
} from "../components/ui";

function getMonthKey(dateValue: string) {
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

type RestoreTarget = { id: string; name: string; date: string } | null;
type DeleteTarget = { id: string; name: string; date: string } | null;

export function Undertime() {
  const {
    loading,
    generatedUndertimes,
    mainDailyAttendance,
    allLateRecords,
    manualUndertimes,
    addUndertime,
    deleteManualUndertimesByMonth,
    removeManualUndertimeAdjustment,
    deleteManualUndertime,
    updateGeneratedUndertimeDetails,
    moveGeneratedUndertimeToHalfDay,
  } = useAttendance();
  const { activeEmployees } = useEmployees();
  const { hrScope, role } = useAuth();

  const [activeTab, setActiveTab] = useState<"system" | "manual">("manual");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [informed, setInformed] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [sourceRecordId, setSourceRecordId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [systemYear, setSystemYear] = useState("all");
  const [systemMonth, setSystemMonth] = useState("all");
  const [systemDate, setSystemDate] = useState("all");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [confirmDeleteMonth, setConfirmDeleteMonth] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [editTarget, setEditTarget] = useState<GeneratedUndertime | null>(null);
  const [editReason, setEditReason] = useState("");
  const [editInformed, setEditInformed] = useState<string[]>([]);
  const [halfDayTarget, setHalfDayTarget] = useState<GeneratedUndertime | null>(null);
  const [serviceTarget, setServiceTarget] = useState<GeneratedUndertime | null>(null);
  const [serviceOptions, setServiceOptions] = useState<ServiceEvent[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const matchingLateRecords = useMemo(() => allLateRecords.filter((record) => {
    const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    const recordDate = record.workDate ?? new Date(record.date).toLocaleDateString("en-CA");
    const alreadyGenerated = generatedUndertimes.some((generated) => normalize(generated.name) === normalize(record.name) && generated.date === record.date && generated.timeIn === record.timeIn);
    return record.sourceType !== "manual-entry" && !record.isDeleted && !alreadyGenerated && normalize(record.name) === normalize(employeeName) && recordDate === date && Boolean(attendanceRecordRange(date, record.timeIn));
  }), [allLateRecords, generatedUndertimes, employeeName, date]);
  const matchingMainAttendance = useMemo(() => mainDailyAttendance.filter((record) =>
    record.employeeId === employeeId && record.workDate === date && record.status === "complete" && Boolean(record.lastOut) && checkoutUndertimeMinutes(record.workDate, record.lastOut!) > 0
  ), [mainDailyAttendance, employeeId, date]);
  const matchingAttendanceRecords = hrScope === "MAIN" ? matchingMainAttendance : matchingLateRecords;
  const selectedAttendanceRecord = useMemo(
    () => matchingAttendanceRecords.find((record) => record.id === sourceRecordId),
    [matchingAttendanceRecords, sourceRecordId],
  );
  const selectedAttendanceRange = useMemo(
    () => {
      if (!selectedAttendanceRecord) return null;
      if (hrScope === "MAIN" && "lastOut" in selectedAttendanceRecord && selectedAttendanceRecord.lastOut) {
        const minutes = checkoutUndertimeMinutes(date, selectedAttendanceRecord.lastOut);
        const end = new Date(`${date}T00:00:00`).getDay() === 6 ? "15:15" : "17:00";
        return { kind: "undertime" as const, from: selectedAttendanceRecord.lastOut.slice(0, 5), to: end, minutes };
      }
      return "timeIn" in selectedAttendanceRecord ? attendanceRecordRange(date, selectedAttendanceRecord.timeIn) : null;
    },
    [date, hrScope, selectedAttendanceRecord],
  );
  const informedOptions = informedPeopleForScope(hrScope);

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    manualUndertimes.forEach((record) => {
      months.add(getMonthKey(record.date));
    });
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [manualUndertimes]);

  const filteredManualUndertimes = useMemo(() => {
    const filtered =
      selectedMonth === "all"
        ? manualUndertimes
        : manualUndertimes.filter(
            (record) => getMonthKey(record.date) === selectedMonth
          );

    return [...filtered].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [manualUndertimes, selectedMonth]);

  const systemDates = useMemo(() => generatedUndertimes.map((record) => record.date), [generatedUndertimes]);
  const systemYears = useMemo(() => dateFilterYears(systemDates), [systemDates]);
  const systemMonths = useMemo(() => dateFilterMonths(systemDates, systemYear), [systemDates, systemYear]);
  const systemExactDates = useMemo(() => dateFilterDates(systemDates, systemYear, systemMonth), [systemDates, systemYear, systemMonth]);
  const filteredGeneratedUndertimes = useMemo(() => generatedUndertimes.filter((record) => matchesDateFilters(record.date, systemYear, systemMonth, systemDate)).sort((a, b) => new Date(`${b.date} ${b.timeIn}`).getTime() - new Date(`${a.date} ${a.timeIn}`).getTime()), [generatedUndertimes, systemYear, systemMonth, systemDate]);

  const handleSave = async () => {
    if (!employeeId || !date || !sourceRecordId || !selectedAttendanceRange || !reason.trim()) {
      setFeedback({
        type: "error",
        message: "Please complete all manual undertime fields.",
      });
      return;
    }
    const undertimeHours = `${selectedAttendanceRange.from} to ${selectedAttendanceRange.to} (${formatDuration(selectedAttendanceRange.minutes)})`;

    const result = await addUndertime({
      employeeId,
      name: employeeName.trim(),
      date,
      reason: reason.trim(),
      undertimeHours,
      informed,
      sourceLateRecordId: hrScope === "MAIN" ? undefined : sourceRecordId,
      sourceAttendanceRecordId: hrScope === "MAIN" ? sourceRecordId : undefined,
      originalTimeIn: hrScope === "MAIN" ? undefined : matchingLateRecords.find((record) => record.id === sourceRecordId)?.timeIn,
    });

    setFeedback({
      type: result.success ? "success" : "error",
      message: result.message,
    });

    if (result.success) {
      setEmployeeName("");
      setEmployeeId("");
      setDate("");
      setReason("");
      setInformed([]);
      setSourceRecordId("");
      setSelectedMonth(getMonthKey(date));
    }
  };

  const handleDeleteMonth = async () => {
    const result = await deleteManualUndertimesByMonth(selectedMonth);
    setFeedback({
      type: result.success ? "success" : "error",
      message: result.success ? `All manual undertime records for ${formatMonthLabel(selectedMonth)} were moved to Trash. Their late records are back in Late Records.` : result.message,
    });
    if (result.success) setSelectedMonth("all");
    setConfirmDeleteMonth(false);
  };

  const handleRestoreConfirm = async () => {
    if (!restoreTarget) return;
    const result = await removeManualUndertimeAdjustment(restoreTarget.id);
    if (!result.success) {
      setFeedback({ type: "error", message: result.message });
      return;
    }
    setFeedback({
      type: "success",
      message: `${restoreTarget.name}'s late on ${new Date(
        restoreTarget.date
      ).toLocaleDateString(
        "en-US"
      )} is back in Late Records. The undertime row was moved to Trash and can be restored from Recycle Bin.`,
    });
    setRestoreTarget(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const result = await deleteManualUndertime(deleteTarget.id);
    if (!result.success) { toast.error("Delete failed", result.message); return; }
    setDeleteTarget(null);
    toast.success("Record moved to Trash.");
  };

  const openGeneratedEdit = (record: GeneratedUndertime) => {
    setEditTarget(record);
    setEditReason(record.reason ?? "");
    setEditInformed(record.informed ?? []);
    setFeedback(null);
  };

  const saveGeneratedEdit = async () => {
    if (!editTarget) return;
    const result = await updateGeneratedUndertimeDetails(editTarget.id, editReason, editInformed);
    setFeedback({ type: result.success ? "success" : "error", message: result.message });
    if (result.success) setEditTarget(null);
  };

  const openMoveToService = async (record: GeneratedUndertime) => {
    try { const options = await listEligibleItcServices(record.employeeId ?? "", new Date(record.date).toLocaleDateString("en-CA")); setServiceOptions(options); setSelectedServiceId(options[0]?.id ?? ""); setServiceTarget(record); } catch { setFeedback({ type: "error", message: "Could not load eligible Service records." }); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Undertime Records"
        description="View system-detected undertime and add manual undertime adjustments."
        actions={
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("system")}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "system"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              System Generated
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("manual")}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "manual"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
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
          title="System message"
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {activeTab === "system" ? (
        <Card>
          <SectionHeader
            icon={<Timer className="w-5 h-5" />}
            iconTone="brand"
            title="System Generated Undertime"
            description="Auto-detected from uploaded attendance files."
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-3"><Select label="Year" value={systemYear} onChange={(event) => { setSystemYear(event.target.value); setSystemMonth("all"); setSystemDate("all"); }}><option value="all">All Years</option>{systemYears.map((item) => <option key={item}>{item}</option>)}</Select><Select label="Month" value={systemMonth} onChange={(event) => { setSystemMonth(event.target.value); setSystemDate("all"); }}><option value="all">All Months</option>{systemMonths.map((item) => <option key={item} value={item}>{new Date(2000, Number(item) - 1, 1).toLocaleDateString("en-US", { month: "long" })}</option>)}</Select><Select label="Exact Date" value={systemDate} onChange={(event) => setSystemDate(event.target.value)}><option value="all">All Dates</option>{systemExactDates.map((item) => <option key={item} value={item}>{new Date(`${item}T00:00:00`).toLocaleDateString("en-US")}</option>)}</Select></div>
          <p className="mt-3 text-xs font-medium text-slate-500">{filteredGeneratedUndertimes.length} record{filteredGeneratedUndertimes.length === 1 ? "" : "s"}</p>

          <div className="mt-5">
            {loading ? (
              <SkeletonTable rows={4} columns={3} />
            ) : filteredGeneratedUndertimes.length === 0 ? (
              <EmptyState
                icon={<Timer className="w-6 h-6" />}
                title="No undertime detected"
                description="Records will appear automatically when uploaded attendance files indicate undertime."
                bordered
              />
            ) : (
              <ul className="space-y-2">
                {filteredGeneratedUndertimes.map((record) => (
                  <li
                    key={record.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center gap-2"><EmployeeAvatar name={record.name} size="sm" /><p className="text-sm font-semibold text-slate-900">
                      {record.name}
                    </p></div>
                    <p className="text-xs text-slate-500 mt-1">
                      {record.date} | {record.timeIn}
                    </p>
                    {record.minutesUndertime !== undefined ? <p className="text-xs text-slate-500 mt-0.5">Undertime: {formatDuration(record.minutesUndertime)}</p> : null}
                    <p className="text-xs text-slate-500 mt-0.5">
                      Source: {record.sourceFileName}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 text-xs text-slate-600"><p>{record.reason || "No remarks recorded."}</p>{record.informed?.length ? <p className="mt-1">Informed: {record.informed.join(", ")}</p> : null}</div>{/* hrScope === "ITC" && <Button */}
                      {role === "HR" && <div className="flex flex-wrap justify-end gap-2"><MainMoveToService type="undertime" recordId={record.id} />{hrScope === "ITC" && <><Button size="sm" variant="secondary" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openGeneratedEdit(record)}>Edit Details</Button><Button size="sm" variant="secondary" onClick={() => void openMoveToService(record)}>Move to Service</Button></>}{(hrScope === "ITC" || hrScope === "MAIN") && <Button size="sm" variant="primary" onClick={() => setHalfDayTarget(record)}>Move to Half-Day</Button>}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="self-start xl:sticky xl:top-20">
            <SectionHeader
              icon={<Clock3 className="w-5 h-5" />}
              iconTone="brand"
              title="Add Undertime"
                description="Record a manual undertime entry. No approval is required."
            />

            <div className="space-y-4 mt-5">
              <SearchableCombobox label="Employee Name" value={employeeName} placeholder="Search active employees" options={activeEmployees.map((employee) => ({ id: employee.id, label: employee.fullName }))} onClear={() => { setEmployeeId(""); setEmployeeName(""); setSourceRecordId(""); }} onSelect={(employee) => { setEmployeeId(employee.id); setEmployeeName(employee.label); setSourceRecordId(""); }} />

              <Input
                label="Date"
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); setSourceRecordId(""); }}
              />

              <Select label="Matching Attendance Record" value={sourceRecordId} disabled={!employeeId || !date || matchingAttendanceRecords.length === 0} onChange={(event) => {
                const id = event.target.value;
                setSourceRecordId(id);
              }}>
                <option value="">{matchingAttendanceRecords.length ? "Select matching attendance" : "No eligible attendance record"}</option>
                {matchingAttendanceRecords.map((record) => {
                  const range = hrScope === "MAIN" && "lastOut" in record && record.lastOut
                    ? { from: record.lastOut.slice(0, 5), to: new Date(`${date}T00:00:00`).getDay() === 6 ? "15:15" : "17:00", minutes: checkoutUndertimeMinutes(date, record.lastOut) }
                    : "timeIn" in record ? attendanceRecordRange(date, record.timeIn) : null;
                  return range ? <option key={record.id} value={record.id}>{formatTime12Hour(range.from)} â€“ {formatTime12Hour(range.to)} Â· {formatDuration(range.minutes)}</option> : null;
                })}
              </Select>

              <div>
                <p className="text-sm font-medium text-slate-700 mb-1.5">Undertime Duration</p>
                <p className="text-sm text-slate-600">
                  {selectedAttendanceRange
                    ? <><span className="font-semibold text-slate-900">{formatDuration(selectedAttendanceRange.minutes)}</span> ({formatTime12Hour(selectedAttendanceRange.from)} Ã¢â‚¬â€œ {formatTime12Hour(selectedAttendanceRange.to)})</>
                    : "Select an attendance record with a valid checkout first."}
                </p>
                {employeeId && date && matchingAttendanceRecords.length === 0 && (
                  <p className="mt-2 text-xs text-amber-700">No valid checkout is available. Correct the checkout first through Attendance Records &gt; Add Check-Out / Update Check-Out.</p>
                )}
              </div>

              <Textarea
                label="Reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Official reason for undertime..."
                rows={4}
              />

              <div>
                <div className="mt-2 space-y-2"><SearchableCombobox label="Add informed person (optional)" placeholder="Search or add a name" options={informedOptions.filter((person) => !informed.includes(person)).map((person) => ({ id: person, label: person }))} onSelect={(person) => setInformed([...informed, person.label])} onCreateCustom={(person) => setInformed([...informed, person])} /><div className="flex flex-wrap gap-2">{informed.map((person) => <button key={person} type="button" onClick={() => setInformed(informed.filter((value) => value !== person))} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">{person} Ãƒâ€”</button>)}</div></div>
              </div>

              <Button
                variant="primary"
                fullWidth
                leftIcon={<Plus className="w-4 h-4" />}
                onClick={handleSave}
              >
                Save Entry
              </Button>
            </div>
          </Card>

          <Card className="min-w-0">
            <SectionHeader
              icon={<CalendarDays className="w-5 h-5" />}
              iconTone="neutral"
              title="Manual Undertime Records"
              description="View and manage manual undertime by month."
              actions={
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <Select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="sm:w-52"
                  >
                    <option value="all">All Months</option>
                    {monthOptions.map((month) => (
                      <option key={month} value={month}>
                        {formatMonthLabel(month)}
                      </option>
                    ))}
                  </Select>

                  {selectedMonth !== "all" && (
                    <Button
                      variant="danger"
                      leftIcon={<Trash2 className="w-4 h-4" />}
                      onClick={() => setConfirmDeleteMonth(true)}
                    >
                      Delete Month
                    </Button>
                  )}
                </div>
              }
            />

            <div className="mt-5 xl:max-h-[calc(100vh-15rem)] xl:overflow-y-auto xl:pr-2">
              {loading ? (
                <SkeletonTable rows={4} columns={3} />
              ) : filteredManualUndertimes.length === 0 ? (
                <EmptyState
                  icon={<Timer className="w-6 h-6" />}
                  title={
                    selectedMonth === "all"
                      ? "No manual undertime entries"
                      : `No entries for ${formatMonthLabel(selectedMonth)}`
                  }
                  description="Use the form on the left to add an approved manual undertime."
                  bordered
                />
              ) : (
                <ul className="space-y-3">
                  {filteredManualUndertimes.map((record) => (
                    <li
                      key={record.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                           <div className="flex items-center gap-2">
                             <EmployeeAvatar employeeId={record.employeeId} name={record.name} profilePhotoPath={activeEmployees.find((employee) => employee.id === record.employeeId)?.profilePhotoPath} size="sm" />
                             <p className="text-[15px] font-semibold text-slate-900">{record.name}</p>
                           </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {record.date}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Hours: {record.undertimeHours}
                          </p>
                          {Array.isArray(record.informed) && record.informed.length > 0 ? <p className="mt-1 text-xs text-slate-500">Informed: {record.informed.join(", ")}</p> : null}
                        </div>

                        <div className="flex max-w-sm flex-col items-start gap-3 sm:items-end">
                          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm leading-5 text-slate-700">
                            {record.reason}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                            <Button
                              variant="warning"
                              size="sm"
                              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                              onClick={() =>
                                setRestoreTarget({
                                  id: record.id,
                                  name: record.name,
                                  date: record.date,
                                })
                              }
                            >
                              Restore
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                              onClick={() =>
                                setDeleteTarget({
                                  id: record.id,
                                  name: record.name,
                                  date: record.date,
                                })
                              }
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      )}

      <ConfirmModal
        open={!!halfDayTarget}
        tone="warning"
        title="Move to Half-Day?"
        description={halfDayTarget ? <><strong>{halfDayTarget.name}</strong><br />{halfDayTarget.date}<br /><br />Current Undertime: {formatTime12Hour(halfDayTarget.timeIn)}<br /><br />This will move this system-generated Undertime record to Half-Day.</> : null}
        confirmLabel="Move to Half-Day"
        onConfirm={async () => { if (!halfDayTarget) return; const result = await moveGeneratedUndertimeToHalfDay(halfDayTarget.id); setFeedback({ type: result.success ? "success" : "error", message: result.message }); if (result.success) setHalfDayTarget(null); }}
        onCancel={() => setHalfDayTarget(null)}
      />

      <ConfirmModal open={!!serviceTarget} tone="warning" title="Move to Service?" description={serviceTarget ? serviceOptions.length === 0 ? "No eligible Service record was found for this employee and date." : <div className="space-y-3"><p><strong>{serviceTarget.name}</strong><br />{serviceTarget.date}</p><Select label="Eligible Service" value={selectedServiceId} onChange={(event) => setSelectedServiceId(event.target.value)}>{serviceOptions.map((event) => <option key={event.id} value={event.id}>{event.serviceRef} — {new Date(event.serviceStart).toLocaleString()} to {event.serviceEnd ? new Date(event.serviceEnd).toLocaleString() : "In Service"}</option>)}</Select></div> : null} confirmLabel={serviceOptions.length === 0 ? "Close" : "Move to Service"} onConfirm={async () => { if (!serviceTarget) return; if (!selectedServiceId) { setServiceTarget(null); return; } try { await moveItcGeneratedAttendanceToService("undertime", serviceTarget.id, selectedServiceId); setServiceTarget(null); setFeedback({ type: "success", message: "Generated Undertime reconciled with Service." }); window.location.reload(); } catch (error) { setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not move Undertime to Service." }); } }} onCancel={() => setServiceTarget(null)} />

      <ConfirmModal
        open={confirmDeleteMonth}
        tone="danger"
        title={`Move manual undertime for ${formatMonthLabel(selectedMonth)} to Trash?`}
        description="The manual undertime rows for this month will be moved to Trash, and their underlying late records will reappear in Late Records. You can restore the undertime entries later from the Recycle Bin."
        confirmLabel="Move to Trash"
        onConfirm={handleDeleteMonth}
        onCancel={() => setConfirmDeleteMonth(false)}
      />

      {editTarget && <Card className="fixed inset-x-4 top-20 z-40 mx-auto max-w-lg shadow-xl">
        <SectionHeader title="Edit System Generated Details" description="Only remarks and informed people can be changed. Attendance data remains system-controlled." />
        <div className="mt-4 space-y-4">
          <Textarea label="Reason / Remarks" required value={editReason} onChange={(event) => setEditReason(event.target.value)} rows={3} />
          <SearchableCombobox label="Informed person (optional)" placeholder="Search or add a name" options={informedOptions.filter((person) => !editInformed.includes(person)).map((person) => ({ id: person, label: person }))} onSelect={(person) => setEditInformed([...editInformed, person.label])} onCreateCustom={(person) => setEditInformed([...editInformed, person])} />
          <div className="flex flex-wrap gap-2">{editInformed.map((person) => <button type="button" key={person} onClick={() => setEditInformed(editInformed.filter((item) => item !== person))} className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700">{person} Ã—</button>)}</div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditTarget(null)}>Cancel</Button><Button onClick={() => void saveGeneratedEdit()}>Save Details</Button></div>
        </div>
      </Card>}

      <ConfirmModal
        open={!!restoreTarget}
        tone="warning"
        title="Restore this late record?"
        description={
          restoreTarget ? (
            <>
              <span className="font-semibold">{restoreTarget.name}</span> on{" "}
              {new Date(restoreTarget.date).toLocaleDateString("en-US")} will be
              moved back to Late Records. The manual undertime row will be
              moved to Trash and can be restored from the Recycle Bin.
            </>
          ) : null
        }
        confirmLabel="Restore Late"
        onConfirm={handleRestoreConfirm}
        onCancel={() => setRestoreTarget(null)}
      />

      <ConfirmModal
        open={!!deleteTarget}
        tone="danger"
        title="Move this record to Trash?"
        description="This will only remove this selected HR record. It will not affect uploaded files, Late Records, or other HR records."
        confirmLabel="Move to Trash"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
