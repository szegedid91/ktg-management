-- Költség építkezés nélkül is rögzíthető (közös, területhez nem kötött
-- költség), illetve több területre megosztva több sorként kerül be.
-- A v_site_totals a NULL site_id-s költségeket értelemszerűen nem
-- mutatja egyik területnél sem; a közös eredményben benne vannak.

alter table public.expenses alter column site_id drop not null;
