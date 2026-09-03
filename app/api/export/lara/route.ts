import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { haalExportSet } from "@/lib/exportData";
import { bouwLaraWorkbook, exportBestandsnaam, type LaraVersie } from "@/lib/laraWorkbook";

export const runtime = "nodejs";

/**
 * Het LARA-importwerkboek.
 *
 * `versie` kiest tussen de V4- en de V5-uitgave van de specificatie. Dat scheelt
 * alleen in de bestandsnaam: de twee uitgaven schrijven hetzelfde formaat voor
 * — zie `LaraVersie` in lib/laraWorkbook.ts.
 */
export async function GET(req: NextRequest) {
  const datasetId = req.nextUrl.searchParams.get("datasetId");
  if (!datasetId) return NextResponse.json({ error: "datasetId ontbreekt." }, { status: 400 });

  const supabase = await createClient();
  const { set, error } = await haalExportSet(supabase, datasetId);
  if (error || !set) return NextResponse.json({ error: error ?? "Niet gevonden." }, { status: 500 });
  if (!set.gebieden.length) {
    return NextResponse.json({ error: "De LARA-lijst is leeg." }, { status: 400 });
  }

  const versie: LaraVersie = req.nextUrl.searchParams.get("versie") === "5" ? 5 : 4;
  const { buffer } = await bouwLaraWorkbook(set.gebieden);
  const naam = exportBestandsnaam(set.dataset.airac, "xlsx", new Date(), versie);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${naam}"`,
    },
  });
}
