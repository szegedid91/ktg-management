-- Feladat kiosztásának módosítása a feladat oldalán: levételkor a munkavállaló
-- értesítést kap; újra hozzáadáskor (törölt sor visszaállítása) ugyanúgy, mint
-- első kiosztáskor (az insert-trigger frissítésnél nem fut).

create or replace function public.fn_notify_assignee_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_profile uuid;
  v_task public.worker_tasks%rowtype;
begin
  select id into v_profile from public.profiles where worker_id = new.worker_id;
  if v_profile is null then return new; end if;
  select * into v_task from public.worker_tasks where id = new.task_id;
  if old.deleted_at is null and new.deleted_at is not null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_profile, 'Levettek egy feladatról',
            coalesce(v_task.code || ' — ', '') || v_task.title || ' — a fő felhasználók másra osztották. A rögzített munkaidőd megmarad.',
            jsonb_build_object('task_id', new.task_id));
  elsif old.deleted_at is not null and new.deleted_at is null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_profile,
            case when v_task.quote_requested then 'Ajánlatkérés 💬' else 'Új feladat 🛠️' end,
            coalesce(v_task.code || ' — ', '') || v_task.title
            || case when v_task.quote_requested then ' — adj ajánlatot az appban!' else ' — igazold vissza az appban!' end,
            jsonb_build_object('task_id', new.task_id));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_assignee_change on public.task_assignees;
create trigger trg_notify_assignee_change after update of deleted_at on public.task_assignees
  for each row execute function public.fn_notify_assignee_change();
