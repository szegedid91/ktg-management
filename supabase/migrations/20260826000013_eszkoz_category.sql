-- Beépített "Eszköz" költségkategória — erre (és a Szerszámra) a
-- költségrögzítés felajánlja az eszköz-nyilvántartásba vételt.

insert into public.expense_categories (name, is_builtin)
select 'Eszköz', true
where not exists (
  select 1 from public.expense_categories
  where lower(name) = 'eszköz' and deleted_at is null
);
