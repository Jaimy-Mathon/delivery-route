"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Route as RouteIcon } from "lucide-react";

import type { AddressStop } from "@/types/route";

type LatLng = { lat: number; lng: number; accuracy?: number };

async function getIPBasedLocation(): Promise<LatLng | null> {
  try {
    // Try ipinfo.io first (more reliable)
    const token = "16e2bd8f80e02c";
    const response = await fetch(`https://ipinfo.io/json?token=${token}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      console.debug(`[GPS] ipinfo.io failed:  ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      loc?: string;
    };

    if (!data.loc) {
      console.debug("[GPS] No location in ipinfo.io response");
      return null;
    }

    const [latStr, lngStr] = data.loc.split(",");
    const lat = Number(latStr);
    const lng = Number(lngStr);

    if (!lat || !lng) {
      console.debug("[GPS] Invalid coordinates from ipinfo.io");
      return null;
    }

    console.debug(`[GPS] ✓ IP-based (ipinfo): ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    return { lat, lng };
  } catch (err) {
    console.debug("[GPS] ipinfo.io error:", (err as Error).message);
    return null;
  }
}

type RouteEstimate = {
  distanceKm: number;
  durationMin: number;
};

function stopKey(stop: AddressStop) {
  return `${stop.street}|${stop.houseNumber}|${stop.postalCode}|${stop.city}`.toLowerCase();
}

function formatDuration(totalMinutes: number) {
  const rounded = Math.max(0, Math.round(totalMinutes));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

async function geocodeAddress(stop: AddressStop, signal: AbortSignal): Promise<LatLng | null> {
  // Try multiple query formats, from most specific to least
  const queries = [
    `${stop.postalCode} ${stop.city}`,
    `${stop.city}, Netherlands`,
    `Drunen Netherlands`, // fallback for known city
  ];

  for (const query of queries) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;

    try {
      // Add a delay to avoid rate-limiting
      await new Promise((resolve) => setTimeout(resolve, 200));

      const response = await fetch(url, {
        signal,
        headers: { Accept: "application/json", "User-Agent": "DeliveryRouteScanner/1.0" },
      });

      if (!response.ok) {
        console.debug(`[Geocode] HTTP ${response.status} for query: ${query}`);
        continue;
      }

      const data = (await response.json()) as Array<{ lat: string; lon: string }>;
      if (!data.length) {
        console.debug(`[Geocode] No results for query: ${query}`);
        continue;
      }

      console.debug(
        `[Geocode] ✓ Got: ${stop.street} nr ${stop.houseNumber} via "${query}" -> (${data[0].lat}, ${data[0].lon})`,
      );
      return {
        lat: Number(data[0].lat),
        lng: Number(data[0].lon),
      };
    } catch (err) {
      console.debug(`[Geocode] Fetch error for "${query}":`, (err as Error).message);
      continue;
    }
  }

  console.warn(`[Geocode] ✗ Failed to geocode: ${stop.street} ${stop.houseNumber}, ${stop.postalCode} ${stop.city}`);
  return null;
}

async function fetchRemainingRouteEstimate(
  user: LatLng,
  waypoints: LatLng[],
  signal: AbortSignal,
): Promise<RouteEstimate | null> {
  if (!waypoints.length) return { distanceKm: 0, durationMin: 0 };

  const allPoints = [user, ...waypoints]
    .map((point) => `${point.lng},${point.lat}`)
    .join(";");

  const url = `https://router.project-osrm.org/route/v1/driving/${allPoints}?overview=false`;
  
  try {
    const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!response.ok) {
      console.warn(`[OSRM] Failed: ${response.status}`);
      return null;
    }

    const payload = (await response.json()) as {
      routes?: Array<{ distance: number; duration: number }>;
    };

    const route = payload.routes?.[0];
    if (!route) {
      console.warn("[OSRM] No route found");
      return null;
    }

    console.debug(`[OSRM] Route: ${(route.distance / 1000).toFixed(1)}km, ${(route.duration / 60).toFixed(0)}min`);
    return {
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
    };
  } catch (err) {
    console.error("[OSRM] Error:", err);
    return null;
  }
}

export function RemainingRouteWidget({
  stops,
  currentStopIndex,
}: {
  stops: AddressStop[];
  currentStopIndex: number;
}) {
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [estimate, setEstimate] = useState<RouteEstimate | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const geocodeCacheRef = useRef<Map<string, LatLng>>(new Map());

  const remainingStops = useMemo(
    () => stops.filter((stop, index) => index >= currentStopIndex && !stop.delivered),
    [stops, currentStopIndex],
  );

  // Hydration guard
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    if (typeof window === "undefined" || !navigator.geolocation) {
      if (!navigator.geolocation) {
        console.warn("[GPS] Geolocation not available, using IP fallback");
        getIPBasedLocation().then((loc) => {
          if (loc) setUserLocation(loc);
        });
      }
      return;
    }

    let hasPreciseLocation = false;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        hasPreciseLocation = true;
        const loc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        console.debug(
          `[GPS] Precise: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} (±${loc.accuracy?.toFixed(0)}m)`,
        );
        setUserLocation(loc);
      },
      (error) => {
        console.warn(`[GPS] Location unavailable (${error.code}): ${error.message}`);
        if (!hasPreciseLocation) {
          console.info("[GPS] Falling back to IP-based location");
          getIPBasedLocation().then((loc) => {
            if (loc) {
              console.debug("[GPS] IP fallback succeeded");
              setUserLocation(loc);
            }
          });
        }
      },
      { enableHighAccuracy: true, maximumAge: 6000, timeout: 30000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isMounted]);

  useEffect(() => {
    if (!userLocation || remainingStops.length === 0) {
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);

    const run = async () => {
      console.debug(`[Route] Starting: user=(${userLocation.lat.toFixed(4)},${userLocation.lng.toFixed(4)}), stops=${remainingStops.length}`);
      
      const waypointCoords: LatLng[] = [];

      for (const stop of remainingStops) {
        const key = stopKey(stop);
        const cached = geocodeCacheRef.current.get(key);
        if (cached) {
          console.debug(`[Route] Cached: ${stop.street}`);
          waypointCoords.push(cached);
          continue;
        }

        const geocoded = await geocodeAddress(stop, controller.signal);
        if (!geocoded) {
          console.warn(`[Route] Geocode failed: ${stop.street}`);
          continue;
        }

        geocodeCacheRef.current.set(key, geocoded);
        console.debug(`[Route] Geocoded: ${stop.street} -> (${geocoded.lat.toFixed(4)},${geocoded.lng.toFixed(4)})`);
        waypointCoords.push(geocoded);
      }

      console.debug(`[Route] Got ${waypointCoords.length}/${remainingStops.length} waypoint coords`);
      
      let nextEstimate: RouteEstimate | null = null;
      
      if (waypointCoords.length > 0) {
        nextEstimate = await fetchRemainingRouteEstimate(userLocation, waypointCoords, controller.signal);
      }
      
      // Fallback estimate: ~3 min per stop in Netherlands
      if (!nextEstimate && waypointCoords.length > 0) {
        console.debug("[Route] OSRM failed, using fallback estimate");
        nextEstimate = {
          distanceKm: waypointCoords.length * 1.5, // rough estimate: ~1.5km per stop
          durationMin: waypointCoords.length * 3,    // rough estimate: ~3 min per stop
        };
      }

      if (!nextEstimate) {
        console.warn("[Route] No estimate available (no geocoded waypoints)");
        setEstimate(null);
        setIsLoading(false);
        return;
      }

      setEstimate(nextEstimate);
      setIsLoading(false);
    };

    run().catch((err) => {
      console.error("[Route] Exception:", err);
      setEstimate(null);
      setIsLoading(false);
    });

    return () => controller.abort();
  }, [userLocation, remainingStops]);

  const nextOpen = remainingStops.slice(0, 5);

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Remaining route</p>
        <p className="text-xs text-muted-foreground">{remainingStops.length} open stop(s)</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Time left</p>
          <p className="mt-0.5 text-lg font-bold inline-flex items-center gap-1.5">
            <Clock3 className="size-4" />
            {isLoading ? "..." : estimate ? formatDuration(estimate.durationMin) : "—"}
          </p>
        </div>
        <div className="px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Distance left</p>
          <p className="mt-0.5 text-lg font-bold inline-flex items-center gap-1.5">
            <RouteIcon className="size-4" />
            {isLoading ? "..." : estimate ? `${estimate.distanceKm.toFixed(1)} km` : "—"}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Next 5 stops</p>
        {nextOpen.length === 0 ? (
          <p className="text-sm font-medium">All stops done</p>
        ) : (
          <div className="space-y-1">
            {nextOpen.map((stop, index) => (
              <p
                key={stop.id}
                className={`truncate py-1.5 text-sm ${index < nextOpen.length - 1 ? "border-b border-border/30" : ""}`}
              >
                {stop.street} {stop.houseNumber}, {stop.postalCode} {stop.city}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
