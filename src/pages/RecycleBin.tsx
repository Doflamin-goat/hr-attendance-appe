import { useEffect, useMemo, useState } from "react";
import {
  Trash2,
  RotateCcw,
  FileSpreadsheet,
  RefreshCw,
  Layers,
  EyeOff,
  ShieldCheck,
  UserX,
  Clock3,
  ClipboardList,
} from "lucide-react";
import { useAttendance } from "../context/AttendanceContext";
import {
  PageHeader,
  Card,
  Button,
  Badge,
  SectionHeader,
  EmptyState,
  SkeletonTable,
  ConfirmModal,
  DataTable,
  type Column,
} from "../components/ui";
import type {
  DeletedManualHrRow,
  DeletedManualHrType,
  DeletedUploadedFileRow,
} from "../services/attendanceService";

type PendingAction =
  | { kind: "restore"; file: DeletedUploadedFileRow }
  | { kind: "remove"; file: DeletedUploadedFileRow }
  | null;

type ManualPendingAction =
  | { kind: "restore"; record: DeletedManualHrRow }
  | { kind: "remove"; record: DeletedManualHrRow }
  | null;

const MANUAL_TYPE_LABEL: Record<DeletedManualHrType, string> = {
  exemption: "Exemption",
  absence: "Absence",
  manual_undertime: "Manual undertime",
};

const MANUAL_TYPE_TONE: Record<
  DeletedManualHrType,
  "brand" | "danger" | "warning"
> = {
  exemption: "brand",
  absence: "danger",
  manual_undertime: "warning",
};

function ManualTypeIcon({ type }: { type: DeletedManualHrType }) {
  if (type === "exemption") return <ShieldCheck className="w-3.5 h-3.5" />;
  if (type === "absence") return <UserX className="w-3.5 h-3.5" />;
  return <Clock3 className="w-3.5 h-3.5" />;
}

