-- Parse legacy APP/ITC clock text, including the en-US 12-hour strings written
-- by attendance uploads, before invoking the established reversible reconciler.
begin;

create or replace function public.parse_itc_clock_time(p_value text)
returns time
language plpgsql
immutable
set search_path=pg_catalog
as $$
declare
  parts text[];
  hour_value integer;
  minute_value integer;
  second_value integer;
  meridiem text;
begin
  if p_value is null or btrim(p_value)='' then return null; end if;
  parts:=regexp_match(btrim(p_value),'^([0-9]{1,2}):([0-9]{2})(:([0-9]{2}))?[[:space:]]*(AM|PM)?$','i');
  if parts is null then return null; end if;
  hour_value:=parts[1]::integer;
  minute_value:=parts[2]::integer;
  second_value:=coalesce(parts[4],'0')::integer;
  meridiem:=upper(parts[5]);
  if minute_value>59 or second_value>59 then return null; end if;
  if meridiem is not null then
    if hour_value<1 or hour_value>12 then return null; end if;
    hour_value:=hour_value % 12;
    if meridiem='PM' then hour_value:=hour_value+12; end if;
  elsif hour_value>23 then
    return null;
  end if;
  return make_time(hour_value,minute_value,second_value::double precision);
end;
$$;

-- Canonicalize valid legacy APP values to a stable 24-hour TEXT representation.
-- Invalid/empty values remain untouched and are skipped by reconciliation.
update public.generated_undertimes u
   set time_in=to_char(public.parse_itc_clock_time(u.time_in),'HH24:MI:SS')
 where u.workspace='APP'
   and public.parse_itc_clock_time(u.time_in) is not null
   and u.time_in is distinct from to_char(public.parse_itc_clock_time(u.time_in),'HH24:MI:SS');

create or replace function public.canonicalize_itc_generated_undertime_time()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare parsed_time time;
begin
  if new.workspace='APP' then
    parsed_time:=public.parse_itc_clock_time(new.time_in);
    if parsed_time is not null then new.time_in:=to_char(parsed_time,'HH24:MI:SS'); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_canonicalize_itc_generated_undertime_time on public.generated_undertimes;
create trigger trg_canonicalize_itc_generated_undertime_time
before insert or update of time_in on public.generated_undertimes
for each row execute function public.canonicalize_itc_generated_undertime_time();

-- Keep the existing APP-only suppression, reversal, multi-Service union, and
-- effect-transfer implementation. Normalize time text, then delegate unchanged.
alter function public.reconcile_itc_service_attendance(uuid)
  rename to reconcile_itc_service_attendance_053;
revoke all on function public.reconcile_itc_service_attendance_053(uuid) from public,anon,authenticated;

create or replace function public.reconcile_itc_service_attendance(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  affected_count integer;
begin
  if auth.uid() is null
     or public.attendance_role() is distinct from 'HR'
     or public.attendance_workspace() is distinct from 'APP'
     or public.attendance_hr_scope() is distinct from 'ITC' then
    raise exception 'Only APP ITC HR can reconcile Service attendance';
  end if;

  update public.generated_undertimes u
     set time_in=to_char(public.parse_itc_clock_time(u.time_in),'HH24:MI:SS')
   where u.workspace='APP'
     and public.parse_itc_clock_time(u.time_in) is not null
     and u.time_in is distinct from to_char(public.parse_itc_clock_time(u.time_in),'HH24:MI:SS');

  affected_count:=public.reconcile_itc_service_attendance_053(p_event_id);
  return affected_count;
end;
$$;

revoke all on function public.parse_itc_clock_time(text),public.canonicalize_itc_generated_undertime_time(),public.reconcile_itc_service_attendance(uuid) from public,anon;
grant execute on function public.reconcile_itc_service_attendance(uuid) to authenticated;

commit;
