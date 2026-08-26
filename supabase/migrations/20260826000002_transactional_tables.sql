-- =============================================================
-- Fázis 1–2 — Tranzakcionális táblák: költségek, jelenlét,
-- kommentek, kimenő számlák, elszámolások, eszközök
-- =============================================================

-- ---------- Költségek ----------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  paid_by uuid not null references public.profiles(id) default auth.uid(),
  expense_date date not null default current_date,
  title text,
  net_amount numeric(14,2) not null default 0,
  vat_rate numeric(5,2) not null default 27,
  vat_amount numeric(14,2) not null default 0,
  gross_amount numeric(14,2) not null default 0,
  category_id uuid references public.expense_categories(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index ix_expenses_site_date on public.expenses (site_id, expense_date) where deleted_at is null;
create index ix_expenses_date on public.expenses (expense_date) where deleted_at is null;

-- ---------- Számlafotók ----------
create table public.expense_photos (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  storage_path text not null,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index ix_expense_photos_expense on public.expense_photos (expense_id);

-- ---------- Jelenlét / naptár ----------
-- pay_basis:
--   hourly   – órabér × óraszám
--   daily    – napi díj × szorzó (0.5 = fél nap)
--   project  – projektdíj egyszeri terhelése (a rögzítés napján)
--   presence – díj nélküli jelenlét-jelölés (projektdíjas munkás napjai)
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  site_id uuid not null references public.sites(id),
  worker_id uuid not null references public.workers(id),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  pay_basis text not null check (pay_basis in ('hourly','daily','project','presence')),
  hours numeric(5,2) check (hours is null or hours > 0),
  day_multiplier numeric(3,2) not null default 1 check (day_multiplier > 0),
  -- díj-pillanatkép rögzítéskor; kliens által küldött felülírás vagy trigger tölti
  applied_rate numeric(14,2),
  amount numeric(14,2) not null default 0,            -- teljes bérköltség (közvetítői résszel együtt)
  commission_amount numeric(14,2) not null default 0, -- ebből a közvetítőé
  referrer_user_id uuid references public.profiles(id),
  referrer_external_id uuid references public.external_people(id),
  paid_at timestamptz,
  paid_by uuid references public.profiles(id),
  commission_paid_at timestamptz,
  commission_paid_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (pay_basis <> 'hourly' or hours is not null)
);
create index ix_attendance_date on public.attendance (work_date) where deleted_at is null;
create index ix_attendance_site_date on public.attendance (site_id, work_date) where deleted_at is null;
create index ix_attendance_worker on public.attendance (worker_id, work_date) where deleted_at is null;

-- Díj- és jutalék-számítás pillanatképe rögzítéskor / módosításkor
create or replace function public.fn_attendance_compute()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  w public.workers%rowtype;
  s public.app_settings%rowtype;
  v_rate numeric(14,2);
begin
  select * into w from public.workers where id = new.worker_id;
  select * into s from public.app_settings where id = 1;

  -- díj feloldása: tétel-felülírás > munkavállalói díj > globális alapértelmezés
  if new.applied_rate is null then
    if new.pay_basis = 'hourly' then
      v_rate := coalesce(w.hourly_rate, case when w.worker_type = 'company' then s.company_hourly_rate else s.individual_hourly_rate end);
    elsif new.pay_basis = 'daily' then
      v_rate := coalesce(w.daily_rate, case when w.worker_type = 'company' then s.company_daily_rate else s.individual_daily_rate end);
    elsif new.pay_basis = 'project' then
      v_rate := coalesce(w.project_rate, case when w.worker_type = 'company' then s.company_project_rate else s.individual_project_rate end);
    else
      v_rate := 0;
    end if;
    new.applied_rate := v_rate;
  end if;

  -- bérköltség
  new.amount := case new.pay_basis
    when 'hourly'  then round(new.applied_rate * coalesce(new.hours, 0), 2)
    when 'daily'   then round(new.applied_rate * new.day_multiplier, 2)
    when 'project' then new.applied_rate
    else 0
  end;

  -- közvetítő pillanatkép a munkavállalóról (csak ha a tételen még nincs)
  if new.referrer_user_id is null and new.referrer_external_id is null then
    new.referrer_user_id := w.referrer_user_id;
    new.referrer_external_id := w.referrer_external_id;
  end if;

  -- közvetítői díj: a bérköltség RÉSZE (osztódik, nem adódik hozzá)
  new.commission_amount := 0;
  if (new.referrer_user_id is not null or new.referrer_external_id is not null)
     and w.commission_mode is not null and new.pay_basis <> 'presence' then
    if w.commission_mode = 'percent' then
      new.commission_amount := round(new.amount * coalesce(w.commission_value, 0) / 100.0, 2);
    else -- fix összeg
      new.commission_amount := case w.commission_unit
        when 'hour'    then round(coalesce(w.commission_value, 0) * coalesce(new.hours, 0), 2)
        when 'day'     then round(coalesce(w.commission_value, 0) * new.day_multiplier, 2)
        when 'project' then case when new.pay_basis = 'project' then coalesce(w.commission_value, 0) else 0 end
        else 0
      end;
    end if;
    new.commission_amount := least(new.commission_amount, new.amount);
  end if;

  return new;
end;
$$;

create trigger trg_attendance_compute
  before insert or update of pay_basis, hours, day_multiplier, applied_rate, worker_id
  on public.attendance
  for each row execute function public.fn_attendance_compute();

-- ---------- Kommentek (polimorf) ----------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('site','expense','worker','attendance','invoice','equipment','settlement')),
  entity_id uuid not null,
  author_id uuid not null references public.profiles(id) default auth.uid(),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index ix_comments_entity on public.comments (entity_type, entity_id, created_at);

