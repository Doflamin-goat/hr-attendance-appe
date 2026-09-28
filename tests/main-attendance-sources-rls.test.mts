import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = (name: string) => read(`../supabase/migrations/${name}.sql`);
const policy = migration("038_main_attendance_sources_rls");
function functionSql(file: string, name: string) {
  const sql = migration(file);
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `Missing existing function ${name}`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start);
  return sql.slice(start, end + 3);
}
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const mainHr = uid(1), mainAdmin = uid(2), employee = uid(100);

async function database() {
  const db = new PGlite(); // In memory only; no URL, filesystem database, or Supabase connection.
  try {
    await db.exec(read("./fixtures/main-attendance-sources.sql"));
    for (const name of ["attendance_role", "attendance_workspace"]) {
      await db.exec(functionSql("006_staging_only_attendance_workflows", name));
    }
    await db.exec(functionSql("019_employee_hr_scope", "attendance_hr_scope"));
    await db.exec(functionSql("001_employees", "employee_name_key"));
    const daily = migration("020_main_office_attendance");
    await db.exec(daily.slice(daily.indexOf("create table if not exists public.main_daily_attendance"), daily.indexOf("alter table public.absences")));
    await db.exec(`alter table public.main_daily_attendance
      add column source_file_id uuid references public.uploaded_files(id),
      add column biometric_last_out time, add column is_deleted boolean default false,
      add column deleted_at timestamptz, add column deleted_by uuid, add column deleted_batch_id uuid;`);
    const provenance = migration("023_fix_main_delete_and_reconcile_aliases");
    await db.exec(provenance.slice(provenance.indexOf("create table if not exists"), provenance.indexOf("create or replace function public.delete_main_attendance_upload")));
    await db.exec(`create trigger trg_main_daily_import_provenance before insert or update of source_file_name
      on public.main_daily_attendance for each row execute function public.attach_main_import_provenance();`);
    await db.exec(functionSql("034_restore_main_daily_attendance_on_import", "import_main_attendance"));
    await db.exec(functionSql("025_fix_main_deleted_sources_and_date_filters", "delete_main_attendance_upload"));
    await db.exec(functionSql("035_permanently_delete_recycle_bin_item", "permanently_delete_recycle_bin_item"));
    await db.exec(`
      alter table public.main_daily_attendance enable row level security;
      ${daily.match(/create policy "MAIN scope reads daily attendance"[^;]+;/)![0]}
      -- Representative baseline parent policy; deployed uploaded_files policies need manual verification.
      alter table public.uploaded_files enable row level security;
      create policy fixture_files_read on public.uploaded_files for select to authenticated
        using (workspace=public.attendance_workspace() and public.attendance_role() in ('HR','Admin'));
      create policy fixture_files_restore on public.uploaded_files for update to authenticated
        using (workspace=public.attendance_workspace() and public.attendance_role()='HR')
        with check (workspace=public.attendance_workspace() and public.attendance_role()='HR');
      grant select on public.main_daily_attendance, public.uploaded_files to authenticated;
      grant update on public.uploaded_files to authenticated;
      -- Start with broad ACLs to prove 038 removes them.
      grant all on public.main_attendance_sources to public, anon, authenticated;
    `);
    await db.exec(policy);
    const profiles = [
      [1, "WAIS", "HR"], [2, "WAIS", "Admin"], [3, "APP", "HR"], [4, "APP", "Admin"],
      [5, "WAIS", "Viewer"], [6, "WAIS", null], [7, null, "HR"], [8, "INVALID", "HR"],
    ];
    for (const [n, workspace, role] of profiles) {
      await db.query("insert into public.profiles values ($1,$2,$3)", [uid(Number(n)), workspace, role]);
    }
    await db.query("insert into public.employees (id,workspace,hr_scope,full_name) values ($1,'WAIS','MAIN','Policy Test Employee')", [employee]);
    return db;
  } catch (error) { await db.close(); throw error; }
}

async function asUser<T>(db: PGlite, user: string | null, action: () => Promise<T>, role = "authenticated") {
  assert.ok(role === "authenticated" || role === "anon");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
  try { return await action(); }
  finally { await db.exec("reset role"); }
}
const links = (db: PGlite) => db.query<{ daily_attendance_id: string; source_file_id: string }>(
  "select daily_attendance_id, source_file_id from public.main_attendance_sources order by source_file_id");
const importedRow = [{ employeeId: employee, rawName: "Policy Test Employee", workDate: "2026-09-21",
  firstIn: "08:00:00", lastOut: "17:00:00", checkoutSource: "biometric", status: "complete" }];
async function upload(db: PGlite, filename: string) {
  await asUser(db, mainHr, () => db.query("select public.import_main_attendance($1,$2::jsonb,'[]'::jsonb)", [filename, JSON.stringify(importedRow)]));
  const { rows } = await db.query<{ id: string }>("select id from public.uploaded_files where file_name=$1", [filename]);
  return rows[0].id;
}
const denied = (error: unknown) => (error as { code?: string }).code === "42501";

