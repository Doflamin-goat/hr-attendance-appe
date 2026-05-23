import { supabase } from "../lib/supabase";

export type Workspace = "APP" | "WAIS";
export type EmploymentStatus = "active" | "inactive";

export interface Employee {
  id: string;
  workspace: Workspace;
  employeeNumber: string | null;
  fullName: string;
  department: string | null;
  position: string | null;
  employmentStatus: EmploymentStatus;
  isDeleted: boolean;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeInput {
  workspace: Workspace;
  fullName: string;
  employeeNumber?: string | null;
  department?: string | null;
  position?: string | null;
  employmentStatus?: EmploymentStatus;
}

type Actor = {
  userId: string | null;
  email: string | null;
};

type AuditAction = "create" | "update" | "deactivate" | "restore";

type EmployeeRow = {
  id: string;
  workspace: string;
  employee_number: string | null;
  full_name: string;
  department: string | null;
  position: string | null;
  employment_status: string;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
};

function requireClient() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  return supabase;
}

export function normalizeEmployeeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ");
}

function cleanString(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapRow(row: EmployeeRow): Employee {
  return {
    id: row.id,
    workspace: row.workspace as Workspace,
    employeeNumber: row.employee_number,
    fullName: row.full_name,
    department: row.department,
    position: row.position,
    employmentStatus: row.employment_status as EmploymentStatus,
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function writeAuditLog(
  workspace: Workspace,
  actor: Actor,
  action: AuditAction,
  employeeId: string,
  payload: Record<string, unknown>
) {
  const client = supabase;
  if (!client) return;

  try {
    await client.from("audit_logs").insert({
      workspace,
      actor_id: actor.userId,
      actor_email: actor.email,
      entity: "employee",
      entity_id: employeeId,
      action,
      payload,
    });
  } catch (error) {
    // audit_logs is optional — never break the main flow.
    console.warn("audit_logs insert skipped:", error);
  }
}

/**
 * List employees. If `workspace` is omitted, returns rows across ALL
 * workspaces (used by the HR master directory). Pass a specific workspace
 * to scope the query for legacy callers.
 */
export async function listEmployees(workspace?: Workspace): Promise<Employee[]> {
  const client = requireClient();

  let query = client
    .from("employees")
    .select("*")
    .order("full_name", { ascending: true });

  if (workspace) {
    query = query.eq("workspace", workspace);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []).map((row) => mapRow(row as EmployeeRow));
}

async function findDuplicate(
  workspace: Workspace,
  fullName: string,
  ignoreId?: string
): Promise<Employee | null> {
  const client = requireClient();
  const key = normalizeEmployeeName(fullName);

  if (!key) return null;

  const { data, error } = await client
    .from("employees")
    .select("*")
    .eq("workspace", workspace)
    .eq("is_deleted", false);

  if (error) throw error;

  const match = (data ?? []).find((row) => {
    if (ignoreId && row.id === ignoreId) return false;
    return normalizeEmployeeName((row as EmployeeRow).full_name) === key;
  });

  return match ? mapRow(match as EmployeeRow) : null;
}

export async function addEmployee(
  input: EmployeeInput,
  actor: Actor
): Promise<Employee> {
  const client = requireClient();
  const fullName = input.fullName.trim();

  if (!fullName) {
    throw new Error("Full name is required.");
  }

  if (!input.workspace) {
    throw new Error("Workspace is required.");
  }

  const duplicate = await findDuplicate(input.workspace, fullName);
  if (duplicate) {
    throw new Error(
      `An active employee named "${duplicate.fullName}" already exists in ${input.workspace}.`
    );
  }

  const payload = {
    workspace: input.workspace,
    full_name: fullName,
    employee_number: cleanString(input.employeeNumber ?? null),
    department: cleanString(input.department ?? null),
    position: cleanString(input.position ?? null),
    employment_status: input.employmentStatus ?? "active",
    is_deleted: false,
  };

  const { data, error } = await client
    .from("employees")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;

  const employee = mapRow(data as EmployeeRow);

  await writeAuditLog(employee.workspace, actor, "create", employee.id, {
    fullName: employee.fullName,
    employeeNumber: employee.employeeNumber,
    department: employee.department,
    position: employee.position,
  });

  return employee;
}

export async function updateEmployee(
  id: string,
  input: EmployeeInput,
  actor: Actor
): Promise<Employee> {
  const client = requireClient();
  const fullName = input.fullName.trim();

  if (!fullName) {
    throw new Error("Full name is required.");
  }

  if (!input.workspace) {
    throw new Error("Workspace is required.");
  }

  const duplicate = await findDuplicate(input.workspace, fullName, id);
  if (duplicate) {
    throw new Error(
      `Another active employee named "${duplicate.fullName}" already exists in ${input.workspace}.`
    );
  }

  const payload: Record<string, unknown> = {
    workspace: input.workspace,
    full_name: fullName,
    employee_number: cleanString(input.employeeNumber ?? null),
    department: cleanString(input.department ?? null),
    position: cleanString(input.position ?? null),
  };

  if (input.employmentStatus) {
    payload.employment_status = input.employmentStatus;
  }

  const { data, error } = await client
    .from("employees")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  const employee = mapRow(data as EmployeeRow);

  await writeAuditLog(employee.workspace, actor, "update", employee.id, {
    fullName: employee.fullName,
    employeeNumber: employee.employeeNumber,
    department: employee.department,
    position: employee.position,
    employmentStatus: employee.employmentStatus,
  });

  return employee;
}

export async function deactivateEmployee(
  id: string,
  actor: Actor
): Promise<Employee> {
  const client = requireClient();

  const { data, error } = await client
    .from("employees")
    .update({
      is_deleted: true,
      employment_status: "inactive",
      deleted_at: new Date().toISOString(),
      deleted_by: actor.userId,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  const employee = mapRow(data as EmployeeRow);

  await writeAuditLog(employee.workspace, actor, "deactivate", employee.id, {
    fullName: employee.fullName,
  });

  return employee;
}

export async function restoreEmployee(
  id: string,
  actor: Actor
): Promise<Employee> {
  const client = requireClient();

  const { data: existing, error: fetchError } = await client
    .from("employees")
    .select("full_name, workspace")
    .eq("id", id)
    .single();

  if (fetchError) throw fetchError;

  const existingRow = existing as { full_name: string; workspace: Workspace };

  const duplicate = await findDuplicate(
    existingRow.workspace,
    existingRow.full_name,
    id
  );

  if (duplicate) {
    throw new Error(
      `Cannot restore: an active employee named "${duplicate.fullName}" already exists in ${existingRow.workspace}.`
    );
  }

  const { data, error } = await client
    .from("employees")
    .update({
      is_deleted: false,
      employment_status: "active",
      deleted_at: null,
      deleted_by: null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  const employee = mapRow(data as EmployeeRow);

  await writeAuditLog(employee.workspace, actor, "restore", employee.id, {
    fullName: employee.fullName,
  });

  return employee;
}
