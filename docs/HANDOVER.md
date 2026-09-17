# Handover — LARA Areas

**Status:** ontwerp vastgesteld, mockup gemaakt (nog zonder scherm 3), nog geen applicatiecode.
**Datum:** 5 augustus 2026
**Doel van dit document:** een nieuwe sessie (of een andere ontwikkelaar) kan hiermee bouwen zonder de voorafgaande gesprekken te kennen.

---

## 1. Wat we bouwen

Een aparte tool die AIXM 5.1 inleest en een LARA V4 importbestand oplevert. De werkstroom is lineair:

**AIXM uploaden → gebieden bekijken → selecteren voor LARA → Area ID toekennen → exporteren (xlsx / KML / GeoJSON)**

De tool is afgeleid van `Airspace_management` (hierna: **de brontool**), waar de LARA-export als bijproduct in zit. Daar is het een admin-hoekje; hier is het het hele product.

### Wel

- AIXM 5.1 upload en parsing, inclusief bogen, cirkels en geoborder-segmenten
- Lijst van gebieden met **LARA ID, designator, naam, type, class, onder- en bovengrens**
- **LARA-selectie als eigen lijst:** niet elk AIXM-gebied gaat naar LARA. Je kiest gebieden en beheert ze op een eigen scherm
- Uniek LARA Area ID per geselecteerd gebied: inline invoer, duplicaatcontrole, "volgend vrij nummer", bulk plakken
- Afgeleide gebieden: een airspace die uit andere airspaces is opgebouwd levert **meerdere volumes** (geometrie + eigen hoogteband) op
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
| Toegang | **Supabase Auth, e-mail + wachtwoord** | Twee rollen: `admin` beheert gebruikers, `user` niet. Aan de gegevens mag iedereen evenveel doen |
| Uitnodigen | **Link die de beheerder zelf doorstuurt** | Geen SMTP gekoppeld. Patroon overgenomen uit AeroDB-Feature-Handbook |
| Framework | **Next.js 16, App Router, React 19** | Zelfde stack als brontool en AIP Check |
| Styling | **CSS Modules + tokenbestand** | Géén Tailwind — de brontool gebruikt Tailwind, hier volgen we AIP Check |
| Fonts | **IBM Plex Sans / Mono, lokaal ingesloten** | Geen externe verzoeken |
| Taal UI | Nederlands | Codeidentifiers blijven Engels |
| AIRAC-cyclus | **Handmatig invullen bij de upload** | Niet uit de bestandsnaam raden; het veld is verplicht en stuurt de exportnaam |
| LARA-selectie | **Eigen lijst, apart scherm** | Een gebied staat pas in LARA als je het toevoegt. Het Area ID hoort bij de selectie, niet bij de airspace |
| Vaste waarden in de export | **Uit AIXM waar het kan** | Type, geldigheid en tijdvak komen uit het bestand; alleen `AMC` blijft vast |

---

## 3. Bronbestanden om over te nemen

Pad van de brontool: `/Users/jkveenstra/repository/Airspace_management/airspace_management/`

**Kopiëren, geen levende koppeling.** De brontool blijft zelfstandig doorontwikkelen; een gedeelde package zou beide repo's aan elkaar ketenen voor code die zelden wijzigt.

De lijst hieronder was bij het ontwerp korter dan de werkelijkheid: `aixmParser.ts` trekt `geo.ts`, `airspaceGeometryAggregator.ts` en `airspaceGeometryTransitive.ts` mee. Elf bestanden in totaal, en daarmee is de graaf gesloten. Ze staan ongewijzigd in `lib/` op twee dingen na: het `MultiPolygon`-type in twee bestanden is aangescherpt van `number[][][][]` naar `Pair[][][]` (anders weigert `polygon-clipping` ze), en `airspaceTransitiveResolve.ts` heeft een waarschuwing bovenaan. De ESLint-config zet `no-explicit-any` uit voor precies deze bestanden, zodat een diff met de brontool leesbaar blijft.

### Ongewijzigd overnemen

| Bronbestand | Regels | Wat het doet |
|---|---:|---|
| `lib/aixmParser.ts` | 1728 | AIXM 5.1 → airspaces, timeslices, vertical limits, classes, activations |
| `lib/geo.ts` | 59 | `bboxFromCoords`, `centroidFromPolygon`, `coordsFromPosList`, `ensureClosedRing` |
| `lib/airspaceGeometryAggregator.ts` | 417 | booleaanse bewerkingen op MultiPolygons |
| `lib/airspaceGeometryTransitive.ts` | 346 | airspace die naar een andere airspace verwijst, met geoborders |
| `lib/aixmGeometryAdvanced.ts` | 545 | Bogen, cirkels, geoborder-segmenten → ring-vertices; `computeAggregatedHorizontal` |
| `lib/aixmGeojsonExport.ts` | 444 | `parsePosList`, `buildRing`, `expandXlinkBorderSegment` |
| `lib/airspaceTransitiveResolve.ts` | — | `resolveTransitiveGeometries` — airspace die naar een andere airspace verwijst |
| `lib/geometryPretty.ts` | 763 | Leesbare geometrietekst, `toDmsLat` / `toDmsLon` / `formatCoord` |
| `lib/xmlSnippetIndex.ts` | 120 | `buildXmlSnippetIndex` — origineel XML-fragment per UUID |
| `lib/laraUtils.ts` | 189 | `decimalToDMS`, `pointToDMS`, `parseCircleGeometryString`, `formatGeometryForLARA`, `resolveVerticalForLARA` |
| `components/XmlSnippetModal.tsx` | 240 | XML-viewer (wordt hier een tab in plaats van een modal) |
| `lib/__tests__/aixmParser.test.ts` | — | Neem de bestaande tests mee; ze bewaken de parser |

