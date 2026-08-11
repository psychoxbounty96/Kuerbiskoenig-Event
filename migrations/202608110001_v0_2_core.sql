create extension if not exists pgcrypto;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'testing', 'active', 'paused', 'finished', 'archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bosses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  name text not null,
  max_hp bigint not null check (max_hp > 0),
  current_hp bigint not null check (current_hp >= 0 and current_hp <= max_hp),
  status text not null default 'active' check (status in ('active', 'defeated', 'disabled')),
  run_id uuid not null default gen_random_uuid(),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.boss_phases (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  boss_id uuid not null references public.bosses(id) on delete cascade,
  phase_number smallint not null check (phase_number between 1 and 4),
  name text not null,
  min_percent numeric(5,2) not null check (min_percent >= 0),
  max_percent numeric(5,2) not null check (max_percent <= 100),
  color text not null default '#f28a2e',
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  unique (boss_id, phase_number),
  check (min_percent < max_percent or (phase_number = 4 and min_percent = 0))
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  boss_id uuid not null references public.bosses(id) on delete cascade,
  name text not null,
  description text not null default '',
  hp_percent numeric(5,2) not null check (hp_percent between 0 and 100),
  sort_order integer not null default 0,
  reached_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (boss_id, hp_percent)
);

create table public.streamers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null,
  community_name text not null,
  twitch_login text not null default '',
  twitch_user_id text,
  twitch_url text not null default '',
  avatar_url text,
  description text not null default '',
  enabled boolean not null default true,
  sort_order integer not null default 0,
  damage bigint not null default 0 check (damage >= 0),
  minions_defeated integer not null default 0 check (minions_defeated >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, slug)
);

create table public.damage_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  boss_id uuid not null references public.bosses(id) on delete cascade,
  run_id uuid not null,
  streamer_id uuid references public.streamers(id) on delete set null,
  source text not null check (source in ('admin', 'passive', 'active', 'minion', 'raid', 'special_event', 'system')),
  source_reference text,
  viewer_count integer,
  idempotency_key text not null,
  raw_damage bigint not null check (raw_damage >= 0),
  curve_factor numeric(10,4) not null default 1 check (curve_factor >= 0),
  global_multiplier numeric(10,4) not null default 1 check (global_multiplier >= 0),
  source_multiplier numeric(10,4) not null default 1 check (source_multiplier >= 0),
  final_damage bigint not null check (final_damage >= 0),
  boss_hp_before bigint not null check (boss_hp_before >= 0),
  boss_hp_after bigint not null check (boss_hp_after >= 0),
  requested_damage bigint not null check (requested_damage >= 0),
  applied_damage bigint not null check (applied_damage >= 0),
  multiplier numeric(10,4) not null default 1 check (multiplier >= 0),
  actor_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (event_id, idempotency_key)
);

create table public.minion_definitions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  key text not null,
  name text not null,
  command text not null,
  base_damage bigint not null check (base_damage >= 0),
  duration_seconds integer not null check (duration_seconds between 5 and 3600),
  type text not null default 'participation',
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, key)
);

create table public.minion_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  run_id uuid not null,
  minion_definition_id uuid not null references public.minion_definitions(id),
  streamer_id uuid not null references public.streamers(id),
  status text not null default 'active' check (status in ('active', 'success', 'failed', 'expired', 'cancelled')),
  spawned_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by uuid,
  participant_count integer not null default 0 check (participant_count >= 0),
  required_participants integer not null default 1 check (required_participants > 0),
  damage_awarded bigint not null default 0 check (damage_awarded >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (expires_at > spawned_at)
);

create unique index minion_events_one_active_type_per_streamer
  on public.minion_events (event_id, streamer_id, minion_definition_id)
  where status = 'active';
create index minion_events_public_lookup on public.minion_events (event_id, streamer_id, status, spawned_at desc);
create index damage_events_event_created on public.damage_events (event_id, created_at desc);

