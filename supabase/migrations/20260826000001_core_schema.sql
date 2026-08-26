-- =============================================================
-- Fázis 1 — Alapséma: profilok, beállítások, építkezések,
-- munkavállalók, kategóriák, külsős közvetítők
-- =============================================================
create extension if not exists pgcrypto;

-- ---------- Felhasználói profilok ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text,
  profit_share_percent numeric(5,2) not null default 50 check (profit_share_percent >= 0 and profit_share_percent <= 100),
  -- push beállítások
  push_token text,
  notify_comments boolean not null default true,
  notify_big_expense boolean not null default true,
  big_expense_threshold numeric(14,2) not null default 100000,
  notify_weekly boolean not null default true,
  notify_overdue boolean not null default true,
  overdue_days integer not null default 14,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Regisztrációkor automatikus profil, egyenlő részesedés-újraosztással
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  -- alapértelmezés: egyenlő elosztás minden felhasználó között
  select count(*) into v_count from public.profiles;
  update public.profiles set profit_share_percent = round(100.0 / v_count, 2);
  -- kerekítési maradék az első felhasználóhoz
  update public.profiles p
     set profit_share_percent = profit_share_percent + (100 - (select sum(profit_share_percent) from public.profiles))
   where p.id = (select id from public.profiles order by created_at limit 1);
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();

-- ---------- Globális beállítások (singleton) ----------
create table public.app_settings (
  id integer primary key default 1 check (id = 1),
  -- alapértelmezett díjak: céges munkavállaló
  company_hourly_rate numeric(14,2) not null default 0,
  company_daily_rate numeric(14,2) not null default 0,
  company_project_rate numeric(14,2) not null default 0,
  -- alapértelmezett díjak: magánszemély
  individual_hourly_rate numeric(14,2) not null default 0,
  individual_daily_rate numeric(14,2) not null default 0,
  individual_project_rate numeric(14,2) not null default 0,
  -- alapértelmezett kimenő (kiszámlázott) díjak
  out_hourly_rate numeric(14,2) not null default 0,
  out_daily_rate numeric(14,2) not null default 0,
  out_project_rate numeric(14,2) not null default 0,
  default_vat_rate numeric(5,2) not null default 27,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1);

-- ---------- Költségkategóriák ----------
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_builtin boolean not null default false,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index uq_expense_categories_name on public.expense_categories (lower(name)) where deleted_at is null;

insert into public.expense_categories (name, is_builtin) values
  ('Anyag', true), ('Szerszám', true), ('Üzemanyag', true),
  ('Alvállalkozói díj', true), ('Egyéb', true);

-- ---------- Építkezések ----------
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  note text,
  status text not null default 'active' check (status in ('active','closed')),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- Külsős személyek (közvetítők, akik nem felhasználók) ----------
create table public.external_people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- Munkavállalók ----------
create table public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phones text[] not null default '{}',
  email text,
  company_name text,
  tax_number text,
  hq_address text,
  bank_account_enc bytea, -- pgcrypto-val titkosítva, csak RPC-n át érhető el
  note text,
  worker_type text not null default 'individual' check (worker_type in ('company','individual')),
  is_vat_payer boolean not null default false,
  vat_rate numeric(5,2) not null default 27,
  default_pay_basis text check (default_pay_basis in ('hourly','daily','project')),
  -- díj-felülírások; null = globális alapértelmezés öröklése
  hourly_rate numeric(14,2),
  daily_rate numeric(14,2),
  project_rate numeric(14,2),
  -- közvetítő: felhasználó VAGY külsős személy
  referrer_user_id uuid references public.profiles(id),
  referrer_external_id uuid references public.external_people(id),
  commission_mode text check (commission_mode in ('percent','fixed')),
  commission_value numeric(14,2),
  commission_unit text check (commission_unit in ('hour','day','project')),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (referrer_user_id is null or referrer_external_id is null)
);

-- ---------- updated_at automatika ----------
create or replace function public.fn_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','app_settings','expense_categories','sites','external_people','workers']
  loop
    execute format('create trigger trg_touch_%I before update on public.%I for each row execute function public.fn_touch_updated_at()', t, t);
  end loop;
end;
$$;
