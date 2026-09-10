-- Forward-only legacy classification correction. NOT APPLIED.
-- Converts only active upload-derived weekday undertimes from 11:51 AM
-- through 1:00 PM into a single active Morning Absent Half-Day.
begin;

alter table public.half_day_records
  add column if not exists source_time_in time,
  add column if not exists source_generated_undertime_id text,
  add column if not exists source_file_id_text text,
  add column if not exists classification_migrated_at timestamptz;

create unique index if not exists half_day_source_generated_undertime_uidx
  on public.half_day_records(source_generated_undertime_id)
  where source_generated_undertime_id is not null;

-- A database migration has no signed-in auth user. Keep created_by for all
-- application-created rows, while allowing legacy rows to preserve their
-- original generated timestamp without inventing an acting user.
alter table public.half_day_records alter column created_by drop not null;

with candidates as (
  select
    u.id,
    u.workspace,
    u.employee_name,
    u.work_date,
    u.time_in::time as source_time_in,
    u.source_file_id,
    u.source_file_name,
    u.created_at,
    e.id as employee_id,
    row_number() over (
      partition by e.id, u.work_date
      order by u.time_in::time, u.id
    ) as source_rank
  from public.generated_undertimes u
  join public.employees e
    on e.workspace = u.workspace
   and not e.is_deleted
   and e.employment_status = 'active'
   and public.employee_name_key(e.full_name) = public.employee_name_key(u.employee_name)
  where not u.is_deleted
    and u.source_file_id is not null
    and nullif(btrim(u.source_file_name), '') is not null
    and extract(isodow from u.work_date) between 1 and 5
    and u.time_in::time between time '11:51:00' and time '13:00:59.999999'
), inserted as (
  insert into public.half_day_records (
    workspace,
    employee_id,
    employee_name,
    work_date,
    absent_period,
    scheduled_start,
    scheduled_end,
    reason,
    created_by,
    created_at,
    source_type,
    source_file_name,
    source_time_in,
    source_generated_undertime_id,
    source_file_id_text,
    classification_migrated_at,
    is_deleted
  )
  select
    c.workspace,
    c.employee_id,
    c.employee_name,
    c.work_date,
    'morning',
    time '08:00',
    time '12:00',
    'Generated from attendance upload',
    null,
    coalesce(c.created_at, now()),
    'attendance_upload',
    c.source_file_name,
    c.source_time_in,
    c.id::text,
    c.source_file_id::text,
    now(),
    false
  from candidates c
  where c.source_rank = 1
  on conflict (employee_id, work_date, absent_period) do update
    set source_type = 'attendance_upload',
        source_file_name = excluded.source_file_name,
        source_time_in = excluded.source_time_in,
        source_generated_undertime_id = excluded.source_generated_undertime_id,
        source_file_id_text = excluded.source_file_id_text,
        classification_migrated_at = coalesce(public.half_day_records.classification_migrated_at, now()),
        is_deleted = false,
        removed_from_recycle_bin = false
  where public.half_day_records.source_type = 'attendance_upload'
    and public.half_day_records.source_file_name is not distinct from excluded.source_file_name
  returning source_generated_undertime_id
)
update public.generated_undertimes u
set is_deleted = true,
    deleted_at = coalesce(u.deleted_at, now()),
    deleted_reason = 'reclassified_as_half_day'
where not u.is_deleted
  and exists (
    select 1
    from public.half_day_records h
    where not h.is_deleted
      and h.source_type = 'attendance_upload'
      and h.source_generated_undertime_id = u.id::text
  );

commit;
