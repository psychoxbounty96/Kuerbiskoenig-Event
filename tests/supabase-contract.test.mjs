import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/202608110001_v0_2_core.sql", import.meta.url);
const functionUrl = new URL("../supabase/functions/admin-event-action/index.ts", import.meta.url);
const providerUrl = new URL("../app/lib/providers/supabase-data-provider.ts", import.meta.url);
const adminPageUrl = new URL("../app/admin/page.tsx", import.meta.url);

test("migration contains the complete v0.2 model and strict RLS", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of [
    "events", "bosses", "boss_phases", "milestones", "streamers", "damage_events",
    "minion_definitions", "minion_events", "event_settings", "event_admins", "admin_audit_log",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /revoke all on all tables in schema public from anon, authenticated/i);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all).*to anon/i);
});

test("damage function locks, re-checks idempotency and clamps HP", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const damageFunction = sql.slice(sql.indexOf("create or replace function public.apply_boss_damage"), sql.indexOf("create or replace function public.admin_set_boss_hp"));
  assert.match(damageFunction, /for update/i);
  assert.ok((damageFunction.match(/idempotency_key = p_idempotency_key/g) ?? []).length >= 2);
  assert.match(damageFunction, /least\(v_boss\.current_hp, v_requested\)/i);
  assert.match(damageFunction, /greatest\(0, v_boss\.current_hp - v_applied\)/i);
  assert.match(damageFunction, /boss_hp_before, boss_hp_after/i);
  assert.match(damageFunction, /event_paused or not v_settings\.damage_enabled/i);
  assert.match(sql, /revoke all on function public\.apply_boss_damage[\s\S]*from public, anon, authenticated/i);
});

test("minions are scoped per streamer and late success is rejected", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /on public\.minion_events \(event_id, streamer_id, minion_definition_id\)[\s\S]*where status = 'active'/i);
  assert.match(sql, /v_minion\.expires_at <= now\(\) and p_resolution = 'success'/i);
  assert.match(sql, /raise exception 'minion_expired'/i);
});

test("Edge Function verifies auth and event membership before dispatch", async () => {
  const source = await readFile(functionUrl, "utf8");
  assert.match(source, /service\.auth\.getUser\(token\)/);
  assert.match(source, /from\("event_admins"\)/);
  assert.match(source, /not_an_event_admin/);
  assert.match(source, /viewer_is_read_only/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE/);
});

test("admin auth refresh keeps an authorized dashboard stable across tab changes", async () => {
  const [provider, adminPage] = await Promise.all([
    readFile(providerUrl, "utf8"),
    readFile(adminPageUrl, "utf8"),
  ]);
  assert.match(provider, /keepAuthorizedState[\s\S]+authenticated:\s*keepAuthorizedState/);
  assert.match(provider, /adminSessionValidationId[\s\S]+validationId !== this\.adminSessionValidationId/);
  assert.match(adminPage, /session\.loading\s*&&\s*!session\.authenticated/);
  assert.match(adminPage, /Admin-Sitzung wird geprüft/);
});
