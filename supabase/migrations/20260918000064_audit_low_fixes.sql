-- Átvilágítás 2026-09-17 — elhalasztott alacsony tételek:
--  1) részfeladat: munkavállaló nem írhat más done_by-t
--  2) részesedés-módosítás hatálya budapesti nap (nem UTC)
--  3) VAPID kulcspár a Vaultban (nem sima táblában); az edge-funkció RPC-n át olvassa

-- 1) részfeladat-őr
create or replace function public.fn_subtask_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.fn_is_partner() then
    if new.title <> old.title or new.position <> old.position or new.photo_required <> old.photo_required
       or new.deleted_at is distinct from old.deleted_at or new.task_id <> old.task_id then
      raise exception 'A részfeladatot csak a fő felhasználó szerkesztheti — te pipálhatod és fotózhatod.';
    end if;
  end if;
  if new.done_at is not null and old.done_at is null then
    if new.photo_required and coalesce(cardinality(new.photo_paths), 0) = 0 then
      raise exception 'Ehhez a lépéshez fotó kell, mielőtt késznek jelölöd.';
    end if;
    -- a készre jelölő mindig a hívó (munkavállaló nem írhat be mást)
    if auth.uid() is not null and not public.fn_is_partner() then new.done_by := auth.uid();
    else new.done_by := coalesce(new.done_by, auth.uid()); end if;
  end if;
  if new.done_at is null then new.done_by := null; end if;
  return new;
end $$;

-- 2) részesedés: budapesti nap
create or replace function public.propose_profit_shares(p_shares jsonb)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_others integer;
begin
  if v_me is null then raise exception 'Bejelentkezés szükséges.'; end if;
  if not public.fn_is_partner() then raise exception 'Csak a fő felhasználók módosíthatnak részesedést.'; end if;
  perform public.fn_validate_shares(p_shares);

  if exists (select 1 from public.share_change_requests
             where status = 'pending' and deleted_at is null) then
    raise exception 'Már van függőben lévő módosítási javaslat. Előbb azt kell jóváhagyni, elutasítani vagy visszavonni.';
  end if;

  select count(*) into v_others
  from public.profiles where not is_admin and worker_id is null and id <> v_me;

  if v_others = 0 then
    insert into public.share_change_requests
      (proposed_by, shares, status, effective_from, decided_by, decided_at)
    values (v_me, p_shares, 'approved', (now() at time zone 'Europe/Budapest')::date, v_me, now());
    perform public.fn_apply_shares(p_shares, (now() at time zone 'Europe/Budapest')::date);
    return 'approved';
  end if;

  insert into public.share_change_requests (proposed_by, shares)
  values (v_me, p_shares);
  return 'pending';
end;
$$;
create or replace function public.decide_share_change(p_id uuid, p_approve boolean)
returns text
language plpgsql security definer set search_path to 'public'
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
    if p_approve then
      raise exception 'A saját javaslatodat nem hagyhatod jóvá — a másik fél beleegyezése kell.';
    end if;
    update public.share_change_requests
    set status = 'cancelled', decided_by = v_me, decided_at = now()
    where id = p_id;
    return 'cancelled';
  end if;

  if not exists (select 1 from public.profiles where id = v_me and not is_admin and worker_id is null) then
    raise exception 'A jóváhagyáshoz üzleti partnernek kell lenned.';
  end if;

  if p_approve then
    perform public.fn_validate_shares(v_req.shares);
    update public.share_change_requests
    set status = 'approved', effective_from = (now() at time zone 'Europe/Budapest')::date,
        decided_by = v_me, decided_at = now()
    where id = p_id;
    perform public.fn_apply_shares(v_req.shares, (now() at time zone 'Europe/Budapest')::date);
    return 'approved';
  else
    update public.share_change_requests
    set status = 'rejected', decided_by = v_me, decided_at = now()
    where id = p_id;
    return 'rejected';
  end if;
end;
$$;

-- 3) VAPID → Vault
do $$
declare v_pub text; v_priv text;
begin
  select value into v_pub from public.app_secrets where name = 'vapid_public';
  select value into v_priv from public.app_secrets where name = 'vapid_private';
  if v_pub is not null and not exists (select 1 from vault.secrets where name = 'vapid_public') then
    perform vault.create_secret(v_pub, 'vapid_public');
  end if;
  if v_priv is not null and not exists (select 1 from vault.secrets where name = 'vapid_private') then
    perform vault.create_secret(v_priv, 'vapid_private');
  end if;
  -- a privát kulcs a sima táblából törölve (a publikus maradhat: a kliens is ismeri)
  delete from public.app_secrets where name = 'vapid_private' and exists (select 1 from vault.secrets where name = 'vapid_private');
end $$;
create or replace function public.fn_vapid_keys()
returns table (public_key text, private_key text)
language sql stable security definer set search_path = public as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_public'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private');
$$;
revoke all on function public.fn_vapid_keys() from public, anon, authenticated;
grant execute on function public.fn_vapid_keys() to service_role;