create table public.event_settings (
  event_id uuid primary key references public.events(id) on delete cascade,
  event_paused boolean not null default false,
  damage_enabled boolean not null default true,
  minions_enabled boolean not null default true,
  global_damage_multiplier numeric(10,4) not null default 1 check (global_damage_multiplier between 0 and 100),
  passive_damage_multiplier numeric(10,4) not null default 1 check (passive_damage_multiplier between 0 and 100),
  active_damage_multiplier numeric(10,4) not null default 1 check (active_damage_multiplier between 0 and 100),
  passive_tick_seconds integer not null default 120 check (passive_tick_seconds between 10 and 86400),
  passive_curve_exponent numeric(10,4),
  passive_base_damage numeric(14,4),
  minion_scaling_exponent numeric(10,4),
  minion_min_required integer,
  minion_max_required integer,
  small_stream_bonus numeric(10,4),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.event_admins (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'operator' check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  actor_user_id uuid not null,
  action text not null,
  target_type text,
  target_id uuid,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.touch_event(p_event_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.events set updated_at = now() where id = p_event_id;
$$;

create or replace function public.current_phase(p_current_hp bigint, p_max_hp bigint)
returns smallint language sql immutable strict as $$
  select case
    when p_current_hp = 0 then 4
    when p_current_hp::numeric / p_max_hp * 100 > 75 then 1
    when p_current_hp::numeric / p_max_hp * 100 > 50 then 2
    when p_current_hp::numeric / p_max_hp * 100 > 25 then 3
    else 4
  end::smallint;
$$;

create or replace function public.apply_boss_damage(
  p_event_id uuid,
  p_streamer_id uuid,
  p_source text,
  p_raw_amount bigint,
  p_idempotency_key text,
  p_force boolean default false,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_boss public.bosses%rowtype;
  v_settings public.event_settings%rowtype;
  v_existing public.damage_events%rowtype;
  v_multiplier numeric(10,4);
  v_requested bigint;
  v_applied bigint;
  v_new_hp bigint;
begin
  if p_raw_amount < 0 or p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'invalid_damage_request';
  end if;

  select * into v_existing from public.damage_events
    where event_id = p_event_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('idempotent', true, 'damageEventId', v_existing.id,
      'appliedDamage', v_existing.applied_damage);
  end if;

  select * into v_boss from public.bosses where event_id = p_event_id for update;
  if not found then raise exception 'boss_not_found'; end if;
  select * into v_settings from public.event_settings where event_id = p_event_id;
  if not found then raise exception 'settings_not_found'; end if;

  -- Re-check after the row lock: concurrent duplicate delivery must be idempotent.
  select * into v_existing from public.damage_events
    where event_id = p_event_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('idempotent', true, 'damageEventId', v_existing.id,
      'appliedDamage', v_existing.applied_damage);
  end if;

  if not p_force and (v_settings.event_paused or not v_settings.damage_enabled) then
    raise exception 'damage_disabled';
  end if;
  if p_streamer_id is not null and not exists (
    select 1 from public.streamers s where s.id = p_streamer_id and s.event_id = p_event_id and s.enabled
  ) then
    raise exception 'streamer_not_available';
  end if;

  v_multiplier := v_settings.global_damage_multiplier * case
    when p_source = 'passive' then v_settings.passive_damage_multiplier
    when p_source in ('active', 'minion') then v_settings.active_damage_multiplier
    else 1
  end;
  v_requested := greatest(0, floor(p_raw_amount * v_multiplier)::bigint);
  v_applied := least(v_boss.current_hp, v_requested);
  v_new_hp := greatest(0, v_boss.current_hp - v_applied);

  insert into public.damage_events (
    event_id, boss_id, run_id, streamer_id, source, idempotency_key,
    raw_damage, curve_factor, global_multiplier, source_multiplier, final_damage,
    boss_hp_before, boss_hp_after, requested_damage, applied_damage, multiplier, actor_user_id
  ) values (
    p_event_id, v_boss.id, v_boss.run_id, p_streamer_id, p_source, p_idempotency_key,
    p_raw_amount, 1, v_settings.global_damage_multiplier,
    case when p_source = 'passive' then v_settings.passive_damage_multiplier
      when p_source in ('active', 'minion') then v_settings.active_damage_multiplier else 1 end,
    v_applied, v_boss.current_hp, v_new_hp,
    p_raw_amount, v_applied, v_multiplier, p_actor_user_id
  ) returning * into v_existing;

  update public.bosses set current_hp = v_new_hp, version = version + 1, updated_at = now()
    where id = v_boss.id;
  if p_streamer_id is not null and v_applied > 0 then
    update public.streamers set damage = damage + v_applied, updated_at = now()
      where id = p_streamer_id and event_id = p_event_id;
  end if;
  update public.milestones set reached_at = now()
    where boss_id = v_boss.id and reached_at is null
      and v_boss.current_hp > floor(v_boss.max_hp * hp_percent / 100)
      and v_new_hp <= floor(v_boss.max_hp * hp_percent / 100);
  perform public.touch_event(p_event_id);

  return jsonb_build_object('idempotent', false, 'damageEventId', v_existing.id,
    'appliedDamage', v_applied, 'currentHp', v_new_hp,
    'phase', public.current_phase(v_new_hp, v_boss.max_hp));
exception when unique_violation then
  select * into v_existing from public.damage_events
    where event_id = p_event_id and idempotency_key = p_idempotency_key;
  return jsonb_build_object('idempotent', true, 'damageEventId', v_existing.id,
    'appliedDamage', v_existing.applied_damage);
end;
$$;

create or replace function public.admin_set_boss_hp(p_event_id uuid, p_hp bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_boss public.bosses%rowtype; v_new_hp bigint;
begin
  select * into v_boss from public.bosses where event_id = p_event_id for update;
  if not found then raise exception 'boss_not_found'; end if;
  v_new_hp := greatest(0, least(v_boss.max_hp, p_hp));
  update public.bosses set current_hp = v_new_hp, version = version + 1, updated_at = now() where id = v_boss.id;
  if v_new_hp < v_boss.current_hp then
    update public.milestones set reached_at = now() where boss_id = v_boss.id and reached_at is null
      and v_boss.current_hp > floor(v_boss.max_hp * hp_percent / 100)
      and v_new_hp <= floor(v_boss.max_hp * hp_percent / 100);
  end if;
  perform public.touch_event(p_event_id);
  return jsonb_build_object('currentHp', v_new_hp, 'phase', public.current_phase(v_new_hp, v_boss.max_hp));
end;
$$;

create or replace function public.admin_reset_boss(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_boss public.bosses%rowtype;
begin
  select * into v_boss from public.bosses where event_id = p_event_id for update;
  if not found then raise exception 'boss_not_found'; end if;
  update public.bosses set current_hp = max_hp, run_id = gen_random_uuid(), version = version + 1, updated_at = now() where id = v_boss.id;
  update public.milestones set reached_at = null where boss_id = v_boss.id;
  update public.streamers set damage = 0, minions_defeated = 0, updated_at = now() where event_id = p_event_id;
  update public.minion_events set status = 'cancelled', resolved_at = now() where event_id = p_event_id and status = 'active';
  perform public.touch_event(p_event_id);
  return jsonb_build_object('currentHp', v_boss.max_hp, 'phase', 1);
end;
$$;

create or replace function public.spawn_minion(
  p_event_id uuid, p_definition_id uuid, p_streamer_id uuid, p_force boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_definition public.minion_definitions%rowtype; v_settings public.event_settings%rowtype; v_id uuid; v_run_id uuid;
begin
  select * into v_settings from public.event_settings where event_id = p_event_id;
  if not found then raise exception 'settings_not_found'; end if;
  if not p_force and (v_settings.event_paused or not v_settings.minions_enabled) then raise exception 'minions_disabled'; end if;
  if not exists (select 1 from public.streamers where id = p_streamer_id and event_id = p_event_id and enabled) then
    raise exception 'streamer_not_available';
  end if;
  select * into v_definition from public.minion_definitions where id = p_definition_id and event_id = p_event_id and enabled;
  if not found then raise exception 'minion_definition_not_found'; end if;
  select run_id into v_run_id from public.bosses where event_id = p_event_id;
  update public.minion_events set status = 'expired', resolved_at = now()
    where event_id = p_event_id and status = 'active' and expires_at <= now();
  insert into public.minion_events (event_id, run_id, minion_definition_id, streamer_id, expires_at)
    values (p_event_id, v_run_id, p_definition_id, p_streamer_id, now() + make_interval(secs => v_definition.duration_seconds))
    returning id into v_id;
  perform public.touch_event(p_event_id);
  return jsonb_build_object('minionEventId', v_id);
end;
$$;

create or replace function public.resolve_minion(
  p_event_id uuid, p_minion_event_id uuid, p_resolution text, p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_minion public.minion_events%rowtype; v_definition public.minion_definitions%rowtype; v_damage jsonb;
begin
  if p_resolution not in ('success', 'failed', 'cancelled') then raise exception 'invalid_resolution'; end if;
  select * into v_minion from public.minion_events where id = p_minion_event_id and event_id = p_event_id for update;
  if not found then raise exception 'minion_not_found'; end if;
  if v_minion.status <> 'active' then return jsonb_build_object('idempotent', true, 'status', v_minion.status); end if;
  if v_minion.expires_at <= now() and p_resolution = 'success' then raise exception 'minion_expired'; end if;
  update public.minion_events set status = p_resolution, resolved_at = now(), resolved_by = p_actor_user_id where id = v_minion.id;
  if p_resolution = 'success' then
    select * into v_definition from public.minion_definitions where id = v_minion.minion_definition_id;
    v_damage := public.apply_boss_damage(p_event_id, v_minion.streamer_id, 'minion', v_definition.base_damage,
      'minion:' || v_minion.id::text, false, p_actor_user_id);
    update public.minion_events set damage_awarded = coalesce((v_damage->>'appliedDamage')::bigint, 0) where id = v_minion.id;
    update public.streamers set minions_defeated = minions_defeated + 1, updated_at = now() where id = v_minion.streamer_id;
  end if;
  perform public.touch_event(p_event_id);
  return jsonb_build_object('idempotent', false, 'status', p_resolution, 'damage', v_damage);
end;
$$;

create or replace function public.expire_stale_minions(p_event_id uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  update public.minion_events set status = 'expired', resolved_at = now()
    where status = 'active' and expires_at <= now() and (p_event_id is null or event_id = p_event_id);
  get diagnostics v_count = row_count;
  if p_event_id is not null and v_count > 0 then perform public.touch_event(p_event_id); end if;
  return v_count;
end;
$$;

create or replace function public.get_public_event_state(p_event_slug text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with selected as (
    select e.*, b.id boss_id, b.run_id, b.name boss_name, b.max_hp, b.current_hp, b.updated_at boss_updated_at,
      s.event_paused, s.damage_enabled, s.minions_enabled,
      s.global_damage_multiplier, s.passive_damage_multiplier, s.active_damage_multiplier, s.passive_tick_seconds
    from public.events e join public.bosses b on b.event_id = e.id
    join public.event_settings s on s.event_id = e.id where e.slug = p_event_slug
      and (e.status in ('testing', 'active', 'paused', 'finished', 'archived')
        or exists (select 1 from public.event_admins ea where ea.event_id = e.id and ea.user_id = auth.uid()))
  )
  select jsonb_build_object(
    'updated_at', greatest(selected.updated_at, selected.boss_updated_at),
    'event', jsonb_build_object('id', selected.id, 'slug', selected.slug, 'name', selected.name,
      'description', selected.description, 'status', selected.status),
    'boss', jsonb_build_object('id', selected.boss_id, 'name', selected.boss_name, 'max_hp', selected.max_hp,
      'current_hp', selected.current_hp, 'phase', coalesce((
        select to_jsonb(p) from public.boss_phases p where p.boss_id = selected.boss_id
          and p.phase_number = public.current_phase(selected.current_hp, selected.max_hp)
      ), '{}'::jsonb)),
    'settings', jsonb_build_object('event_paused', selected.event_paused, 'damage_enabled', selected.damage_enabled,
      'minions_enabled', selected.minions_enabled,
      'global_damage_multiplier', case when exists (select 1 from public.event_admins ea where ea.event_id = selected.id and ea.user_id = auth.uid()) then selected.global_damage_multiplier else 1 end,
      'passive_damage_multiplier', case when exists (select 1 from public.event_admins ea where ea.event_id = selected.id and ea.user_id = auth.uid()) then selected.passive_damage_multiplier else 1 end,
      'active_damage_multiplier', case when exists (select 1 from public.event_admins ea where ea.event_id = selected.id and ea.user_id = auth.uid()) then selected.active_damage_multiplier else 1 end,
      'passive_tick_seconds', case when exists (select 1 from public.event_admins ea where ea.event_id = selected.id and ea.user_id = auth.uid()) then selected.passive_tick_seconds else 120 end),
    'stats', jsonb_build_object('total_damage', greatest(0, selected.max_hp - selected.current_hp),
      'total_minions_defeated', (select count(*) from public.minion_events m where m.event_id = selected.id and m.run_id = selected.run_id and m.status = 'success'),
      'total_minions_failed', (select count(*) from public.minion_events m where m.event_id = selected.id and m.run_id = selected.run_id and m.status in ('failed', 'expired')),
      'active_streamer_count', (select count(*) from public.streamers s where s.event_id = selected.id and s.enabled),
      'unique_participants', 0),
    'streamers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug,
      'display_name', s.display_name, 'community_name', s.community_name, 'twitch_login', s.twitch_login,
      'twitch_url', s.twitch_url, 'avatar_url', s.avatar_url, 'enabled', s.enabled, 'sort_order', s.sort_order,
      'damage', coalesce((select sum(d.final_damage) from public.damage_events d where d.event_id = selected.id and d.run_id = selected.run_id and d.streamer_id = s.id), 0),
      'minions_defeated', s.minions_defeated) order by s.sort_order, s.display_name)
      from public.streamers s where s.event_id = selected.id and
        (s.enabled or exists (select 1 from public.event_admins ea where ea.event_id = selected.id and ea.user_id = auth.uid()))
      ), '[]'::jsonb),
    'minions', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'key', d.key, 'name', d.name,
      'command', d.command, 'base_damage', d.base_damage, 'streamer_id', st.id, 'streamer_slug', st.slug,
      'streamer_name', st.display_name, 'status', m.status, 'spawned_at', m.spawned_at,
      'expires_at', m.expires_at, 'resolved_at', m.resolved_at) order by m.spawned_at desc)
      from public.minion_events m join public.minion_definitions d on d.id = m.minion_definition_id
      join public.streamers st on st.id = m.streamer_id where m.event_id = selected.id and m.run_id = selected.run_id
        and (m.status = 'active' or m.resolved_at > now() - interval '15 seconds')), '[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name,
      'description', m.description, 'hp_percent', m.hp_percent, 'sort_order', m.sort_order, 'reached_at', m.reached_at)
      order by m.sort_order) from public.milestones m where m.event_id = selected.id), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(log_entry order by happened_at desc) from (
        select jsonb_build_object('id', d.id, 'timestamp', d.created_at, 'type', 'damage',
          'message', concat(d.source, ': ', d.final_damage, ' Schaden')) log_entry, d.created_at happened_at
        from public.damage_events d where d.event_id = selected.id
        union all
        select jsonb_build_object('id', m.id, 'timestamp', coalesce(m.resolved_at, m.spawned_at), 'type', 'minion',
          'message', concat(md.name, ' · ', st.display_name, ': ', m.status)) log_entry,
          coalesce(m.resolved_at, m.spawned_at) happened_at
        from public.minion_events m join public.minion_definitions md on md.id = m.minion_definition_id
        join public.streamers st on st.id = m.streamer_id where m.event_id = selected.id
        order by happened_at desc limit 20
      ) recent_log
    ), '[]'::jsonb)
  ) from selected;
