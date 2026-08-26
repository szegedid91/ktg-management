-- =============================================================
-- Fázis 1–2 — RPC függvények
-- Kifizetés-pipák (bárki fizethet, nem csak a rögzítő), titkosított
-- bankszámlaszám, profitrészesedés-validálás, lezárási checklist,
-- "tegnap ugyanaz" másolás.
-- =============================================================

-- ---------- Titkosítási kulcs a Vaultban ----------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'bank_account_key') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'bank_account_key');
  end if;
end;
$$;

create or replace function public.set_worker_bank_account(p_worker uuid, p_account text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare v_key text;
begin
  if not exists (select 1 from public.workers where id = p_worker and created_by = auth.uid()) then
    raise exception 'Csak a saját magad által rögzített munkavállalót szerkesztheted.';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'bank_account_key';
  update public.workers
     set bank_account_enc = case when p_account is null or p_account = '' then null
                                 else pgp_sym_encrypt(p_account, v_key) end
   where id = p_worker;
end;
$$;

create or replace function public.get_worker_bank_account(p_worker uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare v_key text; v_enc bytea;
begin
  if auth.uid() is null then
    raise exception 'Bejelentkezés szükséges.';
  end if;
  select bank_account_enc into v_enc from public.workers where id = p_worker;
  if v_enc is null then
    return null;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'bank_account_key';
  return pgp_sym_decrypt(v_enc, v_key);
end;
$$;

-- ---------- Kifizetés-pipák ----------
-- Bárki kipipálhatja (ő a fizető), ezért security definer.
-- A pipa rögzíti, KI fizette és MIKOR — ez terheli az ő egyenlegét.
create or replace function public.mark_attendance_paid(p_ids uuid[], p_paid boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.attendance
     set paid_at = case when p_paid then now() end,
         paid_by = case when p_paid then auth.uid() end
   where id = any(p_ids) and deleted_at is null;
end;
$$;

create or replace function public.mark_commission_paid(p_ids uuid[], p_paid boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.attendance
     set commission_paid_at = case when p_paid then now() end,
         commission_paid_by = case when p_paid then auth.uid() end
   where id = any(p_ids) and deleted_at is null and referrer_external_id is not null;
end;
$$;

create or replace function public.mark_invoice_paid(p_id uuid, p_paid boolean, p_date date default current_date)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.invoices
     set paid_at = case when p_paid then p_date end,
         paid_marked_by = case when p_paid then auth.uid() end
   where id = p_id and deleted_at is null;
end;
$$;

-- ---------- Profitrészesedés: az összegnek 100%-nak kell lennie ----------
create or replace function public.set_profit_shares(p_shares jsonb)
returns void
language plpgsql
security definer set search_path = public
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
  if (select count(*) from jsonb_array_elements(p_shares)) <> (select count(*) from public.profiles) then
    raise exception 'Minden felhasználóhoz meg kell adni a részesedést.';
  end if;

  for r in select (e->>'user_id')::uuid as user_id, (e->>'percent')::numeric as percent
           from jsonb_array_elements(p_shares) e
  loop
    update public.profiles set profit_share_percent = r.percent where id = r.user_id;
  end loop;
end;
$$;

-- ---------- Lezárási checklist ----------
create or replace function public.site_close_checklist(p_site uuid)
returns jsonb
language sql
security definer set search_path = public
stable
as $$
  select jsonb_build_object(
    'unpaid_invoices', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'net_amount', i.net_amount, 'invoice_date', i.invoice_date))
      from public.invoices i
      where i.site_id = p_site and i.deleted_at is null and i.paid_at is null
    ), '[]'::jsonb),
    'unpaid_wages', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'work_date', a.work_date, 'worker_name', w.name, 'amount', a.amount - a.commission_amount))
      from public.attendance a join public.workers w on w.id = a.worker_id
      where a.site_id = p_site and a.deleted_at is null and a.pay_basis <> 'presence'
        and a.amount - a.commission_amount > 0 and a.paid_at is null
    ), '[]'::jsonb),
    'unpaid_commissions', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'work_date', a.work_date, 'referrer_name', ep.name, 'amount', a.commission_amount))
      from public.attendance a join public.external_people ep on ep.id = a.referrer_external_id
      where a.site_id = p_site and a.deleted_at is null
        and a.commission_amount > 0 and a.commission_paid_at is null
    ), '[]'::jsonb)
  );
$$;

-- Lezárás: ha a checklist nem üres, csak p_force = true esetén zár le.
create or replace function public.close_site(p_site uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_checklist jsonb;
  v_has_issues boolean;
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;

  v_checklist := public.site_close_checklist(p_site);
  v_has_issues := jsonb_array_length(v_checklist->'unpaid_invoices') > 0
               or jsonb_array_length(v_checklist->'unpaid_wages') > 0
               or jsonb_array_length(v_checklist->'unpaid_commissions') > 0;

  if v_has_issues and not p_force then
    return v_checklist || jsonb_build_object('closed', false);
  end if;

  update public.sites
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where id = p_site and deleted_at is null;

  return v_checklist || jsonb_build_object('closed', true);
end;
$$;

create or replace function public.reopen_site(p_site uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;
  update public.sites
     set status = 'active', closed_at = null, closed_by = null
   where id = p_site and deleted_at is null;
end;
$$;

-- ---------- "Tegnap ugyanaz" ----------
-- Az adott építkezés legutóbbi korábbi napjának jelenléti tételeit másolja
-- a megadott napra. Projektdíjas tétel díj nélküli jelenlétként másolódik,
-- hogy a projektdíj ne terhelődjön kétszer.
create or replace function public.copy_attendance_from_previous_day(p_site uuid, p_date date)
returns setof public.attendance
language plpgsql
security definer set search_path = public
as $$
declare
  v_prev date;
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;

  select max(work_date) into v_prev
  from public.attendance
  where site_id = p_site and work_date < p_date and deleted_at is null;

  if v_prev is null then
    return;
  end if;

  return query
  insert into public.attendance
    (work_date, site_id, worker_id, created_by, pay_basis, hours, day_multiplier, applied_rate, note)
  select p_date, a.site_id, a.worker_id, auth.uid(),
         case when a.pay_basis = 'project' then 'presence' else a.pay_basis end,
         a.hours, a.day_multiplier,
         case when a.pay_basis = 'project' then null else a.applied_rate end,
         null
    from public.attendance a
   where a.site_id = p_site and a.work_date = v_prev and a.deleted_at is null
     and not exists (
       select 1 from public.attendance b
        where b.site_id = p_site and b.work_date = p_date
          and b.worker_id = a.worker_id and b.deleted_at is null
     )
  returning *;
end;
$$;
