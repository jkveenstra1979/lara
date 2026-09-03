"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Inloggen met e-mail en wachtwoord.
 *
 * Er is geen registratieformulier: accounts maakt de beheerder aan in het
 * Supabase-dashboard. Dat is geen ontbrekende functie maar een keuze — de tool
 * heeft een handvol gebruikers en open registratie op luchtvaartdata is
 * onwenselijk.
 *
 * De foutmelding is bewust onspecifiek: "combinatie klopt niet" verraadt niet of
 * het adres bestaat.
 */

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const verder = String(formData.get("verder") ?? "/");

  if (!email || !password) {
    return { error: "Vul een e-mailadres en wachtwoord in." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Deze combinatie klopt niet." };
  }

  // Alleen paden binnen de applicatie; een volledige URL zou een open redirect zijn.
  redirect(verder.startsWith("/") && !verder.startsWith("//") ? verder : "/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Terug naar de voorpagina: daar staat de uitleg én het inlogveld.
  redirect("/");
}
