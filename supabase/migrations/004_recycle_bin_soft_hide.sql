-- =====================================================================
-- Recycle Bin "soft hide" support.
--
-- Adds removed_from_recycle_bin bookkeeping columns to every attendance
-- table. A record that is in Trash (is_deleted = true) can be additionally
-- hidden from the Recycle Bin UI by setting removed_from_recycle_bin = true.
-- The row is never hard-deleted, so an admin can still recover it from the
-- database in an emergency.
--
-- Run this in Supabase SQL Editor after 001, 002, and 003.
-- Safe to re-run.
-- =====================================================================

do $$
declare
  attendance_table text;
  attendance_tables text[] := array[
    'uploaded_files',
    'late_records',
    'generated_undertimes',
    'exemptions',
    'absences',
    'manual_undertimes',
    'memo_reads'
  ];
begin
  foreach attendance_table in array attendance_tables loop
    if to_regclass(format('public.%I', attendance_table)) is not null then
      execute format($f$
        alter table public.%I
          add column if not exists removed_from_recycle_bin    boolean not null default false,
          add column if not exists removed_from_recycle_bin_at timestamptz,
          add column if not exists removed_from_recycle_bin_by uuid references auth.users(id) on delete set null
      $f$, attendance_table);
    end if;
  end loop;
end$$;

-- Indexes to keep Recycle Bin queries fast: only rows that are still
-- visible in the bin (is_deleted = true AND removed_from_recycle_bin = false).
do $$
begin
  if to_regclass('public.uploaded_files') is not null then
    create index if not exists uploaded_files_recycle_bin_visible_idx
      on public.uploaded_files (workspace, is_deleted, removed_from_recycle_bin);
  end if;

  if to_regclass('public.late_records') is not null then
    create index if not exists late_records_recycle_bin_visible_idx
      on public.late_records (workspace, is_deleted, removed_from_recycle_bin);
  end if;

  if to_regclass('public.generated_undertimes') is not null then
    create index if not exists generated_undertimes_recycle_bin_visible_idx
      on public.generated_undertimes (workspace, is_deleted, removed_from_recycle_bin);
  end if;

  if to_regclass('public.exemptions') is not null then
    create index if not exists exemptions_recycle_bin_visible_idx
      on public.exemptions (workspace, is_deleted, removed_from_recycle_bin);
  end if;

  if to_regclass('public.absences') is not null then
    create index if not exists absences_recycle_bin_visible_idx
      on public.absences (workspace, is_deleted, removed_from_recycle_bin);
  end if;

  if to_regclass('public.manual_undertimes') is not null then
    create index if not exists manual_undertimes_recycle_bin_visible_idx
      on public.manual_undertimes (workspace, is_deleted, removed_from_recycle_bin);
  end if;

  if to_regclass('public.memo_reads') is not null then
    create index if not exists memo_reads_recycle_bin_visible_idx
      on public.memo_reads (workspace, is_deleted, removed_from_recycle_bin);
  end if;
end$$;