$$;

alter table public.events enable row level security;
alter table public.bosses enable row level security;
alter table public.boss_phases enable row level security;
alter table public.milestones enable row level security;
alter table public.streamers enable row level security;
alter table public.damage_events enable row level security;
alter table public.minion_definitions enable row level security;
alter table public.minion_events enable row level security;
alter table public.event_settings enable row level security;
alter table public.event_admins enable row level security;
alter table public.admin_audit_log enable row level security;

create policy events_public_read on public.events for select to anon, authenticated using (status in ('testing', 'active', 'paused', 'finished', 'archived'));
create policy bosses_public_read on public.bosses for select to anon, authenticated using (
  exists (select 1 from public.events e where e.id = event_id and e.status in ('testing', 'active', 'paused', 'finished', 'archived'))
);
create policy phases_public_read on public.boss_phases for select to anon, authenticated using (
  exists (select 1 from public.bosses b join public.events e on e.id = b.event_id where b.id = boss_id and e.status in ('testing', 'active', 'paused', 'finished', 'archived'))
);
create policy milestones_public_read on public.milestones for select to anon, authenticated using (
  exists (select 1 from public.events e where e.id = event_id and e.status in ('testing', 'active', 'paused', 'finished', 'archived'))
);
create policy streamers_public_read on public.streamers for select to anon, authenticated using (
  enabled and exists (select 1 from public.events e where e.id = event_id and e.status in ('testing', 'active', 'paused', 'finished', 'archived'))
);
create policy minion_definitions_public_read on public.minion_definitions for select to anon, authenticated using (
  enabled and exists (select 1 from public.events e where e.id = event_id and e.status in ('testing', 'active', 'paused', 'finished', 'archived'))
);
create policy minion_events_public_read on public.minion_events for select to anon, authenticated using (
  exists (select 1 from public.events e where e.id = event_id and e.status in ('testing', 'active', 'paused', 'finished', 'archived'))
);

