import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { huidigeGebruiker, uitnodigingsLink } from "@/lib/gebruikers";

export const runtime = "nodejs";

/** Een uitnodiging verlengen: nieuwe token, nieuwe vervaldatum, nieuwe link. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const ik = await huidigeGebruiker(supabase);
  if (ik?.rol !== "admin") {
    return NextResponse.json({ error: "Alleen een beheerder kan dit." }, { status: 403 });
  }

  const admin = createAdminClient();
  const nieuweToken =
    crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

  const { data, error } = await admin
    .from("uitnodigingen")
    .update({
      token: nieuweToken,
      expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    })
    .eq("id", id)
    .is("accepted_at", null)
    .select("id, token, expires_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ link: uitnodigingsLink(req.nextUrl.origin, data.token), expiresAt: data.expires_at });
}

/** Een uitnodiging intrekken. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const ik = await huidigeGebruiker(supabase);
  if (ik?.rol !== "admin") {
    return NextResponse.json({ error: "Alleen een beheerder kan dit." }, { status: 403 });
  }

  const { error } = await createAdminClient().from("uitnodigingen").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ingetrokken: true });
}
