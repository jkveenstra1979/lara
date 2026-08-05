# Handover — LARA Areas

**Status:** ontwerp vastgesteld, mockup gemaakt, nog geen applicatiecode.
**Datum:** 5 augustus 2026
**Doel van dit document:** een nieuwe sessie (of een andere ontwikkelaar) kan hiermee bouwen zonder de voorafgaande gesprekken te kennen.

---

## 1. Wat we bouwen

Een aparte tool die AIXM 5.1 inleest en een LARA V4 importbestand oplevert. De werkstroom is lineair:

**AIXM uploaden → gebieden bekijken → LARA Area ID toekennen → exporteren (xlsx / KML / GeoJSON)**

De tool is afgeleid van `Airspace_management` (hierna: **de brontool**), waar de LARA-export als bijproduct in zit. Daar is het een admin-hoekje; hier is het het hele product.

### Wel

- AIXM 5.1 upload en parsing, inclusief bogen, cirkels en geoborder-segmenten
- Lijst van gebieden met **LARA ID, designator, naam, type, class, onder- en bovengrens**
- Uniek LARA Area ID per gebied: inline invoer, duplicaatcontrole, "volgend vrij nummer", bulk plakken
- Per gebied: kaartweergave, leesbare coördinatenlijst, het originele AIXM-fragment
- Export: LARA V4 `.xlsx` (10 sheets), KML, GeoJSON

### Niet

Alles wat in de brontool om de LARA-stroom heen is gegroeid gaat **niet** mee: obstakels, composites, geoborder-alignment, PDF-rapporten, 3D-weergave, bugtracker, kleurvoorkeuren, labeloverrides.

---

## 2. Vastgestelde keuzes

| Onderwerp | Keuze | Toelichting |
|---|---|---|
| Accentkleur | **Indigo `#3f3d8f`** (dark: `#8b88e0`) | Ter onderscheid van AIP Check, dat teal `#0f6470` gebruikt |
| Opslag | **Eigen Supabase-project** | Nieuw project, niet dat van de brontool |
| Toegang | **Supabase Auth, e-mail + wachtwoord** | Zonder rollenstelsel en zonder goedkeuringsstroom |
| Framework | **Next.js 16, App Router, React 19** | Zelfde stack als brontool en AIP Check |
| Styling | **CSS Modules + tokenbestand** | Géén Tailwind — de brontool gebruikt Tailwind, hier volgen we AIP Check |
| Fonts | **IBM Plex Sans / Mono, lokaal ingesloten** | Geen externe verzoeken |
| Taal UI | Nederlands | Codeidentifiers blijven Engels |

---

## 3. Bronbestanden om over te nemen

Pad van de brontool: `/Users/jkveenstra/repository/Airspace_management/airspace_management/`

**Kopiëren, geen levende koppeling.** De brontool blijft zelfstandig doorontwikkelen; een gedeelde package zou beide repo's aan elkaar ketenen voor code die zelden wijzigt.

### Ongewijzigd overnemen

| Bronbestand | Regels | Wat het doet |
|---|---:|---|
| `lib/aixmParser.ts` | 1728 | AIXM 5.1 → airspaces, timeslices, vertical limits, classes, activations |
| `lib/aixmGeometryAdvanced.ts` | 545 | Bogen, cirkels, geoborder-segmenten → ring-vertices; `computeAggregatedHorizontal` |
| `lib/aixmGeojsonExport.ts` | 444 | `parsePosList`, `buildRing`, `expandXlinkBorderSegment` |
| `lib/airspaceTransitiveResolve.ts` | — | `resolveTransitiveGeometries` — airspace die naar een andere airspace verwijst |
| `lib/geometryPretty.ts` | 763 | Leesbare geometrietekst, `toDmsLat` / `toDmsLon` / `formatCoord` |
| `lib/xmlSnippetIndex.ts` | 120 | `buildXmlSnippetIndex` — origineel XML-fragment per UUID |
| `lib/laraUtils.ts` | 189 | `decimalToDMS`, `pointToDMS`, `parseCircleGeometryString`, `formatGeometryForLARA`, `resolveVerticalForLARA` |
| `lib/laraExport.ts` | 338 | `buildLaraWorkbook` — de 10 sheets |
| `components/XmlSnippetModal.tsx` | 240 | XML-viewer (wordt hier een tab in plaats van een modal) |
| `lib/__tests__/aixmParser.test.ts` | — | Neem de bestaande tests mee; ze bewaken de parser |

