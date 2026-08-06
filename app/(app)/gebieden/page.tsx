import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { haalGebieden } from "@/lib/gebieden";
import GebiedenLijst from "./GebiedenLijst";

export const metadata = { title: "Gebieden — LARA Areas" };

export default async function GebiedenPagina() {
  const supabase = await createClient();

  // Dezelfde keuze als de schil: expliciet actief, anders de nieuwste geslaagde.
  const { data: datasets } = await supabase
    .from("datasets")
    .select("id, is_active, status")
    .order("uploaded_at", { ascending: false });

  const alle = datasets ?? [];
  const dataset = alle.find((d) => d.is_active) ?? alle.find((d) => d.status === "done") ?? null;
  if (!dataset) redirect("/importeren");

  const { gebieden } = await haalGebieden(supabase, dataset.id);

  return <GebiedenLijst datasetId={dataset.id} gebieden={gebieden} />;
}
