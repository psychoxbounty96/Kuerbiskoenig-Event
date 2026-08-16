-- Bot-free Discord live announcements. The webhook URL remains an Edge
-- Function secret and is never stored in this schema.
create table if not exists public.discord_stream_announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  twitch_stream_id text not null check (btrim(twitch_stream_id) <> ''),
  discord_guild_id text not null check (discord_guild_id ~ '^[0-9]{15,25}$'),
  discord_channel_id text not null check (discord_channel_id ~ '^[0-9]{15,25}$'),
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempt_count integer not null default 1 check (attempt_count between 1 and 3),
  discord_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, streamer_id, twitch_stream_id, discord_channel_id)
);

create index if not exists discord_stream_announcements_status_idx
  on public.discord_stream_announcements (status, updated_at desc);

alter table public.discord_stream_announcements enable row level security;
revoke all on public.discord_stream_announcements from public, anon, authenticated;
grant select, insert, update on public.discord_stream_announcements to service_role;

create or replace function public.claim_discord_stream_announcement(
  p_event_id uuid,
  p_streamer_id uuid,
  p_twitch_stream_id text,
  p_guild_id text,
  p_channel_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_announcement_id uuid;
  v_attempt_count integer;
begin
  if btrim(coalesce(p_twitch_stream_id,'')) = ''
    or coalesce(p_guild_id,'') !~ '^[0-9]{15,25}$'
    or coalesce(p_channel_id,'') !~ '^[0-9]{15,25}$' then
    raise exception 'invalid_discord_announcement_target';
  end if;
  if not exists (
    select 1
    from public.events e
    join public.event_settings es on es.event_id=e.id
    join public.streamers s on s.event_id=e.id
    where e.id=p_event_id and e.status='active' and not es.event_paused and es.twitch_tracking_enabled
      and s.id=p_streamer_id and s.enabled and s.tracking_enabled
      and s.gameplay_enabled and s.public_visible and not s.is_test_account
  ) then
    return null;
  end if;

  insert into public.discord_stream_announcements (
    event_id,streamer_id,twitch_stream_id,discord_guild_id,discord_channel_id,status,attempt_count
  ) values (
    p_event_id,p_streamer_id,btrim(p_twitch_stream_id),p_guild_id,p_channel_id,'pending',1
  ) on conflict (event_id,streamer_id,twitch_stream_id,discord_channel_id) do update set
    status='pending',
    attempt_count=public.discord_stream_announcements.attempt_count+1,
    last_error=null,
    updated_at=now()
  where public.discord_stream_announcements.status='failed'
    and public.discord_stream_announcements.attempt_count<3
    and public.discord_stream_announcements.updated_at <= now()-interval '2 minutes'
  returning id,attempt_count into v_announcement_id,v_attempt_count;

  if v_announcement_id is null then return null; end if;
  return jsonb_build_object('announcementId',v_announcement_id,'attemptCount',v_attempt_count);
end;
$$;

create or replace function public.finish_discord_stream_announcement(
  p_announcement_id uuid,
  p_status text,
  p_discord_message_id text default null,
  p_error text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('sent','failed') then raise exception 'invalid_discord_announcement_status'; end if;
  update public.discord_stream_announcements set
    status=p_status,
    discord_message_id=case when p_status='sent' then left(coalesce(p_discord_message_id,''),100) else null end,
    last_error=case when p_status='failed' then left(coalesce(p_error,'unknown_error'),500) else null end,
    sent_at=case when p_status='sent' then now() else null end,
    updated_at=now()
  where id=p_announcement_id and status='pending';
end;
$$;

revoke all on function public.claim_discord_stream_announcement(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.finish_discord_stream_announcement(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_discord_stream_announcement(uuid,uuid,text,text,text) to service_role;
grant execute on function public.finish_discord_stream_announcement(uuid,text,text,text) to service_role;