Eén uitbreiding op deze bestanden: `aixmParser.ts` en `aixmGeometryAdvanced.ts` geven nu per airspace één samengevoegde geometrie terug. Voor § 5.2 moet de **lijst met volumes** behouden blijven — per geometriecomponent de operatie, de eigen hoogteband en de bron. `computeAggregatedHorizontal` mag blijven wat hij is; de componenten moeten er alleen naast bewaard worden in plaats van weggegooid.

### Herschrijven

| Onderwerp | Bron | Wat er moet gebeuren |
|---|---|---|
| **KML-export** | `app/airspaces/page.tsx` regels ~1180–1360 (`KML_PALETTE`, `featureCollectionToKml`) | Lichten uit de 4440 regels tellende pagina naar een eigen `lib/kmlExport.ts`. Zelfde output, los testbaar. |
| **Kaart** | `components/AirspaceMap.tsx` (1424 regels) | Nieuwe MapLibre-component van ~250 regels: één polygoon of cirkel, fit-to-bounds, hoverlabel. Geen composite-lagen, obstakels, labelposities of 3D. |
| **Lijstpagina** | `app/admin/lara-ids/page.tsx` (486 regels) | Basis voor scherm 2 (Gebieden). Toevoegen: kolommen class / onder / boven / geometrietype, detailpaneel, filters op type en class, en een **toevoegen-aan-LARA**-actie per rij plus een selectievakje voor bulk toevoegen. Het ID-invoerveld verhuist naar scherm 3. |
| **Selectiepagina** | idem, tweede gebruik | Nieuw scherm 3 (LARA-selectie): alleen de gekozen gebieden, inline ID-invoer met duplicaatcontrole, "volgend vrij nummer", verwijderen uit de lijst, nummering overnemen. De bulk-plakfunctie (`parseBulkList`) hoort hier thuis en voegt in één keer toe én nummert. |
| **Export-workbook** | `lib/laraExport.ts` (338 regels) | `buildLaraWorkbook` moet z'n vaste waarden uit AIXM gaan halen (§ 5.1 en § 5.2) en per gebied meerdere rijen in `Area Volumes` schrijven (§ 5.4). De sheetopbouw zelf blijft. |
| **Upload-route** | `app/api/upload/route.ts` (259 regels) | Overnemen, maar geoborders eerst uit hetzelfde AIXM-bestand halen in plaats van uit een aparte tabel (zie § 7). Plus het handmatig ingevulde AIRAC-veld opslaan. |

---

## 4. Datamodel

Nieuw Supabase-project. Vereenvoudigd ten opzichte van de brontool: `lara_area_id` is daar een kolom op `airspaces` met een partial unique index; hier wordt het een eigen tabel. Die tabel is tegelijk de **selectie** — een rij bestaat alleen voor gebieden die in LARA horen. Daarmee kun je per dataset hernummeren zonder de import aan te tasten, en overleeft zowel de selectie als de nummering een AIRAC-wissel.

De migratie staat in [`supabase/migrations/`](../supabase/migrations/); dat is de definitieve vorm. Hij is getoetst tegen een lokale Postgres 16 en daarna uitgevoerd op de self-hosted Supabase-omgeving. Hieronder wat je moet weten om hem te lezen.

| Tabel | Bevat | Let op |
|---|---|---|
| `datasets` | één AIXM-bestand | `airac` is `not null` — handmatig ingevuld bij de upload |
| `airspaces` | platgeslagen actieve timeslice, één rij per gebied | `lowerlimit`/`upperlimit` zijn de **omhullende** band over alle volumes; sheet 1 gebruikt die |
| `geometries` | **één rij per volume**: geometrie mét eigen hoogteband | `operation` is `BASE`/`UNION`/`SUBTR`/`INTERS` (AIXM) plus `AGG` voor de samenvoeging; `derived_from` houdt de herkomst vast |
| `lara_areas` | de LARA-selectie | een rij = in LARA; `lara_area_id` mag `null` zijn |
| `xml_snippets` | origineel AIXM-fragment per UUID | sleutel `(dataset_id, uuid)` |
| `geoborders` | landsgrenzen | niet aan een dataset gebonden — een grens verandert niet per cyclus |

Twee kolommen zijn tijdens het bouwen toegevoegd, beide omdat de mockup ze vraagt:

