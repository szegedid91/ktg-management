-- =============================================================
-- Demo adatok: 2026. május–augusztus
-- 3 építkezés (Rózsadomb lezárva), 15 munkavállaló, jelenlét,
-- költségek vegyesen Dani/Anna által, havi bevételek, rendezés.
-- Futtatás előtt a két tesztfiók (Dani, Anna) létezzen.
-- Újrafuttatás ellen védett (Rózsadomb villa létére néz).
-- =============================================================

do $$
declare
  u_dani uuid; u_anna uuid;
  s_ujlak uuid; s_rozsa uuid; s_kerek uuid;
  ep_kalman uuid;
  c_anyag uuid; c_szer uuid; c_uzem uuid; c_alv uuid; c_egyeb uuid;
  w_tibi uuid; w_miki uuid;
  e_allvany uuid; e_hilti uuid; e_lezer uuid;
  v_exp uuid; v_worker uuid;
  t_anyag text[] := array['cement, sóder','tégla, zsalukő','festék, glett','csempe, fugázó','gipszkarton lapok, profil','szigetelőanyag','faanyag, OSB','vakolat, ragasztó','villanyszerelési anyag','csövek, idomok'];
  t_szer text[] := array['flexkorong, fúrószár','védőkesztyű, sisak','gérvágó bérlés','vésőgép bérlés','csiszolópapír, ecsetek'];
  t_uzem text[] := array['tankolás','tankolás — kisteher'];
  t_alv text[] := array['konténer + sitt elszállítás','daruzás','betonpumpa','földmunka gépi'];
  t_egyeb text[] := array['parkolás','étkezés a csapatnak','irodaszer, nyomtatás','útdíj'];
  d date;
  r record;
  v_rand numeric;
  v_cat uuid;
  v_title text;
  v_net numeric;
  v_payer uuid;
