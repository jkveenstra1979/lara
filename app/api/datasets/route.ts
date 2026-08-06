import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Alle imports, nieuwste eerst, met hoeveel gebieden er in de LARA-lijst staan. */
export async function GET() {
  const supabase = await createClient();

  const { data: datasets, error } = await supabase
    .from("datasets")
    .select("id, filename, airac, status, error_message, airspace_count, is_active, uploaded_at")
    .order("uploaded_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aantal geselecteerde gebieden per dataset. Eén query voor alles: het gaat om
  // tientallen rijen per dataset, niet duizenden.
  const { data: selecties } = await supabase.from("lara_areas").select("dataset_id");
  const inLara = new Map<string, number>();
  for (const rij of selecties ?? []) {
    inLara.set(rij.dataset_id, (inLara.get(rij.dataset_id) ?? 0) + 1);
  }

  return NextResponse.json({
    datasets: (datasets ?? []).map((d) => ({ ...d, in_lara: inLara.get(d.id) ?? 0 })),
  });
}
