-- Feladathoz csatolt fotók (kiadáskor vagy utólag, a partner tölti fel).
-- A tárolóban a feladat azonosítója az első mappa: <task_id>/... — a
-- kiosztott munkavállaló ezeket olvashatja.

alter table public.worker_tasks add column if not exists photo_paths text[] not null default '{}';

drop policy if exists "tasks_read" on storage.objects;
create policy "tasks_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'tasks' and (
      public.fn_is_partner()
      or owner = auth.uid()
      or exists (
        select 1 from public.task_assignees a
        where a.worker_id = public.fn_my_worker_id() and a.deleted_at is null
          and a.task_id::text = (storage.foldername(name))[1]
      )
    )
  );
