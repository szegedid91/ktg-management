-- Munkavállaló a saját anyagköltség-tételét módosíthatja (2026-09-18, Daniel
-- kérése): összeg, megjegyzés, fotók (egyesével törölhet). Korlátok:
--  - csak a saját (worker_id = én) tétel, amíg a feladat aktív
--  - amíg a vezető nem árazta be (task_material_pricing sor nincs)
--  - legalább egy fotó mindig marad (a munkavállalónál a fotó kötelező)
--  - a tétel más mezőit (feladat, munkavállaló, rögzítő, törlés) nem írhatja
drop policy if exists tm_update on public.task_materials;
create policy tm_update on public.task_materials for update to authenticated
  using (public.fn_is_partner() or (worker_id = public.fn_my_worker_id() and deleted_at is null))
  with check (public.fn_is_partner() or (worker_id = public.fn_my_worker_id() and deleted_at is null));

create or replace function public.fn_task_material_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null and not public.fn_is_partner() then
    if new.task_id <> old.task_id or new.worker_id is distinct from old.worker_id
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at
       or new.deleted_at is distinct from old.deleted_at then
      raise exception 'Az anyagköltségnek csak az összegét, megjegyzését és fotóit módosíthatod.';
    end if;
    if exists (select 1 from public.task_material_pricing p where p.material_id = new.id) then
      raise exception 'Ezt a tételt a vezető már beárazta — módosítást tőle kérj.';
    end if;
    if not exists (select 1 from public.worker_tasks t where t.id = new.task_id and t.deleted_at is null and t.status in ('assigned', 'acknowledged')) then
      raise exception 'Lezárt feladat anyagköltsége már nem módosítható.';
    end if;
    if coalesce(cardinality(new.photo_paths), 0) = 0 and new.photo_path is null then
      raise exception 'Legalább egy fotó (számla / blokk) kell maradjon.';
    end if;
    if new.amount is null or new.amount <= 0 then
      raise exception 'Az összegnek nullánál nagyobbnak kell lennie.';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.fn_task_material_guard() from public, anon, authenticated;
drop trigger if exists trg_task_material_guard on public.task_materials;
create trigger trg_task_material_guard before update on public.task_materials
  for each row execute function public.fn_task_material_guard();
