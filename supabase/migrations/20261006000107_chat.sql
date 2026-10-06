-- Közös chat (2026-10-06, Daniel kérése): egy mindenki által látható üzenőfal — vezetők és
-- munkavállalók egyaránt írnak és olvasnak. Üzenetben meg lehet említeni embereket (@név → értesítést
-- kapnak), és feladatot lehet hozzátűzni (a feladat kódja + címe pillanatképként is tárolódik, hogy az is
-- értse, aki a feladatot magát nem látja). A vezető kitűzhet üzenetet (a lista tetején marad).

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) <= 4000),
  mentions uuid[] not null default '{}' check (coalesce(array_length(mentions, 1), 0) <= 30),
  task_id uuid references public.worker_tasks(id),
  task_label text check (task_label is null or char_length(task_label) <= 200),
  pinned_at timestamptz,
  pinned_by uuid references public.profiles(id),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists chat_messages_created_idx on public.chat_messages(created_at);
create index if not exists chat_messages_updated_idx on public.chat_messages(updated_at);
create index if not exists chat_messages_task_idx on public.chat_messages(task_id);
create index if not exists chat_messages_created_by_idx on public.chat_messages(created_by);
create index if not exists chat_messages_pinned_by_idx on public.chat_messages(pinned_by);

drop trigger if exists trg_touch_chat_messages on public.chat_messages;
create trigger trg_touch_chat_messages before insert or update on public.chat_messages
  for each row execute function public.fn_touch_updated_at();

-- írási szabályok: a szerző csak a saját üzenetét módosíthatja / törölheti; kitűzni csak vezető tud;
-- a feladat-hivatkozás és a szerző utólag nem változik; törölt üzenet szövege nem marad meg
create or replace function public.fn_chat_message_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(btrim(new.body), '') = '' and new.task_id is null then raise exception 'Üres üzenetet nem lehet küldeni.'; end if;
    new.pinned_at := null; new.pinned_by := null;
    if new.task_id is not null then
      -- a pillanatkép a szerverről: kód · cím (a kliens által küldöttet nem fogadjuk el)
      select left(coalesce(t.code || ' · ', '') || t.title, 200) into new.task_label from public.worker_tasks t where t.id = new.task_id and t.deleted_at is null;
      if new.task_label is null then raise exception 'A hozzátűzött feladat nem található.'; end if;
    end if;
    return new;
  end if;
  if auth.uid() is not null then
    if new.created_by is distinct from old.created_by or new.task_id is distinct from old.task_id
       or new.task_label is distinct from old.task_label or new.created_at is distinct from old.created_at then
      raise exception 'Az üzenet szerzője és feladat-hivatkozása nem módosítható.';
    end if;
    if (new.pinned_at is distinct from old.pinned_at or new.pinned_by is distinct from old.pinned_by) then
      if not public.fn_is_partner() then raise exception 'Üzenetet csak vezető tűzhet ki.'; end if;
      new.pinned_by := case when new.pinned_at is null then null else auth.uid() end;
    end if;
    if not public.fn_is_partner() and old.created_by <> auth.uid()
       and (new.body is distinct from old.body or new.mentions is distinct from old.mentions or new.deleted_at is distinct from old.deleted_at) then
      raise exception 'Csak a saját üzenetedet módosíthatod.';
    end if;
  end if;
  if new.deleted_at is not null then new.body := ''; new.mentions := '{}'; new.pinned_at := null; new.pinned_by := null; end if;
  return new;
end $$;
revoke all on function public.fn_chat_message_guard() from public, anon, authenticated;
drop trigger if exists trg_chat_message_guard on public.chat_messages;
create trigger trg_chat_message_guard before insert or update on public.chat_messages
  for each row execute function public.fn_chat_message_guard();

alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from public, anon;
grant select, insert, update on public.chat_messages to authenticated;
drop policy if exists cm_select on public.chat_messages;
create policy cm_select on public.chat_messages for select to authenticated using (true);
drop policy if exists cm_insert on public.chat_messages;
create policy cm_insert on public.chat_messages for insert to authenticated
  with check (created_by = (select auth.uid()));
drop policy if exists cm_update on public.chat_messages;
create policy cm_update on public.chat_messages for update to authenticated
  using (public.fn_is_partner() or created_by = (select auth.uid()))
  with check (public.fn_is_partner() or created_by = (select auth.uid()));

do $$ begin
  execute 'alter publication supabase_realtime add table public.chat_messages';
exception when duplicate_object then null; end $$;

-- értesítés a megemlítetteknek
alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check
  check (kind in ('comment','big_expense','weekly','overdue','share_change','site_deleted','task','material',
                  'worker_joined','worker_approved','worker_rejected','task_due','timesheet','schedule','reminder','chat'));

create or replace function public.fn_notify_chat_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_to uuid;
begin
  if new.deleted_at is not null or coalesce(array_length(new.mentions, 1), 0) = 0 then return new; end if;
  select coalesce(p.display_name, 'Valaki') into v_name from public.profiles p where p.id = new.created_by;
  for v_to in select distinct m from unnest(new.mentions) m
             where m <> new.created_by and exists (select 1 from public.profiles p where p.id = m)
  loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('chat', v_to, '💬 ' || v_name || ' megemlített a chatben',
            left(coalesce(nullif(btrim(new.body), ''), new.task_label, ''), 140),
            jsonb_build_object('chat', true, 'message_id', new.id));
  end loop;
  return new;
end $$;
revoke all on function public.fn_notify_chat_mention() from public, anon, authenticated;
drop trigger if exists trg_notify_chat_mention on public.chat_messages;
create trigger trg_notify_chat_mention after insert on public.chat_messages
  for each row execute function public.fn_notify_chat_mention();
