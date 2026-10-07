import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
  Trash2,
  ClipboardCheck,
  Palmtree,
  CheckCircle2,
  XCircle,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  BriefcaseBusiness,
} from "lucide-react";
import { Link, Outlet, useLocation } from "react-router";
import { useAttendance } from "../../context/AttendanceContext";
import { useAuth } from "../../context/AuthContext";
import { ThemeToggle } from "../ui";
import { loadAttendanceNotifications, type AttendanceNotification } from "../../services/notificationService";
import { WattsIcon } from "../branding/WattsIcon";
import { AppFooter } from "./AppFooter";

type NavItem = {
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
  roles?: ("Admin" | "HR")[];
  mainOnly?: boolean;
};

const navigation: NavItem[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Employees", href: "/employees", icon: Users },
  { name: "Attendance Records", href: "/attendance-records", icon: ListChecks, roles: ["Admin", "HR"], mainOnly: true },
  { name: "Late Records", href: "/lates", icon: Clock, roles: ["Admin", "HR"] },
  { name: "Exemptions", href: "/exemptions", icon: ShieldCheck, roles: ["Admin", "HR"] },
  { name: "Absences", href: "/absences", icon: UserX, roles: ["HR"] },
  { name: "Leave", href: "/leave", icon: Palmtree, roles: ["HR"] },
  { name: "Undertime", href: "/undertime", icon: Timer, roles: ["HR"] },
  { name: "Half-Day", href: "/half-day", icon: CalendarRange, roles: ["HR"] },
  { name: "Service", href: "/service", icon: BriefcaseBusiness, roles: ["Admin", "HR"] },
  { name: "Recycle Bin", href: "/recycle-bin", icon: Trash2, roles: ["HR"] },
  { name: "Approvals", href: "/approvals", icon: ClipboardCheck, roles: ["Admin"] },
  { name: "Absence Records", href: "/absence-records", icon: UserX, roles: ["Admin"] },
];

const navigationGroups = [
  { label: "Overview", items: navigation.filter((item) => ["/", "/employees", "/attendance-records", "/lates"].includes(item.href)) },
  { label: "Attendance Management", items: navigation.filter((item) => ["/exemptions", "/absences", "/leave", "/undertime", "/half-day", "/service", "/approvals", "/absence-records"].includes(item.href)) },
  { label: "System", items: navigation.filter((item) => item.href === "/recycle-bin") },
];

const SIDEBAR_STORAGE_KEY = "watts-sidebar-collapsed";
const APP_SHELL_HEADER_HEIGHT = "h-14";

function readSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

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
  role: "Admin" | "HR" | null;
  hrScope: "ITC" | "MAIN" | null;
  trashCount: number;
  onSignOut: () => void;
  onNavigate?: () => void;
  collapsed?: boolean;
};

