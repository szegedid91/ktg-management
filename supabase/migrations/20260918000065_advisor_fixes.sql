-- Supabase security advisor 2026-09-18:
--  1) trigger-függvény (fn_task_note_author) anon/authenticated által hívható volt → revoke;
--     védekezésül: anon egyetlen függvényt sem hívhat az invite_info kivételével
--  2) fn_task_due_reset, fn_week_start: rögzített search_path
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') and p.proname <> 'invite_info'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
alter function public.fn_task_due_reset() set search_path = public;
alter function public.fn_week_start(date) set search_path = public;
