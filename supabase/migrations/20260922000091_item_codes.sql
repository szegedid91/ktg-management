-- Cikktörzs-kódok (2026-09-22, Daniel „6. sz. melléklet — Cikktörzsek”): új feladatnál
-- legördülőből választható, bővíthető lista. Két csoport: S = Kivitelezés / Szolgáltatás /
-- Karbantartás, A = Anyagbeszerzés. A feladaton `item_code_id` hivatkozik rá.

create table if not exists public.item_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  "group" text not null default 'S' check ("group" in ('S', 'A')),
  position integer not null default 0,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists item_codes_code_idx on public.item_codes(lower(code)) where deleted_at is null;
create index if not exists item_codes_updated_idx on public.item_codes(updated_at);
drop trigger if exists trg_touch_item_codes on public.item_codes;
create trigger trg_touch_item_codes before insert or update on public.item_codes
  for each row execute function public.fn_touch_updated_at();

alter table public.item_codes enable row level security;
revoke all on public.item_codes from public, anon;
grant select, insert, update on public.item_codes to authenticated;
-- olvasni mindenki (a munkavállaló a feladatán látja a kódot); írni csak vezető
drop policy if exists ic_select on public.item_codes;
create policy ic_select on public.item_codes for select to authenticated using (true);
drop policy if exists ic_insert on public.item_codes;
create policy ic_insert on public.item_codes for insert to authenticated
  with check (public.fn_is_partner() and created_by = auth.uid());
drop policy if exists ic_update on public.item_codes;
create policy ic_update on public.item_codes for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());
do $$ begin
  execute 'alter publication supabase_realtime add table public.item_codes';
exception when duplicate_object then null; end $$;

-- a melléklet 16 kódja (rendszerkód, tulajdonos nélkül)
insert into public.item_codes (code, name, "group", position) values
  ('001S', 'Épület Elektromosság', 'S', 1),
  ('002S', 'Épület Gépészet', 'S', 2),
  ('003S', 'Építészet', 'S', 3),
  ('004S', 'Hűtőkamra', 'S', 4),
  ('005S', 'Rágcsáló és Rovarirtás', 'S', 5),
  ('006S', 'Konyhai Gépek Elektromosság', 'S', 6),
  ('007S', 'Konyhai Gépek Gépészet', 'S', 7),
  ('008S', 'Légtechnika', 'S', 8),
  ('001A', 'Épület Elektromosság', 'A', 11),
  ('002A', 'Épület Gépészet', 'A', 12),
  ('003A', 'Építészet', 'A', 13),
  ('004A', 'Hűtőkamra', 'A', 14),
  ('005A', 'Rágcsáló és Rovarirtás', 'A', 15),
  ('006A', 'Konyhai Gépek Elektromosság', 'A', 16),
  ('007A', 'Konyhai Gépek Gépészet', 'A', 17),
  ('008A', 'Légtechnika', 'A', 18)
on conflict do nothing;

-- a feladaton
alter table public.worker_tasks add column if not exists item_code_id uuid references public.item_codes(id);

-- a maszkoló nézet is adja (új worker_tasks-oszlopnál a nézetet bővíteni kell!)
create or replace view public.worker_tasks_v
with (security_barrier = true, security_invoker = false) as
with me as (select public.fn_is_partner() as partner, public.fn_my_active_task_ids() as act)
select t.id, t.worker_id, t.site_id, t.code, t.title, t.details, t.status, t.acknowledged_at, t.done_at,
       t.fail_reason, t.fail_photo_path, t.created_by, t.created_at, t.updated_at, t.deleted_at,
       t.quote_requested,
       case when me.partner then t.quote_amount end as quote_amount,
       case when me.partner then t.quote_note end as quote_note,
       case when me.partner then t.quote_submitted_at end as quote_submitted_at,
       t.quote_accepted_at,
       case when me.partner then t.quote_accepted_by end as quote_accepted_by,
       t.photo_paths, t.fail_photo_paths, t.priority, t.due_date, t.overdue_notified_at,
       t.item_code_id
from public.worker_tasks t cross join me
where me.partner or t.id = any(me.act);
revoke all on public.worker_tasks_v from public, anon, authenticated;
grant select on public.worker_tasks_v to authenticated;
