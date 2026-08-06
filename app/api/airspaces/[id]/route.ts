import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { haalGebiedDetail } from "@/lib/gebiedDetail";

export const runtime = "nodejs";

/** Eén gebied, met zijn volumes, coördinaten en het originele AIXM-fragment. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const { gebied, error } = await haalGebiedDetail(supabase, id);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!gebied) return NextResponse.json({ error: "Gebied niet gevonden." }, { status: 404 });

  return NextResponse.json({ gebied });
}
