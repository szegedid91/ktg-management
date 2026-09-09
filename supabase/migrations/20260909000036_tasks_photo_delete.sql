-- Feladat-fotó törlése a tárolóból: partner, vagy a feltöltő
drop policy if exists "tasks_delete" on storage.objects;
create policy "tasks_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'tasks' and (public.fn_is_partner() or owner = auth.uid()));
