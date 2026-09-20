-- Vállalkozó személyre szóló meghívót készíthet a MÁR FELVETT emberének
-- (2026-09-21, Daniel kérése): a regisztráció a meglévő munkavállalói
-- profilhoz kapcsolódik (kitöltött adatok, a korábbi napok/feladatok/bér
-- megmaradnak és láthatók), az ember továbbra is a vállalkozóhoz tartozik.
-- A meghívó contractor_id nélkül, worker_id-vel készül, így a regisztráció a
-- „személyre szóló” ágon fut (nem hoz létre új munkavállalót).
create or replace function public.create_worker_invite(p_worker uuid default null::uuid)
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
revoke all on function public.create_worker_invite(uuid) from public, anon;
grant execute on function public.create_worker_invite(uuid) to authenticated;
