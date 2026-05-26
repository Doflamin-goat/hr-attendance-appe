import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import {
  LogIn,
  FileSpreadsheet,
  Clock,
  UserX,
  BarChart3,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Button, Input, Select, AlertMessage, ThemeToggle } from "../components/ui";

const REMEMBER_ACCOUNT_KEY = "timecore.rememberedAccount";
const DEFAULT_ACCOUNT = "app@attendance.local";

const ACCOUNT_OPTIONS: { value: string; label: string }[] = [
  { value: "app@attendance.local", label: "APP" },
  { value: "wais@attendance.local", label: "WAIS" },
];

const FEATURES = [
  {
    icon: FileSpreadsheet,
    title: "Attendance Uploads",
    description: "Import biometric Excel files in one click.",
  },
  {
    icon: Clock,
    title: "Late Monitoring",
    description: "Track late arrivals and undertime trends.",
  },
  {
    icon: UserX,
    title: "Absence Tracking",
    description: "Log and review absences with exemptions.",
  },
  {
    icon: BarChart3,
    title: "HR Reports",
    description: "Export polished workbooks per scope.",
  },
];

function readRememberedAccount(): string | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(REMEMBER_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function writeRememberedAccount(value: string | null) {
  if (typeof window === "undefined") return;

  try {
    if (value === null) {
      window.localStorage.removeItem(REMEMBER_ACCOUNT_KEY);
    } else {
      window.localStorage.setItem(REMEMBER_ACCOUNT_KEY, value);
    }
  } catch {
    // Ignore localStorage errors.
  }
}

export default function LoginPage() {
  const { signIn, user, loading, configError } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const initialRemembered = readRememberedAccount();
  const [email, setEmail] = useState(initialRemembered ?? DEFAULT_ACCOUNT);
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(initialRemembered !== null);
  const [errorText, setErrorText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (rememberMe) {
      writeRememberedAccount(email);
    } else {
      writeRememberedAccount(null);
    }
  }, [rememberMe, email]);

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorText("");
    setIsSubmitting(true);

    const result = await signIn(email, password);

    if (!result.success) {
      setErrorText(result.message);
    }

    setIsSubmitting(false);
  }

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-slate-50">
      <div
        aria-hidden="true"
        className="absolute inset-0 z-0"
        style={{
          background: isDark
            ? "linear-gradient(135deg, #0b1220 0%, #111b2e 38%, #0f172a 68%, #0b1729 100%)"
            : "linear-gradient(135deg, #eff6ff 0%, #f8fafc 38%, #ffffff 68%, #eaf2ff 100%)",
        }}
      />

      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 opacity-[0.42]"
        style={{
          backgroundImage: isDark
            ? "linear-gradient(to right, rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px)"
            : "linear-gradient(to right, rgba(30,41,59,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(30,41,59,0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at 42% 40%, rgba(0,0,0,0.95), rgba(0,0,0,0) 76%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 42% 40%, rgba(0,0,0,0.95), rgba(0,0,0,0) 76%)",
        }}
      />

      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 z-0 hidden w-[46%] lg:block"
        style={{
          background: isDark
            ? "linear-gradient(90deg, rgba(15,23,42,0) 0%, rgba(30,58,138,0.35) 42%, rgba(17,24,39,0.86) 100%)"
            : "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(219,234,254,0.55) 42%, rgba(241,245,249,0.86) 100%)",
        }}
      />

      <div
        aria-hidden="true"
        className={`absolute right-[-80px] top-[-80px] z-0 hidden h-[720px] w-[520px] rotate-12 rounded-[4rem] shadow-2xl backdrop-blur-2xl lg:block ${
          isDark
            ? "border border-white/10 bg-white/[0.04]"
            : "border border-white/70 bg-white/35"
        }`}
      />

      <div
        aria-hidden="true"
        className={`absolute right-[120px] top-[92px] z-0 hidden h-[520px] w-[130px] rounded-[2rem] blur-[1px] lg:block ${
          isDark ? "bg-white/[0.04]" : "bg-white/35"
        }`}
      />

      <div
        aria-hidden="true"
        className={`absolute right-[300px] top-[155px] z-0 hidden h-[420px] w-[90px] rounded-[2rem] blur-[1px] lg:block ${
          isDark ? "bg-brand-500/15" : "bg-blue-100/45"
        }`}
      />

      <div
        aria-hidden="true"
        className={`absolute -left-44 bottom-[-260px] z-0 h-[720px] w-[720px] rounded-full blur-3xl ${
          isDark ? "bg-brand-700/25" : "bg-blue-700/20"
        }`}
      />

      <div
        aria-hidden="true"
        className={`absolute -right-44 top-[-240px] z-0 h-[680px] w-[680px] rounded-full blur-3xl ${
          isDark ? "bg-brand-500/15" : "bg-sky-300/30"
        }`}
      />

      <div
        aria-hidden="true"
        className={`absolute left-[38%] top-[22%] z-0 h-[360px] w-[360px] rounded-full blur-3xl ${
          isDark ? "bg-slate-700/35" : "bg-slate-300/25"
        }`}
      />

      <div
        aria-hidden="true"
        className="absolute inset-0 z-0"
        style={{
          background: isDark
            ? "linear-gradient(115deg, rgba(15,23,42,0) 32%, rgba(15,23,42,0.55) 52%, rgba(15,23,42,0) 72%)"
            : "linear-gradient(115deg, rgba(255,255,255,0) 32%, rgba(255,255,255,0.72) 52%, rgba(255,255,255,0) 72%)",
        }}
      />

      <div className="absolute top-4 right-4 z-20 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>

      <main className="relative z-10 min-h-screen">
        <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden lg:flex items-start px-14 pt-24 xl:px-24 xl:pt-28">
            <div className="max-w-xl rounded-[2rem] border border-white/55 bg-white/30 p-8 shadow-[0_24px_80px_-44px_rgba(15,23,42,0.45)] backdrop-blur-sm">
              <div className="mb-12 flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 shadow-[0_16px_40px_-18px_rgba(30,64,175,0.95)] ring-1 ring-brand-900/15">
                  <img
                    src="/Watts-logo.png"
                    alt="Watts Logo"
                    className="h-10 w-10 object-contain"
                  />
                </div>
                <div>
                  <p className="text-[18px] font-bold leading-tight tracking-tight text-slate-950">
                    WATTS App TimeCore
                  </p>
                  <p className="mt-1 text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    HR Attendance System
                  </p>
                </div>
              </div>

              <h2 className="text-[44px] font-semibold leading-[1.02] tracking-[-0.04em] text-slate-950 xl:text-[52px]">
                Smart Attendance.
                <br />
                <span className="text-brand-700">Better Workforce.</span>
              </h2>

              <p className="mt-6 max-w-lg text-[15px] leading-7 text-slate-600">
                Manage attendance uploads, late records, exemptions, absences,
                undertime, and HR reports in one centralized system.
              </p>

              <div className="mt-9 grid grid-cols-2 gap-4">
                {FEATURES.map((feature) => {
                  const Icon = feature.icon;

                  return (
                    <div
                      key={feature.title}
                      className="group rounded-2xl border border-white/70 bg-white/75 p-4 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.55)] backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_24px_54px_-30px_rgba(15,23,42,0.65)]"
                    >
                      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700">
                        <Icon className="h-5 w-5" />
                      </div>
                      <p className="text-[13px] font-semibold text-slate-950">
                        {feature.title}
                      </p>
                      <p className="mt-1.5 text-[12px] leading-5 text-slate-500">
                        {feature.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-14">
            <div className="w-full max-w-md">
              <div className="mb-7 flex items-center gap-3 lg:hidden">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-700 shadow-sm ring-1 ring-brand-800/20">
                  <img
                    src="/Watts-logo.png"
                    alt="Watts Logo"
                    className="h-9 w-9 object-contain"
                  />
                </div>
                <div>
                  <p className="text-[16px] font-bold leading-tight text-slate-900">
                    WATTS App TimeCore
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    HR Attendance System
                  </p>
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-white/80 bg-white/95 p-7 shadow-[0_34px_90px_-38px_rgba(15,23,42,0.55)] backdrop-blur-xl sm:p-8">
                <div className="mb-6">
                  <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-slate-950">
                    Sign in to your workspace
                  </h1>
                  <p className="mt-1.5 text-[13px] leading-5 text-slate-500">
                    Use the assigned company account to access HR records.
                  </p>
                </div>

                {configError && (
                  <div className="mb-4">
                    <AlertMessage
                      tone="warning"
                      title="Configuration warning"
                      message={configError}
                    />
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <Select
                    label="Account Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  >
                    {ACCOUNT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>

                  <Input
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    autoComplete="current-password"
                  />

                  <div className="flex items-center justify-between gap-4">
                    <label className="inline-flex cursor-pointer select-none items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-brand-700 accent-brand-700 focus:ring-2 focus:ring-brand-500"
                      />
                      <span className="text-[12px] text-slate-700">
                        Remember me
                      </span>
                    </label>

                    <span className="text-right text-[11px] leading-4 text-slate-400">
                      Saves only the account,
                      <br className="hidden sm:block" /> not your password
                    </span>
                  </div>

                  {errorText && (
                    <AlertMessage tone="error" message={errorText} />
                  )}

                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    fullWidth
                    disabled={isSubmitting || !!configError}
                    leftIcon={<LogIn className="h-4 w-4" />}
                    className="mt-1 shadow-[0_18px_32px_-22px_rgba(30,64,175,0.95)]"
                  >
                    {isSubmitting ? "Signing in..." : "Sign In"}
                  </Button>

                  <p className="pt-1 text-center text-[12px] text-slate-500">
                    Need access?{" "}
                    <span className="font-semibold text-brand-700">
                      Contact IT Administrator
                    </span>
                  </p>
                </form>
              </div>

              <p className="mt-6 text-center text-[11px] text-slate-400">
                © 2026 App Electric Corporation
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}