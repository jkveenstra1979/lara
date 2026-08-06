import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Een uitnodiging inwisselen voor een account.
 *
 * Deze route heeft geen sessie nodig — de ontvanger is per definitie nog niet
 * ingelogd. De uitnodiging bewijst zichzelf: het token is 64 hex-tekens en de
 * rij moet nog geldig en onaanvaard zijn.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token ?? "").trim();
  const wachtwoord = String(body?.wachtwoord ?? "");
  const naam = String(body?.naam ?? "").trim() || null;

  if (!token) return NextResponse.json({ error: "Deze link is niet compleet." }, { status: 400 });
  if (wachtwoord.length < 10) {
    return NextResponse.json(
      { error: "Kies een wachtwoord van minstens tien tekens." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: uitnodiging, error: zoekFout } = await admin
    .from("uitnodigingen")
    .select("id, email, naam, rol, expires_at, accepted_at")
    .eq("token", token)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (zoekFout) return NextResponse.json({ error: zoekFout.message }, { status: 500 });
  if (!uitnodiging) {
    return NextResponse.json(
      { error: "Deze uitnodiging is verlopen of al gebruikt. Vraag de beheerder om een nieuwe link." },
      { status: 400 }
    );
  }

  const { data: nieuw, error: maakFout } = await admin.auth.admin.createUser({
    email: uitnodiging.email,
    password: wachtwoord,
    // Zonder SMTP kan niemand een adres bevestigen; het adres is al bekend bij
    // de beheerder die de uitnodiging verstuurde.
    email_confirm: true,
    user_metadata: { naam: naam ?? uitnodiging.naam ?? undefined },
  });

  if (maakFout || !nieuw.user) {
    const bestaat = /already been registered|already exists/i.test(maakFout?.message ?? "");
    return NextResponse.json(
      { error: bestaat ? "Voor dit adres bestaat al een account. Log gewoon in." : (maakFout?.message ?? "Account aanmaken mislukte.") },
      { status: bestaat ? 409 : 500 }
    );
  }

  // De trigger op auth.users heeft het profiel al gemaakt; rol en naam komen
  // uit de uitnodiging.
  await admin
    .from("gebruikers")
    .update({ rol: uitnodiging.rol, naam: naam ?? uitnodiging.naam })
    .eq("id", nieuw.user.id);

  await admin
    .from("uitnodigingen")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", uitnodiging.id);

  return NextResponse.json({ email: uitnodiging.email });
}
