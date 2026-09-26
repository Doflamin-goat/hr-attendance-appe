-- Forward-only MAIN manual Absence precedence.
-- Do not apply automatically.
begin;

create or replace function public.enforce_main_manual_absence_precedence()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.workspace='WAIS' and new.employee_id is not null and not new.is_deleted then
    if new.source_type='system_generated'
       and exists(
         select 1
         from public.absences a
         where a.workspace='WAIS'
           and a.employee_id=new.employee_id
           and a.work_date=new.work_date
           and a.source_type='manual'
           and not a.is_deleted
       ) then
      return null;
    end if;

    if new.source_type='manual' then
      update public.absences
      set is_deleted=true,
          deleted_at=now(),
          deleted_by=auth.uid(),
          deleted_reason='Superseded by MAIN manual absence',
          removed_from_recycle_bin=false
      where workspace='WAIS'
        and employee_id=new.employee_id
        and work_date=new.work_date
        and source_type='system_generated'
        and not is_deleted;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_main_manual_absence_precedence on public.absences;
create trigger trg_main_manual_absence_precedence
before insert or update of employee_id,work_date,source_type,is_deleted
on public.absences
for each row
execute function public.enforce_main_manual_absence_precedence();

revoke all on function public.enforce_main_manual_absence_precedence() from public,anon;
grant execute on function public.enforce_main_manual_absence_precedence() to authenticated;
commit;
