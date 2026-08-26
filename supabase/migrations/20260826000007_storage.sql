-- =============================================================
-- Fázis 1 — Privát Storage bucketek: számlafotók, eszközfotók
-- Elérés csak bejelentkezve, signed URL-lel.
-- =============================================================

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false), ('equipment', 'equipment', false)
on conflict (id) do nothing;

create policy "receipts_read" on storage.objects for select to authenticated
  using (bucket_id in ('receipts', 'equipment'));

create policy "receipts_insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('receipts', 'equipment'));

create policy "receipts_update" on storage.objects for update to authenticated
  using (bucket_id in ('receipts', 'equipment') and owner = auth.uid());

create policy "receipts_delete" on storage.objects for delete to authenticated
  using (bucket_id in ('receipts', 'equipment') and owner = auth.uid());
