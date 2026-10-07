-- Allow reuse of soft-deleted Service references while preserving history.
begin;

alter table public.service_events drop constraint if exists service_events_service_ref_key;
drop index if exists public.service_events_service_ref_key;
create unique index if not exists service_events_active_service_ref_key
  on public.service_events(service_ref)
  where is_deleted = false;

create or replace function public.service_reference(p_year text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  select coalesce(max((substring(service_ref from '^SR-([0-9]+)$'))::integer), 0) + 1
    into next_number
    from public.service_events
   where is_deleted = false;
  return 'SR-' || lpad(next_number::text, 4, '0');
end;
$$;

grant execute on function public.service_reference(text) to authenticated;
commit;