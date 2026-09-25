-- Elavult feladat-értesítések takarítása (2026-09-25, Daniel: a dnl4 teszt-fiók 🔔 listája törölt
-- feladatokat mutatott). Ha a feladat törlődik, a hozzá tartozó értesítések törlődnek (mindenkinél);
-- ha valakit levesznek a feladatról, az ő korábbi feladat-értesítései törlődnek (a „Levettek…” marad).
create or replace function public.fn_notification_cleanup_task()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.notification_queue set deleted_at = now()
    where deleted_at is null and payload->>'task_id' = new.id::text;
  end if;
  return new;
end $$;
revoke all on function public.fn_notification_cleanup_task() from public, anon, authenticated;
drop trigger if exists trg_zz_notification_cleanup_task on public.worker_tasks;
create trigger trg_zz_notification_cleanup_task after update of deleted_at on public.worker_tasks
  for each row execute function public.fn_notification_cleanup_task();

create or replace function public.fn_notification_cleanup_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.notification_queue n set deleted_at = now()
    from public.profiles p
    where n.deleted_at is null and n.payload->>'task_id' = new.task_id::text
      and p.worker_id = new.worker_id and n.recipient = p.id and n.title not like 'Levettek%';
  end if;
  return new;
end $$;
revoke all on function public.fn_notification_cleanup_assignee() from public, anon, authenticated;
drop trigger if exists trg_zz_notification_cleanup_assignee on public.task_assignees;
create trigger trg_zz_notification_cleanup_assignee after update of deleted_at on public.task_assignees
  for each row execute function public.fn_notification_cleanup_assignee();

-- visszamenőleg: törölt feladatok értesítései
update public.notification_queue n set deleted_at = now()
from public.worker_tasks t
where n.deleted_at is null and t.id::text = n.payload->>'task_id' and t.deleted_at is not null;
