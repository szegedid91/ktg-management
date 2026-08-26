-- =============================================================
-- Számítási logika automatikus tesztjei (4. pont a specben)
-- Futtatás: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/calc_test.sql
-- Minden assert hibára megáll; a végén ROLLBACK, az adatbázis tiszta marad.
-- =============================================================
begin;

-- ---------- Tesztfelhasználók ----------
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-00000000000a', 'anna@test.hu', '{"display_name":"Anna"}'::jsonb);
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-00000000000b', 'bela@test.hu', '{"display_name":"Béla"}'::jsonb);

do $$
begin
  -- automatikus profil + egyenlő elosztás
  assert (select count(*) from public.profiles) = 2, 'Profilok létrejötte';
  assert (select sum(profit_share_percent) from public.profiles) = 100, 'Részesedés összege 100';
  assert (select profit_share_percent from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 50, '50-50 elosztás';
end $$;

-- ---------- Alapadatok ----------
update public.app_settings set individual_project_rate = 100000, default_vat_rate = 27 where id = 1;

insert into public.sites (id, name, created_by)
values ('10000000-0000-0000-0000-000000000001', 'Újlak utca', '00000000-0000-0000-0000-00000000000a');

insert into public.external_people (id, name, created_by)
values ('20000000-0000-0000-0000-000000000001', 'Külsős Karcsi', '00000000-0000-0000-0000-00000000000b');

-- W1: magánszemély, napi 40 000, közvetítő: Anna (felhasználó), fix 10 000/nap
insert into public.workers (id, name, worker_type, daily_rate, referrer_user_id, commission_mode, commission_value, commission_unit, created_by)
values ('30000000-0000-0000-0000-000000000001', 'Munkás Miki', 'individual', 40000,
        '00000000-0000-0000-0000-00000000000a', 'fixed', 10000, 'day', '00000000-0000-0000-0000-00000000000b');

-- W2: céges ÁFA-s, órabér 5 000, közvetítő: Karcsi (külsős), 10%
insert into public.workers (id, name, worker_type, is_vat_payer, vat_rate, hourly_rate, referrer_external_id, commission_mode, commission_value, created_by)
values ('30000000-0000-0000-0000-000000000002', 'Céges Csaba', 'company', true, 27, 5000,
        '20000000-0000-0000-0000-000000000001', 'percent', 10, '00000000-0000-0000-0000-00000000000a');

-- W3: projektdíjas, díj-felülírás nélkül → globális 100 000 helyett saját 200 000
insert into public.workers (id, name, worker_type, project_rate, created_by)
values ('30000000-0000-0000-0000-000000000003', 'Projekt Pali', 'individual', 200000, '00000000-0000-0000-0000-00000000000a');

-- ---------- Jelenlét ----------
-- a1: W1 napi díj → 40 000, ebből 10 000 Annáé (közvetítői)
insert into public.attendance (id, work_date, site_id, worker_id, pay_basis, created_by)
values ('40000000-0000-0000-0000-000000000001', '2026-08-01', '10000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'daily', '00000000-0000-0000-0000-00000000000b');

-- a2: W2 8 óra → 40 000, ebből 4 000 Karcsié
insert into public.attendance (id, work_date, site_id, worker_id, pay_basis, hours, created_by)
values ('40000000-0000-0000-0000-000000000002', '2026-08-01', '10000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000002', 'hourly', 8, '00000000-0000-0000-0000-00000000000a');

-- a3: W3 projektdíj egyszeri terhelés → 200 000
insert into public.attendance (id, work_date, site_id, worker_id, pay_basis, created_by)
values ('40000000-0000-0000-0000-000000000003', '2026-08-01', '10000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000003', 'project', '00000000-0000-0000-0000-00000000000a');

-- a4: W3 díj nélküli jelenlét másnap → 0
insert into public.attendance (id, work_date, site_id, worker_id, pay_basis, created_by)
values ('40000000-0000-0000-0000-000000000004', '2026-08-02', '10000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000003', 'presence', '00000000-0000-0000-0000-00000000000a');

do $$
begin
  assert (select amount from public.attendance where id = '40000000-0000-0000-0000-000000000001') = 40000, 'a1 napi díj';
  assert (select commission_amount from public.attendance where id = '40000000-0000-0000-0000-000000000001') = 10000, 'a1 közvetítői rész';
  assert (select referrer_user_id from public.attendance where id = '40000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-00000000000a', 'a1 közvetítő pillanatkép';
  assert (select amount from public.attendance where id = '40000000-0000-0000-0000-000000000002') = 40000, 'a2 órabér 8×5000';
  assert (select commission_amount from public.attendance where id = '40000000-0000-0000-0000-000000000002') = 4000, 'a2 közvetítői 10%';
  assert (select amount from public.attendance where id = '40000000-0000-0000-0000-000000000003') = 200000, 'a3 projektdíj (munkavállalói felülírás)';
  assert (select amount from public.attendance where id = '40000000-0000-0000-0000-000000000004') = 0, 'a4 díj nélküli jelenlét';
  -- ÁFA a céges munkásnál külön oszlopban, a nettót nem érinti
  assert (select vat_amount from public.v_attendance_detail where id = '40000000-0000-0000-0000-000000000002') = 10800, 'a2 ÁFA 27%';
end $$;

-- ---------- Fél nap (0.5 szorzó) és óradíj-felülírás ----------
insert into public.attendance (id, work_date, site_id, worker_id, pay_basis, day_multiplier, created_by)
values ('40000000-0000-0000-0000-000000000005', '2026-08-03', '10000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'daily', 0.5, '00000000-0000-0000-0000-00000000000b');
insert into public.attendance (id, work_date, site_id, worker_id, pay_basis, hours, applied_rate, created_by)
values ('40000000-0000-0000-0000-000000000006', '2026-08-03', '10000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000002', 'hourly', 4, 6000, '00000000-0000-0000-0000-00000000000a');

do $$
begin
  assert (select amount from public.attendance where id = '40000000-0000-0000-0000-000000000005') = 20000, 'fél nap 0.5 szorzó';
  assert (select commission_amount from public.attendance where id = '40000000-0000-0000-0000-000000000005') = 5000, 'fél nap közvetítői fix/nap arányosan';
  assert (select amount from public.attendance where id = '40000000-0000-0000-0000-000000000006') = 24000, 'tétel-szintű díj-felülírás 4×6000';
end $$;

-- töröljük a plusz tételeket, hogy az egyenleg-teszt számai tiszták legyenek
delete from public.attendance where id in ('40000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000006');

-- ---------- Költség, számla ----------
insert into public.expenses (id, site_id, expense_date, title, net_amount, vat_rate, vat_amount, gross_amount, created_by, paid_by)
values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        '2026-08-01', 'festék, létra', 100000, 27, 27000, 127000,
        '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a');

insert into public.invoices (id, site_id, invoice_date, title, net_amount, vat_rate, vat_amount, gross_amount, invoiced_at, paid_at, paid_marked_by, created_by)
values ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        '2026-08-05', '1. részszámla', 500000, 27, 135000, 635000, '2026-08-05', '2026-08-10',
        '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a');

insert into public.invoices (id, site_id, invoice_date, title, net_amount, vat_rate, vat_amount, gross_amount, invoiced_at, created_by)
values ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
        '2026-08-15', '2. részszámla', 200000, 27, 54000, 254000, '2026-08-15',
        '00000000-0000-0000-0000-00000000000b');

-- ---------- Kifizetés-pipák (Béla fizeti W1 bérét, Anna W2-ét, Béla a külsős jutalékot) ----------
update public.attendance set paid_at = now(), paid_by = '00000000-0000-0000-0000-00000000000b'
 where id = '40000000-0000-0000-0000-000000000001';
update public.attendance set paid_at = now(), paid_by = '00000000-0000-0000-0000-00000000000a'
 where id = '40000000-0000-0000-0000-000000000002';
update public.attendance set commission_paid_at = now(), commission_paid_by = '00000000-0000-0000-0000-00000000000b'
 where id = '40000000-0000-0000-0000-000000000002';

-- ---------- Közös eredmény ----------
do $$
begin
  assert (select revenue_paid_net from public.v_common_result) = 500000, 'befolyt nettó bevétel';
  assert (select outstanding_net from public.v_common_result) = 200000, 'kintlévőség';
  assert (select expense_net from public.v_common_result) = 100000, 'költség nettó';
  assert (select wage_net from public.v_common_result) = 280000, 'bérköltség (40+40+200e)';
  assert (select profit_net from public.v_common_result) = 120000, 'közös nettó eredmény';
end $$;

-- ---------- Felhasználói egyenlegek ----------
-- Anna: 60 000 (részesedés) + 136 000 (költés: 100e költség + 36e bér) + 10 000 (közvetítői jóváírás) − 500 000 (befolyt hozzá) = −294 000
-- Béla: 60 000 + 34 000 (30e bér + 4e külsős jutalék) = +94 000
do $$
begin
  assert (select balance from public.v_user_balances where user_id = '00000000-0000-0000-0000-00000000000a') = -294000, 'Anna egyenlege';
  assert (select balance from public.v_user_balances where user_id = '00000000-0000-0000-0000-00000000000b') = 94000, 'Béla egyenlege';
  assert (select commission_credit from public.v_user_balances where user_id = '00000000-0000-0000-0000-00000000000a') = 10000, 'Anna közvetítői jóváírása';
end $$;

-- ---------- Javasolt rendezés: Anna → Béla 94 000 ----------
do $$
declare r record;
begin
  select * into r from public.suggested_settlements() limit 1;
  assert r.from_user = '00000000-0000-0000-0000-00000000000a', 'javaslat: Anna utal';
  assert r.to_user = '00000000-0000-0000-0000-00000000000b', 'javaslat: Bélának';
  assert r.amount = 94000, 'javaslat összege';
end $$;

-- ---------- Settlement + maradék bér kifizetése → mindkét egyenleg nullázódik ----------
insert into public.settlements (id, from_user, to_user, amount, settle_date, created_by)
values ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
        '00000000-0000-0000-0000-00000000000b', 94000, '2026-08-20', '00000000-0000-0000-0000-00000000000a');

