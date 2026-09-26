import { PublicInfoPage } from "../components/layout/PublicInfoPage";

export function Privacy() {
  return <PublicInfoPage title="Privacy Policy" description="A high-level description of information handled by this internal HR system.">
    <p>WATTS APP processes employee-related information needed for attendance administration, including employee identity, attendance records, absences, leave, exemptions, and approval records.</p>
    <p>Access is limited to authorized HR and Admin users. The application is intended only for internal APP Electric Corporation use.</p>
    <p>Privacy, data-access, or account concerns should be directed to the WATTS APP system administrator or APP Electric Corporation.</p>
  </PublicInfoPage>;
}