- `datasets.storage_path` — het geüploade bestand blijft in de bucket staan, zodat een import herhaald kan worden na een parserwijziging zonder opnieuw te uploaden.
- `datasets.is_active` — de dataset waar de applicatie op opent, met een partial unique index zodat er hoogstens één actief is. De mockup toont dit als badge `actief` en de knop *Activeren* op eerdere imports.

Verder afgedwongen in de database, niet in de applicatie: `status` en `operation` als check-constraint, `lara_area_id > 0`, uniek `(dataset_id, lara_area_id)` (meerdere `null`s botsen niet, dus ongenummerde selecties staan naast elkaar), uniek `airspace_id` (een gebied staat hoogstens één keer in de lijst), en een trigger op `updated_at`.

RLS: elke ingelogde gebruiker leest en schrijft alles aan luchtruimgegevens. Wat RLS hier wél doet is niet-ingelogde verzoeken tegenhouden: zonder policies leest de anon key uit een publieke build de hele tabel uit.

**Overnemen van selectie en nummering.** Bij een nieuwe AIXM-import moeten zowel de selectie als de LARA IDs van de vorige dataset mee kunnen verhuizen, door te matchen op `ident`. Dat is precies wat `parseBulkList` in de brontool al doet, maar dan automatisch. Bouw dit als knop "Neem over van dataset X" op het importscherm en op scherm 3; zonder dat moet je na elke AIRAC-cyclus 42 gebieden opnieuw aanvinken en nummeren.

Het overnemen levert drie uitkomsten op, en alle drie moeten zichtbaar zijn: **overgenomen** (ident bestaat in beide datasets), **vervallen** (stond in de vorige selectie, komt niet meer voor in dit AIXM), en **nieuw** (staat in dit AIXM, stond niet in de vorige selectie). De laatste twee zijn de reden dat je dit doet — een gebied dat stilzwijgend uit de LARA-lijst verdwijnt is een fout die pas bij de gebruiker opvalt.

---

## 5. Exportregels

**Bron: de officiële specificatie** — `documents/LARA V4.0 Excel Airspace Import Format.pdf` (Graffica, GL/LARA/C0145/SPEC/4). De V5-uitgave is inhoudelijk **identiek**; alleen de kaft verschilt (Sopra Steria, 2025). Voor het formaat maakt de keuze V4 of V5 dus niets uit.

Daarnaast ligt er een template: `documents/LARA V5 Excel Airspace Housekeeper Import Template (1).xlsx`. Die spreekt het document op drie punten tegen — dagnamen, gradenteken en leidende nullen. **Het document is leidend**; de verschillen staan met een testaanwijzing in [TESTPLAN.md](TESTPLAN.md). De template levert wél iets wat het document mist: de lijst met geaccepteerde Area Types.

Dat document vervangt de eerdere aannames, die uit de opdrachtbeschrijving van de brontool kwamen (`Airspace_management/tasks/LARA_export_claude_code.md`). Die beschrijving zegt zelf dat de headers nog gecontroleerd moesten worden.

### 5.1 Wat de specificatie voorschrijft

**Coordinaten.** `xx°xx'xx"N,xxx°xx'xx"E`, paren gescheiden door een puntkomma; decimale graden mag ook. Dit is precies wat `formatGeometryForLARA` produceert — geen wijziging nodig. De kolom `Coordinates` mag expliciet **langer dan 255 tekens** zijn; de algemene limiet uit § 1 van de spec geldt daar niet.

**Cirkels: diameter, geen straal.** De spec zegt letterlijk *"the coordinates of the centre-point of the circle … and then the **diameter** in Nautical Miles"*, met voorbeeld `"52°43'51"N,006°30'57"E;2NM"`. AIXM levert een **straal** (`gml:radius uom="[nmi_i]"`). De brontool schrijft die straal ongewijzigd weg. Is de spec letterlijk bedoeld, dan is elke cirkelvormige zone in LARA half zo groot als hij hoort te zijn. **Open punt — zie § 11.**

**Verplicht is bijna niets.** Van de 34 kolommen in `Areas` zijn er zes `[MANDATORY]`: `Area ID`, `Area Name`, `Type`, `AMC`, `Start Date`, `End Date`. De rest is `[OPTIONAL]` en krijgt bij leeglaten een standaardwaarde uit LARA's eigen `housekeeperSettings.gsdk`. Optionele kolommen mogen zelfs helemaal ontbreken.

Dat draait de eerdere aanname om: de vaste waarden die de brontool hard wegschrijft (`Applies By Default`, `Pending Time`, `Before Buffer`, …) zijn geen eis maar een gok. Weglaten is veiliger — dan geldt de instelling die de beheerder in LARA zelf heeft gezet.

**Sheets mogen ontbreken.** *"The imported Excel file does not need to contain all the Worksheets."* De zes lege sheets zijn niet nodig; wel moet elke aanwezige sheet exact heten zoals in de template.

**Volumes.** `Lower Alt` en `Upper Alt` zijn verplicht en mogen `GND`, `MSL` of `UNL` zijn. `Lower Alt` moet **kleiner** zijn dan `Upper Alt`, anders wordt het gebied niet geimporteerd. Eenheid is `FL` of `ft`; voet wordt naar beneden afgerond op 10 ft.

