# HR Attendance System User Guide

## Table of Contents

1. [Welcome](#1-welcome)
2. [Signing in](#2-signing-in)
3. [Roles and access](#3-roles-and-access)
4. [Dashboard](#4-dashboard)
5. [Employees](#5-employees)
6. [Late Records and Manual Late](#6-late-records-and-manual-late)
7. [Exemptions](#7-exemptions)
8. [Admin Approvals and Approval History](#8-admin-approvals-and-approval-history)
9. [Notifications](#9-notifications)
10. [Absences](#10-absences)
11. [Undertime](#11-undertime)
12. [Half-Day](#12-half-day)
13. [Recycle Bin](#13-recycle-bin)
14. [Attendance uploads](#14-attendance-uploads)
15. [Searchable fields](#15-searchable-fields)
16. [Key attendance rules](#16-key-attendance-rules)
17. [Common issues and simple fixes](#17-common-issues-and-simple-fixes)
18. [Daily HR workflow](#18-daily-hr-workflow)
19. [Daily Admin workflow](#19-daily-admin-workflow)
20. [Deployment smoke-test checklist](#20-deployment-smoke-test-checklist)

## 1. Welcome

Welcome to the HR Attendance System. It helps HR manage attendance for APP and WAIS employees in one place. The system includes employee records, attendance uploads, late records, exemptions, absences, undertime, half-day records, notifications, reports, and a Recycle Bin.

Admin users can monitor attendance information and review exemption requests. The menus and actions shown after sign-in depend on the account role.

## 2. Signing in

The login page provides four account choices:

| Login choice | Access |
|---|---|
| **APP HR** | HR tools for APP and WAIS attendance records |
| **WAIS HR** | HR tools for APP and WAIS attendance records |
| **APP ADMIN** | Admin dashboard, read-only Employees, and Exemption Approvals |
| **WAIS ADMIN** | Admin dashboard, read-only Employees, and Exemption Approvals |

To sign in:

1. Open the HR Attendance System.
2. Select the correct account from the **Account** field.
3. Enter the account password.
4. Select **Remember me** if you are using an approved private device and want the session remembered.
5. Select **Sign In**.
6. Check that the sidebar shows the correct menu for your role.

If the password is incorrect, the system stays on the login page and shows an error. Never share or write a password in an attendance record, notification, or support message.

## 3. Roles and access

### HR access

HR users manage attendance records for employees from both APP and WAIS. HR can:

- manage the Employees master list;
- upload attendance files and export reports;
- view and add late records;
- submit exemption requests;
- record absences, manual undertime, and half-days;
- review system-generated undertime and half-day records;
- delete and restore supported records through the Recycle Bin.

HR cannot approve or decline exemption requests.

### Admin access

Admin users can:

- monitor the Dashboard;
- view the Employees master list without changing employee records;
- view pending exemption requests;
- approve or decline exemptions;
- view Approval History.

Admin cannot upload attendance, export reports, manage employees, or create, edit, delete, and restore HR attendance records.

## 4. Dashboard

### Using the HR Dashboard

1. Open **Dashboard** from the sidebar.
2. Choose a month or date filter to set the report scope.
3. Review **Needs Attention**, key metrics, supporting metrics, late activity, top employees, and memo reminders.
4. Use the attendance upload and report tools when needed.
5. Review **Uploaded Attendance Files** or **File History** after an upload.
6. Confirm that totals and lists change when you select a different date or month.

### Using the Admin Dashboard

1. Open **Dashboard**.
2. Choose a month or date filter.
3. Review **Needs Attention**, attendance metrics, late activity analysis, top employees, and memo reminders.
4. Use the information to identify records that need review.

The Admin Dashboard does not show attendance upload, import, export, file history, or file deletion controls.

## 5. Employees

### Viewing the master list

1. Open **Employees**.
2. Use **All**, **APP**, or **WAIS** to filter by company.
3. Use **Active**, **Inactive**, or **All** to filter by employee status.
4. Use the search field to find an employee by name, company, department, or position.
5. Review the attendance counts shown for each employee.

The **Undertime** column shows the number of current generated and manual undertime records. For example, `3` means three undertime records. A dash (`—`) means no record in the selected scope.

### Managing employees as HR

1. Select **Add Employee** to create an employee record.
2. Complete the required employee information.
3. Save the form.
4. Use **Edit** to update an existing employee.
5. Use **Deactivate** when an employee should no longer appear in active employee selectors.
6. Use **Restore** on an inactive employee to make the employee active again.

Deactivation keeps the employee's existing attendance history.

Admin users see **View only** and do not have employee-management actions.

## 6. Late Records and Manual Late

### Reviewing late records

1. Open **Late Records**.
2. Use the available filters or search to find an employee or date.
3. Review the employee name, attendance date, time in, and minutes late.
4. If a late record represents undertime, select **Mark as Undertime**.
5. Review the suggested undertime information and confirm the action.

### Adding a Manual Late

1. Select **Add Manual Late**.
2. Type part of the employee's name.
3. Select the active employee from the results. A typed name that was not selected cannot be saved.
4. Enter the work date and time in.
5. Review or enter the official start time and grace period shown in the form.
6. Enter a reason if required.
7. Review the calculated late result.
8. Select **Save Manual Late**.

Deleting a manual late moves that record to the Recycle Bin, where the same record can be restored.

## 7. Exemptions

An exemption is a request to exclude one exact late record after Admin approval.

### Submitting an exemption request

1. Sign in with an HR account.
2. Open **Exemptions**.
3. In **Employee Name**, type part of the name and select an active employee.
4. Select the attendance date.
5. In **Matching Late Record**, select the exact late arrival for that employee and date.
6. Enter the optional reported time if it is needed. This field may be left blank.
7. In **Informed to**, select a listed person or add an allowed custom name.
8. Enter the reason for the exemption.
9. Select **Submit for Approval**.
10. Confirm that the request appears with a **Pending** status.

Example: If an employee has a late record at 8:24:37 AM, select that exact record. Approval affects that linked record only.

### Exemption statuses

- **Pending:** The linked late remains visible and counted while waiting for Admin review.
- **Approved:** Only the exact linked late is excluded from active Late Records and late totals.
- **Declined:** The linked late remains visible and counted.

### Restoring an approved late record

An approved exemption may show **Restore Late Record**.

1. Find the approved exemption.
2. Select **Restore Late Record**.
3. Confirm the action.
4. Check that the exact linked late appears and is counted again in Late Records.
5. Confirm that the exemption remains in history with a Late Record Restored update.

A declined exemption does not show this action because its late record is already counted.

Selecting **Delete** moves the exemption itself to the Recycle Bin. Restoring a late record does not delete or duplicate the exemption.

## 8. Admin Approvals and Approval History

### Reviewing a pending exemption

1. Sign in as APP ADMIN or WAIS ADMIN.
2. Open **Approvals**.
3. Find the request under **Pending exemptions**.
4. Review the employee, attendance date, linked late time, late minutes, reason, and informed people.
5. Enter an optional review remark.
6. Select **Approve** or **Decline**.
7. Wait for the success message and refreshed list.
8. Confirm that the request leaves the Pending section and appears in Approval History.

Either Admin account may review APP or WAIS requests. A user cannot approve their own request.

### Viewing Approval History

1. Stay on the **Approvals** page.
2. Go to **Approval History**.
3. Review completed requests, with the newest review shown first.
4. Check the employee, date, linked late details, decision, reviewer, review date and time, informed people, and remarks.
5. Look for **Late Record Restored** if HR restored the linked late after approval.

Approval History is read-only.

## 9. Notifications

1. Select the bell icon in the top header.
2. Review **Exemption updates** separately from ordinary late or memo notifications.
3. Admin users see pending exemption items that need review.
4. HR users see **Approved**, **Declined**, and **Late Record Restored** updates for their exemption requests.
5. Review the employee, attendance date, late time, status, and update time.

Notifications update during a normal refresh or page reload. The system does not claim instant push or real-time delivery.

## 10. Absences

1. Open **Absences**.
2. Type part of the employee's name and select an active employee.
3. Select the absence date.
4. Enter the reason.
5. Save the absence.
6. Confirm that it appears under **Saved Absence Records**.

Absences do not require Admin approval. The system blocks a duplicate absence for the same employee and date.

To remove an absence, select **Delete** and confirm. The same absence appears in the Recycle Bin and can be restored once without creating a duplicate.

## 11. Undertime

### System Generated Undertime

System-generated undertime comes from processed attendance uploads.

1. Open **Undertime**.
2. Review **System Generated Undertime**.
3. Check the employee, date, time, source file, and duration when available.
4. Use the current date or month scope to review the correct records.

### Adding Manual Undertime

1. Go to **Add Undertime**.
2. Type and select an active employee.
3. Select the date.
4. Enter the **From** time.
5. Enter the **To** time. It must be later than From.
6. Review the read-only calculated duration, such as `1 hour 59 minutes`.
7. In **Informed to**, select a listed person or type a custom name, then add it.
8. Remove an incorrect informed-person chip by selecting its `×`.
9. Enter the reason.
10. Save the record.

Manual undertime does not require Admin approval. The system blocks another manual undertime for the same employee and date.

Deleting manual undertime moves the existing row to the Recycle Bin. Restoring it returns the same row and does not insert a duplicate.

## 12. Half-Day

Half-Day is a separate attendance record. It is not a late record or exemption and does not require Admin approval.

1. Open **Half-Day**.
2. Select an active employee.
3. Select a Monday-to-Saturday date.
4. Select **Morning absent** or **Afternoon absent**.
5. Review the scheduled absence shown by the system.
6. Enter the reason.
7. Select **Save Half-Day**.
8. Confirm that the record appears under **Saved Half-Days**.

### Half-Day schedules

| Day | Morning absent | Afternoon absent |
|---|---|---|
| Monday–Friday | 8:00 AM–12:00 PM | 1:00 PM–5:00 PM |
| Saturday | 7:00 AM–11:00 AM | 11:00 AM–3:15 PM |
| Sunday | No normal schedule | No normal schedule |

The page displays schedules using 12-hour time.

### Generated attendance boundaries

- Monday–Friday: a time from exactly 12:00 PM through 1:00 PM is classified as Half-Day, not Undertime.
- Saturday: exactly 11:00 AM is classified as Half-Day.
- Saturday: 11:01 AM remains exactly one minute of Undertime.

The generated flow avoids creating both a Half-Day and Undertime record for the same employee, date, and source situation.

Deleting a Half-Day moves the same record to the Recycle Bin. Restoring it returns the record to Saved Half-Days without duplication.

## 13. Recycle Bin

The Recycle Bin contains deleted uploaded-file batches and supported HR records.

### Restoring an uploaded file

1. Open **Recycle Bin**.
2. Find the file under **Deleted Uploaded Files**.
3. Select **Restore**.
4. Confirm the action.
5. The file and related generated late or undertime records deleted with that batch return to their pages.

### Restoring an HR record

1. Find the item under **Deleted HR Manual Records**.
2. Check its type, employee, date, and reason.
3. Select **Restore**.
4. Confirm the action.
5. The same Exemption, Absence, Manual Undertime, Manual Late, or Half-Day record returns to its correct page.

Recycle Bin Restore does not create a second copy of the record.

Restoring a deleted exemption is different from **Restore Late Record**. Recycle Bin Restore returns the deleted exemption itself. Restore Late Record makes an approved exemption's linked late count again while keeping the exemption in history.

**Remove from Recycle Bin** hides the item from the app's Recycle Bin. It is not presented as permanent physical database deletion.

## 14. Attendance uploads

Attendance upload and file management are available to HR users.

1. Open the HR **Dashboard**.
2. Find **Upload Attendance**.
3. Choose or drag and drop the supported Excel attendance file.
4. Wait for processing to finish.
5. Review the result and any message shown by the system.
6. Check **Uploaded Attendance Files** or **File History**.
7. Review the generated Late, Undertime, and Half-Day records.

### Duplicate filename protection

The system blocks an attendance file when the same filename has already been uploaded.

If this happens:

1. Review File History to confirm that the file is already present.
2. Check whether you selected the correct source file.
3. Do not rename a duplicate merely to bypass the warning without first checking its contents.

Deleting an uploaded attendance file moves the file and its related generated records to the Recycle Bin as one batch.

## 15. Searchable fields

### Employee Name

Attendance forms use searchable employee selectors.

1. Type part of the employee's name.
2. Review the filtered results.
3. Select the correct employee.
4. Continue completing the form.

The field includes active APP and WAIS employees. An unknown typed name that was not selected from the results cannot be saved.

### Informed to

The Exemptions and Manual Undertime forms provide a searchable **Informed to** field.

1. Type to find **Sir Gatch**, **Ma'am Chona**, or **HR Louissa**.
2. Select the person, or enter a custom name where the form allows it.
3. The selected name appears as a chip.
4. Add more names if needed.
5. Select `×` to remove an incorrect name.

## 16. Key attendance rules

1. **Exact exemption link:** Every new exemption must link to one exact active late record for the selected employee and date.
2. **Pending:** A pending exemption does not remove the late from Late Records.
3. **Approved:** Approval excludes only the exact linked late.
4. **Declined:** Declining leaves the linked late visible and counted.
5. **Restored late:** Restore Late Record makes the exact linked late count again while retaining the approved exemption history.
6. **No approval for other records:** Absence, Undertime, and Half-Day records do not require Admin approval.
7. **Valid time ranges:** Manual Undertime requires To to be later than From. Half-Day follows the displayed weekday and Saturday schedules.
8. **Active employee required:** New attendance records must use a selected active employee.
9. **Duplicate protection:** The system checks for duplicate exemption links, absence records, manual undertime records, generated attendance records, and uploaded filenames in their supported workflows.
10. **Role protection:** HR performs attendance entry and management. Admin performs exemption review.

## 17. Common issues and simple fixes

### Sign-in fails

- Check that you selected the correct account.
- Re-enter the password carefully.
- Check the internet connection.
- If the problem continues, report the account label and time of the error. Do not send the password.

### Employee does not appear in search

- Check the spelling.
- Confirm that the employee is active.
- Open Employees and select **Refresh**.

### Exemptions says “No eligible late record”

- Confirm the selected employee and exact attendance date.
- Check that an active uploaded late exists in Late Records.
- The late may already be linked to a pending or approved exemption.
- Select the employee and date again, then choose the exact late record.

### Submit for Approval is disabled

- Select a Matching Late Record.
- Enter a reason.
- Add at least one informed person.

### A duplicate-record message appears

- Refresh the page.
- Search for an existing record for the same employee and date or late-record link.
- Use the existing record if it is the correct entry.

### Manual Undertime will not save

- Make sure To is later than From.
- Check the displayed duration.
- Confirm that an undertime does not already exist for the employee and date.

### Half-Day date is rejected

- Choose a Monday-to-Saturday date.
- Sunday has no normal Half-Day schedule.

### A saved list did not update

- Select **Refresh** if available.
- Reload the page.
- Check the internet connection.
- If a success message appeared, check the list before selecting Save again.

### Approve or Decline fails

- Refresh Approvals.
- Confirm that the request is still Pending.
- Confirm that it has an exact linked late record.
- Confirm that you are signed in as Admin.
- If it still fails, record the employee, date, selected action, and exact error message.

## 18. Daily HR workflow

1. Sign in with the correct HR account.
2. Open Dashboard and select the date or month to review.
3. Upload the new attendance file when one is available.
4. Review the upload result and File History.
5. Check Late Records and generated Undertime or Half-Day records.
6. Add any required Manual Late, Absence, Manual Undertime, or Half-Day record.
7. Submit linked exemptions for valid late records that need Admin review.
8. Check the notification bell for Approved, Declined, or Late Record Restored updates.
9. Review employee counts and memo reminders.
10. Use the Recycle Bin to correct an accidental deletion when needed.
11. Refresh important pages before signing out and confirm that saved entries remain visible.

## 19. Daily Admin workflow

1. Sign in with the correct Admin account.
2. Open Dashboard and select the report scope.
3. Review Needs Attention, attendance metrics, late activity, top employees, and memo reminders.
4. Check the notification bell for pending exemptions.
5. Open Approvals.
6. Review each request's employee, date, linked late, reason, and informed people.
7. Enter an optional review remark.
8. Select Approve or Decline.
9. Confirm that the request moves from Pending exemptions to Approval History.
10. Use Employees as a read-only reference when needed.
11. Sign out after completing the reviews.

## 20. Deployment smoke-test checklist

After deployment, perform these short checks using approved accounts and records:

- [ ] The production login page loads without an unexpected error.
- [ ] APP HR, WAIS HR, APP ADMIN, and WAIS ADMIN appear as login choices.
- [ ] An HR account can sign in and sees the correct HR menus.
- [ ] An Admin account can sign in and sees Dashboard, Employees, and Approvals.
- [ ] HR cannot open Approvals through direct navigation.
- [ ] Admin cannot open HR data-entry pages through direct navigation.
- [ ] Dashboard filters and visible metrics update correctly.
- [ ] Admin Dashboard has no upload, export, or file-management actions.
- [ ] Admin Employees is read-only.
- [ ] Searchable Employee and Informed to fields work.
- [ ] HR can submit a valid linked exemption as Pending.
- [ ] Admin can Approve and Decline a pending exemption.
- [ ] The completed request remains in Approval History.
- [ ] Approved and Declined statuses affect the exact linked late correctly.
- [ ] Notifications show the expected exemption updates.
- [ ] Absence, Manual Undertime, and Half-Day validations work.
- [ ] Half-Day schedules display in 12-hour time.
- [ ] Delete and Restore return the same supported record without duplication.
- [ ] Attendance upload works and duplicate filename protection appears when expected.
- [ ] Saved information remains after a normal page refresh.
- [ ] Main pages remain usable at desktop and mobile widths.

If a check fails, record the account role, page, employee or date used, exact steps, expected result, actual result, and a screenshot if company procedure permits it.
