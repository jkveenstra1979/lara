import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { haalGebruikers, huidigeGebruiker, isLaatsteAdmin } from "@/lib/gebruikers";

export const runtime = "nodejs";

/** Rol wijzigen. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const ik = await huidigeGebruiker(supabase);
  if (ik?.rol !== "admin") {
    return NextResponse.json({ error: "Alleen een beheerder kan rollen wijzigen." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const rol = body?.rol === "admin" ? "admin" : "user";

  // De laatste beheerder mag zichzelf niet degraderen: dan kan niemand meer
  // gebruikers beheren, ook zichzelf niet terugzetten.
  const { gebruikers } = await haalGebruikers(supabase);
  if (rol !== "admin" && isLaatsteAdmin(gebruikers, id)) {
    return NextResponse.json(
      { error: "Dit is de enige beheerder. Maak eerst iemand anders beheerder." },
      { status: 409 }
    );
  }

  const { error } = await createAdminClient().from("gebruikers").update({ rol }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id, rol });
}

/** Een gebruiker verwijderen: profiel én account. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const ik = await huidigeGebruiker(supabase);
  if (ik?.rol !== "admin") {
    return NextResponse.json({ error: "Alleen een beheerder kan gebruikers verwijderen." }, { status: 403 });
  }
  if (id === ik.id) {
    return NextResponse.json({ error: "Je kunt jezelf niet verwijderen." }, { status: 409 });
  }

  const { gebruikers } = await haalGebruikers(supabase);
  if (isLaatsteAdmin(gebruikers, id)) {
    return NextResponse.json({ error: "Dit is de enige beheerder." }, { status: 409 });
  }

  // Het profiel verdwijnt mee via on delete cascade.
  const { error } = await createAdminClient().auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ verwijderd: id });
}
