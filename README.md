# WATTS APP

WATTS APP is an internal HR Attendance Management System for APP Electric Corporation used to manage employee attendance, attendance exceptions, absences, leave, approvals, employee records, and HR reporting across APP and WAIS employees.

## Overview

The application centralizes attendance operations for APP Electric Corporation. It supports APP and WAIS employee records and separates HR data-entry workflows from Admin review workflows through role-based access.

Public information pages provide a concise About overview, Privacy Policy, and administrator Contact guidance without exposing private contact details.

## Features

### HR

- Attendance dashboard with date and month scopes
- Employee Master for APP and WAIS employees
- Excel attendance upload and uploaded-file history
- Late Records and manual late entry
- Exemption submission and history
- Absence entry, filtering, and record history
- Leave requests, Annual Leave Registry, Remaining Leave management, and leave history
- Manual and generated Undertime records
- Manual and attendance-generated Half-Day records
- Recycle Bin and supported record restoration
- Excel exports and attendance reports
- Memo alerts and approval notifications

### Admin

- Attendance dashboard and employee visibility
- Pending Exemption review with Approve and Decline actions
- Searchable Exemption Approval History
- Leave approval and rejection
- Read-only Annual Leave Registry and leave history
- Read-only Absence Records
- Pending approval and decision notifications

Access is role-based so HR maintenance actions and Admin approval actions remain intentionally separated.

## Leave Management

- Annual entitlement is 5 days or 40 working hours.
- HR submits leave requests for Admin approval.
- Pending leave does not deduct from the available balance.
- Approved leave deducts from the balance.
- Rejected and cancelled leave does not deduct from the balance.
- HR can maintain an employee's current Remaining Leave for a selected calendar year.
- Leave history and adjustment activity are retained for operational tracking and audit purposes.

## Exemption Workflow

HR submits and maintains applicable attendance exemption records. Admin reviews Pending exemptions and can Approve or Decline each request. Approval History includes both outcomes and can be searched by employee name.

## Technology Stack

- React 19 and React Router
- TypeScript
- Vite
- Tailwind CSS
- Supabase and PostgreSQL
- ExcelJS and SheetJS for spreadsheet workflows
- Recharts
- Vercel
- Git and GitHub

## Project Structure

```text
src/
  app/          Application routes
  components/   Shared UI and feature components
  context/      Authentication, attendance, employee, and theme state
  pages/        HR and Admin screens
  services/     Supabase and application data services
  utils/        Attendance, leave, export, and formatting rules

supabase/
  migrations/   Forward database migrations and protected workflows

tests/          Focused regression tests
public/         Static assets and templates
```

## Local Development

Install dependencies and start the Vite development server:

```bash
npm install
npm run dev
```

Available verification commands:

```bash
npm run test:focused
npm run build
npm run lint
```

Use `npm run preview` to preview a completed production build locally.

## Environment Variables

The application uses these environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Store local values in the appropriate `.env` file. Do not commit credentials or environment-specific secrets.

## Deployment

WATTS APP is deployed through Vercel. Configure the required environment variables in the deployment environment and use the repository's Vercel configuration for application routing.

## Testing

Run `npm run test:focused` for the focused attendance and role regression suite. Run `npm run build` to perform TypeScript compilation and create the production Vite bundle.

## Security / Access

WATTS APP is an authenticated internal application. HR and Admin roles have separate responsibilities, while Supabase-backed access controls protect application data and workflows.

## Creator

Created by **Nathaniel**

Built with care for **APP Electric Corporation**.

Support the creator ☕

## Notes

WATTS APP is an internal business application intended for authorized APP Electric Corporation personnel.
