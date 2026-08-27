-- Részesedés-módosítás jóváhagyással és időszakos érvényességgel:
--  1) profit_share_history: melyik naptól mennyi a részesedés — a
--     számítások minden tételre a tétel dátumakor érvényes százalékot
--     használják, így a módosítás sosem visszamenőleges.
--  2) share_change_requests: a módosítás javaslatként indul, és csak a
--     másik üzleti partner jóváhagyásával lép életbe (a jóváhagyás
--     napjától). Egyetlen partner esetén azonnal érvénybe lép.
--  3) v_user_balances: eredmény-részesedés tételenként, dátum szerint.

-- ---------- 1) részesedés-történet ----------
create table if not exists public.profit_share_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  percent numeric(5,2) not null check (percent >= 0 and percent <= 100),
  valid_from date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, valid_from)
);
create index if not exists idx_psh_user_from on public.profit_share_history (user_id, valid_from desc);

alter table public.profit_share_history enable row level security;
drop policy if exists psh_select on public.profit_share_history;
create policy psh_select on public.profit_share_history
  for select using (auth.uid() is not null);
-- írás csak a definer függvényeken keresztül

drop trigger if exists trg_touch_profit_share_history on public.profit_share_history;
create trigger trg_touch_profit_share_history
  before insert or update on public.profit_share_history
  for each row execute function public.fn_touch_updated_at();

-- kezdőállapot: a jelenlegi részesedések a kezdetektől érvényesek
insert into public.profit_share_history (user_id, percent, valid_from)
select id, profit_share_percent, date '2000-01-01'
from public.profiles where not is_admin
on conflict (user_id, valid_from) do nothing;

-- ---------- 2) módosítási javaslatok ----------
create table if not exists public.share_change_requests (
  id uuid primary key default gen_random_uuid(),
  proposed_by uuid not null references public.profiles(id),
  shares jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  effective_from date,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.share_change_requests enable row level security;
drop policy if exists scr_select on public.share_change_requests;
create policy scr_select on public.share_change_requests
  for select using (auth.uid() is not null);

drop trigger if exists trg_touch_share_change_requests on public.share_change_requests;
create trigger trg_touch_share_change_requests
  before insert or update on public.share_change_requests
  for each row execute function public.fn_touch_updated_at();

-- ---------- részesedés adott napon ----------
create or replace function public.share_at(p_user uuid, p_date date)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (select percent from public.profit_share_history
      where user_id = p_user and valid_from <= p_date and deleted_at is null
      order by valid_from desc limit 1),
    (select profit_share_percent from public.profiles where id = p_user),
    0);
$$;

-- ---------- közös ellenőrzés ----------
create or replace function public.fn_validate_shares(p_shares jsonb)
returns void
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_sum numeric;
  r record;
begin
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
    if not exists (select 1 from public.profiles where id = r.user_id and not is_admin) then
      raise exception 'Ismeretlen felhasználó a részesedések között.';
    end if;
  end loop;
end;
$$;

-- ---------- javaslat életbe léptetése (belső) ----------
create or replace function public.fn_apply_shares(p_shares jsonb, p_from date)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  r record;
begin
  for r in select (e->>'user_id')::uuid as user_id, (e->>'percent')::numeric as percent
           from jsonb_array_elements(p_shares) e
  loop
    insert into public.profit_share_history (user_id, percent, valid_from)
    values (r.user_id, r.percent, p_from)
    on conflict (user_id, valid_from)
      do update set percent = excluded.percent, deleted_at = null;
    update public.profiles set profit_share_percent = r.percent
    where id = r.user_id and not is_admin;
  end loop;
end;
$$;

-- ---------- javaslat beadása ----------
create or replace function public.propose_profit_shares(p_shares jsonb)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_others integer;
begin
  if v_me is null then raise exception 'Bejelentkezés szükséges.'; end if;
  perform public.fn_validate_shares(p_shares);

  if exists (select 1 from public.share_change_requests
             where status = 'pending' and deleted_at is null) then
    raise exception 'Már van függőben lévő módosítási javaslat. Előbb azt kell jóváhagyni, elutasítani vagy visszavonni.';
  end if;

  -- ha a javaslattevőn kívül nincs másik üzleti partner, nincs kitől
  -- beleegyezést kérni: azonnal életbe lép
  select count(*) into v_others
  from public.profiles where not is_admin and id <> v_me;

  if v_others = 0 then
    insert into public.share_change_requests
      (proposed_by, shares, status, effective_from, decided_by, decided_at)
    values (v_me, p_shares, 'approved', current_date, v_me, now());
    perform public.fn_apply_shares(p_shares, current_date);
    return 'approved';
  end if;

  insert into public.share_change_requests (proposed_by, shares)
  values (v_me, p_shares);
  return 'pending';
