import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";

/**
 * Supabase-client voor server components en route handlers.
 *
 * Ook hier de anon key, met de sessie uit de cookies: elke query loopt onder de
 * identiteit van de ingelogde gebruiker en dus onder RLS. De service-role key
 * komt hier nooit — die staat in admin.ts en heeft precies één afnemer.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Aanroep vanuit een server component: het verversen van de sessie
            // gebeurt dan in de proxy. Veilig te negeren.
          }
        },
      },
    }
  );
}
