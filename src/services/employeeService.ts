import { supabase } from "../lib/supabase";

export type Workspace = "APP" | "WAIS";
export type HrScope = "ITC" | "MAIN";
export type Employer = "APP" | "WAIS" | "WATTS APP" | "M2B";
export type EmploymentStatus = "active" | "inactive";

export interface Employee {
  id: string;
  workspace: Workspace;
  employer: Employer;
  hrScope: HrScope;
  employeeNumber: string | null;
  fullName: string;
  attendanceName?: string | null;
  department: string | null;
  position: string | null;
  startDate?: string | null;
  regularDate?: string | null;
  employmentStatus: EmploymentStatus;
  isDeleted: boolean;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  updatedAt: string;
  profilePhotoPath: string | null;
  photoUploadWarning?: string;
}

export interface EmployeeInput {
  workspace: Workspace;
  employer: Employer;
  hrScope: HrScope;
  fullName: string;
  employeeNumber?: string | null;
  department?: string | null;
  position?: string | null;
  employmentStatus?: EmploymentStatus;
  profilePhotoFile?: File | null;
  removeProfilePhoto?: boolean;
}

type Actor = {
  userId: string | null;
  email: string | null;
};

type AuditAction = "create" | "update" | "deactivate" | "restore";

type EmployeeRow = {
  id: string;
  workspace: string;
  employer?: string | null;
  hr_scope?: string | null;
  employee_number: string | null;
  full_name: string;
  attendance_name?: string | null;
  department: string | null;
  position: string | null;
  start_date?: string | null;
  regular_date?: string | null;
  employment_status: string;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
  profile_photo_path?: string | null;
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
    employer: (row.employer ?? row.workspace) as Employer,
    hrScope: (row.hr_scope ?? "ITC") as HrScope,
    employeeNumber: row.employee_number,
    fullName: row.full_name,
    attendanceName: row.attendance_name ?? null,
    department: row.department,
    position: row.position,
    startDate: row.start_date ?? null,
    regularDate: row.regular_date ?? null,
    employmentStatus: row.employment_status as EmploymentStatus,
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    profilePhotoPath: row.profile_photo_path ?? null,
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
export async function listEmployees(hrScope: HrScope): Promise<Employee[]> {
  const client = requireClient();

  let query = client
    .from("employees")
    .select("*")
    .order("full_name", { ascending: true });

  query = query.eq("hr_scope", hrScope);

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []).map((row) => mapRow(row as EmployeeRow));
}

async function findDuplicate(
  hrScope: HrScope,
  fullName: string,
  ignoreId?: string
): Promise<Employee | null> {
  const client = requireClient();
  const key = normalizeEmployeeName(fullName);

  if (!key) return null;

  const { data, error } = await client
    .from("employees")
    .select("*")
    .eq("hr_scope", hrScope)
    .eq("is_deleted", false);

  if (error) throw error;

  const match = (data ?? []).find((row) => {
    if (ignoreId && row.id === ignoreId) return false;
    return normalizeEmployeeName((row as EmployeeRow).full_name) === key;
  });

  return match ? mapRow(match as EmployeeRow) : null;
}

export const EMPLOYEE_PHOTO_BUCKET = "employee-profile-pictures";
export const EMPLOYEE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const signedPhotoUrls = new Map<string, { url: string; expiresAt: number }>();

export function validateEmployeePhoto(file: Pick<File, "type" | "size">) {
  if (!PHOTO_TYPES[file.type]) return "Please select a JPG, PNG, or WebP image.";
  if (file.size > EMPLOYEE_PHOTO_MAX_BYTES) return "Profile photo must be 2 MB or smaller.";
  return null;
}

