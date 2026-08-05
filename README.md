# LARA Areas

AIXM 5.1 inlezen, LARA Area IDs toekennen, en een LARA V4 importbestand exporteren.

Afgeleid van [Airspace_management](../Airspace_management), waar de LARA-export een bijproduct is. Hier is het het hele product.

**Status:** ontwerp vastgesteld, mockup gemaakt, nog geen applicatiecode.

## Aan de slag

- **Aanpak, datamodel, stappenplan:** [docs/HANDOVER.md](docs/HANDOVER.md)
- **Klikbare mockup:** open `docs/mockup/index.html` in een browser

```
open docs/mockup/index.html
```

## Werkstroom

```
AIXM uploaden  →  gebieden bekijken  →  LARA ID toekennen  →  exporteren
                                                              xlsx · KML · GeoJSON
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Supabase (Postgres, Auth, Storage) · MapLibre GL · ExcelJS · CSS Modules
