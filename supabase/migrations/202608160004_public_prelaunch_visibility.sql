-- Expose only the minimal event envelope needed to leave a stale public
-- testing view when an organizer moves the event back to draft.
create or replace function public.get_public_event_visibility(p_event_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'event_id', e.id,
    'event_slug', e.slug,
    'event_name', e.name,
    'event_status', e.status,
    'updated_at', e.updated_at
  )
  from public.events e
  where e.slug = lower(btrim(coalesce(p_event_slug, '')));
$$;

revoke all on function public.get_public_event_visibility(text) from public;
grant execute on function public.get_public_event_visibility(text) to anon, authenticated;
