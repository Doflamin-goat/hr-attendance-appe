-- =====================================================================
-- Employees table + supporting objects for the HR Attendance System.
-- Run this in Supabase SQL Editor (or via the Supabase CLI).
-- Safe to re-run: every statement uses IF NOT EXISTS / IF EXISTS guards.
-- =====================================================================

-- 1. Table
create table if not exists public.employees (
  id                  uuid primary key default gen_random_uuid(),
  workspace           text not null check (workspace in ('APP', 'WAIS')),
  employee_number     text,
  full_name           text not null,
  department          text,
  position            text,
  employment_status   text not null default 'active'
                      check (employment_status in ('active', 'inactive')),
  is_deleted          boolean not null default false,
  deleted_at          timestamptz,
  deleted_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 2. updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_employees_updated_at on public.employees;
create trigger trg_employees_updated_at
before update on public.employees
for each row execute function public.set_updated_at();

-- 3. Normalized-name expression for duplicate detection.
--    Strips punctuation + collapses whitespace, e.g.
--    "Cruz, Nathaniel Philip" -> "cruz nathaniel philip".
create or replace function public.employee_name_key(name text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(lower(coalesce(name, '')), '[.,]', '', 'g'),
           '\s+', ' ', 'g'
         );
$$;

-- 4. Unique active-employee guard scoped per workspace.
--    Inactive/deleted rows do NOT collide so HR can restore or re-hire.
create unique index if not exists employees_unique_active_name
  on public.employees (workspace, public.employee_name_key(full_name))
  where is_deleted = false;

create index if not exists employees_workspace_idx
  on public.employees (workspace);

create index if not exists employees_status_idx
  on public.employees (workspace, employment_status, is_deleted);

-- 5. Row-Level Security
alter table public.employees enable row level security;

drop policy if exists "employees: workspace members can read" on public.employees;
create policy "employees: workspace members can read"
  on public.employees
  for select
  to authenticated
  using (
    workspace in (
      select p.workspace from public.profiles p where p.id = auth.uid()
    )
  );

drop policy if exists "employees: workspace members can write" on public.employees;
create policy "employees: workspace members can write"
  on public.employees
  for all
  to authenticated
  using (
    workspace in (
      select p.workspace from public.profiles p where p.id = auth.uid()
    )
  )
  with check (
    workspace in (
      select p.workspace from public.profiles p where p.id = auth.uid()
    )
  );

-- 6. Optional audit log (the employee service writes to this table best-effort).
create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  workspace    text not null,
  actor_id     uuid references auth.users(id) on delete set null,
  actor_email  text,
  entity       text not null,        -- e.g. 'employee'
  entity_id    text,
  action       text not null,        -- 'create' | 'update' | 'deactivate' | 'restore'
  payload      jsonb,
  created_at   timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

drop policy if exists "audit_logs: workspace members can read" on public.audit_logs;
create policy "audit_logs: workspace members can read"
  on public.audit_logs
  for select
  to authenticated
  using (
    workspace in (
      select p.workspace from public.profiles p where p.id = auth.uid()
    )
  );

drop policy if exists "audit_logs: workspace members can insert" on public.audit_logs;
create policy "audit_logs: workspace members can insert"
  on public.audit_logs
  for insert
  to authenticated
  with check (
    workspace in (
      select p.workspace from public.profiles p where p.id = auth.uid()
    )
  );

-- =====================================================================
-- ONE-TIME SEED of the previously hard-coded roster.
-- The "on conflict do nothing" relies on the unique active-name index,
-- so re-running the seed is safe.
-- =====================================================================

-- WAIS (Admin) roster
insert into public.employees (workspace, full_name) values
  ('WAIS', 'Agravio, John Maric'),
  ('WAIS', 'Aquino, Armando'),
  ('WAIS', 'Cantillon, Ma. Louissa'),
  ('WAIS', 'Codilan, Ian Christopher'),
  ('WAIS', 'Cruz, Gino'),
  ('WAIS', 'Cruz, Nathaniel Philip'),
  ('WAIS', 'Engay, Lovely Jane'),
  ('WAIS', 'Loterte, Jenny Lyn'),
  ('WAIS', 'Pascua, Joseph'),
  ('WAIS', 'Pascual, Lucky Joy'),
  ('WAIS', 'Pesquerra, Louis Gabriel'),
  ('WAIS', 'Ramirez, Rejohn'),
  ('WAIS', 'Raquem, Karl Anthony'),
  ('WAIS', 'Tapat, Leilani'),
  ('WAIS', 'Yatsu, Nanako')
on conflict on constraint employees_unique_active_name do nothing;

-- APP (Production) roster
insert into public.employees (workspace, full_name) values
  ('APP', 'Aclan, Junrey'),
  ('APP', 'Arroyo, Nilo'),
  ('APP', 'Azcueta, Jerwin'),
  ('APP', 'Bajar, Joseph'),
  ('APP', 'Bautista, Gerry'),
  ('APP', 'Bayan, Juewars'),
  ('APP', 'Bertulfo, Hermilo'),
  ('APP', 'Bido, Alonzo'),
  ('APP', 'Bonaobra, Davidson'),
  ('APP', 'Cababat, Chesterson'),
  ('APP', 'Caban, Cris'),
  ('APP', 'Calicdan, Ednerson'),
  ('APP', 'Campita, Justin'),
  ('APP', 'Clemente Jr., Ricardo'),
  ('APP', 'Coste, Welmar'),
  ('APP', 'De Jesus, Roy Roldan'),
  ('APP', 'Dometita, Bryan Lloyd'),
  ('APP', 'Escarcha, Carlito'),
  ('APP', 'Estuaria, Christian'),
  ('APP', 'Francisco, Jhon Mar'),
  ('APP', 'Hiteroza, Isauro'),
  ('APP', 'Magday, Elmer'),
  ('APP', 'Mapa, Arnel'),
  ('APP', 'Meeks, Bryan'),
  ('APP', 'Obligar, Bernal'),
  ('APP', 'Olesco, Alvin'),
  ('APP', 'Omapas Jr., Teddy'),
  ('APP', 'Omegan, Jayson'),
  ('APP', 'Radaza, Marifie'),
  ('APP', 'Samson, John Paul'),
  ('APP', 'Sisbas, Jessie'),
  ('APP', 'Soriano, Ariel'),
  ('APP', 'Suarez, Elmer'),
  ('APP', 'Urbano, Ronald'),
  ('APP', 'Veruela, John Wally'),
  ('APP', 'Zate, Mario')
on conflict on constraint employees_unique_active_name do nothing;
