-- PXB Community Event Engine: event-pack platform.
-- Packs are declarative, versioned definitions. Runtime state stays event-scoped.

create table if not exists public.event_pack_releases (
  pack_key text not null check (pack_key ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$'),
  version text not null check (version ~ '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$'),
  schema_version integer not null default 1 check (schema_version > 0),
  name text not null,
  manifest jsonb not null,
  content_hash text,
  status text not null default 'ready' check (status in ('draft','ready','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (pack_key, version),
  check (jsonb_typeof(manifest)='object')
);

alter table public.event_pack_releases enable row level security;
revoke all on public.event_pack_releases from public,anon,authenticated;
grant select,insert,update,delete on public.event_pack_releases to service_role;

alter table public.events
  add column if not exists pack_key text not null default 'unassigned',
  add column if not exists pack_version text not null default '0.0.0',
  add column if not exists presentation jsonb not null default '{}'::jsonb;

alter table public.boss_phases drop constraint if exists boss_phases_phase_number_check;
alter table public.boss_phases add constraint boss_phases_phase_number_positive_check check (phase_number > 0);

alter table public.minion_definitions
  add column if not exists presentation text not null default 'participation',
  add column if not exists runtime_generator jsonb not null default '{"type":"none"}'::jsonb;

alter table public.minion_definitions drop constraint if exists minion_definitions_limits_check;
alter table public.minion_definitions add constraint minion_definitions_limits_check check (
  intro_duration_ms between 0 and 15000 and observe_duration_seconds between 0 and 30 and
  phase_min > 0 and weight >= 0 and min_participants > 0 and
  max_participants >= min_participants and curve_exponent > 0 and participation_factor >= 0
);
alter table public.minion_definitions drop constraint if exists minion_definitions_damage_class_check;
alter table public.minion_events drop constraint if exists minion_events_damage_class_check;
alter table public.minion_damage_classes drop constraint if exists minion_damage_classes_damage_class_check;

alter table public.curse_definitions
  add column if not exists presentation text not null default 'generic-vignette';

alter table public.minion_questions
  add column if not exists answers jsonb not null default '{}'::jsonb;
update public.minion_questions set answers=jsonb_build_object('a',answer_a,'b',answer_b,'c',answer_c)
where answers='{}'::jsonb;
alter table public.minion_questions drop constraint if exists minion_questions_correct_answer_check;

alter table public.event_settings
  add column if not exists raid_special_minion_key text,
  add column if not exists minion_spawn_windows jsonb not null default '{}'::jsonb;

comment on table public.event_pack_releases is 'Immutable-style authored pack releases. No secrets or executable code are permitted in manifests.';
comment on column public.events.pack_key is 'Pack selected for presentation and authored rules. Runtime remains scoped by event id.';
comment on column public.minion_definitions.runtime_generator is 'Declarative runtime generator interpreted by the trusted engine.';

create or replace function public.register_event_pack_release(p_manifest jsonb, p_content_hash text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_key text:=lower(btrim(coalesce(p_manifest->>'key','')));
  v_version text:=btrim(coalesce(p_manifest->>'version',''));
  v_name text:=btrim(coalesce(p_manifest->>'name',''));
  v_schema integer:=coalesce((p_manifest->>'schemaVersion')::integer,0);
  v_serialized text:=p_manifest::text;
begin
  if v_key !~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$' or v_version !~ '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$'
    or v_name='' or v_schema<>1 then raise exception 'invalid_event_pack_manifest'; end if;
  if v_serialized ~* '(sb_secret_|service.?role|client.?secret|access.?token|refresh.?token|private.?key)' then
    raise exception 'secret_material_forbidden_in_event_pack';
  end if;
  if jsonb_typeof(p_manifest->'boss'->'phases')<>'array' or jsonb_typeof(p_manifest->'minions')<>'array'
    or jsonb_typeof(p_manifest->'effects')<>'array' then raise exception 'incomplete_event_pack_manifest'; end if;
  insert into public.event_pack_releases(pack_key,version,schema_version,name,manifest,content_hash,status,updated_at)
  values(v_key,v_version,v_schema,v_name,p_manifest,p_content_hash,'ready',now())
  on conflict(pack_key,version) do update set
    schema_version=excluded.schema_version,name=excluded.name,manifest=excluded.manifest,
    content_hash=excluded.content_hash,status='ready',updated_at=now();
  return jsonb_build_object('packKey',v_key,'packVersion',v_version,'registered',true);
end;
$$;

create or replace function public.apply_event_pack(
  p_event_id uuid,
  p_pack_key text,
  p_pack_version text,
  p_reset_boss boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_release public.event_pack_releases%rowtype;
  v_event public.events%rowtype;
  v_boss public.bosses%rowtype;
  v_item jsonb;
  v_key text;
  v_phase_ids smallint[]:=array[]::smallint[];
  v_minion_keys text[]:=array[]::text[];
  v_effect_keys text[]:=array[]::text[];
  v_question jsonb;
  v_phase_scaling jsonb;
  v_sort integer:=0;
begin
  select * into v_release from public.event_pack_releases
    where pack_key=lower(btrim(p_pack_key)) and version=btrim(p_pack_version) and status='ready';
  if not found then raise exception 'event_pack_release_not_found'; end if;
  select * into v_event from public.events where id=p_event_id for update;
  if not found then raise exception 'event_not_found'; end if;
  if v_event.status in ('active','paused') then raise exception 'event_pack_change_requires_inactive_event'; end if;
  select * into v_boss from public.bosses where event_id=p_event_id for update;
  if not found then raise exception 'boss_not_found'; end if;
  select coalesce(jsonb_object_agg(value->>'id',value->'intensity'),'{}'::jsonb) into v_phase_scaling
    from jsonb_array_elements(v_release.manifest#>'{boss,phases}');

  update public.events set pack_key=v_release.pack_key,pack_version=v_release.version,
    name=coalesce(nullif(name,''),v_release.name),presentation=coalesce(v_release.manifest->'theme','{}'::jsonb),updated_at=now()
    where id=p_event_id;
  update public.bosses set name=coalesce(nullif(v_release.manifest#>>'{boss,name}',''),name),
    max_hp=case when p_reset_boss then greatest(1,(v_release.manifest#>>'{boss,defaultMaxHp}')::bigint) else max_hp end,
    current_hp=case when p_reset_boss then greatest(1,(v_release.manifest#>>'{boss,defaultMaxHp}')::bigint) else current_hp end,
    run_id=case when p_reset_boss then gen_random_uuid() else run_id end,updated_at=now()
    where id=v_boss.id;

  for v_item in select value from jsonb_array_elements(v_release.manifest#>'{boss,phases}') loop
    v_sort:=v_sort+1;
    v_phase_ids:=array_append(v_phase_ids,(v_item->>'id')::smallint);
    insert into public.boss_phases(event_id,boss_id,phase_number,name,min_percent,max_percent,color,sort_order,metadata)
    values(p_event_id,v_boss.id,(v_item->>'id')::smallint,v_item->>'name',(v_item->>'minPercent')::numeric,
      (v_item->>'maxPercent')::numeric,coalesce(v_item->>'color','#888888'),v_sort,
      jsonb_build_object('spawnWindowMinutes',v_item->'spawnWindowMinutes','intensity',v_item->'intensity'))
    on conflict(boss_id,phase_number) do update set name=excluded.name,min_percent=excluded.min_percent,
      max_percent=excluded.max_percent,color=excluded.color,sort_order=excluded.sort_order,metadata=excluded.metadata;
  end loop;
  delete from public.boss_phases where event_id=p_event_id and not(phase_number=any(v_phase_ids));

  delete from public.milestones where event_id=p_event_id;
  v_sort:=0;
  for v_item in select value from jsonb_array_elements(coalesce(v_release.manifest#>'{boss,milestones}','[]'::jsonb)) loop
    v_sort:=v_sort+1;
    insert into public.milestones(event_id,boss_id,name,description,hp_percent,sort_order,metadata)
    values(p_event_id,v_boss.id,v_item->>'label',coalesce(v_item->>'description',''),(v_item->>'percent')::numeric,
      v_sort,'{}'::jsonb)
    on conflict(boss_id,hp_percent) do update set name=excluded.name,description=excluded.description;
  end loop;

  update public.minion_definitions set enabled=false,updated_at=now() where event_id=p_event_id;
  for v_item in select value from jsonb_array_elements(v_release.manifest->'minions') loop
    v_key:=lower(v_item->>'key'); v_minion_keys:=array_append(v_minion_keys,v_key);
    insert into public.minion_definitions(event_id,key,name,command,base_damage,duration_seconds,type,enabled,metadata,
      game_mode,icon,intro_title,gameplay_title,instruction,intro_duration_ms,observe_duration_seconds,damage_class,
      failure_curse_key,phase_min,weight,min_participants,max_participants,curve_exponent,participation_factor,config,
      presentation,runtime_generator)
    values(p_event_id,v_key,v_item->>'name',coalesce(v_item->>'command','!boss'),0,(v_item->>'durationSeconds')::integer,
      lower(v_item->>'gameMode'),true,'{}'::jsonb,v_item->>'gameMode',coalesce(v_item->>'icon','◆'),
      coalesce(v_item->>'introTitle',''),coalesce(v_item->>'gameplayTitle',''),coalesce(v_item->>'instruction',''),
      (v_item->>'introDurationMs')::integer,(v_item->>'observeSeconds')::integer,v_item->>'damageClass',
      nullif(v_item->>'failureEffectKey',''),(v_item->>'phaseMinimum')::smallint,(v_item->>'weight')::numeric,
      (v_item->>'minimumParticipants')::integer,(v_item->>'maximumParticipants')::integer,
      (v_item->>'curveExponent')::numeric,(v_item->>'participationFactor')::numeric,'{}'::jsonb,
      coalesce(v_item->>'presentation','participation'),coalesce(v_item->'runtime','{"type":"none"}'::jsonb))
    on conflict(event_id,key) do update set name=excluded.name,command=excluded.command,duration_seconds=excluded.duration_seconds,
      type=excluded.type,enabled=true,game_mode=excluded.game_mode,icon=excluded.icon,intro_title=excluded.intro_title,
      gameplay_title=excluded.gameplay_title,instruction=excluded.instruction,intro_duration_ms=excluded.intro_duration_ms,
      observe_duration_seconds=excluded.observe_duration_seconds,damage_class=excluded.damage_class,
      failure_curse_key=excluded.failure_curse_key,phase_min=excluded.phase_min,weight=excluded.weight,
      min_participants=excluded.min_participants,max_participants=excluded.max_participants,
      curve_exponent=excluded.curve_exponent,participation_factor=excluded.participation_factor,
      presentation=excluded.presentation,runtime_generator=excluded.runtime_generator,updated_at=now();
  end loop;

  delete from public.minion_questions where event_id=p_event_id;
  for v_item in select value from jsonb_array_elements(v_release.manifest->'minions') loop
    if v_item#>>'{runtime,type}'='question-pool' then
      for v_question in select value from jsonb_array_elements(coalesce(v_item#>'{runtime,questions}','[]'::jsonb)) loop
        insert into public.minion_questions(event_id,question,answer_a,answer_b,answer_c,answers,correct_answer,difficulty,enabled)
        values(p_event_id,v_question->>'question',coalesce(v_question#>>'{answers,a}',''),coalesce(v_question#>>'{answers,b}',''),
          coalesce(v_question#>>'{answers,c}',''),coalesce(v_question->'answers','{}'::jsonb),lower(v_question->>'correctAnswer'),
          coalesce((v_question->>'difficulty')::smallint,1),true);
      end loop;
    end if;
  end loop;

  update public.curse_definitions set enabled=false,updated_at=now() where event_id=p_event_id;
  for v_item in select value from jsonb_array_elements(v_release.manifest->'effects') loop
    v_key:=lower(v_item->>'key'); v_effect_keys:=array_append(v_effect_keys,v_key);
    insert into public.curse_definitions(event_id,key,name,duration_ms,intensity,phase_scaling,config,enabled,presentation)
    values(p_event_id,v_key,v_item->>'name',least(15000,greatest(1000,(v_item->>'durationMs')::integer)),
      least(1.1,greatest(0,(v_item->>'intensity')::numeric)),v_phase_scaling,coalesce(v_item->'config','{}'::jsonb),true,
      coalesce(v_item->>'presentation','generic-vignette'))
    on conflict(event_id,key) do update set name=excluded.name,duration_ms=excluded.duration_ms,intensity=excluded.intensity,
      phase_scaling=excluded.phase_scaling,config=excluded.config,enabled=true,presentation=excluded.presentation,updated_at=now();
  end loop;

  for v_key,v_item in select key,value from jsonb_each(v_release.manifest->'damageClasses') loop
    insert into public.minion_damage_classes(event_id,damage_class,base_damage,provisional)
    values(p_event_id,v_key,(v_item->>'baseDamage')::bigint,coalesce((v_item->>'provisional')::boolean,true))
    on conflict(event_id,damage_class) do update set base_damage=excluded.base_damage,provisional=excluded.provisional;
  end loop;

  update public.event_settings set
    raid_special_minion_key=nullif(v_release.manifest#>>'{scheduling,raidSpecialMinionKey}',''),
    raid_special_delay_min_seconds=coalesce((v_release.manifest#>>'{scheduling,raidDelaySeconds,0}')::integer,raid_special_delay_min_seconds),
    raid_special_delay_max_seconds=coalesce((v_release.manifest#>>'{scheduling,raidDelaySeconds,1}')::integer,raid_special_delay_max_seconds),
    raid_post_cooldown_min_seconds=coalesce((v_release.manifest#>>'{scheduling,raidCooldownSeconds,0}')::integer,raid_post_cooldown_min_seconds),
    raid_post_cooldown_max_seconds=coalesce((v_release.manifest#>>'{scheduling,raidCooldownSeconds,1}')::integer,raid_post_cooldown_max_seconds),
    minion_spawn_windows=coalesce((select jsonb_object_agg(value->>'id',value->'spawnWindowMinutes') from jsonb_array_elements(v_release.manifest#>'{boss,phases}')),'{}'::jsonb),
    updated_at=now() where event_id=p_event_id;
  perform public.touch_event(p_event_id);
  return jsonb_build_object('eventId',p_event_id,'packKey',v_release.pack_key,'packVersion',v_release.version,'applied',true);
end;
$$;

create or replace function public.create_event_from_pack(
  p_event_slug text,p_event_name text,p_pack_key text,p_pack_version text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event_id uuid; v_max_hp bigint; v_manifest jsonb;
begin
  if lower(btrim(p_event_slug)) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'invalid_event_slug'; end if;
  select manifest into v_manifest from public.event_pack_releases where pack_key=p_pack_key and version=p_pack_version and status='ready';
  if v_manifest is null then raise exception 'event_pack_release_not_found'; end if;
  v_max_hp:=greatest(1,(v_manifest#>>'{boss,defaultMaxHp}')::bigint);
  insert into public.events(slug,name,status,pack_key,pack_version) values(lower(btrim(p_event_slug)),coalesce(nullif(btrim(p_event_name),''),v_manifest->>'name'),'draft',p_pack_key,p_pack_version) returning id into v_event_id;
  insert into public.bosses(event_id,name,max_hp,current_hp) values(v_event_id,v_manifest#>>'{boss,name}',v_max_hp,v_max_hp);
  insert into public.event_settings(event_id) values(v_event_id);
  perform public.apply_event_pack(v_event_id,p_pack_key,p_pack_version,true);
  return v_event_id;
end;
$$;

create or replace function public.current_event_phase(p_event_id uuid,p_current_hp bigint,p_max_hp bigint)
returns smallint language sql stable strict set search_path=public,pg_temp as $$
  select p.phase_number from public.boss_phases p
  where p.event_id=p_event_id and
    (p_current_hp::numeric/nullif(p_max_hp,0)*100)<=p.max_percent and
    ((p.min_percent=0 and (p_current_hp::numeric/nullif(p_max_hp,0)*100)>=0) or (p_current_hp::numeric/nullif(p_max_hp,0)*100)>p.min_percent)
  order by p.sort_order,p.phase_number limit 1;
$$;

create or replace function public.build_minion_runtime_config(p_event_id uuid,p_key text,p_phase smallint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_definition public.minion_definitions%rowtype; v_generator jsonb; v_type text; v_options jsonb;
  v_answer text; v_min integer; v_max integer; v_count integer; v_question public.minion_questions%rowtype;
  v_phase_rank integer;
begin
  select * into v_definition from public.minion_definitions where event_id=p_event_id and key=p_key and enabled;
  if not found then raise exception 'minion_definition_not_found'; end if;
  v_generator:=coalesce(v_definition.runtime_generator,'{"type":"none"}'::jsonb); v_type:=v_generator->>'type';
  select count(*)::integer into v_phase_rank from public.boss_phases current_phase
    join public.boss_phases prior_phase on prior_phase.event_id=current_phase.event_id and prior_phase.sort_order<=current_phase.sort_order
    where current_phase.event_id=p_event_id and current_phase.phase_number=p_phase;
  if v_type='random-choice' then
    v_options:=coalesce(v_generator->'options','[]'::jsonb);
    if jsonb_array_length(v_options)=0 then return jsonb_build_object('options','[]'::jsonb); end if;
    v_answer:=v_options->>(floor(random()*jsonb_array_length(v_options))::integer);
    return jsonb_build_object('options',v_options,'correct_answer',v_answer,'tie_strategy',coalesce(v_generator->>'tieStrategy','failure')) ||
      case when coalesce((v_generator->>'visualTarget')::boolean,false) then jsonb_build_object('visual_target',v_answer) else '{}'::jsonb end;
  elsif v_type='random-option-count' then
    v_min:=greatest(2,coalesce((v_generator->>'minimumOptions')::integer,2));
    v_max:=greatest(v_min,coalesce((v_generator->>'maximumOptions')::integer,v_min));
    v_count:=least(v_max,v_min+greatest(0,v_phase_rank-1)); v_answer:=(1+floor(random()*v_count)::integer)::text;
    return jsonb_build_object('options',(select jsonb_agg(x::text) from generate_series(1,v_count)x),
      'correct_answer',v_answer,'target_index',v_answer,'option_count',v_count);
  elsif v_type='random-number' then
    v_min:=coalesce((v_generator->>'minimum')::integer,1); v_max:=greatest(v_min,coalesce((v_generator->>'maximum')::integer,v_min));
    v_count:=v_min+floor(random()*(v_max-v_min+1))::integer;
    return jsonb_build_object('options',(select jsonb_agg(x::text) from generate_series(v_min,v_max)x),'correct_answer',v_count::text,'count',v_count);
  elsif v_type='question-pool' then
    select * into v_question from public.minion_questions where event_id=p_event_id and enabled order by random() limit 1;
    if not found then raise exception 'minion_question_pool_empty'; end if;
    v_options:=case when v_question.answers='{}'::jsonb then jsonb_build_object('a',v_question.answer_a,'b',v_question.answer_b,'c',v_question.answer_c) else v_question.answers end;
    return jsonb_build_object('question',v_question.question,'options',(select jsonb_agg(key order by key) from jsonb_each_text(v_options)),
      'option_labels',v_options,
      'correct_answer',v_question.correct_answer,'tie_strategy','failure');
  elsif v_type='fixed-sequence' then
    return jsonb_build_object('sequence',coalesce(v_generator->'sequence','[]'::jsonb),'options',coalesce(v_generator->'options','[]'::jsonb),
      'option_labels',coalesce(v_generator->'optionLabels','{}'::jsonb),'correct_answer',lower(v_generator->>'correctAnswer'),
      'tie_strategy',coalesce(v_generator->>'tieStrategy','failure'));
  end if;
  return jsonb_build_object('options',coalesce(v_generator->'options','[]'::jsonb));
end;
$$;

revoke all on function public.register_event_pack_release(jsonb,text) from public,anon,authenticated;
revoke all on function public.apply_event_pack(uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function public.create_event_from_pack(text,text,text,text) from public,anon,authenticated;
revoke all on function public.build_minion_runtime_config(uuid,text,smallint) from public,anon,authenticated;
grant execute on function public.register_event_pack_release(jsonb,text) to service_role;
grant execute on function public.apply_event_pack(uuid,text,text,boolean) to service_role;
grant execute on function public.create_event_from_pack(text,text,text,text) to service_role;
grant execute on function public.build_minion_runtime_config(uuid,text,smallint) to service_role;

-- Existing deployments become explicit instances of the extracted compatibility pack.
update public.events set pack_key='halloween-2026',pack_version='1.0.0'
where slug in ('halloween-2026','halloween-2026-test');
update public.minion_definitions set presentation=case key
  when 'zombie_horde' then 'direction-choice' when 'spider_queen' then 'numbered-choice'
  when 'witch' then 'question' when 'bat_swarm' then 'count-memory' when 'reaper' then 'sequence-memory'
  else 'participation' end,
  runtime_generator=case key
  when 'zombie_horde' then '{"type":"random-choice","options":["links","mitte","rechts"],"visualTarget":true,"tieStrategy":"failure"}'::jsonb
  when 'spider_queen' then '{"type":"random-option-count","minimumOptions":4,"maximumOptions":6}'::jsonb
  when 'witch' then '{"type":"question-pool"}'::jsonb
  when 'bat_swarm' then '{"type":"random-number","minimum":4,"maximum":12}'::jsonb
  when 'reaper' then '{"type":"fixed-sequence","sequence":["💀","🕯️","🎃"],"options":["a","b","c"],"optionLabels":{"a":"🎃 → 🕯️ → 💀","b":"💀 → 🕯️ → 🎃","c":"🕯️ → 💀 → 🎃"},"correctAnswer":"b","tieStrategy":"failure"}'::jsonb
  else '{"type":"none"}'::jsonb end
where event_id in(select id from public.events where pack_key='halloween-2026');
update public.curse_definitions set presentation=case key
  when 'fog' then 'fog' when 'zombie_hands' then 'edge-hands' when 'spider_web' then 'edge-web'
  when 'witch_distortion' then 'color-distortion' when 'bat_attack' then 'flying-swarm'
  when 'darkness' then 'dark-vignette' when 'royal_curse' then 'royal-vignette' else 'generic-vignette' end
where event_id in(select id from public.events where pack_key='halloween-2026');
update public.event_settings set raid_special_minion_key='kings_herald',
  minion_spawn_windows='{"1":[45,60],"2":[40,55],"3":[35,50],"4":[30,45]}'::jsonb
where event_id in(select id from public.events where pack_key='halloween-2026');

with source_event as(
  select e.id,e.name,b.name boss_name,b.max_hp from public.events e join public.bosses b on b.event_id=e.id
  where e.pack_key='halloween-2026' order by(e.slug='halloween-2026')desc limit 1
), manifest as(
  select jsonb_build_object(
    'schemaVersion',1,'key','halloween-2026','version','1.0.0','name',s.name,'locale','de-DE',
    'boss',jsonb_build_object('name',s.boss_name,'defaultMaxHp',s.max_hp,
      'phases',(select coalesce(jsonb_agg(jsonb_build_object('id',p.phase_number,'name',p.name,'minPercent',p.min_percent,
        'maxPercent',p.max_percent,'color',p.color,'spawnWindowMinutes',coalesce(p.metadata->'spawnWindowMinutes','[30,45]'::jsonb),
        'intensity',coalesce(p.metadata->'intensity','1'::jsonb))order by p.sort_order),'[]'::jsonb)from public.boss_phases p where p.event_id=s.id),
      'milestones',(select coalesce(jsonb_agg(jsonb_build_object('percent',m.hp_percent,'label',m.name,'description',m.description)order by m.sort_order),'[]'::jsonb)from public.milestones m where m.event_id=s.id)),
    'minions',(select coalesce(jsonb_agg(jsonb_build_object('key',d.key,'name',d.name,'icon',d.icon,'gameMode',d.game_mode,
      'phaseMinimum',d.phase_min,'weight',d.weight,'introDurationMs',d.intro_duration_ms,'durationSeconds',d.duration_seconds,
      'observeSeconds',d.observe_duration_seconds,'damageClass',d.damage_class,'failureEffectKey',d.failure_curse_key,
      'command',d.command,'minimumParticipants',d.min_participants,'maximumParticipants',d.max_participants,
      'participationFactor',d.participation_factor,'curveExponent',d.curve_exponent,'introTitle',d.intro_title,
      'gameplayTitle',d.gameplay_title,'instruction',d.instruction,'presentation',d.presentation,'runtime',d.runtime_generator,
      'asset','')order by d.phase_min,d.name),'[]'::jsonb)from public.minion_definitions d where d.event_id=s.id),
    'effects',(select coalesce(jsonb_agg(jsonb_build_object('key',c.key,'name',c.name,'durationMs',c.duration_ms,'intensity',c.intensity,
      'presentation',c.presentation,'config',c.config)order by c.name),'[]'::jsonb)from public.curse_definitions c where c.event_id=s.id),
    'damageClasses',(select coalesce(jsonb_object_agg(dc.damage_class,jsonb_build_object('baseDamage',dc.base_damage,'provisional',dc.provisional)),'{}'::jsonb)from public.minion_damage_classes dc where dc.event_id=s.id),
    'scheduling',jsonb_build_object('raidSpecialMinionKey',(select raid_special_minion_key from public.event_settings where event_id=s.id),
      'raidDelaySeconds',(select jsonb_build_array(raid_special_delay_min_seconds,raid_special_delay_max_seconds)from public.event_settings where event_id=s.id),
      'raidCooldownSeconds',(select jsonb_build_array(raid_post_cooldown_min_seconds,raid_post_cooldown_max_seconds)from public.event_settings where event_id=s.id)),
    'events','[{"slug":"halloween-2026","variant":"production","testControls":false},{"slug":"halloween-2026-test","variant":"test","testControls":true}]'::jsonb,
    'theme','{}'::jsonb
  ) value from source_event s
)
select public.register_event_pack_release(value,null) from manifest;

create or replace function public.spawn_minion_v4(
  p_event_id uuid,p_definition_id uuid,p_streamer_id uuid,p_force boolean default false,
  p_trigger_source text default 'scheduler',p_trigger_reference text default null,p_spawned_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_definition public.minion_definitions%rowtype; v_settings public.event_settings%rowtype;
  v_event public.events%rowtype; v_boss public.bosses%rowtype; v_id uuid; v_viewers integer;
  v_required integer; v_phase smallint; v_runtime jsonb; v_intro_end timestamptz;
  v_gameplay_start timestamptz; v_accepts timestamptz; v_expires timestamptz; v_status text;
begin
  if p_trigger_source not in ('scheduler','raid','admin','manual_test') then raise exception 'invalid_trigger_source'; end if;
  select * into v_event from public.events where id=p_event_id;
  select * into v_settings from public.event_settings where event_id=p_event_id;
  select * into v_boss from public.bosses where event_id=p_event_id for update;
  if not found or v_boss.current_hp<=0 then raise exception 'boss_defeated'; end if;
  if not p_force and(v_event.status<>'active' or v_settings.event_paused or not v_settings.minions_enabled) then raise exception 'minions_disabled'; end if;
  if not exists(select 1 from public.streamers s where s.id=p_streamer_id and s.event_id=p_event_id and s.enabled and s.gameplay_enabled) then raise exception 'streamer_not_available'; end if;
  if not p_force and not exists(select 1 from public.streamer_runtime r where r.event_id=p_event_id and r.streamer_id=p_streamer_id and r.is_live) then raise exception 'streamer_offline'; end if;
  if exists(select 1 from public.minion_events m where m.event_id=p_event_id and m.streamer_id=p_streamer_id and m.status in('intro','active','success','failure','curse')) then raise exception 'streamer_minion_already_active'; end if;
  select * into v_definition from public.minion_definitions where id=p_definition_id and event_id=p_event_id and enabled;
  if not found then raise exception 'minion_definition_not_found'; end if;
  v_phase:=public.current_event_phase(p_event_id,v_boss.current_hp,v_boss.max_hp);
  if v_phase is null then raise exception 'boss_phase_not_configured'; end if;
  if not p_force and not exists(
    select 1 from public.boss_phases current_phase join public.boss_phases minimum_phase on minimum_phase.event_id=current_phase.event_id
    where current_phase.event_id=p_event_id and current_phase.phase_number=v_phase
      and minimum_phase.phase_number=v_definition.phase_min and minimum_phase.sort_order<=current_phase.sort_order
  ) then raise exception 'minion_not_available_in_phase'; end if;
  v_viewers:=public.stable_viewer_estimate(p_event_id,p_streamer_id,greatest(4,coalesce((select current_viewer_count from public.streamer_runtime where streamer_id=p_streamer_id),4)));
  v_required:=public.calculate_required_participants(v_viewers,v_definition.id);
  v_runtime:=public.build_minion_runtime_config(p_event_id,v_definition.key,v_phase);
  v_intro_end:=p_spawned_at+make_interval(secs=>v_definition.intro_duration_ms::numeric/1000);
  v_gameplay_start:=v_intro_end; v_accepts:=v_gameplay_start+make_interval(secs=>v_definition.observe_duration_seconds);
  v_expires:=v_accepts+make_interval(secs=>v_definition.duration_seconds);
  v_status:=case when p_spawned_at>now() then 'scheduled' else 'intro' end;
  insert into public.minion_events(event_id,run_id,minion_definition_id,streamer_id,status,viewer_estimate,
    required_participants,participant_count,duration_seconds,damage_class,runtime_config,spawned_at,
    intro_ends_at,gameplay_starts_at,accepts_answers_at,expires_at,trigger_source,trigger_reference)
  values(p_event_id,v_boss.run_id,v_definition.id,p_streamer_id,v_status,v_viewers,v_required,0,
    v_definition.duration_seconds,v_definition.damage_class,v_runtime-'correct_answer',p_spawned_at,
    v_intro_end,v_gameplay_start,v_accepts,v_expires,p_trigger_source,p_trigger_reference) returning id into v_id;
  insert into public.minion_event_secrets(minion_event_id,event_id,correct_answer) values(v_id,p_event_id,v_runtime->>'correct_answer');
  perform public.log_minion_system_event(p_event_id,v_id,p_streamer_id,case when v_status='scheduled' then 'scheduled' else 'spawned' end,
    jsonb_build_object('trigger_source',p_trigger_source,'viewer_estimate',v_viewers,'required_participants',v_required));
  perform public.touch_event(p_event_id);
  return jsonb_build_object('minionEventId',v_id,'status',v_status,'viewerEstimate',v_viewers,'requiredParticipants',v_required);
end;
$$;

create or replace function public.event_minion_delay_seconds(p_event_id uuid,p_phase smallint)
returns integer language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_window jsonb; v_min integer; v_max integer;
begin
  select minion_spawn_windows->(p_phase::text) into v_window from public.event_settings where event_id=p_event_id;
  v_min:=greatest(1,coalesce((v_window->>0)::integer,30)); v_max:=greatest(v_min,coalesce((v_window->>1)::integer,45));
  return(v_min*60)+floor(random()*((v_max-v_min)*60+1))::integer;
end;
$$;

create or replace function public.queue_eligible_raid_herald()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_settings public.event_settings%rowtype; v_delay integer;
begin
  if not new.eligible or new.to_streamer_id is null then return new; end if;
  if not exists(select 1 from public.streamers s where s.id=new.to_streamer_id and s.event_id=new.event_id and s.enabled and s.gameplay_enabled) then return new; end if;
  select * into v_settings from public.event_settings where event_id=new.event_id;
  if coalesce(v_settings.raid_special_minion_key,'')='' then return new; end if;
  v_delay:=v_settings.raid_special_delay_min_seconds+floor(random()*(v_settings.raid_special_delay_max_seconds-v_settings.raid_special_delay_min_seconds+1))::integer;
  insert into public.minion_special_queue(event_id,streamer_id,minion_key,due_at,trigger_source,trigger_reference)
  values(new.event_id,new.to_streamer_id,v_settings.raid_special_minion_key,new.occurred_at+make_interval(secs=>v_delay),'raid',new.id::text)
  on conflict(event_id,trigger_source,trigger_reference) do nothing;
  return new;
end;
$$;

create or replace function public.process_minion_tick(p_event_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_queue public.minion_special_queue%rowtype; v_definition_id uuid; v_schedule record; v_phase smallint;
  v_spawned integer:=0; v_specials integer:=0; v_event record;
begin
  perform public.advance_minion_engine(p_event_id);
  for v_queue in select * from public.minion_special_queue q where(p_event_id is null or q.event_id=p_event_id)
    and q.status='scheduled' and q.due_at<=now() order by q.due_at for update skip locked loop
    if not exists(select 1 from public.streamers s where s.id=v_queue.streamer_id and s.event_id=v_queue.event_id and s.enabled and s.gameplay_enabled) then
      update public.minion_special_queue set status='cancelled',updated_at=now() where id=v_queue.id; continue; end if;
    if exists(select 1 from public.minion_events m where m.event_id=v_queue.event_id and m.streamer_id=v_queue.streamer_id and m.status in('intro','active','success','failure','curse')) then
      update public.minion_special_queue set due_at=now()+interval '2 minutes',updated_at=now() where id=v_queue.id; continue; end if;
    select id into v_definition_id from public.minion_definitions where event_id=v_queue.event_id and key=v_queue.minion_key and enabled;
    begin
      perform public.spawn_minion_v4(v_queue.event_id,v_definition_id,v_queue.streamer_id,false,'raid',v_queue.trigger_reference,now());
      update public.minion_special_queue set status='spawned',updated_at=now() where id=v_queue.id;
      update public.minion_spawn_schedules ms set cooldown_until=now()+make_interval(secs=>es.raid_post_cooldown_min_seconds+
        floor(random()*(es.raid_post_cooldown_max_seconds-es.raid_post_cooldown_min_seconds+1))::integer),next_spawn_at=null,updated_at=now()
        from public.event_settings es where ms.event_id=v_queue.event_id and ms.streamer_id=v_queue.streamer_id and es.event_id=ms.event_id;
      v_specials:=v_specials+1;
    exception when others then update public.minion_special_queue set due_at=now()+interval '2 minutes',updated_at=now() where id=v_queue.id; end;
  end loop;
  for v_event in select e.id,b.current_hp,b.max_hp,es.raid_special_minion_key from public.events e
    join public.event_settings es on es.event_id=e.id join public.bosses b on b.event_id=e.id
    where(p_event_id is null or e.id=p_event_id) and e.status='active' and not es.event_paused and es.minions_enabled and es.twitch_tracking_enabled and b.current_hp>0 loop
    v_phase:=public.current_event_phase(v_event.id,v_event.current_hp,v_event.max_hp);
    insert into public.minion_spawn_schedules(event_id,streamer_id,next_spawn_at,cooldown_until,phase_number)
    select v_event.id,s.id,now()+make_interval(secs=>public.event_minion_delay_seconds(v_event.id,v_phase)),now()+interval '10 minutes',v_phase
    from public.streamers s join public.streamer_runtime r on r.streamer_id=s.id and r.event_id=s.event_id
    where s.event_id=v_event.id and s.enabled and s.tracking_enabled and s.gameplay_enabled and r.is_live on conflict(event_id,streamer_id) do nothing;
    for v_schedule in select ms.* from public.minion_spawn_schedules ms join public.streamers s on s.id=ms.streamer_id
      join public.streamer_runtime r on r.streamer_id=s.id and r.event_id=s.event_id where ms.event_id=v_event.id and s.enabled and s.tracking_enabled and s.gameplay_enabled and r.is_live
      and ms.next_spawn_at<=now() and coalesce(ms.cooldown_until,'-infinity')<=now() for update of ms skip locked loop
      if exists(select 1 from public.minion_events m where m.event_id=v_event.id and m.streamer_id=v_schedule.streamer_id and m.status in('intro','active','success','failure','curse')) then continue; end if;
      select d.id into v_definition_id from public.minion_definitions d where d.event_id=v_event.id and d.enabled
        and(v_event.raid_special_minion_key is null or d.key<>v_event.raid_special_minion_key) and d.weight>0
        and exists(select 1 from public.boss_phases current_phase join public.boss_phases minimum_phase on minimum_phase.event_id=current_phase.event_id
          where current_phase.event_id=v_event.id and current_phase.phase_number=v_phase and minimum_phase.phase_number=d.phase_min
            and minimum_phase.sort_order<=current_phase.sort_order)
        order by -ln(greatest(random(),0.000001))/d.weight limit 1;
      if v_definition_id is not null then
        perform public.spawn_minion_v4(v_event.id,v_definition_id,v_schedule.streamer_id,false,'scheduler',null,now());
        update public.minion_spawn_schedules set next_spawn_at=null,phase_number=v_phase,updated_at=now() where event_id=v_event.id and streamer_id=v_schedule.streamer_id;
        v_spawned:=v_spawned+1;
      end if;
    end loop;
    update public.minion_spawn_schedules ms set next_spawn_at=now()+make_interval(secs=>public.event_minion_delay_seconds(v_event.id,v_phase)),phase_number=v_phase,updated_at=now()
    where ms.event_id=v_event.id and ms.next_spawn_at is null and exists(select 1 from public.streamers s where s.id=ms.streamer_id and s.enabled and s.tracking_enabled and s.gameplay_enabled)
      and not exists(select 1 from public.minion_events m where m.event_id=ms.event_id and m.streamer_id=ms.streamer_id and m.status in('intro','active','success','failure','curse'));
  end loop;
  delete from public.minion_submission_rate_limits where window_started_at<now()-interval '1 hour';
  delete from public.minion_participants where submitted_at<now()-interval '24 hours' and minion_event_id in(select id from public.minion_events where status in('complete','cancelled','expired'));
  return jsonb_build_object('spawned',v_spawned,'raidSpecials',v_specials);
end;
$$;

alter function public.get_public_event_state(text) rename to get_public_event_state_legacy_v5;
alter function public.get_stream_elements_widget_state(text,text) rename to get_stream_elements_widget_state_legacy_v5;

create or replace function public.enrich_event_pack_state(p_event_slug text,p_state jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_event public.events%rowtype; v_boss public.bosses%rowtype; v_phase jsonb; v_minions jsonb;
begin
  if p_state is null then return null; end if;
  select * into v_event from public.events where slug=lower(btrim(p_event_slug)); if not found then return null; end if;
  select * into v_boss from public.bosses where event_id=v_event.id;
  select to_jsonb(p) into v_phase from public.boss_phases p where p.event_id=v_event.id
    and p.phase_number=public.current_event_phase(v_event.id,v_boss.current_hp,v_boss.max_hp);
  select coalesce(jsonb_agg(item||jsonb_build_object('presentation',d.presentation)),'[]'::jsonb) into v_minions
  from jsonb_array_elements(coalesce(p_state->'minions','[]'::jsonb))item
  join public.minion_definitions d on d.id=(item->>'definition_id')::uuid;
  p_state:=jsonb_set(p_state,'{event}',coalesce(p_state->'event','{}'::jsonb)||jsonb_build_object('pack_key',v_event.pack_key,'pack_version',v_event.pack_version,'presentation',v_event.presentation),true);
  p_state:=jsonb_set(p_state,'{boss,phase}',coalesce(v_phase,'{}'::jsonb),true);
  p_state:=jsonb_set(p_state,'{minions}',v_minions,true);
  return p_state||jsonb_build_object(
    'phases',coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order,p.phase_number) from public.boss_phases p where p.event_id=v_event.id),'[]'::jsonb),
    'minion_definitions',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'key',d.key,'name',d.name,'icon',d.icon,'game_mode',d.game_mode,
      'phase_min',d.phase_min,'damage_class',d.damage_class,'presentation',d.presentation,'enabled',d.enabled) order by d.phase_min,d.name)
      from public.minion_definitions d where d.event_id=v_event.id),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_public_event_state(p_event_slug text)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select public.enrich_event_pack_state(p_event_slug,public.get_public_event_state_legacy_v5(p_event_slug));
$$;
create or replace function public.get_stream_elements_widget_state(p_event_slug text,p_twitch_login text)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select public.enrich_event_pack_state(p_event_slug,public.get_stream_elements_widget_state_legacy_v5(p_event_slug,p_twitch_login));
$$;

revoke all on function public.enrich_event_pack_state(text,jsonb) from public,anon,authenticated;
revoke all on function public.get_public_event_state_legacy_v5(text) from public,anon,authenticated;
revoke all on function public.get_stream_elements_widget_state_legacy_v5(text,text) from public,anon,authenticated;
grant execute on function public.get_public_event_state(text) to anon,authenticated;
grant execute on function public.get_stream_elements_widget_state(text,text) to anon,authenticated;
grant execute on function public.spawn_minion_v4(uuid,uuid,uuid,boolean,text,text,timestamptz) to service_role;
grant execute on function public.event_minion_delay_seconds(uuid,smallint) to service_role;
grant execute on function public.process_minion_tick(uuid) to service_role;
