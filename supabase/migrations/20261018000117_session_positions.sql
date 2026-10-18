-- Munkaterület elhagyásának jelzése (2026-10-18, Daniel kérése: „az emberek kapjanak értesítést, amikor
-- elmennek a munkaterületről”). Futó munkaidő alatt a munkavállaló appja időnként elküldi a helyzetét
-- (a webes app CSAK nyitott app mellett kap helyadatot — a háttérbeli figyelés a natív app geofence-e, ami
-- ugyanide jelent majd). A szerver kiszámolja a távolságot a munkaterület középpontjától; ha a sugáron kívül
-- van legalább 3 perce, a munkavállaló és a vezetők értesítést kapnak („elhagyta a munkaterületet, a munkaideje
-- még fut”). A minták a session_positions táblába kerülnek (90 napig), a munkamenet sorára csak az utolsó
-- ismert helyzet és a „kint van mióta” jelzés — ezt látják a vezetők a kezdőlapon.

create or replace function public.fn_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2)));
$$;

alter table public.work_sessions
  add column if not exists last_lat double precision,
  add column if not exists last_lng double precision,
  add column if not exists last_accuracy_m integer,
  add column if not exists last_distance_m integer,
  add column if not exists last_seen_at timestamptz,
  add column if not exists left_site_at timestamptz,
  add column if not exists left_notified_at timestamptz;
-- a munkamenet oszlopai oszloponként vannak kiadva (migráció 100): az újak olvashatók, de csak a szerver írja
grant select (last_lat, last_lng, last_accuracy_m, last_distance_m, last_seen_at, left_site_at, left_notified_at)
  on public.work_sessions to authenticated;

create table if not exists public.session_positions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.work_sessions(id) on delete cascade,
  worker_id uuid not null references public.workers(id),
  site_id uuid references public.sites(id),
  lat double precision not null,
  lng double precision not null,
  accuracy_m integer,
  distance_m integer,
  inside boolean,
  source text not null default 'app' check (source in ('app', 'geofence')),
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists session_positions_session_idx on public.session_positions(session_id, at);
create index if not exists session_positions_worker_idx on public.session_positions(worker_id, at);
alter table public.session_positions enable row level security;
revoke all on public.session_positions from public, anon, authenticated;
grant select on public.session_positions to authenticated;
drop policy if exists sp_select on public.session_positions;
create policy sp_select on public.session_positions for select to authenticated
  using (public.fn_is_partner() or worker_id = any(public.fn_my_worker_ids()));

-- Helyzetjelentés a munkavállaló appjából: csak a saját, futó munkamenetéhez. Lezárt munkamenetre csendben
-- nem csinál semmit (az offline sor késve is felérhet). A munkamenet sorát csak akkor írja, ha a bent/kint
-- állapot változott, vagy 10 perce nem frissült — így nem dagad az audit napló és a készülékek szinkronja.
create or replace function public.report_position(p_session uuid, p_lat double precision, p_lng double precision,
  p_accuracy integer default null, p_at timestamptz default now(), p_source text default 'app')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s record; v_site record; v_dist integer; v_inside boolean; v_was_inside boolean; v_slack integer; v_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Nincs bejelentkezve.'; end if;
  select * into v_s from public.work_sessions where id = p_session and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if v_s.worker_id is distinct from public.fn_my_worker_id() then
    raise exception 'Csak a saját munkaidődhöz jelenthetsz helyzetet.';
  end if;
  if v_s.ended_at is not null then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then raise exception 'Érvénytelen koordináta.'; end if;
  v_at := least(coalesce(p_at, now()), now() + interval '5 minutes');
  if v_at < v_s.started_at then v_at := v_s.started_at; end if;
  -- az offline sor késve, de sorban ér fel; ami a már rögzítettnél régebbi, azt nem vesszük figyelembe
  if v_s.last_seen_at is not null and v_at <= v_s.last_seen_at then return jsonb_build_object('ok', true, 'stale', true); end if;

  select s.lat, s.lng, coalesce(s.geofence_radius_m, 150) as radius into v_site from public.sites s where s.id = v_s.site_id;
  v_was_inside := (v_s.left_site_at is null);
  if v_site.lat is not null and v_site.lng is not null then
    v_dist := round(public.fn_distance_m(p_lat, p_lng, v_site.lat, v_site.lng));
    v_slack := least(coalesce(p_accuracy, 0), 100); -- a GPS pontatlanságát (legfeljebb 100 m) ráhagyjuk
    -- bent: a sugáron belül; kint: legalább 30 m-rel a sugáron túl; a kettő között marad az eddigi állapot
    v_inside := case when v_dist <= v_site.radius + v_slack then true
                     when v_dist > v_site.radius + v_slack + 30 then false
                     else v_was_inside end;
  end if;

  insert into public.session_positions (session_id, worker_id, site_id, lat, lng, accuracy_m, distance_m, inside, source, at)
  values (p_session, v_s.worker_id, v_s.site_id, p_lat, p_lng, p_accuracy, v_dist, v_inside, coalesce(p_source, 'app'), v_at);

  if v_inside is distinct from v_was_inside or v_s.last_seen_at is null or v_at - v_s.last_seen_at >= interval '10 minutes' then
    update public.work_sessions
       set last_lat = p_lat, last_lng = p_lng, last_accuracy_m = p_accuracy, last_distance_m = v_dist, last_seen_at = v_at,
           left_site_at = case when v_inside is false then coalesce(left_site_at, v_at) else null end,
           left_notified_at = case when v_inside is false then left_notified_at else null end
     where id = p_session;
  end if;
  return jsonb_build_object('ok', true, 'inside', v_inside, 'distance_m', v_dist);