test("038: MAIN HR/Admin read provenance; APP, missing and invalid profiles see no rows", async () => {
  const db = await database();
  try {
    const fileId = await upload(db, "main.xlsx");
    const [{ daily_attendance_id: dailyId }] = (await links(db)).rows;
    // A malformed cross-workspace link must not leak even to MAIN HR/Admin.
    await db.query("insert into public.uploaded_files(id,workspace,file_name) values ($1,'APP','itc.xlsx')", [uid(101)]);
    await db.query("insert into public.main_attendance_sources(daily_attendance_id,source_file_id) values ($1,$2)", [dailyId, uid(101)]);
    // Deleted history is still readable for provenance/Trash behavior.
    await db.query("update public.uploaded_files set is_deleted=true where id=$1", [fileId]);
    await db.query("update public.main_daily_attendance set is_deleted=true where id=$1", [dailyId]);
    for (const user of [mainHr, mainAdmin]) {
      assert.deepEqual((await asUser(db, user, () => links(db))).rows, [{ daily_attendance_id: dailyId, source_file_id: fileId }]);
    }
    for (const user of [uid(3), uid(4), uid(5), uid(6), uid(7), uid(8), uid(999), null]) {
      assert.equal((await asUser(db, user, () => links(db))).rows.length, 0, `Denied identity ${user}`);
    }
    await assert.rejects(asUser(db, null, () => links(db), "anon"), denied);
    const { rows: config } = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity,relforcerowsecurity from pg_class where oid='public.main_attendance_sources'::regclass");
    assert.deepEqual(config, [{ relrowsecurity: true, relforcerowsecurity: false }]);
    const { rows: policies } = await db.query("select policyname,cmd,roles from pg_policies where schemaname='public' and tablename='main_attendance_sources'");
    assert.deepEqual(policies, [{ policyname: "MAIN HR and Admin read attendance sources", cmd: "SELECT", roles: ["authenticated"] }]);
  } finally { await db.close(); }
});

test("038: every client role is denied direct INSERT/UPDATE/DELETE/TRUNCATE", async () => {
  const db = await database();
  try {
    await upload(db, "write-test.xlsx");
    const original = (await links(db)).rows;
    const [{ daily_attendance_id: dailyId, source_file_id: fileId }] = original;
    for (const [role, user] of [["authenticated", mainHr], ["authenticated", mainAdmin],
      ["authenticated", uid(3)], ["authenticated", uid(4)], ["authenticated", uid(999)], ["anon", null]]) {
      for (const sql of [
        `insert into public.main_attendance_sources values ('${dailyId}','${fileId}',now()) on conflict do nothing`,
        "update public.main_attendance_sources set created_at=now()",
        "delete from public.main_attendance_sources", "truncate public.main_attendance_sources",
      ]) {
        await assert.rejects(asUser(db, user, () => db.exec(sql), role!), denied);
      }
    }
    assert.deepEqual((await links(db)).rows, original);
  } finally { await db.close(); }
});

test("038: existing MAIN import, soft delete, file restore and permanent-delete RPC retain provenance", async () => {
  const db = await database();
  try {
    const first = await upload(db, "first.xlsx");
    const second = await upload(db, "second.xlsx");
    assert.equal((await asUser(db, mainHr, () => links(db))).rows.length, 2, "re-import keeps both sources for one employee/day");
    assert.equal((await db.query("select id from public.main_daily_attendance")).rows.length, 1);
    // Manual rows have no source upload and must survive its deletion.
    await db.exec("insert into public.half_day_records(workspace,source_type) values ('WAIS','manual'); insert into public.absences(workspace,source_type) values ('WAIS','manual');");
    await asUser(db, mainHr, () => db.query("select public.delete_main_attendance_upload($1,$2)", [second, uid(200)]));
    assert.equal((await links(db)).rows.length, 2, "soft delete retains links");
    assert.equal((await db.query("select id from public.main_daily_attendance where not is_deleted")).rows.length, 1, "another active source preserves the day");
    // Restore uses uploaded_files/batch updates, never direct source-link writes.
    await asUser(db, mainHr, () => db.query("update public.uploaded_files set is_deleted=false,deleted_batch_id=null where id=$1", [second]));
    assert.equal((await asUser(db, mainAdmin, () => links(db))).rows.length, 2);
    await asUser(db, mainHr, () => db.query("select public.delete_main_attendance_upload($1,$2)", [second, uid(201)]));
    const removed = await asUser(db, mainHr, () => db.query<{ removed: boolean }>(
      "select public.permanently_delete_recycle_bin_item('uploaded_file',$1) as removed", [second]));
    assert.equal(removed.rows[0].removed, true);
    assert.deepEqual((await links(db)).rows.map(row => row.source_file_id), [first]);
    await asUser(db, mainHr, () => db.query("select public.delete_main_attendance_upload($1,$2)", [first, uid(202)]));
    assert.equal((await db.query("select id from public.main_daily_attendance where is_deleted")).rows.length, 1, "last active source deletion marks the day deleted");
    assert.equal((await asUser(db, mainHr, () => links(db))).rows.length, 1, "last source still retained for Trash");
    await upload(db, "restored-by-import.xlsx");
    assert.equal((await db.query("select id from public.main_daily_attendance where not is_deleted")).rows.length, 1);
    assert.equal((await links(db)).rows.length, 2);
    for (const table of ["half_day_records", "absences"]) {
      assert.equal((await db.query(`select id from public.${table} where source_type='manual' and not is_deleted`)).rows.length, 1);
    }
    // Existing role guards still deny valid Admin/ITC profiles on MAIN write RPCs.
    for (const user of [mainAdmin, uid(3), uid(4)]) {
      await assert.rejects(asUser(db, user, () => db.query("select public.import_main_attendance('denied.xlsx',$1::jsonb,'[]'::jsonb)", [JSON.stringify(importedRow)])), /MAIN HR access required/);
      await assert.rejects(asUser(db, user, () => db.query("select public.delete_main_attendance_upload($1,$2)", [first, uid(203)])), /MAIN HR access required/);
    }
  } finally { await db.close(); }
});
