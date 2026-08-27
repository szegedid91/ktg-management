-- Kategóriák: bármelyik bejelentkezett felhasználó törölhet (soft delete)
-- bármely kategóriát, a beépítetteket is. A beépítettek neve továbbra sem
-- írható át, és véglegesen (hard delete) senki sem törölhet beépítettet.
-- A korábbi költségeken a törölt kategória megmarad.

drop policy if exists expense_categories_update on public.expense_categories;
create policy expense_categories_update on public.expense_categories
  for update to authenticated using (true) with check (true);

create or replace function public.fn_protect_builtin_category()
returns trigger language plpgsql as $$
begin
  if old.is_builtin then
    if tg_op = 'DELETE' then
      raise exception 'Beépített kategória véglegesen nem törölhető.';
    end if;
    if new.name <> old.name then
      raise exception 'A beépített kategória neve nem módosítható.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
