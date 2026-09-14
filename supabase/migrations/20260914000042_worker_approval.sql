-- Munkavállalói regisztráció jóváhagyása: a meghívóval regisztrált fiók addig
-- nem lát semmit (RLS), amíg egy fő felhasználó jóvá nem hagyja — a jóváhagyás
-- előtt a partner ellenőrzi/megerősíti a díjazást.

alter table public.workers
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null;

-- a már meglévő munkavállalók jóváhagyottnak számítanak
update public.workers set approved_at = coalesce(approved_at, created_at) where approved_at is null;

-- fő felhasználó által felvett munkavállaló azonnal jóváhagyott;
-- a meghívós regisztrációnál (auth-trigger, auth.uid() üres) függőben marad
create or replace function public.fn_workers_default_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.approved_at is null and auth.uid() is not null
     and exists (select 1 from public.profiles where id = auth.uid() and worker_id is null) then
    new.approved_at := now();
    new.approved_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists trg_workers_default_approval on public.workers;
create trigger trg_workers_default_approval before insert on public.workers
  for each row execute function public.fn_workers_default_approval();

-- RLS-kapu: a munkavállalói azonosító csak jóváhagyott, nem törölt
-- munkavállalónál él → minden „saját adat” policy automatikusan zár
create or replace function public.fn_my_worker_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select p.worker_id from public.profiles p
  join public.workers w on w.id = p.worker_id
  where p.id = auth.uid() and w.approved_at is not null and w.deleted_at is null;
$$;

-- a fiók saját státusza (a függő munkavállaló a saját sorát sem látja)
create or replace function public.my_worker_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'status', case when w.id is null then 'none'
                     when w.deleted_at is not null then 'rejected'
                     when w.approved_at is null then 'pending'
                     else 'approved' end,
      'name', w.name)
    from public.profiles p left join public.workers w on w.id = p.worker_id
    where p.id = auth.uid()
  ), '{"status":"none"}'::jsonb);
$$;
revoke all on function public.my_worker_status() from public, anon;
grant execute on function public.my_worker_status() to authenticated;

-- jóváhagyás (fő felhasználó): a munkavállaló értesítést kap
create or replace function public.approve_worker(p_worker uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_prof uuid;
begin
  if not public.fn_is_partner() then raise exception 'Csak fő felhasználó hagyhat jóvá.'; end if;
  update public.workers set approved_at = now(), approved_by = auth.uid(), updated_at = now()
   where id = p_worker and deleted_at is null and approved_at is null;
  if not found then raise exception 'A munkavállaló nem található vagy már jóvá van hagyva.'; end if;
  select id into v_prof from public.profiles where worker_id = p_worker;
  if v_prof is not null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('worker_approved', v_prof, 'Regisztrációd jóváhagyva ✅',
            'Mostantól beléphetsz és láthatod a rád kiosztott feladatokat.',
            jsonb_build_object('worker_id', p_worker));
  end if;
end $$;
revoke all on function public.approve_worker(uuid) from public, anon;
grant execute on function public.approve_worker(uuid) to authenticated;

-- elutasítás: a munkavállaló-sor törölve, a fiók „elutasítva” állapotot lát
create or replace function public.reject_worker(p_worker uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_prof uuid;
begin
  if not public.fn_is_partner() then raise exception 'Csak fő felhasználó utasíthat el.'; end if;
  update public.workers set deleted_at = now(), updated_at = now()
   where id = p_worker and deleted_at is null and approved_at is null;
  if not found then raise exception 'A munkavállaló nem található vagy már jóvá van hagyva.'; end if;
  select id into v_prof from public.profiles where worker_id = p_worker;
  if v_prof is not null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('worker_rejected', v_prof, 'Regisztrációd elutasítva',
            'A fő felhasználók nem hagyták jóvá a regisztrációdat. Kérdezz rá náluk.',
            jsonb_build_object('worker_id', p_worker));
  end if;
end $$;
revoke all on function public.reject_worker(uuid) from public, anon;
grant execute on function public.reject_worker(uuid) to authenticated;

-- új regisztráció értesítése: jóváhagyásra vár
create or replace function public.fn_notify_worker_joined()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare r record; v_name text;
begin
  if new.worker_id is null then return new; end if;
  select coalesce(nickname, name) into v_name from public.workers where id = new.worker_id;
  for r in select id from public.profiles where worker_id is null loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('worker_joined', r.id, 'Új munkavállaló vár jóváhagyásra 👷',
            coalesce(v_name, new.display_name) || ' regisztrált (' || coalesce(new.email, '') ||
            '). Nézd át a díjazását és hagyd jóvá, hogy be tudjon lépni.',
            jsonb_build_object('worker_id', new.worker_id));
  end loop;
  return new;
end;
$$;

alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check
  check (kind in ('comment','big_expense','weekly','overdue','share_change','site_deleted','task','material',
                  'worker_joined','worker_approved','worker_rejected'));

-- függő regisztrációt bármelyik fő felhasználó szerkeszthet (díjazás beállítása
-- jóváhagyás előtt), nem csak a meghívó létrehozója
drop policy if exists workers_update on public.workers;
create policy workers_update on public.workers for update to authenticated
  using (created_by = auth.uid() or (public.fn_is_partner() and approved_at is null))
  with check (created_by = auth.uid() or (public.fn_is_partner() and approved_at is null));
