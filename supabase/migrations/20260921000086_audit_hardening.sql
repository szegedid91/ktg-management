-- Átvilágítás 2026-09-21 éjjel — rések lezárása.

-- 1) RÉS: suggested_settlements jogosultság-ellenőrzés nélkül futott (SECURITY DEFINER),
--    így bármely bejelentkezett fiók lekérhette a vezetők egymás közti egyenlegeit.
do $mig$
declare d text := pg_get_functiondef('public.suggested_settlements()'::regprocedure);
        v_old text := E'begin\n  select array_agg(user_id order by balance desc)';
begin
  if position('Csak vezető' in d) > 0 then return; end if;
  if position(v_old in d) = 0 then raise exception 'suggested_settlements: a várt szövegrész nem található'; end if;
  d := replace(d, v_old, E'begin\n  if auth.uid() is null or not public.fn_is_partner() then raise exception ''Csak vezető érheti el.''; end if;\n  select array_agg(user_id order by balance desc)');
  execute d;
end $mig$;

-- 2) A lezárt feladat MARADÉK adatai se menjenek le a munkavállalónak (részfeladatok, megjegyzések,
--    a többiek kiosztása, saját ajánlat). A saját kiosztás-sor (csak azonosítók) marad, mert más
--    szabályok arra hivatkoznak; a saját anyagköltség-/fotósor is marad, hogy egy offline rögzített
--    tétel akkor is felmenjen, ha közben a vezető lezárta a feladatot.
create or replace function public.fn_my_active_task_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct a.task_id), '{}'::uuid[])
  from public.task_assignees a join public.worker_tasks t on t.id = a.task_id
  where a.worker_id = public.fn_my_worker_id() and a.deleted_at is null
    and t.deleted_at is null and t.status in ('assigned', 'acknowledged');
$$;
revoke execute on function public.fn_my_active_task_ids() from public, anon;
grant execute on function public.fn_my_active_task_ids() to authenticated;

drop policy if exists ta_select on public.task_assignees;
create policy ta_select on public.task_assignees for select to authenticated
  using (public.fn_is_partner() or worker_id = public.fn_my_worker_id()
         or task_id = any(public.fn_my_active_task_ids()));

drop policy if exists ts_select on public.task_subtasks;
create policy ts_select on public.task_subtasks for select to authenticated
  using (public.fn_is_partner() or task_id = any(public.fn_my_active_task_ids()));

drop policy if exists tn_select on public.task_notes;
create policy tn_select on public.task_notes for select to authenticated
  using (public.fn_is_partner() or (visible_to_workers
    and task_id = any(public.fn_my_active_task_ids())
    and exists (select 1 from public.task_assignees a
                where a.task_id = task_notes.task_id and a.worker_id = public.fn_my_worker_id()
                  and a.deleted_at is null and a.acknowledged_at is not null)));

drop policy if exists tq_select on public.task_quotes;
create policy tq_select on public.task_quotes for select to authenticated
  using (public.fn_is_partner() or (worker_id = public.fn_my_worker_id()
         and task_id = any(public.fn_my_active_task_ids())));

-- 3) Feladat-nézet a munkavállalói szinkronhoz: csak a futó, rá osztott feladat, az elfogadott
--    ajánlat összege / megjegyzése nélkül (az eddig a feladat minden résztvevőjének — a vállalkozó
--    embereinek és a munkatársaknak is — lement). Az alap tábla olvasását a 2. ütemben szűkítjük
--    vezetőre, amikor már minden kliens ebből a nézetből olvas.
create or replace view public.worker_tasks_v
with (security_barrier = true, security_invoker = false) as
with me as (select public.fn_is_partner() as partner, public.fn_my_active_task_ids() as act)
select t.id, t.worker_id, t.site_id, t.code, t.title, t.details, t.status, t.acknowledged_at, t.done_at,
       t.fail_reason, t.fail_photo_path, t.created_by, t.created_at, t.updated_at, t.deleted_at,
       t.quote_requested,
       case when me.partner then t.quote_amount end as quote_amount,
       case when me.partner then t.quote_note end as quote_note,
       case when me.partner then t.quote_submitted_at end as quote_submitted_at,
       t.quote_accepted_at,
       case when me.partner then t.quote_accepted_by end as quote_accepted_by,
       t.photo_paths, t.fail_photo_paths, t.priority, t.due_date, t.overdue_notified_at
from public.worker_tasks t cross join me
where me.partner or t.id = any(me.act);
revoke all on public.worker_tasks_v from public, anon, authenticated;
grant select on public.worker_tasks_v to authenticated;

-- 4) Fájltároló: a munkavállaló eddig a feladat MINDEN fájlját olvashatta / listázhatta (más
--    munkavállaló számlafotóját is). Mostantól: a saját feltöltéseit, és a futó feladatához a
--    vezető által csatolt képeket (brief, sub). Feltölteni is csak futó feladathoz lehet — kivéve,
--    hogy a kiosztás megléte elég (offline rögzített fotó lezárás után is felmehessen).
drop policy if exists tasks_read on storage.objects;
create policy tasks_read on storage.objects for select to authenticated
  using (bucket_id = 'tasks' and (public.fn_is_partner() or owner = auth.uid()
    or ((storage.foldername(name))[2] in ('brief', 'sub')
        and ((storage.foldername(name))[1])::text = any(select x::text from unnest(public.fn_my_active_task_ids()) x))));

-- 5) Fölösleges jogok: a TRUNCATE megkerüli az RLS-t; a kliensnek se ez, se REFERENCES / TRIGGER nem kell.
--    A kimutatás-nézeteken írási jog sem kell.
revoke truncate, references, trigger on all tables in schema public from authenticated, anon;
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'v' loop
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', r.relname);
  end loop;
end $$;

-- 6) A jelenlét-nézetben a feladat-azonosító se menjen le munkavállalónak (lezárt feladatra mutathat).
do $mig$
declare d text := pg_get_viewdef('public.attendance_v'::regclass, true);
begin
  if position('a.task_id,' in d) > 0 then
    d := replace(d, 'a.task_id,', E'CASE WHEN me.partner THEN a.task_id ELSE NULL::uuid END AS task_id,');
    execute 'create or replace view public.attendance_v with (security_barrier = true, security_invoker = false) as ' || d;
  end if;
end $mig$;
