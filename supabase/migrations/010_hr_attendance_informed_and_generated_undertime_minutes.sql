-- Forward-only production preparation. Do not execute without the approved release process.
-- Stores manual-undertime recipients and the duration calculated for generated undertime.

begin;

alter table if exists public.manual_undertimes
  add column if not exists informed_to text[] not null default '{}';

alter table if exists public.generated_undertimes
  add column if not exists minutes_undertime integer;

do $$
begin
  if to_regclass('public.generated_undertimes') is not null and not exists (
    select 1 from pg_constraint where conname = 'generated_undertimes_minutes_undertime_nonnegative'
  ) then
    alter table public.generated_undertimes
      add constraint generated_undertimes_minutes_undertime_nonnegative
      check (minutes_undertime is null or minutes_undertime >= 0);
  end if;
end $$;

commit;
