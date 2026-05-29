import { useMemo, useState } from "react";
import {
  ShieldCheck,
  Plus,
  CalendarDays,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { useAttendance } from "../context/AttendanceContext";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
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

type RestoreTarget = { id: string; name: string; date: string } | null;
type DeleteTarget = { id: string; name: string; date: string } | null;

export function Exemptions() {
  const {
    loading,
    exemptions,
    addExemption,
    deleteExemptionsByMonth,
    removeExemptionAdjustment,
    deleteExemption,
  } = useAttendance();

  const [formData, setFormData] = useState({ name: "", reason: "", date: "" });
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [confirmDeleteMonth, setConfirmDeleteMonth] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const monthOptions = useMemo(() => {
    const uniqueMonths = Array.from(
      new Set(exemptions.map((record) => getMonthKey(record.date)))
    );
    return uniqueMonths.sort((a, b) => b.localeCompare(a));
  }, [exemptions]);

  const [selectedMonth, setSelectedMonth] = useState<string>("all");

  const filteredExemptions = useMemo(() => {
    const filtered =
      selectedMonth === "all"
        ? exemptions
        : exemptions.filter(
            (record) => getMonthKey(record.date) === selectedMonth
          );

    return [...filtered].sort(
      (a, b) => getSafeDate(b.date).getTime() - getSafeDate(a.date).getTime()
    );
  }, [exemptions, selectedMonth]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!formData.name || !formData.reason || !formData.date) {
      setFeedback({
        type: "error",
        message: "Please complete employee name, date, and reason.",
      });
      return;
    }

    const result = addExemption({
      name: formData.name,
      reason: formData.reason,
      date: formData.date,
    });

    setFeedback({
      type: result.success ? "success" : "error",
      message: result.message,
    });

    if (result.success) {
      setSelectedMonth(getMonthKey(formData.date));
      setFormData({ name: "", reason: "", date: "" });
    }
  };

  const handleDeleteMonth = () => {
    deleteExemptionsByMonth(selectedMonth);
    setFeedback({
      type: "success",
      message: `All exemption records for ${formatMonthLabel(
        selectedMonth
      )} were moved to Trash. Their late records are back in Late Records.`,
    });
    setSelectedMonth("all");
    setConfirmDeleteMonth(false);
  };

  const handleRestoreConfirm = () => {
    if (!restoreTarget) return;
    removeExemptionAdjustment(restoreTarget.id);
    setFeedback({
      type: "success",
      message: `${restoreTarget.name}'s late on ${new Date(
        restoreTarget.date
      ).toLocaleDateString(
        "en-US"
      )} is back in Late Records. The exemption row was moved to Trash and can be restored from Recycle Bin.`,
    });
    setRestoreTarget(null);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    deleteExemption(deleteTarget.id);
    setDeleteTarget(null);
    toast.success("Record moved to Trash.");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Late Exemptions"
        description="Manage excused late arrivals by month."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card className="lg:sticky lg:top-24">
            <SectionHeader
              icon={<ShieldCheck className="w-5 h-5" />}
              iconTone="brand"
              title="Add Exemption"
              description="Excuse a recorded late arrival."
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
              <Input
                label="Employee Name"
                required
                placeholder="Dela Cruz, Juan"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />

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
                placeholder="Official reason for exemption..."
                value={formData.reason}
                onChange={(e) =>
                  setFormData({ ...formData, reason: e.target.value })
                }
              />

              <Button
                type="submit"
                variant="primary"
                fullWidth
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Save Exemption
              </Button>
            </form>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <Card>
            <SectionHeader
              icon={<CalendarDays className="w-5 h-5" />}
              iconTone="neutral"
              title="Month Filter"
              description="View and manage exemptions by month."
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
          </Card>

          {loading ? (
            <Card padded={false}>
              <SkeletonTable rows={4} columns={4} />
            </Card>
          ) : filteredExemptions.length === 0 ? (
            <Card>
              <EmptyState
                icon={<ShieldCheck className="w-6 h-6" />}
                title={
                  selectedMonth === "all"
                    ? "No exemptions found"
                    : `No exemptions for ${formatMonthLabel(selectedMonth)}`
                }
                description={
                  selectedMonth === "all"
                    ? "Use the form on the left to add an approved exemption."
                    : "Switch the filter or add an exemption from the form on the left."
                }
                bordered={false}
              />
            </Card>
          ) : (
            <>
              <p className="text-sm text-slate-500 px-1">
                Showing{" "}
                <span className="font-semibold text-slate-900">
                  {filteredExemptions.length}
                </span>{" "}
                record(s)
                {selectedMonth !== "all" && (
                  <>
                    {" "}for{" "}
                    <span className="font-semibold text-slate-900">
                      {formatMonthLabel(selectedMonth)}
                    </span>
                  </>
                )}
              </p>

              <ul className="space-y-2">
                {filteredExemptions.map((record) => {
                  const recordDate = getSafeDate(record.date);

                  return (
                    <li
                      key={record.id}
                      className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors relative overflow-hidden"
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-500" />
                      <div className="flex items-start gap-4 pl-2">
                        <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-700 border border-brand-100 flex items-center justify-center font-semibold text-xs uppercase flex-shrink-0">
                          {record.name.substring(0, 2)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="text-sm font-semibold text-slate-900 truncate">
                                {record.name}
                              </h3>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {recordDate.toLocaleDateString("en-US")}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                              <Badge tone="brand">Exempted</Badge>
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

                          <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-sm text-slate-700 leading-5">
                            <span className="font-medium text-slate-900">
                              Reason:
                            </span>{" "}
                            {record.reason}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmDeleteMonth}
        tone="danger"
        title={`Move exemptions for ${formatMonthLabel(selectedMonth)} to Trash?`}
        description="The exemption rows for this month will be moved to Trash, and their underlying late records will reappear in Late Records. You can restore the exemptions later from the Recycle Bin."
        confirmLabel="Move to Trash"
        onConfirm={handleDeleteMonth}
        onCancel={() => setConfirmDeleteMonth(false)}
      />

      <ConfirmModal
        open={!!restoreTarget}
        tone="warning"
        title="Restore this late record?"
        description={
          restoreTarget ? (
            <>
              <span className="font-semibold">{restoreTarget.name}</span> on{" "}
              {new Date(restoreTarget.date).toLocaleDateString("en-US")} will be
              moved back to Late Records. The exemption row will be moved to
              Trash and can be restored from the Recycle Bin.
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
