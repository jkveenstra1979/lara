import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { haalGebruikers, haalUitnodigingen, huidigeGebruiker } from "@/lib/gebruikers";
import GebruikersBeheer from "./GebruikersBeheer";

export const metadata = { title: "Gebruikers — LARA Areas" };

export default async function GebruikersPagina() {
  const supabase = await createClient();
  const ik = await huidigeGebruiker(supabase);
  if (!ik) redirect("/inloggen");
  // Geen scherm voor wie er niets mag: dat is het enige verschil tussen de rollen.
  if (ik.rol !== "admin") redirect("/importeren");

  const { gebruikers } = await haalGebruikers(supabase);
  const { uitnodigingen } = await haalUitnodigingen(supabase);

  return <GebruikersBeheer ik={ik} gebruikers={gebruikers} uitnodigingen={uitnodigingen} />;
}
