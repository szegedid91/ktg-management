-- =============================================================
-- Tábla-szintű jogosultságok az authenticated szerepnek.
-- A soronkénti szabályokat az RLS kényszeríti ki (0004-es migráció),
-- ez a durva szemcsés réteg alatta.
-- =============================================================

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- az audit log és az értesítési sor app-oldalról csak olvasható
revoke insert, update, delete on public.audit_log from authenticated;
revoke insert, update, delete on public.notification_queue from authenticated;

-- későbbi táblákra is érvényes alapértelmezés
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;
