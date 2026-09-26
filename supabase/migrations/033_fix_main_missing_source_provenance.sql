-- Repair missing MAIN provenance and restore canonical daily attendance visibility.
-- Forward-only; do not apply automatically.
begin;

with missing_source_file_ids as (
  select d.id as daily_attendance_id,
         f.id as source_file_id
  from public.main_daily_attendance d
  join public.uploaded_files f
    on f.workspace = 'WAIS'
   and f.file_name = d.source_file_name
   and not f.is_deleted
  where d.workspace = 'WAIS'
    and d.source_file_id is null
    and d.source_file_name is not null
)
update public.main_daily_attendance d
set source_file_id = m.source_file_id,
    updated_at = now()
from missing_source_file_ids m
where d.id = m.daily_attendance_id
  and d.source_file_id is null;

insert into public.main_attendance_sources(daily_attendance_id, source_file_id)
select d.id, d.source_file_id
from public.main_daily_attendance d
where d.workspace = 'WAIS'
  and d.source_file_id is not null
on conflict (daily_attendance_id, source_file_id) do nothing;

commit;
