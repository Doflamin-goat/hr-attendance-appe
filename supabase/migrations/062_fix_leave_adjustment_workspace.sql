-- Repair leave adjustment workspace ownership and keep it aligned with the employee.
-- Forward-only migration. Do not apply automatically.
begin;

update public.employee_leave_adjustments as a
   set workspace = e.workspace
  from public.employees as e
 where e.id = a.employee_id
   and e.workspace in ('APP', 'WAIS')
   and a.workspace is distinct from e.workspace;

create or replace function public.set_employee_remaining_leave(
  p_employee_id uuid,
  p_leave_year integer,
  p_remaining_minutes integer,
  p_remarks text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  e public.employees%rowtype;
  approved_minutes integer;
  old_adjustment integer;
  previous_remaining integer;
  new_adjustment integer;
  expected_workspace text;
begin
  if auth.uid() is null
     or public.attendance_role() is distinct from 'HR' then
    raise exception 'Only HR can edit remaining leave';
  end if;

  if p_leave_year not between 2000 and 2100
     or p_remaining_minutes < 0
     or p_remaining_minutes > 2400 then
    raise exception 'Valid leave year and remaining balance required';
  end if;

  perform 1 from public.employees where id = p_employee_id for update;
  select * into e from public.assert_employee_in_hr_scope(p_employee_id);

  expected_workspace := case
    when e.hr_scope = 'ITC' then 'APP'
    when e.hr_scope = 'MAIN' then 'WAIS'
    else null
  end;

  if expected_workspace is null
     or e.workspace is distinct from expected_workspace then
    raise exception 'Employee workspace does not match HR scope';
  end if;

  select coalesce(sum(duration_minutes), 0)
    into approved_minutes
    from public.leave_requests
   where employee_id = e.id
     and status = 'approved'
     and not is_deleted
     and extract(year from leave_date) = p_leave_year;

  select coalesce(adjustment_minutes, 0)
    into old_adjustment
    from public.employee_leave_adjustments
   where employee_id = e.id
     and leave_year = p_leave_year
   for update;

  previous_remaining := 2400 + coalesce(old_adjustment, 0) - approved_minutes;
  new_adjustment := p_remaining_minutes + approved_minutes - 2400;

  insert into public.employee_leave_adjustments (
    employee_id, workspace, leave_year, adjustment_minutes, remarks, created_by
  )
  values (
    e.id, e.workspace, p_leave_year, new_adjustment,
    nullif(btrim(p_remarks), ''), auth.uid()
  )
  on conflict (employee_id, leave_year) do update
    set workspace = excluded.workspace,
        adjustment_minutes = excluded.adjustment_minutes,
        remarks = excluded.remarks;

  insert into public.audit_logs (
    workspace, actor_id, actor_email, entity, entity_id, action, payload
  )
  values (
    e.workspace, auth.uid(), auth.jwt()->>'email',
    'employee_leave_adjustment', e.id::text, 'set_remaining_leave',
    jsonb_build_object(
      'leave_year', p_leave_year,
      'previous_remaining_minutes', previous_remaining,
      'new_remaining_minutes', p_remaining_minutes,
      'adjustment_minutes', new_adjustment
    )
  );
end
$$;

revoke all on function public.set_employee_remaining_leave(uuid, integer, integer, text)
  from public, anon;
grant execute on function public.set_employee_remaining_leave(uuid, integer, integer, text)
  to authenticated;

commit;