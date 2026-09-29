-- Több munkavállalós feladat: a készre jelentés munkavállalónként történik (2026-09-29, Daniel kérése).
-- Ha egy feladat több emberre van kiosztva, és az egyik készre jelenti, csak az Ő része lesz kész
-- (task_assignees.done_at) — a feladat akkor lesz „kész”, amikor az összes kiosztott készre jelentette.
-- A vállalkozó a saját és az emberei részét egyszerre jelenti készre. Akinek a része kész, annál a
-- feladat eltűnik a futó feladatok közül. A vezető továbbra is lezárhatja az egész feladatot, és
-- az újranyitás mindenkinél visszaállítja.

alter table public.task_assignees add column if not exists done_at timestamptz;

-- a már kész feladatok kiosztottjai: a részük is kész (visszamenőleg)
update public.task_assignees a set done_at = coalesce(t.done_at, now())
from public.worker_tasks t
where t.id = a.task_id and t.status = 'done' and a.deleted_at is null and a.done_at is null;

-- a munkavállaló futó feladatai: a saját része még nincs kész
create or replace function public.fn_my_active_task_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct a.task_id), '{}'::uuid[])
  from public.task_assignees a join public.worker_tasks t on t.id = a.task_id
  where a.worker_id = public.fn_my_worker_id() and a.deleted_at is null and a.done_at is null
    and t.deleted_at is null and (t.status in ('assigned', 'acknowledged') or (t.status = 'failed' and t.closed_at is null));
$$;
revoke all on function public.fn_my_active_task_ids() from public, anon;
grant execute on function public.fn_my_active_task_ids() to authenticated;

drop policy if exists wt_select on public.worker_tasks;
create policy wt_select on public.worker_tasks for select to authenticated
  using (public.fn_is_partner() or ((status in ('assigned', 'acknowledged') or (status = 'failed' and closed_at is null))
    and exists (select 1 from public.task_assignees a where a.task_id = worker_tasks.id and a.worker_id = public.fn_my_worker_id()
                and a.deleted_at is null and a.done_at is null)));

-- munkaidő csak olyan feladatra indítható, amelyen a saját rész még nincs kész
drop policy if exists ws_insert on public.work_sessions;
create policy ws_insert on public.work_sessions for insert to authenticated
  with check (created_by = (select auth.uid()) and (public.fn_is_partner() or (
    worker_id = any(public.fn_my_worker_ids())
    and (task_id is null or exists (select 1 from public.task_assignees a where a.task_id = work_sessions.task_id
         and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null and a.acknowledged_at is not null and a.done_at is null)))));

-- worker_task_action 'done': a saját (és vállalkozónál az emberei) része lesz kész; a feladat csak akkor, ha mindenki kész
do $$
declare v_def text;
  v_old text := E'      update public.worker_tasks\n      set status = ''done'', done_at = now(), acknowledged_at = coalesce(acknowledged_at, now())\n      where id = p_id;\n      insert into public.notification_queue (kind, recipient, title, body, payload)\n      values (''task'', v_task.created_by, ''Feladat elkészült ✔️'',\n              coalesce(v_name, ''A munkavállaló'') || '' elkészült: '' || v_task.title,\n              jsonb_build_object(''task_id'', p_id));\n';
  v_new text := E'      update public.task_assignees set done_at = now()\n      where task_id = p_id and deleted_at is null and done_at is null and worker_id = any(public.fn_my_worker_ids());\n      select count(*) into v_pending from public.task_assignees\n      where task_id = p_id and deleted_at is null and done_at is null;\n      if v_pending = 0 then\n        update public.worker_tasks\n        set status = ''done'', done_at = now(), acknowledged_at = coalesce(acknowledged_at, now())\n        where id = p_id;\n        insert into public.notification_queue (kind, recipient, title, body, payload)\n        values (''task'', v_task.created_by, ''Feladat elkészült ✔️'',\n                coalesce(v_name, ''A munkavállaló'') || '' elkészült: '' || v_task.title,\n                jsonb_build_object(''task_id'', p_id));\n      else\n        insert into public.notification_queue (kind, recipient, title, body, payload)\n        values (''task'', v_task.created_by, ''Részben kész ✔'',\n                coalesce(v_name, ''A munkavállaló'') || '' a saját részével elkészült: '' || v_task.title\n                || '' — még '' || v_pending || '' fő dolgozik rajta'',\n                jsonb_build_object(''task_id'', p_id));\n      end if;\n';
begin
  v_def := pg_get_functiondef('public.worker_task_action(uuid,text,text,text,numeric,text[])'::regprocedure);
  if position('a saját részével elkészült' in v_def) > 0 then return; end if; -- már javítva
  if position(v_old in v_def) = 0 then raise exception 'worker_task_action: a várt szövegrész (done) nem található'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- a feladat és a kiosztottak összhangja: a vezető készre állítja → mindenki része kész;