function SidebarContent({
  pathname,
  workspace,
  role,
  hrScope,
  trashCount,
  onSignOut,
  onNavigate,
  collapsed = false,
}: SidebarContentProps) {
  return (
    <>
      <div className={`${APP_SHELL_HEADER_HEIGHT} flex items-center border-b border-slate-200 ${collapsed ? "justify-center px-2" : "gap-3 px-5"}`}>
        <WattsIcon className="h-9 w-9 flex-none drop-shadow-sm" />
        {!collapsed && <div className="min-w-0">
          <p className="text-[15px] font-bold text-slate-900 leading-tight">
            WATTS APP
          </p>
          <p className="text-[11px] text-slate-500 uppercase tracking-wide font-medium">
            HR Attendance
          </p>
        </div>}
      </div>

      <nav className={`flex-1 overflow-y-auto py-3 ${collapsed ? "px-2" : "px-3"}`}>
        <div className="space-y-4">
          {navigationGroups.map((group) => {
            const visibleItems = group.items.filter((item) => (!item.roles || (role && item.roles.includes(role))) && (!item.mainOnly || hrScope === "MAIN"));
            if (visibleItems.length === 0) return null;
            return <section key={group.label}>
              {!collapsed && <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400">{group.label}</p>}
              <ul className="space-y-0.5">{visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            const showTrashBadge =
              item.href === "/recycle-bin" && trashCount > 0;

            return (
              <li key={item.name}>
                <Link
                  to={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.name : undefined}
                  aria-label={collapsed ? item.name : undefined}
                  className={`group relative flex min-h-9 items-center rounded-lg py-2 text-sm font-medium transition-colors ${collapsed ? "justify-center gap-0 px-2" : "gap-3 px-3"} ${
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {isActive && (
                    <span className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-r bg-brand-600" />
                  )}
                  <Icon
                    className={`h-4 w-4 flex-none ${
                      isActive
                        ? "text-brand-700"
                        : "text-slate-400 group-hover:text-slate-600"
                    }`}
                  />
                  {!collapsed && <span className="truncate flex-1">{item.name}</span>}
                  {showTrashBadge && (
                    <span
                      className={`${collapsed ? "absolute right-0 top-0" : "ml-auto"} inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-700`}
                      aria-label={`${trashCount} items in Trash`}
                    >
                      {trashCount > 99 ? "99+" : trashCount}
                    </span>
                  )}
                </Link>
              </li>
            );
              })}</ul>
            </section>;
          })}
        </div>
      </nav>

      <div className={`border-t border-slate-200 ${collapsed ? "p-2" : "p-3"}`}>
        <div className={`flex items-center rounded-lg border border-slate-200 bg-slate-50 py-2.5 ${collapsed ? "flex-col gap-2 px-1" : "gap-3 px-3"}`}>
          <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-700 border border-brand-100 flex items-center justify-center text-xs font-bold flex-shrink-0">
            {role ?? "?"}
          </div>
          {!collapsed && <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-900 truncate">
              {workspace === "WAIS" ? "Main Office" : workspace === "APP" ? "ITC Plant" : "No workspace"}
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              {role ? `${role} access` : "Signed in"}
            </p>
          </div>}
          <button
            type="button"
            onClick={onSignOut}
            className="shrink-0 text-slate-400 transition-colors hover:text-danger-700"
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
    deletedAttendanceCount,
    loadDeletedAttendanceData,
    loading: attendanceLoading,
    exemptions,
  } = useAttendance();

  const { workspace, hrScope, role, signOut } = useAuth();
  const [attendanceNotifications, setAttendanceNotifications] = useState<AttendanceNotification[]>([]);

  useEffect(() => {
    if (!role) { setAttendanceNotifications([]); return; }
    const refresh = () => { void loadAttendanceNotifications(role, workspace).then(setAttendanceNotifications).catch(() => setAttendanceNotifications([])); };
    refresh();
    window.addEventListener("attendance-notifications-changed", refresh);
    return () => window.removeEventListener("attendance-notifications-changed", refresh);
  }, [role, workspace, exemptions]);
  const [isBellOpen, setIsBellOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readSidebarCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isSidebarCollapsed));
    } catch {
      // Keep the in-memory preference when browser storage is unavailable.
    }
  }, [isSidebarCollapsed]);

  // Prefetch the Trash count once the active data is loaded so the
  // sidebar badge appears without forcing the user to visit the page.
  useEffect(() => {
    if (attendanceLoading || !workspace) return;
    void loadDeletedAttendanceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceLoading, workspace]);

  const currentScopeLabel = useMemo(() => {
    if (selectedDayScope !== "all") return formatDayLabel(selectedDayScope);
    if (selectedMonthScope !== "all") return formatMonthLabel(selectedMonthScope);
    return "All Records";
  }, [selectedMonthScope, selectedDayScope]);

  const handleSignOut = () => {
    void signOut();
  };

  return (
    <div
      className="min-h-screen bg-slate-50 flex"
      style={{ "--watts-sidebar-width": isSidebarCollapsed ? "4rem" : "16rem" } as CSSProperties}
    >
      <aside className="hidden md:flex md:w-[var(--watts-sidebar-width)] flex-col bg-white border-r border-slate-200 fixed inset-y-0 z-10">
        <button
          type="button"
          onClick={() => setIsSidebarCollapsed((value) => !value)}
          className="absolute -right-3 top-1/2 z-30 inline-flex h-8 w-6 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-brand-50 hover:text-brand-700"
          aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!isSidebarCollapsed}
          title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isSidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
        <SidebarContent
          pathname={location.pathname}
          workspace={workspace}
          role={role}
          hrScope={hrScope}
          trashCount={deletedAttendanceCount}
          onSignOut={handleSignOut}
          collapsed={isSidebarCollapsed}
        />
      </aside>

      {isMobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/50"
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
              role={role}
              hrScope={hrScope}
              trashCount={deletedAttendanceCount}
              onSignOut={() => {
                setIsMobileNavOpen(false);
                handleSignOut();
              }}
              onNavigate={() => setIsMobileNavOpen(false)}
            />
          </aside>
        </div>
      )}

      <div className="flex-1 md:ml-[var(--watts-sidebar-width)] flex flex-col min-w-0">
        <header className="w-full shrink-0 bg-white/95 backdrop-blur border-b border-slate-200 sticky top-0 z-20">
          <div className={`${APP_SHELL_HEADER_HEIGHT} flex w-full items-center justify-between gap-3 px-4 sm:px-6`}>
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
              <ThemeToggle />

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsBellOpen((prev) => !prev)}
                  className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                  aria-label="Notifications"
                >
                  <Bell className="w-5 h-5" />

                  {(unreadMemoCount + attendanceNotifications.length) > 0 && (
                    <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {unreadMemoCount + attendanceNotifications.length}
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
                            Notifications
                          </p>
                          <p className="text-xs text-slate-500">
                            {role === "Admin" ? "Pending approvals and memo reminders" : "Approval decisions and memo reminders"}
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
                        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700">Approval updates</div>
                        {attendanceNotifications.length === 0 && <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3"><p className="text-xs font-semibold text-slate-700">Approval inbox</p><p className="mt-1 text-xs leading-5 text-slate-500">{role === "Admin" ? "No pending approval requests." : "No exemption or leave decisions submitted by you."}</p></div>}
                        {attendanceNotifications.map((notification) => { const denied = notification.status === "declined" || notification.status === "rejected"; return <div key={notification.id} className={`border-b border-slate-100 px-4 py-3 ${notification.status === "approved" ? "bg-success-50/40" : denied ? "bg-danger-50/40" : "bg-warning-50/40"}`}><div className="flex items-start gap-3"><div className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full ${notification.status === "approved" ? "bg-success-100 text-success-700" : denied ? "bg-danger-100 text-danger-700" : "bg-warning-100 text-warning-700"}`}>{notification.status === "approved" ? <CheckCircle2 className="h-4 w-4" /> : denied ? <XCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}</div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-slate-900">{notification.employeeName}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${notification.status === "approved" ? "bg-success-100 text-success-700" : denied ? "bg-danger-100 text-danger-700" : "bg-warning-100 text-warning-700"}`}>{notification.status}</span></div><p className="mt-1 text-xs font-medium text-slate-600">{notification.title}</p><p className="mt-1 text-[11px] text-slate-500">Date: {notification.workDate} • Time: {notification.lateTime}</p>{notification.createdAt && <p className="mt-1 text-[11px] text-slate-400">Updated {new Date(notification.createdAt).toLocaleString()}</p>}</div></div></div>; })}
                        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700">Late notifications</div>
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

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div
            key={location.pathname}
            className="ui-fade-in-up max-w-7xl mx-auto"
          >
            <Outlet />
          </div>
        </main>
        <AppFooter compact />
      </div>
    </div>
  );
}
