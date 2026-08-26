-- =============================================================
-- Kód-átvilágítás javításai (2026-08-27)
--  1) updated_at szerver-oldali beállítása INSERT-nél is (kliens-óra hiba
--     miatt más eszközök kihagyhatták a sort a szinkronból)
--  2) jelenlét-trigger: munkás-csere esetén a közvetítő-pillanatkép is
--     frissül; referrer-változás is újraszámol; jutalék nem lehet negatív
--  3) érték-ellenőrzések: negatív jutalék/díj/óraszám nem rögzíthető
--  4) v_user_balances: a befolyt számla ahhoz kerül, aki befolytnak
--     jelölte (nála landolt a pénz), nem a rögzítőhöz
--  5) suggested_settlements: 0 Ft-os javaslat nem kerül a listába
--  6) új felhasználó nem írja át a meglévő profitrészesedéseket
-- =============================================================

-- ---------- 1) touch trigger INSERT-re is ----------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','app_settings','expense_categories','sites','external_people',
    'workers','expenses','expense_photos','attendance','comments',
    'invoices','settlements','equipment','equipment_moves']
  loop
    execute format('drop trigger if exists trg_touch_%I on public.%I', t, t);
    execute format('create trigger trg_touch_%I before insert or update on public.%I for each row execute function public.fn_touch_updated_at()', t, t);
  end loop;
end;
$$;

-- ---------- 2) jelenlét-trigger ----------
create or replace function public.fn_attendance_compute()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  w public.workers%rowtype;
  s public.app_settings%rowtype;
  v_rate numeric(14,2);
begin
  select * into w from public.workers where id = new.worker_id;
  select * into s from public.app_settings where id = 1;

  -- munkás-csere: a közvetítő-pillanatkép az ÚJ munkásról készül újra
  if tg_op = 'UPDATE' and new.worker_id is distinct from old.worker_id then
    new.referrer_user_id := w.referrer_user_id;
    new.referrer_external_id := w.referrer_external_id;
  end if;

  -- díj feloldása: tétel-felülírás > munkavállalói díj > globális alapértelmezés
  if new.applied_rate is null then
    if new.pay_basis = 'hourly' then
      v_rate := coalesce(w.hourly_rate, case when w.worker_type = 'company' then s.company_hourly_rate else s.individual_hourly_rate end);
    elsif new.pay_basis = 'daily' then
      v_rate := coalesce(w.daily_rate, case when w.worker_type = 'company' then s.company_daily_rate else s.individual_daily_rate end);
    elsif new.pay_basis = 'project' then
      v_rate := coalesce(w.project_rate, case when w.worker_type = 'company' then s.company_project_rate else s.individual_project_rate end);
    else
      v_rate := 0;
    end if;
    new.applied_rate := v_rate;
  end if;

  -- bérköltség
  new.amount := case new.pay_basis
    when 'hourly'  then round(new.applied_rate * coalesce(new.hours, 0), 2)
    when 'daily'   then round(new.applied_rate * new.day_multiplier, 2)
    when 'project' then new.applied_rate
    else 0
  end;
  new.amount := greatest(new.amount, 0);

  -- közvetítő pillanatkép a munkavállalóról (csak ha a tételen még nincs)
  if new.referrer_user_id is null and new.referrer_external_id is null then
    new.referrer_user_id := w.referrer_user_id;
    new.referrer_external_id := w.referrer_external_id;
  end if;

  -- közvetítői díj: a bérköltség RÉSZE (osztódik, nem adódik hozzá)
  new.commission_amount := 0;
  if (new.referrer_user_id is not null or new.referrer_external_id is not null)
     and w.commission_mode is not null and new.pay_basis <> 'presence' then
    if w.commission_mode = 'percent' then
      new.commission_amount := round(new.amount * coalesce(w.commission_value, 0) / 100.0, 2);
    else -- fix összeg
      new.commission_amount := case w.commission_unit
        when 'hour'    then round(coalesce(w.commission_value, 0) * coalesce(new.hours, 0), 2)
        when 'day'     then round(coalesce(w.commission_value, 0) * new.day_multiplier, 2)
        when 'project' then case when new.pay_basis = 'project' then coalesce(w.commission_value, 0) else 0 end
        else 0
      end;
    end if;
    new.commission_amount := greatest(0, least(new.commission_amount, new.amount));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_attendance_compute on public.attendance;
create trigger trg_attendance_compute
  before insert or update of pay_basis, hours, day_multiplier, applied_rate,
    worker_id, referrer_user_id, referrer_external_id
  on public.attendance
  for each row execute function public.fn_attendance_compute();

-- ---------- 3) érték-ellenőrzések ----------
alter table public.workers
  add constraint chk_commission_value_nonneg
    check (commission_value is null or commission_value >= 0),
  add constraint chk_commission_percent_max
    check (commission_mode is distinct from 'percent' or commission_value is null or commission_value <= 100),
  add constraint chk_fixed_commission_needs_unit
    check (commission_mode is distinct from 'fixed' or commission_unit is not null),
  add constraint chk_worker_rates_nonneg
    check (coalesce(hourly_rate, 0) >= 0 and coalesce(daily_rate, 0) >= 0 and coalesce(project_rate, 0) >= 0);

