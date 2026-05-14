import { useMemo, useState } from "react";
import {
  LayoutDashboard,
  Clock,
  ShieldCheck,
  UserX,
  Timer,
  Bell,
  Users,
  AlertTriangle,
  CheckCheck,
  CalendarRange,
  LogOut,
  Menu,
  X,
  ChevronRight,
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
  workspace: string | null;
  email: string | null;
  onSignOut: () => void;
  onNavigate?: () => void;
};

function SidebarContent({
  pathname,
  workspace,
  email,
  onSignOut,
  onNavigate,
}: SidebarContentProps) {
  return (
    <>
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-200">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-sm">
          <Clock className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-slate-900 leading-tight">
            TimeCore
          </p>
          <p className="text-[11px] text-slate-500 uppercase tracking-wide font-medium">
            HR Attendance
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          Menu
        </p>

        <ul className="space-y-0.5">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <li key={item.name}>
                <Link
                  to={item.href}
                  onClick={onNavigate}
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-brand-600" />
                  )}
                  <Icon
                    className={`w-4 h-4 ${
                      isActive
                        ? "text-brand-700"
                        : "text-slate-400 group-hover:text-slate-600"
                    }`}
                  />
                  <span className="truncate">{item.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-700 border border-brand-100 flex items-center justify-center text-xs font-bold flex-shrink-0">
            HR
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-900 truncate">
              {workspace ?? "No workspace"}
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              {email ?? "No email"}
            </p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="text-slate-400 hover:text-danger-700 transition-colors"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}

export function RootLayout() {
  const location = useLocation();
  const {
    memoAlerts,
    unreadMemoCount,
    markAllMemoAlertsAsRead,
    selectedMonthScope,
    selectedDayScope,
  } = useAttendance();

  const { workspace, email, signOut } = useAuth();
  const [isBellOpen, setIsBellOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const currentScopeLabel = useMemo(() => {
    if (selectedDayScope !== "all") return formatDayLabel(selectedDayScope);
    if (selectedMonthScope !== "all") return formatMonthLabel(selectedMonthScope);
    return "All Records";
  }, [selectedMonthScope, selectedDayScope]);

  const handleSignOut = () => {
    void signOut();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="hidden md:flex w-64 flex-col bg-white border-r border-slate-200 fixed inset-y-0 z-10">
        <SidebarContent
          pathname={location.pathname}
          workspace={workspace}
          email={email}
          onSignOut={handleSignOut}
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
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent
              pathname={location.pathname}
              workspace={workspace}
              email={email}
              onSignOut={() => {
                setIsMobileNavOpen(false);
                handleSignOut();
              }}
              onNavigate={() => setIsMobileNavOpen(false)}
            />
          </aside>
        </div>
      )}

      <div className="flex-1 md:ml-64 flex flex-col min-w-0">
        <header className="bg-white/95 backdrop-blur border-b border-slate-200 sticky top-0 z-20">
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 h-14">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setIsMobileNavOpen(true)}
                className="md:hidden inline-flex items-center justify-center rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="hidden md:flex items-center gap-2 text-slate-500">
                <CalendarRange className="w-4 h-4" />
                <span className="text-sm font-medium">Scope</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                <span className="text-sm font-semibold text-slate-900">
                  {currentScopeLabel}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
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
