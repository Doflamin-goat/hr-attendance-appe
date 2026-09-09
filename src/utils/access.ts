import type { AppRole } from "../context/AuthContext";

export const canAccessPath = (role: AppRole | null, path: string) => {
  if (path === "/" || path === "/employees") return role === "Admin" || role === "HR";
  if (path === "/approvals") return role === "Admin";
  return role === "HR";
};
