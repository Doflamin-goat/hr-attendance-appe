import { useMemo, useState } from "react";
import { useAttendance } from "../context/AttendanceContext";
import { UserX, Plus, CalendarDays, Trash2 } from "lucide-react";
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

export function Absences() {
  const { loading, absences, addAbsence, deleteAbsencesByMonth } =
    useAttendance();

  const [formData, setFormData] = useState({ name: "", reason: "", date: "" });
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const monthOptions = useMemo(() => {
    const uniqueMonths = Array.from(
      new Set(absences.map((record) => getMonthKey(record.date)))
    );
    return uniqueMonths.sort((a, b) => b.localeCompare(a));
  }, [absences]);

  const [selectedMonth, setSelectedMonth] = useState<string>("all");

  const filteredAbsences = useMemo(() => {
    const filtered =
      selectedMonth === "all"
        ? absences
        : absences.filter((record) => getMonthKey(record.date) === selectedMonth);

    return [...filtered].sort(
      (a, b) => getSafeDate(b.date).getTime() - getSafeDate(a.date).getTime()
    );
  }, [absences, selectedMonth]);

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

    const result = addAbsence({
      name: formData.name.trim(),
      reason: formData.reason.trim(),
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
    deleteAbsencesByMonth(selectedMonth);
    setFeedback({
      type: "success",
      message: `All absence records for ${formatMonthLabel(selectedMonth)} were removed.`,
    });
    setSelectedMonth("all");
    setConfirmDelete(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Absence Records"
        description="Manage manual absence entries by month."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
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
              <Input
                label="Employee Name"
                required
                placeholder="e.g. Dela Cruz, Juan"
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
                placeholder="Official reason for absence..."
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
                Save Absence
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
              description="View and manage absence records by month."
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
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete Month
                    </Button>
                  )}
                </div>
              }
            />
          </Card>

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
              {loading ? (
                <SkeletonTable rows={4} columns={4} />
              ) : filteredAbsences.length === 0 ? (
                <EmptyState
                  icon={<UserX className="w-6 h-6" />}
                  title={
                    selectedMonth === "all"
                      ? "No absences found"
                      : `No absences for ${formatMonthLabel(selectedMonth)}`
                  }
                  description="Use the form on the left to log an approved or noted absence."
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
                        <Badge tone="danger">Absent</Badge>
                      </div>
                      <p className="text-sm text-slate-700 mt-3 leading-5">
                        <span className="font-medium text-slate-900">
                          Reason:
                        </span>{" "}
                        {record.reason}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        tone="danger"
        title={`Delete absences for ${formatMonthLabel(selectedMonth)}?`}
        description="All absence records for this month will be permanently removed."
        confirmLabel="Delete Month"
        onConfirm={handleDeleteMonth}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
