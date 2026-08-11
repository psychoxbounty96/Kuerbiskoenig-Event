-- Kürbiskönig v0.4: generic per-streamer minion engine.
-- Chat is a soft-trust StreamElements input. Every authoritative decision remains in SQL.

alter table public.minion_events drop constraint if exists minion_events_status_check;
update public.minion_events set status = 'failure' where status = 'failed';
alter table public.minion_events add constraint minion_events_status_check check (
  status in ('scheduled', 'intro', 'active', 'success', 'failure', 'curse', 'complete', 'cancelled', 'expired')
);

drop index if exists public.minion_events_one_active_type_per_streamer;
create unique index if not exists minion_events_one_runtime_per_streamer
  on public.minion_events (event_id, streamer_id)
  where status in ('intro', 'active', 'success', 'failure', 'curse');

alter table public.minion_definitions
  add column if not exists game_mode text not null default 'PARTICIPATION',
  add column if not exists icon text not null default '👻',
  add column if not exists intro_title text not null default '',
  add column if not exists gameplay_title text not null default '',
  add column if not exists instruction text not null default 'Schreibe !boss',
  add column if not exists intro_duration_ms integer not null default 3000,
  add column if not exists observe_duration_seconds integer not null default 0,
  add column if not exists damage_class text not null default 'STANDARD',
  add column if not exists failure_curse_key text,
  add column if not exists phase_min smallint not null default 1,
  add column if not exists weight numeric(10,4) not null default 1,
  add column if not exists min_participants integer not null default 2,
  add column if not exists max_participants integer not null default 24,
  add column if not exists curve_exponent numeric(10,4) not null default 0.72,
  add column if not exists participation_factor numeric(10,4) not null default 0.45,
  add column if not exists config jsonb not null default '{}'::jsonb;

alter table public.minion_definitions drop constraint if exists minion_definitions_game_mode_check;
alter table public.minion_definitions add constraint minion_definitions_game_mode_check
  check (game_mode in ('PARTICIPATION', 'VOTE', 'VISUAL_CHOICE', 'MEMORY'));
alter table public.minion_definitions drop constraint if exists minion_definitions_damage_class_check;
alter table public.minion_definitions add constraint minion_definitions_damage_class_check
  check (damage_class in ('STANDARD', 'HIGH', 'ELITE', 'SPECIAL'));
alter table public.minion_definitions drop constraint if exists minion_definitions_limits_check;
alter table public.minion_definitions add constraint minion_definitions_limits_check check (
  intro_duration_ms between 1000 and 15000 and observe_duration_seconds between 0 and 15 and
  phase_min between 1 and 4 and weight >= 0 and min_participants > 0 and
  max_participants >= min_participants and curve_exponent > 0 and participation_factor >= 0
);

alter table public.minion_events
  add column if not exists viewer_estimate integer not null default 4,
  add column if not exists duration_seconds integer not null default 40,
  add column if not exists damage_class text not null default 'STANDARD',
  add column if not exists runtime_config jsonb not null default '{}'::jsonb,
  add column if not exists intro_ends_at timestamptz,
  add column if not exists gameplay_starts_at timestamptz,
  add column if not exists accepts_answers_at timestamptz,
  add column if not exists result_ends_at timestamptz,
  add column if not exists curse_ends_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists display_until timestamptz,
  add column if not exists trigger_source text not null default 'admin',
  add column if not exists trigger_reference text;

update public.minion_events set
  intro_ends_at = coalesce(intro_ends_at, spawned_at),
  gameplay_starts_at = coalesce(gameplay_starts_at, spawned_at),
  accepts_answers_at = coalesce(accepts_answers_at, spawned_at),
  display_until = coalesce(display_until, resolved_at + interval '15 seconds');

alter table public.minion_events alter column intro_ends_at set not null;
alter table public.minion_events alter column gameplay_starts_at set not null;
alter table public.minion_events alter column accepts_answers_at set not null;
alter table public.minion_events drop constraint if exists minion_events_damage_class_check;
alter table public.minion_events add constraint minion_events_damage_class_check
  check (damage_class in ('STANDARD', 'HIGH', 'ELITE', 'SPECIAL'));
alter table public.minion_events drop constraint if exists minion_events_trigger_source_check;
alter table public.minion_events add constraint minion_events_trigger_source_check
  check (trigger_source in ('scheduler', 'raid', 'admin', 'manual_test'));

alter table public.event_settings
  add column if not exists minion_participation_factor numeric(10,4) not null default 0.45,
  add column if not exists raid_special_delay_min_seconds integer not null default 90,
  add column if not exists raid_special_delay_max_seconds integer not null default 120,
  add column if not exists raid_post_cooldown_min_seconds integer not null default 600,
  add column if not exists raid_post_cooldown_max_seconds integer not null default 900;

create table if not exists public.curse_definitions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  key text not null,
  name text not null,
  duration_ms integer not null check (duration_ms between 1000 and 15000),
  intensity numeric(5,2) not null default 0.7 check (intensity between 0 and 1.1),
  phase_scaling jsonb not null default '{"1":0.7,"2":0.85,"3":1.0,"4":1.1}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, key)
);

create table if not exists public.minion_damage_classes (
  event_id uuid not null references public.events(id) on delete cascade,
  damage_class text not null check (damage_class in ('STANDARD', 'HIGH', 'ELITE', 'SPECIAL')),
  base_damage bigint not null check (base_damage >= 0),
  community_exponent numeric(10,4) not null default 0.25 check (community_exponent between 0 and 1),
  minimum_factor numeric(10,4) not null default 0.75 check (minimum_factor >= 0),
  maximum_factor numeric(10,4) not null default 2 check (maximum_factor >= minimum_factor),
  provisional boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  primary key (event_id, damage_class)
);

create table if not exists public.minion_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  question text not null,
  answer_a text not null,
  answer_b text not null,
  answer_c text not null,
  correct_answer text not null check (correct_answer in ('a', 'b', 'c')),
  difficulty smallint not null default 1 check (difficulty between 1 and 5),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.minion_event_secrets (
  minion_event_id uuid primary key references public.minion_events(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  correct_answer text,
  created_at timestamptz not null default now()
);

create table if not exists public.minion_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  minion_event_id uuid not null references public.minion_events(id) on delete cascade,
  participant_key text not null check (length(participant_key) between 32 and 128),
  answer text,
  message_id text not null check (length(message_id) between 1 and 160),
  submitted_at timestamptz not null default now(),
  unique (minion_event_id, participant_key),
  unique (minion_event_id, message_id)
);
create index if not exists minion_participants_retention on public.minion_participants (submitted_at);

