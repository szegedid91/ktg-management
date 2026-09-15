-- Vállalkozói meghívó: a vállalkozóként regisztrált munkavállaló is készíthet
-- meghívó linket / QR-kódot; az azzal regisztráló fiók MINDIG az ő embere
-- lesz (contractor_id), jóváhagyás nélkül, a vállalkozó díjazását örökölve —
-- a bére a vállalkozóhoz kerül, emberenként részletezve.

alter table public.worker_invites
  add column if not exists contractor_id uuid references public.workers(id) on delete cascade;
create index if not exists worker_invites_contractor_idx on public.worker_invites(contractor_id) where contractor_id is not null;

-- a vállalkozóm azonosítója (ha én valakinek az embere vagyok)
create or replace function public.fn_my_contractor_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select w.contractor_id from public.workers w where w.id = public.fn_my_worker_id();
$$;
revoke execute on function public.fn_my_contractor_id() from public, anon;
grant execute on function public.fn_my_contractor_id() to authenticated;

-- az ember látja a vállalkozóját (név a kezdőlapon)
drop policy if exists workers_select on public.workers;
create policy workers_select on public.workers for select to authenticated
  using (public.fn_is_partner() or id = any(public.fn_my_worker_ids()) or id = public.fn_my_contractor_id());

drop policy if exists wi_select on public.worker_invites;
create policy wi_select on public.worker_invites for select to authenticated
  using (public.fn_is_partner() or (contractor_id is not null and contractor_id = public.fn_my_worker_id()));

-- meghívó készítése: partner (általános vagy személyre szóló) VAGY vállalkozó (csak általános, a saját embereinek)
create or replace function public.create_worker_invite(p_worker uuid default null)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_token text;
  v_me public.workers%rowtype;
begin
  if auth.uid() is null then raise exception 'Nincs bejelentkezve.'; end if;

  if not public.fn_is_partner() then
    select * into v_me from public.workers where id = public.fn_my_worker_id();
    if v_me.id is null or not v_me.is_contractor then
      raise exception 'Meghívót csak a fő felhasználók vagy vállalkozóként regisztrált munkavállalók készíthetnek.';
    end if;
    if p_worker is not null then raise exception 'Vállalkozó csak általános meghívót készíthet.'; end if;
    select token into v_token from public.worker_invites
    where contractor_id = v_me.id and expires_at > now() and coalesce(uses, 0) < 20
    order by created_at desc limit 1;
    if v_token is not null then return v_token; end if;
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.worker_invites (worker_id, token, created_by, contractor_id)
    values (null, v_token, auth.uid(), v_me.id);
    return v_token;
  end if;

  if p_worker is null then
    select token into v_token from public.worker_invites
    where worker_id is null and contractor_id is null and expires_at > now() and coalesce(uses, 0) < 20
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
revoke all on function public.create_worker_invite(uuid) from public, anon;
grant execute on function public.create_worker_invite(uuid) to authenticated;

-- regisztráció: vállalkozói meghívónál az új fiók a vállalkozó embere lesz
create or replace function public.fn_handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_count integer;
  v_partner_count integer;
  v_admin boolean;
  v_token text;
  v_invite record;
  v_worker_id uuid;
  v_worker_name text;
  v_phone text;
  v_contractor boolean;
  v_boss public.workers%rowtype;
