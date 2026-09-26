-- Forward-only MAIN/ITC exemption review scope correction.
-- Do not apply automatically.
begin;

create or replace function public.review_exemption(p_id bigint,p_status text,p_remarks text default null)
returns void language plpgsql security definer set search_path='' as $$
declare
  x public.exemptions%rowtype;
  e public.employees%rowtype;
  l public.late_records%rowtype;
  expected_workspace text;
begin
  if auth.uid() is null or public.attendance_role()<>'Admin' then
    raise exception 'Only Admin can review exemptions';
  end if;
  if p_status not in ('approved','declined') then
    raise exception 'Invalid review status';
  end if;

  expected_workspace := case when public.attendance_hr_scope()='MAIN' then 'WAIS' else 'APP' end;

  select * into x
  from public.exemptions
  where id=p_id and not is_deleted
  for update;

  if x.id is null or x.approval_status<>'pending' then
    raise exception 'Pending exemption in your HR scope required';
  end if;
  if x.workspace<>expected_workspace then
    raise exception 'Exemption is outside the Admin HR scope';
  end if;
  if x.submitted_by=auth.uid() then
    raise exception 'Self-approval is not allowed';
  end if;
  if x.late_record_id is null then
    raise exception 'Linked late record required';
  end if;

  select * into e
  from public.employees
  where id=x.employee_id
    and not is_deleted
    and employment_status='active'
    and hr_scope=public.attendance_hr_scope()
    and workspace=expected_workspace;
  if e.id is null then
    raise exception 'Exemption employee is outside the Admin HR scope';
  end if;

  select * into l
  from public.late_records
  where id=x.late_record_id
    and not is_deleted;
  if l.id is null
     or l.workspace<>expected_workspace
     or l.work_date<>x.work_date
     or public.employee_name_key(l.employee_name)<>public.employee_name_key(e.full_name) then
    raise exception 'Linked late record is outside the exemption employee and HR scope';
  end if;

  update public.exemptions
  set approval_status=p_status,
      reviewed_by=auth.uid(),
      reviewed_at=now(),
      review_remarks=nullif(btrim(p_remarks),'')
  where id=x.id;
end $$;

revoke all on function public.review_exemption(bigint,text,text) from public,anon;
grant execute on function public.review_exemption(bigint,text,text) to authenticated;
commit;
