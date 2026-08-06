import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Supabase-client met de service-role-sleutel: gaat buiten RLS om.
 *
 * Precies één afnemer: de import-route. Die schrijft in één keer een dataset met
 * honderden airspaces, geometrieën en XML-fragmenten weg, en moet dat kunnen
 * afmaken los van de sessie van wie de upload startte.
 *
 * `server-only` bovenaan is geen sier: als dit bestand ooit per ongeluk in een
 * client component belandt, faalt de build in plaats van de sleutel mee te
 * bundelen.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY of NEXT_PUBLIC_SUPABASE_URL ontbreekt — zie .env.example"
    );
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
