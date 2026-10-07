-- Forward-only proposal. Do not apply automatically.
begin;

create table if not exists public.date_exemption_rules (
  id uuid primary key default gen_random_uuid(),
  workspace text not null check (workspace in ('APP','WAIS')),
  exemption_date date not null,
  reason text not null,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  is_active boolean not null default true,
  disabled_at timestamptz,
  disabled_by uuid references auth.users(id)
);
create unique index if not exists date_exemption_rules_active_uq
  on public.date_exemption_rules(workspace, exemption_date) where is_active;

alter table public.exemptions add column if not exists source_type text not null default 'individual';
alter table public.exemptions add column if not exists date_rule_id uuid references public.date_exemption_rules(id);

alter table public.date_exemption_rules enable row level security;
drop policy if exists date_exemption_rules_scoped_read on public.date_exemption_rules;
create policy date_exemption_rules_scoped_read on public.date_exemption_rules for select to authenticated
  using (public.attendance_role() in ('HR','Admin') and workspace = public.attendance_workspace());
drop policy if exists date_exemption_rules_hr_insert on public.date_exemption_rules;
create policy date_exemption_rules_hr_insert on public.date_exemption_rules for insert to authenticated
  with check (public.attendance_role() = 'HR' and workspace = public.attendance_workspace() and created_by = auth.uid());

create or replace function public.apply_date_exemption_rule(p_rule_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.date_exemption_rules%rowtype; l public.late_records%rowtype; n integer := 0;
begin
  select * into r from public.date_exemption_rules where id = p_rule_id and is_active for update;
  if not found then raise exception 'Active date exemption rule not found'; end if;
  if public.attendance_role() <> 'HR' or r.workspace <> public.attendance_workspace() then raise exception 'Workspace access denied'; end if;
  for l in select * from public.late_records where workspace=r.workspace and work_date=r.exemption_date and not is_deleted and employee_id is not null loop
    insert into public.exemptions(workspace, employee_id, employee_name, work_date, reason, informed_parties, approval_status, late_record_id, source_type, date_rule_id)
    values (r.workspace,l.employee_id,l.employee_name,l.work_date,r.reason,'{}','pending',l.id,'date_rule',r.id)
    on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end; $$;

create or replace function public.create_date_exemption_rule(p_date date, p_reason text, p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; ws text := public.attendance_workspace();
begin
  if auth.uid() is null or public.attendance_role() <> 'HR' or ws is null then raise exception 'Only scoped HR can create date exemption rules'; end if;
  insert into public.date_exemption_rules(workspace, exemption_date, reason, note, created_by)
  values(ws,p_date,nullif(btrim(p_reason),''),nullif(btrim(p_note),''),auth.uid()) returning id into rid;
  perform public.apply_date_exemption_rule(rid); return rid;
end; $$;

create or replace function public.disable_date_exemption_rule(p_rule_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.date_exemption_rules set is_active=false, disabled_at=now(), disabled_by=auth.uid()
  where id=p_rule_id and workspace=public.attendance_workspace() and public.attendance_role()='HR';
  if not found then raise exception 'Date exemption rule not found'; end if;
end; $$;

create or replace function public.apply_late_date_exemption_rule()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.date_exemption_rules%rowtype;
begin
  if new.is_deleted or new.employee_id is null then return new; end if;
  select * into r from public.date_exemption_rules where workspace=new.workspace and exemption_date=new.work_date and is_active limit 1;
  if found then
    insert into public.exemptions(workspace, employee_id, employee_name, work_date, reason, informed_parties, approval_status, late_record_id, source_type, date_rule_id)
    values(new.workspace,new.employee_id,new.employee_name,new.work_date,r.reason,'{}','pending',new.id,'date_rule',r.id)
    on conflict do nothing;
  end if;
  return new;
end; $$;
drop trigger if exists late_records_date_exemption_rule on public.late_records;
create trigger late_records_date_exemption_rule after insert on public.late_records for each row execute function public.apply_late_date_exemption_rule();

grant execute on function public.create_date_exemption_rule(date,text,text) to authenticated;
grant execute on function public.disable_date_exemption_rule(uuid) to authenticated;
commit;
