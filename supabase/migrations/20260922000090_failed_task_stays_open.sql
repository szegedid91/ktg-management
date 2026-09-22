-- „Nem sikerült” feladat nyitva marad (2026-09-22, Daniel kérése): amíg a feladat
-- nem sikerültre van jelentve (pl. aznap nem volt eszköz), a munkavállaló továbbra
-- is látja, folytathatja (munkaidő, anyagköltség, fotó), és készre jelentheti.
-- Csak a KÉSZ (és a visszavont) feladat tűnik el neki.

-- 1) láthatóság: RLS a feladaton
drop policy if exists wt_select on public.worker_tasks;
create policy wt_select on public.worker_tasks for select to authenticated
  using (public.fn_is_partner() or (
    status in ('assigned', 'acknowledged', 'failed')
    and exists (select 1 from public.task_assignees a
                where a.task_id = worker_tasks.id and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null)));

-- 2) a „futó” feladatok halmaza (worker_tasks_v, részfeladatok, megjegyzések, ajánlatok, fájltároló erre épül)
create or replace function public.fn_my_active_task_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct a.task_id), '{}'::uuid[])
  from public.task_assignees a join public.worker_tasks t on t.id = a.task_id
  where a.worker_id = public.fn_my_worker_id() and a.deleted_at is null
    and t.deleted_at is null and t.status in ('assigned', 'acknowledged', 'failed');
$$;

-- 3) kész / nem sikerült művelet a nem sikerült feladaton is (készre jelentés lezárja; újabb indok felülírja)
do $$
declare v_def text; v_old text := E'  elsif p_action in (''done'', ''fail'') then\n    if v_task.status not in (''assigned'', ''acknowledged'') then';
begin
  v_def := pg_get_functiondef('public.worker_task_action(uuid,text,text,text,numeric,text[])'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'worker_task_action: a várt szövegrész nem található'; end if;
  v_def := replace(v_def, v_old, E'  elsif p_action in (''done'', ''fail'') then\n    if v_task.status not in (''assigned'', ''acknowledged'', ''failed'') then');
  v_def := replace(v_def, '''Feladat nem sikerült ⚠️''', '''Feladat nem sikerült ⚠️ (nyitva marad)''');
  execute v_def;
end $$;

-- 4) anyagköltség a nem sikerült feladaton is módosítható
do $$
declare v_def text; v_old text := 't.deleted_at is null and t.status in (''assigned'', ''acknowledged''))';
begin
  v_def := pg_get_functiondef('public.fn_task_material_guard()'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'fn_task_material_guard: a várt szövegrész nem található'; end if;
  execute replace(v_def, v_old, 't.deleted_at is null and t.status in (''assigned'', ''acknowledged'', ''failed''))');
end $$;
