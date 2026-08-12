-- Kuerbiskoenig live-widget readiness.
-- Test controls stay inside the dedicated testing event and never grant client-side mutation rights.

alter table public.streamers
  add column if not exists is_test_account boolean not null default false;

create index if not exists streamers_event_test_account_idx
  on public.streamers (event_id, is_test_account, enabled);

create table if not exists public.widget_test_action_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  action text not null check (length(action) between 1 and 64),
  request_id text not null check (length(request_id) between 8 and 160),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (event_id, request_id)
);

create index if not exists widget_test_action_log_rate_idx
  on public.widget_test_action_log (event_id, streamer_id, created_at desc);

alter table public.widget_test_action_log enable row level security;
revoke all on public.widget_test_action_log from public, anon, authenticated;

create or replace function public.resolve_stream_elements_identity(
  p_event_slug text,
  p_twitch_login text
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_login text := lower(btrim(coalesce(p_twitch_login, '')));
  v_event public.events%rowtype;
  v_streamer public.streamers%rowtype;
  v_match_count integer := 0;
begin
  if v_login = '' then
    return jsonb_build_object('status', 'error', 'channel_username', null, 'event_slug', p_event_slug);
  end if;

  select * into v_event
  from public.events
  where slug = lower(btrim(coalesce(p_event_slug, '')))
  limit 1;

  if not found then
    return jsonb_build_object(
      'status', 'event_unavailable', 'channel_username', v_login,
      'event_slug', lower(btrim(coalesce(p_event_slug, '')))
    );
  end if;

  select count(*)::integer into v_match_count
  from public.streamers
  where event_id = v_event.id and twitch_login = v_login;

  if v_match_count = 0 then
    return jsonb_build_object(
      'status', 'not_registered', 'channel_username', v_login,
      'event_id', v_event.id, 'event_slug', v_event.slug, 'event_status', v_event.status
    );
  end if;

  if v_match_count > 1 then
    return jsonb_build_object(
      'status', 'error', 'channel_username', v_login,
      'event_id', v_event.id, 'event_slug', v_event.slug, 'event_status', v_event.status
    );
  end if;

  select * into v_streamer
  from public.streamers
  where event_id = v_event.id and twitch_login = v_login;

  if not v_streamer.enabled then
    return jsonb_build_object(
      'status', 'disabled', 'channel_username', v_login,
      'event_id', v_event.id, 'event_slug', v_event.slug, 'event_status', v_event.status,
      'is_test_account', v_streamer.is_test_account, 'test_actions_authorized', false
    );
  end if;

  return jsonb_build_object(
    'status', 'resolved',
    'channel_username', v_login,
    'event_id', v_event.id,
    'event_slug', v_event.slug,
    'event_status', v_event.status,
    'streamer_id', v_streamer.id,
    'streamer_slug', v_streamer.slug,
    'streamer_display_name', v_streamer.display_name,
    'is_test_account', v_streamer.is_test_account,
    'test_actions_authorized', v_streamer.is_test_account and v_event.status = 'testing'
  );
end;
$$;

revoke all on function public.resolve_stream_elements_identity(text, text) from public;
grant execute on function public.resolve_stream_elements_identity(text, text) to anon, authenticated;

-- Preserve the complete v0.4 snapshot for admin and widget-specific projections.
alter function public.get_public_event_state(text) rename to get_public_event_state_v4_unfiltered;
revoke all on function public.get_public_event_state_v4_unfiltered(text) from public, anon, authenticated;
grant execute on function public.get_public_event_state_v4_unfiltered(text) to service_role;

create or replace function public.get_public_event_state(p_event_slug text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_state jsonb;
  v_event_id uuid;
  v_run_id uuid;
  v_is_admin boolean := false;
  v_streamers jsonb := '[]'::jsonb;
  v_minions jsonb := '[]'::jsonb;
  v_stats jsonb := '{}'::jsonb;
begin
  select e.id, b.run_id,
    exists(select 1 from public.event_admins ea where ea.event_id=e.id and ea.user_id=auth.uid())
  into v_event_id, v_run_id, v_is_admin
  from public.events e join public.bosses b on b.event_id=e.id
  where e.slug=lower(btrim(coalesce(p_event_slug,'')));

  if v_event_id is null then return null; end if;
  v_state := public.get_public_event_state_v4_unfiltered(p_event_slug);
  if v_state is null then return null; end if;

  select coalesce(jsonb_agg(item || jsonb_build_object(
    'is_test_account', coalesce(s.is_test_account,false)
  )), '[]'::jsonb)
  into v_streamers
  from jsonb_array_elements(coalesce(v_state->'streamers','[]'::jsonb)) item
  left join public.streamers s on s.id=(item->>'id')::uuid
  where v_is_admin or not coalesce(s.is_test_account,false);

  select coalesce(jsonb_agg(item), '[]'::jsonb)
  into v_minions
  from jsonb_array_elements(coalesce(v_state->'minions','[]'::jsonb)) item
  left join public.streamers s on s.id=(item->>'streamer_id')::uuid
  where v_is_admin or not coalesce(s.is_test_account,false);

  if v_is_admin then
    v_stats := coalesce(v_state->'stats','{}'::jsonb);
  else
    select jsonb_build_object(
      'total_damage', coalesce((select sum(d.final_damage)
        from public.damage_events d left join public.streamers s on s.id=d.streamer_id
        where d.event_id=v_event_id and d.run_id=v_run_id
          and (d.streamer_id is null or not coalesce(s.is_test_account,false))),0),
      'total_minions_spawned', (select count(*) from public.minion_events m
        join public.streamers s on s.id=m.streamer_id
        where m.event_id=v_event_id and m.run_id=v_run_id and not s.is_test_account),
      'total_minions_defeated', (select count(*) from public.minion_events m
        join public.streamers s on s.id=m.streamer_id
        where m.event_id=v_event_id and m.run_id=v_run_id and not s.is_test_account
          and m.status in ('success','complete') and m.damage_awarded>0),
      'total_minions_failed', (select count(*) from public.minion_events m
        join public.streamers s on s.id=m.streamer_id
        where m.event_id=v_event_id and m.run_id=v_run_id and not s.is_test_account
          and (m.status in ('failure','curse') or (m.status='complete' and m.damage_awarded=0 and m.resolved_at is not null))),
      'minions_by_type', coalesce((select jsonb_object_agg(x.key,x.amount) from (
        select d.key,count(*) amount from public.minion_events m
        join public.minion_definitions d on d.id=m.minion_definition_id
        join public.streamers s on s.id=m.streamer_id
        where m.event_id=v_event_id and m.run_id=v_run_id and not s.is_test_account group by d.key
      ) x),'{}'::jsonb),
      'active_streamer_count', (select count(*) from public.streamers s
        where s.event_id=v_event_id and s.enabled and not s.is_test_account),
      'unique_participants', (select count(distinct mp.participant_key)
        from public.minion_participants mp join public.minion_events m on m.id=mp.minion_event_id
        join public.streamers s on s.id=m.streamer_id
        where m.event_id=v_event_id and m.run_id=v_run_id and not s.is_test_account)
    ) into v_stats;
  end if;

  v_state := jsonb_set(v_state,'{streamers}',v_streamers,true);
  v_state := jsonb_set(v_state,'{minions}',v_minions,true);
  v_state := jsonb_set(v_state,'{stats}',v_stats,true);
  if not v_is_admin and (v_state#>>'{event,status}')='testing' then
    v_state := jsonb_set(v_state,'{log}','[]'::jsonb,true);
  end if;
  return v_state;
end;
$$;

revoke all on function public.get_public_event_state(text) from public;
grant execute on function public.get_public_event_state(text) to anon, authenticated;

create or replace function public.get_stream_elements_widget_state(
  p_event_slug text,
  p_twitch_login text
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_login text := lower(btrim(coalesce(p_twitch_login,'')));
  v_event public.events%rowtype;
  v_streamer public.streamers%rowtype;
  v_state jsonb;
  v_streamers jsonb := '[]'::jsonb;
  v_minions jsonb := '[]'::jsonb;
begin
  select * into v_event from public.events where slug=lower(btrim(coalesce(p_event_slug,'')));
  if not found then return null; end if;
  select * into v_streamer from public.streamers
    where event_id=v_event.id and twitch_login=v_login and enabled;
  if not found then return null; end if;

  v_state := public.get_public_event_state_v4_unfiltered(v_event.slug);
  if v_state is null then return null; end if;

  select coalesce(jsonb_agg(item || jsonb_build_object('is_test_account',v_streamer.is_test_account)),'[]'::jsonb)
  into v_streamers from jsonb_array_elements(coalesce(v_state->'streamers','[]'::jsonb)) item
  where item->>'id'=v_streamer.id::text;

  select coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_minions from jsonb_array_elements(coalesce(v_state->'minions','[]'::jsonb)) item
  where item->>'streamer_id'=v_streamer.id::text;

  v_state := jsonb_set(v_state,'{streamers}',v_streamers,true);
  v_state := jsonb_set(v_state,'{minions}',v_minions,true);
  v_state := jsonb_set(v_state,'{log}','[]'::jsonb,true);
  return v_state || jsonb_build_object(
    'test_actions_authorized', v_streamer.is_test_account and v_event.status='testing'
  );
end;
$$;

revoke all on function public.get_stream_elements_widget_state(text,text) from public;
grant execute on function public.get_stream_elements_widget_state(text,text) to anon, authenticated;

create or replace function public.stable_viewer_estimate(
  p_event_id uuid,
  p_streamer_id uuid,
  p_fallback integer default 4
) returns integer language sql stable security definer set search_path = public, pg_temp as $$
  with context as (
    select e.status, coalesce(s.is_test_account,false) is_test_account
    from public.events e join public.streamers s on s.event_id=e.id
    where e.id=p_event_id and s.id=p_streamer_id
  ), recent as (
    select vs.viewer_count from public.viewer_samples vs, context c
    where vs.event_id=p_event_id and vs.streamer_id=p_streamer_id and vs.viewer_count>=0
      and (vs.source='twitch_api' or (c.status='testing' and c.is_test_account and vs.source='manual_test'))
    order by vs.sampled_at desc limit 3
  )
  select greatest(1,coalesce(round(percentile_cont(0.5) within group(order by viewer_count))::integer,greatest(1,p_fallback))) from recent;
$$;

revoke all on function public.stable_viewer_estimate(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.stable_viewer_estimate(uuid,uuid,integer) to service_role;

create or replace view public.viewer_samples_calibration
with (security_invoker = true) as
select vs.* from public.viewer_samples vs
join public.streamers s on s.id=vs.streamer_id
where vs.source='twitch_api' and not s.is_test_account;

revoke all on public.viewer_samples_calibration from public,anon,authenticated;
grant select on public.viewer_samples_calibration to service_role;

-- Existing deterministic fixtures belong to the test event and are never public statistics.
update public.streamers s set is_test_account=true, updated_at=now()
from public.events e where e.id=s.event_id and e.slug='halloween-2026-test';

comment on column public.streamers.is_test_account is
  'Explicit test identity flag. Never infer test status from a Twitch login or display name.';
comment on function public.get_stream_elements_widget_state(text,text) is
  'Event-scoped, read-only projection for one automatically resolved StreamElements channel.';
