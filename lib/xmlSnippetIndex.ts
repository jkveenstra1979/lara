const UUID_PATTERN =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

const normalizeUuid = (value: string) => value.replace(/^#/, "").replace(/^urn:uuid:/i, "").replace(/^uuid\./i, "");

const extractUuidValue = (value: string): string | null => {
  const normalized = normalizeUuid(value.trim());
  const match = normalized.match(UUID_PATTERN);
  return match ? match[0] : null;
};

const extractUuidFromSnippet = (snippet: string): string | null => {
  const identifierMatch = /<gml:identifier[^>]*>\s*([^<]+)\s*<\/gml:identifier>/i.exec(snippet);
  if (!identifierMatch) return null;
  return extractUuidValue(identifierMatch[1] ?? "");
};

const findTagEnd = (xml: string, start: number): number => {
  let inQuote: "'" | "\"" | null = null;
  for (let i = start + 1; i < xml.length; i += 1) {
    const ch = xml[i];
    if ((ch === "'" || ch === "\"") && xml[i - 1] !== "\\") {
      if (inQuote === ch) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = ch;
      }
    }
    if (ch === ">" && !inQuote) return i;
  }
  return -1;
};

export const buildXmlSnippetIndex = (xml: string): Record<string, string> => {
  const snippets: Record<string, string> = {};
  const stack: { name: string; start: number; uuidFromAttrs?: string | null }[] = [];
  let cursor = 0;

  while (cursor < xml.length) {
    const openIndex = xml.indexOf("<", cursor);
    if (openIndex === -1) break;

    if (xml.startsWith("<!--", openIndex)) {
      const end = xml.indexOf("-->", openIndex + 4);
      cursor = end === -1 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", openIndex)) {
      const end = xml.indexOf("]]>", openIndex + 9);
      cursor = end === -1 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<?", openIndex)) {
      const end = xml.indexOf("?>", openIndex + 2);
      cursor = end === -1 ? xml.length : end + 2;
      continue;
    }
    if (xml.startsWith("<!", openIndex)) {
      const end = xml.indexOf(">", openIndex + 2);
      cursor = end === -1 ? xml.length : end + 1;
      continue;
    }

    const closeIndex = findTagEnd(xml, openIndex);
    if (closeIndex === -1) break;

    const tagText = xml.slice(openIndex + 1, closeIndex);
    const trimmed = tagText.trim();
    const isClosing = trimmed.startsWith("/");
    const isSelfClosing = !isClosing && trimmed.endsWith("/");

    if (isClosing) {
      const name = trimmed.slice(1).split(/\s+/)[0] ?? "";
      const matchIndex = stack.map((item) => item.name).lastIndexOf(name);
      if (matchIndex !== -1) {
        const open = stack.splice(matchIndex, 1)[0];
        const snippet = xml.slice(open.start, closeIndex + 1);
        const uuid = open.uuidFromAttrs || extractUuidFromSnippet(snippet);
        const lowerName = open.name.toLowerCase();
        const isIdentifierElement = lowerName === "gml:identifier" || lowerName === "identifier";
        const isAirspaceElement = /(^|:)airspace$/i.test(open.name);
        if (isAirspaceElement) {
          const identifierUuid = extractUuidFromSnippet(snippet);
          if (open.uuidFromAttrs) {
            // Prefer the full Airspace fragment when available.
            snippets[open.uuidFromAttrs] = snippet;
          }
          if (identifierUuid) {
            // Map the AirspaceTimeSlice identifier to the Airspace snippet for row-level viewing.
            snippets[identifierUuid] = snippet;
          }
        } else if (uuid && !isIdentifierElement && !snippets[uuid]) {
          // Index the original XML fragment by UUID for fast modal lookup.
          snippets[uuid] = snippet;
        }
      }
      cursor = closeIndex + 1;
      continue;
    }

    const name = trimmed.split(/\s+/)[0]?.replace(/\/$/, "") ?? "";
    const attrMatch = /(?:^|\s)gml:id\s*=\s*(["'])(.*?)\1/i.exec(tagText);
    const uuidFromAttrs = attrMatch ? extractUuidValue(attrMatch[2]) : null;

    if (isSelfClosing) {
      const snippet = xml.slice(openIndex, closeIndex + 1);
      const uuid = uuidFromAttrs || extractUuidFromSnippet(snippet);
      if (uuid && !snippets[uuid]) {
        snippets[uuid] = snippet;
      }
      cursor = closeIndex + 1;
      continue;
    }

    stack.push({ name, start: openIndex, uuidFromAttrs });
    cursor = closeIndex + 1;
  }

  return snippets;
};
