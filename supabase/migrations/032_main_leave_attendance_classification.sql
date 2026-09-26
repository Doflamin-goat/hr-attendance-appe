-- Forward-only MAIN Leave attendance classification.
-- Do not apply automatically.
begin;

alter table public.leave_requests
  add column if not exists attendance_classification text;

alter table public.leave_requests
  drop constraint if exists leave_requests_attendance_classification_check;

alter table public.leave_requests
  add constraint leave_requests_attendance_classification_check
  check (attendance_classification in ('excused','unexcused') or attendance_classification is null);

create or replace function public.review_leave_request_main(
  p_id uuid,
  p_classification text,
  p_status text,
  p_remarks text default null
)
returns void language plpgsql security definer set search_path='' as $$
declare
  x public.leave_requests%rowtype;
  used_minutes integer;
  balance_adjustment integer;
begin
  if auth.uid() is null or coalesce(public.attendance_role(),'') <> 'Admin' then
    raise exception 'Only Admin can review leave requests';
  end if;
  if public.attendance_hr_scope() <> 'MAIN' or public.attendance_workspace() <> 'WAIS' then
    raise exception 'MAIN Admin scope required';
  end if;
  if p_classification not in ('excused','unexcused') then
    raise exception 'Attendance Classification is required';
  end if;
  if p_status not in ('approved','rejected') then
    raise exception 'Invalid review status';
  end if;

  select * into x
  from public.leave_requests
  where id=p_id
    and workspace='WAIS'
    and not is_deleted
  for update;

  if x.id is null or x.status <> 'pending' then
    raise exception 'Pending leave request in your HR scope required';
  end if;
  if x.submitted_by=auth.uid() then
    raise exception 'Self-approval is not allowed';
  end if;

  if p_status='approved' then
    select coalesce(sum(duration_minutes),0) into used_minutes
    from public.leave_requests
    where employee_id=x.employee_id
      and status='approved'
      and not is_deleted
      and extract(year from leave_date)=extract(year from x.leave_date);
    select coalesce(adjustment_minutes,0) into balance_adjustment
    from public.employee_leave_adjustments
    where employee_id=x.employee_id
      and leave_year=extract(year from x.leave_date)::integer
    for update;
    if used_minutes+x.duration_minutes > 2400+coalesce(balance_adjustment,0) then
      raise exception 'Insufficient annual leave balance';
    end if;
  end if;

  update public.leave_requests
  set attendance_classification=p_classification,
      status=p_status,
      reviewed_by=auth.uid(),
      reviewed_at=now(),
      review_remarks=nullif(btrim(p_remarks),'')
  where id=x.id;
end $$;

revoke all on function public.review_leave_request_main(uuid,text,text,text) from public,anon;
grant execute on function public.review_leave_request_main(uuid,text,text,text) to authenticated;
commit;
