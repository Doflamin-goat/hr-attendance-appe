import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/060_fix_itc_halfday_conversion_duplicate_reuse.sql", import.meta.url), "utf8");
const fixture = readFileSync(new URL("./fixtures/main-attendance-sources.sql", import.meta.url), "utf8");
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hr = uid(1);
const employee = uid(2);
const date = "2026-10-01";

async function database() {
  const db = new PGlite();
  await db.exec(fixture);
  await db.exec(`
    alter table public.generated_undertimes alter column time_in type text using time_in::text;
    alter table public.generated_undertimes add column employee_id uuid;
    alter table public.generated_undertimes add column reason text;
    alter table public.half_day_records add column source_generated_undertime_id text,
      add column source_file_id_text text,
      add column removed_from_recycle_bin_at timestamptz,
      add column removed_from_recycle_bin_by uuid;
    create table public.audit_logs(workspace text,actor_id uuid,entity text,entity_id text,action text,payload jsonb);
    alter table public.profiles add column hr_scope text;
    create function public.attendance_hr_scope() returns text language sql stable as $$
      select hr_scope from public.profiles where id=auth.uid()
    $$;
    create function public.employee_name_key(text) returns text language sql immutable as $$
      select lower(regexp_replace(btrim($1),'\\s+',' ','g'))
    $$;
    create function public.parse_itc_clock_time(text) returns time language plpgsql immutable as $$
      begin return nullif(btrim($1),'')::time; exception when others then return null; end
    $$;
    create function public.lock_undertime_identity(text,uuid,date) returns void language plpgsql as $$ begin return; end $$;
    create function public.attendance_role() returns text language sql stable as $$
      select role from public.profiles where id=auth.uid()
    $$;
    create function public.attendance_workspace() returns text language sql stable as $$
      select workspace from public.profiles where id=auth.uid()
    $$;
    insert into auth.users values ('${hr}');
    insert into public.profiles(id,workspace,role,hr_scope) values('${hr}','APP','HR','ITC');
    insert into public.employees(id,workspace,hr_scope,full_name) values('${employee}','APP','ITC','Test Employee');
    select set_config('request.jwt.claim.sub','${hr}',false);
  `);
  await db.exec(migration);
  return db;
}

async function reset(db: PGlite) {
  await db.exec("truncate public.audit_logs,public.half_day_records,public.generated_undertimes restart identity;");
}

async function generated(db: PGlite) {
  return (await db.query<{ id: string }>(`insert into public.generated_undertimes
    (workspace,employee_id,employee_name,work_date,time_in,source_file_name,source_file_id)
    values('APP','${employee}','Test Employee','${date}','1:00 PM','upload.xlsx',null) returning id::text`)).rows[0].id;
}

async function convert(db: PGlite, id: string) {
  return (await db.query<{ move_generated_undertime_to_half_day: string }>(
    "select public.move_generated_undertime_to_half_day($1::bigint)", [id],
  )).rows[0].move_generated_undertime_to_half_day;
}

test("060 repairs only the converted APP/ITC Half-Day duplicate lifecycle", async (t) => {
  const db = await database();
  try {
    await t.test("reuses deleted converted row and clears recycle state", async () => {
      await reset(db);
      const source = await generated(db);
      const half = await convert(db, source);
      await db.query(`update public.half_day_records set is_deleted=true,deleted_at=now(),
        deleted_by='${hr}',deleted_reason='half_day_deleted',deleted_batch_id=gen_random_uuid()
        where id=$1`, [half]);
      await db.query("update public.generated_undertimes set is_deleted=false,deleted_at=null,deleted_by=null,deleted_reason=null where id=$1", [source]);
      const reused = await convert(db, source);
      assert.equal(reused, half);
      assert.deepEqual((await db.query<{ is_deleted: boolean; deleted_reason: string | null; source_generated_undertime_id: string }>(
        "select is_deleted,deleted_reason,source_generated_undertime_id from public.half_day_records where id=$1", [half],
      )).rows[0], { is_deleted: false, deleted_reason: null, source_generated_undertime_id: source });
      assert.deepEqual((await db.query<{ is_deleted: boolean; employee_id: string | null; deleted_reason: string }>(
        "select is_deleted,employee_id,deleted_reason from public.generated_undertimes where id=$1", [source],
      )).rows[0], { is_deleted: true, employee_id: employee, deleted_reason: "reclassified_as_half_day" });
    });

    await t.test("reuses a conversion-reversed row even though reversal hides it from Recycle Bin", async () => {
      await reset(db);
      const source = await generated(db);
      const half = await convert(db, source);
      await db.query(`update public.half_day_records set is_deleted=true,deleted_at=now(),
        deleted_by='${hr}',deleted_reason='conversion_reversed_to_undertime',
        removed_from_recycle_bin=true where id=$1`, [half]);
      await db.query(`update public.generated_undertimes set is_deleted=false,deleted_at=null,
        deleted_by=null,deleted_reason=null where id=$1`, [source]);
      assert.equal(await convert(db, source), half);
    });

    await t.test("does not revive a manually sourced row and returns a clean duplicate message", async () => {
      await reset(db);
      const source = await generated(db);
      const manualId = (await db.query<{ id: string }>(`insert into public.half_day_records
        (workspace,employee_id,employee_name,work_date,absent_period,scheduled_start,scheduled_end,
         reason,created_by,source_type,is_deleted,deleted_reason)
        values('APP','${employee}','Test Employee','${date}','morning','08:00','12:00','manual','${hr}','manual',true,'half_day_deleted')
        returning id::text`)).rows[0].id;
      await assert.rejects(convert(db, source), /A Half-Day record already exists for this employee and date\./);
      assert.equal((await db.query<{ source_type: string; is_deleted: boolean }>(
        "select source_type,is_deleted from public.half_day_records where id=$1", [manualId],
      )).rows[0].source_type, "manual");
      assert.equal((await db.query<{ is_deleted: boolean }>("select is_deleted from public.generated_undertimes where id=$1", [source])).rows[0].is_deleted, false);
    });

    await t.test("active duplicate is rejected before source Undertime is changed", async () => {
      await reset(db);
      const source = await generated(db);
      await db.query(`insert into public.half_day_records
        (workspace,employee_id,employee_name,work_date,absent_period,scheduled_start,scheduled_end,reason,created_by,source_type)
        values('APP','${employee}','Test Employee','${date}','morning','08:00','12:00','manual','${hr}','manual')`);
      await assert.rejects(convert(db, source), /A Half-Day record already exists for this employee and date\./);
      assert.equal((await db.query<{ is_deleted: boolean }>("select is_deleted from public.generated_undertimes where id=$1", [source])).rows[0].is_deleted, false);
    });
  } finally {
    await db.close();
  }
});
