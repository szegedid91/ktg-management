-- Építkezés elérhetőségei (2026-10-01, Daniel kérése): az építkezésnél a cím mellé elérhetőség is
-- megadható — akár több is (név, telefon, e-mail, megjegyzés). A vezetők írják; elérhetőségenként
-- eldönthető, hogy a munkavállaló is lássa-e (pl. a helyszíni kapcsolattartót igen, a pénzügyest nem).

create table if not exists public.site_contacts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  name text check (name is null or char_length(name) <= 120),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 200),
  note text check (note is null or char_length(note) <= 500),
  visible_to_workers boolean not null default true,
  position integer not null default 0,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint site_contacts_not_empty check (
    coalesce(btrim(name), '') <> '' or coalesce(btrim(phone), '') <> '' or coalesce(btrim(email), '') <> '')
);
create index if not exists site_contacts_site_idx on public.site_contacts(site_id);
create index if not exists site_contacts_updated_idx on public.site_contacts(updated_at);
create index if not exists site_contacts_created_by_idx on public.site_contacts(created_by);

drop trigger if exists trg_touch_site_contacts on public.site_contacts;
create trigger trg_touch_site_contacts before insert or update on public.site_contacts
  for each row execute function public.fn_touch_updated_at();
drop trigger if exists trg_audit_site_contacts on public.site_contacts;
create trigger trg_audit_site_contacts after insert or delete or update on public.site_contacts
  for each row execute function public.fn_audit();

alter table public.site_contacts enable row level security;
revoke all on public.site_contacts from public, anon;
grant select, insert, update on public.site_contacts to authenticated;

-- olvasás: a vezető mindet; a munkavállaló csak a neki szántakat, és csak olyan építkezésnél, amelyet
-- maga is lát (a sites táblára a saját olvasási szabálya érvényes)
drop policy if exists sc_select on public.site_contacts;
create policy sc_select on public.site_contacts for select to authenticated
  using (public.fn_is_partner() or (visible_to_workers and deleted_at is null and public.fn_my_worker_id() is not null
    and exists (select 1 from public.sites s where s.id = site_contacts.site_id)));
drop policy if exists sc_insert on public.site_contacts;
create policy sc_insert on public.site_contacts for insert to authenticated
  with check (public.fn_is_partner() and created_by = (select auth.uid()));
drop policy if exists sc_update on public.site_contacts;
create policy sc_update on public.site_contacts for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());

do $$ begin
  execute 'alter publication supabase_realtime add table public.site_contacts';
exception when duplicate_object then null; end $$;
