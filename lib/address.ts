import { AddressStop, EditableAddress } from "@/types/route";

const POSTAL_REGEX = /\b(\d{4}\s?[A-Za-z]{2})\b/;
const HOUSE_NUMBER_REGEX = /\b(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)\b/;
const STREET_CITY_CHARS = "A-Za-zÀ-ÖØ-öø-ÿ'’.\\- ";

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeOcrArtifacts(value: string) {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\b([0-9OIlS]{4})\s?([A-Za-z0-9]{2})\b/g, (_, digits: string, letters: string) => {
      const normalizedDigits = digits
        .replace(/[Oo]/g, "0")
        .replace(/[Il]/g, "1")
        .replace(/S/g, "5");
      const normalizedLetters = letters
        .replace(/0/g, "O")
        .replace(/1/g, "I")
        .replace(/5/g, "S")
        .replace(/8/g, "B")
        .toUpperCase();

      return `${normalizedDigits} ${normalizedLetters}`;
    })
    .replace(/(?<=\d)[Oo](?=\d|\b)/g, "0")
    .replace(/(?<=\d)[Il](?=\d|\b)/g, "1");
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatAddress(stop: EditableAddress | AddressStop) {
  return normalizeWhitespace(
    `${stop.street} ${stop.houseNumber} ${stop.postalCode} ${stop.city}`,
  );
}

function cleanLine(rawInput: string) {
  return normalizeWhitespace(
    normalizeOcrArtifacts(rawInput)
      .replace(/[•·|]/g, " ")
      .replace(/[–—]/g, "-")
      .replace(/\s*,\s*/g, ", "),
  );
}

function extractRegexAddresses(input: string): EditableAddress[] {
  const source = cleanLine(input);
  if (!source) return [];

  const pattern = new RegExp(
    `([${STREET_CITY_CHARS}]+?)\\s+(\\d+[A-Za-z]?(?:[-/]\\d+[A-Za-z]?)?)\\s*,?\\s*(\\d{4}\\s?[A-Za-z]{2})\\s+([${STREET_CITY_CHARS}]+?)(?=(?:\\s+[${STREET_CITY_CHARS}]+\\s+\\d+[A-Za-z]?(?:[-/]\\d+[A-Za-z]?)?\\s*,?\\s*\\d{4}\\s?[A-Za-z]{2}\\s+)|$)`,
    "gi",
  );

  const matches: EditableAddress[] = [];
  for (const match of source.matchAll(pattern)) {
    const street = titleCase(cleanLine(match[1] ?? ""));
    const houseNumber = cleanLine(match[2] ?? "");
    const postalCode = cleanLine(match[3] ?? "").toUpperCase();
    const city = titleCase(cleanLine(match[4] ?? ""));

    if (!street || !houseNumber || !city) continue;

    matches.push({
      street,
      houseNumber,
      postalCode,
      city,
      raw: input,
    });
  }

  return matches;
}

