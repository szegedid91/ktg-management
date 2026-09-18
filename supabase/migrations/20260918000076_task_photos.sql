-- Munkafotók (előtte / utána) a feladathoz + számlafotó csak 100 000 Ft felett
-- kötelező (2026-09-18, Daniel kérése).
create table if not exists public.task_photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.worker_tasks(id),
  worker_id uuid references public.workers(id),
  kind text not null check (kind in ('before', 'after')),
  path text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_task_photos_task on public.task_photos(task_id);
create index if not exists idx_task_photos_worker on public.task_photos(worker_id);
create index if not exists idx_task_photos_created_by on public.task_photos(created_by);
create index if not exists idx_task_photos_updated on public.task_photos(updated_at);

alter table public.task_photos enable row level security;
grant select, insert on public.task_photos to authenticated;
grant update (deleted_at, updated_at) on public.task_photos to authenticated;

-- a munkavállaló csak a saját fotóit látja és kezeli (mint az anyagköltségnél); a vezető mindet
drop policy if exists tp_select on public.task_photos;
create policy tp_select on public.task_photos for select to authenticated
  using (public.fn_is_partner() or worker_id = public.fn_my_worker_id());
drop policy if exists tp_insert on public.task_photos;
create policy tp_insert on public.task_photos for insert to authenticated
  with check (created_by = (select auth.uid()) and (
    public.fn_is_partner()
    or (worker_id = public.fn_my_worker_id() and exists (
      select 1 from public.task_assignees a where a.task_id = task_photos.task_id
        and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null and a.acknowledged_at is not null))));
drop policy if exists tp_update on public.task_photos;
create policy tp_update on public.task_photos for update to authenticated
  using (public.fn_is_partner() or (worker_id = public.fn_my_worker_id() and created_by = (select auth.uid())))
  with check (public.fn_is_partner() or (worker_id = public.fn_my_worker_id() and created_by = (select auth.uid())));

drop trigger if exists trg_touch_task_photos on public.task_photos;
create trigger trg_touch_task_photos before insert or update on public.task_photos
  for each row execute function public.fn_touch_updated_at();
drop trigger if exists trg_audit_task_photos on public.task_photos;
create trigger trg_audit_task_photos after insert or delete or update on public.task_photos
  for each row execute function public.fn_audit();

-- anyagköltség: a számla / blokk fotója a munkavállalónál csak 100 000 Ft FELETT kötelező
create or replace function public.fn_task_material_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null and not public.fn_is_partner() then
    if tg_op = 'UPDATE' then
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
    end if;
    if new.amount is null or new.amount <= 0 then
      raise exception 'Az összegnek nullánál nagyobbnak kell lennie.';
    end if;
    if new.amount > 100000 and coalesce(cardinality(new.photo_paths), 0) = 0 and new.photo_path is null then
      raise exception '100 000 Ft feletti anyagköltséghez kötelező a számla fotója.';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.fn_task_material_guard() from public, anon, authenticated;
drop trigger if exists trg_task_material_guard on public.task_materials;
create trigger trg_task_material_guard before insert or update on public.task_materials
  for each row execute function public.fn_task_material_guard();
