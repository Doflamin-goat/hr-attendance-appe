-- Forward-only MAIN Absence uniqueness enforcement.
-- Do not apply automatically.
begin;

-- Reconcile any existing active duplicates without permanently deleting history.
with ranked as (
  select
    id,
    row_number() over (
      partition by employee_id, work_date
      order by (source_type='manual') desc, created_at, id
    ) as row_rank
  from public.absences
  where workspace='WAIS'
    and employee_id is not null
    and not is_deleted
)
update public.absences a
set is_deleted=true,
    deleted_at=now(),
    deleted_by=auth.uid(),
    deleted_reason='duplicate_active_main_absence_reconciled',
    removed_from_recycle_bin=false
from ranked r
where a.id=r.id
  and r.row_rank>1;

create or replace function public.enforce_main_absence_uniqueness()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.workspace='WAIS'
     and new.employee_id is not null
     and not new.is_deleted
     and exists(
       select 1
       from public.absences a
       where a.workspace='WAIS'
         and a.employee_id=new.employee_id
         and a.work_date=new.work_date
         and not a.is_deleted
         and a.id is distinct from new.id
     ) then
    if new.source_type='system_generated' then
      return null;
    end if;
    raise exception 'An absence record already exists for this employee and date.';
  end if;
  return new;
end
$$;

drop trigger if exists trg_main_manual_absence_precedence on public.absences;
drop trigger if exists trg_main_absence_uniqueness on public.absences;
create trigger trg_main_absence_uniqueness
before insert or update of employee_id,work_date,source_type,is_deleted
on public.absences
for each row
execute function public.enforce_main_absence_uniqueness();

drop index if exists public.absences_unique_main_active_employee_date;
create unique index absences_unique_main_active_employee_date
on public.absences(employee_id,work_date)
where workspace='WAIS' and employee_id is not null and not is_deleted;

revoke all on function public.enforce_main_absence_uniqueness() from public,anon;
grant execute on function public.enforce_main_absence_uniqueness() to authenticated;
commit;
