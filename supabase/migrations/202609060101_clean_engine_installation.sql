-- Destructive prototype reset: this Supabase project is now an empty,
-- event-independent PXB Community Event Engine installation.

do $$
declare
  existing_job record;
begin
  if to_regclass('cron.job') is not null then
    for existing_job in select jobid from cron.job loop
      perform cron.unschedule(existing_job.jobid);
    end loop;
  end if;
end
$$;

do $$
declare
  tables_to_clear text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ' order by tablename)
    into tables_to_clear
    from pg_tables
   where schemaname = 'public';

  if tables_to_clear is not null then
    execute 'truncate table ' || tables_to_clear || ' restart identity cascade';
  end if;
end
$$;

-- The prototype admin identities were only test data and must not survive the
-- clean installation. Supabase-managed schemas and configuration remain intact.
delete from auth.users;
