-- =============================================================
-- Fázis 3 — Push értesítési sor + triggerek
-- A sort a push-dispatch edge function üríti (Expo push API).
-- =============================================================

create table public.notification_queue (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('comment','big_expense','weekly','overdue')),
  recipient uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  payload jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index ix_notif_unsent on public.notification_queue (created_at) where sent_at is null;

alter table public.notification_queue enable row level security;
create policy notif_select on public.notification_queue for select to authenticated
  using (recipient = auth.uid());

-- ---------- Komment az általam rögzített tételhez ----------
create or replace function public.fn_notify_comment()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_author_name text;
begin
  v_owner := case new.entity_type
    when 'site' then (select created_by from public.sites where id = new.entity_id)
    when 'expense' then (select created_by from public.expenses where id = new.entity_id)
    when 'worker' then (select created_by from public.workers where id = new.entity_id)
    when 'attendance' then (select created_by from public.attendance where id = new.entity_id)
    when 'invoice' then (select created_by from public.invoices where id = new.entity_id)
    when 'equipment' then (select created_by from public.equipment where id = new.entity_id)
    when 'settlement' then (select created_by from public.settlements where id = new.entity_id)
  end;

  if v_owner is null or v_owner = new.author_id then
    return new;
  end if;
  if not exists (select 1 from public.profiles where id = v_owner and notify_comments) then
    return new;
  end if;

  select display_name into v_author_name from public.profiles where id = new.author_id;

  insert into public.notification_queue (kind, recipient, title, body, payload)
  values ('comment', v_owner, 'Új komment 💬',
          coalesce(v_author_name, 'Valaki') || ': ' || left(new.body, 120),
          jsonb_build_object('entity_type', new.entity_type, 'entity_id', new.entity_id));
  return new;
end;
$$;

create trigger trg_notify_comment after insert on public.comments
  for each row execute function public.fn_notify_comment();

-- ---------- Nagy költés riasztás ----------
create or replace function public.fn_notify_big_expense()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  v_name text;
begin
  select display_name into v_name from public.profiles where id = new.created_by;
  for r in
    select id, big_expense_threshold from public.profiles
    where id <> new.created_by and notify_big_expense
      and new.net_amount >= big_expense_threshold
  loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('big_expense', r.id, 'Nagy költés 💸',
            coalesce(v_name, 'A partnered') || ' rögzített: ' || coalesce(new.title, 'költség')
            || ' — ' || to_char(new.net_amount, 'FM999 999 999') || ' Ft (nettó)',
            jsonb_build_object('expense_id', new.id));
  end loop;
  return new;
end;
$$;

create trigger trg_notify_big_expense after insert on public.expenses
  for each row execute function public.fn_notify_big_expense();
