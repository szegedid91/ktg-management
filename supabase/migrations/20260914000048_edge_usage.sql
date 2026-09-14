-- Edge-funkciók napi kvótája felhasználónként (csak a service kulcs írja/olvassa)
create table if not exists public.edge_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  fn text not null,
  day date not null,
  count integer not null default 0,
  primary key (user_id, fn, day)
);
alter table public.edge_usage enable row level security;
revoke all on public.edge_usage from anon, authenticated;
