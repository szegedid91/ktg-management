-- Sablon nézetek a feladat oldalához (2026-11-17, Daniel kérése): a vezető kiválaszt egy nézetet (pl.
-- „Elszámoláshoz”), és a feladat megnyitásakor a szakaszok (helyszín és kontakt, folyamat, munkaidő, anyag,
-- megjegyzések, ajánlatok, pénzügy, további műveletek) a sablon szerint jelennek meg: nyitva, csukva vagy
-- elrejtve. A beépített sablonok (Alap, Elszámoláshoz) az appban élnek; ha a felhasználó átállítja őket, a
-- saját változata itt tárolódik (builtin = a beépített sablon kulcsa). Az egyedi sablonoknál builtin üres.
-- A sablonok FIÓKHOZ kötöttek: mindenki csak a sajátját látja és írja; minden készülékén ugyanazok.
-- sections: {"site": "closed", "finance": "closed", "time": "open", ...} — hiányzó kulcs = automatikus.

create table if not exists public.task_view_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  builtin text check (builtin is null or char_length(builtin) between 1 and 40),
  sections jsonb not null default '{}'::jsonb
    check (jsonb_typeof(sections) = 'object' and length(sections::text) <= 2000),
  position integer not null default 0,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists task_view_presets_owner_idx on public.task_view_presets(created_by);
create index if not exists task_view_presets_updated_idx on public.task_view_presets(updated_at);

drop trigger if exists trg_touch_task_view_presets on public.task_view_presets;
create trigger trg_touch_task_view_presets before insert or update on public.task_view_presets
  for each row execute function public.fn_touch_updated_at();

alter table public.task_view_presets enable row level security;
revoke all on public.task_view_presets from public, anon, authenticated;
grant select, insert, update on public.task_view_presets to authenticated;

drop policy if exists tvp_select on public.task_view_presets;
create policy tvp_select on public.task_view_presets for select to authenticated
  using (created_by = (select auth.uid()));
drop policy if exists tvp_insert on public.task_view_presets;
create policy tvp_insert on public.task_view_presets for insert to authenticated
  with check (public.fn_is_partner() and created_by = (select auth.uid()));
drop policy if exists tvp_update on public.task_view_presets;
create policy tvp_update on public.task_view_presets for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

do $$ begin
  execute 'alter publication supabase_realtime add table public.task_view_presets';
exception when duplicate_object then null; end $$;
