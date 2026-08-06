/**
 * Is er een Supabase-project ingesteld?
 *
 * Zonder deze controle valt de hele applicatie om zodra .env.local ontbreekt:
 * createServerClient gooit dan in de proxy, en dat treft élk verzoek. Nu draait
 * `npm run dev` ook vóórdat het project bestaat, en zegt de startpagina wat er
 * mist in plaats van een stacktrace te tonen.
 *
 * Beide waarden zijn NEXT_PUBLIC_, dus deze module werkt aan beide kanten.
 */
export const supabaseIsIngesteld = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
