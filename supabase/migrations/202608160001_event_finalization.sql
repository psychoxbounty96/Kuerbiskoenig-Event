-- Kuerbiskoenig v0.5 finalization foundation.
-- Adds explicit participation scopes, passive-damage dry-run/test support,
-- calibration summaries and guarded per-streamer gameplay without enabling
-- passive damage for the production event.

-- Preserve the complete v0.4 projection as a private implementation detail.
-- The replacement public wrapper below applies visibility and calibration rules.
do $$
begin
  if to_regprocedure('public.get_public_event_state_v4_unfiltered(text)') is null
    and to_regprocedure('public.get_public_event_state(text)') is not null then
    alter function public.get_public_event_state(text) rename to get_public_event_state_v4_unfiltered;
  end if;
end $$;

revoke all on function public.get_public_event_state_v4_unfiltered(text) from public,anon,authenticated;
grant execute on function public.get_public_event_state_v4_unfiltered(text) to service_role;

alter table public.streamers
  add column if not exists tracking_enabled boolean not null default true,
  add column if not exists gameplay_enabled boolean not null default true,
  add column if not exists public_visible boolean not null default true,
  add column if not exists include_in_calibration boolean not null default true;

create index if not exists streamers_event_tracking_idx
  on public.streamers (event_id, tracking_enabled, enabled);
create index if not exists streamers_event_gameplay_idx
  on public.streamers (event_id, gameplay_enabled, enabled);
create index if not exists streamers_event_public_idx
  on public.streamers (event_id, public_visible, enabled, is_test_account);
create index if not exists streamers_event_calibration_idx
  on public.streamers (event_id, include_in_calibration, is_test_account);

comment on column public.streamers.tracking_enabled is
  'Allows Twitch live/viewer/session collection without requiring widget gameplay.';
comment on column public.streamers.gameplay_enabled is
  'Allows widget identity, minions, chat actions and streamer-attributed damage.';
comment on column public.streamers.public_visible is
  'Controls public participant visibility independently from Twitch tracking.';
comment on column public.streamers.include_in_calibration is
  'Explicit operator decision for aggregate balancing/calibration datasets.';

alter table public.event_settings
  add column if not exists twitch_tracking_enabled boolean not null default true,
  add column if not exists passive_damage_enabled boolean not null default false,
  add column if not exists passive_damage_mode text not null default 'disabled',
  add column if not exists passive_soft_cap integer not null default 50,
  add column if not exists passive_min_damage bigint not null default 0,
  add column if not exists passive_max_damage bigint not null default 5000,
  add column if not exists passive_underdog_factor numeric(10,4) not null default 0.1500,
  add column if not exists passive_configuration_version integer not null default 1;

update public.event_settings
set passive_curve_exponent = coalesce(passive_curve_exponent, 0.7200),
    passive_base_damage = coalesce(passive_base_damage, 10.0000),
    passive_damage_mode = case
      when passive_damage_mode in ('disabled','dry_run','test','active') then passive_damage_mode
      else 'disabled'
    end,
    updated_at = now();

alter table public.event_settings
  alter column passive_curve_exponent set default 0.7200,
  alter column passive_curve_exponent set not null,
  alter column passive_base_damage set default 10.0000,
  alter column passive_base_damage set not null;

alter table public.event_settings drop constraint if exists event_settings_passive_damage_mode_check;
alter table public.event_settings add constraint event_settings_passive_damage_mode_check
  check (passive_damage_mode in ('disabled','dry_run','test','active'));
alter table public.event_settings drop constraint if exists event_settings_passive_soft_cap_check;
alter table public.event_settings add constraint event_settings_passive_soft_cap_check
  check (passive_soft_cap between 1 and 1000000);
alter table public.event_settings drop constraint if exists event_settings_passive_damage_bounds_check;
alter table public.event_settings add constraint event_settings_passive_damage_bounds_check
  check (passive_min_damage >= 0 and passive_max_damage >= passive_min_damage and passive_max_damage <= 1000000000);
alter table public.event_settings drop constraint if exists event_settings_passive_curve_v5_check;
alter table public.event_settings add constraint event_settings_passive_curve_v5_check
  check (passive_curve_exponent between 0.05 and 1.5 and passive_base_damage between 0 and 1000000000);
alter table public.event_settings drop constraint if exists event_settings_passive_underdog_check;
alter table public.event_settings add constraint event_settings_passive_underdog_check
  check (passive_underdog_factor between 0 and 2);

alter table public.viewer_samples
  drop constraint if exists viewer_samples_passive_damage_preview_check;
alter table public.viewer_samples
  add constraint viewer_samples_passive_damage_preview_check
  check (passive_damage_preview is null or passive_damage_preview >= 0);

create table if not exists public.passive_damage_ticks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  boss_id uuid not null references public.bosses(id) on delete cascade,
  run_id uuid not null,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  bucket_started_at timestamptz not null,
  mode text not null check (mode in ('dry_run','test','active')),
  viewer_estimate integer,
  viewer_sample_count integer not null default 0 check (viewer_sample_count between 0 and 3),
  latest_sample_at timestamptz,
  curve_factor numeric(14,6) not null default 0 check (curve_factor >= 0),
  raw_damage bigint not null default 0 check (raw_damage >= 0),
  configured_damage bigint not null default 0 check (configured_damage >= 0),
  applied_damage bigint not null default 0 check (applied_damage >= 0),
  status text not null check (status in ('pending','preview','applied','skipped')),
  skip_reason text,
  configuration_version integer not null,
  damage_event_id uuid references public.damage_events(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (event_id, run_id, streamer_id, bucket_started_at)
);

create index if not exists passive_damage_ticks_event_time_idx
  on public.passive_damage_ticks (event_id, bucket_started_at desc);
create index if not exists passive_damage_ticks_streamer_time_idx
  on public.passive_damage_ticks (event_id, streamer_id, bucket_started_at desc);

