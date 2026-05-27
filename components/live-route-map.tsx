"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap } from "react-leaflet";

import type { AddressStop } from "@/types/route";

type LatLng = { lat: number; lng: number };
type RouteState = "idle" | "loading" | "ok" | "error";

type RouteSummary = {
  distanceKm: number;
  durationMin: number;
};

function MapViewport({ user, destination }: { user: LatLng | null; destination: LatLng | null }) {
  const map = useMap();

  useEffect(() => {
    if (user && destination) {
      map.fitBounds(
        [
          [user.lat, user.lng],
          [destination.lat, destination.lng],
        ],
        { padding: [40, 40], maxZoom: 16 },
      );
      return;
    }

    if (destination) {
      map.setView([destination.lat, destination.lng], 15);
      return;
    }

    if (user) {
      map.setView([user.lat, user.lng], 15);
    }
  }, [map, user, destination]);

  return null;
}

async function geocodeAddress(stop: AddressStop, signal: AbortSignal): Promise<LatLng | null> {
  const query = `${stop.street} ${stop.houseNumber}, ${stop.postalCode} ${stop.city}, Netherlands`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });

  if (!response.ok) return null;
  const data = (await response.json()) as Array<{ lat: string; lon: string }>;
  if (!data.length) return null;

  return {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
  };
}

async function fetchRoadRoute(
  user: LatLng,
  destination: LatLng,
  signal: AbortSignal,
): Promise<{ path: [number, number][]; summary: RouteSummary } | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${user.lng},${user.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;

  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) return null;

  const payload = (await response.json()) as {
    routes?: Array<{
      distance: number;
      duration: number;
      geometry?: { coordinates?: [number, number][] };
    }>;
  };

  const route = payload.routes?.[0];
  const coordinates = route?.geometry?.coordinates;
  if (!route || !coordinates?.length) return null;

  return {
    path: coordinates.map(([lng, lat]) => [lat, lng]),
    summary: {
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
    },
  };
}

export function LiveRouteMap({ stop }: { stop: AddressStop }) {
  const [isMounted, setIsMounted] = useState(false);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [destinationLocation, setDestinationLocation] = useState<LatLng | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "ok" | "blocked">("idle");
  const [routePath, setRoutePath] = useState<[number, number][]>([]);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeStatus, setRouteStatus] = useState<RouteState>("idle");

  useEffect(() => {
    // Delay mount to ensure Leaflet is ready
    const timer = setTimeout(() => setIsMounted(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setDestinationLocation(null);

    geocodeAddress(stop, controller.signal)
      .then((coords) => setDestinationLocation(coords))
      .catch(() => setDestinationLocation(null));

    return () => controller.abort();
  }, [stop]);

  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setLocationStatus("blocked");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationStatus("ok");
      },
      () => setLocationStatus("blocked"),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 10000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    if (!userLocation || !destinationLocation) {
      setRoutePath([]);
      setRouteSummary(null);
      setRouteStatus("idle");
      return;
    }

    const controller = new AbortController();
    setRouteStatus("loading");

    const timer = setTimeout(() => {
      fetchRoadRoute(userLocation, destinationLocation, controller.signal)
        .then((result) => {
          if (!result) {
            setRoutePath([]);
            setRouteSummary(null);
            setRouteStatus("error");
            return;
          }
          setRoutePath(result.path);
          setRouteSummary(result.summary);
          setRouteStatus("ok");
        })
        .catch(() => {
          setRoutePath([]);
          setRouteSummary(null);
          setRouteStatus("error");
        });
    }, 700);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [userLocation, destinationLocation]);

  const center = useMemo<[number, number]>(() => {
    if (destinationLocation) return [destinationLocation.lat, destinationLocation.lng];
    if (userLocation) return [userLocation.lat, userLocation.lng];
    return [51.6872, 5.1417];
  }, [destinationLocation, userLocation]);

  return (
    <div className="overflow-hidden rounded-2xl border bg-muted/20">
      <div className="h-[220px] w-full sm:h-[260px]">
        {isMounted ? (
          <MapContainer key={stop.id} center={center} zoom={13} className="h-full w-full" scrollWheelZoom={false}>
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapViewport user={userLocation} destination={destinationLocation} />

            {destinationLocation ? (
              <CircleMarker center={[destinationLocation.lat, destinationLocation.lng]} radius={9} pathOptions={{ color: "var(--primary)", fillColor: "var(--primary)", fillOpacity: 1 }}>
                <Tooltip permanent direction="top" offset={[0, -10]}>Stop</Tooltip>
              </CircleMarker>
            ) : null}

            {userLocation ? (
              <CircleMarker center={[userLocation.lat, userLocation.lng]} radius={8} pathOptions={{ color: "var(--foreground)", fillColor: "var(--accent)", fillOpacity: 1 }}>
                <Tooltip permanent direction="top" offset={[0, -10]}>Jij</Tooltip>
              </CircleMarker>
            ) : null}

            {routePath.length > 1 ? (
              <Polyline
                positions={routePath}
                pathOptions={{ color: "var(--primary)", weight: 5, opacity: 0.9 }}
              />
            ) : null}
          </MapContainer>
        ) : (
          <div className="h-full w-full bg-muted/30" />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
        <p className="font-medium text-foreground">Live map (website)</p>
        <p className="text-muted-foreground">
          {routeStatus === "ok" && routeSummary
            ? `${routeSummary.distanceKm.toFixed(1)} km • ${Math.round(routeSummary.durationMin)} min`
            : routeStatus === "loading"
            ? "Route laden..."
            : locationStatus === "ok"
            ? "GPS actief"
            : locationStatus === "blocked"
            ? "GPS geblokkeerd"
            : "GPS laden..."}
        </p>
      </div>
    </div>
  );
}
