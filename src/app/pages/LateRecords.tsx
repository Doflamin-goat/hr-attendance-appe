import { useMemo, useState } from "react";
import { Clock, Search, X, FileSpreadsheet } from "lucide-react";
import { useAttendance, type LateRecord } from "../context/AttendanceContext";
import {
  PageHeader,
  Card,
  Button,
  Badge,
  Input,
  Select,
  AlertMessage,
  DataTable,
  EmptyState,
  SkeletonTable,
  type Column,
} from "../components/ui";

function getDefaultUndertimeStart(dateValue: string) {
  const day = new Date(dateValue).getDay();
  return day === 6 ? "7:00 AM" : "8:00 AM";
}

function getDefaultUndertimeRange(record: LateRecord) {
  return `${getDefaultUndertimeStart(record.date)} to ${record.timeIn}`;
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="w-9 h-9 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center font-semibold text-xs uppercase border border-brand-100 flex-shrink-0">
      {name.substring(0, 2)}
    </div>
  );
}

export function LateRecords() {
  const { loading, lateRecords, lateSummary, convertLateToUndertime } =
    useAttendance();

  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"detailed" | "summary">("detailed");
  const [selectedLateRecord, setSelectedLateRecord] = useState<LateRecord | null>(
    null
  );
  const [manualFromTime, setManualFromTime] = useState("");
  const [manualToTime, setManualToTime] = useState("");
  const [manualPeriod, setManualPeriod] = useState("AM");
  const [conversionReason, setConversionReason] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const filteredRecords = useMemo(
    () =>
      lateRecords.filter((r) =>
        r.name.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [lateRecords, searchTerm]
  );

  const filteredSummary = useMemo(
    () =>
      lateSummary.filter((s) =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [lateSummary, searchTerm]
  );

  const resetModal = () => {
    setSelectedLateRecord(null);
    setManualFromTime("");
    setManualToTime("");
    setManualPeriod("AM");
    setConversionReason("");
  };

  const openUndertimeModal = (record: LateRecord) => {
    setSelectedLateRecord(record);
    setManualFromTime("");
    setManualToTime("");
    setManualPeriod("AM");
    setConversionReason("");
    setFeedback(null);
  };

  const handleConfirmUndertime = () => {
    if (!selectedLateRecord) return;

    const hasManualInput = manualFromTime.trim() || manualToTime.trim();

    if (hasManualInput && (!manualFromTime.trim() || !manualToTime.trim())) {
      setFeedback({
        type: "error",
        message: "Please complete both From and To fields for manual override.",
      });
      return;
    }

    const undertimeHours = hasManualInput
      ? `${manualFromTime.trim()} to ${manualToTime.trim()} ${manualPeriod}`
      : getDefaultUndertimeRange(selectedLateRecord);

    const result = convertLateToUndertime({
      lateRecordId: selectedLateRecord.id,
      undertimeHours,
      isManualOverride: Boolean(hasManualInput),
      reason: conversionReason.trim(),
    });

    setFeedback({
      type: result.success ? "success" : "error",
      message: result.message,
    });

    if (result.success) resetModal();
  };

  const detailedColumns: Column<LateRecord>[] = [
    {
      key: "name",
      header: "Employee",
      render: (record) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={record.name} />
          <span className="font-medium text-slate-900 truncate">
            {record.name}
          </span>
        </div>
      ),
    },
    {
      key: "date",
      header: "Date",
      render: (record) => (
        <span className="text-slate-600 text-sm">{record.date}</span>
      ),
    },
    {
      key: "timeIn",
      header: "Time In",
      render: (record) => (
        <span className="text-slate-600 text-sm">{record.timeIn}</span>
      ),
    },
    {
      key: "lateBy",
      header: "Late By",
      align: "right",
      render: (record) => (
        <Badge tone="warning" icon={<Clock className="w-3 h-3" />}>
          {record.minutesLate > 0
            ? `${record.minutesLate} min ${record.secondsLate} sec`
            : `${record.secondsLate} sec`}
        </Badge>
      ),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (record) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => openUndertimeModal(record)}
        >
          Mark as Undertime
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Late Arrivals"
        description="Detailed breakdown of late clock-ins based on shift rules."
        actions={
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("detailed")}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "detailed"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Detailed
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("summary")}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "summary"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Summary
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

      <Card padded={false}>
        <div className="border-b border-slate-200 px-4 py-3 bg-slate-50/50">
          <div className="max-w-md">
            <Input
              type="search"
              placeholder="Search by employee name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
            />
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={6} columns={5} />
        ) : activeTab === "detailed" ? (
          <DataTable
            columns={detailedColumns}
            rows={filteredRecords}
            rowKey={(r) => r.id}
            emptyTitle={
              searchTerm ? "No matching late records" : "No late records found"
            }
            emptyDescription={
              searchTerm
                ? "Try a different employee name or clear the search."
                : "Upload a daily attendance Excel file from the dashboard to populate this view."
            }
            emptyIcon={<Clock className="w-6 h-6" />}
          />
        ) : filteredSummary.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
            {filteredSummary.map((item) => (
              <div
                key={item.name}
                className="bg-white rounded-lg border border-slate-200 p-4 hover:border-slate-300 hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)] transition-all duration-200"
              >
                <div className="flex justify-between items-start mb-3">
                  <Avatar name={item.name} />
                  <Badge tone="danger">{item.totalLates} lates</Badge>
                </div>
                <h3 className="font-semibold text-slate-900 truncate">
                  {item.name}
                </h3>
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-sm">
                  <span className="text-slate-500">Total time lost</span>
                  <span className="font-semibold text-slate-900">
                    {item.totalMinutesLate} mins
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FileSpreadsheet className="w-6 h-6" />}
            title={searchTerm ? "No matching summary" : "No summary available"}
            description={
              searchTerm
                ? "Try a different employee name or clear the search."
                : "Upload a valid attendance file to generate the summary."
            }
            bordered={false}
            className="py-16"
          />
        )}
      </Card>

      {selectedLateRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Convert Late Record to Undertime
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  Moves this record from Late Records to Undertime.
                </p>
              </div>
              <button
                type="button"
                onClick={resetModal}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">
                  {selectedLateRecord.name}
                </p>
                <p className="text-sm text-slate-600 mt-0.5">
                  {selectedLateRecord.date} • {selectedLateRecord.timeIn}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700 mb-1.5">
                  Suggested Undertime Range
                </p>
                <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700">
                  {getDefaultUndertimeRange(selectedLateRecord)}
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Mon–Fri starts 8:00 AM. Saturday starts 7:00 AM.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium text-slate-700 mb-2">
                  Manual Override (optional)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px] gap-2">
                  <Input
                    value={manualFromTime}
                    onChange={(e) => setManualFromTime(e.target.value)}
                    placeholder="From (e.g. 8:00)"
                  />
                  <Input
                    value={manualToTime}
                    onChange={(e) => setManualToTime(e.target.value)}
                    placeholder="To (e.g. 10:44:38)"
                  />
                  <Select
                    value={manualPeriod}
                    onChange={(e) => setManualPeriod(e.target.value)}
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </Select>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Leave blank to use the system-generated range.
                </p>
              </div>

              <Input
                label="Reason (optional)"
                value={conversionReason}
                onChange={(e) => setConversionReason(e.target.value)}
                placeholder="e.g. Approved undertime conversion"
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-3 bg-slate-50">
              <Button variant="secondary" onClick={resetModal}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleConfirmUndertime}>
                Confirm Undertime
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