**Timesheets.** `Day From` / `Day Til` gebruiken volgens het document `MON / TUES / WED / THUR / FRI / SAT / SUN`; de template schrijft op drie plekken `TUE` en `THU`. We volgen het document en toetsen het bij de eerste import — zie TESTPLAN § 1.1. Dagen mogen niet omlopen. Tijden in `HH:mm`, starttijd vóór eindtijd.

Vertaling vanuit AIXM: `ANY` → `MON`–`SUN` (bevestigd door de datamanager), `WORK_DAY` → `MON`–`FRI`. Voor `HOL` (78× in het AIXM-bestand) bestaat geen equivalent; die timesheets worden niet uitgeschreven maar wél als bevinding getoond. Of LARA feestdagen kent is niet bekend — TESTPLAN § 4.2.

**Overig.** UTF-8 verplicht. `UUID` is optioneel; laat je hem weg, dan maakt LARA er zelf een.

### 5.2 Wat dat betekent voor de export

| Onderwerp | Eerdere aanname | Wat de spec zegt |
|---|---|---|
| `Type` | altijd `R` | verplicht, uit AIXM. LARA kent 21 waarden (zie hieronder); de rest wordt `UNKNOWN` |
| Vaste waarden | 34 kolommen hard invullen | zes verplicht, rest weglaten en LARA's defaults laten gelden |
| Cirkel | straal in NM | **diameter** in NM |
| Lege sheets | zes meeleveren | niet nodig |
| `Coordinates` | — | mag langer dan 255 tekens |
| Dagen | `MON`–`SUN` | document zegt `TUES`/`THUR`, template `TUE`/`THU` — zie TESTPLAN |

**De Area Types die LARA kent** staan niet in het document maar wel in de sheet `Options` van de template — 21 waarden:

```
TSA · TRA · D · RCA · P · RVA · MTA · R · MRA · FIR · PIR · UIR
ES · CS · CTA · TMA · UTA · CTR · OCA · CBA · UNKNOWN
```

Van de 922 airspaces in het AIXM-bestand vallen er 156 (16%) binnen die lijst en 766 (83%) daarbuiten. Dat klinkt erger dan het is: de herkende types zijn precies de reserveerbare gebieden — TSA, TRA, R, D, P, CBA — en dat zijn de gebieden die je voor LARA selecteert. Approach-sectoren, helikopterzones en radargebieden horen er niet in.

Het type gaat ongewijzigd mee; het exportscherm meldt welke geselecteerde gebieden buiten de lijst vallen. Geen automatische omzetting: `TMA_P` naar `TMA` mappen lijkt logisch maar is een aanname over wat `_P` betekent.

### 5.3 Wat het echte AIXM-bestand laat zien

`documents/snapshot_AeroDB_2026-09-03_LIVE.xml` (96 MB, AIRAC 3-9-2026) is de eerste echte meting:

| | |
|---|---:|
| Airspaces (allemaal met designator) | 922 |
| `CircleByCenterPoint` | 848 |
| `ArcByCenterPoint` | 3716 |
| GeoBorders in het bestand | 7 |
| Verwijzingen naar een geoborder (`curveMember xlink:href`) | **0** |
| Timesheets | 2017 |

Drie dingen springen eruit:

1. **848 cirkels.** De diameter-kwestie raakt honderden gebieden, geen randgeval.
2. **Geen enkele geoborder-verwijzing.** Het risico uit § 7 speelt bij dít bestand niet. De detectie blijft nodig — een volgende cyclus kan ze wel bevatten, en dan is de fout stil.
3. **Dagen die LARA niet kent.** Naast `ANY` (1160×) en de weekdagen komen `HOL` (78×) en `WORK_DAY` (2×) voor. Daar is geen `Day From`/`Day Til` voor. `ANY` wordt `MON`–`SUN`, bevestigd door de datamanager (`documents/Nadere details over Timesheet in AIXM51.eml`).
4. **295× `endTime 00:00`.** Bij een starttijd van 00:00 betekent dat een etmaal, maar LARA eist dat de starttijd vóór de eindtijd ligt. Dat moet `24:00` worden — de 558 timesheets die al `24:00` schrijven laten zien dat beide notaties door elkaar voorkomen.

Airspace-types in dit bestand: `A` (268), `RAS` (198), `HTZ` (91), `D_OTHER` (52), `PART` (45), `SECTOR` (41), `TMA` (31), `TSA` (27), `R` (26), `TRA` (22), `CTR` (16), `D` (19), `P` (4) en meer. Welke daarvan LARA kent is niet gedocumenteerd; onbekende worden `UNKNOWN`.

### 5.4 Meerdere volumes per gebied

Sheet 2 (`Area Volumes`) koppelt op `Area ID` en staat meerdere rijen per gebied toe. De samenstelling komt **uit AIXM zelf**: `AirspaceGeometryComponent` met een operatie uit `CodeAirspaceAggregationType` — `BASE`, `UNION`, `SUBTR` of `INTERS` — eventueel via een verwijzing naar een andere airspace (`resolveTransitiveGeometries`). Er is geen handmatige stap; je stelt in deze tool geen gebieden samen.

