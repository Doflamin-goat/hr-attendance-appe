-- Forward-only generated-classification repair. NOT APPLIED.
--
-- READ-ONLY PREFLIGHT
-- select u.id, u.workspace, u.employee_name, u.work_date, u.time_in,
--        u.source_file_id, u.source_file_name,
--        h.id as half_day_id, h.source_generated_undertime_id,
--        h.source_time_in, h.source_file_id_text, h.source_file_name
-- from public.generated_undertimes u
-- join public.half_day_records h
--   on not h.is_deleted and h.source_type = 'attendance_upload'
--  and h.workspace = u.workspace and h.work_date = u.work_date
--  and public.employee_name_key(h.employee_name) = public.employee_name_key(u.employee_name)
-- where not u.is_deleted
--   and extract(isodow from u.work_date) between 1 and 5
--   and u.time_in::time between time '11:51:00' and time '13:00:59.999999'
-- order by u.work_date, u.employee_name, u.time_in;
--
-- READ-ONLY VERIFICATION (expected result: zero rows)
-- select u.id, u.workspace, u.employee_name, u.work_date, u.time_in
-- from public.generated_undertimes u
-- where not u.is_deleted
--   and extract(isodow from u.work_date) between 1 and 5
--   and u.time_in::time between time '11:51:00' and time '13:00:59.999999'
--   and exists (
--     select 1 from public.half_day_records h
--     where not h.is_deleted and h.source_type = 'attendance_upload'
--       and h.workspace = u.workspace and h.work_date = u.work_date
--       and public.employee_name_key(h.employee_name) = public.employee_name_key(u.employee_name)
--       and (h.source_generated_undertime_id = u.id::text
--         or (h.source_time_in = u.time_in::time
--           and (h.source_file_id_text = u.source_file_id::text
--             or h.source_file_name is not distinct from u.source_file_name)))
--   );

begin;

update public.generated_undertimes u
set is_deleted = true,
    deleted_at = coalesce(u.deleted_at, now()),
    deleted_reason = 'reclassified_as_half_day'
where not u.is_deleted
  and u.source_file_id is not null
  and nullif(btrim(u.source_file_name), '') is not null
  and extract(isodow from u.work_date) between 1 and 5
  and u.time_in::time between time '11:51:00' and time '13:00:59.999999'
  and exists (
    select 1
    from public.half_day_records h
    where not h.is_deleted
      and h.source_type = 'attendance_upload'
      and h.workspace = u.workspace
      and h.work_date = u.work_date
      and public.employee_name_key(h.employee_name) = public.employee_name_key(u.employee_name)
      and (
        h.source_generated_undertime_id = u.id::text
        or (
          h.source_generated_undertime_id is null
          and h.source_time_in = u.time_in::time
          and (
            h.source_file_id_text = u.source_file_id::text
            or (
              h.source_file_id_text is null
              and h.source_file_name is not distinct from u.source_file_name
            )
          )
        )
      )
  );

commit;
