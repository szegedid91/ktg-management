-- A munkavállaló csak a feladat visszaigazolása után indíthat rá munkaidőt
-- és rögzíthet hozzá anyagköltséget.

drop policy if exists ws_insert on public.work_sessions;
create policy ws_insert on public.work_sessions for insert to authenticated
  with check (created_by = auth.uid() and (
    public.fn_is_partner()
    or (worker_id = public.fn_my_worker_id() and (
      task_id is null
      or exists (
        select 1 from public.task_assignees a
        where a.task_id = work_sessions.task_id and a.worker_id = public.fn_my_worker_id()
          and a.deleted_at is null and a.acknowledged_at is not null)))));

drop policy if exists tm_insert on public.task_materials;
create policy tm_insert on public.task_materials for insert to authenticated
  with check (created_by = auth.uid() and (
    public.fn_is_partner()
    or (worker_id = public.fn_my_worker_id() and exists (
          select 1 from public.task_assignees a
          where a.task_id = task_materials.task_id and a.worker_id = public.fn_my_worker_id()
            and a.deleted_at is null and a.acknowledged_at is not null))));
