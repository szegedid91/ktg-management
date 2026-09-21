-- A munkavállaló (nem csak a vállalkozó embere) a lezárt — készre jelölt, nem sikerült,
-- visszavont — feladatot már nem látja; csak a rá osztott, futó feladatait (2026-09-21, Daniel kérése).
drop policy if exists wt_select on public.worker_tasks;
create policy wt_select on public.worker_tasks for select to authenticated
  using (public.fn_is_partner() or (
    status in ('assigned', 'acknowledged')
    and exists (select 1 from public.task_assignees a
                where a.task_id = worker_tasks.id and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null)));
