import { PublicInfoPage } from "../components/layout/PublicInfoPage";

export function Contact() {
  return <PublicInfoPage title="Contact" description="WATTS APP system and technical support information.">
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-5"><p className="text-base font-semibold text-slate-900">Nathaniel</p><p className="mt-1 text-slate-500">WATTS APP Creator / Developer</p></section>
    <p>For system concerns, feature requests, or technical support, contact the WATTS APP administrator.</p>
  </PublicInfoPage>;
}