end $$;
revoke all on function public.report_position(uuid, double precision, double precision, integer, timestamptz, text) from public, anon;
grant execute on function public.report_position(uuid, double precision, double precision, integer, timestamptz, text) to authenticated;

-- Értesítés (2 percenként fut): aki legalább 3 perce a munkaterület sugarán kívül van, és a munkaideje még fut.
-- A munkavállaló (vagy a vállalkozója, ha nincs saját fiókja) és minden vezető kap egyet; a visszatérésig
-- nem ismételjük (a report_position a visszatéréskor törli a jelzést).
create or replace function public.fn_notify_left_sites()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_prof uuid; v_p record; v_since text; v_body text;
begin
  for r in
    select s.id, s.worker_id, s.site_id, s.task_id, s.left_site_at, s.last_distance_m,
           coalesce(w.nickname, w.name) as wname, w.contractor_id, si.name as site_name,
           (select coalesce(t.code || ' · ', '') || t.title from public.worker_tasks t where t.id = s.task_id) as task_label
    from public.work_sessions s
    join public.workers w on w.id = s.worker_id
    left join public.sites si on si.id = s.site_id
    where s.deleted_at is null and s.ended_at is null and s.left_site_at is not null and s.left_notified_at is null
      and s.left_site_at <= now() - interval '3 minutes'
  loop
    v_since := to_char(r.left_site_at at time zone 'Europe/Budapest', 'HH24:MI');
    select id into v_prof from public.profiles where worker_id = r.worker_id;
    if v_prof is null and r.contractor_id is not null then
      select id into v_prof from public.profiles where worker_id = r.contractor_id;
    end if;
    if v_prof is not null then
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('reminder', v_prof, '🚶 Elhagytad a munkaterületet?',
              'Úgy látjuk, ' || v_since || ' óta nem vagy itt: ' || coalesce(r.site_name, 'munkaterület')
              || '. A munkaidőd még fut — ha elmentél, zárd le az appban.',
              jsonb_build_object('session_id', r.id, 'site_id', r.site_id, 'task_id', r.task_id, 'left', true));
    end if;
    v_body := coalesce(r.wname, 'Munkavállaló') || ' ' || v_since || ' óta nincs a munkaterületen: ' || coalesce(r.site_name, '?')
      || coalesce(' (kb. ' || r.last_distance_m || ' m-re)', '') || coalesce(' · ' || r.task_label, '') || ' — a munkaideje még fut.';
    for v_p in select id from public.profiles where worker_id is null loop
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('reminder', v_p.id, '🚶 Elhagyta a munkaterületet', v_body,
              jsonb_build_object('session_id', r.id, 'site_id', r.site_id, 'worker_id', r.worker_id, 'left', true));
    end loop;
    update public.work_sessions set left_notified_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.fn_notify_left_sites() from public, anon, authenticated;

-- a minták 90 nap után törlődnek
create or replace function public.fn_purge_session_positions()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.session_positions where at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.fn_purge_session_positions() from public, anon, authenticated;

do $$
declare j record;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return; end if;
  for j in select jobid from cron.job where jobname in ('notify-left-sites', 'purge-session-positions') loop
    perform cron.unschedule(j.jobid);
  end loop;
  perform cron.schedule('notify-left-sites', '*/2 * * * *', 'select public.fn_notify_left_sites()');
  perform cron.schedule('purge-session-positions', '45 3 * * *', 'select public.fn_purge_session_positions()');
end $$;
