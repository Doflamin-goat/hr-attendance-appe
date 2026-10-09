import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = (name: string) => read(`../supabase/migrations/${name}.sql`);
const fn = (file: string, name: string) => {
  const sql = migration(file), start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf("$$;", start) + 3);
};
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const employee = uid(100), hr = uid(1), day = "2020-10-01";
const stamp = (date: string, time: string) => `${date}T${time}:00+08:00`;

async function database() {
  const db = new PGlite(); // Isolated, in-memory PostgreSQL. Never a Supabase URL.
  try {
  await db.exec(read("./fixtures/main-attendance-sources.sql"));
  for (const name of ["attendance_role", "attendance_workspace"]) await db.exec(fn("006_staging_only_attendance_workflows", name));
  await db.exec(fn("019_employee_hr_scope", "attendance_hr_scope"));
  await db.exec(fn("001_employees", "employee_name_key"));
  const daily = migration("020_main_office_attendance");
  await db.exec(daily.slice(daily.indexOf("create table if not exists public.main_daily_attendance"), daily.indexOf("alter table public.absences")));
  await db.exec(`alter table public.main_daily_attendance add column source_file_id uuid,
    add column biometric_last_out time, add column biometric_first_in time,
    add column is_deleted boolean not null default false;
    alter table public.generated_undertimes add column employee_id uuid references public.employees(id);
    alter table public.generated_undertimes alter column time_in type text;
    create table public.manual_undertimes(id uuid primary key default gen_random_uuid(), workspace text, employee_id uuid,
      employee_name text, work_date date, is_deleted boolean not null default false);
    create table public.audit_logs(workspace text,actor_id uuid,entity text,entity_id text,action text,payload jsonb);
    create unique index fixture_absence_active on public.absences(employee_id,work_date) where not is_deleted;
    create unique index fixture_undertime_active on public.generated_undertimes(employee_id,work_date) where not is_deleted;
  `);
  await db.exec(fn("037_undertime_identity_and_precedence", "lock_undertime_identity"));
  await db.exec(fn("037_undertime_identity_and_precedence", "guard_generated_undertime_identity"));
  await db.exec(fn("031_enforce_main_absence_uniqueness", "enforce_main_absence_uniqueness"));
  await db.exec(`create trigger generated_undertime_identity_guard before insert or update on public.generated_undertimes
    for each row execute function public.guard_generated_undertime_identity();
    create trigger trg_main_absence_uniqueness before insert or update of employee_id,work_date,source_type,is_deleted on public.absences
    for each row execute function public.enforce_main_absence_uniqueness();`);
  await db.exec(migration("042_service_management_main_integration"));
  await db.exec(migration("043_fix_service_undertime_time_type"));
  await db.exec(migration("047_service_recycle_bin"));
  await db.exec(fn("052_fix_itc_service_time_cast_and_lookup", "create_service_event"));
  await db.exec(fn("052_fix_itc_service_time_cast_and_lookup", "delete_service_event"));
  await db.exec(fn("056_fix_itc_service_save_reconciliation", "update_service_event"));
  await db.exec(migration("059_wais_service_generated_attendance_reconciliation"));
  await db.exec(`insert into auth.users values ('${hr}');
    insert into public.profiles values ('${hr}','WAIS','HR'),('${uid(2)}','WAIS','Admin'),
      ('${uid(3)}','APP','HR'),('${uid(4)}','APP','Admin'),('${uid(5)}','WAIS',null);
    insert into public.employees(id,workspace,hr_scope,full_name) values ('${employee}','WAIS','MAIN','Test Employee'),
      ('${uid(101)}','APP','ITC','APP Employee');
    select set_config('request.jwt.claim.sub','${hr}',false);`);
  return db;
  } catch (error) { await db.close(); throw error; }
}
async function service(db: PGlite, start: string, end: string | null, linked = true) {
  const { rows } = await db.query<{ id: string }>(`insert into public.service_events(service_ref,workspace,service_start,service_end,status,created_by)
    values(gen_random_uuid()::text,'WAIS',$1,$2,$3,$4) returning id`, [start,end,end ? "completed" : "in_service",hr]);
  if (linked) await db.query("insert into public.service_event_employees values($1,$2,'WAIS')", [rows[0].id,employee]);
  return rows[0].id;
}
async function attendance(db: PGlite, date: string, first: string, last: string | null, manual = false) {
  const { rows } = await db.query<{ id: string }>(`insert into public.main_daily_attendance(workspace,employee_id,employee_name,raw_name,work_date,
    first_in,biometric_first_in,last_out,biometric_last_out,checkout_source,status,source_file_name)
    values('WAIS',$1,'Test Employee','Test Employee',$2,$3,$3,$4,$4,$5,$6,'fixture.xlsx') returning id`,
    [employee,date,first,last,manual ? "manual" : last ? "biometric" : null,last ? "complete" : "missing_checkout"]);
  return rows[0].id;
}
async function generated(db: PGlite, type: string, date = day, manual = false, period = "morning", clock = "10:00 AM") {
  const sql = type === "absence"
    ? `insert into public.absences(workspace,employee_id,employee_name,work_date,source_type) values('WAIS',$1,'Test Employee',$2,'${manual ? "manual" : "system_generated"}') returning id::text`
    : type === "half_day"
    ? `insert into public.half_day_records(workspace,employee_id,employee_name,work_date,absent_period,source_type) values('WAIS',$1,'Test Employee',$2,'${period}','${manual ? "manual" : "attendance_upload"}') returning id::text`
    : manual
    ? `insert into public.manual_undertimes(workspace,employee_id,employee_name,work_date) values('WAIS',$1,'Test Employee',$2) returning id::text`
    : `insert into public.generated_undertimes(workspace,employee_id,employee_name,work_date,time_in,minutes_undertime) values('WAIS',$1,'Test Employee',$2,'${clock}',420) returning id::text`;
  return (await db.query<{ id: string }>(sql, [employee,date])).rows[0].id;
}
const table = (type: string) => ({ absence: "absences", half_day: "half_day_records", undertime: "generated_undertimes" })[type]!;
const deleted = async (db: PGlite, type: string, id: string) => (await db.query<{ is_deleted: boolean }>(`select is_deleted from public.${table(type)} where id::text=$1`, [id])).rows[0].is_deleted;
const candidates = async (db: PGlite, type: string, id: string) => (await db.query<{ id: string }>("select id from public.list_eligible_main_services($1,$2)",[type,id])).rows.map(x => x.id);