`AGG` is géén AIXM-operatie: de parser gebruikt het als markering voor de samengevoegde geometrie van alle componenten samen. Dat onderscheid kostte een herstelmigratie — de eerste versie liet `AGG` toe maar `UNION` en `INTERS` niet, en daarmee zou elk samengesteld gebied de import hebben laten struikelen.

Regels:

1. Elke rij in `geometries` is één volume: geometrie plus hoogteband. `collectVolumes` in [`lib/airspaceVolumes.ts`](../lib/airspaceVolumes.ts) levert ze, op `operationSequence` gesorteerd.
2. Geeft de airspace zelf geen hoogteband op, dan die van het bronvolume overnemen — en `derived_from` vullen, zodat herleidbaar is waar hij vandaan komt.
3. Sheet 2 schrijft één rij per volume, in `operation_sequence`-volgorde.
4. Sheet 1 houdt één rij per gebied, met de omhullende hoogteband — `envelopeVerticalLimits`, dat over eenheden heen vergelijkt maar de originele eenheid teruggeeft.
5. Gebieden met meer dan één volume krijgen een badge in de lijst en een regel in de bevindingen.

### 5.5 Bogen en landsgrenzen in de vorm

`parseAixm` levert per volume een GeoJSON met alleen de **ankerpunten**: een boog
blijft één punt en een landsgrens één rechte lijn. Voor EHWO — een CTR met een
boog van 8 NM en een stuk Belgisch-Nederlandse grens — geeft dat een polygoon van
vijf punten waar er 121 horen.

Dat is niet alleen op de kaart te zien. `formatGeometryForLARA` leest dezelfde
vorm, dus de kolom `Coordinates` zou net zo grof zijn: vijf coördinaten voor een
gebied dat er 121 nodig heeft.

De geometrietekst bevat wél alles — `ARC(51.449,4.342,8,CW,…)` en
`BORDER(uuid,…)`. `geometryStringToMultiPolygon` uit
[`lib/airspaceGeometryTransitive.ts`](../lib/airspaceGeometryTransitive.ts)
(overgenomen uit de brontool) zet die om naar een ring met de boog geïnterpoleerd
en de grens gevolgd. De import gebruikt dat nu voor élk volume én voor de
samenvoegrij — die laatste wordt geleend door gebieden die ernaar verwijzen, dus
die moet net zo compleet zijn.

In het bestand van 3 september raakt dit **109 volumes met een boog** en **107 met
een grens**. EHBK2 gaat van een handvol punten naar 1354.

### 5.6 Gebieden die hun vorm lenen

AIXM laat een airspace naar een andere verwijzen in plaats van eigen coördinaten op te schrijven: EHR4A is "EHR4, maar dan deze hoogteband". Zo'n volume heeft `derived_from` gevuld en `geojson` leeg.

In het bestand van 3 september 2026 raakt dat **11 van de 100** reserveerbare gebieden — EHR3A, EHR3B, EHR4A, EHR8A, EHD41D, EHD69A, EHTRA10A, EHTRA10B, EHTRA59A, EHTSA16B en EBTRAN2. Zonder oplossing komt hun kolom `Coordinates` leeg in het werkboek en weigert LARA de rij.

`haalExportSet` in [`lib/exportData.ts`](../lib/exportData.ts) haalt daarom de vorm op van het gebied waarnaar verwezen wordt. Alle twaalf verwijzingen in dat bestand zijn zo op te lossen; de samenvoegrij (`AGG`) van het brongebied wint, want die beschrijft het als geheel.

Dat is de eenvoudige variant van `resolveTransitiveGeometries` uit de brontool, die een `time_slices_json` verwacht die wij niet hebben. Voor een verwijzing die zelf weer doorverwijst is dit niet genoeg — dan blijft de vorm leeg en verschijnt er een bevinding.

### 5.7 Bestandsnaam

`LARAV4_<airac>_<datum>.xlsx`, bijvoorbeeld `LARAV4_2608_20260805.xlsx`. De AIRAC komt uit `datasets.airac`, de datum is de exportdatum. KML en GeoJSON volgen hetzelfde patroon.

---

## 6. API-routes

```
POST   /api/upload                      AIXM + airac → dataset, airspaces, geometries, xml_snippets
GET    /api/datasets                    lijst
POST   /api/datasets/:id/inherit        neem selectie én nummering over van een andere dataset
                                        → { overgenomen, vervallen[], nieuw[] }
GET    /api/airspaces?datasetId=…       lijst met in_lara, lara_area_id, type, class, limits,
                                        geom_type, volume_count
GET    /api/airspaces/:id               detail incl. volumes, geojson en xml-snippet

POST   /api/lara-areas                  { dataset_id, airspace_ids[] } — toevoegen aan de selectie
DELETE /api/lara-areas/:airspaceId      uit de selectie halen (ID vervalt mee)
PUT    /api/lara-areas                  { airspace_id, lara_area_id | null } — 409 bij duplicaat
POST   /api/lara-areas/bulk             plaklijst: toevoegen én nummeren in één keer
GET    /api/lara-areas?datasetId=…      de selectie, inclusief gaten in de nummering

GET    /api/export/lara?datasetId=…     xlsx  (LARAV4_<airac>_<datum>.xlsx)
GET    /api/export/kml?datasetId=…      kml van de LARA-selectie
GET    /api/export/geojson?datasetId=…  featurecollection van de LARA-selectie
GET    /api/airspaces/:id/kml           kml van één gebied
```

