import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { haalSelectie } from "@/lib/selectie";
import SelectieLijst from "./SelectieLijst";

export const metadata = { title: "LARA-selectie — LARA Areas" };

export default async function SelectiePagina() {
  const supabase = await createClient();

  const { data: datasets } = await supabase
    .from("datasets")
    .select("id, filename, airac, is_active, status, uploaded_at")
    .order("uploaded_at", { ascending: false });

  const alle = datasets ?? [];
  const dataset = alle.find((d) => d.is_active) ?? alle.find((d) => d.status === "done") ?? null;
  if (!dataset) redirect("/importeren");

  const { rijen } = await haalSelectie(supabase, dataset.id);

  // Andere datasets waarvan overgenomen kan worden, met hoeveel er in hun lijst staat.
  const { data: selecties } = await supabase.from("lara_areas").select("dataset_id");
  const perDataset = new Map<string, number>();
  for (const rij of selecties ?? []) {
    perDataset.set(rij.dataset_id, (perDataset.get(rij.dataset_id) ?? 0) + 1);
  }

  const eerdereDatasets = alle
    .filter((d) => d.id !== dataset.id && (perDataset.get(d.id) ?? 0) > 0)
    .map((d) => ({
      id: d.id,
      filename: d.filename,
      airac: d.airac,
      aantal: perDataset.get(d.id) ?? 0,
    }));

  return (
    <SelectieLijst datasetId={dataset.id} rijen={rijen} eerdereDatasets={eerdereDatasets} />
  );
}