end;
$$;

-- ---------- döntés (jóváhagyás / elutasítás / visszavonás) ----------
create or replace function public.decide_share_change(p_id uuid, p_approve boolean)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_req public.share_change_requests%rowtype;
begin
  if v_me is null then raise exception 'Bejelentkezés szükséges.'; end if;

  select * into v_req from public.share_change_requests
  where id = p_id and deleted_at is null for update;
  if not found then raise exception 'A javaslat nem található.'; end if;
  if v_req.status <> 'pending' then
    raise exception 'Ez a javaslat már el lett bírálva.';
  end if;

  if v_me = v_req.proposed_by then
    -- a javaslattevő csak visszavonhatja
    if p_approve then
      raise exception 'A saját javaslatodat nem hagyhatod jóvá — a másik fél beleegyezése kell.';
    end if;
    update public.share_change_requests
    set status = 'cancelled', decided_by = v_me, decided_at = now()
    where id = p_id;
    return 'cancelled';
  end if;

  if not exists (select 1 from public.profiles where id = v_me and not is_admin) then
    raise exception 'A jóváhagyáshoz üzleti partnernek kell lenned.';
  end if;

  if p_approve then
    perform public.fn_validate_shares(v_req.shares);
    update public.share_change_requests
    set status = 'approved', effective_from = current_date,
        decided_by = v_me, decided_at = now()
    where id = p_id;
    perform public.fn_apply_shares(v_req.shares, current_date);
    return 'approved';
  else
    update public.share_change_requests
    set status = 'rejected', decided_by = v_me, decided_at = now()
    where id = p_id;
    return 'rejected';
  end if;
end;
$$;

-- a közvetlen (beleegyezés nélküli) állítás megszűnik
drop function if exists public.set_profit_shares(jsonb);

-- ---------- 3) egyenlegek: részesedés tételenként, dátum szerint ----------
create or replace view public.v_user_balances as
select
  p.id as user_id,
  p.display_name,
  p.profit_share_percent,
  round(
      coalesce((select sum(i.net_amount * public.share_at(p.id, i.paid_at) / 100.0)
                from public.invoices i
                where i.deleted_at is null and i.paid_at is not null), 0)
    - coalesce((select sum(e.net_amount * public.share_at(p.id, e.expense_date) / 100.0)
                from public.expenses e
                where e.deleted_at is null), 0)
    - coalesce((select sum(a.amount * public.share_at(p.id, a.work_date) / 100.0)
                from public.attendance a
                where a.deleted_at is null), 0)
  , 2) as profit_share_amount,
  coalesce(se.spent_expenses, 0::numeric) as spent_expenses,
  coalesce(sw.spent_wages, 0::numeric) as spent_wages,
  coalesce(sc.spent_commissions, 0::numeric) as spent_commissions,
  coalesce(so.settlements_out, 0::numeric) as settlements_out,
  coalesce(cc.commission_credit, 0::numeric) as commission_credit,
  coalesce(ri.received_invoices, 0::numeric) as received_invoices,
  coalesce(si.settlements_in, 0::numeric) as settlements_in,
  round(
      coalesce((select sum(i.net_amount * public.share_at(p.id, i.paid_at) / 100.0)
                from public.invoices i
                where i.deleted_at is null and i.paid_at is not null), 0)
    - coalesce((select sum(e.net_amount * public.share_at(p.id, e.expense_date) / 100.0)
                from public.expenses e
                where e.deleted_at is null), 0)
    - coalesce((select sum(a.amount * public.share_at(p.id, a.work_date) / 100.0)
                from public.attendance a
                where a.deleted_at is null), 0)
  , 2)
    + coalesce(se.spent_expenses, 0::numeric)
    + coalesce(sw.spent_wages, 0::numeric)
    + coalesce(sc.spent_commissions, 0::numeric)
    + coalesce(so.settlements_out, 0::numeric)
    + coalesce(cc.commission_credit, 0::numeric)
    - coalesce(ri.received_invoices, 0::numeric)
    - coalesce(si.settlements_in, 0::numeric) as balance
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
  from public.attendance where deleted_at is null and referrer_user_id is not null
  group by referrer_user_id
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
