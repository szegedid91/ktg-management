-- Chat: ki meddig olvasta (2026-10-16, Daniel kérése). Felhasználónként egy sor: az utolsó olvasott üzenet
-- és ideje — a chatben az üzenet alatt kis monogram-kör mutatja, ki tart ott. Mindenki a saját sorát írja.
create table if not exists public.chat_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references public.profiles(id) on delete cascade,
  last_message_id uuid references public.chat_messages(id) on delete set null,
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists chat_reads_updated_idx on public.chat_reads(updated_at);
create index if not exists chat_reads_last_message_idx on public.chat_reads(last_message_id);
drop trigger if exists trg_touch_chat_reads on public.chat_reads;
create trigger trg_touch_chat_reads before insert or update on public.chat_reads
  for each row execute function public.fn_touch_updated_at();

alter table public.chat_reads enable row level security;
revoke all on public.chat_reads from public, anon;
grant select, insert, update on public.chat_reads to authenticated;
drop policy if exists chr_select on public.chat_reads;
create policy chr_select on public.chat_reads for select to authenticated using (true);
drop policy if exists chr_insert on public.chat_reads;
create policy chr_insert on public.chat_reads for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists chr_update on public.chat_reads;
create policy chr_update on public.chat_reads for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- egy felhasználónak egy sora van: második beszúrás (pl. másik készülékről) a meglévőt frissíti
create or replace function public.fn_chat_read_insert_merge()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.chat_reads where user_id = new.user_id;
  if v_id is null then return new; end if;
  update public.chat_reads set last_message_id = new.last_message_id, last_read_at = greatest(last_read_at, new.last_read_at), deleted_at = null where id = v_id;
  return null;
end $$;
revoke all on function public.fn_chat_read_insert_merge() from public, anon, authenticated;
drop trigger if exists trg_chat_read_insert_merge on public.chat_reads;
create trigger trg_chat_read_insert_merge before insert on public.chat_reads
  for each row execute function public.fn_chat_read_insert_merge();

do $$ begin
  execute 'alter publication supabase_realtime add table public.chat_reads';
exception when duplicate_object then null; end $$;
