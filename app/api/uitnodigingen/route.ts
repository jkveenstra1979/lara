import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { huidigeGebruiker, uitnodigingsLink } from "@/lib/gebruikers";

export const runtime = "nodejs";

/**
 * Iemand uitnodigen.
 *
 * Er is geen SMTP gekoppeld, dus versturen we niets: de route maakt een
 * uitnodiging aan en geeft de link terug, die de beheerder zelf doorstuurt.
 *
 * Het account ontstaat pas bij het accepteren. Een uitnodiging die blijft
 * liggen levert dus geen half account op, en je ziet in de lijst wie er nog
 * moet reageren.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const ik = await huidigeGebruiker(supabase);
  if (!ik) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  if (ik.rol !== "admin") {
    return NextResponse.json({ error: "Alleen een beheerder kan uitnodigen." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const naam = String(body?.naam ?? "").trim() || null;
  const rol = body?.rol === "admin" ? "admin" : "user";

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Vul een geldig e-mailadres in." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: bestaat } = await admin
    .from("gebruikers")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (bestaat) {
    return NextResponse.json({ error: `${email} heeft al een account.` }, { status: 409 });
  }

  // Een openstaande uitnodiging vervangen in plaats van er een tweede naast
  // zetten: anders werken er twee links tegelijk en weet niemand welke.
  await admin.from("uitnodigingen").delete().eq("email", email).is("accepted_at", null);

  const { data, error } = await admin
    .from("uitnodigingen")
    .insert({ email, naam, rol, invited_by: ik.id })
    .select("id, email, naam, rol, token, expires_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    uitnodiging: data,
    link: uitnodigingsLink(req.nextUrl.origin, data.token),
  });
}