begin
  select id into u_dani from public.profiles where email = 'dani@teszt.hu';
  select id into u_anna from public.profiles where email = 'anna@teszt.hu';
  if u_dani is null or u_anna is null then
    raise exception 'Előbb lépj be egyszer mindkét tesztfiókkal (Dani és Anna gomb a belépőn)!';
  end if;
  if exists (select 1 from public.sites where name = 'Rózsadomb villa') then
    raise notice 'A demo adatok már be vannak töltve — kihagyva.';
    return;
  end if;

  select id into c_anyag from public.expense_categories where name = 'Anyag';
  select id into c_szer  from public.expense_categories where name = 'Szerszám';
  select id into c_uzem  from public.expense_categories where name = 'Üzemanyag';
  select id into c_alv   from public.expense_categories where name = 'Alvállalkozói díj';
  select id into c_egyeb from public.expense_categories where name = 'Egyéb';

  -- ---------- Alapértelmezett díjak ----------
  update public.app_settings set
    individual_hourly_rate = 4000, individual_daily_rate = 32000, individual_project_rate = 300000,
    company_hourly_rate = 7000, company_daily_rate = 55000, company_project_rate = 800000,
    out_hourly_rate = 9000, out_daily_rate = 70000, out_project_rate = 1200000,
    default_vat_rate = 27, updated_by = u_dani
  where id = 1;

  -- ---------- Építkezések ----------
  select id into s_ujlak from public.sites where name = 'Újlak utca' and deleted_at is null;
  if s_ujlak is null then
    insert into public.sites (name, address, created_by)
    values ('Újlak utca', '1036 Budapest, Újlak utca 12.', u_dani) returning id into s_ujlak;
  end if;
  insert into public.sites (name, address, note, created_by)
  values ('Rózsadomb villa', '1025 Budapest, Vérhalom u. 5.', 'Teljes belső felújítás + tető', u_dani)
  returning id into s_rozsa;
  insert into public.sites (name, address, created_by)
  values ('Kerekes műhely', '1135 Budapest, Kerekes u. 8.', u_anna)
  returning id into s_kerek;

  -- ---------- Külsős közvetítő ----------
  insert into public.external_people (name, phone, created_by)
  values ('Közvetítő Kálmán', '+36 20 555 1234', u_anna) returning id into ep_kalman;

  -- ---------- 15 munkavállaló ----------
  select id into w_miki from public.workers where name = 'Munkás Miki' and deleted_at is null;
  if w_miki is null then
    insert into public.workers (name, phones, worker_type, default_pay_basis, daily_rate, created_by)
    values ('Munkás Miki', array['+36 30 111 2222'], 'individual', 'daily', 40000, u_dani) returning id into w_miki;
  end if;

  insert into public.workers (name, phones, worker_type, is_vat_payer, vat_rate, default_pay_basis, hourly_rate, daily_rate, project_rate, referrer_user_id, referrer_external_id, commission_mode, commission_value, commission_unit, company_name, tax_number, created_by) values
    ('Kőműves Karcsi',     array['+36 30 201 1111'], 'individual', false, 27, 'daily',  null, 42000, null, null,   null,      null,      null,  null,  null, null, u_dani),
    ('Burkoló Béla',       array['+36 30 202 2222'], 'individual', false, 27, 'daily',  null, 45000, null, null,   ep_kalman, 'fixed',   5000,  'day', null, null, u_anna),
    ('Villany Vili',       array['+36 30 203 3333'], 'company',    true,  27, 'hourly', 8000, null,  null, null,   null,      null,      null,  null,  'Vili-Volt Kft.', '12345678-2-41', u_dani),
    ('Vízszerelő Vince',   array['+36 30 204 4444'], 'company',    true,  27, 'hourly', 7500, null,  null, null,   null,      null,      null,  null,  'AquaVince Bt.', '87654321-1-13', u_anna),
    ('Festő Feri',         array['+36 30 205 5555'], 'individual', false, 27, 'daily',  null, 38000, null, null,   null,      null,      null,  null,  null, null, u_dani),
    ('Segéd Sanyi',        array['+36 30 206 6666'], 'individual', false, 27, 'hourly', 3500, null,  null, null,   null,      null,      null,  null,  null, null, u_anna),
    ('Segéd Samu',         array['+36 30 207 7777'], 'individual', false, 27, 'hourly', 3500, null,  null, u_anna, null,      'percent', 10,    null,  null, null, u_anna),
    ('Ács Andor',          array['+36 30 208 8888'], 'individual', false, 27, 'daily',  null, 48000, null, null,   null,      null,      null,  null,  null, null, u_dani),
    ('Tetőfedő Tibi',      array['+36 30 209 9999'], 'company',    false, 27, 'project', null, null, 950000, null, null,      null,      null,  null,  'TetőTibi Kft.', '11223344-2-42', u_dani),
    ('Gipszkartonos Gyula',array['+36 30 210 1010'], 'individual', false, 27, 'daily',  null, 40000, null, null,   ep_kalman, 'fixed',   4000,  'day', null, null, u_anna),
    ('Kertész Kázmér',     array['+36 30 211 1111'], 'individual', false, 27, 'daily',  null, null,  null, null,   null,      null,      null,  null,  null, null, u_anna),
    ('Bádogos Bandi',      array['+36 30 212 1212'], 'individual', false, 27, 'hourly', 5000, null,  null, null,   null,      null,      null,  null,  null, null, u_dani),
    ('Hegesztő Huba',      array['+36 30 213 1313'], 'company',    true,  27, 'hourly', 9000, null,  null, u_dani, null,      'percent', 8,     null,  'HubaWeld Kft.', '55667788-2-03', u_anna),
    ('Takarító Tercsi',    array['+36 30 214 1414'], 'individual', false, 27, 'daily',  null, 25000, null, null,   null,      null,      null,  null,  null, null, u_dani);

  select id into w_tibi from public.workers where name = 'Tetőfedő Tibi';

  -- ---------- Jelenlét: csapatbeosztás ----------
  create temp table crew (
    wname text, site uuid, d_from date, d_to date,
    basis text, prob numeric, h_min int, h_max int, mult numeric default 1
  ) on commit drop;

  -- Rózsadomb villa: 2026-05-04 → 2026-07-24
  insert into crew values
    ('Kőműves Karcsi',      s_rozsa, '2026-05-04', '2026-07-24', 'daily',  0.90, null, null, 1),
    ('Burkoló Béla',        s_rozsa, '2026-06-01', '2026-07-24', 'daily',  0.85, null, null, 1),
    ('Festő Feri',          s_rozsa, '2026-07-01', '2026-07-24', 'daily',  0.90, null, null, 1),
    ('Segéd Sanyi',         s_rozsa, '2026-05-04', '2026-07-24', 'hourly', 0.80, 8, 10, 1),
    ('Segéd Samu',          s_rozsa, '2026-06-01', '2026-07-24', 'hourly', 0.70, 6, 9, 1),
    ('Ács Andor',           s_rozsa, '2026-05-18', '2026-06-12', 'daily',  0.85, null, null, 1),
    ('Villany Vili',        s_rozsa, '2026-05-15', '2026-07-15', 'hourly', 0.25, 4, 9, 1),
    ('Vízszerelő Vince',    s_rozsa, '2026-05-10', '2026-06-30', 'hourly', 0.20, 4, 8, 1),
    ('Gipszkartonos Gyula', s_rozsa, '2026-06-15', '2026-07-20', 'daily',  0.80, null, null, 1),
    ('Tetőfedő Tibi',       s_rozsa, '2026-05-20', '2026-06-05', 'presence', 0.90, null, null, 1);

  -- Újlak utca: 2026-07-01 → 2026-08-26
  insert into crew values
    ('Munkás Miki',         s_ujlak, '2026-07-01', '2026-08-26', 'daily',  0.85, null, null, 1),
    ('Kőműves Karcsi',      s_ujlak, '2026-08-03', '2026-08-26', 'daily',  0.70, null, null, 1),
    ('Segéd Sanyi',         s_ujlak, '2026-07-06', '2026-08-26', 'hourly', 0.60, 6, 10, 1),
    ('Hegesztő Huba',       s_ujlak, '2026-07-13', '2026-08-26', 'hourly', 0.30, 4, 8, 1),
    ('Bádogos Bandi',       s_ujlak, '2026-07-06', '2026-08-26', 'hourly', 0.35, 4, 8, 1),
    ('Festő Feri',          s_ujlak, '2026-08-03', '2026-08-26', 'daily',  0.60, null, null, 1),
    ('Takarító Tercsi',     s_ujlak, '2026-07-10', '2026-08-26', 'daily',  0.30, null, null, 0.5);

  -- Kerekes műhely: 2026-07-06 → 2026-08-26
  insert into crew values
    ('Burkoló Béla',        s_kerek, '2026-08-03', '2026-08-26', 'daily',  0.60, null, null, 1),
    ('Villany Vili',        s_kerek, '2026-07-20', '2026-08-26', 'hourly', 0.30, 4, 9, 1),
    ('Segéd Samu',          s_kerek, '2026-07-06', '2026-08-26', 'hourly', 0.55, 6, 9, 1),
    ('Kertész Kázmér',      s_kerek, '2026-07-06', '2026-08-26', 'daily',  0.40, null, null, 1),
    ('Gipszkartonos Gyula', s_kerek, '2026-08-03', '2026-08-26', 'daily',  0.50, null, null, 1);

  for r in
    select c.*, w.id as wid from crew c join public.workers w on w.name = c.wname and w.deleted_at is null
  loop
    d := r.d_from;
    while d <= r.d_to loop
      if extract(isodow from d) < 6 and random() < r.prob
         and not exists (select 1 from public.attendance a
                          where a.worker_id = r.wid and a.work_date = d and a.deleted_at is null) then
        insert into public.attendance (work_date, site_id, worker_id, pay_basis, hours, day_multiplier, created_by)
        values (d, r.site, r.wid, r.basis,
                case when r.basis = 'hourly' then r.h_min + floor(random() * (r.h_max - r.h_min + 1)) end,
                r.mult,
                case when random() < 0.5 then u_dani else u_anna end);
      end if;
      d := d + 1;
    end loop;
  end loop;

  -- Tibi projektdíja egyszeri tételként a munka kezdőnapján
  insert into public.attendance (work_date, site_id, worker_id, pay_basis, created_by)
  values ('2026-05-20', s_rozsa, w_tibi, 'project', u_dani);

  -- ---------- Kifizetés-pipák ----------
  -- Rózsadomb: minden bér rendezve (a lezáráshoz); máshol az augusztus
  -- előtti bérek fizetve, az augusztusiak függőben maradnak.
  update public.attendance a
     set paid_at = (a.work_date + 3)::timestamptz,
         paid_by = case when random() < 0.5 then u_dani else u_anna end
   where a.deleted_at is null and a.pay_basis <> 'presence'
     and a.amount - a.commission_amount > 0 and a.paid_at is null
     and (a.site_id = s_rozsa or a.work_date < '2026-08-01');

  update public.attendance a
     set commission_paid_at = (a.work_date + 7)::timestamptz,
         commission_paid_by = case when random() < 0.5 then u_dani else u_anna end
   where a.deleted_at is null and a.referrer_external_id is not null
     and a.commission_amount > 0 and a.commission_paid_at is null
     and (a.site_id = s_rozsa or a.work_date < '2026-08-01');

  -- ---------- Költségek ----------
  create temp table exp_range (site uuid, d_from date, d_to date) on commit drop;
  insert into exp_range values
    (s_rozsa, '2026-05-04', '2026-07-24'),
    (s_ujlak, '2026-07-01', '2026-08-26'),
    (s_kerek, '2026-07-06', '2026-08-26');

  for r in select * from exp_range loop
    d := r.d_from;
    while d <= r.d_to loop
      if extract(isodow from d) < 6 and random() < 0.32 then
        v_rand := random();
        if v_rand < 0.45 then
          v_cat := c_anyag; v_title := t_anyag[1 + floor(random() * array_length(t_anyag, 1))::int];
          v_net := (300 + floor(random() * 4700)) * 100;          -- 30 000 – 500 000
        elsif v_rand < 0.60 then
          v_cat := c_szer; v_title := t_szer[1 + floor(random() * array_length(t_szer, 1))::int];
          v_net := (80 + floor(random() * 520)) * 100;            -- 8 000 – 60 000
        elsif v_rand < 0.75 then
          v_cat := c_uzem; v_title := t_uzem[1 + floor(random() * array_length(t_uzem, 1))::int];
          v_net := (150 + floor(random() * 300)) * 100;           -- 15 000 – 45 000
        elsif v_rand < 0.90 then
          v_cat := c_alv; v_title := t_alv[1 + floor(random() * array_length(t_alv, 1))::int];
          v_net := (400 + floor(random() * 2100)) * 100;          -- 40 000 – 250 000
        else
          v_cat := c_egyeb; v_title := t_egyeb[1 + floor(random() * array_length(t_egyeb, 1))::int];
          v_net := (50 + floor(random() * 250)) * 100;            -- 5 000 – 30 000
        end if;
        v_payer := case when random() < 0.5 then u_dani else u_anna end;
        insert into public.expenses (site_id, expense_date, title, net_amount, vat_rate, vat_amount, gross_amount, category_id, created_by, paid_by)
        values (r.site, d, v_title, v_net, 27, round(v_net * 0.27, 2), round(v_net * 1.27, 2), v_cat, v_payer, v_payer);
      end if;
      d := d + 1;
    end loop;
  end loop;

  -- ---------- Kimenő számlák (havi bevételek) ----------
  insert into public.invoices (site_id, invoice_date, invoiced_at, title, net_amount, vat_rate, vat_amount, gross_amount, paid_at, paid_marked_by, created_by) values
    (s_rozsa, '2026-05-29', '2026-05-29', 'Rózsadomb — 1. részszámla', 6500000, 27, 1755000, 8255000, '2026-06-10', u_dani, u_dani),
    (s_rozsa, '2026-06-30', '2026-06-30', 'Rózsadomb — 2. részszámla', 7800000, 27, 2106000, 9906000, '2026-07-08', u_anna, u_anna),
    (s_rozsa, '2026-07-24', '2026-07-27', 'Rózsadomb — végszámla',     9600000, 27, 2592000, 12192000, '2026-08-05', u_dani, u_dani),
    (s_ujlak, '2026-07-31', '2026-08-01', 'Újlak — 1. részszámla',     4200000, 27, 1134000, 5334000, '2026-08-12', u_anna, u_anna),
    (s_ujlak, '2026-08-25', '2026-08-25', 'Újlak — 2. részszámla',     2600000, 27,  702000, 3302000, null,         null,   u_dani),
    (s_kerek, '2026-07-31', '2026-08-02', 'Kerekes — 1. részszámla',   3400000, 27,  918000, 4318000, '2026-08-14', u_dani, u_dani),
    (s_kerek, '2026-08-24', '2026-08-24', 'Kerekes — 2. részszámla',   1900000, 27,  513000, 2413000, null,         null,   u_anna);

  -- ---------- Rendezés ----------
  insert into public.settlements (from_user, to_user, amount, settle_date, note, created_by)
  values (u_anna, u_dani, 1500000, '2026-07-05', 'Júniusi elszámolás rendezése', u_anna);

  -- ---------- Eszközök + mozgatások ----------
  insert into public.equipment (name, created_by) values ('Állványrendszer (40 m²)', u_dani) returning id into e_allvany;
  insert into public.equipment (name, created_by) values ('Hilti fúrókalapács', u_dani) returning id into e_hilti;
  insert into public.equipment (name, created_by) values ('Lézeres szintező', u_anna) returning id into e_lezer;
  insert into public.equipment (name, note, created_by) values ('Betonkeverő', 'raktárban', u_anna);

  insert into public.equipment_moves (equipment_id, site_id, taken_by, moved_at, created_by) values
    (e_allvany, s_rozsa, 'Dani',  '2026-05-05T07:30:00+02', u_dani),
    (e_allvany, s_ujlak, 'Karcsi','2026-08-03T08:00:00+02', u_dani),
    (e_hilti,   s_ujlak, 'Miki',  '2026-07-02T07:45:00+02', u_dani),
    (e_lezer,   s_kerek, 'Anna',  '2026-07-07T09:00:00+02', u_anna);

  -- ---------- Kommentek ----------
  insert into public.comments (entity_type, entity_id, author_id, body) values
    ('site', s_rozsa, u_dani, 'Szép munka volt, jó margóval zártunk. 👏'),
    ('site', s_kerek, u_anna, 'A megrendelő kérte, hogy szeptemberre végezzünk.');

  select id into v_exp from public.expenses
   where site_id = s_ujlak and category_id = c_anyag order by net_amount desc limit 1;
  if v_exp is not null then
    insert into public.comments (entity_type, entity_id, author_id, body)
    values ('expense', v_exp, u_anna, 'Ez miért lett ennyire drága? Kértél árajánlatot máshonnan is?');
  end if;

  select id into v_worker from public.workers where name = 'Burkoló Béla';
  insert into public.comments (entity_type, entity_id, author_id, body)
  values ('worker', v_worker, u_dani, 'Ügyes burkoló, a következő melóra is vihetjük.');

  -- ---------- Rózsadomb lezárása ----------
  update public.sites
     set status = 'closed', closed_at = '2026-07-31T16:00:00+02', closed_by = u_dani
   where id = s_rozsa;

  -- a seed által generált push-sor ürítése (ne menjen ki utólag semmi)
  delete from public.notification_queue where sent_at is null;

  raise notice 'Demo adatok betöltve.';
end;
$$;

select
  (select count(*) from public.workers where deleted_at is null)    as munkavallalok,
  (select count(*) from public.attendance where deleted_at is null) as jelenlet,
  (select count(*) from public.expenses where deleted_at is null)   as koltsegek,
  (select count(*) from public.invoices where deleted_at is null)   as szamlak,
  (select sum(net_amount) from public.invoices where paid_at is not null and deleted_at is null) as befolyt_netto,
  (select round(sum(amount)) from public.attendance where deleted_at is null) as berkoltseg_netto;
