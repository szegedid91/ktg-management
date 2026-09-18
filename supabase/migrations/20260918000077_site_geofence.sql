-- Munkaterület helye és bejelentkezési sugara (2026-09-18): a munkavállalói
-- app jelzi, ha a telefon a terület sugarán belül van, és felajánlja a
-- bejelentkezést. (Weben csak megnyitott app mellett működik.)
alter table public.sites add column if not exists lat double precision;
alter table public.sites add column if not exists lng double precision;
alter table public.sites add column if not exists geofence_radius_m integer not null default 150;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sites_geofence_radius_chk') then
    alter table public.sites add constraint sites_geofence_radius_chk check (geofence_radius_m between 30 and 5000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sites_latlng_chk') then
    alter table public.sites add constraint sites_latlng_chk check (
      (lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180));
  end if;
end $$;
