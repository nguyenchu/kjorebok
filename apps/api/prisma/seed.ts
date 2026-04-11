/**
 * Seed script for local development.
 * Generates fake trips for the first user in the database.
 * Routes follow real roads via OSRM (no API key required).
 *
 * Usage:
 *   pnpm --filter @kjorebok/api db:seed
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Oslo-area locations
const PLACES = [
  { coords: [59.9139, 10.7522] as [number, number], name: "Oslo sentrum" },
  { coords: [59.9275, 10.7760] as [number, number], name: "Grünerløkka" },
  { coords: [59.9494, 10.7564] as [number, number], name: "Nydalen" },
  { coords: [59.9020, 10.6450] as [number, number], name: "Skøyen" },
  { coords: [59.8670, 10.6210] as [number, number], name: "Lysaker" },
  { coords: [59.8315, 10.6640] as [number, number], name: "Sandvika" },
  { coords: [59.9700, 10.7900] as [number, number], name: "Kjelsås" },
  { coords: [59.9383, 10.8765] as [number, number], name: "Helsfyr" },
  { coords: [59.8840, 10.7610] as [number, number], name: "Nordstrand" },
  { coords: [59.9560, 10.6420] as [number, number], name: "Røa" },
];

function haversine([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchRoadRoute(
  from: [number, number],
  to: [number, number],
): Promise<[number, number][] | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as any;
    const coords = data?.routes?.[0]?.geometry?.coordinates as [number, number][] | undefined;
    if (!coords) return null;
    return coords.map(([lng, lat]) => [lat, lng]);
  } catch {
    return null;
  }
}

function buildRouteFromCoords(
  coords: [number, number][],
  startedAt: Date,
): { route: object[]; durationMs: number; distanceMeters: number } {
  let distanceMeters = 0;
  for (let i = 1; i < coords.length; i++) {
    distanceMeters += haversine(coords[i - 1], coords[i]);
  }

  const speedMs = 45 / 3.6;
  const durationMs = (distanceMeters / speedMs) * 1000;

  const route = coords.map((coord, i) => ({
    lat: coord[0],
    lng: coord[1],
    speed: speedMs + (Math.random() - 0.5) * 4,
    heading: i < coords.length - 1
      ? Math.atan2(coords[i + 1][1] - coord[1], coords[i + 1][0] - coord[0]) * (180 / Math.PI)
      : 0,
    accuracy: 5 + Math.random() * 8,
    timestamp: new Date(startedAt.getTime() + (durationMs * i) / (coords.length - 1)).toISOString(),
  }));

  return { route, durationMs, distanceMeters: Math.round(distanceMeters) };
}

function buildRouteStraight(from: [number, number], to: [number, number], startedAt: Date) {
  const distance = haversine(from, to);
  const speedMs = 45 / 3.6;
  const durationMs = (distance / speedMs) * 1000;
  const steps = Math.max(10, Math.round(distance / 80));

  const route = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return {
      lat: from[0] + (to[0] - from[0]) * t,
      lng: from[1] + (to[1] - from[1]) * t,
      speed: speedMs + (Math.random() - 0.5) * 3,
      heading: Math.atan2(to[1] - from[1], to[0] - from[0]) * (180 / Math.PI),
      accuracy: 5 + Math.random() * 10,
      timestamp: new Date(startedAt.getTime() + (durationMs * i) / steps).toISOString(),
    };
  });

  return { route, durationMs, distanceMeters: Math.round(distance) };
}

const TRIPS: { from: number; to: number; purpose: "PRIVATE" | "WORK"; daysAgo: number; hour: number }[] = [
  { from: 0, to: 4, purpose: "WORK",    daysAgo: 0,  hour: 7  },
  { from: 4, to: 0, purpose: "WORK",    daysAgo: 0,  hour: 16 },
  { from: 0, to: 6, purpose: "PRIVATE", daysAgo: 1,  hour: 10 },
  { from: 6, to: 0, purpose: "PRIVATE", daysAgo: 1,  hour: 19 },
  { from: 0, to: 2, purpose: "WORK",    daysAgo: 2,  hour: 8  },
  { from: 2, to: 7, purpose: "WORK",    daysAgo: 2,  hour: 12 },
  { from: 7, to: 0, purpose: "WORK",    daysAgo: 2,  hour: 16 },
  { from: 0, to: 5, purpose: "WORK",    daysAgo: 3,  hour: 8  },
  { from: 5, to: 0, purpose: "WORK",    daysAgo: 3,  hour: 17 },
  { from: 0, to: 8, purpose: "PRIVATE", daysAgo: 4,  hour: 14 },
  { from: 8, to: 0, purpose: "PRIVATE", daysAgo: 4,  hour: 17 },
  { from: 0, to: 3, purpose: "WORK",    daysAgo: 7,  hour: 7  },
  { from: 3, to: 7, purpose: "WORK",    daysAgo: 7,  hour: 11 },
  { from: 7, to: 0, purpose: "WORK",    daysAgo: 7,  hour: 17 },
  { from: 0, to: 9, purpose: "PRIVATE", daysAgo: 8,  hour: 11 },
  { from: 9, to: 0, purpose: "PRIVATE", daysAgo: 8,  hour: 13 },
  { from: 0, to: 2, purpose: "WORK",    daysAgo: 9,  hour: 8  },
  { from: 2, to: 0, purpose: "WORK",    daysAgo: 9,  hour: 16 },
  { from: 0, to: 5, purpose: "WORK",    daysAgo: 14, hour: 8  },
  { from: 5, to: 4, purpose: "WORK",    daysAgo: 14, hour: 12 },
  { from: 4, to: 0, purpose: "WORK",    daysAgo: 14, hour: 17 },
  { from: 0, to: 1, purpose: "PRIVATE", daysAgo: 15, hour: 13 },
  { from: 1, to: 0, purpose: "PRIVATE", daysAgo: 15, hour: 16 },
  { from: 0, to: 7, purpose: "WORK",    daysAgo: 21, hour: 9  },
  { from: 7, to: 0, purpose: "WORK",    daysAgo: 21, hour: 17 },
  { from: 0, to: 6, purpose: "PRIVATE", daysAgo: 22, hour: 12 },
  { from: 6, to: 0, purpose: "PRIVATE", daysAgo: 22, hour: 18 },
];

async function main() {
  const user = await prisma.user.findFirst({ where: { email: "toeffen@gmail.com" } })
    ?? await prisma.user.findFirst();

  if (!user) {
    console.error("Ingen bruker funnet. Logg inn i web-appen først.");
    process.exit(1);
  }

  const userId = user.id;
  console.log(`Legger til turer for: ${user.email}`);
  await prisma.trip.deleteMany({ where: { userId } });

  const now = new Date();
  let roadRoutes = 0;

  for (const spec of TRIPS) {
    const from = PLACES[spec.from];
    const to = PLACES[spec.to];

    const startedAt = new Date(now);
    startedAt.setDate(startedAt.getDate() - spec.daysAgo);
    startedAt.setHours(spec.hour, Math.floor(Math.random() * 30), 0, 0);

    const roadCoords = await fetchRoadRoute(from.coords, to.coords);
    const { route, durationMs, distanceMeters } = roadCoords
      ? (roadRoutes++, buildRouteFromCoords(roadCoords, startedAt))
      : buildRouteStraight(from.coords, to.coords, startedAt);

    await prisma.trip.create({
      data: {
        userId,
        status: "COMPLETED",
        startedAt,
        endedAt: new Date(startedAt.getTime() + durationMs),
        distanceMeters,
        startAddress: from.name,
        endAddress: to.name,
        purpose: spec.purpose,
        route: route as any,
      },
    });
  }

  console.log(`${TRIPS.length} turer opprettet (${roadRoutes} med veiruter, ${TRIPS.length - roadRoutes} rette linjer).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());