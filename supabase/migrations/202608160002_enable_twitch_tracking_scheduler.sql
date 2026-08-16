-- Twitch Awareness polling is an essential data-collection job.
-- Environment setup must provide Vault secrets named project_url and
-- twitch_sync_cron_secret. No secret value is stored in this migration.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in ('twitch-stream-sync-every-two-minutes', 'kuerbiskoenig-test-twitch-sync')
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'twitch-stream-sync-every-two-minutes',
  '*/2 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/twitch-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'twitch_sync_cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $job$
);
