import type { ReactNode } from "react";
import { Link } from "react-router";
import { WattsIcon } from "../branding/WattsIcon";
import { AppFooter } from "./AppFooter";
import { ThemeToggle } from "../ui";
import { useAuth } from "../../context/AuthContext";

export function PublicInfoPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const { user, loading } = useAuth();
  return <div className="flex min-h-screen flex-col bg-slate-50">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5"><Link to={user ? "/" : "/login"} className="flex items-center gap-3"><WattsIcon className="h-9 w-9" /><div><p className="text-sm font-bold text-slate-900">WATTS APP</p><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">HR Attendance</p></div></Link><div className="flex items-center gap-3">{!loading && <Link to={user ? "/" : "/login"} className="text-xs font-semibold text-brand-700 hover:text-brand-800">{user ? "Back to Dashboard" : "Sign in"}</Link>}<ThemeToggle /></div></div></header>
    <main className="flex-1 px-5 py-10"><article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p><div className="mt-7 space-y-5 text-sm leading-7 text-slate-700">{children}</div></article></main>
    <AppFooter />
  </div>;
}