create table if not exists public.minion_submission_rate_limits (
  event_id uuid not null references public.events(id) on delete cascade,
  participant_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (event_id, participant_key, window_started_at)
);

create table if not exists public.minion_system_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  minion_event_id uuid references public.minion_events(id) on delete cascade,
  streamer_id uuid references public.streamers(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists minion_system_log_event_created on public.minion_system_log (event_id, created_at desc);

create table if not exists public.minion_spawn_schedules (
  event_id uuid not null references public.events(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  next_spawn_at timestamptz,
  cooldown_until timestamptz,
  phase_number smallint,
  updated_at timestamptz not null default now(),
  primary key (event_id, streamer_id)
);

create table if not exists public.minion_special_queue (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  minion_key text not null,
  due_at timestamptz not null,
  trigger_source text not null check (trigger_source = 'raid'),
  trigger_reference text not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'spawned', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, trigger_source, trigger_reference)
);

alter table public.curse_definitions enable row level security;
alter table public.minion_damage_classes enable row level security;
alter table public.minion_questions enable row level security;
alter table public.minion_event_secrets enable row level security;
alter table public.minion_participants enable row level security;
alter table public.minion_submission_rate_limits enable row level security;
alter table public.minion_system_log enable row level security;
alter table public.minion_spawn_schedules enable row level security;
alter table public.minion_special_queue enable row level security;

revoke all on public.minion_damage_classes, public.minion_questions, public.minion_event_secrets,
  public.minion_participants, public.minion_submission_rate_limits, public.minion_system_log,
  public.minion_spawn_schedules, public.minion_special_queue from anon, authenticated;
grant select on public.curse_definitions to anon, authenticated;
create policy curse_definitions_public_read on public.curse_definitions for select to anon, authenticated using (
  enabled and exists (select 1 from public.events e where e.id = event_id and e.status in ('testing', 'active', 'paused', 'finished', 'archived'))
);

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
on conflict (event_id, key) do update set name = excluded.name, duration_ms = least(15000, excluded.duration_ms), config = excluded.config;

insert into public.minion_damage_classes (event_id, damage_class, base_damage, community_exponent, minimum_factor, maximum_factor, provisional)
select e.id, v.damage_class, v.base_damage, 0.25, 0.75, 2, true
from public.events e cross join (values
  ('STANDARD', 5000::bigint), ('HIGH', 8000::bigint), ('ELITE', 12000::bigint), ('SPECIAL', 15000::bigint)
) v(damage_class, base_damage)
on conflict (event_id, damage_class) do nothing;

insert into public.minion_questions (event_id, question, answer_a, answer_b, answer_c, correct_answer)
select e.id, 'Welches Tier wird klassisch mit Vampiren verbunden?', 'Wolf', 'Fledermaus', 'Katze', 'b'
from public.events e where not exists (select 1 from public.minion_questions q where q.event_id = e.id);

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
on conflict (event_id, key) do update set
  name=excluded.name, icon=excluded.icon, command='!boss', duration_seconds=excluded.duration_seconds,
  type=excluded.type, game_mode=excluded.game_mode, intro_title=excluded.intro_title,
  gameplay_title=excluded.gameplay_title, instruction=excluded.instruction,
  intro_duration_ms=excluded.intro_duration_ms, observe_duration_seconds=excluded.observe_duration_seconds,
  damage_class=excluded.damage_class, failure_curse_key=excluded.failure_curse_key,
  phase_min=excluded.phase_min, weight=excluded.weight, min_participants=excluded.min_participants,
  max_participants=excluded.max_participants, curve_exponent=excluded.curve_exponent,
  participation_factor=excluded.participation_factor, config=excluded.config, enabled=true;

create or replace function public.log_minion_system_event(
  p_event_id uuid, p_minion_event_id uuid, p_streamer_id uuid, p_event_type text, p_metadata jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.minion_system_log(event_id, minion_event_id, streamer_id, event_type, metadata)
  values (p_event_id, p_minion_event_id, p_streamer_id, left(p_event_type, 80), coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function public.stable_viewer_estimate(p_event_id uuid, p_streamer_id uuid, p_fallback integer default 4)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  with recent as (
    select viewer_count from public.viewer_samples
    where event_id = p_event_id and streamer_id = p_streamer_id and viewer_count >= 0
    order by sampled_at desc limit 3
  )
  select greatest(1, coalesce(round(percentile_cont(0.5) within group (order by viewer_count))::integer, greatest(1, p_fallback))) from recent;
$$;

create or replace function public.calculate_required_participants(p_viewer_estimate integer, p_definition_id uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(d.min_participants, least(d.max_participants,
    round(d.min_participants + d.participation_factor * power(greatest(1, p_viewer_estimate), d.curve_exponent))::integer))
  from public.minion_definitions d where d.id = p_definition_id;
$$;

create or replace function public.build_minion_runtime_config(p_event_id uuid, p_key text, p_phase smallint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_answer text; v_count integer; v_question public.minion_questions%rowtype; v_option_count integer;
begin
  if p_key = 'zombie_horde' then
    v_answer := (array['links','mitte','rechts'])[1 + floor(random()*3)::integer];
    return jsonb_build_object('options', array['links','mitte','rechts'], 'correct_answer', v_answer,
      'visual_target', v_answer, 'tie_strategy', 'failure');
  elsif p_key = 'spider_queen' then
    v_option_count := least(6, case when p_phase >= 3 then 6 when p_phase = 2 then 5 else 4 end);
    v_answer := (1 + floor(random()*v_option_count)::integer)::text;
    return jsonb_build_object('options', (select jsonb_agg(x::text) from generate_series(1,v_option_count) x),
      'correct_answer', v_answer, 'queen_index', v_answer, 'marker', 'crown');
  elsif p_key = 'witch' then
    select * into v_question from public.minion_questions where event_id=p_event_id and enabled order by random() limit 1;
    return jsonb_build_object('question', v_question.question, 'options', array['a','b','c'],
      'option_labels', jsonb_build_object('a',v_question.answer_a,'b',v_question.answer_b,'c',v_question.answer_c),
      'correct_answer', v_question.correct_answer, 'tie_strategy', 'failure');
  elsif p_key = 'bat_swarm' then
    v_count := 4 + floor(random()*9)::integer;
    return jsonb_build_object('options',(select jsonb_agg(x::text) from generate_series(4,12) x),
      'correct_answer',v_count::text,'count',v_count);
  elsif p_key = 'reaper' then
    return jsonb_build_object('sequence',array['💀','🕯️','🎃'],'options',array['a','b','c'],
      'option_labels',jsonb_build_object('a','🎃 → 🕯️ → 💀','b','💀 → 🕯️ → 🎃','c','🕯️ → 💀 → 🎃'),
      'correct_answer','b','tie_strategy','failure');
  end if;
  return jsonb_build_object('options','[]'::jsonb);
end;
$$;

create or replace function public.spawn_minion_v4(
  p_event_id uuid, p_definition_id uuid, p_streamer_id uuid, p_force boolean default false,
  p_trigger_source text default 'scheduler', p_trigger_reference text default null, p_spawned_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_definition public.minion_definitions%rowtype; v_settings public.event_settings%rowtype;
  v_event public.events%rowtype; v_boss public.bosses%rowtype; v_id uuid; v_viewers integer;
  v_required integer; v_phase smallint; v_runtime jsonb; v_intro_end timestamptz;
  v_gameplay_start timestamptz; v_accepts timestamptz; v_expires timestamptz; v_status text;
begin
  if p_trigger_source not in ('scheduler','raid','admin','manual_test') then raise exception 'invalid_trigger_source'; end if;
  select * into v_event from public.events where id=p_event_id;
  select * into v_settings from public.event_settings where event_id=p_event_id;
  select * into v_boss from public.bosses where event_id=p_event_id for update;
  if not found or v_boss.current_hp <= 0 then raise exception 'boss_defeated'; end if;
  if not p_force and (v_event.status <> 'active' or v_settings.event_paused or not v_settings.minions_enabled) then raise exception 'minions_disabled'; end if;
  if not exists (select 1 from public.streamers s where s.id=p_streamer_id and s.event_id=p_event_id and s.enabled) then raise exception 'streamer_not_available'; end if;
  if not p_force and not exists (select 1 from public.streamer_runtime r where r.event_id=p_event_id and r.streamer_id=p_streamer_id and r.is_live) then raise exception 'streamer_offline'; end if;
  if exists (select 1 from public.minion_events m where m.event_id=p_event_id and m.streamer_id=p_streamer_id and m.status in ('intro','active','success','failure','curse')) then raise exception 'streamer_minion_already_active'; end if;
  select * into v_definition from public.minion_definitions where id=p_definition_id and event_id=p_event_id and enabled;
  if not found then raise exception 'minion_definition_not_found'; end if;
  v_phase := public.current_phase(v_boss.current_hp,v_boss.max_hp);
  if not p_force and v_definition.phase_min > v_phase then raise exception 'minion_not_available_in_phase'; end if;
  v_viewers := public.stable_viewer_estimate(p_event_id,p_streamer_id,greatest(4,coalesce((select current_viewer_count from public.streamer_runtime where streamer_id=p_streamer_id),4)));
  v_required := public.calculate_required_participants(v_viewers,v_definition.id);
  v_runtime := public.build_minion_runtime_config(p_event_id,v_definition.key,v_phase);
  v_intro_end := p_spawned_at + make_interval(secs => v_definition.intro_duration_ms::numeric/1000);
  v_gameplay_start := v_intro_end;
  v_accepts := v_gameplay_start + make_interval(secs => v_definition.observe_duration_seconds);
  v_expires := v_accepts + make_interval(secs => v_definition.duration_seconds);
  v_status := case when p_spawned_at > now() then 'scheduled' else 'intro' end;
  insert into public.minion_events(event_id,run_id,minion_definition_id,streamer_id,status,viewer_estimate,
    required_participants,participant_count,duration_seconds,damage_class,runtime_config,spawned_at,
    intro_ends_at,gameplay_starts_at,accepts_answers_at,expires_at,trigger_source,trigger_reference)
  values(p_event_id,v_boss.run_id,v_definition.id,p_streamer_id,v_status,v_viewers,v_required,0,
    v_definition.duration_seconds,v_definition.damage_class,v_runtime-'correct_answer',p_spawned_at,
    v_intro_end,v_gameplay_start,v_accepts,v_expires,p_trigger_source,p_trigger_reference)
  returning id into v_id;
  insert into public.minion_event_secrets(minion_event_id,event_id,correct_answer)
    values(v_id,p_event_id,v_runtime->>'correct_answer');
  perform public.log_minion_system_event(p_event_id,v_id,p_streamer_id,case when v_status='scheduled' then 'scheduled' else 'spawned' end,
    jsonb_build_object('trigger_source',p_trigger_source,'viewer_estimate',v_viewers,'required_participants',v_required));
  perform public.touch_event(p_event_id);
  return jsonb_build_object('minionEventId',v_id,'status',v_status,'viewerEstimate',v_viewers,'requiredParticipants',v_required);
end;
$$;

create or replace function public.resolve_minion_v4(
  p_event_id uuid, p_minion_event_id uuid, p_resolution text, p_actor_user_id uuid default null,
  p_force boolean default false, p_resolution_source text default 'system'
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_minion public.minion_events%rowtype; v_definition public.minion_definitions%rowtype;
  v_settings public.event_settings%rowtype; v_event public.events%rowtype; v_boss public.bosses%rowtype;
  v_class public.minion_damage_classes%rowtype; v_factor numeric; v_raw bigint; v_damage jsonb; v_awarded bigint:=0; v_status text;
begin
  v_status := case when p_resolution='failed' then 'failure' else p_resolution end;
  if v_status not in ('success','failure','cancelled','expired') then raise exception 'invalid_resolution'; end if;
  select * into v_minion from public.minion_events where id=p_minion_event_id and event_id=p_event_id for update;
  if not found then raise exception 'minion_not_found'; end if;
  if v_minion.status not in ('scheduled','intro','active') then return jsonb_build_object('idempotent',true,'status',v_minion.status,'damageAwarded',v_minion.damage_awarded); end if;
  if v_status='success' and v_minion.expires_at <= now() and not p_force then raise exception 'minion_expired'; end if;
  select * into v_settings from public.event_settings where event_id=p_event_id;
  select * into v_event from public.events where id=p_event_id;
  select * into v_boss from public.bosses where event_id=p_event_id;
  if v_status='success' and not p_force and (v_event.status <> 'active' or v_settings.event_paused or not v_settings.minions_enabled) then raise exception 'minions_disabled'; end if;
  update public.minion_events set status=v_status,resolved_at=now(),resolved_by=p_actor_user_id,
    result_ends_at=now()+interval '4 seconds',display_until=now()+interval '19 seconds' where id=v_minion.id;
  if v_status='success' and v_boss.current_hp > 0 then
    select * into v_definition from public.minion_definitions where id=v_minion.minion_definition_id;
    select * into v_class from public.minion_damage_classes where event_id=p_event_id and damage_class=v_minion.damage_class;
    if not found then raise exception 'damage_class_not_configured'; end if;
    v_factor := greatest(v_class.minimum_factor,least(v_class.maximum_factor,power(greatest(1,v_minion.viewer_estimate)::numeric/10,v_class.community_exponent)));
    v_raw := greatest(0,round(v_class.base_damage*v_factor)::bigint);
    v_damage := public.apply_boss_damage(p_event_id,v_minion.streamer_id,'minion',v_raw,'minion:'||v_minion.id::text,p_force,p_actor_user_id);
    v_awarded := coalesce((v_damage->>'appliedDamage')::bigint,0);
    update public.minion_events set damage_awarded=v_awarded where id=v_minion.id;
    update public.streamers set minions_defeated=minions_defeated+1,updated_at=now() where id=v_minion.streamer_id;
    perform public.log_minion_system_event(p_event_id,v_minion.id,v_minion.streamer_id,'damage_awarded',jsonb_build_object('damage',v_awarded,'damage_class',v_minion.damage_class));
  end if;
  perform public.log_minion_system_event(p_event_id,v_minion.id,v_minion.streamer_id,
    case v_status when 'success' then 'resolved_success' when 'failure' then 'resolved_failure' else v_status end,
    jsonb_build_object('source',p_resolution_source));
  perform public.touch_event(p_event_id);
  return jsonb_build_object('idempotent',false,'status',v_status,'damageAwarded',v_awarded);
end;
$$;

create or replace function public.submit_minion_action(
  p_event_id uuid, p_streamer_id uuid, p_minion_event_id uuid, p_participant_key text,
  p_message_id text, p_answer text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_minion public.minion_events%rowtype; v_definition public.minion_definitions%rowtype;
  v_event public.events%rowtype; v_settings public.event_settings%rowtype; v_inserted uuid;
  v_count integer; v_window timestamptz; v_requests integer; v_allowed text[]; v_resolution jsonb;
begin
  if length(p_participant_key) not between 32 and 128 or length(p_message_id) not between 1 and 160 or length(coalesce(p_answer,'')) > 32 then raise exception 'payload_limits_exceeded'; end if;
  v_window := date_trunc('minute',now());
  insert into public.minion_submission_rate_limits(event_id,participant_key,window_started_at,request_count)
  values(p_event_id,p_participant_key,v_window,1)
  on conflict(event_id,participant_key,window_started_at) do update set request_count=public.minion_submission_rate_limits.request_count+1
  returning request_count into v_requests;
  if v_requests > 8 then raise exception 'rate_limit_exceeded'; end if;
  select * into v_event from public.events where id=p_event_id;
  select * into v_settings from public.event_settings where event_id=p_event_id;
  select * into v_minion from public.minion_events where id=p_minion_event_id and event_id=p_event_id and streamer_id=p_streamer_id for update;
  if not found then raise exception 'minion_scope_mismatch'; end if;
  if v_event.status not in ('active','testing') or v_settings.event_paused or not v_settings.minions_enabled then raise exception 'event_not_active'; end if;
  if not exists(select 1 from public.streamers s where s.id=p_streamer_id and s.event_id=p_event_id and s.enabled) then raise exception 'streamer_disabled'; end if;
  if v_event.status='active' and not exists(select 1 from public.streamer_runtime r where r.streamer_id=p_streamer_id and r.event_id=p_event_id and r.is_live) then raise exception 'streamer_offline'; end if;
  if v_minion.status <> 'active' or now() < v_minion.accepts_answers_at or now() >= v_minion.expires_at then raise exception 'minion_window_closed'; end if;
  select * into v_definition from public.minion_definitions where id=v_minion.minion_definition_id;
  if v_definition.game_mode='PARTICIPATION' then
    if p_answer is not null and p_answer <> '' then raise exception 'answer_not_expected'; end if;
  else
    select array_agg(lower(x)) into v_allowed from jsonb_array_elements_text(coalesce(v_minion.runtime_config->'options','[]'::jsonb)) x;
    if p_answer is null or not (lower(p_answer)=any(coalesce(v_allowed,array[]::text[]))) then raise exception 'invalid_answer'; end if;
  end if;
  insert into public.minion_participants(event_id,minion_event_id,participant_key,answer,message_id)
  values(p_event_id,p_minion_event_id,p_participant_key,lower(nullif(p_answer,'')),p_message_id)
  on conflict do nothing returning id into v_inserted;
  if v_inserted is null then
    perform public.log_minion_system_event(p_event_id,p_minion_event_id,p_streamer_id,'participant_duplicate','{}'::jsonb);
    return jsonb_build_object('accepted',false,'duplicate',true,'participantCount',v_minion.participant_count);
  end if;
  select count(*) into v_count from public.minion_participants where minion_event_id=p_minion_event_id;
  update public.minion_events set participant_count=v_count where id=p_minion_event_id;
  perform public.log_minion_system_event(p_event_id,p_minion_event_id,p_streamer_id,'participant_accepted',jsonb_build_object('participant_count',v_count));
  if v_definition.game_mode='PARTICIPATION' and v_count>=v_minion.required_participants then
    v_resolution := public.resolve_minion_v4(p_event_id,p_minion_event_id,'success',null,false,'participant_threshold');
  end if;
  perform public.touch_event(p_event_id);
  return jsonb_build_object('accepted',true,'duplicate',false,'participantCount',v_count,'resolved',coalesce(v_resolution,'null'::jsonb));
end;
$$;

create or replace function public.advance_minion_engine(p_event_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_minion public.minion_events%rowtype; v_correct text; v_top_count integer; v_top_answers integer;
  v_winner text; v_success boolean; v_curse public.curse_definitions%rowtype; v_advanced integer:=0;
begin
  update public.minion_events m set status='cancelled',resolved_at=now(),display_until=now()+interval '4 seconds'
  where (p_event_id is null or m.event_id=p_event_id) and m.status in ('scheduled','intro','active','failure','curse') and (
    exists(select 1 from public.events e join public.event_settings es on es.event_id=e.id
      where e.id=m.event_id and (e.status not in ('active','testing') or es.event_paused or not es.minions_enabled))
    or exists(select 1 from public.streamers s where s.id=m.streamer_id and not s.enabled)
    or exists(select 1 from public.bosses b where b.event_id=m.event_id and b.current_hp<=0)
    or (exists(select 1 from public.events e where e.id=m.event_id and e.status='active') and
      not exists(select 1 from public.streamer_runtime r where r.event_id=m.event_id and r.streamer_id=m.streamer_id and r.is_live))
  );
  update public.minion_events set status='intro' where (p_event_id is null or event_id=p_event_id) and status='scheduled' and spawned_at<=now();
  for v_minion in select * from public.minion_events where (p_event_id is null or event_id=p_event_id) and status='intro' and intro_ends_at<=now() for update loop
    update public.minion_events set status='active' where id=v_minion.id;
    perform public.log_minion_system_event(v_minion.event_id,v_minion.id,v_minion.streamer_id,'gameplay_started','{}'::jsonb);
    v_advanced:=v_advanced+1;
  end loop;
  for v_minion in select * from public.minion_events where (p_event_id is null or event_id=p_event_id) and status='active' and expires_at<=now() for update loop
    select correct_answer into v_correct from public.minion_event_secrets where minion_event_id=v_minion.id;
    if exists(select 1 from public.minion_definitions d where d.id=v_minion.minion_definition_id and d.game_mode='PARTICIPATION') then
      v_success:=v_minion.participant_count>=v_minion.required_participants;
    else
      select answer,count(*) into v_winner,v_top_count from public.minion_participants where minion_event_id=v_minion.id group by answer order by count(*) desc,answer limit 1;
      select count(*) into v_top_answers from (select answer from public.minion_participants where minion_event_id=v_minion.id group by answer having count(*)=coalesce(v_top_count,0)) tied;
      v_success:=v_minion.participant_count>=v_minion.required_participants and v_top_answers=1 and v_winner=v_correct;
    end if;
    perform public.resolve_minion_v4(v_minion.event_id,v_minion.id,case when v_success then 'success' else 'failure' end,null,false,'timer');
    v_advanced:=v_advanced+1;
  end loop;
  update public.minion_events set status='complete',completed_at=now(),display_until=now()
    where (p_event_id is null or event_id=p_event_id) and status='success' and result_ends_at<=now();
  for v_minion in select * from public.minion_events where (p_event_id is null or event_id=p_event_id) and status='failure' and result_ends_at<=now() for update loop
    select c.* into v_curse from public.curse_definitions c join public.minion_definitions d on d.event_id=c.event_id and d.failure_curse_key=c.key
      where d.id=v_minion.minion_definition_id and c.enabled;
    if found then
      update public.minion_events set status='curse',curse_ends_at=now()+make_interval(secs=>least(15000,v_curse.duration_ms)::numeric/1000),display_until=now()+make_interval(secs=>least(15000,v_curse.duration_ms)::numeric/1000) where id=v_minion.id;
      perform public.log_minion_system_event(v_minion.event_id,v_minion.id,v_minion.streamer_id,'curse_started',jsonb_build_object('curse',v_curse.key));
    else update public.minion_events set status='complete',completed_at=now(),display_until=now() where id=v_minion.id; end if;
  end loop;
  update public.minion_events set status='complete',completed_at=now(),display_until=now()
    where (p_event_id is null or event_id=p_event_id) and status='curse' and curse_ends_at<=now();
  update public.minion_events set status='complete',completed_at=now(),display_until=now()
    where (p_event_id is null or event_id=p_event_id) and status='expired' and result_ends_at<=now();
  return jsonb_build_object('advanced',v_advanced);
end;
$$;

create or replace function public.random_minion_delay_seconds(p_phase smallint)
returns integer language sql volatile as $$
  select case p_phase when 1 then 2700+floor(random()*901)::integer when 2 then 2400+floor(random()*901)::integer
    when 3 then 2100+floor(random()*901)::integer else 1800+floor(random()*901)::integer end;
$$;

create or replace function public.process_minion_tick(p_event_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_queue public.minion_special_queue%rowtype; v_definition_id uuid; v_schedule record; v_phase smallint;
  v_spawned integer:=0; v_specials integer:=0; v_event record;
begin
  perform public.advance_minion_engine(p_event_id);
  for v_queue in select * from public.minion_special_queue q where (p_event_id is null or q.event_id=p_event_id) and q.status='scheduled' and q.due_at<=now() order by q.due_at for update skip locked loop
    if exists(select 1 from public.minion_events m where m.event_id=v_queue.event_id and m.streamer_id=v_queue.streamer_id and m.status in ('intro','active','success','failure','curse')) then
      update public.minion_special_queue set due_at=now()+interval '2 minutes',updated_at=now() where id=v_queue.id;
      continue;
    end if;
    select id into v_definition_id from public.minion_definitions where event_id=v_queue.event_id and key=v_queue.minion_key and enabled;
    begin
      perform public.spawn_minion_v4(v_queue.event_id,v_definition_id,v_queue.streamer_id,false,'raid',v_queue.trigger_reference,now());
      update public.minion_special_queue set status='spawned',updated_at=now() where id=v_queue.id;
      update public.minion_spawn_schedules set cooldown_until=now()+make_interval(secs=>600+floor(random()*301)::integer),next_spawn_at=null,updated_at=now()
        where event_id=v_queue.event_id and streamer_id=v_queue.streamer_id;
      v_specials:=v_specials+1;
    exception when others then
      update public.minion_special_queue set due_at=now()+interval '2 minutes',updated_at=now() where id=v_queue.id;
    end;
  end loop;
  for v_event in select e.id,b.current_hp,b.max_hp from public.events e join public.event_settings es on es.event_id=e.id
    join public.bosses b on b.event_id=e.id where (p_event_id is null or e.id=p_event_id) and e.status='active' and not es.event_paused and es.minions_enabled and b.current_hp>0 loop
    v_phase:=public.current_phase(v_event.current_hp,v_event.max_hp);
    insert into public.minion_spawn_schedules(event_id,streamer_id,next_spawn_at,cooldown_until,phase_number)
    select v_event.id,s.id,now()+make_interval(secs=>public.random_minion_delay_seconds(v_phase)),now()+interval '10 minutes',v_phase
    from public.streamers s join public.streamer_runtime r on r.streamer_id=s.id and r.event_id=s.event_id
    where s.event_id=v_event.id and s.enabled and r.is_live
    on conflict(event_id,streamer_id) do nothing;
    for v_schedule in select ms.* from public.minion_spawn_schedules ms join public.streamers s on s.id=ms.streamer_id
      join public.streamer_runtime r on r.streamer_id=s.id where ms.event_id=v_event.id and s.enabled and r.is_live
      and ms.next_spawn_at<=now() and coalesce(ms.cooldown_until,'-infinity')<=now() for update of ms skip locked loop
      if exists(select 1 from public.minion_events m where m.event_id=v_event.id and m.streamer_id=v_schedule.streamer_id and m.status in ('intro','active','success','failure','curse')) then continue; end if;
      select d.id into v_definition_id from public.minion_definitions d where d.event_id=v_event.id and d.enabled and d.key<>'kings_herald' and d.phase_min<=v_phase and d.weight>0
        order by -ln(greatest(random(),0.000001))/d.weight limit 1;
      if v_definition_id is not null then
        perform public.spawn_minion_v4(v_event.id,v_definition_id,v_schedule.streamer_id,false,'scheduler',null,now());
        update public.minion_spawn_schedules set next_spawn_at=null,phase_number=v_phase,updated_at=now() where event_id=v_event.id and streamer_id=v_schedule.streamer_id;
        v_spawned:=v_spawned+1;
      end if;
    end loop;
    update public.minion_spawn_schedules ms set next_spawn_at=now()+make_interval(secs=>public.random_minion_delay_seconds(v_phase)),phase_number=v_phase,updated_at=now()
      where ms.event_id=v_event.id and ms.next_spawn_at is null and not exists(select 1 from public.minion_events m where m.event_id=ms.event_id and m.streamer_id=ms.streamer_id and m.status in ('intro','active','success','failure','curse'));
  end loop;
  delete from public.minion_submission_rate_limits where window_started_at<now()-interval '1 hour';
  delete from public.minion_participants where submitted_at<now()-interval '24 hours' and minion_event_id in (select id from public.minion_events where status in ('complete','cancelled','expired'));
  return jsonb_build_object('spawned',v_spawned,'raidSpecials',v_specials);
end;
$$;

create or replace function public.queue_eligible_raid_herald()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_settings public.event_settings%rowtype; v_delay integer;
begin
  if not new.eligible or new.to_streamer_id is null then return new; end if;
  select * into v_settings from public.event_settings where event_id=new.event_id;
  v_delay:=v_settings.raid_special_delay_min_seconds+floor(random()*(v_settings.raid_special_delay_max_seconds-v_settings.raid_special_delay_min_seconds+1))::integer;
  insert into public.minion_special_queue(event_id,streamer_id,minion_key,due_at,trigger_source,trigger_reference)
  values(new.event_id,new.to_streamer_id,'kings_herald',new.occurred_at+make_interval(secs=>v_delay),'raid',new.id::text)
  on conflict(event_id,trigger_source,trigger_reference) do nothing;
  return new;
end;
$$;
drop trigger if exists raid_events_queue_herald on public.raid_events;
create trigger raid_events_queue_herald after insert on public.raid_events for each row execute function public.queue_eligible_raid_herald();

create or replace function public.cancel_minions_on_guard_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event_id uuid; v_streamer_id uuid;
begin
  if tg_table_name='event_settings' then v_event_id:=new.event_id;
    if new.event_paused or not new.minions_enabled then update public.minion_events set status='cancelled',resolved_at=now(),display_until=now()+interval '4 seconds' where event_id=v_event_id and status in ('scheduled','intro','active','failure','curse'); end if;
  elsif tg_table_name='events' then v_event_id:=new.id;
    if new.status not in ('active','testing') then update public.minion_events set status='cancelled',resolved_at=now(),display_until=now()+interval '4 seconds' where event_id=v_event_id and status in ('scheduled','intro','active','failure','curse'); end if;
  elsif tg_table_name='streamers' then v_event_id:=new.event_id;v_streamer_id:=new.id;
    if not new.enabled then update public.minion_events set status='cancelled',resolved_at=now(),display_until=now()+interval '4 seconds' where event_id=v_event_id and streamer_id=v_streamer_id and status in ('scheduled','intro','active','failure','curse'); end if;
  elsif tg_table_name='streamer_runtime' then v_event_id:=new.event_id;v_streamer_id:=new.streamer_id;
    if not new.is_live then update public.minion_events set status='cancelled',resolved_at=now(),display_until=now()+interval '4 seconds' where event_id=v_event_id and streamer_id=v_streamer_id and status in ('scheduled','intro','active','failure','curse'); end if;
  elsif tg_table_name='bosses' then v_event_id:=new.event_id;
    if new.current_hp<=0 then update public.minion_events set status='cancelled',resolved_at=now(),display_until=now()+interval '4 seconds' where event_id=v_event_id and status in ('scheduled','intro','active','failure','curse'); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists event_settings_cancel_minions on public.event_settings;
create trigger event_settings_cancel_minions after update of event_paused,minions_enabled on public.event_settings for each row execute function public.cancel_minions_on_guard_change();
drop trigger if exists events_cancel_minions on public.events;
create trigger events_cancel_minions after update of status on public.events for each row execute function public.cancel_minions_on_guard_change();
drop trigger if exists streamers_cancel_minions on public.streamers;
create trigger streamers_cancel_minions after update of enabled on public.streamers for each row execute function public.cancel_minions_on_guard_change();
drop trigger if exists streamer_runtime_cancel_minions on public.streamer_runtime;
create trigger streamer_runtime_cancel_minions after update of is_live on public.streamer_runtime for each row execute function public.cancel_minions_on_guard_change();
drop trigger if exists bosses_cancel_minions on public.bosses;
create trigger bosses_cancel_minions after update of current_hp on public.bosses for each row execute function public.cancel_minions_on_guard_change();

create or replace function public.get_public_event_state(p_event_slug text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with selected as (
    select e.*,b.id boss_id,b.run_id,b.name boss_name,b.max_hp,b.current_hp,b.updated_at boss_updated_at,
      s.event_paused,s.damage_enabled,s.minions_enabled,s.global_damage_multiplier,s.passive_damage_multiplier,
      s.active_damage_multiplier,s.passive_tick_seconds,
      exists(select 1 from public.event_admins ea where ea.event_id=e.id and ea.user_id=auth.uid()) is_admin
    from public.events e join public.bosses b on b.event_id=e.id join public.event_settings s on s.event_id=e.id
    where e.slug=p_event_slug and (e.status in ('testing','active','paused','finished','archived') or exists(select 1 from public.event_admins ea where ea.event_id=e.id and ea.user_id=auth.uid()))
  ) select jsonb_build_object(
    'version',4,'updated_at',greatest(selected.updated_at,selected.boss_updated_at),
    'event',jsonb_build_object('id',selected.id,'slug',selected.slug,'name',selected.name,'description',selected.description,'status',selected.status),
    'boss',jsonb_build_object('id',selected.boss_id,'name',selected.boss_name,'max_hp',selected.max_hp,'current_hp',selected.current_hp,
      'phase',coalesce((select to_jsonb(p) from public.boss_phases p where p.boss_id=selected.boss_id and p.phase_number=public.current_phase(selected.current_hp,selected.max_hp)),'{}'::jsonb)),
    'settings',jsonb_build_object('event_paused',selected.event_paused,'damage_enabled',selected.damage_enabled,'minions_enabled',selected.minions_enabled,
      'global_damage_multiplier',case when selected.is_admin then selected.global_damage_multiplier else 1 end,
      'passive_damage_multiplier',case when selected.is_admin then selected.passive_damage_multiplier else 1 end,
      'active_damage_multiplier',case when selected.is_admin then selected.active_damage_multiplier else 1 end,
      'passive_tick_seconds',case when selected.is_admin then selected.passive_tick_seconds else 120 end),
    'stats',jsonb_build_object('total_damage',greatest(0,selected.max_hp-selected.current_hp),
      'total_minions_spawned',(select count(*) from public.minion_events m where m.event_id=selected.id and m.run_id=selected.run_id),
      'total_minions_defeated',(select count(*) from public.minion_events m where m.event_id=selected.id and m.run_id=selected.run_id and m.status in ('success','complete') and m.damage_awarded>0),
      'total_minions_failed',(select count(*) from public.minion_events m where m.event_id=selected.id and m.run_id=selected.run_id and (m.status in ('failure','curse') or (m.status='complete' and m.damage_awarded=0 and m.resolved_at is not null))),
      'minions_by_type',coalesce((select jsonb_object_agg(x.key,x.amount) from (select d.key,count(*) amount from public.minion_events m join public.minion_definitions d on d.id=m.minion_definition_id where m.event_id=selected.id and m.run_id=selected.run_id group by d.key)x),'{}'::jsonb),
      'active_streamer_count',(select count(*) from public.streamers s where s.event_id=selected.id and s.enabled),
      'unique_participants',(select count(distinct mp.participant_key) from public.minion_participants mp join public.minion_events m on m.id=mp.minion_event_id where m.event_id=selected.id and m.run_id=selected.run_id)),
    'streamers',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'slug',s.slug,'display_name',s.display_name,'community_name',s.community_name,
      'twitch_login',s.twitch_login,'twitch_user_id',case when selected.is_admin then s.twitch_user_id else null end,'twitch_url',s.twitch_url,'avatar_url',s.avatar_url,
      'enabled',s.enabled,'sort_order',s.sort_order,'damage',coalesce((select sum(d.final_damage) from public.damage_events d where d.event_id=selected.id and d.run_id=selected.run_id and d.streamer_id=s.id),0),
      'minions_defeated',s.minions_defeated,'minions_spawned',(select count(*) from public.minion_events m where m.run_id=selected.run_id and m.streamer_id=s.id),
      'minions_failed',(select count(*) from public.minion_events m where m.run_id=selected.run_id and m.streamer_id=s.id and (m.status in ('failure','curse') or (m.status='complete' and m.damage_awarded=0 and m.resolved_at is not null))),
      'is_live',coalesce(sr.is_live,false),'live_since',sr.live_since,'current_stream_id',sr.current_stream_id,'current_viewer_count',coalesce(sr.current_viewer_count,0),
      'last_twitch_sync_at',sr.last_twitch_sync_at,'last_seen_live_at',sr.last_seen_live_at,
      'session',case when selected.is_admin and ss.id is not null then jsonb_build_object('id',ss.id,'stream_id',ss.twitch_stream_id,'started_at',ss.started_at,'ended_at',ss.ended_at,'status',ss.status,
        'average_viewers',ss.average_viewers,'peak_viewers',ss.peak_viewers,'latest_viewers',coalesce((select vs.viewer_count from public.viewer_samples vs where vs.stream_session_id=ss.id order by vs.sampled_at desc limit 1),0),
        'sample_count',ss.sample_count,'duration_seconds',coalesce(ss.duration_seconds,greatest(0,floor(extract(epoch from(now()-ss.started_at)))::bigint))) else null end)
      order by s.sort_order,s.display_name) from public.streamers s left join public.streamer_runtime sr on sr.streamer_id=s.id
      left join lateral(select x.* from public.stream_sessions x where x.streamer_id=s.id order by(x.status='live')desc,x.started_at desc limit 1)ss on true
      where s.event_id=selected.id and(s.enabled or selected.is_admin)),'[]'::jsonb),
    'minions',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'definition_id',d.id,'key',d.key,'name',d.name,'icon',d.icon,'command',d.command,
      'game_mode',d.game_mode,'damage_class',m.damage_class,'failure_curse_key',d.failure_curse_key,'intro_title',d.intro_title,'gameplay_title',d.gameplay_title,'instruction',d.instruction,
      'streamer_id',st.id,'streamer_slug',st.slug,'streamer_name',st.display_name,'status',m.status,'viewer_estimate',m.viewer_estimate,'required_participants',m.required_participants,
      'participant_count',m.participant_count,'duration_seconds',m.duration_seconds,'runtime_config',m.runtime_config,'spawned_at',m.spawned_at,'intro_ends_at',m.intro_ends_at,
      'gameplay_starts_at',m.gameplay_starts_at,'accepts_answers_at',m.accepts_answers_at,'expires_at',m.expires_at,'resolved_at',m.resolved_at,'result_ends_at',m.result_ends_at,
      'curse_ends_at',m.curse_ends_at,'completed_at',m.completed_at,'damage_awarded',m.damage_awarded,'trigger_source',m.trigger_source,'trigger_reference',m.trigger_reference,'display_until',m.display_until)
      order by m.spawned_at desc) from public.minion_events m join public.minion_definitions d on d.id=m.minion_definition_id join public.streamers st on st.id=m.streamer_id
      where m.event_id=selected.id and m.run_id=selected.run_id and(m.status in ('scheduled','intro','active','success','failure','curse') or m.display_until>now())),'[]'::jsonb),
    'milestones',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'description',m.description,'hp_percent',m.hp_percent,'sort_order',m.sort_order,'reached_at',m.reached_at)order by m.sort_order)from public.milestones m where m.event_id=selected.id),'[]'::jsonb),
    'twitch',case when selected.is_admin then jsonb_build_object('health',coalesce((select jsonb_build_object('status',h.health_status,'reason',h.health_reason,'webhook_configured',h.webhook_configured,'last_sync_at',h.last_sync_at,'last_success_at',h.last_success_at,'last_error_at',h.last_error_at,'last_error',h.last_error,'last_webhook_at',h.last_webhook_at,'last_invalid_signature_at',h.last_invalid_signature_at,'last_subscription_sync_at',h.last_subscription_sync_at)from public.twitch_integration_status h where h.event_id=selected.id),'{}'::jsonb),
      'subscriptions',jsonb_build_object('online',(select count(*)from public.twitch_eventsub_subscriptions where subscription_type='stream.online'and status='enabled'),'offline',(select count(*)from public.twitch_eventsub_subscriptions where subscription_type='stream.offline'and status='enabled'),'raid',(select count(*)from public.twitch_eventsub_subscriptions where subscription_type='channel.raid'and status='enabled'),'pending',(select count(*)from public.twitch_eventsub_subscriptions where status like 'webhook_callback_verification_pending%'),'revoked_or_error',(select count(*)from public.twitch_eventsub_subscriptions where status not in('enabled','webhook_callback_verification_pending'))),
      'recent_raids',coalesce((select jsonb_agg(to_jsonb(r)order by r.occurred_at desc)from(select re.id,re.from_streamer_id,re.to_streamer_id,re.from_twitch_user_id,re.to_twitch_user_id,re.viewer_count,re.occurred_at,re.eligible,re.source from public.raid_events re where re.event_id=selected.id order by re.occurred_at desc limit 10)r),'[]'::jsonb))else null end,
    'log',coalesce((select jsonb_agg(log_entry order by happened_at desc)from(
      select jsonb_build_object('id',d.id,'timestamp',d.created_at,'type','damage','message',concat(d.source,': ',d.final_damage,' Schaden'))log_entry,d.created_at happened_at from public.damage_events d where d.event_id=selected.id
      union all select jsonb_build_object('id',ml.id,'timestamp',ml.created_at,'type','minion','message',concat(ml.event_type,' · ',coalesce(st.display_name,'System')))log_entry,ml.created_at from public.minion_system_log ml left join public.streamers st on st.id=ml.streamer_id where ml.event_id=selected.id
      union all select jsonb_build_object('id',tl.id,'timestamp',tl.created_at,'type','twitch','message',tl.message),tl.created_at from public.twitch_system_log tl where tl.event_id=selected.id and selected.is_admin
      order by happened_at desc limit 40)recent_log),'[]'::jsonb)
  ) from selected;
