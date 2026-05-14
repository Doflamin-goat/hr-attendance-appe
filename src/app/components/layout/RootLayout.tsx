import { useMemo, useState } from "react";
import {
  LayoutDashboard,
  Clock,
  ShieldCheck,
  UserX,
  Timer,
  UploadCloud,
  Bell,
  Users,
  AlertTriangle,
  CheckCheck,
  CalendarRange,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { Link, Outlet, useLocation } from "react-router";
import { useAttendance } from "../../context/AttendanceContext";
import { useAuth } from "../../context/AuthContext";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Employees", href: "/employees", icon: Users },
  { name: "Late Records", href: "/lates", icon: Clock },
  { name: "Exemptions", href: "/exemptions", icon: ShieldCheck },
  { name: "Absences", href: "/absences", icon: UserX },
  { name: "Undertime", href: "/undertime", icon: Timer },
];

function formatMonthLabel(monthKey: string) {
  if (monthKey === "all") return "All Months";
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatDayLabel(dayValue: string) {
  if (dayValue === "all") return "All Dates";
  return new Date(dayValue).toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

type SidebarContentProps = {
  pathname: string;
  fileName: string;
  scopeLabel: string;
  memoCount: number;
  onNavigate?: () => void;
};

function SidebarContent({
  pathname,
  fileName,
  scopeLabel,
  memoCount,
  onNavigate,
}: SidebarContentProps) {
  return (
    <>
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-200">
        <div className="w-9 h-9 rounded-lg bg-brand-700 flex items-center justify-center">
          <Clock className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-base font-bold text-slate-900 leading-tight">
            TimeCore
          </p>
          <p className="text-xs text-slate-500">HR Attendance</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Menu
        </p>

        <ul className="space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <li key={item.name}>
                <Link
                  to={item.href}
                  onClick={onNavigate}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${
                      isActive ? "text-brand-700" : "text-slate-400"
                    }`}
                  />
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-slate-200 p-4 space-y-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-start gap-2.5">
            <UploadCloud className="w-4 h-4 text-brand-700 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Current File
              </p>
              <p className="text-xs text-slate-700 truncate mt-0.5">
                {fileName || "None selected"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-start gap-2.5">
            <CalendarRange className="w-4 h-4 text-brand-700 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Report Scope
              </p>
              <p className="text-xs text-slate-700 mt-0.5">{scopeLabel}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-warning-100 bg-warning-50 p-3">
          <div className="flex items-start gap-2.5">
            <Bell className="w-4 h-4 text-warning-700 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-warning-700">
                Memo Reminders
              </p>
              <p className="text-xs text-warning-700 mt-0.5">
                {memoCount > 0
                  ? `${memoCount} employee(s) due`
                  : "No reminders"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function RootLayout() {
  const location = useLocation();
  const {
    fileName,
    memoAlerts,
    unreadMemoCount,
    markAllMemoAlertsAsRead,
    monthScopeOptions,
    dayScopeOptions,
    selectedMonthScope,
    selectedDayScope,
    setSelectedMonthScope,
    setSelectedDayScope,
  } = useAttendance();

  const { workspace, email, signOut } = useAuth();
  const [isBellOpen, setIsBellOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const currentScopeLabel = useMemo(() => {
    if (selectedDayScope !== "all") return formatDayLabel(selectedDayScope);
    if (selectedMonthScope !== "all") return formatMonthLabel(selectedMonthScope);
    return "All Records";
  }, [selectedMonthScope, selectedDayScope]);

  return (
    <div className="min-h-screen bg-slate-100 flex">
      <aside className="hidden md:flex w-64 flex-col bg-white border-r border-slate-200 fixed inset-y-0 z-10">
        <SidebarContent
          pathname={location.pathname}
          fileName={fileName}
          scopeLabel={currentScopeLabel}
          memoCount={memoAlerts.length}
        />
      </aside>

      {isMobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setIsMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-white border-r border-slate-200 shadow-xl">
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-700"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent
              pathname={location.pathname}
              fileName={fileName}
              scopeLabel={currentScopeLabel}
              memoCount={memoAlerts.length}
              onNavigate={() => setIsMobileNavOpen(false)}
            />
          </aside>
        </div>
      )}

      <div className="flex-1 md:ml-64 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
          <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-6">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setIsMobileNavOpen(true)}
                className="md:hidden inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="hidden lg:flex items-center gap-2 text-slate-500 text-sm font-medium">
                <CalendarRange className="w-4 h-4" />
                Scope
              </div>

              <div className="flex flex-1 items-center gap-2 min-w-0 max-w-2xl">
                <select
                  value={selectedMonthScope}
                  onChange={(e) => {
                    setSelectedMonthScope(e.target.value);
                    setSelectedDayScope("all");
                  }}
                  className="h-9 flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  <option value="all">All Months</option>
                  {monthScopeOptions.map((month) => (
                    <option key={month} value={month}>
                      {formatMonthLabel(month)}
                    </option>
                  ))}
                </select>

                <select
                  value={selectedDayScope}
                  onChange={(e) => setSelectedDayScope(e.target.value)}
                  className="h-9 flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  <option value="all">
                    {selectedMonthScope === "all"
                      ? "All Dates"
                      : "All Dates in Month"}
                  </option>
                  {dayScopeOptions.map((day) => (
                    <option key={day} value={day}>
                      {formatDayLabel(day)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsBellOpen((prev) => !prev)}
                  className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                  aria-label="Notifications"
                >
                  <Bell className="w-5 h-5" />

                  {unreadMemoCount > 0 && (
                    <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {unreadMemoCount}
                    </span>
                  )}
                </button>

                {isBellOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setIsBellOpen(false)}
                      aria-hidden="true"
                    />
                    <div className="absolute right-0 z-40 mt-2 w-[360px] max-w-[calc(100vw-1rem)] bg-white border border-slate-200 shadow-xl rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">
                            Memo Notifications
                          </p>
                          <p className="text-xs text-slate-500">
                            Employees with 4+ lates
                          </p>
                        </div>

                        {memoAlerts.length > 0 && (
                          <button
                            type="button"
                            onClick={markAllMemoAlertsAsRead}
                            className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 whitespace-nowrap"
                          >
                            <CheckCheck className="w-4 h-4" />
                            Mark all read
                          </button>
                        )}
                      </div>

                      <div className="max-h-[360px] overflow-y-auto">
                        {memoAlerts.length === 0 ? (
                          <div className="px-4 py-10 text-center">
                            <Bell className="w-10 h-10 mx-auto text-slate-200 mb-3" />
                            <p className="text-sm font-medium text-slate-700">
                              No memo alerts yet
                            </p>
                          </div>
                        ) : (
                          memoAlerts.map((alert) => (
                            <div
                              key={alert.id}
                              className={`px-4 py-3 border-b border-slate-100 last:border-b-0 ${
                                alert.isRead ? "bg-white" : "bg-warning-50/60"
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div
                                  className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                    alert.isRead
                                      ? "bg-slate-100 text-slate-500"
                                      : "bg-warning-100 text-warning-700"
                                  }`}
                                >
                                  <AlertTriangle className="w-4 h-4" />
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm font-semibold text-slate-900 truncate">
                                      {alert.name}
                                    </p>
                                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-danger-50 text-danger-700 border border-danger-100 whitespace-nowrap">
                                      {alert.totalLates} lates
                                    </span>
                                  </div>

                                  <p className="text-xs text-slate-600 mt-1 leading-5">
                                    {alert.message}
                                  </p>

                                  <p className="text-[11px] text-slate-500 mt-1.5">
                                    Total late minutes: {alert.totalMinutesLate}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-lg border border-slate-200 bg-white">
                <div className="text-right leading-tight">
                  <p className="text-xs font-semibold text-slate-900">
                    {workspace ?? "No Workspace"}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate max-w-[160px]">
                    {email ?? "No email"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-danger-700"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden lg:inline">Logout</span>
                </button>
              </div>

              <div className="w-9 h-9 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-700 text-sm font-bold flex-shrink-0">
                HR
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
