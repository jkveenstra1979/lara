import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

/**
 * Supabase-client voor de browser.
 *
 * Gebruikt de anon key: alles wat deze client kan, kan een ingelogde gebruiker
 * ook. Dat is hier geen probleem — er is bewust geen rollenstelsel, elke
 * ingelogde gebruiker mag alles. RLS zorgt er alleen voor dat er iemand ingelogd
 * moet zijn.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
