-- =============================================================
-- Munkavállalói fiókok, meghívók, feladatok és munkaidő
--  1) profiles.worker_id: fiók ↔ munkavállaló kapcsolat; a partner
--     (worker_id nélküli profil) lát mindent, a munkavállaló csak a
--     sajátját (jelenlét, feladat, munkaidő) — pénzügyet SOHA.
--  2) worker_invites: meghívó-token (link vagy QR) — a token a zárt
--     regisztráció kapuján is átenged, és a fiókot a munkavállalóhoz köti.
--  3) worker_tasks: kiadott feladat (kód, cím, részletek, helyszín);
--     a munkavállaló köteles visszaigazolni; ha nem tudja megcsinálni,
--     kötelező indoklás + opcionális fotó.
--  4) work_sessions: a munkavállaló rögzíti, mikor kezdte és fejezte be.
--  5) RLS-szigorítás: pénzügyi táblák csak partnernek.
-- =============================================================

-- ---------- 1) fiók ↔ munkavállaló ----------
alter table public.profiles add column if not exists worker_id uuid references public.workers(id);
create unique index if not exists uq_profiles_worker on public.profiles(worker_id) where worker_id is not null;

create or replace function public.fn_is_partner()
returns boolean language sql stable set search_path to 'public' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and worker_id is null);
$$;

create or replace function public.fn_my_worker_id()
returns uuid language sql stable set search_path to 'public' as $$
  select worker_id from public.profiles where id = auth.uid();
$$;

-- ---------- 2) meghívók ----------
create table if not exists public.worker_invites (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  token text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by uuid references public.profiles(id)
);
alter table public.worker_invites enable row level security;
drop policy if exists wi_select on public.worker_invites;
create policy wi_select on public.worker_invites for select to authenticated
  using (public.fn_is_partner());
-- írás csak a definer RPC-n át

create or replace function public.create_worker_invite(p_worker uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_token text;
begin
  if auth.uid() is null or not public.fn_is_partner() then
    raise exception 'Meghívót csak a fő felhasználók készíthetnek.';
  end if;
  if not exists (select 1 from public.workers where id = p_worker and deleted_at is null) then
    raise exception 'A munkavállaló nem található.';
  end if;
  if exists (select 1 from public.profiles where worker_id = p_worker) then
    raise exception 'Ehhez a munkavállalóhoz már tartozik fiók.';
  end if;

  select token into v_token from public.worker_invites
  where worker_id = p_worker and used_at is null and expires_at > now()
  order by created_at desc limit 1;
  if v_token is not null then return v_token; end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.worker_invites (worker_id, token, created_by)
  values (p_worker, v_token, auth.uid());
  return v_token;
end;
$$;

-- ---------- regisztrációs kapu: meghívó-ág + partner-számlálás javítása ----------
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
  v_partner_count integer;
  v_admin boolean;
  v_token text;
  v_invite record;
  v_worker_name text;
begin
  -- meghívóval érkező munkavállaló: a zárt kapu nem vonatkozik rá
  v_token := new.raw_user_meta_data->>'invite_token';
  if v_token is not null and v_token <> '' then
    select * into v_invite from public.worker_invites
    where token = v_token and used_at is null and expires_at > now();
    if not found then
      raise exception 'A meghívó érvénytelen vagy lejárt. Kérj újat a fő felhasználóktól!';
    end if;
    if exists (select 1 from public.profiles where worker_id = v_invite.worker_id) then
      raise exception 'Ehhez a munkavállalóhoz már tartozik fiók.';
    end if;
    select name into v_worker_name from public.workers where id = v_invite.worker_id;
    insert into public.profiles (id, email, display_name, profit_share_percent, is_admin, worker_id,
                                 notify_comments, notify_big_expense, notify_weekly, notify_overdue)
    values (new.id, new.email,
            coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), v_worker_name, split_part(new.email, '@', 1)),
            0, false, v_invite.worker_id, false, false, false, false);
    update public.worker_invites set used_at = now(), used_by = new.id where id = v_invite.id;
    return new;
  end if;

  select count(*) into v_count from public.profiles;
  if v_count > 0 and not exists (
    select 1 from public.allowed_emails where email = lower(new.email)
  ) then
    raise exception 'Zárt alkalmazás: ez az e-mail cím nincs engedélyezve. Kérj hozzáférést a tulajdonosoktól.';
  end if;

  select coalesce(ae.is_admin, false) into v_admin
  from public.allowed_emails ae where ae.email = lower(new.email);
  v_admin := coalesce(v_admin, false);

  select count(*) into v_partner_count from public.profiles where not is_admin and worker_id is null;

  insert into public.profiles (id, email, display_name, profit_share_percent, is_admin)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when v_admin then 0 when v_partner_count = 0 then 100 else 0 end,
    v_admin
  );
  return new;
