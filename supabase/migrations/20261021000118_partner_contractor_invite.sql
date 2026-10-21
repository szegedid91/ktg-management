-- A vezető is készíthet meghívót egy kijelölt vállalkozó csapatába (2026-10-21, Daniel kérése): aki a
-- linkkel regisztrál, egyből a vállalkozó embere lesz (ugyanúgy, mintha a vállalkozó maga hívta volna meg:
-- a vállalkozó díjazása öröklődik, a kifizetés a vállalkozóhoz megy). A függvény új, második paramétert
-- kap (p_contractor); a régi egyparaméteres változatot eldobjuk, hogy a hívás egyértelmű maradjon.
drop function if exists public.create_worker_invite(uuid);
create or replace function public.create_worker_invite(p_worker uuid default null::uuid, p_contractor uuid default null::uuid)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare
  v_token text;
  v_me public.workers%rowtype;
begin
  if auth.uid() is null then raise exception 'Nincs bejelentkezve.'; end if;

  if not public.fn_is_partner() then
    select * into v_me from public.workers where id = public.fn_my_worker_id();
    if v_me.id is null or not v_me.is_contractor then
      raise exception 'Meghívót csak a vezetők vagy vállalkozóként regisztrált munkavállalók készíthetnek.';
    end if;
    if p_contractor is not null and p_contractor <> v_me.id then
      raise exception 'Másik vállalkozó csapatába csak a vezetők hívhatnak meg.';
    end if;

    if p_worker is not null then
      -- személyre szóló meghívó a saját, már felvett embernek
      if not exists (select 1 from public.workers w where w.id = p_worker and w.contractor_id = v_me.id and w.deleted_at is null) then
        raise exception 'Csak a saját embereidnek készíthetsz személyre szóló meghívót.';
      end if;
      if exists (select 1 from public.profiles where worker_id = p_worker) then
        raise exception 'Ehhez az emberedhez már tartozik fiók.';
      end if;
      select token into v_token from public.worker_invites
      where worker_id = p_worker and used_at is null and expires_at > now()
      order by created_at desc limit 1;
      if v_token is not null then return v_token; end if;
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      insert into public.worker_invites (worker_id, token, created_by) values (p_worker, v_token, auth.uid());
      return v_token;
    end if;

    select token into v_token from public.worker_invites
    where contractor_id = v_me.id and expires_at > now() and coalesce(uses, 0) < 20
    order by created_at desc limit 1;
    if v_token is not null then return v_token; end if;
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.worker_invites (worker_id, token, created_by, contractor_id)
    values (null, v_token, auth.uid(), v_me.id);
    return v_token;
  end if;

  -- vezető: meghívó egy kijelölt vállalkozó csapatába
  if p_contractor is not null then
    if not exists (select 1 from public.workers w where w.id = p_contractor and w.is_contractor and w.deleted_at is null and w.approved_at is not null) then
      raise exception 'A kiválasztott vállalkozó nem található, vagy még nincs jóváhagyva.';
    end if;
    select token into v_token from public.worker_invites
    where contractor_id = p_contractor and expires_at > now() and coalesce(uses, 0) < 20
    order by created_at desc limit 1;
    if v_token is not null then return v_token; end if;
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.worker_invites (worker_id, token, created_by, contractor_id)
    values (null, v_token, auth.uid(), p_contractor);
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
$function$;
revoke all on function public.create_worker_invite(uuid, uuid) from public, anon;
grant execute on function public.create_worker_invite(uuid, uuid) to authenticated;

-- a regisztrációs oldal a vállalkozó nevét is megmutatja („X csapatába regisztrálsz”)
create or replace function public.invite_info(p_token text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case
    when i.id is null then jsonb_build_object('kind', 'invalid')
    when i.contractor_id is not null then jsonb_build_object('kind', 'contractor', 'contractor_name', c.name)
    when i.worker_id is null then jsonb_build_object('kind', 'generic')
    else jsonb_build_object('kind', 'personal',
           'name', w.name, 'email', w.email, 'phone', w.phones[1], 'trade', w.trade)
  end
  from (select 1) x
  left join public.worker_invites i
    on i.token = p_token and i.expires_at > now() and (i.worker_id is null or i.used_at is null)
  left join public.workers w on w.id = i.worker_id and w.deleted_at is null
  left join public.workers c on c.id = i.contractor_id
  where p_token is not null and length(p_token) between 32 and 128;
$$;
revoke all on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to anon, authenticated;