update public.attendance set paid_at = now(), paid_by = '00000000-0000-0000-0000-00000000000a'
 where id = '40000000-0000-0000-0000-000000000003';

do $$
begin
  assert (select balance from public.v_user_balances where user_id = '00000000-0000-0000-0000-00000000000a') = 0, 'Anna egyenlege rendezés után 0';
  assert (select balance from public.v_user_balances where user_id = '00000000-0000-0000-0000-00000000000b') = 0, 'Béla egyenlege rendezés után 0';
end $$;

-- ---------- "Tegnap ugyanaz": projektdíj nem duplázódik ----------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$
declare n integer;
begin
  perform public.copy_attendance_from_previous_day('10000000-0000-0000-0000-000000000001', '2026-08-04');
  -- előző nap a 08-02 (a4: W3 presence) → 1 tétel másolódik, díj nélkül
  select count(*) into n from public.attendance where work_date = '2026-08-04' and deleted_at is null;
  assert n = 1, 'másolt tételek száma';
  assert (select sum(amount) from public.attendance where work_date = '2026-08-04') = 0, 'másolt nap költsége 0 (presence)';
end $$;

-- 08-01 → 08-05 másolás: a projektdíjas tétel presence-ként megy át
do $$
declare v_amount numeric;
begin
  delete from public.attendance where work_date in ('2026-08-02', '2026-08-04');
  perform public.copy_attendance_from_previous_day('10000000-0000-0000-0000-000000000001', '2026-08-05');
  assert (select count(*) from public.attendance where work_date = '2026-08-05') = 3, '3 tétel másolódott';
  select sum(amount) into v_amount from public.attendance where work_date = '2026-08-05';
  -- W1 napi 40e + W2 8ó 40e + W3 presence 0 = 80e (projektdíj NEM terhelődik újra)
  assert v_amount = 80000, 'másolt nap: projektdíj nem duplázódik';
  delete from public.attendance where work_date = '2026-08-05';