export async function getEmployeePhotoUrl(path: string) {
  const cached = signedPhotoUrls.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const { data, error } = await requireClient().storage.from(EMPLOYEE_PHOTO_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  signedPhotoUrls.set(path, { url: data.signedUrl, expiresAt: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

async function uploadEmployeePhoto(employee: Employee, file: File) {
  const validation = validateEmployeePhoto(file);
  if (validation) throw new Error(validation);
  const extension = PHOTO_TYPES[file.type];
  const path = `employees/${employee.id}/profile-${Date.now()}.${extension}`;
  const client = requireClient();
  const { error: uploadError } = await client.storage.from(EMPLOYEE_PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error("The profile photo could not be uploaded. Please try again.");
  const { data, error } = await client.from("employees").update({ profile_photo_path: path }).eq("id", employee.id).eq("hr_scope", employee.hrScope).select("*").single();
  if (error) {
    await client.storage.from(EMPLOYEE_PHOTO_BUCKET).remove([path]);
    throw new Error("The profile photo could not be saved. Please try again.");
  }
  if (employee.profilePhotoPath && employee.profilePhotoPath !== path) {
    await client.storage.from(EMPLOYEE_PHOTO_BUCKET).remove([employee.profilePhotoPath]);
    signedPhotoUrls.delete(employee.profilePhotoPath);
  }
  return mapRow(data as EmployeeRow);
}

async function removeEmployeePhoto(employee: Employee) {
  if (!employee.profilePhotoPath) return employee;
  const client = requireClient();
  const oldPath = employee.profilePhotoPath;
  const { data, error } = await client.from("employees").update({ profile_photo_path: null }).eq("id", employee.id).eq("hr_scope", employee.hrScope).select("*").single();
  if (error) throw new Error("The profile photo could not be removed. Please try again.");
  await client.storage.from(EMPLOYEE_PHOTO_BUCKET).remove([oldPath]);
  signedPhotoUrls.delete(oldPath);
  return mapRow(data as EmployeeRow);
}

async function findDuplicateEmployeeNumber(employeeNumber: string | null | undefined, ignoreId?: string) {
  const value = cleanString(employeeNumber);
  if (!value) return null;
  let query = requireClient().from("employees").select("id, full_name, employee_number").eq("employee_number", value);
  if (ignoreId) query = query.neq("id", ignoreId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
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

  const duplicate = await findDuplicate(input.hrScope, fullName);
  if (duplicate) {
    throw new Error(
      `An active employee named "${duplicate.fullName}" already exists in ${input.hrScope}.`
    );
  }
  const numberDuplicate = await findDuplicateEmployeeNumber(input.employeeNumber);
  if (numberDuplicate) throw new Error(`Employee number ${input.employeeNumber} already belongs to ${numberDuplicate.full_name}.`);

  const payload = {
    workspace: input.hrScope === "MAIN" ? "WAIS" : "APP",
    employer: input.employer,
    hr_scope: input.hrScope,
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

  let employee = mapRow(data as EmployeeRow);

  if (input.profilePhotoFile) {
    try {
      employee = await uploadEmployeePhoto(employee, input.profilePhotoFile);
    } catch (error) {
      employee.photoUploadWarning = error instanceof Error ? error.message : "The employee was created, but the profile photo could not be uploaded.";
    }
  }

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

  const duplicate = await findDuplicate(input.hrScope, fullName, id);
  if (duplicate) {
    throw new Error(
      `Another active employee named "${duplicate.fullName}" already exists in ${input.hrScope}.`
    );
  }
  const numberDuplicate = await findDuplicateEmployeeNumber(input.employeeNumber, id);
  if (numberDuplicate) throw new Error(`Employee number ${input.employeeNumber} already belongs to ${numberDuplicate.full_name}.`);

  const payload: Record<string, unknown> = {
    workspace: input.hrScope === "MAIN" ? "WAIS" : "APP",
    employer: input.employer,
    hr_scope: input.hrScope,
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

  let employee = mapRow(data as EmployeeRow);

  if (input.profilePhotoFile) employee = await uploadEmployeePhoto(employee, input.profilePhotoFile);
  else if (input.removeProfilePhoto) employee = await removeEmployeePhoto(employee);

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
    .select("full_name, workspace, hr_scope")
    .eq("id", id)
    .single();

  if (fetchError) throw fetchError;

  const existingRow = existing as { full_name: string; workspace: Workspace; hr_scope: HrScope };

  const duplicate = await findDuplicate(
    existingRow.hr_scope,
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