function fromRegex(line: string): EditableAddress | null {
  const patterns: RegExp[] = [
    /^(.+?)\s+(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)\s*[,-]?\s*(\d{4}\s?[A-Za-z]{2})\s+(.+)$/i,
    /^(\d{4}\s?[A-Za-z]{2})\s+(.+?)\s*[,-]\s*(.+?)\s+(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)$/i,
    /^(.+?)\s+(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)\s*,\s*(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;

    if (pattern === patterns[0]) {
      return {
        street: titleCase(match[1]),
        houseNumber: match[2],
        postalCode: match[3].toUpperCase(),
        city: titleCase(match[4]),
        raw: line,
      };
    }

    if (pattern === patterns[1]) {
      return {
        street: titleCase(match[3]),
        houseNumber: match[4],
        postalCode: match[1].toUpperCase(),
        city: titleCase(match[2]),
        raw: line,
      };
    }

    const trailing = match[3].trim();
    const trailingPostal = trailing.match(POSTAL_REGEX)?.[1] ?? "";
    const trailingCity = titleCase(
      trailing.replace(POSTAL_REGEX, "").replace(/^[,\s-]+|[,\s-]+$/g, ""),
    );

    return {
      street: titleCase(match[1]),
      houseNumber: match[2],
      postalCode: trailingPostal.toUpperCase(),
      city: trailingCity,
      raw: line,
    };
  }

  return null;
}

function toEditableAddress(rawInput: string): EditableAddress | null {
  const line = cleanLine(rawInput.replace(/[;]/g, " "));
  if (line.length < 6) return null;

  const patternMatch = fromRegex(line);
  if (patternMatch) return patternMatch;

  const postalMatch = line.match(POSTAL_REGEX);
  const houseMatch = line.match(HOUSE_NUMBER_REGEX);

  const postalCode = postalMatch?.[1]?.toUpperCase() ?? "";
  const houseNumber = houseMatch?.[1] ?? "";

  let city = "";
  if (postalMatch) {
    const cityPart = line.slice(postalMatch.index! + postalMatch[0].length).trim();
    city = titleCase(cityPart.replace(/[,.-]+$/g, ""));
  }

  let street = "";
  if (houseMatch) {
    street = titleCase(
      line
        .slice(0, houseMatch.index)
        .replace(/[,.-]+$/g, "")
        .trim(),
    );
  }

  if (!street && houseMatch) {
    const beforePostal = postalMatch
      ? line.slice(0, postalMatch.index).trim()
      : line;
    const guessedStreet = beforePostal.replace(houseMatch[0], "").trim();
    street = titleCase(guessedStreet);
  }

  if (!city && postalMatch) {
    const tokens = line.split(",").map((token) => token.trim()).filter(Boolean);
    city = titleCase(tokens.at(-1) ?? "");
  }

  if (!city && line.includes(",")) {
    city = titleCase(line.split(",").at(-1) ?? "");
  }

  if (!street && !houseNumber && !postalCode) {
    return null;
  }

  return {
    street,
    houseNumber,
    postalCode,
    city,
    raw: rawInput,
  };
}

export function parseAddressesFromOcrText(rawText: string): EditableAddress[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => cleanLine(line))
    .filter((line) => line.length > 3);

  const stitchedLines: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];

    const currentHasPostal = POSTAL_REGEX.test(current);
    const currentHasHouse = HOUSE_NUMBER_REGEX.test(current);
    const nextHasPostal = Boolean(next && POSTAL_REGEX.test(next));

    if (currentHasHouse && !currentHasPostal && nextHasPostal) {
      stitchedLines.push(`${current} ${next}`);
      index += 1;
      continue;
    }

    stitchedLines.push(current);
  }

  const candidates: EditableAddress[] = [];

  for (const line of stitchedLines) {
    const extracted = extractRegexAddresses(line);
    if (extracted.length > 0) {
      candidates.push(...extracted);
      continue;
    }

    const fallback = toEditableAddress(line);
    if (fallback) {
      candidates.push(fallback);
    }
  }

  const unique = new Map<string, EditableAddress>();
  for (const candidate of candidates) {
    const normalizedKey = formatAddress(candidate)
      .toLowerCase()
      .replace(/\s+/g, " ");

    if (!unique.has(normalizedKey)) {
      unique.set(normalizedKey, candidate);
    }
  }

  return [...unique.values()];
}

export function toStops(addresses: EditableAddress[]): AddressStop[] {
  return addresses.map((address, index) => ({
    ...address,
    id: `stop-${Date.now()}-${index}`,
    delivered: false,
  }));
}

export function hasMissingFields(stop: AddressStop) {
  return !stop.street || !stop.houseNumber || !stop.city;
}

export function normalizeStop(stop: AddressStop): AddressStop {
  return {
    ...stop,
    street: titleCase(normalizeWhitespace(stop.street)),
    houseNumber: normalizeWhitespace(stop.houseNumber),
    postalCode: normalizeWhitespace(stop.postalCode).toUpperCase(),
    city: titleCase(normalizeWhitespace(stop.city)),
  };
}