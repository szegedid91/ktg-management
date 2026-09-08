-- Munkavállaló csak elkezdett (munkaidővel rendelkező) feladatot jelölhet késznek.

create or replace function public.worker_task_action(
  p_id uuid, p_action text, p_reason text default null, p_photo_path text default null,
  p_amount numeric default null, p_photo_paths text[] default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_wid uuid := public.fn_my_worker_id();
  v_task public.worker_tasks%rowtype;
  v_name text;
  v_pending integer;
  v_paths text[];
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;
  select * into v_task from public.worker_tasks
  where id = p_id and deleted_at is null for update;
  if not found then raise exception 'A feladat nem található.'; end if;
  if v_wid is null or not exists (
    select 1 from public.task_assignees where task_id = p_id and worker_id = v_wid and deleted_at is null
  ) then
    raise exception 'Ez a feladat nem hozzád tartozik.';
  end if;

  select coalesce(nickname, name) into v_name from public.workers where id = v_wid;

  if p_action = 'acknowledge' then
    update public.task_assignees set acknowledged_at = coalesce(acknowledged_at, now())
    where task_id = p_id and worker_id = v_wid;
    select count(*) into v_pending from public.task_assignees
    where task_id = p_id and deleted_at is null and acknowledged_at is null;
    if v_pending = 0 and v_task.status = 'assigned' then
      update public.worker_tasks set status = 'acknowledged', acknowledged_at = now() where id = p_id;
    end if;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Feladat elfogadva ✅',
            coalesce(v_name, 'A munkavállaló') || ' elfogadta a feladatot: ' || v_task.title,
            jsonb_build_object('task_id', p_id));

  elsif p_action = 'quote' then
    if p_amount is null or p_amount <= 0 then raise exception 'Adj meg ajánlati összeget.'; end if;
    update public.worker_tasks
    set quote_amount = p_amount, quote_note = nullif(trim(coalesce(p_reason, '')), ''),
        quote_submitted_at = now(), quote_accepted_at = null, quote_accepted_by = null
    where id = p_id;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Ajánlat érkezett 💬',
            coalesce(v_name, 'A munkavállaló') || ' ajánlata: ' || trim(to_char(p_amount, 'FM999 999 999'))
            || ' Ft — ' || v_task.title || ' (fogadd el az appban)',
            jsonb_build_object('task_id', p_id));

  elsif p_action = 'done' then
    if v_task.status not in ('assigned', 'acknowledged') then
      raise exception 'Ez a feladat már le van zárva.';
    end if;
    if not exists (
      select 1 from public.work_sessions
      where task_id = p_id and worker_id = v_wid and deleted_at is null
    ) then
      raise exception 'A feladat csak akkor jelölhető késznek, ha előtte elindítottad rajta a munkát.';
    end if;
    update public.worker_tasks
    set status = 'done', done_at = now(), acknowledged_at = coalesce(acknowledged_at, now())
    where id = p_id;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Feladat elkészült ✔️',
            coalesce(v_name, 'A munkavállaló') || ' elkészült: ' || v_task.title,
            jsonb_build_object('task_id', p_id));

  elsif p_action = 'fail' then
    if v_task.status not in ('assigned', 'acknowledged') then
      raise exception 'Ez a feladat már le van zárva.';
    end if;
    if p_reason is null or length(trim(p_reason)) < 3 then
      raise exception 'Kötelező megindokolni, miért nem sikerült a feladat.';
    end if;
    v_paths := coalesce(p_photo_paths, case when p_photo_path is null then '{}'::text[] else array[p_photo_path] end);
    update public.worker_tasks
    set status = 'failed', done_at = now(), fail_reason = trim(p_reason),
        fail_photo_path = v_paths[1], fail_photo_paths = v_paths,
        acknowledged_at = coalesce(acknowledged_at, now())
    where id = p_id;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Feladat nem sikerült ⚠️',
            coalesce(v_name, 'A munkavállaló') || ': ' || v_task.title
            || ' — indok: ' || trim(p_reason)
            || case when cardinality(v_paths) > 0 then ' (' || cardinality(v_paths) || ' fotó)' else '' end,
            jsonb_build_object('task_id', p_id));
  else
    raise exception 'Ismeretlen művelet.';
  end if;
end;
$$;