end;
$$;

-- ---------- 3) feladatok ----------
create table if not exists public.worker_tasks (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  site_id uuid references public.sites(id),
  code text,
  title text not null,
  details text,
  status text not null default 'assigned'
    check (status in ('assigned', 'acknowledged', 'done', 'failed', 'cancelled')),
  acknowledged_at timestamptz,
  done_at timestamptz,
  fail_reason text,
  fail_photo_path text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists ix_tasks_worker on public.worker_tasks (worker_id, status);

alter table public.worker_tasks enable row level security;
drop policy if exists wt_select on public.worker_tasks;
create policy wt_select on public.worker_tasks for select to authenticated
  using (public.fn_is_partner() or worker_id = public.fn_my_worker_id());
drop policy if exists wt_insert on public.worker_tasks;
create policy wt_insert on public.worker_tasks for insert to authenticated
  with check (public.fn_is_partner() and created_by = auth.uid());
drop policy if exists wt_update on public.worker_tasks;
create policy wt_update on public.worker_tasks for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());
-- a munkavállaló státuszt csak a worker_task_action RPC-n át állít

drop trigger if exists trg_touch_worker_tasks on public.worker_tasks;
create trigger trg_touch_worker_tasks before insert or update on public.worker_tasks
  for each row execute function public.fn_touch_updated_at();
drop trigger if exists trg_audit_worker_tasks on public.worker_tasks;
create trigger trg_audit_worker_tasks after insert or update or delete on public.worker_tasks
  for each row execute function public.fn_audit();

-- munkavállalói állapot-váltás: visszaigazolás / kész / nem sikerült
create or replace function public.worker_task_action(
  p_id uuid, p_action text, p_reason text default null, p_photo_path text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_wid uuid := public.fn_my_worker_id();
  v_task public.worker_tasks%rowtype;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;
  select * into v_task from public.worker_tasks
  where id = p_id and deleted_at is null for update;
  if not found then raise exception 'A feladat nem található.'; end if;
  if v_wid is null or v_task.worker_id <> v_wid then
    raise exception 'Ez a feladat nem hozzád tartozik.';
  end if;

  select name into v_name from public.workers where id = v_wid;

  if p_action = 'acknowledge' then
    if v_task.status <> 'assigned' then raise exception 'Ez a feladat már vissza van igazolva.'; end if;
    update public.worker_tasks
    set status = 'acknowledged', acknowledged_at = now() where id = p_id;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Feladat visszaigazolva ✅',
            coalesce(v_name, 'A munkavállaló') || ' megkapta és csinálja: ' || v_task.title,
            jsonb_build_object('task_id', p_id));
  elsif p_action = 'done' then
    if v_task.status not in ('assigned', 'acknowledged') then
      raise exception 'Ez a feladat már le van zárva.';
    end if;
    update public.worker_tasks
    set status = 'done', done_at = now(),
        acknowledged_at = coalesce(acknowledged_at, now())
    where id = p_id;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Feladat elkészült ✔️',
            coalesce(v_name, 'A munkavállaló') || ' elkészült: ' || v_task.title,
            jsonb_build_object('task_id', p_id));
  elsif p_action = 'fail' then
    if v_task.status not in ('assigned', 'acknowledged') then
      raise exception 'Ez a feladat már le van zárva.';
    end if;
    if p_reason is null or length(trim(p_reason)) < 3 then
      raise exception 'Kötelező megindokolni, miért nem sikerült a feladat.';
    end if;
    update public.worker_tasks
    set status = 'failed', done_at = now(), fail_reason = trim(p_reason),
        fail_photo_path = p_photo_path,
        acknowledged_at = coalesce(acknowledged_at, now())
    where id = p_id;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Feladat nem sikerült ⚠️',
            coalesce(v_name, 'A munkavállaló') || ': ' || v_task.title
            || ' — indok: ' || trim(p_reason),
            jsonb_build_object('task_id', p_id));
  else
    raise exception 'Ismeretlen művelet.';
  end if;
