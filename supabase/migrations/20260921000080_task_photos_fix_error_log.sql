-- 1) Munkafotók (előtte/utána) feltöltése 403-mal elbukott: a kliens upserttel
--    ment (INSERT … ON CONFLICT DO UPDATE), ami MINDEN oszlopra UPDATE jogot
--    kér, a 76-os migráció viszont csak (deleted_at, updated_at)-re adott.
--    Teljes UPDATE jog + őr-trigger: a munkavállaló a saját fotóján csak a
--    törlésjelzőt változtathatja, a többi mező rögzítés után nem írható át.
grant update on public.task_photos to authenticated;

create or replace function public.fn_task_photo_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.fn_is_partner() or auth.uid() is null then return new; end if;
  if new.task_id is distinct from old.task_id or new.worker_id is distinct from old.worker_id
     or new.kind is distinct from old.kind or new.path is distinct from old.path
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'A fotó adatai utólag nem módosíthatók.';
  end if;
  return new;
end $$;
revoke execute on function public.fn_task_photo_guard() from public, anon, authenticated;
drop trigger if exists trg_task_photo_guard on public.task_photos;
create trigger trg_task_photo_guard before update on public.task_photos
  for each row execute function public.fn_task_photo_guard();

-- 2) Hibanapló: bármelyik felhasználó appja ide jelenti a rendszert érintő
--    hibákat (szerver által elutasított művelet, feltöltési hiba, összeomlás).
--    Olvasni és törölni csak az admin tudja.
create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  user_name text,
  kind text not null,
  message text not null,
  detail jsonb,
  route text,
  app_version text,
  user_agent text
);
create index if not exists idx_client_errors_created on public.client_errors(created_at desc);

alter table public.client_errors enable row level security;
revoke all on public.client_errors from public, anon, authenticated;
grant insert, select, delete on public.client_errors to authenticated;

drop policy if exists ce_insert on public.client_errors;
create policy ce_insert on public.client_errors for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists ce_select on public.client_errors;
create policy ce_select on public.client_errors for select to authenticated
  using (public.fn_is_admin());
drop policy if exists ce_delete on public.client_errors;
create policy ce_delete on public.client_errors for delete to authenticated
  using (public.fn_is_admin());

-- a napló ne nőhessen korlátlanul: méretkorlát + 60 napnál régebbi sorok takarítása
create or replace function public.fn_client_error_trim()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  new.message := left(new.message, 2000);
  new.kind := left(new.kind, 40);
  new.route := left(new.route, 300);
  new.user_agent := left(new.user_agent, 300);
  new.user_name := left(new.user_name, 120);
  if new.detail is not null and length(new.detail::text) > 8000 then
    new.detail := jsonb_build_object('truncated', left(new.detail::text, 8000));
  end if;
  -- egy felhasználó óránként legfeljebb 60 hibát naplózhat
  if (select count(*) from public.client_errors e
      where e.user_id = new.user_id and e.created_at > now() - interval '1 hour') >= 60 then
    return null;
  end if;
  delete from public.client_errors where created_at < now() - interval '60 days';
  return new;
end $$;
revoke execute on function public.fn_client_error_trim() from public, anon, authenticated;
drop trigger if exists trg_client_error_trim on public.client_errors;
create trigger trg_client_error_trim before insert on public.client_errors
  for each row execute function public.fn_client_error_trim();