-- ---------- Kimenő számlák / bevétel ----------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  invoice_date date not null default current_date,
  invoiced_at date,               -- számlázva dátum
  title text,
  net_amount numeric(14,2) not null default 0,
  vat_rate numeric(5,2) not null default 27,
  vat_amount numeric(14,2) not null default 0,
  gross_amount numeric(14,2) not null default 0,
  paid_at date,                   -- befolyt dátum
  paid_marked_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index ix_invoices_site on public.invoices (site_id) where deleted_at is null;
create index ix_invoices_date on public.invoices (invoice_date) where deleted_at is null;

-- ---------- Elszámolások (egyenleg-rendezés) ----------
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id),
  to_user uuid not null references public.profiles(id),
  amount numeric(14,2) not null check (amount > 0),
  settle_date date not null default current_date,
  note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (from_user <> to_user)
);

-- ---------- Eszközök ----------
create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  photo_path text,
  note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.equipment_moves (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  site_id uuid references public.sites(id),  -- null = raktár / "nálam"
  location_label text,                       -- pl. "Raktár", "Nálam"
  taken_by text,                             -- ki vitte el
  moved_at timestamptz not null default now(),
  note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index ix_equipment_moves_eq on public.equipment_moves (equipment_id, moved_at desc);

-- ---------- updated_at triggerek ----------
do $$
declare t text;
begin
  foreach t in array array['expenses','expense_photos','attendance','comments','invoices','settlements','equipment','equipment_moves']
  loop
    execute format('create trigger trg_touch_%I before update on public.%I for each row execute function public.fn_touch_updated_at()', t, t);
  end loop;
end;
$$;

-- ---------- Lezárt építkezés írásvédelme ----------
create or replace function public.fn_check_site_open()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_site uuid;
  v_status text;
begin
  v_site := coalesce(
    case when tg_op = 'DELETE' then old.site_id else new.site_id end,
    case when tg_op <> 'INSERT' then old.site_id end
  );
  if v_site is null then
    return coalesce(new, old);
  end if;
  select status into v_status from public.sites where id = v_site;
  if v_status = 'closed' then
    -- kivétel: kifizetés / befolyt pipa lezárt építkezésen is állítható
    if tg_op = 'UPDATE' and current_setting('app.allow_paid_tick', true) = 'on' then
      return new;
    end if;
    raise exception 'A(z) építkezés le van zárva, csak olvasható. Nyisd újra a módosításhoz.';
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['expenses','attendance','invoices','equipment_moves']
  loop
    execute format('create trigger trg_site_open_%I before insert or update or delete on public.%I for each row execute function public.fn_check_site_open()', t, t);
  end loop;
end;
$$;

-- ---------- Realtime a kommentekhez ----------
alter publication supabase_realtime add table public.comments;
