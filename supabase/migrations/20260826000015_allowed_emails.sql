-- BIZTONSÁG: zárt regisztráció. A nyilvános oldalon eddig bárki
-- regisztrálhatott, ami profilt + profitrészesedés-újraosztást és teljes
-- olvasási jogot adott volna egy idegennek. Mostantól csak engedélyezett
-- e-mail címmel lehet regisztrálni; a legelső felhasználó mindig mehet
-- (friss telepítés bootstrapje).

create table if not exists public.allowed_emails (
  email text primary key,
  added_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.allowed_emails enable row level security;

drop policy if exists allowed_emails_select on public.allowed_emails;
create policy allowed_emails_select on public.allowed_emails
  for select to authenticated using (true);
drop policy if exists allowed_emails_insert on public.allowed_emails;
create policy allowed_emails_insert on public.allowed_emails
  for insert to authenticated with check (true);
drop policy if exists allowed_emails_delete on public.allowed_emails;
create policy allowed_emails_delete on public.allowed_emails
  for delete to authenticated using (true);

grant select, insert, delete on public.allowed_emails to authenticated;

-- a meglévő felhasználók automatikusan engedélyezettek
insert into public.allowed_emails (email, added_by)
select lower(email), null from public.profiles where email is not null
on conflict (email) do nothing;

-- regisztráció-trigger: idegen e-mail nem hozhat létre fiókot
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  -- zárt alkalmazás: csak engedélyezett e-mail (a legelső felhasználó kivétel)
  select count(*) into v_count from public.profiles;
  if v_count > 0 and not exists (
    select 1 from public.allowed_emails where email = lower(new.email)
  ) then
    raise exception 'Zárt alkalmazás: ez az e-mail cím nincs engedélyezve. Kérj hozzáférést a tulajdonosoktól.';
  end if;

  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  -- alapértelmezés: egyenlő elosztás minden felhasználó között
  select count(*) into v_count from public.profiles;
  update public.profiles set profit_share_percent = round(100.0 / v_count, 2);
  -- kerekítési maradék az első felhasználóhoz
  update public.profiles p
     set profit_share_percent = profit_share_percent + (100 - (select sum(profit_share_percent) from public.profiles))
   where p.id = (select id from public.profiles order by created_at limit 1);
  return new;
end;
$$;
