-- Anyagköltség mennyiségi egysége listából (2026-11-17, Daniel kérése): az „Egység” mezőben listából lehet
-- választani (az alap egységek az appban vannak: db, méter, m², …); ha valami nincs benne, a felhasználó
-- hozzáadhatja — ez itt tárolódik, és utána benne marad a listájában. A saját egységeit CSAK Ő látja, és ha
-- vállalkozó, akkor az emberei (alkalmazottai) is; más nem. Törölni / átírni mindenki csak a sajátját tudja.

create table if not exists public.material_units (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 20),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists material_units_owner_idx on public.material_units(created_by);
create index if not exists material_units_updated_idx on public.material_units(updated_at);

drop trigger if exists trg_touch_material_units on public.material_units;
create trigger trg_touch_material_units before insert or update on public.material_units
  for each row execute function public.fn_touch_updated_at();

-- a belépett munkavállaló vállalkozójának (főnökének) fiókja — ha van; a vállalkozó egységeit az emberei is látják
create or replace function public.fn_my_contractor_user_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.id
    from public.workers w
    join public.workers boss on boss.id = w.contractor_id and boss.deleted_at is null
    join public.profiles p on p.worker_id = boss.id
   where w.id = public.fn_my_worker_id() and w.deleted_at is null
   limit 1;
$$;
revoke all on function public.fn_my_contractor_user_id() from public, anon;
grant execute on function public.fn_my_contractor_user_id() to authenticated;

alter table public.material_units enable row level security;
revoke all on public.material_units from public, anon, authenticated;
grant select, insert, update on public.material_units to authenticated;

drop policy if exists mu_select on public.material_units;
create policy mu_select on public.material_units for select to authenticated
  using (created_by = (select auth.uid()) or created_by = (select public.fn_my_contractor_user_id()));
drop policy if exists mu_insert on public.material_units;
create policy mu_insert on public.material_units for insert to authenticated
  with check (created_by = (select auth.uid()));
drop policy if exists mu_update on public.material_units;
create policy mu_update on public.material_units for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

do $$ begin
  execute 'alter publication supabase_realtime add table public.material_units';
exception when duplicate_object then null; end $$;
