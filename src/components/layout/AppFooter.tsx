import { Link } from "react-router";
import { CREATOR_NAME, SUPPORT_URL } from "../../config/branding";
import { WattsIcon } from "../branding/WattsIcon";

export function AppFooter({ compact = false }: { compact?: boolean }) {
  const supportContent = <><span className="font-medium text-slate-700">Support this project ☕</span><span className="text-slate-500">Buy me a coffee (˶ᵔ ᵕ ᵔ˶)</span></>;
  return <footer className="border-t border-slate-200 bg-white/80 text-slate-600">
    <div className={`mx-auto grid max-w-7xl gap-6 px-5 ${compact ? "py-5 sm:grid-cols-4" : "py-8 sm:grid-cols-2 lg:grid-cols-4"}`}>
      <section><div className="flex items-center gap-2"><WattsIcon className="h-8 w-8" /><div><p className="text-sm font-bold text-slate-900">WATTS APP</p><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">HR Attendance System</p></div></div><p className="mt-2 max-w-xs text-xs leading-5">Internal HR attendance and employee-management platform for APP Electric Corporation.</p></section>
      <section><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Links</p><nav className="mt-2 flex flex-col items-start gap-1.5 text-xs"><Link className="text-brand-700 hover:text-brand-800" to="/about">About</Link><Link className="text-brand-700 hover:text-brand-800" to="/privacy">Privacy Policy</Link><Link className="text-brand-700 hover:text-brand-800" to="/contact">Contact</Link></nav></section>
      <section><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Contact</p><p className="mt-2 text-xs font-semibold text-slate-900">{CREATOR_NAME}</p><p className="mt-1 text-xs">Creator / Developer of WATTS APP</p></section>
      <section><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Support This Project</p>{SUPPORT_URL ? <a href={SUPPORT_URL} className="mt-2 flex flex-col items-start gap-1 text-xs text-brand-700 hover:text-brand-800" rel="noreferrer" target="_blank">{supportContent}</a> : <div className="mt-2 flex flex-col items-start gap-1 text-xs">{supportContent}</div>}</section>
    </div>
    <div className="border-t border-slate-100 px-5 py-3"><div className="mx-auto flex max-w-7xl flex-col gap-1 text-[10px] text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>© 2026 APP Electric Corporation</span><span>Created by {CREATOR_NAME}</span></div></div>
  </footer>;
}
