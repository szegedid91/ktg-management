-- Több feladat egyszerre (2026-09-22, Daniel kérése): a munkavállaló ugyanazon a munkaterületen
-- több feladaton is futtathat munkaidőt párhuzamosan. Másik munkaterületre indítás = átváltás
-- (a kliens lezárja az előzőt). A bér a nap átfedő munkameneteiből NEM duplázódik: a helyszín
-- napi óraszáma az időszakok egyesítése. A kiszállási díj helyszínenként és naponta egyszer jár
-- (mint eddig) — egy második feladat ugyanott nem visz újabb kiszállást.

-- 1) őr: egyszerre csak egy HELYSZÍNEN futhat munkaidő (ugyanott több feladat mehet)
do $mig$
declare d text := pg_get_functiondef('public.fn_ws_guard'::regproc);
  v_old text := E'      if exists (select 1 from public.work_sessions s where s.worker_id = new.worker_id and s.ended_at is null and s.deleted_at is null) then\n        raise exception ''Ennek a munkavállalónak már fut egy munkamenete.'';';
  v_new text := E'      if exists (select 1 from public.work_sessions s where s.worker_id = new.worker_id and s.ended_at is null and s.deleted_at is null\n                 and s.site_id is distinct from new.site_id) then\n        raise exception ''Másik munkaterületen még fut a munkaidőd — előbb zárd le, vagy válts át.'';';
begin
  if position('Másik munkaterületen még fut' in d) > 0 then return; end if;
  if position(v_old in d) = 0 then raise exception 'fn_ws_guard: a várt szövegrész nem található'; end if;
  execute replace(d, v_old, v_new);
end $mig$;

-- 2) bér: átfedő munkamenetek egyesítése (nem összeadás)
do $mig$
declare d text := pg_get_functiondef('public.fn_recalc_session_wage'::regproc);
  v_old text := E'  select coalesce(sum(extract(epoch from (s.ended_at - s.started_at)) / 3600.0), 0),\n         (array_agg(s.task_id) filter (where s.task_id is not null))[1]\n    into v_hours, v_task\n  from public.work_sessions s\n  left join public.worker_tasks t on t.id = s.task_id\n  where s.worker_id = p_worker and s.site_id = p_site and s.deleted_at is null\n    and s.ended_at is not null\n    and (s.started_at at time zone ''Europe/Budapest'')::date = p_date\n    and (t.id is null or t.quote_accepted_at is null);';
  v_new text := E'  -- párhuzamos feladatok: az átfedő időszakokat egyesítjük, hogy egy óra csak egyszer számítson\n  with s as (\n    select s.started_at, s.ended_at, s.task_id\n    from public.work_sessions s\n    left join public.worker_tasks t on t.id = s.task_id\n    where s.worker_id = p_worker and s.site_id = p_site and s.deleted_at is null\n      and s.ended_at is not null\n      and (s.started_at at time zone ''Europe/Budapest'')::date = p_date\n      and (t.id is null or t.quote_accepted_at is null)\n  ), o as (\n    select started_at, ended_at, task_id,\n           max(ended_at) over (order by started_at, ended_at rows between unbounded preceding and 1 preceding) as prev_end\n    from s\n  ), g as (\n    select *, sum(case when prev_end is null or started_at > prev_end then 1 else 0 end) over (order by started_at, ended_at) as grp from o\n  ), m as (\n    select min(started_at) st, max(ended_at) en from g group by grp\n  )\n  select coalesce((select sum(extract(epoch from (en - st)) / 3600.0) from m), 0),\n         (select task_id from s where task_id is not null order by started_at limit 1)\n    into v_hours, v_task;';
begin
  if position('párhuzamos feladatok' in d) > 0 then return; end if;
  if position(v_old in d) = 0 then raise exception 'fn_recalc_session_wage: a várt szövegrész nem található'; end if;
  execute replace(d, v_old, v_new);
end $mig$;
