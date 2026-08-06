-- LARA Areas — row level security
--
-- Er is geen rollenstelsel: elke ingelogde gebruiker leest en schrijft alles.
-- Dat was een expliciete keuze bij het ontwerp — de tool heeft een handvol
-- gebruikers die aan dezelfde AIRAC-cyclus werken, en een rollenmatrix zou meer
-- kosten dan hij oplevert.
--
-- Wat RLS hier wél doet: niet-ingelogde verzoeken komen er niet langs. Zonder
-- policies zou de anon key van een publieke Next.js-build de hele tabel kunnen
-- uitlezen.
--
-- De service-role-sleutel gaat buiten RLS om en hoort uitsluitend server-side,
-- in de import-route.

alter table public.datasets     enable row level security;
alter table public.airspaces    enable row level security;
alter table public.geometries   enable row level security;
alter table public.lara_areas   enable row level security;
alter table public.xml_snippets enable row level security;
alter table public.geoborders   enable row level security;

create policy "ingelogd mag alles" on public.datasets
  for all to authenticated using (true) with check (true);

create policy "ingelogd mag alles" on public.airspaces
  for all to authenticated using (true) with check (true);

create policy "ingelogd mag alles" on public.geometries
  for all to authenticated using (true) with check (true);

create policy "ingelogd mag alles" on public.lara_areas
  for all to authenticated using (true) with check (true);

create policy "ingelogd mag alles" on public.xml_snippets
  for all to authenticated using (true) with check (true);

create policy "ingelogd mag alles" on public.geoborders
  for all to authenticated using (true) with check (true);

-- Supabase geeft nieuwe tabellen deze rechten al via default privileges; hier
-- staan ze expliciet zodat de migratie ook klopt als die default ooit wijzigt.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- anon krijgt niets: er is geen enkel scherm dat zonder sessie data toont.
revoke all on all tables in schema public from anon;
