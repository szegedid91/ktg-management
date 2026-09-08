-- Munkavállaló csak a rá tartozó adatokat lássa:
--  1) a feladat kiszámlázott értéke → task_finance (csak partner)
--  2) az anyagköltség továbbszámlázási ára → task_material_pricing (csak partner)
--  3) építkezések: csak ahol feladata / jelenléte / munkaideje van
--  4) profilok: a sajátja + a fő felhasználók (más munkavállalóé nem)

-- a szerep-függvények RLS-t megkerülve olvasnak, hogy a profiles
-- szabályában is hívhatók legyenek rekurzió nélkül
create or replace function public.fn_is_partner()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and worker_id is null);
$$;
create or replace function public.fn_my_worker_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select worker_id from public.profiles where id = auth.uid();
$$;

-- ---------- 1) feladat pénzügye ----------
create table if not exists public.task_finance (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.worker_tasks(id) on delete cascade,
  invoice_net numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.task_finance enable row level security;
drop policy if exists tf_select on public.task_finance;
create policy tf_select on public.task_finance for select to authenticated using (public.fn_is_partner());
drop policy if exists tf_insert on public.task_finance;
create policy tf_insert on public.task_finance for insert to authenticated with check (public.fn_is_partner());
drop policy if exists tf_update on public.task_finance;
create policy tf_update on public.task_finance for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());
drop trigger if exists trg_touch_task_finance on public.task_finance;
create trigger trg_touch_task_finance before insert or update on public.task_finance
  for each row execute function public.fn_touch_updated_at();

insert into public.task_finance (task_id, invoice_net)
select id, invoice_net from public.worker_tasks where invoice_net is not null
on conflict (task_id) do nothing;
alter table public.worker_tasks drop column if exists invoice_net;

-- ---------- 2) anyagköltség beárazása ----------
create table if not exists public.task_material_pricing (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null unique references public.task_materials(id) on delete cascade,
  resale_net numeric not null check (resale_net >= 0),
  resale_by uuid references public.profiles(id),
  resale_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.task_material_pricing enable row level security;
drop policy if exists tmp_select on public.task_material_pricing;
create policy tmp_select on public.task_material_pricing for select to authenticated using (public.fn_is_partner());
drop policy if exists tmp_insert on public.task_material_pricing;
create policy tmp_insert on public.task_material_pricing for insert to authenticated with check (public.fn_is_partner());
drop policy if exists tmp_update on public.task_material_pricing;
create policy tmp_update on public.task_material_pricing for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());
drop trigger if exists trg_touch_task_material_pricing on public.task_material_pricing;
create trigger trg_touch_task_material_pricing before insert or update on public.task_material_pricing
  for each row execute function public.fn_touch_updated_at();

insert into public.task_material_pricing (material_id, resale_net, resale_by, resale_at)
select id, resale_net, resale_by, coalesce(resale_at, now()) from public.task_materials where resale_net is not null
on conflict (material_id) do nothing;
alter table public.task_materials
  drop column if exists resale_net, drop column if exists resale_by, drop column if exists resale_at;

-- ---------- 3) építkezések ----------
drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites for select to authenticated
  using (
    public.fn_is_partner()
    or exists (select 1 from public.task_assignees a join public.worker_tasks t on t.id = a.task_id
               where a.worker_id = public.fn_my_worker_id() and a.deleted_at is null and t.site_id = sites.id)
    or exists (select 1 from public.attendance x where x.worker_id = public.fn_my_worker_id() and x.site_id = sites.id)
    or exists (select 1 from public.work_sessions w where w.worker_id = public.fn_my_worker_id() and w.site_id = sites.id)
  );

-- ---------- 4) profilok ----------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or worker_id is null or public.fn_is_partner());

-- realtime
do $$
declare t text;
begin
  foreach t in array array['task_finance', 'task_material_pricing']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
