# Testplan LARA-export

**Doel:** vastleggen wat er nagelopen moet worden bij de eerste echte import in LARA, en welke punten uit de documentatie elkaar tegenspreken.

**Bronnen** — deze bestanden staan in `documents/` en blijven bewust lokaal: de
specificaties zijn auteursrechtelijk van de leverancier, de export bevat
operationele gebiedsgegevens en de e-mail persoonsgegevens.

| | |
|---|---|
| Specificatie V4 | `documents/LARA V4.0 Excel Airspace Import Format.pdf` — Graffica, GL/LARA/C0145/SPEC/4, 31 maart 2022 |
| Specificatie V5 | `documents/LARA V5.0 Excel Airspace Import Format.pdf` — Sopra Steria, 31 maart 2025. **Inhoudelijk identiek aan V4**; alleen de kaft verschilt |
| Template | `documents/LARA V5 Excel Airspace Housekeeper Import Template (1).xlsx` |
| AIXM-bron | `documents/snapshot_AeroDB_2026-09-03_LIVE.xml` — 96 MB, AIRAC 3-9-2026, 922 airspaces |
| Timesheets | `documents/Nadere details over Timesheet in AIXM51 (aeroDB export).eml` — LVNL, 5 augustus 2026 |

---

## 1 · Discrepanties tussen specificatie en template

Op drie punten zeggen het document en de meegeleverde template iets anders. **Afspraak: het document is leidend.** Blijkt bij de eerste import dat LARA de template volgt, dan is elk van deze drie één regel om te wijzigen.

### 1.1 Dagnamen — TUES/THUR of TUE/THU

| Bron | Waarden |
|---|---|
| Specificatie § 2.4.2.4 | `MON / TUES / WED / THUR / FRI / SAT / SUN` |
| Template, kolomkop | `Day From (MON/TUE/..etc)` |
| Template, sheet `Options`, kolom *CDR timesheet day* | `MON, TUE, WED, THU, FRI, SAT, SUN, ANY` |
| Template, voorbeeldrij | `MON` … `FRI` |

De template zegt op drie plekken **TUE/THU** (drie letters), het document zegt **TUES/THUR** (vier). AIXM levert `TUE` en `THU`.

**Wij schrijven:** `TUES` en `THUR`, conform het document.

**Testen:** importeer één gebied met een timesheet die op dinsdag of donderdag begint of eindigt. Wordt de rij geweigerd of komt de dag verkeerd binnen, dan de driecijferige vorm gebruiken.

> De `Options`-lijst noemt ook **`ANY`** als geldige dagwaarde. Die staat niet in het document. Als LARA `ANY` accepteert voor Area Timesheets, hoeft `<aixm:day>ANY</aixm:day>` niet naar MON–SUN vertaald te worden. De kolom heet in de template wel *CDR timesheet day*, dus mogelijk geldt dat alleen voor CDR-segmenten. **Na te vragen.**

### 1.2 Gradenteken — ° of º

| Bron | Teken |
|---|---|
| Specificatie § 2.3.2.7 | `°` U+00B0 DEGREE SIGN — `xx°xx'xx"N,xxx°xx'xx"E` |
| Template, voorbeeldrijen | `º` U+00BA MASCULINE ORDINAL INDICATOR — `40º00'05"N,1º13'08"E` |

Vrijwel zeker een typfout in de template (dat teken komt van een Spaans of Portugees toetsenbord), maar het is precies het soort verschil waar een strikte parser op afknapt.

**Wij schrijven:** `°` U+00B0, conform het document.

**Testen:** één gebied met `Straight Lines` importeren en de coördinaten in LARA terugzien. Komen ze niet of verminkt binnen, dan U+00BA proberen.

### 1.3 Leidende nullen in de lengtegraad

De template is intern inconsistent binnen één cel:

```
40º00'05"N,1º13'08"E;40º02'05"N,01º13'15"E;40º15'05"N,001º12'30"E
             ↑ 1 cijfer      ↑ 2 cijfers        ↑ 3 cijfers
```

Het document schrijft `xxx°xx'xx"E` — drie cijfers.

**Wij schrijven:** drie cijfers voor de lengtegraad, twee voor de breedtegraad, conform het document. Dat de template alle drie de vormen naast elkaar toont, suggereert dat LARA soepel is.