Alle exportroutes gaan over de **selectie**, niet over alle airspaces in de dataset. Een geselecteerd gebied zonder Area ID is een bevinding, geen reden om het weg te laten.

De export-route van de brontool (`app/api/export/lara/route.ts`, 130 regels) is een goede blauwdruk: hij haalt airspaces op, bouwt een geoborder-resolver, vult ontbrekende geometrie aan met `resolveTransitiveGeometries` en roept dan `buildLaraWorkbook` aan. Neem die volgorde over, met de selectie als filter ervoor.

---

## 7. Geoborders — het belangrijkste risico

De parser heeft externe grenslijnen nodig (`GeoBorderLookup`) om airspaces te sluiten die via een `xlink` naar een landsgrens verwijzen. In de brontool komen die uit een **aparte upload** en een aparte tabel.

**Het risico is erger dan hier eerst stond.** Bij het bouwen van de import bleek wat er werkelijk gebeurt als de grens ontbreekt: de parser sluit de ring met een **rechte lijn** tussen de twee ankerpunten, zet `geometryStatus` op `ok`, en geeft geen enkele waarschuwing. Het gebied komt dus niet zonder coördinaten in de export, maar met **verkeerde** coördinaten — en dat valt aanzienlijk minder op dan een lege kolom. Voor een gebied langs de Duitse of Belgische grens kan dat tientallen vierkante kilometers schelen.

Vastgelegd in `lib/__tests__/aixmImport.test.ts` ("noemt een gebied met een ontbrekende grens niet langer 'ok'").

**Hoeveel het er zijn.** In het AIXM van 3 september 2026: zeven grenzen
(BELGIUM_NETHERLANDS, GERMANY_NETHERLANDS, BELGIUM_GERMANY, BELGIUM_FRANCE,
BELGIUM_LUXEMBOURG, GERMANY_LUXEMBOURG, FRANCE_LUXEMBOURG) en **104 gebieden die
er een volgen**, met 146 verwijzingen. De Belgisch-Nederlandse grens alleen al
raakt 67 gebieden. Geen randgeval dus.

Getoetst door de `GeoBorder`-elementen uit het bestand te knippen en opnieuw te
importeren: 104 gebieden krijgen dan `partial` en alle zes de betrokken grenzen
worden gemeld met de gebieden die erop wachten. Met de grenzen uit de tabel
erbij: nul. 

Aanpak hier:

1. **Uit het bestand zelf.** `parseAixm` doet dit al: grenzen uit het AIXM leggen zich over de meegegeven lookup heen. Die volgorde klopt en hoefde niet te veranderen.
2. **Aanvullen uit de tabel.** De import geeft `geoborderLookupUitRijen(...)` mee. Grenzen uit een bestand worden ook wéggeschreven naar die tabel, zodat een volgend AIXM-bestand zónder grenzen alsnog werkt.
3. **Wat dán nog ontbreekt, hard zichtbaar maken.** Niet via de waarschuwingen van de parser — die zijn er niet. `bouwImport` leest de `BORDER(uuid,…)`-verwijzingen uit de geometrietekst en vergelijkt ze met wat beschikbaar was. Wat overblijft:
   - `geometry_status` gaat van `ok` naar `partial`, zodat de lijst en de export het kunnen volgen;
   - er komt een waarschuwing bij het gebied, in gewone taal;
   - het importscherm toont per grens welke gebieden erop wachten, in rood.

Nooit een gebied als `ok` doorlaten waarvan de vorm aantoonbaar niet klopt.

---

## 8. Schermen

Zie de klikbare mockup: `docs/mockup/index.html` (openen in een browser, ook de donkere variant via de knop linksonder). De vier schermen hieronder staan er alle vier in.

**1 · Importeren** — dropzone, **verplicht AIRAC-veld** naast de bestandskeuze, voortgang, resultaatblok (airspaces / met geometrie / onopgelost / geoborders / gebieden met meerdere volumes), waarschuwing over ontbrekende geoborders, knop "neem selectie over van dataset X", lijst met eerdere imports.

**2 · Gebieden** — alles wat in het AIXM-bestand zit. Links de tabel:

```
✓ │ DESIGNATOR │ NAAM              │ TYPE │ CLASS │ ONDER   │ BOVEN  │ GEOMETRIE
▣ │ EHR1       │ Deelen            │ R    │  —    │ GND     │ FL 065 │ Polygoon
□ │ EHD42      │ Cornfield         │ D    │  —    │ GND     │ FL 100 │ Cirkel
□ │ EHD12      │ Noordzee grens…   │ D    │  —    │ GND     │ FL 195 │ onopgelost
▣ │ EHTRA10    │ TRA 10            │ TRA  │  —    │ FL 055  │ FL 245 │ 3 volumes
```

