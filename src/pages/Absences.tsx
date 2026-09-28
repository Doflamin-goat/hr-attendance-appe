import { useEffect, useMemo, useState } from "react";
import { useAttendance } from "../context/AttendanceContext";
import { useEmployees } from "../context/EmployeesContext";
import { EmployeeAvatar } from "../components/employees/EmployeeAvatar";
import { EmployeeFilterCombobox } from "../components/employees/EmployeeFilterCombobox";
import { useAuth } from "../context/AuthContext";
import { UserX, Plus, Trash2, Search, Pencil, SlidersHorizontal } from "lucide-react";
import { loadCrossWorkspaceAbsences } from "../services/attendanceService";
import { matchesDateScope } from "../utils/attendanceForms";
import { informedPeopleForScope } from "../utils/informedPeople";
import type { AbsentRecord } from "../context/AttendanceContext";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
  SearchableCombobox,
  Textarea,
  Badge,
  EmptyState,
  AlertMessage,
  ConfirmModal,
  SectionHeader,
  SkeletonTable,
  toast,
} from "../components/ui";

function getSafeDate(dateValue: string) {
  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime())
    ? new Date(`${dateValue}T00:00:00`)
    : parsed;
}

function getMonthKey(dateValue: string) {
  const date = getSafeDate(dateValue);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

type DeleteTarget = { id: string; name: string; date: string } | null;

export function Absences({ readOnly = false }: { readOnly?: boolean }) {
  const { workspace, hrScope } = useAuth();
  const {
    loading,
    absences,
    selectedMonthScope,
    selectedDayScope,
    addAbsence,
    deleteAbsencesByMonth,
    deleteAbsence,
    updateMainSystemGeneratedAbsence,
    deleteMainSystemGeneratedAbsence,
  } = useAttendance();
  const { activeEmployees } = useEmployees();

  const [formData, setFormData] = useState({ employeeId: "", name: "", reason: "", date: "", informed: [] as string[] });
  const informedOptions = informedPeopleForScope(hrScope);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [editTarget, setEditTarget] = useState<AbsentRecord | null>(null);
  const [editReason, setEditReason] = useState("");
  const [editInformed, setEditInformed] = useState<string[]>([]);
  const [adminAbsences, setAdminAbsences] = useState<AbsentRecord[]>([]);
  const [adminLoading, setAdminLoading] = useState(readOnly);
  useEffect(() => {
    if (!readOnly) return;
    if (!workspace) return;
    void loadCrossWorkspaceAbsences(workspace).then(setAdminAbsences).catch((error) => setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not load absence records." })).finally(() => setAdminLoading(false));
  }, [readOnly, workspace]);
  const sourceAbsences = readOnly ? adminAbsences : absences;

  const monthOptions = useMemo(() => {
    const uniqueMonths = Array.from(
      new Set(sourceAbsences.map((record) => getMonthKey(record.date)))
    );
    return uniqueMonths.sort((a, b) => b.localeCompare(a));
  }, [sourceAbsences]);

  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [selectedEmployee, setSelectedEmployee] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [itcEmployeeId, setItcEmployeeId] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [recordType, setRecordType] = useState<"system_generated" | "manual">("manual");
  const yearOptions = useMemo(() => Array.from(new Set(sourceAbsences.map((record) => String(getSafeDate(record.date).getFullYear())))).sort((a, b) => b.localeCompare(a)), [sourceAbsences]);
  const employeeOptions = useMemo(() => Array.from(new Set(sourceAbsences.map((record) => record.name))).sort((a, b) => a.localeCompare(b)), [sourceAbsences]);
  const itcEmployee = activeEmployees.find((employee) => employee.id === itcEmployeeId);

  const filteredAbsences = useMemo(() => {
    const filtered = sourceAbsences.filter((record) => {
      if (!readOnly && (record.sourceType ?? "manual") !== recordType) return false;
      const scopeMonth = selectedDayScope !== "all" ? selectedMonthScope : selectedMonth;
      if (!matchesDateScope(record.date, scopeMonth, selectedDayScope)) return false;
      if (selectedYear !== "all" && String(getSafeDate(record.date).getFullYear()) !== selectedYear) return false;
      if (hrScope === "ITC" && !readOnly) {
        if (!itcEmployeeId) return true;
        return record.employeeId === itcEmployeeId || (!record.employeeId && record.name.toLocaleLowerCase() === itcEmployee?.fullName.toLocaleLowerCase());
      }
      if (selectedEmployee !== "all" && record.name !== selectedEmployee) return false;
      return record.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    });

    return [...filtered].sort((a, b) => (sortOrder === "newest" ? 1 : -1) * (getSafeDate(b.date).getTime() - getSafeDate(a.date).getTime()));
  }, [sourceAbsences, selectedMonth, selectedYear, selectedEmployee, search, sortOrder, readOnly, recordType, selectedMonthScope, selectedDayScope, hrScope, itcEmployeeId, itcEmployee?.fullName]);

  const employeeSummary = useMemo(() => {
    const summaryName = hrScope === "ITC" && !readOnly ? itcEmployee?.fullName : selectedEmployee === "all" ? undefined : selectedEmployee;
    if (!summaryName) return null;
    const rows = sourceAbsences.filter((record) => hrScope === "ITC" && !readOnly ? record.employeeId === itcEmployeeId || (!record.employeeId && record.name.toLocaleLowerCase() === summaryName.toLocaleLowerCase()) : record.name === summaryName);
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const reasons = new Map<string, number>();
    rows.forEach((record) => reasons.set(record.reason, (reasons.get(record.reason) ?? 0) + 1));
    return { month: rows.filter((record) => getMonthKey(record.date) === monthKey).length, year: rows.filter((record) => getSafeDate(record.date).getFullYear() === now.getFullYear()).length, commonReason: [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Not available" };
  }, [sourceAbsences, selectedEmployee, hrScope, readOnly, itcEmployee, itcEmployeeId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!formData.employeeId || !formData.name || !formData.reason || !formData.date) {
      setFeedback({
        type: "error",
        message: "Please complete employee name, date, and reason.",
      });
      return;
    }

    const result = await addAbsence({
      employeeId: formData.employeeId,
      name: formData.name.trim(),
      reason: formData.reason.trim(),
      date: formData.date,
      informed: formData.informed,
    });

    setFeedback({
      type: result.success ? "success" : "error",
      message: result.message,
    });

    if (result.success) {
      setSelectedMonth(getMonthKey(formData.date));
      setFormData({ employeeId: "", name: "", reason: "", date: "", informed: [] });
    }
  };

  const handleDeleteMonth = async () => {
    const result = await deleteAbsencesByMonth(selectedMonth);
    setFeedback({
      type: result.success ? "success" : "error",
      message: result.success ? `All absence records for ${formatMonthLabel(selectedMonth)} were moved to Trash. You can restore them from the Recycle Bin.` : result.message,
    });
    if (result.success) setSelectedMonth("all");
    setConfirmDelete(false);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const record = sourceAbsences.find((item) => item.id === deleteTarget.id);
    if (record?.sourceType === "system_generated") {
      const result = await deleteMainSystemGeneratedAbsence(deleteTarget.id);
      if (!result.success) {
        toast.error("Delete failed", result.message);
        return;
      }
    } else {
      const result = await deleteAbsence(deleteTarget.id);
      if (!result.success) { toast.error("Delete failed", result.message); return; }
    }
    setDeleteTarget(null);
    toast.success("Record moved to Trash.");
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    const result = await updateMainSystemGeneratedAbsence(editTarget.id, editReason, editInformed);
    if (result.success) {
      toast.success("Absence updated", result.message);
      setEditTarget(null);
    } else {
      toast.error("Update failed", result.message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Absence Records"
        description={readOnly ? "Read-only employee absence history across available records." : "Add absences and review employee history."}
      />
      {readOnly && feedback && <AlertMessage tone={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />}

      {!readOnly && <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1"><button type="button" onClick={() => setRecordType("system_generated")} className={`rounded-md px-4 py-2 text-sm font-medium ${recordType === "system_generated" ? "bg-brand-50 text-brand-700" : "text-slate-600"}`}>System Generated</button><button type="button" onClick={() => setRecordType("manual")} className={`rounded-md px-4 py-2 text-sm font-medium ${recordType === "manual" ? "bg-brand-50 text-brand-700" : "text-slate-600"}`}>Manual Entry</button></div>}

      {!readOnly && hrScope === "MAIN" && editTarget && <Card>
        <SectionHeader title="Edit System Generated Absence" description={`${editTarget.name} · ${editTarget.date}`} />
        <div className="mt-4 grid gap-4">
          <Textarea label="Reason" value={editReason} onChange={(event) => setEditReason(event.target.value)} rows={3} />
          <div>
            <div className="mt-2 space-y-2">
              <SearchableCombobox label="Add informed person (optional)" placeholder="Search or add a name" options={informedOptions.filter((person) => !editInformed.includes(person)).map((person) => ({ id: person, label: person }))} onSelect={(person) => setEditInformed([...editInformed, person.label])} onCreateCustom={(person) => setEditInformed([...editInformed, person])} />
              <div className="flex flex-wrap gap-2">{editInformed.map((person) => <button key={person} type="button" onClick={() => setEditInformed(editInformed.filter((value) => value !== person))} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">{person} ×</button>)}</div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleEditSave()}>Save Changes</Button>
          </div>
        </div>
      </Card>}

      <div className={`grid grid-cols-1 ${!readOnly && recordType === "manual" ? "lg:grid-cols-3" : ""} gap-6`}>
        {!readOnly && recordType === "manual" && <div className="lg:col-span-1">
          <Card className="lg:sticky lg:top-24">
            <SectionHeader
              icon={<UserX className="w-5 h-5" />}
              iconTone="danger"
              title="Add Absence"
              description="Log an approved or noted absence."
            />

            {feedback && (
              <div className="mt-4">
                <AlertMessage
                  tone={feedback.type}
                  message={feedback.message}
                  onDismiss={() => setFeedback(null)}
                />
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 mt-5">
              <SearchableCombobox label="Employee Name" required value={formData.name} placeholder="Search active employees" options={activeEmployees.map((employee) => ({ id: employee.id, label: employee.fullName }))} onClear={() => setFormData({ ...formData, employeeId: "", name: "" })} onSelect={(employee) => setFormData({ ...formData, employeeId: employee.id, name: employee.label })} />

              <Input
                label="Date"
                type="date"
                required
                value={formData.date}
                onChange={(e) =>
                  setFormData({ ...formData, date: e.target.value })
                }
              />

              <Textarea
                label="Reason"
                required
                rows={3}
                placeholder="Official reason for absence..."
                value={formData.reason}
                onChange={(e) =>
                  setFormData({ ...formData, reason: e.target.value })
                }
              />

              <div>
                <div className="mt-2 space-y-2"><SearchableCombobox label="Add informed person (optional)" placeholder="Search or add a name" options={informedOptions.filter((person) => !formData.informed.includes(person)).map((person) => ({ id: person, label: person }))} onSelect={(person) => setFormData({ ...formData, informed: [...formData.informed, person.label] })} onCreateCustom={(person) => setFormData({ ...formData, informed: [...formData.informed, person] })} /><div className="flex flex-wrap gap-2">{formData.informed.map((person) => <button key={person} type="button" onClick={() => setFormData({ ...formData, informed: formData.informed.filter((value) => value !== person) })} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">{person} ×</button>)}</div></div>
              </div>

              <Button
                type="submit"
                variant="primary"
                fullWidth
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Save Absence
              </Button>
            </form>
          </Card>
        </div>}

        <div className={`${!readOnly && recordType === "manual" ? "lg:col-span-2" : ""} space-y-4`}>
          <Card>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <SlidersHorizontal className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Search &amp; Filters</h2>
                  <p className="mt-0.5 text-sm text-slate-500">Review employee attendance records and history.</p>
                </div>
              </div>

              {hrScope === "ITC" && !readOnly ? <EmployeeFilterCombobox employees={activeEmployees} selectedEmployeeId={itcEmployeeId} onChange={setItcEmployeeId} /> : <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Search Employee</label>
                <Input type="search" placeholder="Search employee" value={search} onChange={(event) => setSearch(event.target.value)} leftIcon={<Search className="h-4 w-4" />} />
              </div>}

              <div className="border-t border-slate-200 pt-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Filters</h3>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {!(hrScope === "ITC" && !readOnly) && <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Employee Type</label>
                    <Select value={selectedEmployee} onChange={(event) => setSelectedEmployee(event.target.value)}><option value="all">All Employees</option>{employeeOptions.map((employee) => <option key={employee} value={employee}>{employee}</option>)}</Select>
                  </div>}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Year</label>
                    <Select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}><option value="all">All Years</option>{yearOptions.map((item) => <option key={item}>{item}</option>)}</Select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Month</label>
                    <Select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}><option value="all">All Months</option>{monthOptions.map((month) => <option key={month} value={month}>{formatMonthLabel(month)}</option>)}</Select>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Sort By</label>
                <div className="flex flex-wrap items-center gap-2">
                  <Select className="w-full sm:w-[220px]" value={sortOrder} onChange={(event) => setSortOrder(event.target.value as "newest" | "oldest")}><option value="newest">Newest First</option><option value="oldest">Oldest First</option></Select>
                  {!readOnly && selectedMonth !== "all" && <Button variant="danger" leftIcon={<Trash2 className="w-4 h-4" />} onClick={() => setConfirmDelete(true)}>Delete Month</Button>}
                </div>
              </div>
            </div>
          </Card>

          {employeeSummary && <Card><div className="grid gap-4 sm:grid-cols-3"><div><p className="text-xs text-slate-500">Absences this month</p><p className="mt-1 text-2xl font-semibold text-slate-900">{employeeSummary.month}</p></div><div><p className="text-xs text-slate-500">Absences this year</p><p className="mt-1 text-2xl font-semibold text-slate-900">{employeeSummary.year}</p></div><div><p className="text-xs text-slate-500">Most frequent reason</p><p className="mt-1 text-sm font-semibold text-slate-900">{employeeSummary.commonReason}</p></div></div></Card>}

          <Card>
            <SectionHeader
              icon={<UserX className="w-5 h-5" />}
              iconTone="danger"
              title="Saved Absence Records"
              description={
                selectedMonth === "all"
                  ? `Showing all ${filteredAbsences.length} record(s).`
                  : `Showing ${filteredAbsences.length} record(s) for ${formatMonthLabel(
                      selectedMonth
                    )}.`
              }
            />

            <div className="mt-5">
              {loading || adminLoading ? (
                <SkeletonTable rows={4} columns={4} />
              ) : filteredAbsences.length === 0 ? (
                <EmptyState
                  icon={<UserX className="w-6 h-6" />}
                  title={
                    selectedMonth === "all"
                      ? "No absences found"
                      : `No absences for ${formatMonthLabel(selectedMonth)}`
                  }
                  description={readOnly ? "No absence records match the selected filters." : "Use the form on the left to log an approved or noted absence."}
                  bordered
                />
              ) : (
                <ul className="space-y-2">
                  {filteredAbsences.map((record) => (
                    <li
                      key={record.id}
                      className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <EmployeeAvatar name={record.name} size="sm" />
                          <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {record.name}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {getSafeDate(record.date).toLocaleDateString(
                              "en-US"
                            )}
                          </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                          <Badge tone="danger">Absent</Badge>
                          <Badge tone="neutral">{record.sourceType === "system_generated" ? "System Generated" : "Manual Entry"}</Badge>
                          {!readOnly && hrScope === "MAIN" && record.sourceType === "system_generated" && <><Button variant="secondary" size="sm" leftIcon={<Pencil className="w-3.5 h-3.5" />} onClick={() => { setEditTarget(record); setEditReason(record.reason); setEditInformed(record.informed ?? []); }}>Edit</Button><Button
                            variant="danger"
                            size="sm"
                            onClick={() => setDeleteTarget({ id: record.id, name: record.name, date: record.date })}
                          >Delete</Button></>}
                          {!readOnly && record.sourceType !== "system_generated" && <Button
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
                          </Button>}
                        </div>
                      </div>
                      <p className="text-sm text-slate-700 mt-3 leading-5">
                        <span className="font-medium text-slate-900">
                          Reason:
                        </span>{" "}
                        {record.reason}
                      </p>
                      {Array.isArray(record.informed) && record.informed.length > 0 && <p className="mt-1 text-xs text-slate-500">Informed: {record.informed.join(", ")}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>

      {!readOnly && <ConfirmModal
        open={confirmDelete}
        tone="danger"
        title={`Move absences for ${formatMonthLabel(selectedMonth)} to Trash?`}
        description="All absence records for this month will be moved to Trash. You can restore them later from the Recycle Bin."
        confirmLabel="Move to Trash"
        onConfirm={handleDeleteMonth}
        onCancel={() => setConfirmDelete(false)}
      />}

      {!readOnly && <ConfirmModal
        open={!!deleteTarget}
        tone="danger"
        title="Move this record to Trash?"
        description="This will only remove this selected HR record. It will not affect uploaded files, Late Records, or other HR records."
        confirmLabel="Move to Trash"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />}
    </div>
  );
}
