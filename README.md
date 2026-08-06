# LARA Areas

AIXM 5.1 inlezen, LARA Area IDs toekennen, en een LARA V4 importbestand exporteren.

Afgeleid van [Airspace_management](../Airspace_management), waar de LARA-export een bijproduct is. Hier is het het hele product.

**Status:** alle bouwstappen uit [het stappenplan](docs/HANDOVER.md#10-stappenplan) zijn klaar — importeren, gebieden, LARA-selectie en exporteren werken end-to-end, getest op een echt AeroDB-bestand van 96 MB. Wat resteert: de punten uit [het testplan](docs/TESTPLAN.md) nalopen in LARA, en deployen.

## Aan de slag

```
npm install
npm run dev
npm test          # parser- en exporttests
npm run controle  # lint, typecheck, tests en build — draai dit vóór een push
```

`npm run build` compileert éérst en typecheckt daarná. Wie alleen naar
"Compiled successfully" kijkt, mist een typefout die de deploy alsnog laat
vallen; `npm run controle` stopt bij de eerste die faalt.

De applicatie draait ook zonder Supabase; de startpagina zegt dan wat er ontbreekt.

- **Aanpak, datamodel, stappenplan:** [docs/HANDOVER.md](docs/HANDOVER.md)
- **Klikbare mockup:** `open docs/mockup/index.html` — vier schermen, licht en donker
- **Wat er getest moet worden in LARA:** [docs/TESTPLAN.md](docs/TESTPLAN.md)
- **Officiële LARA-specificatie:** de V4- en V5-uitgave zijn inhoudelijk identiek;
  de template spreekt ze op drie punten tegen (zie het testplan). De bronbestanden
  staan lokaal in `documents/` en zitten **niet** in git — leveranciersdocumentatie,
  operationele gebiedsgegevens en een AIXM-snapshot van 112 MB.

## Supabase

Draait op een **eigen, self-hosted omgeving** — niet op supabase.com, en niet het
project van `Airspace_management`. De drie migraties in `supabase/migrations/`
staan erop.

```
cp .env.example .env.local     # URL, anon key, service-role key invullen
npm run check:supabase         # controleert tabellen, kolommen, RLS, bucket, gebruikers
```

`check:supabase` doet geen enkele schrijfactie en is veilig tegen productie te
draaien. Hij controleert de dingen die je anders pas merkt als er data in zit:
bestaan de tabellen mét de kolommen uit de migratie, houdt RLS `anon` buiten de
deur, staat de bucket privé, en zijn er gebruikers.

### Gebruikers

Twee rollen, één verschil: een **beheerder** nodigt uit en wijzigt rollen, een
**gebruiker** niet. Aan de luchtruimgegevens mag iedereen die is ingelogd
evenveel doen.

Uitnodigen gaat via **Beheer → Gebruikers**. Er is geen e-mailserver gekoppeld:
de applicatie maakt een link die je zelf doorstuurt. Die is veertien dagen geldig
en werkt één keer; verlopen links vervang je met één knop.

De eerste beheerder is het oudste account — dat wordt bij de migratie gezet.
Zonder account kom je er met:

```
npm run gebruiker -- jan@example.nl
```

### Landsgrenzen

104 van de 922 gebieden in het AIXM van 3 september 2026 volgen een landsgrens
in plaats van hun eigen coördinaten op te schrijven. Ontbreekt zo'n grens, dan
sluit de parser het gebied met een rechte lijn — zonder iets te melden. De
applicatie vangt dat af (zie [HANDOVER § 7](docs/HANDOVER.md)), maar beter is
dat het niet gebeurt.

De grenzen zitten in het AIXM-bestand zelf en worden bij elke import bewaard.
Om de tabel alvast te vullen — of na te lopen:

```
npm run geoborders -- pad/naar/aixm.xml
```

Grenzen veranderen niet; zeven stuks dekken Nederland, België, Duitsland,
Frankrijk en Luxemburg.

### Openstaande migraties

Twee stuks:

- `20260806140000_nummers_omwisselen.sql` — maakt de unique constraint op
  `(dataset_id, lara_area_id)` uitstelbaar. Zonder deze migratie loopt het
  omwisselen van twee Area IDs stuk.
- `20260806160000_gebruikers.sql` — gebruikers, rollen en uitnodigingen. Zet het
  oudste account op `admin`.

### Bij een schemawijziging

Nieuwe migratie in `supabase/migrations/` zetten, uitvoeren op de omgeving, en
daarna `lib/database.types.ts` bijwerken. Dat bestand is handgeschreven en is
geverifieerd tegen het schema dat PostgREST publiceert; `supabase gen types` werkt
hier alleen met een directe `--db-url`, niet met `--project-id` (dat is voor de
cloud).

## Indeling

```
app/                App Router · (auth)/ inlogscherm · (app)/ schermen · fonts/
app/(app)/Shell     rail, sessiebalk, stappenbalk, voetbalk
app/api/            upload · datasets · airspaces · lara-areas · export
lib/                AIXM-parser en geometrie, overgenomen uit Airspace_management
lib/airspaceVolumes volumes per gebied — nieuw, niet uit de brontool
lib/supabase/       client (browser) · server (RSC en routes) · admin (service-role)
lib/database.types  het schema als TypeScript
proxy.ts            sessie verversen en toegang bewaken (heette middleware)
scripts/            check-supabase · gebruiker-toevoegen
styles/             tokens.css (kleuren, maten) · base.css (reset, primitieven)
supabase/           config.toml · migrations/
docs/               HANDOVER.md · mockup/
```

De AIXM-bestanden in `lib/` zijn ongewijzigd overgenomen zodat een diff met de
brontool leesbaar blijft; ESLint laat ze daarom met rust wat `any` betreft. Nieuwe
code valt daar niet onder.

Schermeigen opmaak hoort in een CSS Module naast de component; alleen wat op meer
dan één scherm terugkomt staat in `styles/base.css`. Radius is overal 0 en er zijn
geen schaduwen, behalve op een modaal paneel.

## Toegang

Elke ingelogde gebruiker mag alles — er is bewust geen rollenstelsel. RLS zorgt
er alleen voor dat er iemand ingelogd moet zijn: zonder policies leest de anon key
uit een publieke build de hele database uit. De service-role key gaat buiten RLS
om, staat uitsluitend in `lib/supabase/admin.ts` en krijgt straks één afnemer: de
import-route.

## Werkstroom

```
AIXM uploaden  →  gebieden bekijken  →  selecteren voor LARA  →  Area ID toekennen  →  exporteren
                                                                                       xlsx · KML · GeoJSON
```

Niet elk gebied uit het AIXM-bestand gaat naar LARA. De LARA-selectie is een eigen lijst met een eigen scherm; het Area ID hoort daarbij.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Supabase (Postgres, Auth, Storage) · MapLibre GL · ExcelJS · CSS Modules

De kaart haalt tiles bij OpenStreetMap. Dat is het enige externe verzoek dat de
applicatie doet — fonts en alle andere assets zitten lokaal.