Een gevuld vakje betekent: staat in de LARA-lijst. Toevoegen kan per rij of met een selectie in één keer. Rechts een detailpaneel van 460 px met drie tabs op dezelfde geometrie: **Kaart** (MapLibre), **Coördinaten** (de DMS-reeks precies zoals de export hem schrijft), **AIXM** (het originele fragment). Bij meerdere volumes een kiezer bovenin het paneel, met per volume de eigen hoogteband en de herkomst uit `derived_from`. Onderaan knoppen voor KML, GeoJSON en XML kopiëren.

Filters: zoeken op designator/naam, type, class, en "alleen in LARA" / "alleen nog niet in LARA".

**3 · LARA-selectie** — de lijst die geëxporteerd wordt, en de enige plek waar Area IDs staan:

```
LARA ID │ DESIGNATOR │ NAAM              │ TYPE │ ONDER   │ BOVEN  │ NOTITIE
   1    │ EHR1       │ Deelen            │ R    │ GND     │ FL 065 │
   2    │ EHTRA10    │ TRA 10            │ TRA  │ FL 055  │ FL 245 │ 3 volumes
   6    │ EHD42      │ Cornfield         │ D    │ GND     │ FL 100 │
   —    │ EHD12      │ Noordzee grens…   │ D    │ GND     │ FL 195 │ nog geen ID
```

Inline ID-invoer met duplicaatcontrole, knop "volgend vrij nummer", bulk plakken (voegt toe én nummert), regel verwijderen uit de lijst, en "neem over van dataset X" met de uitkomst overgenomen / vervallen / nieuw. Bovenaan een strook met de stand: *aantal in lijst · genummerd · zonder ID · gaten in de reeks*.

De duplicaatcontrole komt uit de database, niet uit de applicatie: een controle vooraf laat twee gebruikers die tegelijk hetzelfde nummer intikken alsnog door. Daarvoor moest de unique constraint wél **uitstelbaar** worden — anders loopt het omwisselen van twee nummers stuk op een tussenstand die niemand wil hebben. Zie migratie `20260806140000_nummers_omwisselen.sql`.

**4 · Exporteren** — bevindingenlijst vóór de download: duplicaten, gaten in de nummering, geselecteerde gebieden zonder ID, gebieden zonder geometrie, onopgeloste geoborders, gebieden met meerdere volumes, en terugvallen op vaste waarden (§ 5.1). Daaronder het overzicht van de 10 sheets en dan de downloadknoppen, met de bestandsnaam zichtbaar.

---

## 9. Ontwerpsysteem

Structuur is overgenomen van AIP Check (`/Users/jkveenstra/repository/ADIS_Quality_control/aip-check/styles/`). Twee regels die nergens uitzondering kennen: **radius is 0** en **er zijn geen schaduwen** behalve op een modaal paneel.

De tokens staan in [`styles/tokens.css`](../styles/tokens.css), de primitieven in [`styles/base.css`](../styles/base.css); de mockup houdt dezelfde waarden in zijn `<style>`. Schermeigen opmaak hoort in een CSS Module naast de component, niet in `base.css`. De afwijking van AIP Check zit uitsluitend in het accent:

```css
/* licht */                      /* donker */
--action:      #3f3d8f;          --action:      #8b88e0;
--action-wash: #f4f4fa;          --action-wash: #1c1b2e;
--action-hl:   #dedcf0;          --action-hl:   #343160;
```