---

## 2 · Straal of diameter — het belangrijkste punt

Beide bronnen zeggen **diameter**:

| Bron | Tekst |
|---|---|
| Specificatie § 2.3.2.7 | *"the coordinates of the centre-point of the circle in DMS or decimal degrees, and then the **diameter** in Nautical Miles"* |
| Template, kolomkop `Coordinates` | *"…centre-point … followed by **diameter** in nautical miles (circle)"* |

AIXM levert een **straal**: `<gml:radius uom="[nmi_i]">5.0</gml:radius>`. De brontool (`Airspace_management`) schrijft die straal ongewijzigd weg.

**Om hoeveel het gaat:** 848 `CircleByCenterPoint` in het AIXM-bestand van 3 september 2026. Klopt de spec letterlijk en zetten wij niet om, dan staat elke cirkelvormige zone in LARA op de halve maat — een zone van 5 NM straal wordt 2,5 NM.

**Wij schrijven voorlopig:** de straal, zoals de brontool. Dat blijft de bestaande praktijk tot er uitsluitsel is. De omzetting zit achter één functie, dus wijzigen is één regel.

**Testen — met voorrang:** importeer één cirkelvormig gebied waarvan de maat bekend is (bijvoorbeeld `EHER`, straal 5 NM uit de e-mail van LVNL) en meet in LARA de werkelijke omvang. Is die 5 NM straal, dan klopt de huidige praktijk. Is die 2,5 NM, dan moet de waarde verdubbeld worden.

**Na te vragen bij de LARA-beheerder of Sopra Steria** — dit is niet iets om uit de documentatie op te lossen.

---

## 3 · Area Type

De sheet `Options` in de template geeft de lijst die het document niet noemt — 21 waarden:

```
TSA, TRA, D, RCA, P, RVA, MTA, R, MRA, FIR, PIR, UIR,
ES, CS, CTA, TMA, UTA, CTR, OCA, CBA, UNKNOWN
```

Onbekende waarden worden stilzwijgend `UNKNOWN` (§ 2.2.2.17).

Afgezet tegen de 922 airspaces in het AIXM-bestand:

| | Aantal | Types |
|---|---:|---|
| **Herkend** | 156 (16%) | TMA 31 · TSA 27 · R 26 · TRA 22 · D 19 · CTR 16 · CTA 7 · P 4 · CBA 2 · UTA 1 · FIR 1 |
| **Wordt UNKNOWN** | 766 (83%) | A 268 · RAS 198 · HTZ 91 · D_OTHER 52 · PART 45 · SECTOR 41 · OTHER 27 · TMA_P 22 · CTR_P 7 · ATZ 5 · ASR 4 · CTA_P 4 · ATZ_P 2 |

Dat percentage ziet er alarmerender uit dan het is: de herkende types zijn precies de reserveerbare gebieden (TSA, TRA, R, D, P, CBA) — de gebieden die je voor LARA selecteert. De rest (approach-sectoren, helikopterzones, radar-gebieden) hoort daar waarschijnlijk niet in.

**Wij doen:** het type ongewijzigd uit AIXM overnemen, en op het exportscherm melden welke geselecteerde gebieden een type hebben dat niet in de lijst staat. Geen automatische omzetting — `TMA_P` naar `TMA` mappen lijkt logisch maar is een aanname over wat `_P` betekent.

**Testen:** selecteer bewust één gebied met een niet-herkend type (bijvoorbeeld een `HTZ`) en controleer of de bevinding verschijnt én of LARA het inderdaad als `UNKNOWN` opneemt.

---

## 4 · Timesheets

### 4.1 Vertaalregels

| AIXM | LARA | Bron |
|---|---|---|
| `<aixm:day>ANY</aixm:day>` | `Day From: MON`, `Day Til: SUN` | e-mail LVNL, 5 augustus 2026 |
| `<aixm:day>WORK_DAY</aixm:day>` | `Day From: MON`, `Day Til: FRI` | afgestemd |
| `<aixm:day>MON</aixm:day>` … `SUN` | idem, met `TUES`/`THUR` per § 1.1 | specificatie |
| `<aixm:day>HOL</aixm:day>` | **onbekend — zie 4.2** | |

