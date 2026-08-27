-- Azonnali eszközök közti frissítés: minden szinkronizált tábla bekerül a
-- realtime közvetítésbe. A kliens változás-jelzésre azonnal szinkront futtat,
-- így bárki rögzítése (ember, költség, építkezés, bármi) rögtön átér a
-- másik eszközre — a 30 mp-es kör csak tartalék marad.

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'app_settings', 'expense_categories', 'sites', 'external_people',
    'workers', 'expenses', 'expense_photos', 'attendance', 'comments',
    'invoices', 'settlements', 'equipment', 'equipment_moves',
    'profit_share_history', 'share_change_requests'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null; -- már benne van
    end;
  end loop;
end $$;
