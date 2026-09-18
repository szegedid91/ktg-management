-- Megjegyzések csak elfogadott feladatnál (2026-09-18, Daniel kérése):
-- a munkavállaló a feladat megjegyzéseit csak akkor látja és írhatja, ha a
-- feladatot már elfogadta (task_assignees.acknowledged_at kitöltve).
drop policy if exists tn_select on public.task_notes;
create policy tn_select on public.task_notes for select to authenticated
  using (public.fn_is_partner() or (visible_to_workers and exists (
    select 1 from public.task_assignees a where a.task_id = task_notes.task_id
      and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null and a.acknowledged_at is not null)));
drop policy if exists tn_insert on public.task_notes;
create policy tn_insert on public.task_notes for insert to authenticated
  with check (created_by = (select auth.uid()) and (
    public.fn_is_partner()
    or (visible_to_workers and exists (
      select 1 from public.task_assignees a where a.task_id = task_notes.task_id
        and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null and a.acknowledged_at is not null))));
