export type LoginAccount = {
  email: string;
  label: "APP HR" | "APP Admin" | "WAIS HR" | "WAIS Admin";
  role: "HR" | "Admin";
  workspace: "APP" | "WAIS";
};

export const LOGIN_ACCOUNTS: LoginAccount[] = [
  { email: "app@attendance.local", label: "APP HR", role: "HR", workspace: "APP" },
  { email: "app.admin@attendance.local", label: "APP Admin", role: "Admin", workspace: "APP" },
  { email: "wais@attendance.local", label: "WAIS HR", role: "HR", workspace: "WAIS" },
  { email: "wais.admin@attendance.local", label: "WAIS Admin", role: "Admin", workspace: "WAIS" },
];
