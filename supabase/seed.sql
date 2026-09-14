-- =============================================================
-- CSAK HELYI FEJLESZTÉSHEZ (supabase db reset futtatja a migrációk után).
-- Tesztfiókok minden szereppel, jelszó mindenhol: teszt1234
--   admin@teszt.hu  – rejtett admin (hozzáférés-kezelő, nem üzleti partner)
--   dani@teszt.hu   – fő felhasználó (partner) 50%
--   anna@teszt.hu   – fő felhasználó (partner) 50%
--   marci@teszt.hu  – munkavállaló (meghívóval regisztrált, saját rekorddal)
-- Élesbe SOHA nem kerül: a seed csak a helyi db reset része.
-- =============================================================

insert into public.allowed_emails (email, is_admin) values
  ('admin@teszt.hu', true), ('dani@teszt.hu', false), ('anna@teszt.hu', false)
on conflict (email) do nothing;

-- a profilt a fn_handle_new_user trigger hozza létre (admin / partner ág)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        email_change_token_current, phone_change, phone_change_token, reauthentication_token, is_sso_user)
values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin@teszt.hu', crypt('teszt1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Admin"}', now(), now(), '', '', '', '', '', '', '', '', false),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dani@teszt.hu', crypt('teszt1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Dani"}', now(), now(), '', '', '', '', '', '', '', '', false),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'anna@teszt.hu', crypt('teszt1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Anna"}', now(), now(), '', '', '', '', '', '', '', '', false);

-- munkavállaló: általános meghívóval regisztrál (a trigger munkavállaló-rekordot is készít)
insert into public.worker_invites (worker_id, token, created_by)
values (null, 'seed-invite-token', '00000000-0000-0000-0000-00000000000b');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        email_change_token_current, phone_change, phone_change_token, reauthentication_token, is_sso_user)
values
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'marci@teszt.hu', crypt('teszt1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"display_name":"Kovács Márton","phone":"+36 30 111 2222","trade":"burkoló","invite_token":"seed-invite-token"}',
   now(), now(), '', '', '', '', '', '', '', '', false);
update public.workers set nickname = 'Marci' where email = 'marci@teszt.hu';

-- e-mail identitások a jelszavas belépéshez
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u where u.email like '%@teszt.hu';

-- részesedés 50/50 a két partnernek
select set_config('app.share_update_ok', '1', true);
update public.profiles set profit_share_percent = 50 where email in ('dani@teszt.hu', 'anna@teszt.hu');
insert into public.profit_share_history (user_id, percent, valid_from)
select id, 50, date '2000-01-01' from public.profiles where email in ('dani@teszt.hu', 'anna@teszt.hu')
on conflict (user_id, valid_from) do update set percent = 50;

-- egy építkezés és pár feladat, hogy legyen mit nézni
insert into public.sites (id, name, address, created_by) values
  ('10000000-0000-0000-0000-000000000001', 'Lampart', '1135 Budapest, Kerekes u. 8.', '00000000-0000-0000-0000-00000000000b');
insert into public.worker_tasks (id, code, title, details, site_id, status, priority, created_by) values
  ('20000000-0000-0000-0000-000000000001', 'F-001', 'Csempézés a fürdőben', 'Anyag a helyszínen.', '10000000-0000-0000-0000-000000000001', 'assigned', 1, '00000000-0000-0000-0000-00000000000b'),
  ('20000000-0000-0000-0000-000000000002', 'F-002', 'Villanyszerelés – konyha', null, '10000000-0000-0000-0000-000000000001', 'assigned', 0, '00000000-0000-0000-0000-00000000000c');
insert into public.task_assignees (task_id, worker_id)
select t.id, w.id from public.worker_tasks t, public.workers w where w.email = 'marci@teszt.hu';

-- függő munkavállalói regisztráció (pista@teszt.hu): jóváhagyásra vár
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        email_change_token_current, phone_change, phone_change_token, reauthentication_token, is_sso_user)
values
  ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pista@teszt.hu', crypt('teszt1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"display_name":"Nagy István","phone":"+36 20 333 4444","trade":"kőműves","invite_token":"seed-invite-token"}',
   now(), now(), '', '', '', '', '', '', '', '', false);
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u where u.email = 'pista@teszt.hu';
