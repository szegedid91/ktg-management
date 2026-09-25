-- Készre jelentés visszavonása (2026-09-25, Daniel kérése): a vezető a kész feladatot
-- visszaküldheti a munkavállalóhoz (status → assigned/acknowledged, done_at → null; a kliens írja).
-- Itt csak az értesítés: a kiosztott munkavállalók fiókja üzenetet kap, hogy a feladat újra nyitva.
create or replace function public.fn_notify_task_reopened()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_site text;
begin
  if old.status in ('done', 'failed', 'cancelled') and new.status in ('assigned', 'acknowledged') then
    select name into v_site from public.sites where id = new.site_id;
    for r in select p.id as profile_id from public.task_assignees a join public.profiles p on p.worker_id = a.worker_id
             where a.task_id = new.id and a.deleted_at is null
    loop
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('task', r.profile_id, 'Feladat újranyitva ↩',
              coalesce(new.code || ' — ', '') || new.title || coalesce(' · ' || v_site, '')
              || ' — a vezető visszavonta a lezárást, a feladat újra nálad van.',
              jsonb_build_object('task_id', new.id));
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.fn_notify_task_reopened() from public, anon, authenticated;
drop trigger if exists trg_notify_task_reopened on public.worker_tasks;
create trigger trg_notify_task_reopened after update of status on public.worker_tasks
  for each row execute function public.fn_notify_task_reopened();
