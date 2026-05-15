import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { UserPlus, UserCog, X } from "lucide-react";
import { Button, Input, Select } from "../ui";
import type {
  Employee,
  EmployeeInput,
  EmploymentStatus,
  Workspace,
} from "../../services/employeeService";

type Mode = "add" | "edit";

type Props = {
  open: boolean;
  mode: Mode;
  defaultWorkspace?: Workspace | null;
  initial?: Employee | null;
  onClose: () => void;
  onSubmit: (input: EmployeeInput) => Promise<void>;
};

type FormState = {
  workspace: Workspace | "";
  fullName: string;
  employeeNumber: string;
  department: string;
  position: string;
  employmentStatus: EmploymentStatus;
};

function makeEmptyForm(defaultWorkspace?: Workspace | null): FormState {
  return {
    workspace: defaultWorkspace ?? "",
    fullName: "",
    employeeNumber: "",
    department: "",
    position: "",
    employmentStatus: "active",
  };
}

export function EmployeeFormModal({
  open,
  mode,
  defaultWorkspace,
  initial,
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<FormState>(() =>
    makeEmptyForm(defaultWorkspace)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    if (mode === "edit" && initial) {
      setForm({
        workspace: initial.workspace,
        fullName: initial.fullName ?? "",
        employeeNumber: initial.employeeNumber ?? "",
        department: initial.department ?? "",
        position: initial.position ?? "",
        employmentStatus: initial.employmentStatus ?? "active",
      });
    } else if (mode === "add" && initial) {
      setForm({
        workspace: defaultWorkspace ?? "",
        fullName: initial.fullName ?? "",
        employeeNumber: initial.employeeNumber ?? "",
        department: initial.department ?? "",
        position: initial.position ?? "",
        employmentStatus: "active",
      });
    } else {
      setForm(makeEmptyForm(defaultWorkspace));
    }

    setError(null);
    setSubmitting(false);
  }, [open, mode, initial, defaultWorkspace]);

  useEffect(() => {
    if (!open) return;

    const id = window.requestAnimationFrame(() => {
      fullNameRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        onClose();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, submitting]);

  const title = mode === "add" ? "Add Employee" : "Edit Employee";

  const description =
    mode === "add"
      ? "Create a new employee record and assign the correct company."
      : "Update employee details, including the company they belong to.";

  const Icon = mode === "add" ? UserPlus : UserCog;

  const isValid = useMemo(
    () => form.fullName.trim().length > 0 && form.workspace.length > 0,
    [form.fullName, form.workspace]
  );

  const handleChange = <K extends keyof FormState>(
    key: K,
    value: FormState[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!isValid || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await onSubmit({
        workspace: form.workspace as Workspace,
        fullName: form.fullName.trim(),
        employeeNumber: form.employeeNumber.trim() || null,
        department: form.department.trim() || null,
        position: form.position.trim() || null,
        employmentStatus: form.employmentStatus,
      });

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save employee.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        aria-hidden="true"
      />

      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <form
          onSubmit={handleSubmit}
          className="ui-modal-in w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-6">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 border border-brand-100 flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5" />
              </div>

              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">
                  {title}
                </h3>
                <p className="mt-1 text-sm text-slate-600 leading-5">
                  {description}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-slate-400 hover:text-slate-600 transition disabled:opacity-50"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            <Input
              ref={fullNameRef}
              label="Full Name *"
              name="fullName"
              placeholder="Cruz, Nathaniel Philip"
              value={form.fullName}
              onChange={(e) => handleChange("fullName", e.target.value)}
              required
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Workspace / Company *"
                name="workspace"
                value={form.workspace}
                onChange={(e) =>
                  handleChange("workspace", e.target.value as Workspace | "")
                }
                required
              >
                <option value="" disabled>
                  Select company...
                </option>
                <option value="APP">APP</option>
                <option value="WAIS">WAIS</option>
              </Select>

              <Input
                label="Position"
                name="position"
                placeholder="e.g. Production Staff"
                value={form.position}
                onChange={(e) => handleChange("position", e.target.value)}
              />
            </div>

            {mode === "edit" && (
              <Select
                label="Employment Status"
                name="employmentStatus"
                value={form.employmentStatus}
                onChange={(e) =>
                  handleChange(
                    "employmentStatus",
                    e.target.value as EmploymentStatus
                  )
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            )}

            {error && (
              <div className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-700">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-6 py-4 bg-slate-50 border-t border-slate-200">
            <p className="text-[11px] text-slate-500">
              <span className="text-danger-600">*</span> Required fields
            </p>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </Button>

              <Button
                type="submit"
                variant="primary"
                loading={submitting}
                disabled={!isValid || submitting}
              >
                {submitting
                  ? "Saving..."
                  : mode === "add"
                  ? "Add Employee"
                  : "Save Changes"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}