-- Közös törzsadatot bármelyik vezető szerkeszthet (2026-10-11). Az eredeti szabály szerint („Írás/törlés:
-- csak a rekord létrehozója”) egy másik vezető által felvett építkezést, külsős személyt, eszközt vagy
-- költség-kategóriát nem lehetett módosítani — és ez CSENDBEN bukott: a szerver 0 sort módosított, hiba
-- nélkül, a készüléken viszont az új érték maradt (így lett Luki telefonján „0074 SE.Balassa”, a szerveren
-- pedig „SE.Balassa”). A pénzügyi tételek (költség, számla, jelenlét, elszámolás) szabálya itt nem változik.
do $$
declare t text;
begin
  foreach t in array array['sites', 'external_people', 'equipment', 'expense_categories'] loop
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.fn_is_partner()) with check (public.fn_is_partner())', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.fn_is_partner())', t || '_delete', t);
  end loop;
end $$;
