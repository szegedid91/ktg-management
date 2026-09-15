-- Személyre szóló meghívó: a regisztrációs oldal a token alapján előre
-- kitölti a partner által felvitt adatokat (név, e-mail, telefon, szakma),
-- így csak jelszót kell megadni; a munkavállaló a nevét, e-mailjét,
-- telefonszámát módosíthatja, a becenevet nem (azt nem is látja).

create or replace function public.invite_info(p_token text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case
    when i.id is null then jsonb_build_object('kind', 'invalid')
    when i.contractor_id is not null then jsonb_build_object('kind', 'contractor')
    when i.worker_id is null then jsonb_build_object('kind', 'generic')
    else jsonb_build_object('kind', 'personal',
           'name', w.name, 'email', w.email, 'phone', w.phones[1], 'trade', w.trade)
  end
  from (select 1) x
  left join public.worker_invites i
    on i.token = p_token and i.expires_at > now() and (i.worker_id is null or i.used_at is null)
  left join public.workers w on w.id = i.worker_id and w.deleted_at is null
  where p_token is not null and length(p_token) between 32 and 128;
$$;
revoke all on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to anon, authenticated;

-- regisztráció: a személyre szóló meghívónál a megadott név/telefon/szakma/e-mail a rekordra kerül
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
      -- a munkavállaló a regisztrációkor módosíthatja a nevét, telefonját, szakmáját;
      -- az e-mail a regisztrált cím lesz; a becenév (partner-belső) nem változik
      update public.workers set
        name = coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''), name),
        phones = case when v_phone is not null then array[v_phone] else phones end,
        trade = coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'trade', '')), ''), trade),
        email = new.email,
        is_contractor = is_contractor or v_contractor
      where id = v_worker_id;
    end if;

    select name into v_worker_name from public.workers where id = v_worker_id;
    insert into public.profiles (id, email, display_name, profit_share_percent, is_admin, worker_id,
                                 notify_comments, notify_big_expense, notify_weekly, notify_overdue)
    values (new.id, new.email,
            coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), v_worker_name, split_part(new.email, '@', 1)),
            0, false, v_worker_id, false, false, false, false);
    if v_invite.worker_id is not null then
      update public.worker_invites set used_at = now(), used_by = new.id, uses = uses + 1 where id = v_invite.id;
    end if;
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
