/**
 * Een `.in()`-filter opknippen in brokken.
 *
 * PostgREST zet het filter in de query-string, en die gaat over de URL. Een
 * lijst van 319 UUID's is ruim 11 KB — de server antwoordt dan **414 URI Too
 * Long** en er komt geen rij terug. De grens ligt in deze omgeving tussen 200 en
 * 250 UUID's; met 100 per brok zit er ruim marge in.
 *
 * Waarom dit een eigen bestand is: het ging fout op drie plekken tegelijk — de
 * export, de knop "uit LARA halen" en het plakken van een lijst — en steeds pas
 * zodra de LARA-lijst echt gevuld was. Bij zes gebieden merk je er niets van.
 *
 * De rijen komen terug in de volgorde van de brokken. Sorteer je op iets dat
 * binnen één sleutel geldt — zoals `operation_sequence` per gebied — dan blijft
 * dat kloppen, want alle rijen van één sleutel zitten in dezelfde brok. Een
 * sortering over de hele uitkomst overleeft het opknippen niet.
 */

const PER_BROK = 100;

type Antwoord<T> = { data: T[] | null; error: { message: string } | null };

export async function inBrokken<T, S extends string | number>(
  sleutels: readonly S[],
  ophalen: (brok: S[]) => PromiseLike<Antwoord<T>>
): Promise<{ data: T[]; error: string | null }> {
  const rijen: T[] = [];

  for (let i = 0; i < sleutels.length; i += PER_BROK) {
    const { data, error } = await ophalen(sleutels.slice(i, i + PER_BROK));
    if (error) return { data: [], error: error.message };
    if (data) rijen.push(...data);
  }

  return { data: rijen, error: null };
}

/**
 * Hetzelfde, voor een schrijfactie die niets teruggeeft.
 *
 * Let op: elke brok is een eigen verzoek. Loopt er één stuk, dan zijn de brokken
 * ervóór al doorgevoerd. Dat is hier acceptabel — het gaat om het wissen of
 * vrijmaken van rijen, en dat is te herhalen.
 */
export async function schrijfInBrokken<S extends string | number>(
  sleutels: readonly S[],
  uitvoeren: (brok: S[]) => PromiseLike<{ error: { message: string } | null }>
): Promise<{ error: string | null }> {
  for (let i = 0; i < sleutels.length; i += PER_BROK) {
    const { error } = await uitvoeren(sleutels.slice(i, i + PER_BROK));
    if (error) return { error: error.message };
  }
  return { error: null };
}
