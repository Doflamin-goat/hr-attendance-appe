-- Backfill and maintain canonical Employee Master identity for generated MAIN lates.
-- Forward-only migration. Do not apply automatically.
begin;

update public.late_records as l
   set employee_id = matches.employee_id
  from (
    select l2.id as late_id, min(d.employee_id::text)::uuid as employee_id
      from public.late_records l2
      join public.main_daily_attendance d
        on d.workspace = 'WAIS'
       and d.employee_id is not null
       and not d.is_deleted
       and d.work_date = l2.work_date
       and d.source_file_id::text = l2.source_file_id::text
       and public.employee_name_key(d.employee_name) = public.employee_name_key(l2.employee_name)
      where l2.workspace = 'WAIS'
        and l2.source_file_id is not null
        and l2.employee_id is null
        and not l2.is_deleted
      group by l2.id
      having count(distinct d.employee_id) = 1
  ) as matches
 where l.id = matches.late_id
   and l.employee_id is null;

create or replace function public.resolve_main_late_employee()
returns trigger language plpgsql security definer set search_path='' as $$
declare resolved_id uuid; candidate_count integer;
begin
  if new.workspace <> 'WAIS' or new.employee_id is not null or new.source_file_id is null then
    return new;
  end if;

  select count(distinct d.employee_id), min(d.employee_id::text)::uuid
    into candidate_count, resolved_id
    from public.main_daily_attendance d
   where d.workspace = 'WAIS'
     and d.employee_id is not null
     and not d.is_deleted
     and d.work_date = new.work_date
     and d.source_file_id::text = new.source_file_id::text
     and public.employee_name_key(d.employee_name) = public.employee_name_key(new.employee_name);

  if candidate_count = 1 then
    new.employee_id := resolved_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_resolve_main_late_employee on public.late_records;
create trigger trg_resolve_main_late_employee
before insert on public.late_records
for each row execute function public.resolve_main_late_employee();

revoke all on function public.resolve_main_late_employee() from public, anon;
commit;
