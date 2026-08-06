-- LARA Areas — de toegestane waarden van geometries.operation herstellen
--
-- De eerste migratie stond `BASE`, `AGG` en `SUBTR` toe. Dat is op twee manieren
-- mis, en het kwam pas boven bij het overnemen van de parser:
--
--   * AIXM 5.1 kent vier operaties (CodeAirspaceAggregationType): BASE, UNION,
--     SUBTR en INTERS. `UNION` en `INTERS` ontbraken, dus een gebied dat uit
--     andere gebieden is samengesteld — precies het geval waarvoor deze kolom
--     bestaat — zou de import laten struikelen op een check-constraint.
--
--   * `AGG` is geen AIXM-operatie maar een eigen markering van de parser voor de
--     samengevoegde geometrie van alle componenten (operationSequence 0). Die
--     mag blijven, maar dan als wat het is.
--
-- Zie lib/airspaceVolumes.ts en lib/__tests__/airspaceVolumes.test.ts.

alter table public.geometries
  drop constraint if exists geometries_operation_check;

alter table public.geometries
  add constraint geometries_operation_check
  check (operation in ('BASE', 'UNION', 'SUBTR', 'INTERS', 'AGG'));

comment on column public.geometries.operation is
  'AIXM CodeAirspaceAggregationType: BASE, UNION, SUBTR, INTERS. AGG is geen AIXM-waarde maar markeert de samengevoegde geometrie van alle componenten.';
