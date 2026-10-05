-- Vállalkozó készre jelentése (2026-10-05, Daniel: „ha többen vannak 1 munkán és 1 készre jelenti,
-- a másik embernek is a kész munkába rakja”). Eddig a vállalkozó „kész” jelentése az ÖSSZES emberének
-- a részét is késznek vette — azét is, akinek saját fiókja van, és maga jelenti a sajátját (pl. még el
-- sem fogadta a feladatot). Mostantól a vállalkozó a saját részét jelenti, és csak azokét az embereiét,
-- akiknek nincs saját fiókjuk (ők maguk nem tudnák). Ugyanez a szabály, mint a visszaigazolásnál.
do $$
declare v_def text;
  v_old text := E'      update public.task_assignees set done_at = now()\n      where task_id = p_id and deleted_at is null and done_at is null and worker_id = any(public.fn_my_worker_ids());\n';
  v_new text := E'      -- a saját részem; vállalkozónál azoké az embereké is, akiknek nincs saját fiókjuk (ők maguk nem tudják jelenteni)\n      update public.task_assignees a set done_at = now()\n      where a.task_id = p_id and a.deleted_at is null and a.done_at is null\n        and (a.worker_id = v_wid or (a.worker_id = any(public.fn_my_worker_ids())\n             and not exists (select 1 from public.profiles p where p.worker_id = a.worker_id)));\n';
begin
  v_def := pg_get_functiondef('public.worker_task_action(uuid,text,text,text,numeric,text[])'::regprocedure);
  if position('akiknek nincs saját fiókjuk' in v_def) > 0 then return; end if; -- már javítva
  if position(v_old in v_def) = 0 then raise exception 'worker_task_action: a várt szövegrész (done) nem található'; end if;
  execute replace(v_def, v_old, v_new);
end $$;
