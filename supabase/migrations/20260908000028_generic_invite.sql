-- Általános meghívó: a partner nem tölt ki előre munkavállalót — a
-- munkavállaló a regisztrációkor adja meg az adatait (név, becenév, telefon,
-- szakma), és a munkavállaló-rekord automatikusan létrejön + hozzá kötődik.
-- Az általános meghívó 7 napig több munkavállaló által is használható
-- (QR kivetítve), a személyre szóló továbbra is egyszer használatos.

alter table public.worker_invites alter column worker_id drop not null;
alter table public.worker_invites add column if not exists uses integer not null default 0;

create or replace function public.create_worker_invite(p_worker uuid default null)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_token text;
begin
  if auth.uid() is null or not public.fn_is_partner() then
    raise exception 'Meghívót csak a fő felhasználók készíthetnek.';
  end if;

  if p_worker is null then
    -- általános meghívó: élő példány újrahasznosítása
    select token into v_token from public.worker_invites
    where worker_id is null and expires_at > now()
    order by created_at desc limit 1;
    if v_token is not null then return v_token; end if;
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.worker_invites (worker_id, token, created_by) values (null, v_token, auth.uid());
    return v_token;
  end if;

  if not exists (select 1 from public.workers where id = p_worker and deleted_at is null) then
    raise exception 'A munkavállaló nem található.';
  end if;
  if exists (select 1 from public.profiles where worker_id = p_worker) then
    raise exception 'Ehhez a munkavállalóhoz már tartozik fiók.';
  end if;
  select token into v_token from public.worker_invites
  where worker_id = p_worker and used_at is null and expires_at > now()
  order by created_at desc limit 1;
  if v_token is not null then return v_token; end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.worker_invites (worker_id, token, created_by) values (p_worker, v_token, auth.uid());
  return v_token;
end;
$$;

create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
  v_partner_count integer;
  v_admin boolean;
  v_token text;
  v_invite record;
  v_worker_id uuid;
  v_worker_name text;
  v_phone text;
begin
  v_token := new.raw_user_meta_data->>'invite_token';
  if v_token is not null and v_token <> '' then
    select * into v_invite from public.worker_invites
    where token = v_token and expires_at > now() and (worker_id is null or used_at is null);
    if not found then
      raise exception 'A meghívó érvénytelen vagy lejárt. Kérj újat a fő felhasználóktól!';
    end if;

    if v_invite.worker_id is null then
      -- általános meghívó: a munkavállaló-rekord a megadott adatokból jön létre
      v_phone := nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '');
      insert into public.workers (name, nickname, phones, trade, email, created_by)
      values (
        coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''), split_part(new.email, '@', 1)),
        nullif(trim(coalesce(new.raw_user_meta_data->>'nickname', '')), ''),
        case when v_phone is null then '{}'::text[] else array[v_phone] end,
        nullif(trim(coalesce(new.raw_user_meta_data->>'trade', '')), ''),
        new.email,
        v_invite.created_by
      ) returning id into v_worker_id;
      update public.worker_invites set uses = uses + 1 where id = v_invite.id;
    else
      if exists (select 1 from public.profiles where worker_id = v_invite.worker_id) then
        raise exception 'Ehhez a munkavállalóhoz már tartozik fiók.';
      end if;
      v_worker_id := v_invite.worker_id;
      -- a személyre szóló meghívónál a megadott becenév/telefon a rekordra kerül
      update public.workers set
        nickname = coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'nickname', '')), ''), nickname),
        email = coalesce(email, new.email)
      where id = v_worker_id;
      update public.worker_invites set used_at = now(), used_by = new.id, uses = uses + 1 where id = v_invite.id;
    end if;

    select name into v_worker_name from public.workers where id = v_worker_id;
    insert into public.profiles (id, email, display_name, profit_share_percent, is_admin, worker_id,
                                 notify_comments, notify_big_expense, notify_weekly, notify_overdue)
    values (new.id, new.email,
            coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), v_worker_name, split_part(new.email, '@', 1)),
            0, false, v_worker_id, false, false, false, false);
    return new;
  end if;

  select count(*) into v_count from public.profiles;
  if v_count > 0 and not exists (
    select 1 from public.allowed_emails where email = lower(new.email)
  ) then
    raise exception 'Zárt alkalmazás: ez az e-mail cím nincs engedélyezve. Kérj hozzáférést a tulajdonosoktól.';
  end if;

  select coalesce(ae.is_admin, false) into v_admin
  from public.allowed_emails ae where ae.email = lower(new.email);
  v_admin := coalesce(v_admin, false);

  select count(*) into v_partner_count from public.profiles where not is_admin and worker_id is null;

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