### Herschrijven

| Onderwerp | Bron | Wat er moet gebeuren |
|---|---|---|
| **KML-export** | `app/airspaces/page.tsx` regels ~1180–1360 (`KML_PALETTE`, `featureCollectionToKml`) | Lichten uit de 4440 regels tellende pagina naar een eigen `lib/kmlExport.ts`. Zelfde output, los testbaar. |
| **Kaart** | `components/AirspaceMap.tsx` (1424 regels) | Nieuwe MapLibre-component van ~250 regels: één polygoon of cirkel, fit-to-bounds, hoverlabel. Geen composite-lagen, obstakels, labelposities of 3D. |
| **Lijstpagina** | `app/admin/lara-ids/page.tsx` (486 regels) | Basis voor het hoofdscherm. Toevoegen: kolommen class / onder / boven / geometrietype, detailpaneel, "volgend vrij nummer", filters op type en class. De bulk-plakfunctie kan mee zoals hij is (`parseBulkList`). |
| **Upload-route** | `app/api/upload/route.ts` (259 regels) | Overnemen, maar geoborders eerst uit hetzelfde AIXM-bestand halen in plaats van uit een aparte tabel (zie § 6). |

---

## 4. Datamodel

Nieuw Supabase-project. Vereenvoudigd ten opzichte van de brontool: `lara_area_id` is daar een kolom op `airspaces` met een partial unique index; hier wordt het een eigen tabel, zodat je per dataset kunt hernummeren zonder de import aan te tasten en zodat de nummering een AIRAC-wissel overleeft.

```sql
-- datasets: één AIXM-bestand
create table datasets (
  id            uuid primary key default gen_random_uuid(),
  filename      text not null,
  airac         text,
  uploaded_at   timestamptz default now(),
  uploaded_by   uuid references auth.users(id),
  status        text default 'queued',        -- queued | running | done | error
  error_message text,
  airspace_count int default 0
);

-- airspaces: platgeslagen actieve timeslice
create table airspaces (
  id                   uuid primary key default gen_random_uuid(),
  dataset_id           uuid references datasets(id) on delete cascade,
  gml_id               text,
  uuid_identifier      text,                  -- voor de koppeling met xml_snippets
  ident                text not null,         -- designator
  name                 text,
  type                 text,
  local_type           text,
  class                text,
  lowerlimit           numeric,
  lowerunit            text,
  upperlimit           numeric,
  upperunit            text,
  vertical_limits_json jsonb,
  geometry             text,                  -- leesbare geometrietekst
  geometry_status      text,
  centroid_lat         double precision,
  centroid_lon         double precision,
  warnings_json        jsonb,
  raw_fragment         text
);

-- geometries: één of meer per airspace (BASE / AGG / SUBTR)
create table geometries (
  id                 uuid primary key default gen_random_uuid(),
  airspace_id        uuid references airspaces(id) on delete cascade,
  geojson            jsonb,
  bbox               jsonb,
  geom_type          text,
  operation          text,
  operation_sequence int,
  geometry_status    text
);

-- lara_areas: de toewijzing, uniek binnen een dataset
create table lara_areas (
  id           uuid primary key default gen_random_uuid(),
  dataset_id   uuid references datasets(id) on delete cascade,
  airspace_id  uuid references airspaces(id) on delete cascade,
  lara_area_id integer not null check (lara_area_id > 0),
  note         text,
  updated_at   timestamptz default now(),
  updated_by   uuid references auth.users(id),
  unique (dataset_id, lara_area_id),
  unique (airspace_id)
);

-- xml_snippets: origineel AIXM-fragment per UUID
create table xml_snippets (
  dataset_id uuid references datasets(id) on delete cascade,
  uuid       text not null,
  snippet    text not null,
  primary key (dataset_id, uuid)
);

-- geoborders: landsgrenzen, alleen nodig als ze niet in het AIXM-bestand zitten
create table geoborders (
  id         uuid primary key default gen_random_uuid(),
  border_id  text unique not null,
  name       text,
  geojson    jsonb not null
);
```