Voorkomen in het AIXM-bestand: `ANY` 1160×, `MON` 137×, `FRI` 132×, `WED` 128×, `TUE` 124×, `THU` 122×, `HOL` 78×, `SAT` 69×, `SUN` 65×, `WORK_DAY` 2×.

### 4.2 HOL — feestdagen, open punt

`HOL` komt 78 keer voor en heeft geen equivalent in `Day From` / `Day Til`. Het is niet duidelijk of LARA feestdagen überhaupt kent; de specificatie zwijgt erover.

**Voorlopig buiten beschouwing gelaten.** Een timesheet met `day = HOL` wordt niet uitgeschreven en verschijnt als bevinding op het exportscherm, zodat het zichtbaar is in plaats van stil te verdwijnen.

**Uit te zoeken:** houdt LARA rekening met feestdagen, en zo ja, via welk veld? Zolang dat onbekend is, kan een gebied dat *alleen* op feestdagen actief is niet volledig worden overgedragen.

### 4.3 Eindtijd 00:00

De specificatie eist dat de starttijd vóór de eindtijd ligt (§ 2.4.2.3). In het AIXM-bestand staat 295× `<aixm:endTime>00:00</aixm:endTime>`, terwijl 558× `24:00` wordt gebruikt — beide notaties komen door elkaar voor voor hetzelfde: middernacht aan het eind van de dag.

**Wij schrijven:** `24:00` wanneer de eindtijd `00:00` is én de starttijd niet `00:00` is, of wanneer start en eind allebei `00:00` zijn (een etmaal).

**Testen:** één gebied met `00:00`–`00:00` en één met `07:00`–`00:00` importeren en het resultaat in LARA nalopen.

---

## 5 · Wat we bewust weglaten

De specificatie merkt van de 34 kolommen in `Areas` er zes aan als verplicht: `Area ID`, `Area Name`, `Type`, `AMC`, `Start Date`, `End Date`. De rest is optioneel en krijgt bij leeglaten een standaardwaarde uit LARA's eigen `housekeeperSettings.gsdk` (§ 2.1.3). Optionele kolommen mogen zelfs helemaal ontbreken (§ 2.1.4), en niet alle werkbladen hoeven aanwezig te zijn (§ 2.1.1).

De brontool vult alle 34 kolommen met vaste waarden. Dat is geen eis maar een gok, en een gok overschrijft wat de beheerder in LARA zelf heeft ingesteld.

**Wij schrijven:** de zes verplichte kolommen plus wat we uit AIXM kunnen afleiden. De rest laten we leeg, zodat LARA zijn eigen defaults gebruikt.

**Testen:** controleer na de eerste import of de weggelaten velden in LARA op de verwachte standaardwaarden staan. Zo niet, dan alsnog expliciet meegeven.

---

## 6 · Checklist voor de eerste echte import

| # | Wat | Verwacht |
|---|---|---|
| 1 | Cirkelvormig gebied met bekende maat | omvang klopt — zie § 2, dit eerst |
| 2 | Gebied met `Straight Lines` | coördinaten komen volledig en juist binnen |
| 3 | Gebied met een dinsdag/donderdag-timesheet | dag komt goed binnen — § 1.1 |
| 4 | Gebied met `00:00`–`00:00` | wordt een etmaal, niet geweigerd |
| 5 | Gebied met meerdere volumes | alle rijen uit sheet 2 komen als aparte volumes binnen |
| 6 | Gebied met een niet-herkend type | komt als `UNKNOWN`, bevinding was zichtbaar |
| 7 | Weggelaten optionele kolommen | LARA's eigen standaardwaarden gelden |
| 8 | Gebied langs een landsgrens | vorm volgt de grens, geen rechte lijn — zie HANDOVER § 7 |

---

## 7 · Openstaand — na te vragen

1. **Straal of diameter** voor cirkels. Blokkerend voor de juistheid van 848 gebieden. (§ 2)
2. **HOL** — kent LARA feestdagen? (§ 4.2)
3. **`ANY`** als dagwaarde — geldt dat ook voor Area Timesheets, of alleen voor CDR? (§ 1.1)
4. **Dagnamen** — `TUES`/`THUR` of `TUE`/`THU`? (§ 1.1)
5. **`_P`-types** — betekent `TMA_P` een deel van een TMA, en zo ja, mag dat als `TMA` worden geëxporteerd? (§ 3)
