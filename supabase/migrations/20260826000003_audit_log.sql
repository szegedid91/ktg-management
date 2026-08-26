-- =============================================================
-- Fázis 1 — Teljes audit log Postgres triggerrel
-- Minden create/update/delete naplózva: ki, mikor, mit, régi/új érték.
-- App-oldalról megkerülhetetlen.
-- =============================================================

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index ix_audit_table_record on public.audit_log (table_name, record_id);
create index ix_audit_changed_at on public.audit_log (changed_at desc);
create index ix_audit_changed_by on public.audit_log (changed_by);

create or replace function public.fn_audit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_id := v_new->>'id';
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_id := v_new->>'id';
    if v_old = v_new then
      return new; -- érdemi változás nélkül nem naplózunk
    end if;
  else
    v_old := to_jsonb(old);
    v_id := v_old->>'id';
  end if;

  -- titkosított bankszámlaszám bináris tartalma ne kerüljön a logba
  v_old := v_old - 'bank_account_enc';
  v_new := v_new - 'bank_account_enc';

  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (tg_table_name, v_id, tg_op, v_old, v_new, auth.uid());

  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','app_settings','expense_categories','sites','external_people','workers',
    'expenses','expense_photos','attendance','comments','invoices','settlements',
    'equipment','equipment_moves'
  ]
  loop
    execute format('create trigger trg_audit_%I after insert or update or delete on public.%I for each row execute function public.fn_audit()', t, t);
  end loop;
end;
$$;