test("059: actual MAIN SQL coverage, reversible effects and protected attendance actions", async (t) => {
  const db = await database();
  const reset = async () => {
    await db.exec(`truncate public.service_event_effects,public.service_event_employees,public.service_events,
      public.absences,public.half_day_records,public.generated_undertimes,public.manual_undertimes,public.main_daily_attendance cascade;
      select set_config('request.jwt.claim.sub','${hr}',false);`);
  };
  try {
    await t.test("open Service suppresses past covered generated records, preserves future dates and no invented checkout", async () => {
      await reset();
      const absence = await generated(db,"absence"), half = await generated(db,"half_day"), under = await generated(db,"undertime");
      const future = "2099-10-01", futureId = await generated(db,"absence",future);
      await service(db,stamp(day,"08:00"),null);
      for (const [type,id] of [["absence",absence],["half_day",half],["undertime",under]]) assert.equal(await deleted(db,type,id),true);
      assert.equal(await deleted(db,"absence",futureId),false);
      assert.equal((await db.query("select * from public.main_daily_attendance")).rows.length,0);
    });
    await t.test("completed Oct 1–2 Service never suppresses Oct 3 absence", async () => {
      await reset(); await service(db,stamp(day,"08:00"),stamp("2020-10-02","17:00"));
      const first = await generated(db,"absence"), third = await generated(db,"absence","2020-10-03");
      assert.equal(await deleted(db,"absence",first),true); assert.equal(await deleted(db,"absence",third),false);
    });
    await t.test("current open Service covers only elapsed working time and keeps its end blank",async () => {
      await reset();
      const now = (await db.query<{ date:string; elapsed:boolean }>(`select (now() at time zone 'Asia/Manila')::date::text date,
        extract(dow from now() at time zone 'Asia/Manila') between 1 and 6
        and (now() at time zone 'Asia/Manila')::time > case when extract(dow from now() at time zone 'Asia/Manila')=6 then time '07:00' else time '08:00' end elapsed`)).rows[0];
      const a = await generated(db,"absence",now.date), s = await service(db,stamp(now.date,"00:00"),null);
      assert.equal(await deleted(db,"absence",a),now.elapsed);
      assert.deepEqual((await db.query("select service_end from public.service_events where id=$1",[s])).rows,[{service_end:null}]);
      assert.equal((await db.query<{ safe:boolean }>("select coalesce(bool_and(upper(r)<=now()),true) safe from unnest(public.main_service_coverage($1,$2)) r",[employee,now.date])).rows[0].safe,true);
    });
    await t.test("morning Service plus afternoon office suppresses Half-Day and preserves punches", async () => {
      await reset(); const a = await attendance(db,day,"13:00","17:00");
      const h = await generated(db,"half_day"); await service(db,stamp(day,"08:00"),stamp(day,"12:00"));
      assert.equal(await deleted(db,"half_day",h),true);
      assert.deepEqual((await db.query("select first_in,biometric_first_in,biometric_last_out,last_out from public.main_daily_attendance where id=$1",[a])).rows[0],
        { first_in:"13:00:00",biometric_first_in:"13:00:00",biometric_last_out:"17:00:00",last_out:"17:00:00" });
    });
    await t.test("morning office plus afternoon Service covers lunch boundary and final checkout", async () => {
      await reset(); await attendance(db,day,"08:00","12:00");
      const h = await generated(db,"half_day",day,false,"afternoon"), u = await generated(db,"undertime");
      await service(db,stamp(day,"13:00"),stamp(day,"17:00"));
      assert.equal(await deleted(db,"half_day",h),true); assert.equal(await deleted(db,"undertime",u),true);
      assert.deepEqual((await db.query("select biometric_last_out,last_out,checkout_source from public.main_daily_attendance")).rows[0],
        { biometric_last_out:"12:00:00",last_out:"17:00:00",checkout_source:"service" });
    });
    await t.test("partial Service keeps real gap; only connected effective checkout advances", async () => {
      await reset(); await attendance(db,day,"08:00","10:00");
      const u = await generated(db,"undertime"), h = await generated(db,"half_day",day,false,"afternoon");
      await service(db,stamp(day,"10:00"),stamp(day,"14:00"));
      assert.equal(await deleted(db,"undertime",u),false); assert.equal(await deleted(db,"half_day",h),false);
      assert.equal((await db.query<{ undertime_minutes:number }>("select undertime_minutes from public.main_daily_attendance")).rows[0].undertime_minutes,180);
      assert.equal((await db.query<{ minutes_undertime:number }>("select minutes_undertime from public.generated_undertimes where id::text=$1",[u])).rows[0].minutes_undertime,180);
    });
    for (const change of ["cancel","remove","shorten"]) await t.test(`${change} restores original generated identities`,async () => {
      await reset(); const ids = await Promise.all([generated(db,"absence"),generated(db,"half_day"),generated(db,"undertime")]);
      const s = await service(db,stamp(day,"08:00"),stamp(day,"17:00"));
      if (change === "cancel") await db.query("select public.cancel_service_event($1,'WAIS')",[s]);
      if (change === "remove") await db.query("delete from public.service_event_employees where service_event_id=$1",[s]);
      if (change === "shorten") await db.query("update public.service_events set service_end=$2 where id=$1",[s,stamp(day,"09:00")]);
      for (const [index,type] of ["absence","half_day","undertime"].entries()) assert.equal(await deleted(db,type,ids[index]),false);
    });
    await t.test("Service edit RPC reconciles only the final employee set and times",async () => {
      await reset(); const h = await generated(db,"half_day"); const s = await service(db,stamp(day,"08:00"),stamp(day,"09:00"));
      await db.query("select public.update_service_event($1,'SR-0001','WAIS',$2,$3,$4::uuid[])",[s,stamp(day,"08:00"),stamp(day,"17:00"),[employee]]);
      assert.equal(await deleted(db,"half_day",h),true);
      await db.query("select public.update_service_event($1,'SR-0001','WAIS',$2,$3,$4::uuid[])",[s,stamp(day,"08:00"),stamp(day,"09:00"),[employee]]);
      assert.equal(await deleted(db,"half_day",h),false);
    });
    await t.test("two non-overlapping Services combine; removing either restores missing coverage",async () => {
      await reset(); const a = await generated(db,"absence");
      const s1 = await service(db,stamp(day,"08:00"),stamp(day,"12:00"));
      assert.equal(await deleted(db,"absence",a),false);
      await service(db,stamp(day,"13:00"),stamp(day,"17:00"));
      assert.equal(await deleted(db,"absence",a),true);
      await db.query("delete from public.service_event_employees where service_event_id=$1",[s1]);
      assert.equal(await deleted(db,"absence",a),false);
    });
    for (const type of ["absence","half_day","undertime"]) await t.test(`${type} Move to Service links once and suppresses atomically`,async () => {
      await reset(); const id = await generated(db,type); const s = await service(db,stamp(day,"08:00"),stamp(day,"17:00"),false);
      assert.deepEqual(await candidates(db,type,id),[s]);
      await db.query("select public.move_main_generated_attendance_to_service($1,$2,$3)",[type,id,s]);
      assert.equal(await deleted(db,type,id),true);
      assert.equal((await db.query("select * from public.service_event_employees")).rows.length,1);
      await assert.rejects(db.query("select public.move_main_generated_attendance_to_service($1,$2,$3)",[type,id,s]));
      assert.equal((await db.query("select * from public.service_event_employees")).rows.length,1);
    });
    await t.test("candidate list supports explicit choice and rejects insufficient coverage",async () => {
      await reset(); const a = await generated(db,"absence");
      const s1 = await service(db,stamp(day,"08:00"),stamp(day,"17:00"),false);
      const s2 = await service(db,stamp(day,"07:00"),stamp(day,"18:00"),false);
      const partial = await service(db,stamp(day,"10:00"),stamp(day,"14:00"),false);
      assert.deepEqual(new Set(await candidates(db,"absence",a)),new Set([s1,s2]));
      await assert.rejects(db.query("select public.move_main_generated_attendance_to_service('absence',$1,$2)",[a,partial]));
      assert.equal((await db.query("select * from public.service_event_employees")).rows.length,0);
    });
    await t.test("manual attendance rows stay byte-for-byte unchanged",async () => {
      await reset(); await generated(db,"absence",day,true); await generated(db,"half_day",day,true); await generated(db,"undertime",day,true);
      const snapshot = async () => (await db.query("select to_jsonb(a) row from public.absences a union all select to_jsonb(h) from public.half_day_records h union all select to_jsonb(u) from public.manual_undertimes u")).rows;
      const before = await snapshot(); const s = await service(db,stamp(day,"08:00"),stamp(day,"17:00"));
      await db.query("select public.cancel_service_event($1,'WAIS')",[s]); assert.deepEqual(await snapshot(),before);
    });
    await t.test("manual checkout and later biometric checkout take precedence",async () => {
      await reset(); const a = await attendance(db,day,"08:00","10:00",true);
      await service(db,stamp(day,"10:00"),stamp(day,"17:00"));
      assert.equal((await db.query<{ checkout_source:string }>("select checkout_source from public.main_daily_attendance")).rows[0].checkout_source,"manual");
      await db.query("update public.main_daily_attendance set checkout_source='biometric',last_out='18:00',biometric_last_out='18:00' where id=$1",[a]);
      assert.equal((await db.query<{ last_out:string }>("select last_out from public.main_daily_attendance")).rows[0].last_out,"18:00:00");
    });
    await t.test("Saturday uses existing 15:15 schedule boundary",async () => {
      await reset(); const id = await generated(db,"absence","2020-10-03");
      const s = await service(db,stamp("2020-10-03","07:00"),stamp("2020-10-03","15:00"));
      assert.equal(await deleted(db,"absence",id),false);
      await db.query("update public.service_events set service_end=$2 where id=$1",[s,stamp("2020-10-03","15:15")]);
      assert.equal(await deleted(db,"absence",id),true);
    });
    await t.test("Admin, APP, null/missing profiles cannot invoke MAIN mutations",async () => {
      await reset(); const a = await generated(db,"absence"), s = await service(db,stamp(day,"08:00"),stamp(day,"17:00"),false);
      for (const user of [uid(2),uid(3),uid(4),uid(5),uid(999),""]) {
        await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
        await db.exec("set role authenticated");
        try {
          await assert.rejects(db.query("select public.move_main_generated_attendance_to_service('absence',$1,$2)",[a,s]));
          await assert.rejects(db.query("select public.refresh_main_service_attendance()"));
          await assert.rejects(db.query("select public.reconcile_main_service_day($1,$2)",[employee,day]));
        } finally { await db.exec("reset role"); }
      }
      assert.equal(await deleted(db,"absence",a),false);
    });
    await t.test("APP attendance is not touched by MAIN reconciliation",async () => {
      await reset();
      await db.query("insert into public.generated_undertimes(workspace,employee_id,work_date,time_in) values('APP',$1,$2,'01:00 PM')",[uid(101),day]);
      const before = (await db.query("select * from public.generated_undertimes")).rows;
      await service(db,stamp(day,"08:00"),stamp(day,"17:00"));
      assert.deepEqual((await db.query("select * from public.generated_undertimes")).rows,before);
    });
    await t.test("legacy BEFORE INSERT suppression ledger restores an absence that had no saved row",async () => {
      await reset(); const s = await service(db,stamp(day,"08:00"),stamp(day,"17:00"));
      await db.query("insert into public.service_event_effects(service_event_id,employee_id,work_date,suppressed_absence) values($1,$2,$3,true)",[s,employee,day]);
      await db.query("select public.cancel_service_event($1,'WAIS')",[s]);
      assert.deepEqual((await db.query("select source_type,is_deleted from public.absences")).rows,[{ source_type:"system_generated",is_deleted:false }]);
    });
    await t.test("legacy soft suppression keeps its identity and history through reversal",async () => {
      await reset(); const id = await generated(db,"absence");
      await db.query("update public.absences set is_deleted=true,deleted_reason='Service covered the work date' where id::text=$1",[id]);
      const s = await service(db,stamp(day,"08:00"),stamp(day,"17:00"));
      await db.query("insert into public.service_event_effects(service_event_id,employee_id,work_date,suppressed_absence) values($1,$2,$3,true)",[s,employee,day]);
      await db.query("select public.cancel_service_event($1,'WAIS')",[s]);
      assert.equal(await deleted(db,"absence",id),false);
      assert.equal((await db.query("select * from public.absences")).rows.length,1);
    });
    await t.test("manual deletion and deleted upload never resurrect from a Service ledger",async () => {
      await reset(); const id = await generated(db,"absence"), s = await service(db,stamp(day,"08:00"),stamp(day,"17:00"));
      await db.query("update public.absences set deleted_reason='HR deleted record' where id::text=$1",[id]);
      await db.query("select public.cancel_service_event($1,'WAIS')",[s]);
      assert.equal(await deleted(db,"absence",id),true);
      await reset(); await attendance(db,day,"13:00","17:00");
      const h = await generated(db,"half_day"), s2 = await service(db,stamp(day,"08:00"),stamp(day,"12:00"));
      await db.exec("update public.main_daily_attendance set is_deleted=true");
      await db.query("select public.cancel_service_event($1,'WAIS')",[s2]);
      assert.equal(await deleted(db,"half_day",h),true);
    });
    await t.test("cross-date completed checkout and rollback preserve raw Last Out",async () => {
      await reset(); await attendance(db,day,"08:00","10:00"); const u = await generated(db,"undertime");
      const s = await service(db,stamp(day,"10:00"),stamp("2020-10-02","17:00"));
      assert.equal(await deleted(db,"undertime",u),true);
      assert.equal((await db.query<{ d:string }>("select (effective_last_out_at at time zone 'Asia/Manila')::date::text d from public.main_daily_attendance")).rows[0].d,"2020-10-02");
      await db.query("select public.cancel_service_event($1,'WAIS')",[s]);
      assert.equal(await deleted(db,"undertime",u),false);
      assert.deepEqual((await db.query("select biometric_last_out,last_out,checkout_source,undertime_minutes from public.main_daily_attendance")).rows[0],
        { biometric_last_out:"10:00:00",last_out:"10:00:00",checkout_source:"biometric",undertime_minutes:420 });
      assert.equal((await db.query<{ minutes_undertime:number }>("select minutes_undertime from public.generated_undertimes where id::text=$1",[u])).rows[0].minutes_undertime,420);
    });
    await t.test("a remaining valid Service takes ownership of the effect before restoration",async () => {
      await reset(); const a = await generated(db,"absence");
      // Legacy overlapping fixtures exercise transfer without relaxing RPC overlap validation.
      const first = await service(db,stamp(day,"07:00"),stamp(day,"18:00"));
      const second = await service(db,stamp(day,"08:00"),stamp(day,"17:00"));
      await db.query("delete from public.service_event_employees where service_event_id=$1",[first]);
      assert.equal(await deleted(db,"absence",a),true);
      assert.deepEqual((await db.query("select service_event_id from public.service_event_effects where applied and suppressed_absence")).rows,[{service_event_id:second}]);
    });
    await t.test("cross-workspace Services and manual attendance cannot be selected",async () => {
      await reset(); const a = await generated(db,"absence");
      const s = await service(db,stamp(day,"08:00"),stamp(day,"17:00"),false);
      await db.query("update public.service_events set workspace='APP' where id=$1",[s]);
      assert.deepEqual(await candidates(db,"absence",a),[]);
      await assert.rejects(db.query("select public.move_main_generated_attendance_to_service('absence',$1,$2)",[a,s]));
      await reset(); const m = await generated(db,"absence",day,true);
      await assert.rejects(candidates(db,"absence",m));
    });
    await t.test("MAIN HR can use the granted RPC under authenticated role",async () => {
      await reset(); const id = await generated(db,"absence"), s = await service(db,stamp(day,"08:00"),stamp(day,"17:00"),false);
      await db.exec("set role authenticated");
      try { await db.query("select public.move_main_generated_attendance_to_service('absence',$1,$2)",[id,s]); }
      finally { await db.exec("reset role"); }
      assert.equal(await deleted(db,"absence",id),true);
    });
  } finally { await db.close(); }
});
