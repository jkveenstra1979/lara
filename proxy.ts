import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseIsIngesteld } from "@/lib/supabase/config";

/**
 * Sessieverversing en toegangsbewaking.
 *
 * In Next.js 16 heet dit een proxy; het was middleware. De functie is dezelfde:
 * code die draait voordat een verzoek is afgehandeld.
 *
 * Dit is geen autorisatielaag — die zit in RLS. Hier gebeurt alleen de goedkope
 * controle "is er überhaupt iemand ingelogd", plus het verversen van de sessie.
 * Zonder dat laatste verloopt de sessie tijdens gebruik.
 */

/**
 * Paden die zonder sessie bereikbaar zijn.
 *
 * `/uitnodiging` en de bijbehorende route horen erbij: wie daar komt heeft per
 * definitie nog geen account. Het token in de link is het bewijs, en de route
 * controleert zelf of het nog geldig en ongebruikt is.
 *
 * Let op het verschil met `/api/uitnodigingen` (meervoud) — dat is de
 * beheerroute en die blijft afgeschermd. Zie `isPubliekPad`.
 */
const PUBLIEKE_PADEN = [
  "/inloggen",
  "/auth",
  "/uitnodiging",
  "/api/uitnodiging/accepteren",
];

/**
 * Een pad is publiek als het exact overeenkomt of eronder valt.
 *
 * Bewust niet met een kale `startsWith`: daarmee zou `/uitnodiging` ook
 * `/uitnodigingen` dekken, en dat is precies de beheerroute die juist
 * afgeschermd moet blijven. Het scheelt één letter.
 */
export function isPubliekPad(pad: string): boolean {
  return PUBLIEKE_PADEN.some((p) => pad === p || pad.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  // Nog geen Supabase-project: alles doorlaten, de startpagina legt uit wat mist.
  if (!supabaseIsIngesteld) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pad = request.nextUrl.pathname;
  const isPubliek = isPubliekPad(pad);

  if (!user && !isPubliek) {
    const url = request.nextUrl.clone();
    url.pathname = "/inloggen";
    // Waar de gebruiker heen wilde, zodat hij daar na het inloggen uitkomt.
    url.searchParams.set("verder", pad);
    return NextResponse.redirect(url);
  }

  if (user && pad === "/inloggen") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Alles behalve statische bestanden, fonts en afbeeldingen.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)",
  ],
};