revoke all on all tables in schema public from anon, authenticated;
grant select on public.events, public.bosses, public.boss_phases, public.milestones,
  public.streamers, public.minion_definitions, public.minion_events to anon, authenticated;
revoke all on function public.apply_boss_damage(uuid, uuid, text, bigint, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.admin_set_boss_hp(uuid, bigint) from public, anon, authenticated;
revoke all on function public.admin_reset_boss(uuid) from public, anon, authenticated;
revoke all on function public.spawn_minion(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.resolve_minion(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.expire_stale_minions(uuid) from public, anon, authenticated;
revoke all on function public.touch_event(uuid) from public, anon, authenticated;
grant execute on function public.apply_boss_damage(uuid, uuid, text, bigint, text, boolean, uuid) to service_role;
grant execute on function public.admin_set_boss_hp(uuid, bigint) to service_role;
grant execute on function public.admin_reset_boss(uuid) to service_role;
grant execute on function public.spawn_minion(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.resolve_minion(uuid, uuid, text, uuid) to service_role;
grant execute on function public.expire_stale_minions(uuid) to service_role;
grant execute on function public.touch_event(uuid) to service_role;
revoke all on function public.get_public_event_state(text) from public;
grant execute on function public.get_public_event_state(text) to anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.events, public.bosses, public.milestones, public.minion_events, public.streamers;
exception when duplicate_object then null;
end $$;
