import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { neemSelectieOver } from "@/lib/overnemen";

export const runtime = "nodejs";

/**
 * Selectie en nummering overnemen van een eerdere dataset, gematcht op designator.
 *
 * Dit gebeurt al automatisch bij de import; deze route is er voor als je het
 * daarna nog eens wilt doen, of vanaf een andere cyclus dan de laatste.
 *
 * Zie lib/overnemen.ts voor wat er precies gebeurt en waarom de uitkomst drie
 * getallen noemt.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: doelDataset } = await ctx.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const bronDataset = String(body?.bronDatasetId ?? "");
  if (!bronDataset) {
    return NextResponse.json({ error: "Geef aan van welke dataset overgenomen moet worden." }, { status: 400 });
  }
  if (bronDataset === doelDataset) {
    return NextResponse.json({ error: "Bron en doel zijn dezelfde dataset." }, { status: 400 });
  }

  const { resultaat, error } = await neemSelectieOver(supabase, doelDataset, bronDataset, user.id);
  if (error || !resultaat) {
    return NextResponse.json({ error: error ?? "Overnemen mislukte." }, { status: 500 });
  }

  return NextResponse.json({
    overgenomen: resultaat.overgenomen,
    vervallen: resultaat.vervallen,
    nieuw: resultaat.nieuw.length,
    nieuweIdents: resultaat.nieuw.slice(0, 50),
  });
}
