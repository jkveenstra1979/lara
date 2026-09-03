import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIEEN } from "@/lib/melding";

export const runtime = "nodejs";

/**
 * Een melding uit de applicatie als GitHub-issue.
 *
 * Zelfde opzet als in de andere tools: de token staat alleen op de server, de
 * client stuurt niet meer dan een categorie, een tekst en de pagina waar je
 * stond. Zonder `GITHUB_TOKEN` doet de route niets en verbergt het scherm de
 * knop — dan is dit niet ingericht.
 */

const EIGENAAR = "jkveenstra1979";
const REPO = "lara";

export async function POST(req: NextRequest) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Melden is niet ingericht." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const bericht = String(body?.bericht ?? "").trim();
  const categorie = String(body?.categorie ?? "");
  const pagina = typeof body?.pagina === "string" ? body.pagina : null;
  const dataset = typeof body?.dataset === "string" ? body.dataset : null;

  if (!bericht) {
    return NextResponse.json({ error: "Een omschrijving is verplicht." }, { status: 400 });
  }
  if (!(CATEGORIEEN as readonly string[]).includes(categorie)) {
    return NextResponse.json({ error: "Kies een type melding." }, { status: 400 });
  }

  // De eerste regel als titel; de rest staat toch in de body.
  const eersteRegel = bericht.split("\n")[0].slice(0, 80);

  const issueBody = [
    `**Categorie:** ${categorie}`,
    "",
    "**Omschrijving:**",
    bericht,
    "",
    "---",
    pagina ? `*Scherm: ${pagina}*` : null,
    dataset ? `*Dataset: ${dataset}*` : null,
    "*Ingediend via de meldknop in LARA Areas*",
  ]
    .filter((regel) => regel !== null)
    .join("\n");

  const res = await fetch(`https://api.github.com/repos/${EIGENAAR}/${REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: `[Melding] ${categorie}: ${eersteRegel}`,
      body: issueBody,
      labels: ["melding", "needs-triage"],
    }),
  });

  if (!res.ok) {
    console.error("[melding] GitHub antwoordde", res.status, await res.text());
    return NextResponse.json({ error: "De melding is niet verstuurd." }, { status: 502 });
  }

  const issue = (await res.json()) as { html_url: string; number: number };
  return NextResponse.json({ nummer: issue.number, url: issue.html_url });
}
