-- Deterministic, fictional data. Safe to re-run after `supabase db reset`.
insert into public.events (id, slug, name, description, status)
values
  ('00000000-0000-4000-8000-000000000101', 'halloween-2026-test', 'Kürbiskönig Community Event – Test', 'Sicherer Testlauf für das streamerübergreifende Halloween-Event.', 'testing'),
  ('00000000-0000-4000-8000-000000000102', 'halloween-2026', 'Kürbiskönig Community Event 2026', 'Vorbereitete Produktionsinstanz. Vor dem Start prüfen und explizit aktivieren.', 'draft')
on conflict (id) do nothing;

insert into public.bosses (id, event_id, name, max_hp, current_hp)
values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'Kürbiskönig', 10000000, 7438920),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000102', 'Kürbiskönig', 10000000, 10000000)
on conflict (id) do nothing;

insert into public.boss_phases (event_id, boss_id, phase_number, name, min_percent, max_percent, color, sort_order)
select b.event_id, b.id, p.phase_number, p.name, p.min_percent, p.max_percent, p.color, p.phase_number
from public.bosses b
cross join (values
  (1, 'Das Erwachen', 75::numeric, 100::numeric, '#f28a2e'),
  (2, 'Der Fluch', 50::numeric, 75::numeric, '#d96d35'),
  (3, 'Die Dunkelheit', 25::numeric, 50::numeric, '#a662cb'),
  (4, 'Der Untergang', 0::numeric, 25::numeric, '#d85d44')
) p(phase_number, name, min_percent, max_percent, color)
on conflict (boss_id, phase_number) do nothing;

insert into public.milestones (event_id, boss_id, name, description, hp_percent, sort_order, reached_at)
select b.event_id, b.id, m.name, m.description, m.hp_percent, m.sort_order,
  case when e.status = 'testing' and m.hp_percent = 75 then now() else null end
from public.bosses b join public.events e on e.id = b.event_id
cross join (values
  ('Erstes Siegel gebrochen', 'Der Kürbiskönig verliert seine erste Schutzschicht.', 75::numeric, 1),
  ('Der Fluch wankt', 'Die vereinten Communities drängen den Fluch zurück.', 50::numeric, 2),
  ('Schattenkrone gespalten', 'Nur noch ein Viertel der Boss-HP bleibt.', 25::numeric, 3),
  ('Finale Warnung', 'Der Kürbiskönig steht kurz vor dem Fall.', 10::numeric, 4)
) m(name, description, hp_percent, sort_order)
on conflict (boss_id, hp_percent) do nothing;

insert into public.event_settings (event_id, event_paused, damage_enabled, minions_enabled,
  global_damage_multiplier, passive_damage_multiplier, active_damage_multiplier, passive_tick_seconds)
select id, status = 'draft', true, true, 1, 1, 1, 120 from public.events
on conflict (event_id) do nothing;

insert into public.streamers (id, event_id, slug, display_name, community_name, twitch_login, twitch_url, sort_order)
values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000101', 'nachtfalter', 'Nachtfalter', 'Nachtfalter Nest', 'nachtfalter_test', 'https://twitch.tv/nachtfalter_test', 1),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000101', 'geisterstunde', 'Geisterstunde', 'Geisterstunde Crew', 'geisterstunde_test', 'https://twitch.tv/geisterstunde_test', 2),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000101', 'mooslicht', 'Mooslicht', 'Mooslicht Zirkel', 'mooslicht_test', 'https://twitch.tv/mooslicht_test', 3)
on conflict (id) do nothing;

insert into public.minion_definitions (id, event_id, key, name, command, base_damage, duration_seconds)
select case when status = 'testing' then '00000000-0000-4000-8000-000000000401'::uuid else '00000000-0000-4000-8000-000000000402'::uuid end,
  id, 'ghost', 'Geist', '!boss', 0, 40
from public.events e
where not exists (
  select 1
  from public.minion_definitions d
  where d.event_id = e.id
    and d.key = 'ghost'
)
on conflict (event_id, key) do nothing;

-- Supabase-Auth-Nutzer werden absichtlich nicht geseedet. Nach dem Anlegen eines
-- Testkontos dessen auth.users.id über das Beispiel in docs/SUPABASE_SETUP.md zuweisen.