RLS: elke ingelogde gebruiker leest en schrijft alles. Geen rollen — dat was een expliciete keuze.

**Overnemen van bestaande nummering.** Bij een nieuwe AIXM-import moeten de LARA IDs van de vorige dataset mee kunnen verhuizen door te matchen op `ident`. Dat is precies wat `parseBulkList` in de brontool al doet, maar dan automatisch. Bouw dit als knop "Neem nummering over van dataset X" op het importscherm; zonder dat moet je na elke AIRAC-cyclus 42 nummers opnieuw intikken.

---

## 5. API-routes

```
POST   /api/upload                      AIXM → dataset, airspaces, geometries, xml_snippets
GET    /api/datasets                    lijst
POST   /api/datasets/:id/inherit        neem LARA-nummering over van een andere dataset
GET    /api/airspaces?datasetId=…       lijst met lara_area_id, type, class, limits, geom_type
GET    /api/airspaces/:id               detail incl. geojson en xml-snippet
PUT    /api/lara-areas                  { airspace_id, lara_area_id | null } — 409 bij duplicaat
POST   /api/lara-areas/bulk             plaklijst verwerken
GET    /api/export/lara?datasetId=…     xlsx
GET    /api/export/kml?datasetId=…      kml van alle genummerde gebieden
GET    /api/export/geojson?datasetId=…  featurecollection
GET    /api/airspaces/:id/kml           kml van één gebied
```

De export-route van de brontool (`app/api/export/lara/route.ts`, 130 regels) is een goede blauwdruk: hij haalt airspaces op, bouwt een geoborder-resolver, vult ontbrekende geometrie aan met `resolveTransitiveGeometries` en roept dan `buildLaraWorkbook` aan. Neem die volgorde over.

---

## 6. Geoborders — het belangrijkste risico

De parser heeft externe grenslijnen nodig (`GeoBorderLookup`) om airspaces te sluiten die via een `xlink` naar een landsgrens verwijzen. In de brontool komen die uit een **aparte upload** en een aparte tabel. Wie dat niet weet, krijgt gebieden langs de Duitse of Belgische grens zonder coördinaten in de LARA-export — en dat is niet zichtbaar tenzij je erop controleert.

Aanpak hier:

1. Bij import eerst geoborders uit het AIXM-bestand zelf halen als ze erin zitten.
2. Wat ontbreekt, aanvullen uit de `geoborders`-tabel.
3. Wat dán nog ontbreekt: **hard zichtbaar maken** — teller op het importscherm, badge `onopgelost` in de lijst, en een bevinding op het exportscherm. Nooit stilzwijgend een lege coördinatenkolom exporteren.

De mockup laat alle drie de plekken zien.

---

## 7. Schermen

Zie de klikbare mockup: `docs/mockup/index.html` (openen in een browser, ook de donkere variant via de knop linksonder).

**1 · Importeren** — dropzone, voortgang, resultaatblok (airspaces / met geometrie / onopgelost / geoborders), waarschuwing over ontbrekende geoborders, lijst met eerdere imports.

**2 · Gebieden** — hoofdscherm. Links de tabel:

```
LARA ID │ DESIGNATOR │ NAAM              │ TYPE │ CLASS │ ONDER   │ BOVEN  │ GEOMETRIE
   1    │ EHR1       │ Deelen            │ R    │  —    │ GND     │ FL 065 │ Polygoon
   6    │ EHD42      │ Cornfield         │ D    │  —    │ GND     │ FL 100 │ Cirkel
  27    │ EHD12      │ Noordzee grens…   │ D    │  —    │ GND     │ FL 195 │ onopgelost
```

