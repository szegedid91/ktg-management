-- Pénzügyi tételeket is bármelyik vezető szerkeszthet / törölhet (2026-10-11, Daniel döntése): költség,
-- számla, jelenlét/bér, elszámolás, eszközmozgatás, számlafotó. Az Audit napló mutatja, ki mit változtatott.
-- (A munkavállalói fiókok szabályai nem változnak: ezek a táblák nekik eddig sem voltak írhatók.)
do $$
declare t text;
begin
  foreach t in array array['expenses', 'expense_photos', 'invoices', 'attendance', 'settlements', 'equipment_moves'] loop
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.fn_is_partner()) with check (public.fn_is_partner())', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.fn_is_partner())', t || '_delete', t);
  end loop;
end $$;