function formatDeletedAt(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

const REASON_LABELS: Record<string, string> = {
  uploaded_file_deleted: "File deleted",
  uploaded_file_cascade: "Cascade from file delete",
  month_deleted: "Month delete",
  workspace_cleared: "Clear all history",
  exemption_deleted: "Exemption deleted",
  exemption_removed_for_late: "Exemption removed (late restored)",
  manual_undertime_deleted: "Manual undertime deleted",
  manual_undertime_removed_for_late: "Manual undertime removed (late restored)",
  absence_deleted: "Absence deleted",
};

function readableReason(reason: string | null): string {
  if (!reason) return "—";
  return REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

function ReasonCell({ row }: { row: DeletedUploadedFileRow }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
        {readableReason(row.deletedReason)}
      </span>
      {row.deletedBatchId && (
        <span
          title={`Batch id: ${row.deletedBatchId}`}
          className="inline-flex items-center gap-1 rounded-md border border-brand-100 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700"
        >
          <Layers className="w-3 h-3" />
          Batch
        </span>
      )}
    </div>
  );
}

export function RecycleBin() {
  const {
    deletedAttendanceData,
    deletedAttendanceLoading,
    deletedAttendanceCount,
    loadDeletedAttendanceData,
    restoreUploadedFileBatch,
    removeUploadedFileFromRecycleBin,
    restoreManualHrRecord,
    removeManualHrRecordFromRecycleBin,
  } = useAttendance();

  const [pending, setPending] = useState<PendingAction>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualPending, setManualPending] = useState<ManualPendingAction>(null);
  const [manualBusyId, setManualBusyId] = useState<string | null>(null);

  useEffect(() => {
    void loadDeletedAttendanceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirmRestore = async () => {
    if (!pending || pending.kind !== "restore") return;
    setBusyId(pending.file.id);
    try {
      await restoreUploadedFileBatch(pending.file.id);
      setPending(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmRemove = async () => {
    if (!pending || pending.kind !== "remove") return;
    setBusyId(pending.file.id);
    try {
      await removeUploadedFileFromRecycleBin(pending.file.id);
      setPending(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmManualRestore = async () => {
    if (!manualPending || manualPending.kind !== "restore") return;
    setManualBusyId(manualPending.record.id);
    try {
      await restoreManualHrRecord(
        manualPending.record.type,
        manualPending.record.id
      );
      setManualPending(null);
    } finally {
      setManualBusyId(null);
    }
  };

  const handleConfirmManualRemove = async () => {
    if (!manualPending || manualPending.kind !== "remove") return;
    setManualBusyId(manualPending.record.id);
    try {
      await removeManualHrRecordFromRecycleBin(
        manualPending.record.type,
        manualPending.record.id
      );
      setManualPending(null);
    } finally {
      setManualBusyId(null);
    }
  };

  const manualColumns: Column<DeletedManualHrRow>[] = useMemo(
    () => [
      {
        key: "type",
        header: "Type",
        render: (row) => (
          <Badge tone={MANUAL_TYPE_TONE[row.type]}>
            <ManualTypeIcon type={row.type} />
            {MANUAL_TYPE_LABEL[row.type]}
          </Badge>
        ),
      },
      {
        key: "name",
        header: "Employee",
        render: (row) => (
          <span className="font-medium text-slate-900 truncate block">
            {row.name || "—"}
          </span>
        ),
      },
      {
        key: "date",
        header: "Date",
        render: (row) => (
          <span className="text-xs text-slate-600 tabular-nums">
            {row.date || "—"}
          </span>
        ),
      },
      {
        key: "deletedAt",
        header: "Moved to Trash",
        render: (row) => (
          <span className="text-xs text-slate-600">
            {formatDeletedAt(row.deletedAt)}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        align: "right",
        render: (row) => (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
              loading={
                manualBusyId === row.id && manualPending?.kind === "restore"
              }
              disabled={manualBusyId !== null && manualBusyId !== row.id}
              onClick={() => setManualPending({ kind: "restore", record: row })}
            >
              Restore
            </Button>
            <Button
              variant="danger"
              size="sm"
              leftIcon={<EyeOff className="w-3.5 h-3.5" />}
              loading={
                manualBusyId === row.id && manualPending?.kind === "remove"
              }
              disabled={manualBusyId !== null && manualBusyId !== row.id}
              onClick={() => setManualPending({ kind: "remove", record: row })}
            >
              Remove from Recycle Bin
            </Button>
          </div>
        ),
      },
    ],
    [manualBusyId, manualPending]
  );

  const columns: Column<DeletedUploadedFileRow>[] = useMemo(
    () => [
      {
        key: "fileName",
        header: "File Name",
        render: (row) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600 border border-slate-200 flex-shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <span className="font-medium text-slate-900 truncate">
              {row.fileName}
            </span>
          </div>
        ),
      },
      {
        key: "records",
        header: "Records",
        render: (row) => (
          <span className="text-xs text-slate-600 tabular-nums">
            {row.lateCount} late / {row.undertimeCount} undertime
          </span>
        ),
      },
      {
        key: "deletedAt",
        header: "Moved to Trash",
        render: (row) => (
          <span className="text-xs text-slate-600">
            {formatDeletedAt(row.deletedAt)}
          </span>
        ),
      },
      {
        key: "reason",
        header: "Reason",
        render: (row) => <ReasonCell row={row} />,
      },
      {
        key: "actions",
        header: "Actions",
        align: "right",
        render: (row) => (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
              loading={busyId === row.id && pending?.kind === "restore"}
              disabled={busyId !== null && busyId !== row.id}
              onClick={() => setPending({ kind: "restore", file: row })}
            >
              Restore Batch
            </Button>
            <Button
              variant="danger"
              size="sm"
              leftIcon={<EyeOff className="w-3.5 h-3.5" />}
              loading={busyId === row.id && pending?.kind === "remove"}
              disabled={busyId !== null && busyId !== row.id}
              onClick={() => setPending({ kind: "remove", file: row })}
            >
              Remove from Recycle Bin
            </Button>
          </div>
        ),
      },
    ],
    [busyId, pending]
  );

  const uploadedFilesCount = deletedAttendanceData.uploadedFiles.length;
  const manualHrCount = deletedAttendanceData.manualHrRecords.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recycle Bin"
        description="Records that were moved to Trash. Uploaded files are shown separately from manual HR records (exemptions, absences, manual undertime) so you can manage each independently. Remove from Recycle Bin hides the entry from the UI but keeps the data in the database for emergency retrieval."
        actions={
          <>
            <Badge tone="neutral">
              {deletedAttendanceCount} item
              {deletedAttendanceCount === 1 ? "" : "s"} in Trash
            </Badge>
            <Button
              variant="secondary"
              leftIcon={<RefreshCw className="w-4 h-4" />}
              onClick={() => void loadDeletedAttendanceData()}
              disabled={deletedAttendanceLoading}
            >
              Refresh
            </Button>
          </>
        }
      />

      <Card padded={false}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 flex-wrap">
          <SectionHeader
            icon={<FileSpreadsheet className="w-5 h-5" />}
            iconTone="brand"
            title="Deleted Uploaded Files"
            description="Restoring an uploaded file brings back the file and the late / undertime records generated from it. Manual HR records are never affected."
          />
          <Badge tone="neutral">
            {uploadedFilesCount} file{uploadedFilesCount === 1 ? "" : "s"}
          </Badge>
        </div>

        {deletedAttendanceLoading ? (
          <SkeletonTable rows={3} columns={5} />
        ) : uploadedFilesCount === 0 ? (
          <EmptyState
            icon={<Trash2 className="w-6 h-6" />}
            title="No uploaded files in Trash"
            description="Deleting an attendance file from the dashboard moves it here. You can restore the file or hide it from the UI."
            bordered={false}
            className="py-10"
          />
        ) : (
          <DataTable
            columns={columns}
            rows={deletedAttendanceData.uploadedFiles}
            rowKey={(row) => row.id}
            dense
          />
        )}
      </Card>

      <Card padded={false}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 flex-wrap">
          <SectionHeader
            icon={<ClipboardList className="w-5 h-5" />}
            iconTone="warning"
            title="Deleted HR Manual Records"
            description="Exemptions, absences, and manual undertime entries that were soft-deleted. Restoring returns the row to its own page only — it does not bring back uploaded files or Late Records."
          />
          <Badge tone="neutral">
            {manualHrCount} record{manualHrCount === 1 ? "" : "s"}
          </Badge>
        </div>

        {deletedAttendanceLoading ? (
          <SkeletonTable rows={3} columns={5} />
        ) : manualHrCount === 0 ? (
          <EmptyState
            icon={<Trash2 className="w-6 h-6" />}
            title="No manual HR records in Trash"
            description="Deleting an Exemption, Absence, or Manual Undertime moves it here. You can restore it or hide it from the UI."
            bordered={false}
            className="py-10"
          />
        ) : (
          <DataTable
            columns={manualColumns}
            rows={deletedAttendanceData.manualHrRecords}
            rowKey={(row) => `${row.type}-${row.id}`}
            dense
          />
        )}
      </Card>

      <ConfirmModal
        open={pending?.kind === "restore"}
        tone="primary"
        title="Restore this batch?"
        description={
          pending?.kind === "restore" ? (
            <>
              This will restore{" "}
              <span className="font-semibold">{pending.file.fileName}</span> and
              the late / undertime records generated from it. Manual HR records
              (exemptions, absences, manual undertime) are not affected by this
              restore.
            </>
          ) : null
        }
        confirmLabel="Restore Batch"
        loading={busyId === pending?.file.id && pending?.kind === "restore"}
        onConfirm={handleConfirmRestore}
        onCancel={() => (busyId ? null : setPending(null))}
      />

      <ConfirmModal
        open={pending?.kind === "remove"}
        tone="danger"
        title="Remove this batch from the Recycle Bin?"
        description={
          pending?.kind === "remove" ? (
            <>
              <span className="font-semibold">{pending.file.fileName}</span> and
              its related records will no longer appear in the app, but the
              database rows will be retained for emergency retrieval.
            </>
          ) : null
        }
        confirmLabel="Remove from Recycle Bin"
        loading={busyId === pending?.file.id && pending?.kind === "remove"}
        onConfirm={handleConfirmRemove}
        onCancel={() => (busyId ? null : setPending(null))}
      />

      <ConfirmModal
        open={manualPending?.kind === "restore"}
        tone="primary"
        title="Restore this HR record?"
        description={
          manualPending?.kind === "restore" ? (
            <>
              This will return the{" "}
              <span className="font-semibold">
                {MANUAL_TYPE_LABEL[manualPending.record.type].toLowerCase()}
              </span>{" "}
              for{" "}
              <span className="font-semibold">
                {manualPending.record.name || "this employee"}
              </span>{" "}
              on {manualPending.record.date} back to its page. No uploaded files
              or Late Records will be touched.
            </>
          ) : null
        }
        confirmLabel="Restore Record"
        loading={
          manualBusyId === manualPending?.record.id &&
          manualPending?.kind === "restore"
        }
        onConfirm={handleConfirmManualRestore}
        onCancel={() => (manualBusyId ? null : setManualPending(null))}
      />

      <ConfirmModal
        open={manualPending?.kind === "remove"}
        tone="danger"
        title="Remove this record from the Recycle Bin?"
        description={
          manualPending?.kind === "remove" ? (
            <>
              The{" "}
              <span className="font-semibold">
                {MANUAL_TYPE_LABEL[manualPending.record.type].toLowerCase()}
              </span>{" "}
              for{" "}
              <span className="font-semibold">
                {manualPending.record.name || "this employee"}
              </span>{" "}
              will no longer appear in the Recycle Bin, but the database row
              will be retained for emergency retrieval.
            </>
          ) : null
        }
        confirmLabel="Remove from Recycle Bin"
        loading={
          manualBusyId === manualPending?.record.id &&
          manualPending?.kind === "remove"
        }
        onConfirm={handleConfirmManualRemove}
        onCancel={() => (manualBusyId ? null : setManualPending(null))}
      />
    </div>
  );
}
