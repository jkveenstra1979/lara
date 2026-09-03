import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { huidigeGebruiker } from "@/lib/gebruikers";
import Shell, { type ShellDataset } from "./Shell";

/**
 * De applicatieschil. Haalt op wat in de rail en de balken staat: wie er is
 * ingelogd, welke dataset actief is, en hoeveel gebieden er in de LARA-lijst
 * staan.
 *
 * Actief is de dataset met `is_active`; is er geen, dan de nieuwste geslaagde
 * import. Zo werkt de applicatie ook voordat er ooit iets is geactiveerd.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const ik = await huidigeGebruiker(supabase);
  if (!ik) redirect("/inloggen");

  const { data: datasets } = await supabase
    .from("datasets")
    .select("id, filename, airac, uploaded_at, airspace_count, is_active, status")
    .order("uploaded_at", { ascending: false });

  const alle = datasets ?? [];
  const gekozen =
    alle.find((d) => d.is_active) ?? alle.find((d) => d.status === "done") ?? null;

  let inLara = 0;
  if (gekozen) {
    const { count } = await supabase
      .from("lara_areas")
      .select("id", { count: "exact", head: true })
      .eq("dataset_id", gekozen.id);
    inLara = count ?? 0;
  }

  const actief: ShellDataset | null = gekozen
    ? {
        id: gekozen.id,
        filename: gekozen.filename,
        airac: gekozen.airac,
        uploaded_at: gekozen.uploaded_at,
        airspace_count: gekozen.airspace_count,
      }
    : null;

  return (
    <Shell
      email={ik.email}
      rol={ik.rol}
      actief={actief}
      aantalDatasets={alle.length}
      inLara={inLara}
      // Zonder token doet /api/melding niets; dan hoort de knop er ook niet te staan.
      kanMelden={Boolean(process.env.GITHUB_TOKEN)}
    >
      {children}
    </Shell>
  );
}
