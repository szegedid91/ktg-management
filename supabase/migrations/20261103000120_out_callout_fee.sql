-- Kimenő kiszállási díj (2026-11-03): az ügyfél felé számlázott kiszállás alkalmankénti díja — a Beállítások
-- „Díjak” táblájának „Kimenő” oszlopába kerül a Kiszállás sorhoz. Az elszámolás-export (feladatonkénti
-- tömbök: munkaóra, kiszállás, anyagok, összesen) ezt és a kimenő órabért használja alapértelmezésnek.
alter table public.app_settings add column if not exists out_callout_fee numeric;
-- a tábla oszloponként van kiadva
grant select (out_callout_fee), insert (out_callout_fee), update (out_callout_fee) on public.app_settings to authenticated;
