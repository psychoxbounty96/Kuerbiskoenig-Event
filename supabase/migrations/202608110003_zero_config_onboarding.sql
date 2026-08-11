-- Kürbiskönig v0.3 patch: zero-configuration StreamElements identity.
-- Public clients may resolve an already registered participant, but receive no write capability.

do $$
begin
  if exists (
    select 1
    from public.streamers
    where lower(btrim(twitch_login)) <> ''
    group by event_id, lower(btrim(twitch_login))
    having count(*) > 1
  ) then
    raise exception 'duplicate_normalized_twitch_login';
  end if;
end;
$$;

update public.streamers
set twitch_login = lower(btrim(twitch_login)), updated_at = now()
where twitch_login is distinct from lower(btrim(twitch_login));

alter table public.streamers
  add constraint streamers_twitch_login_normalized_check
  check (twitch_login = lower(btrim(twitch_login)));

create unique index streamers_event_twitch_login_unique_idx
  on public.streamers (event_id, twitch_login)
  where twitch_login <> '';

create or replace function public.normalize_streamer_twitch_login()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.twitch_login := lower(btrim(coalesce(new.twitch_login, '')));
  return new;
end;
$$;

create trigger streamers_normalize_twitch_login
before insert or update of twitch_login on public.streamers
for each row execute function public.normalize_streamer_twitch_login();

create or replace function public.admin_set_event_status(
  p_event_id uuid,
  p_status text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('draft', 'testing', 'active') then
    raise exception 'invalid_event_status';
  end if;
  update public.events
  set status = p_status, updated_at = now()
  where id = p_event_id;
  if not found then raise exception 'event_not_found'; end if;
  update public.event_settings
  set event_paused = false, updated_at = now()
  where event_id = p_event_id;
  return jsonb_build_object('eventId', p_event_id, 'status', p_status);
end;
$$;

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
    return jsonb_build_object(
      'status', 'error',
      'channel_username', null,
      'event_slug', p_event_slug
    );
  end if;

  select * into v_event
  from public.events
  where slug = lower(btrim(coalesce(p_event_slug, '')))
  limit 1;

  if not found then
    return jsonb_build_object(
      'status', 'event_unavailable',
      'channel_username', v_login,
      'event_slug', lower(btrim(coalesce(p_event_slug, '')))
    );
  end if;

  select count(*)::integer into v_match_count
  from public.streamers
  where event_id = v_event.id and twitch_login = v_login;

  if v_match_count = 0 then
    return jsonb_build_object(
      'status', 'not_registered',
      'channel_username', v_login,
      'event_id', v_event.id,
      'event_slug', v_event.slug,
      'event_status', v_event.status
    );
  end if;

  if v_match_count > 1 then
    return jsonb_build_object(
      'status', 'error',
      'channel_username', v_login,
      'event_id', v_event.id,
      'event_slug', v_event.slug,
      'event_status', v_event.status
    );
  end if;

  select * into v_streamer
  from public.streamers
  where event_id = v_event.id and twitch_login = v_login;

  if not v_streamer.enabled then
    return jsonb_build_object(
      'status', 'disabled',
      'channel_username', v_login,
      'event_id', v_event.id,
      'event_slug', v_event.slug,
      'event_status', v_event.status
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
    'streamer_display_name', v_streamer.display_name
  );
end;
$$;

revoke all on function public.resolve_stream_elements_identity(text, text) from public;
grant execute on function public.resolve_stream_elements_identity(text, text) to anon, authenticated;

revoke all on function public.normalize_streamer_twitch_login() from public, anon, authenticated;
revoke all on function public.admin_set_event_status(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_event_status(uuid, text) to service_role;
