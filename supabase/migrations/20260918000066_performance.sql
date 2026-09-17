-- Supabase performance advisor 2026-09-18:
--  1) idegen kulcsok lefedő indexe (51 db) — generálva a pg_constraint alapján
--  2) RLS-szabályok: auth.uid() → (select auth.uid()) — a kifejezés egyszer értékelődik
--     ki lekérdezésenként, nem soronként (a szabályok jelentése változatlan)

do $$
declare c record; v_cols text; v_name text;
begin
  for c in
    select con.conrelid::regclass as tbl, con.conname, con.conkey, con.conrelid
    from pg_constraint con join pg_namespace n on n.oid = con.connamespace
    where con.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = con.conrelid and (i.indkey::int2[])[0:array_length(con.conkey,1)-1] = con.conkey)
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ord) into v_cols
    from unnest(c.conkey) with ordinality k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum;
    v_name := left('ix_fk_' || replace(c.conname, '_fkey', ''), 63);
    execute format('create index if not exists %I on %s (%s)', v_name, c.tbl, v_cols);
  end loop;
end $$;

do $$
declare p record; v_qual text; v_check text; v_roles text; v_sql text;
begin
  for p in select * from pg_policies where schemaname = 'public'
           and (coalesce(qual, '') ~ 'auth\.uid\(\)' or coalesce(with_check, '') ~ 'auth\.uid\(\)')
           and not (coalesce(qual, '') ~ '\(\s*select auth\.uid\(\)\s*\)' or coalesce(with_check, '') ~ '\(\s*select auth\.uid\(\)\s*\)')
  loop
    v_qual := regexp_replace(p.qual, 'auth\.uid\(\)', '(select auth.uid())', 'g');
    v_check := regexp_replace(p.with_check, 'auth\.uid\(\)', '(select auth.uid())', 'g');
    v_roles := array_to_string(p.roles, ', ');
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    v_sql := format('create policy %I on %I.%I as %s for %s to %s', p.policyname, p.schemaname, p.tablename,
                    p.permissive, p.cmd, v_roles);
    if v_qual is not null then v_sql := v_sql || ' using (' || v_qual || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
  end loop;
end $$;
