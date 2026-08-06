-- LARA Areas — schema
--
-- Zes tabellen: een dataset is één AIXM-bestand, daaronder hangen de airspaces
-- met hun volumes, en daarnaast staat de LARA-selectie.
--
-- Twee dingen wijken bewust af van de brontool (Airspace_management):
--
--   1. lara_area_id is daar een kolom op airspaces. Hier is het een eigen tabel,
--      die tegelijk de selectie is: een rij bestaat alleen voor gebieden die in
--      LARA horen. Zo overleeft de selectie een AIRAC-wissel en kun je
--      hernummeren zonder de import aan te tasten.
--
--   2. geometries bevat één rij per volume — geometrie mét de hoogteband die
--      erbij hoort. Een gebied dat uit andere gebieden is afgeleid krijgt hier
--      meerdere rijen, en dat is precies wat sheet 2 (Area Volumes) uitschrijft.
--      De brontool voegde alles samen tot één geometrie en verloor daarmee de
--      gelaagde hoogtebanden.

-- ------------------------------------------------------------- datasets ----

create table public.datasets (
  id             uuid primary key default gen_random_uuid(),
  filename       text not null,
  -- Handmatig ingevuld bij de upload, niet afgeleid uit de bestandsnaam.
  -- Stuurt de naam van het exportbestand: LARAV4_<airac>_<datum>.xlsx.
  airac          text not null,
  -- Pad in de bucket aixm-uploads; het bronbestand blijft bewaard zodat een
  -- import herhaald kan worden zonder opnieuw te uploaden.
  storage_path   text,
  uploaded_at    timestamptz not null default now(),
  uploaded_by    uuid references auth.users(id) on delete set null,
  status         text not null default 'queued'
                 check (status in ('queued', 'running', 'done', 'error')),
  error_message  text,
  airspace_count integer not null default 0,
  -- De dataset waar de applicatie standaard op opent. Hoogstens één.
  is_active      boolean not null default false
);

create unique index datasets_hoogstens_een_actief
  on public.datasets (is_active)
  where is_active;

create index datasets_uploaded_at_idx on public.datasets (uploaded_at desc);

-- ------------------------------------------------------------ airspaces ----

-- Platgeslagen actieve timeslice: één rij per gebied uit het AIXM-bestand.
create table public.airspaces (
  id                   uuid primary key default gen_random_uuid(),
  dataset_id           uuid not null references public.datasets(id) on delete cascade,
  gml_id               text,
  -- Sleutel naar xml_snippets, en de identiteit waarmee een gebied over
  -- AIRAC-cycli heen te volgen is als de designator wijzigt.
  uuid_identifier      text,
  ident                text not null,          -- designator, bv. EHR4A
  name                 text,
  type                 text,                   -- R, D, P, TRA, TSA, CTR, …
  local_type           text,
  class                text,
  -- Omhullende hoogteband: laagste onder, hoogste boven over alle volumes.
  -- Sheet 1 (Areas) schrijft deze; sheet 2 gebruikt de band per volume.
  lowerlimit           numeric,
  lowerunit            text,
  upperlimit           numeric,
  upperunit            text,
  vertical_limits_json jsonb,
  geometry             text,                   -- leesbare geometrietekst
  geometry_status      text,
  centroid_lat         double precision,
  centroid_lon         double precision,
  warnings_json        jsonb,
  raw_fragment         text
);

create index airspaces_dataset_idx on public.airspaces (dataset_id);
create index airspaces_ident_idx on public.airspaces (dataset_id, ident);
create index airspaces_uuid_idx on public.airspaces (dataset_id, uuid_identifier);

-- ----------------------------------------------------------- geometries ----

-- Eén rij = één volume. operation is BASE, AGG of SUBTR; operation_sequence
-- bepaalt de volgorde waarin de volumes in sheet 2 terechtkomen.
create table public.geometries (
  id                 uuid primary key default gen_random_uuid(),
  airspace_id        uuid not null references public.airspaces(id) on delete cascade,
  geojson            jsonb,
  bbox               jsonb,
  geom_type          text,                     -- Polygon, Circle, …
  operation          text check (operation in ('BASE', 'AGG', 'SUBTR')),
  operation_sequence integer,
  geometry_status    text,
  -- Hoogteband van dít volume. Geeft de airspace zelf niets op, dan die van het
  -- bronvolume — en dan staat in derived_from waar hij vandaan komt.
  lowerlimit         numeric,
  lowerunit          text,
  upperlimit         numeric,
  upperunit          text,
  derived_from       jsonb                     -- idents/uuids van de brongebieden
);

create index geometries_airspace_idx
  on public.geometries (airspace_id, operation_sequence);

-- ---------------------------------------------------------- lara_areas ----

-- De LARA-selectie. Een rij betekent: dit gebied hoort in LARA.
-- lara_area_id mag nog leeg zijn — selecteren en nummeren zijn twee stappen.
create table public.lara_areas (
  id           uuid primary key default gen_random_uuid(),
  dataset_id   uuid not null references public.datasets(id) on delete cascade,
  airspace_id  uuid not null references public.airspaces(id) on delete cascade,
  lara_area_id integer check (lara_area_id > 0),
  note         text,
  added_at     timestamptz not null default now(),
  added_by     uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  -- Meerdere NULLs zijn toegestaan: ongenummerde gebieden botsen niet.
  unique (dataset_id, lara_area_id),
  unique (airspace_id)
);

create index lara_areas_dataset_idx on public.lara_areas (dataset_id, lara_area_id);

create or replace function public.raak_updated_at_aan()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger lara_areas_updated_at
  before update on public.lara_areas
  for each row execute function public.raak_updated_at_aan();

-- --------------------------------------------------------- xml_snippets ----

-- Het originele AIXM-fragment per gebied, voor de AIXM-tab in het detailpaneel.
create table public.xml_snippets (
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  uuid       text not null,
  snippet    text not null,
  primary key (dataset_id, uuid)
);

-- ----------------------------------------------------------- geoborders ----

-- Landsgrenzen. Alleen nodig voor grenzen die niet in het AIXM-bestand zelf
-- zitten; zonder deze aanvulling krijgen gebieden langs de Duitse of Belgische
-- grens geen coördinaten in de export. Niet aan een dataset gebonden: een
-- landsgrens verandert niet per AIRAC-cyclus.
create table public.geoborders (
  id         uuid primary key default gen_random_uuid(),
  border_id  text unique not null,
  name       text,
  geojson    jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger geoborders_updated_at
  before update on public.geoborders
  for each row execute function public.raak_updated_at_aan();