end;
$$;

-- új feladat kiadásakor a munkavállaló kap értesítést
create or replace function public.fn_notify_task_assigned()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_profile uuid;
  v_site text;
begin
  select id into v_profile from public.profiles where worker_id = new.worker_id;
  if v_profile is null then return new; end if;
  select name into v_site from public.sites where id = new.site_id;
  insert into public.notification_queue (kind, recipient, title, body, payload)
  values ('task', v_profile, 'Új feladat 🛠️',
          coalesce(new.code || ' — ', '') || new.title
          || coalesce(' · Helyszín: ' || v_site, '')
          || ' — igazold vissza az appban!',
          jsonb_build_object('task_id', new.id));
  return new;
end;
$$;
drop trigger if exists trg_notify_task_assigned on public.worker_tasks;
create trigger trg_notify_task_assigned after insert on public.worker_tasks
  for each row execute function public.fn_notify_task_assigned();

-- ---------- 4) munkaidő (kezdés / befejezés) ----------
create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  site_id uuid references public.sites(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists ix_sessions_worker on public.work_sessions (worker_id, started_at desc);

alter table public.work_sessions enable row level security;
drop policy if exists ws_select on public.work_sessions;
create policy ws_select on public.work_sessions for select to authenticated
  using (public.fn_is_partner() or worker_id = public.fn_my_worker_id());
drop policy if exists ws_insert on public.work_sessions;
create policy ws_insert on public.work_sessions for insert to authenticated
  with check (created_by = auth.uid()
    and (public.fn_is_partner() or worker_id = public.fn_my_worker_id()));
drop policy if exists ws_update on public.work_sessions;
create policy ws_update on public.work_sessions for update to authenticated
  using (public.fn_is_partner() or worker_id = public.fn_my_worker_id())
  with check (public.fn_is_partner() or worker_id = public.fn_my_worker_id());

drop trigger if exists trg_touch_work_sessions on public.work_sessions;
create trigger trg_touch_work_sessions before insert or update on public.work_sessions
  for each row execute function public.fn_touch_updated_at();
drop trigger if exists trg_audit_work_sessions on public.work_sessions;
create trigger trg_audit_work_sessions after insert or update or delete on public.work_sessions
  for each row execute function public.fn_audit();

-- ---------- feladat-fotók tárolója ----------
insert into storage.buckets (id, name, public) values ('tasks', 'tasks', false)
on conflict (id) do nothing;
drop policy if exists "tasks_read" on storage.objects;
create policy "tasks_read" on storage.objects for select to authenticated
  using (bucket_id = 'tasks' and (public.fn_is_partner() or owner = auth.uid()));
drop policy if exists "tasks_insert" on storage.objects;
create policy "tasks_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'tasks');

-- ---------- 5) RLS-szigorítás: pénzügy csak partnernek ----------
do $$
declare t text;
begin
  foreach t in array array[
    'expenses', 'expense_photos', 'invoices', 'settlements', 'equipment',
    'equipment_moves', 'external_people', 'comments', 'app_settings'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.fn_is_partner())', t, t);
  end loop;
end $$;

-- jelenlét: a munkavállaló a sajátját látja
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (public.fn_is_partner() or worker_id = public.fn_my_worker_id());

-- munkavállalók: a munkavállaló a saját sorát látja
drop policy if exists workers_select on public.workers;
create policy workers_select on public.workers for select to authenticated
  using (public.fn_is_partner() or id = public.fn_my_worker_id());

