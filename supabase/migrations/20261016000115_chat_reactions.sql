-- Chat: üzenet „kedvelése” (2026-10-16, Daniel kérése) — egy 👍-val jelezhető, hogy az ember látta / értette
-- az üzenetet; az író látja, kik nyugtázták. Mindenki a saját reakcióját teszi fel / veszi le.
create table if not exists public.chat_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji text not null default '👍' check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (message_id, user_id, emoji)
);
create index if not exists chat_reactions_message_idx on public.chat_reactions(message_id);
create index if not exists chat_reactions_updated_idx on public.chat_reactions(updated_at);
create index if not exists chat_reactions_user_idx on public.chat_reactions(user_id);
drop trigger if exists trg_touch_chat_reactions on public.chat_reactions;
create trigger trg_touch_chat_reactions before insert or update on public.chat_reactions
  for each row execute function public.fn_touch_updated_at();

alter table public.chat_reactions enable row level security;
revoke all on public.chat_reactions from public, anon;
grant select, insert, update on public.chat_reactions to authenticated;
drop policy if exists cr_select on public.chat_reactions;
create policy cr_select on public.chat_reactions for select to authenticated using (true);
drop policy if exists cr_insert on public.chat_reactions;
create policy cr_insert on public.chat_reactions for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists cr_update on public.chat_reactions;
create policy cr_update on public.chat_reactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ugyanaz a reakció kétszer (pl. két készülékről): a meglévő sor áll vissza, nincs egyediség-hiba
create or replace function public.fn_chat_reaction_insert_restore()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.chat_reactions where message_id = new.message_id and user_id = new.user_id and emoji = new.emoji;
  if v_id is null then return new; end if;
  update public.chat_reactions set deleted_at = null where id = v_id;
  return null;
end $$;
revoke all on function public.fn_chat_reaction_insert_restore() from public, anon, authenticated;
drop trigger if exists trg_chat_reaction_insert_restore on public.chat_reactions;
create trigger trg_chat_reaction_insert_restore before insert on public.chat_reactions
  for each row execute function public.fn_chat_reaction_insert_restore();

do $$ begin
  execute 'alter publication supabase_realtime add table public.chat_reactions';
exception when duplicate_object then null; end $$;
