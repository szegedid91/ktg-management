-- A profit_share_percent közvetlen (REST) módosításának tiltása: a
-- részesedés csak a javaslat + beleegyezés folyamaton át változhat.
-- A jóváhagyó fn_apply_shares tranzakció-szintű jelzést állít, amit a
-- trigger elfogad; psql/karbantartó hívásoknál auth.uid() null, azok mennek.

create or replace function public.fn_protect_share_percent()
returns trigger
language plpgsql
as $$
begin
  if new.profit_share_percent is distinct from old.profit_share_percent
     and auth.uid() is not null
     and coalesce(current_setting('app.share_update_ok', true), '') <> '1' then
    raise exception 'A részesedés csak közös jóváhagyással módosítható.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_share_percent on public.profiles;
create trigger trg_protect_share_percent
  before update on public.profiles
  for each row execute function public.fn_protect_share_percent();

create or replace function public.fn_apply_shares(p_shares jsonb, p_from date)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  r record;
begin
  perform set_config('app.share_update_ok', '1', true);
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

-- a belső segédfüggvények ne legyenek közvetlenül hívhatók REST-ről
revoke execute on function public.fn_apply_shares(jsonb, date) from public, anon, authenticated;
revoke execute on function public.fn_validate_shares(jsonb) from public, anon, authenticated;