-- részesedés-táblák és audit: csak partner
drop policy if exists psh_select on public.profit_share_history;
create policy psh_select on public.profit_share_history for select to authenticated
  using (public.fn_is_partner());
drop policy if exists scr_select on public.share_change_requests;
create policy scr_select on public.share_change_requests for select to authenticated
  using (public.fn_is_partner());
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (public.fn_is_partner());

-- számla-/eszközfotók olvasása: csak partner
drop policy if exists "receipts_read" on storage.objects;
create policy "receipts_read" on storage.objects for select to authenticated
  using (bucket_id in ('receipts', 'equipment') and public.fn_is_partner());

-- ---------- partner-definíció javítása a részesedés-folyamatban ----------
create or replace function public.fn_validate_shares(p_shares jsonb)
returns void
language plpgsql stable set search_path to 'public'
as $$
declare
  v_sum numeric;
  r record;
begin
  select sum((e->>'percent')::numeric) into v_sum
  from jsonb_array_elements(p_shares) e;
  if v_sum is distinct from 100 then
    raise exception 'A részesedések összege 100%% kell legyen (jelenleg: %%%)', v_sum;
  end if;
  if (select count(*) from jsonb_array_elements(p_shares))
     <> (select count(*) from public.profiles where not is_admin and worker_id is null) then
    raise exception 'Minden felhasználóhoz meg kell adni a részesedést.';
  end if;
  for r in select (e->>'user_id')::uuid as user_id, (e->>'percent')::numeric as percent
           from jsonb_array_elements(p_shares) e
  loop
    if r.percent is null or r.percent < 0 or r.percent > 100 then
      raise exception 'Érvénytelen részesedés-érték.';
    end if;
    if not exists (select 1 from public.profiles where id = r.user_id and not is_admin and worker_id is null) then
      raise exception 'Ismeretlen felhasználó a részesedések között.';
    end if;
  end loop;
end;
$$;

create or replace function public.propose_profit_shares(p_shares jsonb)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_others integer;
begin
  if v_me is null then raise exception 'Bejelentkezés szükséges.'; end if;
  if not public.fn_is_partner() then raise exception 'Csak a fő felhasználók módosíthatnak részesedést.'; end if;
  perform public.fn_validate_shares(p_shares);

  if exists (select 1 from public.share_change_requests
             where status = 'pending' and deleted_at is null) then
    raise exception 'Már van függőben lévő módosítási javaslat. Előbb azt kell jóváhagyni, elutasítani vagy visszavonni.';
  end if;

  select count(*) into v_others
  from public.profiles where not is_admin and worker_id is null and id <> v_me;

  if v_others = 0 then
    insert into public.share_change_requests
      (proposed_by, shares, status, effective_from, decided_by, decided_at)
    values (v_me, p_shares, 'approved', current_date, v_me, now());
    perform public.fn_apply_shares(p_shares, current_date);
    return 'approved';
  end if;

  insert into public.share_change_requests (proposed_by, shares)
  values (v_me, p_shares);
  return 'pending';
end;
$$;

create or replace function public.decide_share_change(p_id uuid, p_approve boolean)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_req public.share_change_requests%rowtype;
begin
  if v_me is null then raise exception 'Bejelentkezés szükséges.'; end if;

  select * into v_req from public.share_change_requests
  where id = p_id and deleted_at is null for update;
  if not found then raise exception 'A javaslat nem található.'; end if;
  if v_req.status <> 'pending' then
    raise exception 'Ez a javaslat már el lett bírálva.';
  end if;

  if v_me = v_req.proposed_by then
    if p_approve then
      raise exception 'A saját javaslatodat nem hagyhatod jóvá — a másik fél beleegyezése kell.';
    end if;
    update public.share_change_requests
    set status = 'cancelled', decided_by = v_me, decided_at = now()
    where id = p_id;
    return 'cancelled';
  end if;

  if not exists (select 1 from public.profiles where id = v_me and not is_admin and worker_id is null) then
    raise exception 'A jóváhagyáshoz üzleti partnernek kell lenned.';
  end if;

  if p_approve then
    perform public.fn_validate_shares(v_req.shares);
    update public.share_change_requests
    set status = 'approved', effective_from = current_date,
        decided_by = v_me, decided_at = now()
    where id = p_id;
    perform public.fn_apply_shares(v_req.shares, current_date);
    return 'approved';
  else
    update public.share_change_requests
    set status = 'rejected', decided_by = v_me, decided_at = now()
    where id = p_id;
    return 'rejected';
  end if;
