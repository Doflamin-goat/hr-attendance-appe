-- Leave requests, approval audit, and minute-based annual balance source.
-- Forward-only migration. Apply through the approved Supabase release process.
begin;

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  workspace text not null check (workspace in ('APP','WAIS')),
  employee_id uuid not null references public.employees(id),
  employee_name text not null,
  leave_date date not null,
  start_time time not null,
  end_time time not null,
  duration_minutes integer not null check (duration_minutes > 0),
  informed_parties text[] not null default '{}',
  reason text not null check (nullif(btrim(reason),'') is not null),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  deleted_reason text,
  deleted_batch_id uuid,
  restored_at timestamptz,
  restored_by uuid references auth.users(id),
  removed_from_recycle_bin boolean not null default false,
  removed_from_recycle_bin_at timestamptz,
  removed_from_recycle_bin_by uuid references auth.users(id)
);

create index if not exists leave_requests_employee_year_idx on public.leave_requests(employee_id, leave_date, status) where not is_deleted;
create index if not exists leave_requests_status_idx on public.leave_requests(status, submitted_at) where not is_deleted;
create unique index if not exists leave_requests_active_employee_date_uidx on public.leave_requests(employee_id, leave_date)
where not is_deleted and status in ('pending','approved');

create table if not exists public.employee_leave_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  workspace text not null check (workspace in ('APP','WAIS')),
  leave_year integer not null check (leave_year between 2000 and 2100),
  adjustment_minutes integer not null check (adjustment_minutes between -2400 and 2400),
  remarks text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, leave_year)
);

create index if not exists employee_leave_adjustments_year_idx on public.employee_leave_adjustments(leave_year, employee_id);

drop trigger if exists trg_leave_requests_updated_at on public.leave_requests;
create trigger trg_leave_requests_updated_at before update on public.leave_requests
for each row execute function public.set_updated_at();

drop trigger if exists trg_employee_leave_adjustments_updated_at on public.employee_leave_adjustments;
create trigger trg_employee_leave_adjustments_updated_at before update on public.employee_leave_adjustments
for each row execute function public.set_updated_at();

alter table public.leave_requests enable row level security;
drop policy if exists "leave requests HR and Admin read" on public.leave_requests;
create policy "leave requests HR and Admin read" on public.leave_requests for select to authenticated
using (public.attendance_role() in ('HR','Admin'));

alter table public.employee_leave_adjustments enable row level security;
drop policy if exists "leave adjustments HR and Admin read" on public.employee_leave_adjustments;
create policy "leave adjustments HR and Admin read" on public.employee_leave_adjustments for select to authenticated
using (public.attendance_role() in ('HR','Admin'));

-- Admin's new Absence Records route is read-only and cross-workspace.
alter table public.absences enable row level security;
drop policy if exists "absences Admin can read all" on public.absences;
create policy "absences Admin can read all" on public.absences for select to authenticated
using (public.attendance_role() = 'Admin');

