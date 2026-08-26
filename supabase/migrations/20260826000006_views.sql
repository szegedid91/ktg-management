-- =============================================================
-- Fázis 2–3 — Számítási logika DB-oldali view-kban
-- Minden kimutatás NETTÓ alapú; az ÁFA külön oszlopban jelenik meg.
-- A kliens (web és mobil) ugyanazokat a view-kat kérdezi le.
-- =============================================================

-- ---------- Jelenlét részletezve (bér + közvetítői bontás + ÁFA) ----------
create or replace view public.v_attendance_detail
with (security_invoker = true) as
select
  a.id, a.work_date, a.site_id, s.name as site_name,
  a.worker_id, w.name as worker_name, w.worker_type,
  a.created_by, a.pay_basis, a.hours, a.day_multiplier, a.applied_rate,
  a.amount                                     as total_amount,
  a.amount - a.commission_amount               as worker_amount,
  a.commission_amount,
  a.referrer_user_id, a.referrer_external_id,
  pu.display_name                              as referrer_user_name,
  ep.name                                      as referrer_external_name,
  case when w.worker_type = 'company' and w.is_vat_payer
       then round(a.amount * w.vat_rate / 100.0, 2) else 0 end as vat_amount,
  a.paid_at, a.paid_by, a.commission_paid_at, a.commission_paid_by,
  a.note, a.created_at, a.updated_at, a.deleted_at
from public.attendance a
join public.workers w on w.id = a.worker_id
join public.sites s on s.id = a.site_id
left join public.profiles pu on pu.id = a.referrer_user_id
left join public.external_people ep on ep.id = a.referrer_external_id
where a.deleted_at is null;

-- ---------- Napi összesítés építkezésenként ----------
create or replace view public.v_daily_summary
with (security_invoker = true) as
with wage as (
  select site_id, work_date as d,
         sum(amount) as wage_net,
         sum(case when w.worker_type = 'company' and w.is_vat_payer
                  then round(a.amount * w.vat_rate / 100.0, 2) else 0 end) as wage_vat
  from public.attendance a join public.workers w on w.id = a.worker_id
  where a.deleted_at is null
  group by site_id, work_date
), exp as (
  select site_id, expense_date as d,
         sum(net_amount) as expense_net, sum(vat_amount) as expense_vat
  from public.expenses where deleted_at is null
  group by site_id, expense_date
), inv as (
  select site_id, invoice_date as d,
         sum(net_amount) as invoiced_net,
         sum(case when paid_at is not null then net_amount else 0 end) as paid_net
  from public.invoices where deleted_at is null
  group by site_id, invoice_date
)
select
  coalesce(wage.site_id, exp.site_id, inv.site_id) as site_id,
  coalesce(wage.d, exp.d, inv.d) as day,
  coalesce(wage_net, 0)    as wage_net,
  coalesce(wage_vat, 0)    as wage_vat,
  coalesce(expense_net, 0) as expense_net,
  coalesce(expense_vat, 0) as expense_vat,
  coalesce(wage_net, 0) + coalesce(expense_net, 0) as cost_net,
  coalesce(invoiced_net, 0) as invoiced_net,
  coalesce(paid_net, 0)     as paid_net
from wage
full outer join exp on exp.site_id = wage.site_id and exp.d = wage.d
full outer join inv on inv.site_id = coalesce(wage.site_id, exp.site_id) and inv.d = coalesce(wage.d, exp.d);

-- ---------- Építkezés-összesítő ----------
create or replace view public.v_site_totals
with (security_invoker = true) as
select
  s.id as site_id, s.name, s.status,
  coalesce(e.expense_net, 0)  as expense_net,
  coalesce(e.expense_vat, 0)  as expense_vat,
  coalesce(a.wage_net, 0)     as wage_net,
  coalesce(a.wage_vat, 0)     as wage_vat,
  coalesce(a.unpaid_wages, 0) as unpaid_wages,
  coalesce(e.expense_net, 0) + coalesce(a.wage_net, 0) as cost_net,
  coalesce(i.invoiced_net, 0) as invoiced_net,
  coalesce(i.paid_net, 0)     as paid_net,
  coalesce(i.invoice_vat, 0)  as invoice_vat,
  coalesce(i.invoiced_net, 0) - coalesce(i.paid_net, 0) as outstanding_net,
  coalesce(i.paid_net, 0) - (coalesce(e.expense_net, 0) + coalesce(a.wage_net, 0)) as profit_net,
  case when coalesce(i.paid_net, 0) <> 0
       then round((coalesce(i.paid_net, 0) - coalesce(e.expense_net, 0) - coalesce(a.wage_net, 0)) / i.paid_net * 100, 1)
  end as margin_percent
from public.sites s
left join (
  select site_id, sum(net_amount) as expense_net, sum(vat_amount) as expense_vat
  from public.expenses where deleted_at is null group by site_id
) e on e.site_id = s.id
left join (
  select a.site_id,
         sum(a.amount) as wage_net,
         sum(case when w.worker_type = 'company' and w.is_vat_payer
                  then round(a.amount * w.vat_rate / 100.0, 2) else 0 end) as wage_vat,
         sum(case when a.paid_at is null then a.amount - a.commission_amount else 0 end) as unpaid_wages
  from public.attendance a join public.workers w on w.id = a.worker_id
  where a.deleted_at is null group by a.site_id
) a on a.site_id = s.id
left join (
  select site_id,
         sum(net_amount) as invoiced_net,
         sum(vat_amount) as invoice_vat,
         sum(case when paid_at is not null then net_amount else 0 end) as paid_net
  from public.invoices where deleted_at is null group by site_id
) i on i.site_id = s.id
where s.deleted_at is null;

