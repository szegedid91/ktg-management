-- Munkavállaló szakipara: null = általános munkaerő,
-- kitöltve = szakember (pl. 'Villanyszerelő').
alter table public.workers add column trade text;
