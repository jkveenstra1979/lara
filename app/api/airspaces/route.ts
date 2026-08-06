import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { haalGebieden } from "@/lib/gebieden";

export const runtime = "nodejs";

/**
 * Alle gebieden van een dataset, met hun plek in de LARA-lijst en het aantal
 * volumes. Bedoeld om de lijst te verversen na een actie; het eerste laden doet
 * de pagina zelf, server-side.
 */
export async function GET(req: NextRequest) {
  const datasetId = req.nextUrl.searchParams.get("datasetId");
  if (!datasetId) {
    return NextResponse.json({ error: "datasetId ontbreekt." }, { status: 400 });
  }

  const supabase = await createClient();
  const { gebieden, error } = await haalGebieden(supabase, datasetId);
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ gebieden });
}