-- ---------- Közös eredmény ----------
create or replace view public.v_common_result
with (security_invoker = true) as
select
  coalesce((select sum(net_amount) from public.invoices where deleted_at is null and paid_at is not null), 0) as revenue_paid_net,
  coalesce((select sum(net_amount) from public.invoices where deleted_at is null), 0) as revenue_invoiced_net,
  coalesce((select sum(net_amount) from public.invoices where deleted_at is null and paid_at is null), 0) as outstanding_net,
  coalesce((select sum(net_amount) from public.expenses where deleted_at is null), 0) as expense_net,
  coalesce((select sum(amount) from public.attendance where deleted_at is null), 0) as wage_net,
  coalesce((select sum(net_amount) from public.invoices where deleted_at is null and paid_at is not null), 0)
    - coalesce((select sum(net_amount) from public.expenses where deleted_at is null), 0)
    - coalesce((select sum(amount) from public.attendance where deleted_at is null), 0) as profit_net;

-- ---------- Felhasználói egyenlegek ----------
-- Egyenleg = (neki járó profitrész + amit ő költött + neki járó közvetítői díj)
--            − (ami hozzá folyt be)
-- Pozitív egyenleg: neki jár pénz a közösből. Negatív: ő tartozik.
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
  select created_by as uid, sum(net_amount) as received_invoices
  from public.invoices where deleted_at is null and paid_at is not null group by created_by
) ri on ri.uid = p.id
left join (
  select to_user as uid, sum(amount) as settlements_in
  from public.settlements where deleted_at is null group by to_user
) si on si.uid = p.id;

-- ---------- Javasolt rendezés ----------
-- Mohó párosítás: a negatív egyenlegű (tartozó) felhasználók utaljanak
-- a pozitív egyenlegűeknek.
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
        from_user := d.user_id; from_name := d.display_name;
        to_user := c_ids[i]; to_name := c_names[i];
        amount := round(v, 0);
        return next;
        d_rem := d_rem - v;
        c_amts[i] := c_amts[i] - v;
      end if;
    end loop;
  end loop;
end;
$$;

-- ---------- Statisztikai view-k ----------
create or replace view public.v_category_stats
with (security_invoker = true) as
select
  coalesce(c.name, 'Nincs kategória') as category_name,
  e.category_id,
  e.expense_date,
  e.site_id,
  e.net_amount,
  e.vat_amount
from public.expenses e
left join public.expense_categories c on c.id = e.category_id
where e.deleted_at is null;

create or replace view public.v_monthly_stats
with (security_invoker = true) as
with m_cost as (
  select date_trunc('month', expense_date)::date as month, sum(net_amount) as expense_net
  from public.expenses where deleted_at is null group by 1
), m_wage as (
  select date_trunc('month', work_date)::date as month, sum(amount) as wage_net
  from public.attendance where deleted_at is null group by 1
), m_rev as (
  select date_trunc('month', paid_at)::date as month, sum(net_amount) as revenue_paid_net
  from public.invoices where deleted_at is null and paid_at is not null group by 1
), m_inv as (
  select date_trunc('month', invoice_date)::date as month, sum(net_amount) as revenue_invoiced_net
  from public.invoices where deleted_at is null group by 1
)
select
  coalesce(m_cost.month, m_wage.month, m_rev.month, m_inv.month) as month,
  coalesce(expense_net, 0) as expense_net,
  coalesce(wage_net, 0) as wage_net,
  coalesce(expense_net, 0) + coalesce(wage_net, 0) as cost_net,
  coalesce(revenue_paid_net, 0) as revenue_paid_net,
  coalesce(revenue_invoiced_net, 0) as revenue_invoiced_net,
  coalesce(revenue_paid_net, 0) - coalesce(expense_net, 0) - coalesce(wage_net, 0) as profit_net
from m_cost
full outer join m_wage on m_wage.month = m_cost.month
full outer join m_rev on m_rev.month = coalesce(m_cost.month, m_wage.month)
full outer join m_inv on m_inv.month = coalesce(m_cost.month, m_wage.month, m_rev.month);

create or replace view public.v_worker_stats
with (security_invoker = true) as
select
  w.id as worker_id, w.name,
  a.work_date, a.site_id,
  a.amount, a.commission_amount,
  a.amount - a.commission_amount as worker_amount,
  a.paid_at is not null as is_paid
from public.workers w
join public.attendance a on a.worker_id = w.id and a.deleted_at is null
where w.deleted_at is null;

create or replace view public.v_commission_summary
with (security_invoker = true) as
select
  coalesce(p.display_name, ep.name) as referrer_name,
  a.referrer_user_id, a.referrer_external_id,
  (a.referrer_user_id is not null) as is_user,
  a.work_date, a.site_id,
  a.commission_amount,
  case when a.referrer_external_id is not null then a.commission_paid_at is not null else null end as is_paid
from public.attendance a
left join public.profiles p on p.id = a.referrer_user_id
left join public.external_people ep on ep.id = a.referrer_external_id
where a.deleted_at is null and a.commission_amount > 0;

-- ---------- Eszközök aktuális helye ----------
create or replace view public.v_equipment_current
with (security_invoker = true) as
select distinct on (e.id)
  e.id as equipment_id, e.name, e.photo_path, e.note,
  m.site_id, s.name as site_name, m.location_label, m.taken_by, m.moved_at
from public.equipment e
left join public.equipment_moves m on m.equipment_id = e.id and m.deleted_at is null
left join public.sites s on s.id = m.site_id
where e.deleted_at is null
order by e.id, m.moved_at desc nulls last;
