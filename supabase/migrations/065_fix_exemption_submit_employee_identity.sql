-- Validate exemption submissions by canonical Employee Master UUID when available.
-- Forward-only migration. Do not apply automatically.
begin;

create or replace function public.submit_exemption(
  p_employee_id uuid,
  p_late_record_id bigint,
  p_reason text,
  p_reported_time time default null,
  p_informed text[] default '{}'
) returns bigint language plpgsql security definer set search_path='' as $$
declare
  e public.employees%rowtype;
  l public.late_records%rowtype;
  new_id bigint;
begin
  if auth.uid() is null or public.attendance_role() is distinct from 'HR' then
    raise exception 'Only HR can submit exemptions';
  end if;
  if nullif(btrim(p_reason), '') is null or coalesce(array_length(p_informed, 1), 0) = 0 then
    raise exception 'Reason and informed person are required';
  end if;

  select * into e from public.assert_employee_in_hr_scope(p_employee_id);
  select * into l from public.late_records
   where id = p_late_record_id and not is_deleted
   for update;

  if e.id is null or l.id is null or l.workspace is distinct from public.attendance_workspace()
     or l.work_date is null
     or (l.employee_id is not null and l.employee_id is distinct from e.id)
     or (l.employee_id is null and public.employee_name_key(l.employee_name) is distinct from public.employee_name_key(e.full_name)) then
    raise exception 'Employee and late record must match the current HR scope';
  end if;

  insert into public.exemptions(
    workspace, employee_id, late_record_id, employee_name, work_date,
    reason, reported_time, informed_parties, approval_status, submitted_by
  )
  values (
    l.workspace, e.id, l.id, e.full_name, l.work_date,
    btrim(p_reason), p_reported_time, coalesce(p_informed, '{}'), 'pending', auth.uid()
  ) returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.submit_exemption(uuid,bigint,text,time,text[]) from public, anon;
grant execute on function public.submit_exemption(uuid,bigint,text,time,text[]) to authenticated;
commit;
