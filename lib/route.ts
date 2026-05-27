import { AddressStop } from "@/types/route";
import { formatAddress } from "@/lib/address";

function postalWeight(postalCode: string) {
  const digits = postalCode.replace(/\D/g, "");
  return digits ? Number.parseInt(digits, 10) : Number.MAX_SAFE_INTEGER;
}

function cityWeight(city: string) {
  return city.toLowerCase();
}

export function optimizeByNearestNeighbor(stops: AddressStop[]) {
  if (stops.length <= 2) return stops;

  const remaining = [...stops];
  const route: AddressStop[] = [remaining.shift()!];

  while (remaining.length > 0) {
    const current = route.at(-1)!;
    const currentPostal = postalWeight(current.postalCode);

    let closestIndex = 0;
    let closestScore = Number.MAX_SAFE_INTEGER;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const candidatePostal = postalWeight(candidate.postalCode);
      const postalDistance = Math.abs(currentPostal - candidatePostal);
      const cityPenalty =
        cityWeight(candidate.city) === cityWeight(current.city) ? 0 : 1000;
      const score = postalDistance + cityPenalty;

      if (score < closestScore) {
        closestScore = score;
        closestIndex = index;
      }
    }

    route.push(remaining.splice(closestIndex, 1)[0]);
  }

  return route;
}

export function buildGoogleMapsDirectionsUrl(stops: AddressStop[]) {
  const parts = stops.map((stop) => encodeURIComponent(formatAddress(stop)));
  return `https://www.google.com/maps/dir/${parts.join("/")}`;
}

export function buildAppleMapsDirectionsUrl(stop: AddressStop) {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(formatAddress(stop))}&dirflg=d`;
}

export function buildFlitsmeisterDirectionsUrl(stop: AddressStop) {
  return `flitsmeister://navigate?destination=${encodeURIComponent(formatAddress(stop))}`;
}

export function duplicateKeys(stops: AddressStop[]) {
  const seen = new Map<string, number>();
  const duplicates = new Set<string>();

  for (const stop of stops) {
    const key = formatAddress(stop).toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);

    if (count > 1) {
      duplicates.add(key);
    }
  }

  return duplicates;
}