-- újranyitás (kész/visszavont/nem sikerült → futó) → mindenkinél újra nyitva
create or replace function public.fn_task_assignee_done_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- ha az állapotváltást épp a kiosztottak összesítése (rollup) okozta, nem írunk vissza rájuk
  if current_setting('app.assignee_rollup', true) = 'on' then return null; end if;
  perform set_config('app.task_done_sync', 'on', true);
  if new.status = 'done' and old.status is distinct from 'done' then
    update public.task_assignees set done_at = coalesce(new.done_at, now())
    where task_id = new.id and deleted_at is null and done_at is null;
  elsif new.status in ('assigned', 'acknowledged') and old.status in ('done', 'cancelled') then
    update public.task_assignees set done_at = null where task_id = new.id and deleted_at is null and done_at is not null;
  end if;
  perform set_config('app.task_done_sync', 'off', true);
  return null;
end $$;
revoke all on function public.fn_task_assignee_done_sync() from public, anon, authenticated;
drop trigger if exists trg_task_assignee_done_sync on public.worker_tasks;
create trigger trg_task_assignee_done_sync after update of status on public.worker_tasks
  for each row execute function public.fn_task_assignee_done_sync();

-- a kiosztottak része és a feladat állapota: minden élő kiosztott kész → a feladat kész; ha a vezető egy
-- ember részét visszaállítja (done_at törlése), a kész feladat visszanyílik — csak annál az embernél
create or replace function public.fn_task_assignee_done_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_t public.worker_tasks%rowtype; v_open integer; v_any integer;
begin
  -- ha a változást épp a feladat állapotváltása (sync) okozta, nem írunk vissza a feladatra
  if current_setting('app.task_done_sync', true) = 'on' then return null; end if;
  select * into v_t from public.worker_tasks where id = new.task_id;
  if v_t.id is null or v_t.deleted_at is not null then return null; end if;
  select count(*) filter (where done_at is null), count(*) into v_open, v_any
  from public.task_assignees where task_id = new.task_id and deleted_at is null;
  perform set_config('app.assignee_rollup', 'on', true);
  if v_t.status in ('assigned', 'acknowledged') and v_any > 0 and v_open = 0 then
    update public.worker_tasks set status = 'done', done_at = now() where id = new.task_id;
  elsif v_t.status = 'done' and v_open > 0 and new.done_at is null and old.done_at is not null then
    update public.worker_tasks set status = 'acknowledged', done_at = null, closed_at = null where id = new.task_id;
  end if;
  perform set_config('app.assignee_rollup', 'off', true);
  return null;
end $$;
revoke all on function public.fn_task_assignee_done_rollup() from public, anon, authenticated;
drop trigger if exists trg_task_assignee_done_rollup on public.task_assignees;
create trigger trg_task_assignee_done_rollup after update of done_at on public.task_assignees
  for each row execute function public.fn_task_assignee_done_rollup();

-- esemény-napló: „X készre jelentette a saját részét” (csak amíg a feladat egésze nincs kész)
create or replace function public.fn_task_assignee_event_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, kind, worker_id, actor_user_id, at) values (new.task_id, 'assigned', new.worker_id, auth.uid(), new.created_at);
    if new.acknowledged_at is not null then
      insert into public.task_events (task_id, kind, worker_id, actor_user_id, at) values (new.task_id, 'accepted', new.worker_id, auth.uid(), new.acknowledged_at);
    end if;
    return new;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    insert into public.task_events (task_id, kind, worker_id, actor_user_id) values (new.task_id, 'unassigned', new.worker_id, auth.uid());
  elsif new.deleted_at is null and old.deleted_at is not null then
    insert into public.task_events (task_id, kind, worker_id, actor_user_id) values (new.task_id, 'assigned', new.worker_id, auth.uid());
  end if;
  if new.acknowledged_at is not null and old.acknowledged_at is null and new.deleted_at is null then
    insert into public.task_events (task_id, kind, worker_id, actor_user_id, at) values (new.task_id, 'accepted', new.worker_id, auth.uid(), new.acknowledged_at);
  end if;
  if new.done_at is not null and old.done_at is null and new.deleted_at is null
     and exists (select 1 from public.worker_tasks t where t.id = new.task_id and t.status <> 'done') then
    insert into public.task_events (task_id, kind, worker_id, actor_user_id, at) values (new.task_id, 'part_done', new.worker_id, auth.uid(), new.done_at);
  end if;
  return new;
end $$;
revoke all on function public.fn_task_assignee_event_log() from public, anon, authenticated;
