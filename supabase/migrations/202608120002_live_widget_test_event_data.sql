-- Reproduce the complete v0.4 engine configuration for the dedicated live test event.
-- The production event is intentionally not modified by this readiness data patch.

insert into public.curse_definitions (event_id, key, name, duration_ms, intensity, config)
select e.id, v.key, v.name, v.duration_ms, 0.7, v.config
from public.events e cross join (values
  ('fog', 'Geisternebel', 12000, '{"max_opacity":0.3}'::jsonb),
  ('zombie_hands', 'Zombiehände', 10000, '{"center_clear":true}'::jsonb),
  ('spider_web', 'Spinnenbefall', 12000, '{"center_clear":true}'::jsonb),
  ('witch_distortion', 'Hexenfluch', 11000, '{"motion_safe":true}'::jsonb),
  ('bat_attack', 'Fledermausangriff', 10000, '{"center_clear":true}'::jsonb),
  ('darkness', 'Dunkelheit', 10000, '{"blackout_max_ms":1500}'::jsonb),
  ('royal_curse', 'Königlicher Fluch', 12000, '{"center_clear":true}'::jsonb)
) v(key, name, duration_ms, config)
where e.slug='halloween-2026-test'
on conflict (event_id, key) do update set
  name=excluded.name, duration_ms=excluded.duration_ms, intensity=excluded.intensity,
  config=excluded.config, enabled=true, updated_at=now();

insert into public.minion_damage_classes (
  event_id, damage_class, base_damage, community_exponent, minimum_factor, maximum_factor, provisional
)
select e.id, v.damage_class, v.base_damage, 0.25, 0.75, 2, true
from public.events e cross join (values
  ('STANDARD', 5000::bigint), ('HIGH', 8000::bigint),
  ('ELITE', 12000::bigint), ('SPECIAL', 15000::bigint)
) v(damage_class, base_damage)
where e.slug='halloween-2026-test'
on conflict (event_id, damage_class) do update set
  base_damage=excluded.base_damage, community_exponent=excluded.community_exponent,
  minimum_factor=excluded.minimum_factor, maximum_factor=excluded.maximum_factor, provisional=true;

insert into public.minion_questions (
  event_id, question, answer_a, answer_b, answer_c, correct_answer, difficulty, enabled
)
select e.id, 'Welches Tier wird klassisch mit Vampiren verbunden?', 'Wolf', 'Fledermaus', 'Katze', 'b', 1, true
from public.events e
where e.slug='halloween-2026-test'
  and not exists(select 1 from public.minion_questions q where q.event_id=e.id);

insert into public.minion_definitions (
  event_id, key, name, icon, command, base_damage, duration_seconds, type, game_mode,
  intro_title, gameplay_title, instruction, intro_duration_ms, observe_duration_seconds,
  damage_class, failure_curse_key, phase_min, weight, min_participants, max_participants,
  curve_exponent, participation_factor, config, enabled
)
select e.id, v.key, v.name, v.icon, '!boss', 0, v.duration_seconds, lower(v.game_mode), v.game_mode,
  v.intro_title, v.gameplay_title, v.instruction, v.intro_duration_ms, v.observe_seconds,
  v.damage_class, v.curse_key, v.phase_min, v.weight, v.min_required, v.max_required,
  0.72, v.participation_factor, v.config, true
from public.events e cross join (values
  ('ghost','Rastloser Geist','👻',40,'PARTICIPATION','Ein Geist ist erschienen!','Fangt den Geist!','Schreibe !boss',3000,0,'STANDARD','fog',1,1.0,2,24,0.45,'{}'::jsonb),
  ('zombie_horde','Zombiehorde','🧟',25,'VISUAL_CHOICE','Eine Horde nähert sich!','Wo greift die Horde an?','!boss links · mitte · rechts',3000,4,'STANDARD','zombie_hands',1,1.0,2,24,0.42,'{"options":["links","mitte","rechts"],"tie_strategy":"failure"}'::jsonb),
  ('spider_queen','Spinnenkönigin','🕷️',25,'VISUAL_CHOICE','Die Spinnenkönigin kriecht heran!','Findet die Königin!','Schreibe z. B. !boss 4',3000,0,'STANDARD','spider_web',1,1.0,2,24,0.42,'{"min_options":4,"max_options":6}'::jsonb),
  ('witch','Die Hexe','🧙',35,'VOTE','Die Hexe stellt euch eine Frage!','Die Hexe fragt:','Antworte mit !boss A, B oder C',3000,0,'HIGH','witch_distortion',2,1.1,2,26,0.40,'{"options":["a","b","c"],"tie_strategy":"failure"}'::jsonb),
  ('bat_swarm','Fledermausschwarm','🦇',20,'MEMORY','Ein Schwarm verdunkelt den Himmel!','Wie viele waren es?','Schreibe z. B. !boss 7',3000,5,'STANDARD','bat_attack',2,1.05,2,24,0.42,'{"min_count":4,"max_count":12}'::jsonb),
  ('reaper','Der Sensenmann','💀',25,'MEMORY','Der Sensenmann prüft euer Gedächtnis!','Welche Folge war richtig?','Antworte mit !boss A, B oder C',3000,4,'HIGH','darkness',3,0.7,2,26,0.40,'{"options":["a","b","c"],"tie_strategy":"failure"}'::jsonb),
  ('kings_herald','Herold des Königs','👑',45,'PARTICIPATION','Verstärkung ist eingetroffen!','Schlagt den Herold zurück!','Schreibe !boss',4000,0,'ELITE','royal_curse',1,0.0,4,38,0.55,'{"raid_special":true}'::jsonb)
) v(key,name,icon,duration_seconds,game_mode,intro_title,gameplay_title,instruction,intro_duration_ms,observe_seconds,damage_class,curse_key,phase_min,weight,min_required,max_required,participation_factor,config)
where e.slug='halloween-2026-test'
on conflict (event_id, key) do update set
  name=excluded.name, icon=excluded.icon, command=excluded.command,
  duration_seconds=excluded.duration_seconds, type=excluded.type, game_mode=excluded.game_mode,
  intro_title=excluded.intro_title, gameplay_title=excluded.gameplay_title,
  instruction=excluded.instruction, intro_duration_ms=excluded.intro_duration_ms,
  observe_duration_seconds=excluded.observe_duration_seconds, damage_class=excluded.damage_class,
  failure_curse_key=excluded.failure_curse_key, phase_min=excluded.phase_min,
  weight=excluded.weight, min_participants=excluded.min_participants,
  max_participants=excluded.max_participants, curve_exponent=excluded.curve_exponent,
  participation_factor=excluded.participation_factor, config=excluded.config, enabled=true;