end;
$$;

-- értesítés-címzettek: csak partnerek (a munkavállaló nem)
create or replace function public.fn_notify_share_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_proposer text;
  v_summary text;
  r record;
begin
  select display_name into v_proposer from public.profiles where id = new.proposed_by;
  select string_agg(p.display_name || ' ' || round((e->>'percent')::numeric) || '%', ' · ')
    into v_summary
  from jsonb_array_elements(new.shares) e
  join public.profiles p on p.id = (e->>'user_id')::uuid;

  if tg_op = 'INSERT' and new.status = 'pending' then
    for r in
      select id from public.profiles
      where not is_admin and worker_id is null and id <> new.proposed_by
    loop
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('share_change', r.id, 'Részesedés-módosítási javaslat 🤝',
              coalesce(v_proposer, 'A partnered') || ' új felosztást javasol: '
              || coalesce(v_summary, '') || ' — a te jóváhagyásod kell.',
              jsonb_build_object('request_id', new.id));
    end loop;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved', 'rejected') then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('share_change', new.proposed_by,
            case when new.status = 'approved'
              then 'Részesedés jóváhagyva ✅'
              else 'Részesedés-javaslat elutasítva' end,
            case when new.status = 'approved'
              then 'Az új felosztás (' || coalesce(v_summary, '') || ') a mai naptól érvényes.'
              else 'A javasolt felosztást (' || coalesce(v_summary, '') || ') a másik fél elutasította.' end,
            jsonb_build_object('request_id', new.id));
  end if;
  return new;
end;
$$;