$$;

revoke all on function public.log_minion_system_event(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.stable_viewer_estimate(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.calculate_required_participants(integer,uuid) from public,anon,authenticated;
revoke all on function public.build_minion_runtime_config(uuid,text,smallint) from public,anon,authenticated;
revoke all on function public.spawn_minion_v4(uuid,uuid,uuid,boolean,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.resolve_minion_v4(uuid,uuid,text,uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.submit_minion_action(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.advance_minion_engine(uuid) from public,anon,authenticated;
revoke all on function public.process_minion_tick(uuid) from public,anon,authenticated;
grant execute on function public.log_minion_system_event(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.stable_viewer_estimate(uuid,uuid,integer) to service_role;
grant execute on function public.calculate_required_participants(integer,uuid) to service_role;
grant execute on function public.build_minion_runtime_config(uuid,text,smallint) to service_role;
grant execute on function public.spawn_minion_v4(uuid,uuid,uuid,boolean,text,text,timestamptz) to service_role;
grant execute on function public.resolve_minion_v4(uuid,uuid,text,uuid,boolean,text) to service_role;
grant execute on function public.submit_minion_action(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.advance_minion_engine(uuid) to service_role;
grant execute on function public.process_minion_tick(uuid) to service_role;

create or replace function public.log_minion_status_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status is distinct from new.status then
    perform public.log_minion_system_event(new.event_id,new.id,new.streamer_id,
      case new.status when 'intro' then 'spawned' when 'active' then 'gameplay_started'
        when 'success' then 'resolved_success' when 'failure' then 'resolved_failure'
        when 'curse' then 'curse_started' else new.status end,
      jsonb_build_object('previous_status',old.status));
  end if;
  return new;
end;
$$;
drop trigger if exists minion_events_log_status_change on public.minion_events;
create trigger minion_events_log_status_change after update of status on public.minion_events
  for each row execute function public.log_minion_status_change();

revoke all on function public.random_minion_delay_seconds(smallint) from public,anon,authenticated;
revoke all on function public.queue_eligible_raid_herald() from public,anon,authenticated;
revoke all on function public.cancel_minions_on_guard_change() from public,anon,authenticated;
revoke all on function public.log_minion_status_change() from public,anon,authenticated;
grant execute on function public.random_minion_delay_seconds(smallint) to service_role;

-- Keep the v0.2 RPC signatures functional while routing them through the v0.4 engine.
create or replace function public.spawn_minion(
  p_event_id uuid, p_definition_id uuid, p_streamer_id uuid, p_force boolean default false
) returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select public.spawn_minion_v4(p_event_id,p_definition_id,p_streamer_id,p_force,'admin',null,now());
$$;

create or replace function public.resolve_minion(
  p_event_id uuid, p_minion_event_id uuid, p_resolution text, p_actor_user_id uuid
) returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select public.resolve_minion_v4(p_event_id,p_minion_event_id,p_resolution,p_actor_user_id,false,'legacy_rpc');
$$;

create or replace function public.admin_reset_boss(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_boss public.bosses%rowtype;
begin
  select * into v_boss from public.bosses where event_id=p_event_id for update;
  if not found then raise exception 'boss_not_found'; end if;
  update public.minion_events set status='cancelled',resolved_at=now(),display_until=now()+interval '4 seconds'
    where event_id=p_event_id and status in ('scheduled','intro','active','success','failure','curse');
  update public.bosses set current_hp=max_hp,run_id=gen_random_uuid(),version=version+1,updated_at=now() where id=v_boss.id;
  update public.milestones set reached_at=null where boss_id=v_boss.id;
  update public.streamers set damage=0,minions_defeated=0,updated_at=now() where event_id=p_event_id;
  perform public.touch_event(p_event_id);
  return jsonb_build_object('currentHp',v_boss.max_hp,'phase',1);
end;
$$;
