-- Anyagköltség mennyisége és egysége (2026-11-03, Daniel kérése): az elszámolás-exportban az anyag sora
-- „mennyiség × egységár” legyen (pl. 100 méter × 350 Ft), nem mindig 1 db. Az összeg (amount) továbbra is a
-- teljes bekerülési érték; az egységár = összeg / mennyiség. Üres mennyiség = 1, üres egység = db.
alter table public.task_materials
  add column if not exists quantity numeric,
  add column if not exists unit text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'task_materials_quantity_check') then
    alter table public.task_materials add constraint task_materials_quantity_check check (quantity is null or quantity > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'task_materials_unit_len') then
    alter table public.task_materials add constraint task_materials_unit_len check (unit is null or char_length(unit) <= 20);
  end if;
end $$;
-- a tábla oszloponként van kiadva
grant select (quantity, unit), insert (quantity, unit), update (quantity, unit) on public.task_materials to authenticated;