end $$;

-- ---------- Lezárási checklist ----------
do $$
declare v jsonb;
begin
  v := public.close_site('10000000-0000-0000-0000-000000000001', false);
  assert (v->>'closed')::boolean = false, 'nem zár le függő tételekkel force nélkül';
  assert jsonb_array_length(v->'unpaid_invoices') = 1, 'be nem folyt számla a checklisten';
  v := public.close_site('10000000-0000-0000-0000-000000000001', true);
  assert (v->>'closed')::boolean = true, 'force-szal lezár';
end $$;

-- lezárt építkezésre nem lehet költséget rögzíteni
do $$
begin
  begin
    insert into public.expenses (site_id, net_amount, created_by, paid_by)
    values ('10000000-0000-0000-0000-000000000001', 1000,
            '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a');
    raise exception 'NEM DOBOTT HIBÁT';
  exception
    when others then
      if sqlerrm = 'NEM DOBOTT HIBÁT' then
        raise exception 'Lezárt építkezésre lehetett költséget rögzíteni!';
      end if;
  end;
end $$;

-- újranyitás után újra írható
do $$
begin
  perform public.reopen_site('10000000-0000-0000-0000-000000000001');
  insert into public.expenses (id, site_id, net_amount, created_by, paid_by)
  values ('50000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000001', 1000,
          '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a');
  delete from public.expenses where id = '50000000-0000-0000-0000-000000000099';
end $$;

-- ---------- Profitrészesedés-validálás ----------
do $$
begin
  begin
    perform public.set_profit_shares('[{"user_id":"00000000-0000-0000-0000-00000000000a","percent":60},{"user_id":"00000000-0000-0000-0000-00000000000b","percent":30}]'::jsonb);
    raise exception 'NEM DOBOTT HIBÁT';
  exception
    when others then
      if sqlerrm = 'NEM DOBOTT HIBÁT' then
        raise exception 'A 90%%-os elosztást elfogadta!';
      end if;
  end;
  perform public.set_profit_shares('[{"user_id":"00000000-0000-0000-0000-00000000000a","percent":60},{"user_id":"00000000-0000-0000-0000-00000000000b","percent":40}]'::jsonb);
  assert (select profit_share_percent from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 60, '60-40 elosztás mentve';
end $$;

-- ---------- Audit log ----------
do $$
begin
  assert (select count(*) from public.audit_log where table_name = 'attendance' and action = 'INSERT') >= 4, 'attendance insert auditálva';
  assert (select count(*) from public.audit_log where table_name = 'attendance' and action = 'UPDATE') >= 3, 'kifizetés pipa auditálva';
  assert (select count(*) from public.audit_log where table_name = 'expenses' and action = 'DELETE') >= 1, 'törlés auditálva';
end $$;

select 'MINDEN TESZT SIKERES ✓' as eredmeny;
rollback;
