import { createClient } from "@/lib/supabase/server";
import ImportForm, { type DatasetRij } from "./ImportForm";

export const metadata = { title: "Importeren — LARA Areas" };

export default async function ImporterenPagina() {
  const supabase = await createClient();

  const { data: datasets } = await supabase
    .from("datasets")
    .select("id, filename, airac, status, error_message, airspace_count, is_active, uploaded_at")
    .order("uploaded_at", { ascending: false });

  const { data: selecties } = await supabase.from("lara_areas").select("dataset_id");
  const inLara = new Map<string, number>();
  for (const rij of selecties ?? []) {
    inLara.set(rij.dataset_id, (inLara.get(rij.dataset_id) ?? 0) + 1);
  }

  const rijen: DatasetRij[] = (datasets ?? []).map((d) => ({
    ...d,
    in_lara: inLara.get(d.id) ?? 0,
  }));

  return <ImportForm datasets={rijen} />;
}
