-- =====================================================================
-- 005: Manual late records.
--
-- Adds a new table for HR-entered late records that are saved as
-- first-class late arrivals, independent of any uploaded Excel file.
-- Used when an employee's late arrival must be logged without a
-- biometric upload.
--
-- Carries the same soft-delete + recycle-bin bookkeeping columns used
-- by the other attendance tables (see migrations 003 and 004).
--
-- Run this in Supabase SQL Editor after 001, 002, 003, and 004.
-- Safe to re-run: every statement uses IF NOT EXISTS guards.
-- =====================================================================

create table if not exists public.manual_late_records (
  id                            uuid primary key default gen_random_uuid(),
  workspace                     text not null,
  employee_name                 text not null,
  work_date                     date not null,
  time_in                       text not null,
  official_start_time           text,
  grace_minutes                 integer not null default 6,
  minutes_late                  integer not null default 0,
  seconds_late                  integer not null default 0,
  total_seconds_late            integer not null default 0,
  reason                        text,
  source_type                   text not null default 'manual-entry',
  created_at                    timestamptz not null default now(),
  created_by                    uuid references auth.users(id) on delete set null,

  -- Soft-delete + recycle-bin bookkeeping (matches migrations 003 / 004).
  is_deleted                    boolean not null default false,
  deleted_at                    timestamptz,
  deleted_by                    uuid references auth.users(id) on delete set null,
  restored_at                   timestamptz,
  restored_by                   uuid references auth.users(id) on delete set null,
  deleted_batch_id              uuid,
  deleted_reason                text,
  removed_from_recycle_bin      boolean not null default false,
  removed_from_recycle_bin_at   timestamptz,
  removed_from_recycle_bin_by   uuid references auth.users(id) on delete set null
);

create index if not exists manual_late_records_ws_date_active_idx
  on public.manual_late_records (workspace, work_date, is_deleted);

create index if not exists manual_late_records_ws_emp_date_active_idx
  on public.manual_late_records (workspace, employee_name, work_date, is_deleted);

create index if not exists manual_late_records_recycle_bin_visible_idx
  on public.manual_late_records (workspace, is_deleted, removed_from_recycle_bin);
