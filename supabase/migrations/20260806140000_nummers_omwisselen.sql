-- LARA Areas — nummers kunnen omwisselen
--
-- `unique (dataset_id, lara_area_id)` werd per rij gecontroleerd. Daardoor liep
-- iets alledaags stuk: twee gebieden van nummer wisselen. Bij het omzetten van
-- EHR1 1→2 en EHR2 2→1 botst de eerste rij op de tweede, die zijn oude nummer nog
-- heeft. De einduitkomst is volstrekt geldig; alleen de tussenstand niet.
--
-- Met `deferrable initially deferred` gebeurt de controle aan het eind van de
-- transactie in plaats van per rij. Een echt duplicaat wordt nog steeds
-- geweigerd — alleen niet meer halverwege een geldige herschikking.
--
-- Elk PostgREST-verzoek is één transactie, dus een `upsert` met beide rijen
-- erin is precies wat dit nodig heeft. Zie app/api/lara-areas/bulk/route.ts.

alter table public.lara_areas
  drop constraint if exists lara_areas_dataset_id_lara_area_id_key;

alter table public.lara_areas
  add constraint lara_areas_dataset_id_lara_area_id_key
  unique (dataset_id, lara_area_id)
  deferrable initially deferred;
