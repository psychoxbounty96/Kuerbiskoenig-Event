-- Kürbiskönig v0.3: Twitch Awareness Layer.
-- This migration stores observation data only. It never calls apply_boss_damage.

create table public.streamer_runtime (
  streamer_id uuid primary key references public.streamers(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  is_live boolean not null default false,
  live_since timestamptz,
  current_stream_id text,
  current_viewer_count integer not null default 0 check (current_viewer_count >= 0),
  last_twitch_sync_at timestamptz,
  last_seen_live_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create index streamer_runtime_event_live_idx on public.streamer_runtime (event_id, is_live, updated_at desc);

create table public.stream_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  twitch_stream_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  peak_viewers integer not null default 0 check (peak_viewers >= 0),
  average_viewers numeric(12,2) not null default 0 check (average_viewers >= 0),
  sample_count integer not null default 0 check (sample_count >= 0),
  duration_seconds bigint check (duration_seconds is null or duration_seconds >= 0),
  status text not null default 'live' check (status in ('live', 'ended')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, streamer_id, twitch_stream_id),
  check ((status = 'live' and ended_at is null) or (status = 'ended' and ended_at is not null))
);

create unique index stream_sessions_one_live_per_streamer_idx
  on public.stream_sessions (event_id, streamer_id) where status = 'live';
create index stream_sessions_history_idx on public.stream_sessions (event_id, streamer_id, started_at desc);

create table public.viewer_samples (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  stream_session_id uuid references public.stream_sessions(id) on delete set null,
  stream_id text not null,
  viewer_count integer not null check (viewer_count >= 0),
  sampled_at timestamptz not null,
  source text not null check (source in ('twitch_api', 'manual_test')),
  idempotency_key text not null,
  passive_damage_preview bigint,
  created_at timestamptz not null default now(),
  unique (event_id, idempotency_key),
  check (passive_damage_preview is null)
);

create index viewer_samples_streamer_time_idx on public.viewer_samples (event_id, streamer_id, sampled_at desc);
create index viewer_samples_session_idx on public.viewer_samples (stream_session_id, sampled_at);

create table public.raid_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  from_streamer_id uuid references public.streamers(id) on delete set null,
  to_streamer_id uuid references public.streamers(id) on delete set null,
  from_twitch_user_id text not null,
  to_twitch_user_id text not null,
  viewer_count integer not null check (viewer_count >= 0),
  twitch_message_id text,
  occurred_at timestamptz not null,
  eligible boolean not null default false,
  source text not null check (source in ('twitch_eventsub', 'manual_test')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (event_id, twitch_message_id)
);

create index raid_events_event_time_idx on public.raid_events (event_id, occurred_at desc);
create index raid_events_eligible_idx on public.raid_events (event_id, eligible, occurred_at desc);

create table public.twitch_eventsub_messages (
  message_id text primary key,
  message_type text not null,
  subscription_type text,
  subscription_id text,
  message_timestamp timestamptz not null,
  status text not null check (status in ('processing', 'processed', 'challenge', 'revoked', 'error')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index twitch_eventsub_messages_received_idx on public.twitch_eventsub_messages (received_at desc);

create table public.twitch_eventsub_subscriptions (
  twitch_subscription_id text primary key,
  subscription_type text not null check (subscription_type in ('stream.online', 'stream.offline', 'channel.raid')),
  condition jsonb not null,
  condition_key text not null,
  status text not null,
  callback_url text not null,
  last_notification_at timestamptz,
  revoked_at timestamptz,
  last_error text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index twitch_eventsub_subscriptions_status_idx
  on public.twitch_eventsub_subscriptions (status, subscription_type, updated_at desc);
create index twitch_eventsub_subscriptions_condition_idx
  on public.twitch_eventsub_subscriptions (subscription_type, condition_key, callback_url);

create table public.twitch_integration_status (
  event_id uuid primary key references public.events(id) on delete cascade,
  health_status text not null default 'warning' check (health_status in ('healthy', 'warning', 'error')),
  health_reason text not null default 'Noch kein Twitch-Sync ausgeführt.',
  webhook_configured boolean not null default false,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  last_webhook_at timestamptz,
  last_invalid_signature_at timestamptz,
  last_subscription_sync_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.twitch_system_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade,
  streamer_id uuid references public.streamers(id) on delete set null,
  level text not null default 'info' check (level in ('info', 'warning', 'error')),
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index twitch_system_log_event_time_idx on public.twitch_system_log (event_id, created_at desc);

insert into public.streamer_runtime (streamer_id, event_id)
select id, event_id from public.streamers on conflict (streamer_id) do nothing;

insert into public.twitch_integration_status (event_id)
select id from public.events on conflict (event_id) do nothing;

create or replace function public.ensure_streamer_twitch_runtime()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.streamer_runtime (streamer_id, event_id) values (new.id, new.event_id)
  on conflict (streamer_id) do update set event_id = excluded.event_id, updated_at = now();
  return new;
end;
$$;

create trigger streamers_ensure_twitch_runtime
after insert or update of event_id on public.streamers
for each row execute function public.ensure_streamer_twitch_runtime();

create or replace function public.upsert_twitch_stream_snapshot(
  p_event_id uuid,
  p_streamer_id uuid,
  p_stream_id text,
  p_viewer_count integer,
  p_started_at timestamptz,
  p_sampled_at timestamptz,
  p_idempotency_key text,
  p_source text default 'twitch_api'
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_runtime public.streamer_runtime%rowtype;
  v_session_id uuid;
  v_sample_id uuid;
  v_transition boolean := false;
begin
  if p_source not in ('twitch_api', 'manual_test') then raise exception 'invalid_viewer_sample_source'; end if;
  if p_stream_id is null or btrim(p_stream_id) = '' then raise exception 'stream_id_required'; end if;
  if p_viewer_count is null or p_viewer_count < 0 then raise exception 'invalid_viewer_count'; end if;
  if not exists (
    select 1 from public.streamers s where s.id = p_streamer_id and s.event_id = p_event_id and s.enabled
  ) then raise exception 'streamer_not_available'; end if;

  insert into public.streamer_runtime (streamer_id, event_id) values (p_streamer_id, p_event_id)
  on conflict (streamer_id) do nothing;
  select * into v_runtime from public.streamer_runtime where streamer_id = p_streamer_id for update;
  v_transition := not v_runtime.is_live or v_runtime.current_stream_id is distinct from p_stream_id;

  update public.stream_sessions
    set status = 'ended', ended_at = p_sampled_at,
        duration_seconds = greatest(0, floor(extract(epoch from (p_sampled_at - started_at)))::bigint),
        updated_at = now()
    where event_id = p_event_id and streamer_id = p_streamer_id and status = 'live'
      and twitch_stream_id <> p_stream_id;

  insert into public.stream_sessions (event_id, streamer_id, twitch_stream_id, started_at, status)
  values (p_event_id, p_streamer_id, p_stream_id, p_started_at, 'live')
  on conflict (event_id, streamer_id, twitch_stream_id) do update
    set started_at = least(public.stream_sessions.started_at, excluded.started_at),
        ended_at = null, duration_seconds = null, status = 'live', updated_at = now()
  returning id into v_session_id;

  insert into public.viewer_samples (
    event_id, streamer_id, stream_session_id, stream_id, viewer_count, sampled_at, source, idempotency_key
  ) values (
    p_event_id, p_streamer_id, v_session_id, p_stream_id, p_viewer_count, p_sampled_at, p_source, p_idempotency_key
  ) on conflict (event_id, idempotency_key) do nothing returning id into v_sample_id;

  if v_sample_id is not null then
    update public.stream_sessions ss set
      peak_viewers = stats.peak_viewers,
      average_viewers = stats.average_viewers,
      sample_count = stats.sample_count,
      updated_at = now()
    from (
      select max(viewer_count)::integer peak_viewers,
        round(avg(viewer_count)::numeric, 2) average_viewers,
        count(*)::integer sample_count
      from public.viewer_samples where stream_session_id = v_session_id
    ) stats where ss.id = v_session_id;
  end if;

  update public.streamer_runtime set
    is_live = true,
    live_since = p_started_at,
    current_stream_id = p_stream_id,
    current_viewer_count = p_viewer_count,
    last_twitch_sync_at = now(),
    last_seen_live_at = now(),
    last_error = null,
    updated_at = now()
  where streamer_id = p_streamer_id;

  if v_transition then
    insert into public.twitch_system_log (event_id, streamer_id, event_type, message, metadata)
    values (p_event_id, p_streamer_id, 'stream_detected_online', 'Stream über Twitch als live erkannt.',
      jsonb_build_object('stream_id', p_stream_id, 'source', p_source));
  end if;
  if v_sample_id is not null then
    insert into public.twitch_system_log (event_id, streamer_id, event_type, message, metadata)
    values (p_event_id, p_streamer_id, 'viewer_sample_stored', 'Aggregiertes Viewer-Sample gespeichert.',
      jsonb_build_object('stream_id', p_stream_id, 'viewer_count', p_viewer_count, 'source', p_source));
  end if;
  perform public.touch_event(p_event_id);
  return jsonb_build_object('sessionId', v_session_id, 'sampleId', v_sample_id, 'transitionedOnline', v_transition);
end;
$$;

create or replace function public.mark_twitch_stream_online(
  p_event_id uuid,
  p_streamer_id uuid,
  p_stream_id text,
  p_started_at timestamptz,
  p_observed_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_runtime public.streamer_runtime%rowtype; v_session_id uuid; v_transition boolean;
begin
  if not exists (select 1 from public.streamers where id = p_streamer_id and event_id = p_event_id and enabled) then
    raise exception 'streamer_not_available';
  end if;
  insert into public.streamer_runtime (streamer_id, event_id) values (p_streamer_id, p_event_id)
  on conflict (streamer_id) do nothing;
  select * into v_runtime from public.streamer_runtime where streamer_id = p_streamer_id for update;
  v_transition := not v_runtime.is_live or v_runtime.current_stream_id is distinct from p_stream_id;
  update public.stream_sessions set status = 'ended', ended_at = p_observed_at,
    duration_seconds = greatest(0, floor(extract(epoch from (p_observed_at - started_at)))::bigint), updated_at = now()
  where event_id = p_event_id and streamer_id = p_streamer_id and status = 'live'
    and twitch_stream_id <> p_stream_id;
  insert into public.stream_sessions (event_id, streamer_id, twitch_stream_id, started_at, status)
  values (p_event_id, p_streamer_id, p_stream_id, p_started_at, 'live')
  on conflict (event_id, streamer_id, twitch_stream_id) do update
    set started_at = least(public.stream_sessions.started_at, excluded.started_at),
      ended_at = null, duration_seconds = null, status = 'live', updated_at = now()
  returning id into v_session_id;
  update public.streamer_runtime set is_live = true, live_since = p_started_at,
    current_stream_id = p_stream_id,
    current_viewer_count = case when v_runtime.current_stream_id is distinct from p_stream_id then 0 else current_viewer_count end,
    last_seen_live_at = p_observed_at, last_error = null, updated_at = now()
  where streamer_id = p_streamer_id;
  if v_transition then
    insert into public.twitch_system_log (event_id, streamer_id, event_type, message, metadata)
    values (p_event_id, p_streamer_id, 'stream_detected_online', 'EventSub meldet Stream online.',
      jsonb_build_object('stream_id', p_stream_id, 'source', 'twitch_eventsub'));
  end if;
  perform public.touch_event(p_event_id);
  return jsonb_build_object('sessionId', v_session_id, 'transitionedOnline', v_transition);
end;
$$;

create or replace function public.mark_twitch_stream_offline(
  p_event_id uuid,
  p_streamer_id uuid,
  p_observed_at timestamptz,
  p_source text default 'twitch_api'
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_runtime public.streamer_runtime%rowtype; v_closed integer := 0;
begin
  insert into public.streamer_runtime (streamer_id, event_id) values (p_streamer_id, p_event_id)
  on conflict (streamer_id) do nothing;
  select * into v_runtime from public.streamer_runtime where streamer_id = p_streamer_id for update;
  update public.stream_sessions set status = 'ended', ended_at = p_observed_at,
    duration_seconds = greatest(0, floor(extract(epoch from (p_observed_at - started_at)))::bigint), updated_at = now()
  where event_id = p_event_id and streamer_id = p_streamer_id and status = 'live';
  get diagnostics v_closed = row_count;
  update public.streamer_runtime set is_live = false, live_since = null, current_stream_id = null,
    current_viewer_count = 0, last_twitch_sync_at = case when p_source = 'twitch_api' then p_observed_at else last_twitch_sync_at end,
    last_error = null, updated_at = now() where streamer_id = p_streamer_id;
  if v_runtime.is_live or v_closed > 0 then
    insert into public.twitch_system_log (event_id, streamer_id, event_type, message, metadata)
    values (p_event_id, p_streamer_id, 'stream_detected_offline', 'Stream über Twitch als offline erkannt.',
      jsonb_build_object('source', p_source, 'closed_sessions', v_closed));
  end if;
  perform public.touch_event(p_event_id);
  return jsonb_build_object('transitionedOffline', v_runtime.is_live, 'closedSessions', v_closed);
end;
$$;

create or replace function public.record_twitch_raid(
  p_event_id uuid,
  p_from_twitch_user_id text,
  p_to_twitch_user_id text,
  p_viewer_count integer,
  p_twitch_message_id text,
  p_occurred_at timestamptz,
  p_source text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_from uuid; v_to uuid; v_eligible boolean; v_id uuid;
begin
  if p_source not in ('twitch_eventsub', 'manual_test') then raise exception 'invalid_raid_source'; end if;
  if p_viewer_count is null or p_viewer_count < 0 then raise exception 'invalid_viewer_count'; end if;
  select id into v_from from public.streamers
    where event_id = p_event_id and enabled and twitch_user_id = p_from_twitch_user_id limit 1;
  select id into v_to from public.streamers
    where event_id = p_event_id and enabled and twitch_user_id = p_to_twitch_user_id limit 1;
  v_eligible := v_from is not null and v_to is not null and v_from <> v_to;
  insert into public.raid_events (
    event_id, from_streamer_id, to_streamer_id, from_twitch_user_id, to_twitch_user_id,
    viewer_count, twitch_message_id, occurred_at, eligible, source, metadata
  ) values (
    p_event_id, v_from, v_to, p_from_twitch_user_id, p_to_twitch_user_id,
    p_viewer_count, p_twitch_message_id, p_occurred_at, v_eligible, p_source, coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (event_id, twitch_message_id) do nothing returning id into v_id;
  if v_id is not null then
    insert into public.twitch_system_log (event_id, event_type, message, metadata)
    values (p_event_id, 'raid_detected', 'Twitch Raid erkannt und ohne Gameplay-Auswirkung gespeichert.',
      jsonb_build_object('raid_id', v_id, 'eligible', v_eligible, 'viewer_count', p_viewer_count, 'source', p_source));
    perform public.touch_event(p_event_id);
  end if;
  return jsonb_build_object('raidId', v_id, 'eligible', v_eligible, 'duplicate', v_id is null);
end;
$$;

create or replace function public.claim_twitch_eventsub_message(
  p_message_id text,
  p_message_type text,
  p_subscription_type text,
  p_subscription_id text,
  p_message_timestamp timestamptz
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row_count integer := 0;
begin
  insert into public.twitch_eventsub_messages (
    message_id, message_type, subscription_type, subscription_id, message_timestamp, status
  ) values (
    p_message_id, p_message_type, p_subscription_type, p_subscription_id, p_message_timestamp, 'processing'
  ) on conflict (message_id) do nothing;
  if found then return true; end if;
  update public.twitch_eventsub_messages set status = 'processing', error = null, received_at = now()
    where message_id = p_message_id and status = 'error';
  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

create or replace function public.finish_twitch_eventsub_message(
  p_message_id text,
  p_status text,
  p_error text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('processed', 'challenge', 'revoked', 'error') then raise exception 'invalid_eventsub_status'; end if;
  update public.twitch_eventsub_messages set status = p_status, error = p_error,
    processed_at = case when p_status = 'error' then null else now() end
  where message_id = p_message_id;
end;
$$;

create or replace function public.get_public_event_state(p_event_slug text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with selected as (
    select e.*, b.id boss_id, b.run_id, b.name boss_name, b.max_hp, b.current_hp, b.updated_at boss_updated_at,
      s.event_paused, s.damage_enabled, s.minions_enabled,
      s.global_damage_multiplier, s.passive_damage_multiplier, s.active_damage_multiplier, s.passive_tick_seconds,
      exists (select 1 from public.event_admins ea where ea.event_id = e.id and ea.user_id = auth.uid()) is_admin
    from public.events e join public.bosses b on b.event_id = e.id
    join public.event_settings s on s.event_id = e.id where e.slug = p_event_slug
      and (e.status in ('testing', 'active', 'paused', 'finished', 'archived')
        or exists (select 1 from public.event_admins ea where ea.event_id = e.id and ea.user_id = auth.uid()))
  )
  select jsonb_build_object(
    'version', 3,
    'updated_at', greatest(selected.updated_at, selected.boss_updated_at),
    'event', jsonb_build_object('id', selected.id, 'slug', selected.slug, 'name', selected.name,
      'description', selected.description, 'status', selected.status),
    'boss', jsonb_build_object('id', selected.boss_id, 'name', selected.boss_name, 'max_hp', selected.max_hp,
      'current_hp', selected.current_hp, 'phase', coalesce((select to_jsonb(p) from public.boss_phases p
        where p.boss_id = selected.boss_id and p.phase_number = public.current_phase(selected.current_hp, selected.max_hp)), '{}'::jsonb)),
    'settings', jsonb_build_object('event_paused', selected.event_paused, 'damage_enabled', selected.damage_enabled,
      'minions_enabled', selected.minions_enabled,
      'global_damage_multiplier', case when selected.is_admin then selected.global_damage_multiplier else 1 end,
      'passive_damage_multiplier', case when selected.is_admin then selected.passive_damage_multiplier else 1 end,
      'active_damage_multiplier', case when selected.is_admin then selected.active_damage_multiplier else 1 end,
      'passive_tick_seconds', case when selected.is_admin then selected.passive_tick_seconds else 120 end),
    'stats', jsonb_build_object('total_damage', greatest(0, selected.max_hp - selected.current_hp),
      'total_minions_defeated', (select count(*) from public.minion_events m where m.event_id = selected.id and m.run_id = selected.run_id and m.status = 'success'),
      'total_minions_failed', (select count(*) from public.minion_events m where m.event_id = selected.id and m.run_id = selected.run_id and m.status in ('failed', 'expired')),
      'active_streamer_count', (select count(*) from public.streamers s where s.event_id = selected.id and s.enabled),
      'unique_participants', 0),
    'streamers', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'slug', s.slug, 'display_name', s.display_name, 'community_name', s.community_name,
      'twitch_login', s.twitch_login, 'twitch_user_id', case when selected.is_admin then s.twitch_user_id else null end,
      'twitch_url', s.twitch_url, 'avatar_url', s.avatar_url, 'enabled', s.enabled, 'sort_order', s.sort_order,
      'damage', coalesce((select sum(d.final_damage) from public.damage_events d where d.event_id = selected.id and d.run_id = selected.run_id and d.streamer_id = s.id), 0),
      'minions_defeated', s.minions_defeated,
      'is_live', coalesce(sr.is_live, false), 'live_since', sr.live_since,
      'current_stream_id', sr.current_stream_id, 'current_viewer_count', coalesce(sr.current_viewer_count, 0),
      'last_twitch_sync_at', sr.last_twitch_sync_at, 'last_seen_live_at', sr.last_seen_live_at,
      'session', case when selected.is_admin and ss.id is not null then jsonb_build_object(
        'id', ss.id, 'stream_id', ss.twitch_stream_id, 'started_at', ss.started_at, 'ended_at', ss.ended_at,
        'status', ss.status, 'average_viewers', ss.average_viewers, 'peak_viewers', ss.peak_viewers,
        'latest_viewers', coalesce((select vs.viewer_count from public.viewer_samples vs
          where vs.stream_session_id = ss.id order by vs.sampled_at desc limit 1), 0),
        'sample_count', ss.sample_count, 'duration_seconds', coalesce(ss.duration_seconds,
          greatest(0, floor(extract(epoch from (now() - ss.started_at)))::bigint))
      ) else null end
    ) order by s.sort_order, s.display_name)
      from public.streamers s left join public.streamer_runtime sr on sr.streamer_id = s.id
      left join lateral (select x.* from public.stream_sessions x where x.streamer_id = s.id order by (x.status = 'live') desc, x.started_at desc limit 1) ss on true
      where s.event_id = selected.id and (s.enabled or selected.is_admin)), '[]'::jsonb),
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
    'twitch', case when selected.is_admin then jsonb_build_object(
      'health', coalesce((select jsonb_build_object('status', h.health_status, 'reason', h.health_reason,
        'webhook_configured', h.webhook_configured, 'last_sync_at', h.last_sync_at,
        'last_success_at', h.last_success_at, 'last_error_at', h.last_error_at, 'last_error', h.last_error,
        'last_webhook_at', h.last_webhook_at, 'last_invalid_signature_at', h.last_invalid_signature_at,
        'last_subscription_sync_at', h.last_subscription_sync_at) from public.twitch_integration_status h
        where h.event_id = selected.id), '{}'::jsonb),
      'subscriptions', jsonb_build_object(
        'online', (select count(*) from public.twitch_eventsub_subscriptions where subscription_type = 'stream.online' and status = 'enabled'),
        'offline', (select count(*) from public.twitch_eventsub_subscriptions where subscription_type = 'stream.offline' and status = 'enabled'),
        'raid', (select count(*) from public.twitch_eventsub_subscriptions where subscription_type = 'channel.raid' and status = 'enabled'),
        'pending', (select count(*) from public.twitch_eventsub_subscriptions where status like 'webhook_callback_verification_pending%'),
        'revoked_or_error', (select count(*) from public.twitch_eventsub_subscriptions where status not in ('enabled', 'webhook_callback_verification_pending'))),
      'recent_raids', coalesce((select jsonb_agg(to_jsonb(r) order by r.occurred_at desc)
        from (select re.id, re.from_streamer_id, re.to_streamer_id, re.from_twitch_user_id,
          re.to_twitch_user_id, re.viewer_count, re.occurred_at, re.eligible, re.source
          from public.raid_events re where re.event_id = selected.id order by re.occurred_at desc limit 10) r), '[]'::jsonb)
    ) else null end,
    'log', coalesce((select jsonb_agg(log_entry order by happened_at desc) from (
      select jsonb_build_object('id', d.id, 'timestamp', d.created_at, 'type', 'damage',
        'message', concat(d.source, ': ', d.final_damage, ' Schaden')) log_entry, d.created_at happened_at
      from public.damage_events d where d.event_id = selected.id
      union all
      select jsonb_build_object('id', m.id, 'timestamp', coalesce(m.resolved_at, m.spawned_at), 'type', 'minion',
        'message', concat(md.name, ' · ', st.display_name, ': ', m.status)) log_entry, coalesce(m.resolved_at, m.spawned_at) happened_at
      from public.minion_events m join public.minion_definitions md on md.id = m.minion_definition_id
      join public.streamers st on st.id = m.streamer_id where m.event_id = selected.id
      union all
      select jsonb_build_object('id', tl.id, 'timestamp', tl.created_at, 'type', 'twitch', 'message', tl.message), tl.created_at
      from public.twitch_system_log tl where tl.event_id = selected.id and selected.is_admin
      order by happened_at desc limit 30
    ) recent_log), '[]'::jsonb)
  ) from selected;
$$;

alter table public.streamer_runtime enable row level security;
alter table public.stream_sessions enable row level security;
alter table public.viewer_samples enable row level security;
alter table public.raid_events enable row level security;
alter table public.twitch_eventsub_messages enable row level security;
alter table public.twitch_eventsub_subscriptions enable row level security;
alter table public.twitch_integration_status enable row level security;
alter table public.twitch_system_log enable row level security;

create policy streamer_runtime_public_read on public.streamer_runtime for select to anon, authenticated using (
  exists (select 1 from public.streamers s join public.events e on e.id = s.event_id
    where s.id = streamer_id and s.enabled and e.status in ('testing', 'active', 'paused', 'finished', 'archived'))
);

revoke all on public.stream_sessions, public.viewer_samples, public.raid_events,
  public.twitch_eventsub_messages, public.twitch_eventsub_subscriptions,
  public.twitch_integration_status, public.twitch_system_log from anon, authenticated;
grant select on public.streamer_runtime to anon, authenticated;

revoke all on function public.ensure_streamer_twitch_runtime() from public, anon, authenticated;
revoke all on function public.upsert_twitch_stream_snapshot(uuid, uuid, text, integer, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.mark_twitch_stream_online(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_twitch_stream_offline(uuid, uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.record_twitch_raid(uuid, text, text, integer, text, timestamptz, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_twitch_eventsub_message(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_twitch_eventsub_message(text, text, text) from public, anon, authenticated;
grant execute on function public.upsert_twitch_stream_snapshot(uuid, uuid, text, integer, timestamptz, timestamptz, text, text) to service_role;
grant execute on function public.mark_twitch_stream_online(uuid, uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.mark_twitch_stream_offline(uuid, uuid, timestamptz, text) to service_role;
grant execute on function public.record_twitch_raid(uuid, text, text, integer, text, timestamptz, text, jsonb) to service_role;
grant execute on function public.claim_twitch_eventsub_message(text, text, text, text, timestamptz) to service_role;
grant execute on function public.finish_twitch_eventsub_message(text, text, text) to service_role;

do $$ begin
  alter publication supabase_realtime add table public.streamer_runtime;
exception when duplicate_object then null;
end $$;
