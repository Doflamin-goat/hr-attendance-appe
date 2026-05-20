-- =====================================================================
-- Soft-delete / recycle bin support for the HR Attendance System.
--
-- Adds is_deleted + bookkeeping columns to every attendance table so the
-- app can move records to "Trash" instead of hard-deleting, and restore
-- them later from the Recycle Bin page.
--
-- Run this in Supabase SQL Editor after 001 and 002.
-- Safe to re-run: every statement uses IF NOT EXISTS / IF EXISTS guards.
-- =====================================================================

-- 1. Add soft-delete columns to every attendance table.
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
    -- Only act if the table actually exists in this Supabase project.
    if to_regclass(format('public.%I', attendance_table)) is not null then
      execute format($f$
        alter table public.%I
          add column if not exists is_deleted       boolean not null default false,
          add column if not exists deleted_at       timestamptz,
          add column if not exists deleted_by       uuid references auth.users(id) on delete set null,
          add column if not exists restored_at      timestamptz,
          add column if not exists restored_by      uuid references auth.users(id) on delete set null,
          add column if not exists deleted_batch_id uuid,
          add column if not exists deleted_reason   text
      $f$, attendance_table);
    end if;
  end loop;
end$$;

-- 2. Optional storage_path on uploaded_files so the raw .xlsx can be
--    kept in Supabase Storage (bucket "attendance-files"). Nullable —
--    older rows without a backup keep working unchanged.
do $$
begin
  if to_regclass('public.uploaded_files') is not null then
    alter table public.uploaded_files
      add column if not exists storage_path text;
  end if;
end$$;

-- 3. Indexes to keep "active" reads cheap and Trash queries fast.
do $$
begin
  if to_regclass('public.uploaded_files') is not null then
    create index if not exists uploaded_files_workspace_is_deleted_idx
      on public.uploaded_files (workspace, is_deleted);
    create index if not exists uploaded_files_deleted_at_idx
      on public.uploaded_files (deleted_at);
    create index if not exists uploaded_files_deleted_batch_id_idx
      on public.uploaded_files (deleted_batch_id);
  end if;

  if to_regclass('public.late_records') is not null then
    create index if not exists late_records_workspace_is_deleted_idx
      on public.late_records (workspace, is_deleted);
    create index if not exists late_records_deleted_at_idx
      on public.late_records (deleted_at);
    create index if not exists late_records_source_file_id_idx
      on public.late_records (source_file_id);
    create index if not exists late_records_deleted_batch_id_idx
      on public.late_records (deleted_batch_id);
  end if;

  if to_regclass('public.generated_undertimes') is not null then
    create index if not exists generated_undertimes_workspace_is_deleted_idx
      on public.generated_undertimes (workspace, is_deleted);
    create index if not exists generated_undertimes_deleted_at_idx
      on public.generated_undertimes (deleted_at);
    create index if not exists generated_undertimes_source_file_id_idx
      on public.generated_undertimes (source_file_id);
    create index if not exists generated_undertimes_deleted_batch_id_idx
      on public.generated_undertimes (deleted_batch_id);
  end if;

  if to_regclass('public.exemptions') is not null then
    create index if not exists exemptions_workspace_is_deleted_idx
      on public.exemptions (workspace, is_deleted);
    create index if not exists exemptions_deleted_at_idx
      on public.exemptions (deleted_at);
    create index if not exists exemptions_deleted_batch_id_idx
      on public.exemptions (deleted_batch_id);
  end if;

  if to_regclass('public.absences') is not null then
    create index if not exists absences_workspace_is_deleted_idx
      on public.absences (workspace, is_deleted);
    create index if not exists absences_deleted_at_idx
      on public.absences (deleted_at);
    create index if not exists absences_deleted_batch_id_idx
      on public.absences (deleted_batch_id);
  end if;

  if to_regclass('public.manual_undertimes') is not null then
    create index if not exists manual_undertimes_workspace_is_deleted_idx
      on public.manual_undertimes (workspace, is_deleted);
    create index if not exists manual_undertimes_deleted_at_idx
      on public.manual_undertimes (deleted_at);
    create index if not exists manual_undertimes_deleted_batch_id_idx
      on public.manual_undertimes (deleted_batch_id);
  end if;

  if to_regclass('public.memo_reads') is not null then
    create index if not exists memo_reads_workspace_is_deleted_idx
      on public.memo_reads (workspace, is_deleted);
    create index if not exists memo_reads_deleted_at_idx
      on public.memo_reads (deleted_at);
  end if;
end$$;

-- =====================================================================
-- NOTE: After running this migration, optionally create a Storage
-- bucket called "attendance-files" in the Supabase dashboard
-- (Storage -> New bucket). Recommended settings:
--   name:           attendance-files
--   public:         OFF (private)
--   file size limit: ~10 MB
-- Then add a policy allowing authenticated users to read/write objects
-- in that bucket. The app will still work without the bucket — uploaded
-- files just won't be backed up to Storage and uploaded_files.storage_path
-- will stay NULL.
-- =====================================================================
