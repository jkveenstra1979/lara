import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { haalExportSet, naarFeatureCollection } from "@/lib/exportData";
import { exportBestandsnaam } from "@/lib/laraWorkbook";
import { featureCollectionNaarKml } from "@/lib/kmlExport";

export const runtime = "nodejs";

/** De LARA-selectie als KML, om in Google Earth na te lopen. */
export async function GET(req: NextRequest) {
  const datasetId = req.nextUrl.searchParams.get("datasetId");
  if (!datasetId) return NextResponse.json({ error: "datasetId ontbreekt." }, { status: 400 });

  const supabase = await createClient();
  const { set, error } = await haalExportSet(supabase, datasetId);
  if (error || !set) return NextResponse.json({ error: error ?? "Niet gevonden." }, { status: 500 });

  try {
    const kml = featureCollectionNaarKml(naarFeatureCollection(set.gebieden), {
      documentNaam: `LARA-selectie ${set.dataset.airac}`,
    });
    const naam = exportBestandsnaam(set.dataset.airac, "kml");
    return new NextResponse(kml, {
      headers: {
        "Content-Type": "application/vnd.google-earth.kml+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${naam}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "KML maken mislukte." },
      { status: 400 }
    );
  }
}
