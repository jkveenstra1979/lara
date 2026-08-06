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

const PUBLIEKE_PADEN = ["/inloggen", "/auth", "/uitnodiging"];

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
  const isPubliek = PUBLIEKE_PADEN.some((p) => pad.startsWith(p));

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
