-- LARA Areas — opslag
--
-- Eén bucket: het geüploade AIXM-bestand. Dat blijft bewaard zodat een import
-- herhaald kan worden — bij een parserwijziging bijvoorbeeld — zonder het
-- bestand opnieuw op te vragen bij de bron.
--
-- Privé: een AIXM-bestand van een AIS-leverancier is geen publiek bestand. De
-- browser uploadt rechtstreeks met een signed URL; 200 MB past niet in een
-- request body.

insert into storage.buckets (id, name, public, file_size_limit)
values ('aixm-uploads', 'aixm-uploads', false, 209715200)   -- 200 MB
on conflict (id) do nothing;

create policy "ingelogd mag aixm lezen"
  on storage.objects for select to authenticated
  using (bucket_id = 'aixm-uploads');

create policy "ingelogd mag aixm uploaden"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'aixm-uploads');

-- Verwijderen hoort bij het verwijderen van een dataset. De databaserij gaat via
-- on delete cascade; het bestand moet apart weg, anders blijft er 48 MB per
-- ingetrokken import staan.
create policy "ingelogd mag aixm verwijderen"
  on storage.objects for delete to authenticated
  using (bucket_id = 'aixm-uploads');
