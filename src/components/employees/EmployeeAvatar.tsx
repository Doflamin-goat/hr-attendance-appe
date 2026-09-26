import { useEffect, useMemo, useState } from "react";
import { useEmployees } from "../../context/EmployeesContext";
import { getEmployeePhotoUrl, normalizeEmployeeName } from "../../services/employeeService";

type Props = {
  employeeId?: string | null;
  name: string;
  profilePhotoPath?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function employeeInitials(name: string) {
  return name.replace(/,/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export function EmployeeAvatar({ employeeId, name, profilePhotoPath, size = "md", className = "" }: Props) {
  const { employees } = useEmployees();
  const employee = useMemo(() => employees.find((item) => employeeId ? item.id === employeeId : normalizeEmployeeName(item.fullName) === normalizeEmployeeName(name)), [employeeId, employees, name]);
  const path = profilePhotoPath !== undefined ? profilePhotoPath : employee?.profilePhotoPath ?? null;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setUrl(null);
    if (path) void getEmployeePhotoUrl(path).then((value) => { if (active) setUrl(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [path]);

  const dimensions = size === "sm" ? "h-8 w-8 text-[10px]" : size === "lg" ? "h-20 w-20 text-xl" : "h-10 w-10 text-xs";
  const styles = `${dimensions} flex-shrink-0 rounded-full border border-brand-100 bg-brand-50 object-cover text-brand-700 ${className}`;
  if (url && !failed) return <img src={url} alt={`${name} profile`} loading="lazy" onError={() => setFailed(true)} className={styles} />;
  return <div className={`${styles} flex items-center justify-center font-semibold`} aria-label={`${name} initials`}>{employeeInitials(name)}</div>;
}