create or replace function public.delete_site(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
  v_deleter text;
  r record;
begin
  if v_me is null then raise exception 'Bejelentkezés szükséges.'; end if;
  if not public.fn_is_partner() then
    raise exception 'Építkezést csak a fő felhasználók törölhetnek.';
  end if;

  select name into v_name from public.sites where id = p_id and deleted_at is null;
  if v_name is null then raise exception 'Az építkezés nem található.'; end if;

  update public.sites set deleted_at = now(), updated_at = now() where id = p_id;

  select display_name into v_deleter from public.profiles where id = v_me;
  for r in
    select id from public.profiles
    where not is_admin and worker_id is null and id <> v_me
  loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('site_deleted', r.id, 'Építkezés törölve 🗑️',
            coalesce(v_deleter, 'A partnered') || ' törölte a(z) „' || v_name
            || '” építkezést. A hozzá tartozó költségek és bevételek 30 napig még megmaradnak és beleszámítanak az elszámolásba, utána véglegesen törlődnek.',
            jsonb_build_object('site_id', p_id));
  end loop;
end;
$$;

create or replace function public.fn_notify_big_expense()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_name text;
begin
  select display_name into v_name from public.profiles where id = new.created_by;
  for r in
    select id, big_expense_threshold from public.profiles
    where id <> new.created_by and notify_big_expense and worker_id is null
      and new.net_amount >= big_expense_threshold
  loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('big_expense', r.id, 'Nagy költés 💸',
            coalesce(v_name, 'A partnered') || ' rögzített: ' || coalesce(new.title, 'költség')
            || ' — ' || to_char(new.net_amount, 'FM999 999 999') || ' Ft (nettó)',
            jsonb_build_object('expense_id', new.id));
  end loop;
  return new;
end;
$$;

-- ---------- egyenleg-nézet: munkavállaló nem szerepel benne ----------
create or replace view public.v_user_balances
with (security_invoker = true) as
select
  p.id as user_id,
  p.display_name,
  p.profit_share_percent,
  round(
      coalesce((select sum(i.net_amount * public.share_at(p.id, i.paid_at) / 100.0)
                from public.invoices i
                where i.deleted_at is null and i.paid_at is not null), 0)
    - coalesce((select sum(e.net_amount * public.share_at(p.id, e.expense_date) / 100.0)
                from public.expenses e
                where e.deleted_at is null), 0)
    - coalesce((select sum(a.amount * public.share_at(p.id, a.work_date) / 100.0)
                from public.attendance a
                where a.deleted_at is null), 0)
  , 2) as profit_share_amount,
  coalesce(se.spent_expenses, 0::numeric) as spent_expenses,
  coalesce(sw.spent_wages, 0::numeric) as spent_wages,
  coalesce(sc.spent_commissions, 0::numeric) as spent_commissions,
  coalesce(so.settlements_out, 0::numeric) as settlements_out,
  coalesce(cc.commission_credit, 0::numeric) as commission_credit,
  coalesce(ri.received_invoices, 0::numeric) as received_invoices,
  coalesce(si.settlements_in, 0::numeric) as settlements_in,
  round(
      coalesce((select sum(i.net_amount * public.share_at(p.id, i.paid_at) / 100.0)
                from public.invoices i
                where i.deleted_at is null and i.paid_at is not null), 0)
    - coalesce((select sum(e.net_amount * public.share_at(p.id, e.expense_date) / 100.0)
                from public.expenses e
                where e.deleted_at is null), 0)
    - coalesce((select sum(a.amount * public.share_at(p.id, a.work_date) / 100.0)
                from public.attendance a
                where a.deleted_at is null), 0)
  , 2)
    + coalesce(se.spent_expenses, 0::numeric)
    + coalesce(sw.spent_wages, 0::numeric)
    + coalesce(sc.spent_commissions, 0::numeric)
    + coalesce(so.settlements_out, 0::numeric)
    + coalesce(cc.commission_credit, 0::numeric)
    - coalesce(ri.received_invoices, 0::numeric)
    - coalesce(si.settlements_in, 0::numeric) as balance
from public.profiles p
left join (
  select paid_by as uid, sum(net_amount) as spent_expenses
  from public.expenses where deleted_at is null group by paid_by
) se on se.uid = p.id
left join (
  select paid_by as uid, sum(amount - commission_amount) as spent_wages
  from public.attendance where deleted_at is null and paid_at is not null group by paid_by
) sw on sw.uid = p.id
left join (
  select commission_paid_by as uid, sum(commission_amount) as spent_commissions
  from public.attendance
  where deleted_at is null and referrer_external_id is not null and commission_paid_at is not null
  group by commission_paid_by
) sc on sc.uid = p.id
left join (
  select from_user as uid, sum(amount) as settlements_out
  from public.settlements where deleted_at is null group by from_user
) so on so.uid = p.id
left join (
  select referrer_user_id as uid, sum(commission_amount) as commission_credit
  from public.attendance where deleted_at is null and referrer_user_id is not null
  group by referrer_user_id
) cc on cc.uid = p.id
left join (
  select coalesce(paid_marked_by, created_by) as uid, sum(net_amount) as received_invoices
  from public.invoices where deleted_at is null and paid_at is not null
  group by coalesce(paid_marked_by, created_by)
) ri on ri.uid = p.id
left join (
  select to_user as uid, sum(amount) as settlements_in
  from public.settlements where deleted_at is null group by to_user
) si on si.uid = p.id
-- a fn_is_partner() a hívóra értékelődik ki (security_invoker): munkavállaló
-- egyáltalán nem lát sort
where not p.is_admin and p.worker_id is null and public.fn_is_partner();

-- ---------- értesítés-fajta + realtime ----------
alter table public.notification_queue drop constraint notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check
  check (kind in ('comment', 'big_expense', 'weekly', 'overdue', 'share_change', 'site_deleted', 'task'));

do $$
declare t text;
begin
  foreach t in array array['worker_tasks', 'work_sessions']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