begin
  v_token := new.raw_user_meta_data->>'invite_token';
  if v_token is not null and v_token <> '' then
    select * into v_invite from public.worker_invites
    where token = v_token and expires_at > now() and (worker_id is null or used_at is null)
    for update;
    if not found then
      raise exception 'A meghívó érvénytelen vagy lejárt. Kérj újat a fő felhasználóktól!';
    end if;
    v_contractor := coalesce((new.raw_user_meta_data->>'is_contractor')::boolean, false);
    v_phone := nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '');

    if v_invite.contractor_id is not null then
      -- vállalkozói meghívó: az új fiók mindig a vállalkozó embere
      select * into v_boss from public.workers where id = v_invite.contractor_id and deleted_at is null and is_contractor;
      if v_boss.id is null then
        raise exception 'A meghívó vállalkozója már nem aktív. Kérj új meghívót!';
      end if;
      if coalesce(v_invite.uses, 0) >= 20 then
        raise exception 'Ezt a meghívót már túl sokan használták. Kérj újat a vállalkozódtól!';
      end if;
      if (select count(*) from public.workers where contractor_id = v_boss.id and deleted_at is null) >= 50 then
        raise exception 'A vállalkozó már elérte az 50 fős létszámot.';
      end if;
      insert into public.workers (name, phones, trade, email, created_by, is_contractor, worker_type, contractor_id,
                                  approved_at, approved_by, default_pay_basis, hourly_rate, daily_rate, project_rate)
      values (
        coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''), split_part(new.email, '@', 1)),
        case when v_phone is null then '{}'::text[] else array[v_phone] end,
        nullif(trim(coalesce(new.raw_user_meta_data->>'trade', '')), ''),
        new.email, v_boss.created_by, false, v_boss.worker_type, v_boss.id,
        now(), coalesce(v_boss.approved_by, v_boss.created_by),
        v_boss.default_pay_basis, v_boss.hourly_rate, v_boss.daily_rate, v_boss.project_rate
      ) returning id into v_worker_id;
      update public.worker_invites set uses = uses + 1 where id = v_invite.id;
    elsif v_invite.worker_id is null then
      if coalesce(v_invite.uses, 0) >= 20 then
        raise exception 'Ezt a meghívót már túl sokan használták. Kérj újat a fő felhasználóktól!';
      end if;
      insert into public.workers (name, phones, trade, email, created_by, is_contractor, worker_type)
      values (
        coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''), split_part(new.email, '@', 1)),
        case when v_phone is null then '{}'::text[] else array[v_phone] end,
        nullif(trim(coalesce(new.raw_user_meta_data->>'trade', '')), ''),
        new.email,
        v_invite.created_by,
        v_contractor,
        case when v_contractor then 'company' else 'individual' end
      ) returning id into v_worker_id;
      update public.worker_invites set uses = uses + 1 where id = v_invite.id;
    else
      if exists (select 1 from public.profiles where worker_id = v_invite.worker_id) then
        raise exception 'Ehhez a munkavállalóhoz már tartozik fiók.';
      end if;
      v_worker_id := v_invite.worker_id;
      update public.workers set email = coalesce(email, new.email), is_contractor = is_contractor or v_contractor where id = v_worker_id;
      update public.worker_invites set used_at = now(), used_by = new.id, uses = uses + 1 where id = v_invite.id;
    end if;

    select name into v_worker_name from public.workers where id = v_worker_id;
    insert into public.profiles (id, email, display_name, profit_share_percent, is_admin, worker_id,
                                 notify_comments, notify_big_expense, notify_weekly, notify_overdue)
    values (new.id, new.email,
            coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), v_worker_name, split_part(new.email, '@', 1)),
            0, false, v_worker_id, false, false, false, false);
    begin
      update auth.users set raw_user_meta_data = raw_user_meta_data - 'invite_token' where id = new.id;
    exception when others then null; end;
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
end $$;

-- értesítés: a vállalkozó embere nem vár jóváhagyásra, csak jelezzük
create or replace function public.fn_notify_worker_joined()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare r record; v_name text; v_contr boolean; v_boss text;
begin
  if new.worker_id is null then return new; end if;
  select coalesce(w.nickname, w.name), w.is_contractor, coalesce(b.nickname, b.name)
    into v_name, v_contr, v_boss
  from public.workers w left join public.workers b on b.id = w.contractor_id
  where w.id = new.worker_id;
  for r in select id from public.profiles where worker_id is null loop
    if v_boss is not null then
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('worker_joined', r.id, 'Vállalkozó új embere regisztrált 👥',
              coalesce(v_name, new.display_name) || ' (' || coalesce(new.email, '') || ') ' || v_boss
              || ' meghívójával regisztrált — az ő embere, a bére a vállalkozóhoz kerül, emberenként részletezve. Nem kell jóváhagyni.',
              jsonb_build_object('worker_id', new.worker_id));
    else
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('worker_joined', r.id,
              case when v_contr then 'Új vállalkozó vár jóváhagyásra 👥' else 'Új munkavállaló vár jóváhagyásra 👷' end,
              coalesce(v_name, new.display_name) || ' regisztrált (' || coalesce(new.email, '') ||
              case when v_contr then ') vállalkozóként — saját embereket hoz. ' else '). ' end
              || 'Nézd át a díjazását és hagyd jóvá, hogy be tudjon lépni.',
              jsonb_build_object('worker_id', new.worker_id));
    end if;
  end loop;
  return new;
end;
$$;

-- munkavállaló adatait bármelyik fő felhasználó szerkesztheti (regisztráció után is),
-- nem csak az, aki felvette / akinek a meghívójával regisztrált
drop policy if exists workers_update on public.workers;
create policy workers_update on public.workers for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());
drop policy if exists workers_delete on public.workers;
create policy workers_delete on public.workers for delete to authenticated
  using (public.fn_is_partner());
