-- Admin szerep: az engedélyezőlistán kijelölt admin e-mail regisztrációkor
-- admin-profilt kap. Az admin nem szerepel az elszámolásban/egyenlegekben
-- (nem üzleti partner), viszont egyedül ő kezelheti, ki regisztrálhat.
-- Amíg nincs admin, a meglévő felhasználók kezelhetik a listát (bootstrap).

alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.allowed_emails add column if not exists is_admin boolean not null default false;

-- az is_admin jogot csak admin adhat/vehet el (a service-hívás kivétel)
create or replace function public.fn_protect_admin_flag()
returns trigger
language plpgsql
as $$
begin
  if new.is_admin is distinct from old.is_admin
     and auth.uid() is not null
     and not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Az admin-jogot csak admin módosíthatja.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_protect_admin_flag on public.profiles;
create trigger trg_protect_admin_flag
  before update on public.profiles
  for each row execute function public.fn_protect_admin_flag();

-- az engedélyezőlistát csak admin kezelheti (amíg nincs admin: bárki bejelentkezett)
drop policy if exists allowed_emails_insert on public.allowed_emails;
create policy allowed_emails_insert on public.allowed_emails
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin)
    or not exists (select 1 from public.profiles where is_admin)
  );
drop policy if exists allowed_emails_delete on public.allowed_emails;
create policy allowed_emails_delete on public.allowed_emails
  for delete to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin)
    or not exists (select 1 from public.profiles where is_admin)
  );

-- regisztráció: az admin-e-mail admin-profilt kap (0% részesedéssel);
-- az első NEM-admin felhasználó 100%-ot, a többi 0%-ot
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
  v_partner_count integer;
  v_admin boolean;
begin
  select count(*) into v_count from public.profiles;
  if v_count > 0 and not exists (
    select 1 from public.allowed_emails where email = lower(new.email)
  ) then
    raise exception 'Zárt alkalmazás: ez az e-mail cím nincs engedélyezve. Kérj hozzáférést a tulajdonosoktól.';
  end if;

  select coalesce(ae.is_admin, false) into v_admin
  from public.allowed_emails ae where ae.email = lower(new.email);
  v_admin := coalesce(v_admin, false);

  select count(*) into v_partner_count from public.profiles where not is_admin;

  insert into public.profiles (id, email, display_name, profit_share_percent, is_admin)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when v_admin then 0 when v_partner_count = 0 then 100 else 0 end,
    v_admin
  );
  return new;
end;
$$;

-- az admin nem szerepel az egyenlegekben / javasolt rendezésben
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
) si on si.uid = p.id
where not p.is_admin;
