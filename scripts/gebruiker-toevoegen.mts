/**
 * Maakt een gebruiker aan. Er is geen registratieformulier — dit is de manier.
 *
 *   npm run gebruiker -- jan@example.nl
 *   npm run gebruiker -- jan@example.nl eigenWachtwoord123
 *
 * Zonder wachtwoord wordt er één gegenereerd en getoond; noteer hem, hij is
 * daarna niet meer op te vragen. Het adres wordt meteen als bevestigd gemarkeerd,
 * anders wacht de gebruiker op een e-mail die een self-hosted installatie zonder
 * SMTP nooit verstuurt.
 *
 * Gebruikt de service-role-sleutel en gaat dus buiten RLS om.
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const [email, wachtwoordArg] = process.argv.slice(2);

if (!url || !serviceKey) {
  console.error("\n.env.local is niet compleet — NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn nodig.\n");
  process.exit(1);
}

if (!email || !email.includes("@")) {
  console.error("\nGebruik: npm run gebruiker -- <e-mailadres> [wachtwoord]\n");
  process.exit(1);
}

// 18 bytes base64url ≈ 24 tekens; ruim boven de minimum_password_length van 10.
const wachtwoord = wachtwoordArg ?? randomBytes(18).toString("base64url");

if (wachtwoord.length < 10) {
  console.error("\nWachtwoord moet minstens 10 tekens zijn (minimum_password_length in config.toml).\n");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await admin.auth.admin.createUser({
  email,
  password: wachtwoord,
  email_confirm: true,
});

if (error) {
  console.error(`\n\x1b[31mAanmaken mislukt:\x1b[0m ${error.message}\n`);
  process.exit(1);
}

console.log(`\n\x1b[32mGebruiker aangemaakt.\x1b[0m`);
console.log(`  e-mail      ${data.user?.email}`);
if (!wachtwoordArg) {
  console.log(`  wachtwoord  ${wachtwoord}`);
  console.log(`\n  \x1b[90mNoteer dit wachtwoord — het is hierna niet meer op te vragen.\x1b[0m`);
}
console.log("");
