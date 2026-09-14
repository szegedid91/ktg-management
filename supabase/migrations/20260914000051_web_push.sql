-- Web Push (PWA) feliratkozások + szerver-oldali titkok (VAPID kulcsok).
--
-- push_subscriptions: böngészőnkénti feliratkozás (endpoint + kulcsok);
-- a felhasználó csak a sajátjait látja/írja, a kiküldő edge-funkció a
-- service kulccsal olvassa. Lejárt (404/410) feliratkozás: deleted_at.
--
-- app_secrets: kizárólag a service role olvassa (RLS bekapcsolva, policy
-- nélkül); a VAPID kulcspárt kézzel kell beszúrni:
--   insert into public.app_secrets (name, value) values
--     ('vapid_public',  '<publicKey>'),
--     ('vapid_private', '<privateKey>');

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_error  text,
  deleted_at  timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id) where deleted_at is null;

drop trigger if exists trg_touch_push_subscriptions on public.push_subscriptions;
create trigger trg_touch_push_subscriptions before insert or update on public.push_subscriptions
  for each row execute function public.fn_touch_updated_at();

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.push_subscriptions from public, anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ============================================================ titkok
create table if not exists public.app_secrets (
  name  text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
-- szándékosan nincs policy: csak a service role (RLS-t megkerülve) éri el
revoke all on public.app_secrets from public, anon, authenticated;
