import { PublicInfoPage } from "../components/layout/PublicInfoPage";

export function About() {
  return <PublicInfoPage title="About WATTS APP" description="An internal HR Attendance Management System created for APP Electric Corporation.">
    <p>WATTS APP helps authorized HR and Admin users manage attendance operations across APP and WAIS employees.</p>
    <div><p className="font-semibold text-slate-900">The system supports:</p><ul className="mt-2 grid list-inside list-disc gap-1 sm:grid-cols-2"><li>Attendance</li><li>Employee records</li><li>Late records</li><li>Exemptions</li><li>Absences</li><li>Leave</li><li>Approvals</li><li>Attendance history and reporting</li></ul></div>
  </PublicInfoPage>;
}
