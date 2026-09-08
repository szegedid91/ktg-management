-- Munkavállaló beceneve (listákban, csempéken ezt mutatjuk, ha meg van adva)
alter table public.workers add column if not exists nickname text;
