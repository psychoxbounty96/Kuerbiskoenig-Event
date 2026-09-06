-- PXB Community Event Engine: fail deployment if the clean-install reset left data behind.
do $$
declare
  table_record record;
  row_total bigint;
begin
  for table_record in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'select count(*) from %I.%I',
      table_record.schemaname,
      table_record.tablename
    ) into row_total;

    if row_total <> 0 then
      raise exception 'Clean installation verification failed: %.% contains % rows',
        table_record.schemaname,
        table_record.tablename,
        row_total;
    end if;
  end loop;

  select count(*) into row_total from auth.users;
  if row_total <> 0 then
    raise exception 'Clean installation verification failed: auth.users contains % rows', row_total;
  end if;

  if to_regclass('cron.job') is not null then
    execute 'select count(*) from cron.job' into row_total;
    if row_total <> 0 then
      raise exception 'Clean installation verification failed: cron.job contains % rows', row_total;
    end if;
  end if;
end;
$$;
