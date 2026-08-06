import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { haalGebruikers, haalUitnodigingen, huidigeGebruiker } from "@/lib/gebruikers";

export const runtime = "nodejs";

/** Gebruikers, en voor een beheerder ook de openstaande uitnodigingen. */
export async function GET() {
  const supabase = await createClient();
  const ik = await huidigeGebruiker(supabase);
  if (!ik) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const { gebruikers, error } = await haalGebruikers(supabase);
  if (error) return NextResponse.json({ error }, { status: 500 });

  if (ik.rol !== "admin") return NextResponse.json({ gebruikers, uitnodigingen: [] });

  const { uitnodigingen } = await haalUitnodigingen(supabase);
  return NextResponse.json({ gebruikers, uitnodigingen });
}