create or replace function public.submit_leave_request(p_employee_id uuid,p_leave_date date,p_start_time time,p_end_time time,p_duration_minutes integer,p_informed text[] default '{}',p_reason text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.employees%rowtype; new_id uuid; dow integer; shift_start time; shift_end time; chargeable integer; break_minutes integer;
begin
  if auth.uid() is null or coalesce(public.attendance_role(),'') <> 'HR' then raise exception 'Only HR can submit leave requests'; end if;
  if p_end_time <= p_start_time or p_duration_minutes <= 0 then raise exception 'Valid positive leave duration required'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Reason required'; end if;
  if coalesce(array_length(p_informed,1),0)=0 then raise exception 'Informed person required'; end if;
  dow=extract(dow from p_leave_date);
  if dow=0 then raise exception 'Sunday has no configured work schedule'; end if;
  if dow=6 then shift_start=time '07:00'; shift_end=time '15:15';
  else shift_start=time '08:00'; shift_end=time '17:00'; end if;
  chargeable=greatest(0,(extract(epoch from (least(p_end_time,shift_end)-greatest(p_start_time,shift_start)))/60)::integer);
  if dow between 1 and 5 then
    break_minutes=greatest(0,(extract(epoch from (least(p_end_time,time '13:00')-greatest(p_start_time,time '12:00')))/60)::integer);
    chargeable=chargeable-break_minutes;
  end if;
  if chargeable<=0 or p_duration_minutes<>chargeable then raise exception 'Leave duration does not match the configured work schedule'; end if;
  select * into e from public.employees where id=p_employee_id and not is_deleted and employment_status='active';
  if e.id is null then raise exception 'Active employee required'; end if;
  if exists(select 1 from public.leave_requests where employee_id=p_employee_id and leave_date=p_leave_date and not is_deleted and status in ('pending','approved')) then
    raise exception 'An active leave request already exists for this employee on this date.';
  end if;
  begin
    insert into public.leave_requests(workspace,employee_id,employee_name,leave_date,start_time,end_time,duration_minutes,informed_parties,reason,status,submitted_by)
    values(e.workspace,e.id,e.full_name,p_leave_date,p_start_time,p_end_time,p_duration_minutes,coalesce(p_informed,'{}'),btrim(p_reason),'pending',auth.uid()) returning id into new_id;
  exception when unique_violation then
    raise exception 'An active leave request already exists for this employee on this date.';
  end;
  return new_id;
end $$;

create or replace function public.review_leave_request(p_id uuid,p_status text,p_remarks text default null)
returns void language plpgsql security definer set search_path='' as $$
declare x public.leave_requests%rowtype; used_minutes integer; balance_adjustment integer;
begin
  if auth.uid() is null or coalesce(public.attendance_role(),'') <> 'Admin' then raise exception 'Only Admin can review leave requests'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Invalid review status'; end if;
  select * into x from public.leave_requests where id=p_id and not is_deleted for update;
  if x.id is null or x.status <> 'pending' then raise exception 'Pending leave request required'; end if;
  if x.submitted_by=auth.uid() then raise exception 'Self-approval is not allowed'; end if;
  if p_status='approved' then
    perform 1 from public.employees where id=x.employee_id for update;
    select coalesce(sum(duration_minutes),0) into used_minutes from public.leave_requests
      where employee_id=x.employee_id and status='approved' and not is_deleted
        and extract(year from leave_date)=extract(year from x.leave_date);
    select coalesce(adjustment_minutes,0) into balance_adjustment from public.employee_leave_adjustments
      where employee_id=x.employee_id and leave_year=extract(year from x.leave_date)::integer for update;
    if used_minutes + x.duration_minutes > 2400 + coalesce(balance_adjustment,0) then raise exception 'Insufficient annual leave balance'; end if;
  end if;
  update public.leave_requests set status=p_status,reviewed_by=auth.uid(),reviewed_at=now(),review_remarks=nullif(btrim(p_remarks),'') where id=x.id;
end $$;

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

create or replace function public.cancel_pending_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare x public.leave_requests%rowtype;
begin
  if auth.uid() is null or coalesce(public.attendance_role(),'') <> 'HR' then raise exception 'Only HR can cancel leave requests'; end if;
  select * into x from public.leave_requests where id=p_id and not is_deleted for update;
  if x.id is null or x.status <> 'pending' then raise exception 'Active pending leave request required'; end if;
  if x.submitted_by <> auth.uid() then raise exception 'HR can cancel only its own pending leave request'; end if;
  update public.leave_requests set is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),deleted_reason='leave_request_cancelled',deleted_batch_id=gen_random_uuid() where id=x.id;
  insert into public.audit_logs(workspace,actor_id,actor_email,entity,entity_id,action,payload)
  values(x.workspace,auth.uid(),auth.jwt()->>'email','leave_request',x.id::text,'cancel',jsonb_build_object('employee_id',x.employee_id,'leave_date',x.leave_date,'status',x.status));
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

revoke all on function public.submit_leave_request(uuid,date,time,time,integer,text[],text), public.review_leave_request(uuid,text,text), public.set_employee_remaining_leave(uuid,integer,integer,text), public.cancel_pending_leave_request(uuid), public.remove_leave_request(uuid,text) from public,anon;
grant execute on function public.submit_leave_request(uuid,date,time,time,integer,text[],text), public.review_leave_request(uuid,text,text), public.set_employee_remaining_leave(uuid,integer,integer,text), public.cancel_pending_leave_request(uuid), public.remove_leave_request(uuid,text) to authenticated;

commit;