Rechts een detailpaneel van 460 px met drie tabs op dezelfde geometrie: **Kaart** (MapLibre), **Coördinaten** (de DMS-reeks precies zoals de export hem schrijft), **AIXM** (het originele fragment). Onderaan knoppen voor KML, GeoJSON en XML kopiëren.

Filters: zoeken op designator/naam, type, class, en "alleen met LARA ID". Sneltoetsen staan permanent in de voetbalk.

**3 · Exporteren** — bevindingenlijst vóór de download (duplicaten, gaten in de nummering, gebieden zonder geometrie, omgerekende hoogtes), overzicht van de 10 sheets, dan de downloadknoppen.

---

## 8. Ontwerpsysteem

Structuur is overgenomen van AIP Check (`/Users/jkveenstra/repository/ADIS_Quality_control/aip-check/styles/`). Twee regels die nergens uitzondering kennen: **radius is 0** en **er zijn geen schaduwen** behalve op een modaal paneel.

De tokens staan volledig in de `<style>` van de mockup en kunnen daaruit worden overgezet naar `styles/tokens.css`. De afwijking van AIP Check zit uitsluitend in het accent:

```css
/* licht */                      /* donker */
--action:      #3f3d8f;          --action:      #8b88e0;
--action-wash: #f4f4fa;          --action-wash: #1c1b2e;
--action-hl:   #dedcf0;          --action-hl:   #343160;
```

Verder: één interactiekleur, mono voor alle machinewaarden (designators, coördinaten, UUID's, hoogtes), hairlines in plaats van kaartranden, sectielabels in de vorm `01 · IMPORTEREN`, en een tabelbasis met sticky kop.

---

## 9. Stappenplan

1. **Project opzetten** — `create-next-app`, TypeScript, App Router, geen Tailwind. Fonts uit `aip-check/app/fonts/` kopiëren. `styles/tokens.css` en `styles/base.css` overzetten met het indigo accent.
2. **Supabase** — nieuw project, migratie uit § 4, RLS, Auth (e-mail + wachtwoord), storage bucket `aixm-uploads`.
3. **Parserlaag** — de bestanden uit § 3 kopiëren, imports fixen, `npm test` groen krijgen op de meegekomen tests.
4. **Import** — `POST /api/upload` met geoborders-uit-bestand (§ 6) en scherm 1.
5. **Gebiedenlijst** — scherm 2 links: tabel, filters, inline ID-invoer met duplicaatcontrole, bulk plakken, nummering overnemen.
6. **Detailpaneel** — scherm 2 rechts: de drie tabs. Kaart als laatste; de coördinaten- en AIXM-tab zijn goedkoop en al direct nuttig.
7. **Export** — `lib/kmlExport.ts` isoleren, de drie exportroutes, scherm 3 met de bevindingencontrole.
8. **Afronden** — README, `.env.example`, deploy.

Stap 3 en 4 zijn het meeste werk en het meeste risico. Stap 5 en 6 zijn grotendeels bestaande code opnieuw arrangeren.

---

## 10. Open punten

- **AIRAC-veld.** De brontool leidt de cyclus niet af uit het bestand. Uit de bestandsnaam halen (`EHAA_AIXM51_2608.xml` → 2608) of handmatig laten invullen bij de upload?
- **Vaste waarden in de export.** `buildLaraWorkbook` schrijft `AMC = EHMCZAMC`, geldigheid `01/01/2018–31/12/2036`, type `R`, tijdvak `MON–SUN 00:00–24:00` hard in de sheets. Moeten die per gebied instelbaar worden, of blijven ze vast? Zolang ze vast blijven, is de kolom `Type` in sheet 1 altijd `R`, ook voor een TRA.
- **Meerdere volumes per gebied.** Sheet 2 heet `Area Volumes` en staat meer dan één rij per gebied toe. De huidige implementatie schrijft er precies één. Als een gebied gelaagde volumes heeft (verschillende hoogtebanden), gaat dat nu verloren.
- **Bestandsnaam van de export.** Nu vast `LARAV4_export.xlsx`. Met AIRAC en datum erin (`LARAV4_2608_20260805.xlsx`) is een download achteraf terug te herleiden.
