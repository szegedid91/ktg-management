-- A rejtett admin nem üzleti partner: a részesedés-mentés teljességi
-- ellenőrzése és a frissítés is csak a nem-admin profilokra vonatkozik.
-- (A beállítások képernyő az adminlistát nem mutatja, így eddig a
-- darabszám-ellenőrzés mindig elbukott.)

create or replace function public.set_profit_shares(p_shares jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sum numeric;
  r record;
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;

  select sum((e->>'percent')::numeric) into v_sum
  from jsonb_array_elements(p_shares) e;
  if v_sum is distinct from 100 then
    raise exception 'A részesedések összege 100%% kell legyen (jelenleg: %%%)', v_sum;
  end if;
  if (select count(*) from jsonb_array_elements(p_shares))
     <> (select count(*) from public.profiles where not is_admin) then
    raise exception 'Minden felhasználóhoz meg kell adni a részesedést.';
  end if;

  for r in select (e->>'user_id')::uuid as user_id, (e->>'percent')::numeric as percent
           from jsonb_array_elements(p_shares) e
  loop
    if r.percent is null or r.percent < 0 or r.percent > 100 then
      raise exception 'Érvénytelen részesedés-érték.';
    end if;
    update public.profiles set profit_share_percent = r.percent
    where id = r.user_id and not is_admin;
  end loop;
end;
$$;
