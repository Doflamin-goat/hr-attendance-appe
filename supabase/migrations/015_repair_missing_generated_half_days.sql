-- Forward-only repair for missing generated Half-Days. NOT APPLIED.
-- Creates the missing generated row before retiring its exact source Undertime.
-- Active Manual Half-Days are preserved and intentionally block automatic repair.
--
-- READ-ONLY PREFLIGHT
-- select u.id, u.workspace, u.employee_name, u.work_date, u.time_in,
--        u.source_file_id, u.source_file_name, e.id as employee_id,
--        e.employment_status,
--        exists (
--          select 1 from public.half_day_records h
--          where not h.is_deleted and h.employee_id=e.id
--            and h.work_date=u.work_date and h.absent_period='morning'
--            and h.source_type='manual'
--        ) as blocked_by_manual_half_day
-- from public.generated_undertimes u
-- join public.employees e
--   on e.workspace=u.workspace and not e.is_deleted
--  and public.employee_name_key(e.full_name)=public.employee_name_key(u.employee_name)
-- where not u.is_deleted
--   and u.source_file_id is not null
--   and nullif(btrim(u.source_file_name),'') is not null
--   and extract(isodow from u.work_date) between 1 and 5
--   and u.time_in::time between time '11:51:00' and time '13:00:59.999999'
-- order by u.work_date,u.employee_name,u.time_in;
--
-- READ-ONLY VERIFICATION (expected result: zero actionable rows)
-- select u.id, u.workspace, u.employee_name, u.work_date, u.time_in,
--        case
--          when exists (
--            select 1 from public.half_day_records h
--            where not h.is_deleted and h.employee_id=e.id
--              and h.work_date=u.work_date and h.absent_period='morning'
--              and h.source_type='manual'
--          ) then 'preserved_manual_conflict'
--          when exists (
--            select 1 from public.half_day_records h
--            where not h.is_deleted and h.source_type='attendance_upload'
--              and h.source_generated_undertime_id=u.id::text
--          ) then 'duplicate_active_classification'
--          else 'missing_generated_half_day'
--        end as issue
-- from public.generated_undertimes u
-- join public.employees e
--   on e.workspace=u.workspace and not e.is_deleted
--  and public.employee_name_key(e.full_name)=public.employee_name_key(u.employee_name)
-- where not u.is_deleted
--   and u.source_file_id is not null
--   and nullif(btrim(u.source_file_name),'') is not null
--   and extract(isodow from u.work_date) between 1 and 5
--   and u.time_in::time between time '11:51:00' and time '13:00:59.999999'
--   and not exists (
--     select 1 from public.half_day_records h
--     where not h.is_deleted and h.employee_id=e.id
--       and h.work_date=u.work_date and h.absent_period='morning'
--       and h.source_type='manual'
--   );

begin;

with candidates as (
  select distinct on (u.id)
    u.id as generated_undertime_id,
    u.workspace,
    u.employee_name,
    u.work_date,
    u.time_in::time as source_time_in,
    u.source_file_id,
    u.source_file_name,
    u.created_at,
    e.id as employee_id
  from public.generated_undertimes u
  join public.employees e
    on e.workspace = u.workspace
   and not e.is_deleted
   and public.employee_name_key(e.full_name) = public.employee_name_key(u.employee_name)
  where not u.is_deleted
    and u.source_file_id is not null
    and nullif(btrim(u.source_file_name), '') is not null
    and extract(isodow from u.work_date) between 1 and 5
    and u.time_in::time between time '11:51:00' and time '13:00:59.999999'
    and not exists (
      select 1
      from public.half_day_records h
      where not h.is_deleted
        and h.source_type = 'attendance_upload'
        and (
          h.source_generated_undertime_id = u.id::text
          or (
            h.employee_id = e.id
            and h.work_date = u.work_date
            and h.absent_period = 'morning'
            and h.source_time_in = u.time_in::time
            and (
              h.source_file_id_text = u.source_file_id::text
              or h.source_file_name is not distinct from u.source_file_name
            )
          )
        )
    )
    and not exists (
      select 1
      from public.half_day_records h
      where not h.is_deleted
        and h.source_type = 'manual'
        and h.employee_id = e.id
        and h.work_date = u.work_date
        and h.absent_period = 'morning'
    )
  order by u.id, e.created_at, e.id
), inserted as (
  insert into public.half_day_records (
    workspace, employee_id, employee_name, work_date, absent_period,
    scheduled_start, scheduled_end, reason, created_by, created_at,
    source_type, source_file_name, source_time_in,
    source_generated_undertime_id, source_file_id_text,
    classification_migrated_at, is_deleted
  )
  select
    c.workspace, c.employee_id, c.employee_name, c.work_date, 'morning',
    time '08:00', time '12:00', 'Generated from attendance upload', null,
    coalesce(c.created_at, now()), 'attendance_upload', c.source_file_name,
    c.source_time_in, c.generated_undertime_id::text,
    c.source_file_id::text, now(), false
  from candidates c
  on conflict (employee_id, work_date, absent_period) do update
    set workspace = excluded.workspace,
        employee_name = excluded.employee_name,
        scheduled_start = excluded.scheduled_start,
        scheduled_end = excluded.scheduled_end,
        reason = excluded.reason,
        source_file_name = excluded.source_file_name,
        source_time_in = excluded.source_time_in,
        source_generated_undertime_id = excluded.source_generated_undertime_id,
        source_file_id_text = excluded.source_file_id_text,
        created_at = excluded.created_at,
        classification_migrated_at = coalesce(public.half_day_records.classification_migrated_at, now()),
        is_deleted = false,
        removed_from_recycle_bin = false
  where public.half_day_records.source_type = 'attendance_upload'
  returning source_generated_undertime_id
)
update public.generated_undertimes u
set is_deleted = true,
    deleted_at = coalesce(u.deleted_at, now()),
    deleted_reason = 'reclassified_as_half_day'
where not u.is_deleted
  and u.id::text in (
    select i.source_generated_undertime_id
    from inserted i
    where i.source_generated_undertime_id is not null
  )
  and exists (
      select 1
      from public.half_day_records h
      where not h.is_deleted
        and h.source_type = 'attendance_upload'
        and h.source_generated_undertime_id = u.id::text
    );

commit;
