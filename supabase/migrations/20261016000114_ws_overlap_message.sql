-- Átfedő munkaidő elutasítása (2026-10-16, Daniel kérése): a hibaüzenet mondja meg, HOL és MIKOR dolgozott
-- az ember a megadott időszakban (helyszín, feladat kódja, időszak), hogy a vezető tudja, mit kell javítania.
do $$
declare v_def text;
  v_old text := E'    if exists (select 1 from public.work_sessions s\n               where s.worker_id = new.worker_id and s.id <> new.id and s.deleted_at is null\n                 and s.site_id is distinct from new.site_id\n                 and s.started_at < coalesce(new.ended_at, ''infinity''::timestamptz)\n                 and coalesce(s.ended_at, ''infinity''::timestamptz) > new.started_at) then\n      raise exception ''Ebben az időszakban másik helyszínen már van munkaideje — egyszerre egy helyen lehet.'';\n    end if;\n';
  v_new text := E'    declare v_c record; v_list text;\n    begin\n      select string_agg(\n               coalesce(si.name, ''ismeretlen helyszín'') || coalesce('' ('' || t.code || '')'', '''') || '' ''\n               || to_char(s.started_at at time zone ''Europe/Budapest'', ''MM.DD. HH24:MI'') || ''–''\n               || coalesce(to_char(s.ended_at at time zone ''Europe/Budapest'', ''HH24:MI''), ''még fut''),\n               ''; '' order by s.started_at)\n      into v_list\n      from public.work_sessions s\n      left join public.sites si on si.id = s.site_id\n      left join public.worker_tasks t on t.id = s.task_id\n      where s.worker_id = new.worker_id and s.id <> new.id and s.deleted_at is null\n        and s.site_id is distinct from new.site_id\n        and s.started_at < coalesce(new.ended_at, ''infinity''::timestamptz)\n        and coalesce(s.ended_at, ''infinity''::timestamptz) > new.started_at;\n      if v_list is not null then\n        raise exception ''Ebben az időszakban másik helyszínen már van munkaideje — egyszerre egy helyen lehet. Ütköző munkaidő: %'', v_list;\n      end if;\n    end;\n';
begin
  v_def := pg_get_functiondef('public.fn_ws_guard'::regproc);
  if position('Ütköző munkaidő' in v_def) > 0 then return; end if; -- már javítva
  if position(v_old in v_def) = 0 then raise exception 'fn_ws_guard: a várt szövegrész nem található'; end if;
  execute replace(v_def, v_old, v_new);
end $$;
