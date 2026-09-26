-- Forward patch for environments that applied an earlier draft of migration 017.
-- Allows signed derived-balance offsets and removal of rejected leave history.
begin;

alter table public.employee_leave_adjustments
  drop constraint if exists employee_leave_adjustments_adjustment_minutes_check;
alter table public.employee_leave_adjustments
  add constraint employee_leave_adjustments_adjustment_minutes_check
  check (adjustment_minutes between -2400 and 2400);

create or replace function public.set_employee_remaining_leave(p_employee_id uuid,p_leave_year integer,p_remaining_minutes integer,p_remarks text default null)
returns void language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; approved_minutes integer; old_adjustment integer; previous_remaining integer; new_adjustment integer;
begin
  if auth.uid() is null or coalesce(public.attendance_role(),'') <> 'HR' then raise exception 'Only HR can edit remaining leave'; end if;
  if p_leave_year not between 2000 and 2100 then raise exception 'Valid leave year required'; end if;
  if p_remaining_minutes < 0 or p_remaining_minutes > 2400 then raise exception 'Remaining leave must be between 0 and 2400 minutes'; end if;
  select * into e from public.employees where id=p_employee_id and not is_deleted and employment_status='active' for update;
  if e.id is null then raise exception 'Active employee required'; end if;
  select coalesce(sum(duration_minutes),0) into approved_minutes from public.leave_requests
    where employee_id=p_employee_id and status='approved' and not is_deleted and extract(year from leave_date)=p_leave_year;
  select coalesce(adjustment_minutes,0) into old_adjustment from public.employee_leave_adjustments
    where employee_id=p_employee_id and leave_year=p_leave_year for update;
  previous_remaining=2400+coalesce(old_adjustment,0)-approved_minutes;
  new_adjustment=p_remaining_minutes+approved_minutes-2400;
  insert into public.employee_leave_adjustments(employee_id,workspace,leave_year,adjustment_minutes,remarks,created_by)
  values(e.id,e.workspace,p_leave_year,new_adjustment,nullif(btrim(p_remarks),''),auth.uid())
  on conflict(employee_id,leave_year) do update set adjustment_minutes=excluded.adjustment_minutes,remarks=excluded.remarks;
  insert into public.audit_logs(workspace,actor_id,actor_email,entity,entity_id,action,payload)
  values(e.workspace,auth.uid(),auth.jwt()->>'email','employee_leave_adjustment',e.id::text,'set_remaining_leave',jsonb_build_object('leave_year',p_leave_year,'previous_remaining_minutes',previous_remaining,'new_remaining_minutes',p_remaining_minutes,'adjustment_minutes',new_adjustment,'remarks',nullif(btrim(p_remarks),'')));
end $$;

create or replace function public.remove_leave_request(p_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare x public.leave_requests%rowtype;
begin
  if auth.uid() is null or coalesce(public.attendance_role(),'') <> 'HR' then raise exception 'Only HR can remove leave records'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Removal reason required'; end if;
  select * into x from public.leave_requests where id=p_id and not is_deleted for update;
  if x.id is null or x.status not in ('approved','rejected') then raise exception 'Active approved or rejected leave request required'; end if;
  perform 1 from public.employees where id=x.employee_id for update;
  update public.leave_requests set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason=x.status||'_leave_removed: '||btrim(p_reason),deleted_batch_id=gen_random_uuid() where id=x.id;
  insert into public.audit_logs(workspace,actor_id,actor_email,entity,entity_id,action,payload)
  values(x.workspace,auth.uid(),auth.jwt()->>'email','leave_request',x.id::text,'remove_'||x.status,jsonb_build_object('employee_id',x.employee_id,'leave_date',x.leave_date,'duration_minutes',x.duration_minutes,'status',x.status,'reason',btrim(p_reason)));
end $$;

drop function if exists public.remove_approved_leave_request(uuid,text);
revoke all on function public.set_employee_remaining_leave(uuid,integer,integer,text), public.remove_leave_request(uuid,text) from public,anon;
grant execute on function public.set_employee_remaining_leave(uuid,integer,integer,text), public.remove_leave_request(uuid,text) to authenticated;

commit;
