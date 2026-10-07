-- Remove obsolete Service RPC overloads that accepted map coordinates.
-- The supported signatures are defined by migration 042 and accept location text only.
begin;

drop function if exists public.create_service_event(
  text,
  text,
  timestamptz,
  timestamptz,
  uuid[],
  text,
  text,
  text,
  text,
  text,
  double precision,
  double precision
);

drop function if exists public.update_service_event(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  uuid[],
  text,
  text,
  text,
  text,
  text,
  double precision,
  double precision
);

commit;