Verder: één interactiekleur, mono voor alle machinewaarden (designators, coördinaten, UUID's, hoogtes), hairlines in plaats van kaartranden, sectielabels in de vorm `01 · IMPORTEREN`, en een tabelbasis met sticky kop.

---

## 10. Stappenplan

1. ~~**Project opzetten**~~ — **klaar.** Next.js 16.3, TypeScript, App Router, geen Tailwind. IBM Plex lokaal in `app/fonts/`, tokens en primitieven in `styles/`.
2. ~~**Supabase**~~ — **klaar.** Migraties uitgevoerd op een self-hosted omgeving, RLS en storage-policies actief, clientlaag en inlogscherm staan er. `npm run check:supabase` toetst de omgeving; `npm run gebruiker` maakt een account aan.
3. ~~**Parserlaag**~~ — **klaar.** Elf bestanden overgenomen, `npm test` groen (15 tests), plus [`lib/airspaceVolumes.ts`](../lib/airspaceVolumes.ts) voor de volume-uitbreiding. Eén ding blijft staan: `airspaceTransitiveResolve.ts` past nog niet op ons schema, zie de opmerking bovenaan dat bestand — dat hoort bij stap 8.
4. ~~**Import**~~ — **klaar.** `POST /api/upload`, `GET /api/datasets`, `POST /api/datasets/:id/inherit`, scherm 1 en de applicatieschil (rail, stappenbalk, voetbalk). De importlogica staat los van de database in [`lib/aixmImport.ts`](../lib/aixmImport.ts), met 25 tests. De keten is tegen de echte omgeving gedraaid: een AIXM met drie volumes en een ontbrekende landsgrens erin, alle rijen weggeschreven en teruggelezen, daarna opgeruimd. Alleen de HTTP-laag zelf (sessiecontrole, `formData`) is nog niet met een browser gedraaid.
5. ~~**Gebiedenlijst**~~ — **klaar.** Scherm 2 links: tabel met selectievakjes, filters op designator/naam, type, class en LARA-status, toevoegen per rij en in bulk (alles wat de filters overlaten). `GET /api/airspaces`, `POST` en `DELETE /api/lara-areas`. De query staat in [`lib/gebieden.ts`](../lib/gebieden.ts), gedeeld tussen pagina en route zodat beide dezelfde vorm opleveren.
6. ~~**Detailpaneel**~~ — **klaar.** Scherm 2 rechts: volumekiezer plus de drie tabs. De coördinatentab draait `formatGeometryForLARA` — dezelfde functie als de export, dus wat er staat ís wat er geschreven wordt. Kaart is MapLibre met OSM-tiles; dat is het enige externe verzoek dat de applicatie doet.
7. ~~**LARA-selectie**~~ — **klaar.** Scherm 3 met statstrook, inline ID-invoer, duplicaatcontrole uit de database, volgend vrij nummer (dat gaten opvult), bulk plakken en overnemen van een vorige dataset. `PUT /api/lara-areas` en `POST /api/lara-areas/bulk`. De plaklijstparser staat in [`lib/bulkNummers.ts`](../lib/bulkNummers.ts).
8. ~~**Export**~~ — **klaar.** [`lib/laraWorkbook.ts`](../lib/laraWorkbook.ts) (spec-conform, alle negen werkbladen van de template), [`lib/laraTimesheets.ts`](../lib/laraTimesheets.ts), [`lib/kmlExport.ts`](../lib/kmlExport.ts), [`lib/exportBevindingen.ts`](../lib/exportBevindingen.ts), drie downloadroutes en scherm 4. Gedraaid op het echte AeroDB-bestand: 922 gebieden in 8,7 s geparsed, werkboek in 43 ms.
9. **Afronden** — deploy. README en `.env.example` staan er al.

Stap 3 en 4 waren het meeste werk en het meeste risico — beide leverden een fout op die het ontwerp niet had voorzien (de operatie-waarden in § 5.4, de rechte lijn in § 7). Stap 5 tot 7 zijn grotendeels bestaande code opnieuw arrangeren.

---

## 11. Open punten

De vier punten uit de eerste versie zijn beslist en verwerkt: AIRAC handmatig (§ 2), waarden uit AIXM (§ 5.1), meerdere volumes uit de AIXM-samenstelling (§ 5.4), bestandsnaam met AIRAC (§ 5.5).

Uit de officiële specificatie en de template komen nieuwe punten. Het eerste is het belangrijkste dat er ligt; alle testbare punten staan in [TESTPLAN.md](TESTPLAN.md).

### Straal of diameter — blokkerend voor de export

De spec schrijft **diameter** in NM voor de kolom `Coordinates` van een cirkel. AIXM levert een **straal**, en de brontool schrijft die straal ongewijzigd weg. Klopt de spec letterlijk, dan staat er in LARA nu een cirkel van de halve maat.

Het gaat om **848 cirkels** in het bestand van 3 september 2026 — geen randgeval. Een zone van 5 NM straal wordt 2,5 NM straal.

Dit is niet iets om zelf te beslissen: de spec is eenduidig, maar het is aannemelijk dat implementaties het als straal behandelen, en de brontool draait al een tijd mee. Vraag het na bij de LARA-beheerder of Graffica/Sopra Steria voordat stap 8 wordt afgerond. Tot dan: de export bouwt een cirkelwaarde via één functie, zodat het omzetten één regel is.

### Feestdagen

`WORK_DAY` is `MON`–`FRI`, dat is afgestemd. `HOL` (78×) heeft geen equivalent en het is niet bekend of LARA feestdagen kent. Die timesheets worden voorlopig niet uitgeschreven, maar wel als bevinding getoond zodat ze niet stil verdwijnen. Uit te zoeken — TESTPLAN § 4.2.

### Verschillen tussen specificatie en template

Dagnamen, gradenteken en leidende nullen. Alle drie staan met een testaanwijzing in [TESTPLAN.md](TESTPLAN.md) § 1; het document is leidend.

### Kleiner, maar al beslist in de code

- **Terugval bij ontbrekend tijdvak.** § 5.1 zegt: vaste waarde aanhouden en melden. Is dat genoeg, of moet een gebied zonder tijdvak de export blokkeren?
- **Selectie over datasets heen.** De selectie hangt aan één dataset en wordt bij een nieuwe import overgenomen. Blijkt de lijst in de praktijk nagenoeg altijd hetzelfde, dan is een vaste lijst op `ident` misschien beter — dat is een omkering, dus niet nu doen, wel in de gaten houden.
- **Types bij een schemawijziging.** `lib/database.types.ts` is handgeschreven en geverifieerd tegen het schema dat PostgREST publiceert. Bij elke volgende migratie moet dat handmatig mee.
