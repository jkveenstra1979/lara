import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { haalExportSet, naarFeatureCollection } from "@/lib/exportData";
import { exportBestandsnaam } from "@/lib/laraWorkbook";

export const runtime = "nodejs";

/** De LARA-selectie als FeatureCollection. */
export async function GET(req: NextRequest) {
  const datasetId = req.nextUrl.searchParams.get("datasetId");
  if (!datasetId) return NextResponse.json({ error: "datasetId ontbreekt." }, { status: 400 });

  const supabase = await createClient();
  const { set, error } = await haalExportSet(supabase, datasetId);
  if (error || !set) return NextResponse.json({ error: error ?? "Niet gevonden." }, { status: 500 });

  const naam = exportBestandsnaam(set.dataset.airac, "geojson");
  return new NextResponse(JSON.stringify(naarFeatureCollection(set.gebieden), null, 2), {
    headers: {
      "Content-Type": "application/geo+json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${naam}"`,
    },
  });
}
