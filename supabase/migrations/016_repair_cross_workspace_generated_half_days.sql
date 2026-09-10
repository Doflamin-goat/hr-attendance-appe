-- Forward-only cross-workspace generated Half-Day repair. NOT APPLIED.
-- Resolves an employee globally only when exactly one non-deleted profile has
-- the normalized attendance name. The attendance row remains the authority
-- for the Half-Day workspace and source metadata.
--
-- READ-ONLY PREFLIGHT
-- with employee_matches as (
--   select u.id as generated_undertime_id, count(e.id) as employee_match_count,
--          min(e.id::text)::uuid as employee_id
--   from public.generated_undertimes u
--   left join public.employees e
--     on not e.is_deleted
--    and public.employee_name_key(e.full_name)=public.employee_name_key(u.employee_name)
--   where not u.is_deleted
--     and u.source_file_id is not null
--     and nullif(btrim(u.source_file_name),'') is not null
--     and extract(isodow from u.work_date) between 1 and 5
--     and u.work_date not between date '2026-03-01' and date '2026-03-31'
--     and u.time_in::time between time '11:51:00' and time '13:00:59.999999'
--   group by u.id
-- )
-- select u.id,u.workspace as attendance_workspace,u.employee_name,u.work_date,
--        u.time_in,u.source_file_id,u.source_file_name,m.employee_match_count,
--        e.workspace as employee_workspace,e.employment_status
-- from public.generated_undertimes u
-- join employee_matches m on m.generated_undertime_id=u.id
-- left join public.employees e on e.id=m.employee_id
-- where not u.is_deleted
-- order by u.work_date,u.employee_name,u.time_in;
--
-- READ-ONLY AMBIGUOUS-NAME DIAGNOSTIC (must be resolved manually; never guessed)
-- select u.id,u.workspace,u.employee_name,u.work_date,u.time_in,
--        count(e.id) as non_deleted_employee_matches,
--        array_agg(e.id order by e.id) as matching_employee_ids
-- from public.generated_undertimes u
-- join public.employees e
--   on not e.is_deleted
--  and public.employee_name_key(e.full_name)=public.employee_name_key(u.employee_name)
-- where not u.is_deleted
--   and u.source_file_id is not null
--   and nullif(btrim(u.source_file_name),'') is not null
--   and extract(isodow from u.work_date) between 1 and 5
--   and u.work_date not between date '2026-03-01' and date '2026-03-31'
--   and u.time_in::time between time '11:51:00' and time '13:00:59.999999'
-- group by u.id,u.workspace,u.employee_name,u.work_date,u.time_in
-- having count(e.id)>1;
--
-- READ-ONLY VERIFICATION (expected result: zero actionable rows)
-- with unique_employee as (
--   select u.id as generated_undertime_id,min(e.id::text)::uuid as employee_id
--   from public.generated_undertimes u
--   join public.employees e
--     on not e.is_deleted
--    and public.employee_name_key(e.full_name)=public.employee_name_key(u.employee_name)
--   where not u.is_deleted
--     and u.source_file_id is not null
--     and nullif(btrim(u.source_file_name),'') is not null
--     and extract(isodow from u.work_date) between 1 and 5
--     and u.work_date not between date '2026-03-01' and date '2026-03-31'
--     and u.time_in::time between time '11:51:00' and time '13:00:59.999999'
--   group by u.id having count(e.id)=1
-- )
-- select u.id,u.workspace,u.employee_name,u.work_date,u.time_in,
--        case when exists (
--          select 1 from public.half_day_records h
--          where not h.is_deleted and h.source_type='attendance_upload'
--            and h.source_generated_undertime_id=u.id::text
--        ) then 'duplicate_active_classification'
--        else 'missing_generated_half_day' end as issue
-- from public.generated_undertimes u
-- join unique_employee x on x.generated_undertime_id=u.id
-- where not exists (
--   select 1 from public.half_day_records h
--   where not h.is_deleted and h.source_type='manual'
--     and h.employee_id=x.employee_id and h.work_date=u.work_date
--     and h.absent_period='morning'
-- );

begin;

with employee_matches as (
  select
    u.id as generated_undertime_id,
    min(e.id::text)::uuid as employee_id,
    count(e.id) as employee_match_count
  from public.generated_undertimes u
  join public.employees e
    on not e.is_deleted
   and public.employee_name_key(e.full_name) = public.employee_name_key(u.employee_name)
  where not u.is_deleted
    and u.source_file_id is not null
    and nullif(btrim(u.source_file_name), '') is not null
    and extract(isodow from u.work_date) between 1 and 5
    and u.work_date not between date '2026-03-01' and date '2026-03-31'
    and u.time_in::time between time '11:51:00' and time '13:00:59.999999'
  group by u.id
  having count(e.id) = 1
), candidates as (
  select
    u.id as generated_undertime_id,
    u.workspace,
    u.employee_name,
    u.work_date,
    u.time_in::time as source_time_in,
    u.source_file_id,
    u.source_file_name,
    u.created_at,
    m.employee_id
  from public.generated_undertimes u
  join employee_matches m on m.generated_undertime_id = u.id
  where not exists (
    select 1
    from public.half_day_records h
    where not h.is_deleted
      and h.source_type = 'attendance_upload'
      and (
        h.source_generated_undertime_id = u.id::text
        or (
          h.employee_id = m.employee_id
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
      and h.employee_id = m.employee_id
      and h.work_date = u.work_date
      and h.absent_period = 'morning'
  )
), inserted as (
  insert into public.half_day_records (
    workspace,employee_id,employee_name,work_date,absent_period,
    scheduled_start,scheduled_end,reason,created_by,created_at,
    source_type,source_file_name,source_time_in,
    source_generated_undertime_id,source_file_id_text,
    classification_migrated_at,is_deleted
  )
  select
    c.workspace,c.employee_id,c.employee_name,c.work_date,'morning',
    time '08:00',time '12:00','Generated from attendance upload',null,
    coalesce(c.created_at,now()),'attendance_upload',c.source_file_name,
    c.source_time_in,c.generated_undertime_id::text,c.source_file_id::text,
    now(),false
  from candidates c
  on conflict (employee_id,work_date,absent_period) do update
    set workspace=excluded.workspace,
        employee_name=excluded.employee_name,
        scheduled_start=excluded.scheduled_start,
        scheduled_end=excluded.scheduled_end,
        reason=excluded.reason,
        created_at=excluded.created_at,
        source_file_name=excluded.source_file_name,
        source_time_in=excluded.source_time_in,
        source_generated_undertime_id=excluded.source_generated_undertime_id,
        source_file_id_text=excluded.source_file_id_text,
        classification_migrated_at=coalesce(public.half_day_records.classification_migrated_at,now()),
        is_deleted=false,
        removed_from_recycle_bin=false
  where public.half_day_records.source_type='attendance_upload'
  returning source_generated_undertime_id
)
update public.generated_undertimes u
set is_deleted=true,
    deleted_at=coalesce(u.deleted_at,now()),
    deleted_reason='reclassified_as_half_day'
where not u.is_deleted
  and u.id::text in (
    select i.source_generated_undertime_id
    from inserted i
    where i.source_generated_undertime_id is not null
  )
  and exists (
    select 1 from public.half_day_records h
    where not h.is_deleted
      and h.source_type='attendance_upload'
      and h.source_generated_undertime_id=u.id::text
  );

commit;