alter table public.attendance
  add constraint chk_applied_rate_nonneg check (applied_rate is null or applied_rate >= 0),
  add constraint chk_hours_positive check (hours is null or hours > 0);

-- ---------- 4) befolyt számla jóváírása ----------
-- Aki befolytnak jelölte, annál landolt a pénz; ha nincs jelölő (közvetlen
-- adatrögzítés), marad a rögzítő.
create or replace view public.v_user_balances
with (security_invoker = true) as
with cr as (select profit_net from public.v_common_result)
select
  p.id as user_id,
  p.display_name,
  p.profit_share_percent,
  round((select profit_net from cr) * p.profit_share_percent / 100.0, 2) as profit_share_amount,
  coalesce(se.spent_expenses, 0)      as spent_expenses,
  coalesce(sw.spent_wages, 0)         as spent_wages,
  coalesce(sc.spent_commissions, 0)   as spent_commissions,
  coalesce(so.settlements_out, 0)     as settlements_out,
  coalesce(cc.commission_credit, 0)   as commission_credit,
  coalesce(ri.received_invoices, 0)   as received_invoices,
  coalesce(si.settlements_in, 0)      as settlements_in,
  round((select profit_net from cr) * p.profit_share_percent / 100.0, 2)
    + coalesce(se.spent_expenses, 0) + coalesce(sw.spent_wages, 0)
    + coalesce(sc.spent_commissions, 0) + coalesce(so.settlements_out, 0)
    + coalesce(cc.commission_credit, 0)
    - coalesce(ri.received_invoices, 0) - coalesce(si.settlements_in, 0) as balance
from public.profiles p
left join (
  select paid_by as uid, sum(net_amount) as spent_expenses
  from public.expenses where deleted_at is null group by paid_by
) se on se.uid = p.id
left join (
  select paid_by as uid, sum(amount - commission_amount) as spent_wages
  from public.attendance where deleted_at is null and paid_at is not null group by paid_by
) sw on sw.uid = p.id
left join (
  select commission_paid_by as uid, sum(commission_amount) as spent_commissions
  from public.attendance
  where deleted_at is null and referrer_external_id is not null and commission_paid_at is not null
  group by commission_paid_by
) sc on sc.uid = p.id
left join (
  select from_user as uid, sum(amount) as settlements_out
  from public.settlements where deleted_at is null group by from_user
) so on so.uid = p.id
left join (
  select referrer_user_id as uid, sum(commission_amount) as commission_credit
  from public.attendance where deleted_at is null and referrer_user_id is not null group by referrer_user_id
) cc on cc.uid = p.id
left join (
  select coalesce(paid_marked_by, created_by) as uid, sum(net_amount) as received_invoices
  from public.invoices where deleted_at is null and paid_at is not null
  group by coalesce(paid_marked_by, created_by)
) ri on ri.uid = p.id
left join (
  select to_user as uid, sum(amount) as settlements_in
  from public.settlements where deleted_at is null group by to_user
) si on si.uid = p.id;

-- ---------- 5) rendezési javaslat: 0 Ft-os sor kihagyása ----------
create or replace function public.suggested_settlements()
returns table (from_user uuid, from_name text, to_user uuid, to_name text, amount numeric)
language plpgsql
security definer set search_path = public
stable
as $$
declare
  d record;
  c_ids uuid[]; c_names text[]; c_amts numeric[];
  i integer;
  d_rem numeric;
  v numeric;
begin
  select array_agg(user_id order by balance desc),
         array_agg(display_name order by balance desc),
         array_agg(balance order by balance desc)
    into c_ids, c_names, c_amts
  from public.v_user_balances where balance > 0.005;

  if c_ids is null then
    return;
  end if;

  for d in
    select user_id, display_name, -balance as owe
    from public.v_user_balances where balance < -0.005 order by balance
  loop
    d_rem := d.owe;
    for i in 1 .. array_length(c_ids, 1) loop
      exit when d_rem <= 0.005;
      if c_amts[i] > 0.005 then
        v := least(d_rem, c_amts[i]);
        if round(v, 0) >= 1 then
          from_user := d.user_id; from_name := d.display_name;
          to_user := c_ids[i]; to_name := c_names[i];
          amount := round(v, 0);
          return next;
        end if;
        d_rem := d_rem - v;
        c_amts[i] := c_amts[i] - v;
      end if;
    end loop;
  end loop;
end;
$$;

-- ---------- 6) új felhasználó nem borítja a részesedéseket ----------
-- Az első felhasználó 100%-ot kap, minden további 0%-ot; a felosztást a
-- Beállításokban kell megadni (set_profit_shares, 100%-ellenőrzéssel).
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.profiles;
  if v_count > 0 and not exists (
    select 1 from public.allowed_emails where email = lower(new.email)
  ) then
    raise exception 'Zárt alkalmazás: ez az e-mail cím nincs engedélyezve. Kérj hozzáférést a tulajdonosoktól.';
  end if;

  insert into public.profiles (id, email, display_name, profit_share_percent)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when v_count = 0 then 100 else 0 end
  );
  return new;
end;
$$;
