-- Push-értesítés a részesedés-módosítási folyamathoz:
--  - új javaslatnál a jóváhagyásra jogosult partner(ek) kapnak értesítést,
--  - döntés után a javaslattevő kap visszajelzést.
-- A sort a push-dispatch edge function üríti (natív buildben kézbesít).

alter table public.notification_queue drop constraint notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check
  check (kind in ('comment', 'big_expense', 'weekly', 'overdue', 'share_change'));

create or replace function public.fn_notify_share_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_proposer text;
  v_summary text;
  r record;
begin
  select display_name into v_proposer from public.profiles where id = new.proposed_by;
  select string_agg(p.display_name || ' ' || round((e->>'percent')::numeric) || '%', ' · ')
    into v_summary
  from jsonb_array_elements(new.shares) e
  join public.profiles p on p.id = (e->>'user_id')::uuid;

  if tg_op = 'INSERT' and new.status = 'pending' then
    for r in
      select id from public.profiles where not is_admin and id <> new.proposed_by
    loop
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('share_change', r.id, 'Részesedés-módosítási javaslat 🤝',
              coalesce(v_proposer, 'A partnered') || ' új felosztást javasol: '
              || coalesce(v_summary, '') || ' — a te jóváhagyásod kell.',
              jsonb_build_object('request_id', new.id));
    end loop;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved', 'rejected') then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('share_change', new.proposed_by,
            case when new.status = 'approved'
              then 'Részesedés jóváhagyva ✅'
              else 'Részesedés-javaslat elutasítva' end,
            case when new.status = 'approved'
              then 'Az új felosztás (' || coalesce(v_summary, '') || ') a mai naptól érvényes.'
              else 'A javasolt felosztást (' || coalesce(v_summary, '') || ') a másik fél elutasította.' end,
            jsonb_build_object('request_id', new.id));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_share_change on public.share_change_requests;
create trigger trg_notify_share_change
  after insert or update on public.share_change_requests
  for each row execute function public.fn_notify_share_change();
