// Deprecated: the employee roster now lives in the Supabase `employees` table
// and is consumed via EmployeesContext / employeeService.
//
// The original hard-coded list has been migrated into Supabase via
// `supabase/migrations/001_employees.sql`. This file is kept only as a stub so
// any external import does not break at build time. Remove it once you verify
// no consumers remain.

export type MasterEmployee = {
  fullName: string;
};

export const MASTER_EMPLOYEES: MasterEmployee[] = [];
export const MASTER_EMPLOYEE_COUNT = 0;