alter table public.passive_damage_ticks enable row level security;
revoke all on public.passive_damage_ticks from public, anon, authenticated;
grant select, insert, update on public.passive_damage_ticks to service_role;

create table if not exists public.event_job_status (
  event_id uuid not null references public.events(id) on delete cascade,
  job_key text not null check (job_key in ('twitch_sync','minion_tick','passive_damage_tick','eventsub_sync')),
  status text not null default 'idle' check (status in ('idle','running','healthy','warning','error')),
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  next_expected_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (event_id, job_key)
);

alter table public.event_job_status enable row level security;
revoke all on public.event_job_status from public, anon, authenticated;
grant select, insert, update on public.event_job_status to service_role;

create or replace function public.mark_event_job_status(
  p_event_id uuid,
  p_job_key text,
  p_status text,
  p_error text default null,
  p_next_expected_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_job_key not in ('twitch_sync','minion_tick','passive_damage_tick','eventsub_sync')
    or p_status not in ('idle','running','healthy','warning','error') then
    raise exception 'invalid_job_status';
  end if;
  insert into public.event_job_status(
    event_id, job_key, status, last_started_at, last_success_at, last_error_at,
    last_error, next_expected_at, metadata, updated_at
  ) values (
    p_event_id, p_job_key, p_status,
    case when p_status='running' then now() else null end,
    case when p_status='healthy' then now() else null end,
    case when p_status='error' then now() else null end,
    case when p_status='error' then left(coalesce(p_error,'unknown_error'),500) else null end,
    p_next_expected_at, coalesce(p_metadata,'{}'::jsonb), now()
  ) on conflict(event_id,job_key) do update set
    status=excluded.status,
    last_started_at=case when excluded.status='running' then now() else public.event_job_status.last_started_at end,
    last_success_at=case when excluded.status='healthy' then now() else public.event_job_status.last_success_at end,
    last_error_at=case when excluded.status='error' then now() else public.event_job_status.last_error_at end,
    last_error=case when excluded.status='error' then excluded.last_error when excluded.status='healthy' then null else public.event_job_status.last_error end,
    next_expected_at=coalesce(excluded.next_expected_at,public.event_job_status.next_expected_at),
    metadata=coalesce(excluded.metadata,'{}'::jsonb),
    updated_at=now();
end;
$$;

revoke all on function public.mark_event_job_status(uuid,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.mark_event_job_status(uuid,text,text,text,timestamptz,jsonb) to service_role;

create or replace function public.stable_passive_viewer_estimate(
  p_event_id uuid,
  p_streamer_id uuid,
  p_now timestamptz default now()
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with context as (
    select e.status event_status, s.is_test_account, s.tracking_enabled
    from public.events e join public.streamers s on s.event_id=e.id
    where e.id=p_event_id and s.id=p_streamer_id
  ), recent as (
    select vs.id, vs.viewer_count, vs.sampled_at
    from public.viewer_samples vs, context c
    where vs.event_id=p_event_id and vs.streamer_id=p_streamer_id
      and c.tracking_enabled and vs.viewer_count>=0
      and vs.sampled_at<=p_now and vs.sampled_at>=p_now-interval '10 minutes'
      and (vs.source='twitch_api' or (c.event_status='testing' and c.is_test_account and vs.source='manual_test'))
    order by vs.sampled_at desc
    limit 3
  )
  select jsonb_build_object(
    'viewerEstimate', case when count(*)=0 then null else round(percentile_cont(0.5) within group(order by viewer_count))::integer end,
    'sampleCount', count(*)::integer,
    'latestSampleAt', max(sampled_at),
    'latestSampleId', (array_agg(id order by sampled_at desc))[1]
  ) from recent;
$$;

create or replace function public.calculate_passive_damage(
  p_event_id uuid,
  p_viewer_estimate integer
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_settings public.event_settings%rowtype;
  v_viewers integer := greatest(0,coalesce(p_viewer_estimate,0));
  v_curve numeric;
  v_diminishing numeric;
  v_underdog numeric;
  v_unclamped numeric;
  v_damage bigint;
begin
  select * into v_settings from public.event_settings where event_id=p_event_id;
  if not found then raise exception 'settings_not_found'; end if;
  v_curve := power(v_viewers::numeric,v_settings.passive_curve_exponent);
  v_diminishing := sqrt(v_settings.passive_soft_cap::numeric/(v_settings.passive_soft_cap+v_viewers));
  v_underdog := 1 + v_settings.passive_underdog_factor *
    (v_settings.passive_soft_cap::numeric/(v_settings.passive_soft_cap+v_viewers));
  v_unclamped := v_settings.passive_base_damage * v_curve * v_diminishing * v_underdog;
  v_damage := greatest(v_settings.passive_min_damage,
    least(v_settings.passive_max_damage,round(greatest(0,v_unclamped))::bigint));
  return jsonb_build_object(
    'rawDamage',v_damage,
    'curveFactor',case when v_settings.passive_base_damage=0 then 0 else v_unclamped/v_settings.passive_base_damage end,
    'viewerEstimate',v_viewers,
    'configurationVersion',v_settings.passive_configuration_version
  );
end;
$$;

revoke all on function public.stable_passive_viewer_estimate(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.calculate_passive_damage(uuid,integer) from public,anon,authenticated;
grant execute on function public.stable_passive_viewer_estimate(uuid,uuid,timestamptz) to service_role;
grant execute on function public.calculate_passive_damage(uuid,integer) to service_role;

create or replace function public.process_passive_damage_tick(
  p_event_id uuid default null,
  p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row record;
  v_estimate jsonb;
  v_calculation jsonb;
  v_tick_id uuid;
  v_bucket timestamptz;
  v_raw bigint;
  v_configured bigint;
  v_damage jsonb;
  v_damage_event_id uuid;
  v_preview integer := 0;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_idempotent integer := 0;
  v_skip text;
begin
  for v_row in
    select e.id event_id,e.slug,e.status event_status,b.id boss_id,b.run_id,b.current_hp,
      es.*,s.id streamer_id,s.is_test_account,s.include_in_calibration,
      s.enabled,s.tracking_enabled,s.gameplay_enabled,r.is_live
    from public.events e
    join public.event_settings es on es.event_id=e.id
    join public.bosses b on b.event_id=e.id
    join public.streamers s on s.event_id=e.id
    left join public.streamer_runtime r on r.event_id=e.id and r.streamer_id=s.id
    where (p_event_id is null or e.id=p_event_id)
      and es.passive_damage_enabled
      and es.passive_damage_mode<>'disabled'
      and es.twitch_tracking_enabled
      and s.enabled and s.tracking_enabled and s.gameplay_enabled
  loop
    v_tick_id := null;
    v_damage_event_id := null;
    v_bucket := to_timestamp(
      floor(extract(epoch from p_now)/greatest(10,v_row.passive_tick_seconds))*greatest(10,v_row.passive_tick_seconds)
    );
    v_skip := null;

    if v_row.event_paused or v_row.event_status='paused' then v_skip := 'event_paused';
    elsif v_row.current_hp<=0 then v_skip := 'boss_defeated';
    elsif not coalesce(v_row.is_live,false) then v_skip := 'streamer_offline';
    elsif v_row.passive_damage_mode='test' and (v_row.event_status<>'testing' or not v_row.is_test_account) then v_skip := 'test_scope_required';
    elsif v_row.passive_damage_mode='active' and (v_row.event_status<>'active' or v_row.is_test_account or not v_row.include_in_calibration) then v_skip := 'production_scope_not_eligible';
    elsif v_row.passive_damage_mode='dry_run' and v_row.event_status not in ('testing','active') then v_skip := 'event_not_running';
    elsif v_row.passive_damage_mode in ('test','active') and not v_row.damage_enabled then v_skip := 'damage_disabled';
    end if;

    v_estimate := public.stable_passive_viewer_estimate(v_row.event_id,v_row.streamer_id,p_now);
    if v_skip is null and (v_estimate->>'viewerEstimate') is null then v_skip := 'no_fresh_viewer_sample'; end if;

    if v_skip is not null then
      insert into public.passive_damage_ticks(
        event_id,boss_id,run_id,streamer_id,bucket_started_at,mode,viewer_estimate,
        viewer_sample_count,latest_sample_at,status,skip_reason,configuration_version,metadata
      ) values (
        v_row.event_id,v_row.boss_id,v_row.run_id,v_row.streamer_id,v_bucket,v_row.passive_damage_mode,
        nullif(v_estimate->>'viewerEstimate','')::integer,coalesce((v_estimate->>'sampleCount')::integer,0),
        nullif(v_estimate->>'latestSampleAt','')::timestamptz,'skipped',v_skip,
        v_row.passive_configuration_version,jsonb_build_object('eventSlug',v_row.slug)
      ) on conflict(event_id,run_id,streamer_id,bucket_started_at) do nothing returning id into v_tick_id;
      if v_tick_id is null then v_idempotent:=v_idempotent+1; else v_skipped:=v_skipped+1; end if;
      continue;
    end if;

    v_calculation := public.calculate_passive_damage(v_row.event_id,(v_estimate->>'viewerEstimate')::integer);
    v_raw := greatest(0,(v_calculation->>'rawDamage')::bigint);
    v_configured := greatest(0,round(v_raw*v_row.global_damage_multiplier*v_row.passive_damage_multiplier)::bigint);

    begin
      insert into public.passive_damage_ticks(
        event_id,boss_id,run_id,streamer_id,bucket_started_at,mode,viewer_estimate,
        viewer_sample_count,latest_sample_at,curve_factor,raw_damage,configured_damage,
        status,configuration_version,metadata
      ) values (
        v_row.event_id,v_row.boss_id,v_row.run_id,v_row.streamer_id,v_bucket,v_row.passive_damage_mode,
        (v_estimate->>'viewerEstimate')::integer,(v_estimate->>'sampleCount')::integer,
        (v_estimate->>'latestSampleAt')::timestamptz,(v_calculation->>'curveFactor')::numeric,
        v_raw,v_configured,case when v_row.passive_damage_mode='dry_run' then 'preview' else 'pending' end,
        v_row.passive_configuration_version,jsonb_build_object('eventSlug',v_row.slug)
      ) on conflict(event_id,run_id,streamer_id,bucket_started_at) do nothing returning id into v_tick_id;

      if v_tick_id is null then
        v_idempotent:=v_idempotent+1;
        continue;
      end if;

      update public.viewer_samples set passive_damage_preview=v_configured
      where id=nullif(v_estimate->>'latestSampleId','')::uuid;

      if v_row.passive_damage_mode='dry_run' then
        v_preview:=v_preview+1;
      else
        v_damage := public.apply_boss_damage(
          v_row.event_id,v_row.streamer_id,'passive',v_raw,
          'passive:'||v_row.run_id::text||':'||v_row.streamer_id::text||':'||extract(epoch from v_bucket)::bigint::text,
          false,null
        );
        v_damage_event_id := nullif(v_damage->>'damageEventId','')::uuid;
        update public.passive_damage_ticks set
          status='applied',applied_damage=coalesce((v_damage->>'appliedDamage')::bigint,0),
          damage_event_id=v_damage_event_id,processed_at=now()
        where id=v_tick_id;
        v_applied:=v_applied+1;
      end if;
    exception when others then
      if v_tick_id is not null then
        update public.passive_damage_ticks set status='skipped',skip_reason='damage_application_failed',
          metadata=metadata||jsonb_build_object('error',left(sqlerrm,300)),processed_at=now()
        where id=v_tick_id;
      else
        insert into public.passive_damage_ticks(
          event_id,boss_id,run_id,streamer_id,bucket_started_at,mode,viewer_estimate,
          viewer_sample_count,latest_sample_at,status,skip_reason,configuration_version,metadata
        ) values (
          v_row.event_id,v_row.boss_id,v_row.run_id,v_row.streamer_id,v_bucket,v_row.passive_damage_mode,
          nullif(v_estimate->>'viewerEstimate','')::integer,coalesce((v_estimate->>'sampleCount')::integer,0),
          nullif(v_estimate->>'latestSampleAt','')::timestamptz,'skipped','damage_application_failed',
          v_row.passive_configuration_version,jsonb_build_object('error',left(sqlerrm,300))
        ) on conflict(event_id,run_id,streamer_id,bucket_started_at) do nothing;
      end if;
      v_skipped:=v_skipped+1;
    end;
  end loop;

  return jsonb_build_object('previewed',v_preview,'applied',v_applied,'skipped',v_skipped,'idempotent',v_idempotent,'processedAt',p_now);
end;
$$;

revoke all on function public.process_passive_damage_tick(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.process_passive_damage_tick(uuid,timestamptz) to service_role;

create or replace function public.guard_streamer_damage_v5()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.streamer_id is not null and new.source in ('passive','active','minion') and not exists(
    select 1 from public.streamers s where s.id=new.streamer_id and s.event_id=new.event_id
      and s.enabled and s.gameplay_enabled
  ) then raise exception 'streamer_gameplay_disabled'; end if;
  return new;
end;
$$;

drop trigger if exists damage_events_guard_streamer_v5 on public.damage_events;
create trigger damage_events_guard_streamer_v5 before insert on public.damage_events
  for each row execute function public.guard_streamer_damage_v5();
revoke all on function public.guard_streamer_damage_v5() from public,anon,authenticated;

create or replace function public.guard_minion_streamer_v5()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists(select 1 from public.streamers s where s.id=new.streamer_id and s.event_id=new.event_id
    and s.enabled and s.gameplay_enabled) then raise exception 'streamer_gameplay_disabled'; end if;
  return new;
end;
$$;

drop trigger if exists minion_events_guard_streamer_v5 on public.minion_events;
create trigger minion_events_guard_streamer_v5 before insert on public.minion_events
  for each row execute function public.guard_minion_streamer_v5();
revoke all on function public.guard_minion_streamer_v5() from public,anon,authenticated;

create or replace function public.guard_raid_eligibility_v5()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.eligible then
    new.eligible := new.from_streamer_id is not null and new.to_streamer_id is not null
      and new.from_streamer_id<>new.to_streamer_id
      and exists(select 1 from public.streamers s where s.id=new.from_streamer_id and s.event_id=new.event_id
        and s.enabled and s.gameplay_enabled)
      and exists(select 1 from public.streamers s where s.id=new.to_streamer_id and s.event_id=new.event_id
        and s.enabled and s.gameplay_enabled);
  end if;
  return new;
end;
$$;

drop trigger if exists raid_events_guard_eligibility_v5 on public.raid_events;
create trigger raid_events_guard_eligibility_v5 before insert or update of eligible,from_streamer_id,to_streamer_id
  on public.raid_events for each row execute function public.guard_raid_eligibility_v5();
revoke all on function public.guard_raid_eligibility_v5() from public,anon,authenticated;

create or replace function public.resolve_stream_elements_identity(
  p_event_slug text,
  p_twitch_login text
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_login text := lower(btrim(coalesce(p_twitch_login,'')));
  v_event public.events%rowtype;
  v_streamer public.streamers%rowtype;
  v_match_count integer := 0;
begin
  if v_login='' then return jsonb_build_object('status','error','channel_username',null,'event_slug',p_event_slug); end if;
  select * into v_event from public.events where slug=lower(btrim(coalesce(p_event_slug,''))) limit 1;
  if not found then return jsonb_build_object('status','event_unavailable','channel_username',v_login,'event_slug',lower(btrim(coalesce(p_event_slug,'')))); end if;
  select count(*)::integer into v_match_count from public.streamers where event_id=v_event.id and twitch_login=v_login;
  if v_match_count=0 then return jsonb_build_object('status','not_registered','channel_username',v_login,'event_id',v_event.id,'event_slug',v_event.slug,'event_status',v_event.status); end if;
  if v_match_count>1 then return jsonb_build_object('status','error','channel_username',v_login,'event_id',v_event.id,'event_slug',v_event.slug,'event_status',v_event.status); end if;
  select * into v_streamer from public.streamers where event_id=v_event.id and twitch_login=v_login;
  if not v_streamer.enabled or not v_streamer.gameplay_enabled then
    return jsonb_build_object('status','disabled','channel_username',v_login,'event_id',v_event.id,
      'event_slug',v_event.slug,'event_status',v_event.status,'is_test_account',v_streamer.is_test_account,
      'test_actions_authorized',false);
  end if;
  return jsonb_build_object(
    'status','resolved','channel_username',v_login,'event_id',v_event.id,'event_slug',v_event.slug,
    'event_status',v_event.status,'streamer_id',v_streamer.id,'streamer_slug',v_streamer.slug,
    'streamer_display_name',v_streamer.display_name,'is_test_account',v_streamer.is_test_account,
    'test_actions_authorized',v_streamer.is_test_account and v_event.status='testing'
  );
end;
$$;

revoke all on function public.resolve_stream_elements_identity(text,text) from public;
grant execute on function public.resolve_stream_elements_identity(text,text) to anon,authenticated;

create or replace function public.get_event_calibration_summary(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  if not exists(select 1 from public.event_admins ea where ea.event_id=p_event_id and ea.user_id=auth.uid()) then
    raise exception 'not_an_event_admin';
  end if;
  select jsonb_build_object(
    'streamers',coalesce(jsonb_agg(jsonb_build_object(
      'streamer_id',s.id,'display_name',s.display_name,'included',s.include_in_calibration,
      'is_test_account',s.is_test_account,'sample_count',coalesce(v.sample_count,0),
      'average_viewers',coalesce(v.average_viewers,0),'median_viewers',coalesce(v.median_viewers,0),
      'peak_viewers',coalesce(v.peak_viewers,0),'streams',coalesce(ss.streams,0),
      'streams_per_week',coalesce(ss.streams_per_week,0),
      'average_stream_seconds',coalesce(ss.average_stream_seconds,0),'total_live_seconds',coalesce(ss.total_live_seconds,0),
      'dry_run_damage',coalesce(pd.preview_damage,0),'passive_damage_per_hour',coalesce(pd.passive_damage_per_hour,0),
      'applied_passive_damage',coalesce(pd.applied_damage,0),'minions_spawned',coalesce(mn.minions_spawned,0),
      'minions_defeated',coalesce(mn.minions_defeated,0),'minions_failed',coalesce(mn.minions_failed,0),
      'minion_success_rates',coalesce(mn.success_rates,'{}'::jsonb)
    ) order by s.sort_order,s.display_name),'[]'::jsonb),
    'included_streamers',count(*) filter(where s.include_in_calibration and not s.is_test_account),
    'total_samples',coalesce(sum(v.sample_count) filter(where s.include_in_calibration and not s.is_test_account),0),
    'projected_passive_damage',coalesce(sum(pd.preview_damage) filter(where s.include_in_calibration and not s.is_test_account),0),
    'projected_passive_damage_per_hour',coalesce(sum(pd.passive_damage_per_hour) filter(where s.include_in_calibration and not s.is_test_account),0),
    'minions_spawned',coalesce(sum(mn.minions_spawned) filter(where s.include_in_calibration and not s.is_test_account),0),
    'minions_defeated',coalesce(sum(mn.minions_defeated) filter(where s.include_in_calibration and not s.is_test_account),0),
    'minions_failed',coalesce(sum(mn.minions_failed) filter(where s.include_in_calibration and not s.is_test_account),0),
    'max_concurrent_streamers',coalesce((
      select max(concurrent_streamers) from (
        select sum(delta) over(order by point_at,delta) concurrent_streamers from (
          select ss2.started_at point_at,1 delta from public.stream_sessions ss2 join public.streamers s2 on s2.id=ss2.streamer_id
            where ss2.event_id=p_event_id and s2.include_in_calibration and not s2.is_test_account
          union all
          select coalesce(ss2.ended_at,now()) point_at,-1 delta from public.stream_sessions ss2 join public.streamers s2 on s2.id=ss2.streamer_id
            where ss2.event_id=p_event_id and s2.include_in_calibration and not s2.is_test_account
        ) session_edges
      ) concurrency
    ),0)
  ) into v_result
  from public.streamers s
  left join lateral(
    select count(*)::integer sample_count,round(avg(vs.viewer_count)::numeric,2) average_viewers,
      round((percentile_cont(0.5) within group(order by vs.viewer_count))::numeric,2) median_viewers,
      max(vs.viewer_count)::integer peak_viewers
    from public.viewer_samples vs where vs.event_id=p_event_id and vs.streamer_id=s.id and vs.source='twitch_api'
  ) v on true
  left join lateral(
    select count(*)::integer streams,
      round(count(*)::numeric/greatest(1,extract(epoch from(max(ss.started_at)-min(ss.started_at)))/604800),2) streams_per_week,
      round(avg(extract(epoch from(coalesce(ss.ended_at,now())-ss.started_at)))::numeric)::bigint average_stream_seconds,
      round(sum(extract(epoch from(coalesce(ss.ended_at,now())-ss.started_at)))::numeric)::bigint total_live_seconds
    from public.stream_sessions ss where ss.event_id=p_event_id and ss.streamer_id=s.id
  ) ss on true
  left join lateral(
    select coalesce(sum(pdt.configured_damage) filter(where pdt.status='preview'),0)::bigint preview_damage,
      coalesce(sum(pdt.applied_damage) filter(where pdt.status='applied'),0)::bigint applied_damage,
      round((coalesce(avg(pdt.configured_damage) filter(where pdt.status='preview'),0)*3600/
        greatest(10,(select es.passive_tick_seconds from public.event_settings es where es.event_id=p_event_id)))::numeric,2) passive_damage_per_hour
    from public.passive_damage_ticks pdt where pdt.event_id=p_event_id and pdt.streamer_id=s.id
  ) pd on true
  left join lateral(
    select count(*)::integer minions_spawned,
      count(*) filter(where me.damage_awarded>0)::integer minions_defeated,
      count(*) filter(where me.status in ('failure','curse') or (me.status='complete' and me.resolved_at is not null and me.damage_awarded=0))::integer minions_failed,
      coalesce((select jsonb_object_agg(by_type.key,jsonb_build_object(
        'spawned',by_type.spawned,'defeated',by_type.defeated,
        'success_rate',round(by_type.defeated::numeric*100/nullif(by_type.spawned,0),2)
      )) from (
        select md.key,count(*)::integer spawned,count(*) filter(where typed.damage_awarded>0)::integer defeated
        from public.minion_events typed join public.minion_definitions md on md.id=typed.minion_definition_id
        where typed.event_id=p_event_id and typed.streamer_id=s.id group by md.key
      ) by_type),'{}'::jsonb) success_rates
    from public.minion_events me where me.event_id=p_event_id and me.streamer_id=s.id
  ) mn on true
  where s.event_id=p_event_id;
  return coalesce(v_result,jsonb_build_object('streamers','[]'::jsonb,'included_streamers',0,'total_samples',0,'projected_passive_damage',0));
end;
$$;

revoke all on function public.get_event_calibration_summary(uuid) from public,anon;
grant execute on function public.get_event_calibration_summary(uuid) to authenticated,service_role;

create or replace view public.viewer_samples_calibration
with (security_invoker=true) as
select vs.* from public.viewer_samples vs
join public.streamers s on s.id=vs.streamer_id
where vs.source='twitch_api' and not s.is_test_account and s.include_in_calibration and s.tracking_enabled;

revoke all on public.viewer_samples_calibration from public,anon,authenticated;
grant select on public.viewer_samples_calibration to service_role;

-- The detailed v0.4 state remains the source projection; this wrapper applies
-- v0.5 privacy/scoping flags and appends admin-only operational diagnostics.
create or replace function public.get_public_event_state(p_event_slug text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_state jsonb;
  v_event_id uuid;
  v_run_id uuid;
  v_is_admin boolean:=false;
  v_streamers jsonb:='[]'::jsonb;
  v_minions jsonb:='[]'::jsonb;
  v_stats jsonb:='{}'::jsonb;
  v_settings public.event_settings%rowtype;
  v_passive jsonb:='{}'::jsonb;
  v_jobs jsonb:='[]'::jsonb;
begin
  select e.id,b.run_id,exists(select 1 from public.event_admins ea where ea.event_id=e.id and ea.user_id=auth.uid())
  into v_event_id,v_run_id,v_is_admin from public.events e join public.bosses b on b.event_id=e.id
  where e.slug=lower(btrim(coalesce(p_event_slug,'')));
  if v_event_id is null then return null; end if;
  select * into v_settings from public.event_settings where event_id=v_event_id;
  v_state:=public.get_public_event_state_v4_unfiltered(p_event_slug);
  if v_state is null then return null; end if;

  select coalesce(jsonb_agg(item||jsonb_build_object(
    'is_test_account',s.is_test_account,'tracking_enabled',s.tracking_enabled,
    'gameplay_enabled',s.gameplay_enabled,'public_visible',s.public_visible,
    'include_in_calibration',s.include_in_calibration
  ) order by coalesce((item->>'sort_order')::integer,0),item->>'display_name'),'[]'::jsonb)
  into v_streamers from jsonb_array_elements(coalesce(v_state->'streamers','[]'::jsonb)) item
  join public.streamers s on s.id=(item->>'id')::uuid
  where v_is_admin or (s.enabled and s.public_visible and s.gameplay_enabled and not s.is_test_account);

  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_minions
  from jsonb_array_elements(coalesce(v_state->'minions','[]'::jsonb)) item
  join public.streamers s on s.id=(item->>'streamer_id')::uuid
  where v_is_admin or (s.enabled and s.public_visible and s.gameplay_enabled and not s.is_test_account);

  if v_is_admin then
    v_stats:=coalesce(v_state->'stats','{}'::jsonb);
    select coalesce(jsonb_agg(to_jsonb(j) order by j.job_key),'[]'::jsonb) into v_jobs
      from public.event_job_status j where j.event_id=v_event_id;
    select coalesce(to_jsonb(t),'{}'::jsonb) into v_passive from(
      select pdt.* from public.passive_damage_ticks pdt where pdt.event_id=v_event_id
      order by pdt.bucket_started_at desc,pdt.created_at desc limit 1
    ) t;
  else
    select jsonb_build_object(
      'total_damage',greatest(0,(v_state#>>'{boss,max_hp}')::bigint-(v_state#>>'{boss,current_hp}')::bigint),
      'total_minions_spawned',(select count(*) from public.minion_events m join public.streamers s on s.id=m.streamer_id where m.event_id=v_event_id and m.run_id=v_run_id and s.public_visible and s.gameplay_enabled and not s.is_test_account),
      'total_minions_defeated',(select count(*) from public.minion_events m join public.streamers s on s.id=m.streamer_id where m.event_id=v_event_id and m.run_id=v_run_id and s.public_visible and s.gameplay_enabled and not s.is_test_account and m.status in ('success','complete') and m.damage_awarded>0),
      'total_minions_failed',(select count(*) from public.minion_events m join public.streamers s on s.id=m.streamer_id where m.event_id=v_event_id and m.run_id=v_run_id and s.public_visible and s.gameplay_enabled and not s.is_test_account and (m.status in ('failure','curse') or (m.status='complete' and m.damage_awarded=0 and m.resolved_at is not null))),
      'active_streamer_count',(select count(*) from public.streamers s where s.event_id=v_event_id and s.enabled and s.public_visible and s.gameplay_enabled and not s.is_test_account),
      'unique_participants',(select count(distinct mp.participant_key) from public.minion_participants mp join public.minion_events m on m.id=mp.minion_event_id join public.streamers s on s.id=m.streamer_id where m.event_id=v_event_id and m.run_id=v_run_id and s.public_visible and s.gameplay_enabled and not s.is_test_account)
    ) into v_stats;
  end if;

  v_state:=jsonb_set(v_state,'{streamers}',v_streamers,true);
  v_state:=jsonb_set(v_state,'{minions}',v_minions,true);
  v_state:=jsonb_set(v_state,'{stats}',v_stats,true);
  v_state:=jsonb_set(v_state,'{settings}',coalesce(v_state->'settings','{}'::jsonb)||jsonb_build_object(
    'twitch_tracking_enabled',v_settings.twitch_tracking_enabled,
    'passive_damage_enabled',v_settings.passive_damage_enabled,
    'passive_damage_mode',v_settings.passive_damage_mode,
    'passive_base_damage',case when v_is_admin then v_settings.passive_base_damage else null end,
    'passive_curve_exponent',case when v_is_admin then v_settings.passive_curve_exponent else null end,
    'passive_soft_cap',case when v_is_admin then v_settings.passive_soft_cap else null end,
    'passive_min_damage',case when v_is_admin then v_settings.passive_min_damage else null end,
    'passive_max_damage',case when v_is_admin then v_settings.passive_max_damage else null end,
    'passive_underdog_factor',case when v_is_admin then v_settings.passive_underdog_factor else null end,
    'passive_configuration_version',case when v_is_admin then v_settings.passive_configuration_version else null end
  ),true);
  v_state:=v_state||jsonb_build_object(
    'passive_damage',case when v_is_admin then v_passive else '{}'::jsonb end,
    'jobs',case when v_is_admin then v_jobs else '[]'::jsonb end,
    'calibration',case when v_is_admin then public.get_event_calibration_summary(v_event_id) else '{}'::jsonb end
  );
  if not v_is_admin then v_state:=jsonb_set(v_state,'{log}','[]'::jsonb,true); end if;
  return v_state;
end;
$$;

revoke all on function public.get_public_event_state(text) from public;
grant execute on function public.get_public_event_state(text) to anon,authenticated;

create or replace function public.get_stream_elements_widget_state(p_event_slug text,p_twitch_login text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_login text:=lower(btrim(coalesce(p_twitch_login,'')));
  v_event public.events%rowtype;
  v_streamer public.streamers%rowtype;
  v_state jsonb;
  v_public_state jsonb;
  v_streamers jsonb:='[]'::jsonb;
  v_minions jsonb:='[]'::jsonb;
begin
  select * into v_event from public.events where slug=lower(btrim(coalesce(p_event_slug,'')));
  if not found then return null; end if;
  select * into v_streamer from public.streamers where event_id=v_event.id and twitch_login=v_login and enabled and gameplay_enabled;
  if not found then return null; end if;
  v_state:=public.get_public_event_state_v4_unfiltered(v_event.slug);
  if v_state is null then return null; end if;
  v_public_state:=public.get_public_event_state(v_event.slug);
  select coalesce(jsonb_agg(item||jsonb_build_object(
    'is_test_account',v_streamer.is_test_account,'tracking_enabled',v_streamer.tracking_enabled,
    'gameplay_enabled',v_streamer.gameplay_enabled,'public_visible',v_streamer.public_visible,
    'include_in_calibration',v_streamer.include_in_calibration
  )),'[]'::jsonb) into v_streamers
  from jsonb_array_elements(coalesce(v_state->'streamers','[]'::jsonb)) item where item->>'id'=v_streamer.id::text;
  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_minions
  from jsonb_array_elements(coalesce(v_state->'minions','[]'::jsonb)) item where item->>'streamer_id'=v_streamer.id::text;
  v_state:=jsonb_set(v_state,'{streamers}',v_streamers,true);
  v_state:=jsonb_set(v_state,'{minions}',v_minions,true);
  if not (v_streamer.is_test_account and v_event.status='testing') and v_public_state is not null then
    v_state:=jsonb_set(v_state,'{stats}',coalesce(v_public_state->'stats','{}'::jsonb),true);
  end if;
  v_state:=jsonb_set(v_state,'{log}','[]'::jsonb,true);
  return v_state||jsonb_build_object('test_actions_authorized',v_streamer.is_test_account and v_event.status='testing');
end;
$$;

revoke all on function public.get_stream_elements_widget_state(text,text) from public;
grant execute on function public.get_stream_elements_widget_state(text,text) to anon,authenticated;

-- Test fixtures are real runtime identities, but never public or calibration participants.
update public.streamers s set
  tracking_enabled=true,
  gameplay_enabled=true,
  public_visible=false,
  include_in_calibration=false,
  updated_at=now()
from public.events e where e.id=s.event_id and e.slug='halloween-2026-test';

-- Production remains disabled; the test event is permitted to exercise the full server path.
update public.event_settings es set
  passive_damage_enabled=false,
  passive_damage_mode='disabled',
  updated_at=now()
from public.events e where e.id=es.event_id and e.slug='halloween-2026';

update public.event_settings es set
  passive_damage_enabled=true,
  passive_damage_mode='test',
  passive_configuration_version=1,
  updated_at=now()
from public.events e where e.id=es.event_id and e.slug='halloween-2026-test';

do $$ begin
  alter publication supabase_realtime add table public.passive_damage_ticks;
exception when duplicate_object then null; end $$;

create or replace function public.cancel_minions_on_streamer_scope_v5()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not new.enabled or not new.gameplay_enabled then
    update public.minion_events set status='cancelled',resolved_at=now(),display_until=now()+interval '4 seconds'
      where event_id=new.event_id and streamer_id=new.id
        and status in ('scheduled','intro','active','failure','curse');
    update public.minion_special_queue set status='cancelled',updated_at=now()
      where event_id=new.event_id and streamer_id=new.id and status='scheduled';
    delete from public.minion_spawn_schedules where event_id=new.event_id and streamer_id=new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists streamers_cancel_minions_on_scope_v5 on public.streamers;
create trigger streamers_cancel_minions_on_scope_v5
  after update of enabled,gameplay_enabled on public.streamers
  for each row execute function public.cancel_minions_on_streamer_scope_v5();
revoke all on function public.cancel_minions_on_streamer_scope_v5() from public,anon,authenticated;

create or replace function public.queue_eligible_raid_herald()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_settings public.event_settings%rowtype; v_delay integer;
begin
  if not new.eligible or new.to_streamer_id is null then return new; end if;
  if not exists(select 1 from public.streamers s where s.id=new.to_streamer_id and s.event_id=new.event_id
    and s.enabled and s.gameplay_enabled) then return new; end if;
  select * into v_settings from public.event_settings where event_id=new.event_id;
  v_delay:=v_settings.raid_special_delay_min_seconds+
    floor(random()*(v_settings.raid_special_delay_max_seconds-v_settings.raid_special_delay_min_seconds+1))::integer;
  insert into public.minion_special_queue(event_id,streamer_id,minion_key,due_at,trigger_source,trigger_reference)
  values(new.event_id,new.to_streamer_id,'kings_herald',new.occurred_at+make_interval(secs=>v_delay),'raid',new.id::text)
  on conflict(event_id,trigger_source,trigger_reference) do nothing;
  return new;
end;
$$;

create or replace function public.process_minion_tick(p_event_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_queue public.minion_special_queue%rowtype;
  v_definition_id uuid;
  v_schedule record;
  v_phase smallint;
  v_spawned integer:=0;
  v_specials integer:=0;
  v_event record;
begin
  perform public.advance_minion_engine(p_event_id);
  for v_queue in select * from public.minion_special_queue q
    where (p_event_id is null or q.event_id=p_event_id) and q.status='scheduled' and q.due_at<=now()
    order by q.due_at for update skip locked
  loop
    if not exists(select 1 from public.streamers s where s.id=v_queue.streamer_id and s.event_id=v_queue.event_id
      and s.enabled and s.gameplay_enabled) then
      update public.minion_special_queue set status='cancelled',updated_at=now() where id=v_queue.id;
      continue;
    end if;
    if exists(select 1 from public.minion_events m where m.event_id=v_queue.event_id
      and m.streamer_id=v_queue.streamer_id and m.status in ('intro','active','success','failure','curse')) then
      update public.minion_special_queue set due_at=now()+interval '2 minutes',updated_at=now() where id=v_queue.id;
      continue;
    end if;
    select id into v_definition_id from public.minion_definitions
      where event_id=v_queue.event_id and key=v_queue.minion_key and enabled;
    begin
      perform public.spawn_minion_v4(v_queue.event_id,v_definition_id,v_queue.streamer_id,false,'raid',v_queue.trigger_reference,now());
      update public.minion_special_queue set status='spawned',updated_at=now() where id=v_queue.id;
      update public.minion_spawn_schedules set cooldown_until=now()+make_interval(secs=>600+floor(random()*301)::integer),
        next_spawn_at=null,updated_at=now() where event_id=v_queue.event_id and streamer_id=v_queue.streamer_id;
      v_specials:=v_specials+1;
    exception when others then
      update public.minion_special_queue set due_at=now()+interval '2 minutes',updated_at=now() where id=v_queue.id;
    end;
  end loop;

  for v_event in select e.id,b.current_hp,b.max_hp from public.events e
    join public.event_settings es on es.event_id=e.id join public.bosses b on b.event_id=e.id
    where (p_event_id is null or e.id=p_event_id) and e.status='active'
      and not es.event_paused and es.minions_enabled and es.twitch_tracking_enabled and b.current_hp>0
  loop
    v_phase:=public.current_phase(v_event.current_hp,v_event.max_hp);
    insert into public.minion_spawn_schedules(event_id,streamer_id,next_spawn_at,cooldown_until,phase_number)
    select v_event.id,s.id,now()+make_interval(secs=>public.random_minion_delay_seconds(v_phase)),now()+interval '10 minutes',v_phase
    from public.streamers s join public.streamer_runtime r on r.streamer_id=s.id and r.event_id=s.event_id
    where s.event_id=v_event.id and s.enabled and s.tracking_enabled and s.gameplay_enabled and r.is_live
    on conflict(event_id,streamer_id) do nothing;

    for v_schedule in select ms.* from public.minion_spawn_schedules ms
      join public.streamers s on s.id=ms.streamer_id
      join public.streamer_runtime r on r.streamer_id=s.id and r.event_id=s.event_id
      where ms.event_id=v_event.id and s.enabled and s.tracking_enabled and s.gameplay_enabled and r.is_live
        and ms.next_spawn_at<=now() and coalesce(ms.cooldown_until,'-infinity')<=now()
      for update of ms skip locked
    loop
      if exists(select 1 from public.minion_events m where m.event_id=v_event.id
        and m.streamer_id=v_schedule.streamer_id and m.status in ('intro','active','success','failure','curse')) then continue; end if;
      select d.id into v_definition_id from public.minion_definitions d
        where d.event_id=v_event.id and d.enabled and d.key<>'kings_herald'
          and d.phase_min<=v_phase and d.weight>0
        order by -ln(greatest(random(),0.000001))/d.weight limit 1;
      if v_definition_id is not null then
        perform public.spawn_minion_v4(v_event.id,v_definition_id,v_schedule.streamer_id,false,'scheduler',null,now());
        update public.minion_spawn_schedules set next_spawn_at=null,phase_number=v_phase,updated_at=now()
          where event_id=v_event.id and streamer_id=v_schedule.streamer_id;
        v_spawned:=v_spawned+1;
      end if;
    end loop;
    update public.minion_spawn_schedules ms set
      next_spawn_at=now()+make_interval(secs=>public.random_minion_delay_seconds(v_phase)),
      phase_number=v_phase,updated_at=now()
    where ms.event_id=v_event.id and ms.next_spawn_at is null
      and exists(select 1 from public.streamers s where s.id=ms.streamer_id and s.enabled and s.tracking_enabled and s.gameplay_enabled)
      and not exists(select 1 from public.minion_events m where m.event_id=ms.event_id
        and m.streamer_id=ms.streamer_id and m.status in ('intro','active','success','failure','curse'));
  end loop;
  delete from public.minion_submission_rate_limits where window_started_at<now()-interval '1 hour';
  delete from public.minion_participants where submitted_at<now()-interval '24 hours'
    and minion_event_id in(select id from public.minion_events where status in ('complete','cancelled','expired'));
  return jsonb_build_object('spawned',v_spawned,'raidSpecials',v_specials);
end;
$$;

revoke all on function public.process_minion_tick(uuid) from public,anon,authenticated;
grant execute on function public.process_minion_tick(uuid) to service_role;
