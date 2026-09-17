-- Több főre kiosztott feladatnál a munkavállalók egymás közt is írhatnak
-- megjegyzést (mindig látható a kiosztottaknak és a fő felhasználóknak);
-- a sajátjukat szerkeszthetik/törölhetik. A szerző nem kap értesítést,
-- a többi kiosztott és — munkavállalói megjegyzésnél — a fő felhasználók igen.

drop policy if exists tn_insert on public.task_notes;
create policy tn_insert on public.task_notes for insert to authenticated
  with check (created_by = auth.uid() and (
    public.fn_is_partner()
    or (visible_to_workers and exists (
      select 1 from public.task_assignees a where a.task_id = task_notes.task_id
        and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null))));
drop policy if exists tn_update on public.task_notes;
create policy tn_update on public.task_notes for update to authenticated
  using (public.fn_is_partner() or created_by = auth.uid())
  with check (public.fn_is_partner() or (created_by = auth.uid() and visible_to_workers));

create or replace function public.fn_notify_task_note()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_task public.worker_tasks%rowtype; v_author text; v_is_worker boolean;
begin
  if new.deleted_at is not null or not new.visible_to_workers then return new; end if;
  if tg_op = 'UPDATE' and old.visible_to_workers and old.deleted_at is null and old.body = new.body then return new; end if;
  select * into v_task from public.worker_tasks where id = new.task_id;
  select coalesce(w.nickname, w.name, p.display_name), p.worker_id is not null
    into v_author, v_is_worker
  from public.profiles p left join public.workers w on w.id = p.worker_id where p.id = new.created_by;
  for r in select p.id from public.task_assignees a join public.profiles p on p.worker_id = a.worker_id
           where a.task_id = new.task_id and a.deleted_at is null and p.id <> new.created_by
  loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', r.id, 'Megjegyzés a feladathoz 📝',
            coalesce(v_task.code || ' — ', '') || v_task.title || ' · ' || coalesce(v_author, '?') || ': ' || left(new.body, 140),
            jsonb_build_object('task_id', new.task_id));
  end loop;
  if v_is_worker then
    perform public.fn_notify_partners('task', 'Munkavállalói megjegyzés 📝',
      coalesce(v_task.code || ' — ', '') || v_task.title || ' · ' || coalesce(v_author, '?') || ': ' || left(new.body, 140),
      jsonb_build_object('task_id', new.task_id));
  end if;
  return new;
end $$;
