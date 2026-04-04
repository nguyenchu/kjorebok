import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client/index.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import type { GpsPoint } from "@kjorebok/shared";

const gpsPointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  speed: z.number(),
  heading: z.number(),
  accuracy: z.number(),
  timestamp: z.string(),
});

const startTripSchema = z.object({
  startPoint: gpsPointSchema,
  startAddress: z.string().trim().min(1).nullable().optional(),
});

const addPointSchema = z.object({
  point: gpsPointSchema,
});

const addPointsBatchSchema = z.object({
  points: z.array(gpsPointSchema).min(1),
});

const endTripSchema = z.object({
  endPoint: gpsPointSchema,
  endAddress: z.string().trim().min(1).nullable().optional(),
});

const STALE_ACTIVE_TRIP_TIMEOUT_MS = 30 * 60 * 1000;

/** Haversine distance in meters between two lat/lng points */
function haversine(a: GpsPoint, b: GpsPoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function routeDistance(points: GpsPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i]);
  }
  return total;
}

function parseRoute(route: Prisma.JsonValue): GpsPoint[] {
  return (Array.isArray(route) ? route : []) as unknown as GpsPoint[];
}

function samePoint(a: GpsPoint, b: GpsPoint): boolean {
  return (
    a.timestamp === b.timestamp &&
    a.lat === b.lat &&
    a.lng === b.lng &&
    a.speed === b.speed &&
    a.heading === b.heading &&
    a.accuracy === b.accuracy
  );
}

function appendUniquePoints(route: GpsPoint[], points: GpsPoint[]): GpsPoint[] {
  const next = [...route];

  for (const point of points) {
    const last = next[next.length - 1];
    if (!last || !samePoint(last, point)) {
      next.push(point);
    }
  }

  return next;
}

function getLatestRoutePoint(route: GpsPoint[]): GpsPoint | null {
  return route.length > 0 ? route[route.length - 1] : null;
}

async function finalizeStaleActiveTrips(userId: string): Promise<void> {
  const activeTrips = await prisma.trip.findMany({
    where: { userId, status: "ACTIVE" },
    select: {
      id: true,
      route: true,
      updatedAt: true,
    },
  });

  const now = Date.now();

  for (const trip of activeTrips) {
    const route = parseRoute(trip.route);
    const lastPoint = getLatestRoutePoint(route);
    const gpsTime = lastPoint ? new Date(lastPoint.timestamp).getTime() : 0;
    const lastActivityTime = Math.max(
      Number.isFinite(gpsTime) ? gpsTime : 0,
      trip.updatedAt.getTime(),
    );

    if (now - lastActivityTime < STALE_ACTIVE_TRIP_TIMEOUT_MS) {
      continue;
    }

    await prisma.trip.update({
      where: { id: trip.id },
      data: {
        status: "COMPLETED",
        endedAt: lastPoint ? new Date(lastPoint.timestamp) : trip.updatedAt,
        distanceMeters: routeDistance(route),
      },
    });
  }
}

export async function tripRoutes(app: FastifyInstance) {
  const auth = { onRequest: [(app as any).authenticate] };

  // List trips (summary, no route)
  app.get("/trips", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    await finalizeStaleActiveTrips(userId);
    const trips = await prisma.trip.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      select: {
        id: true, userId: true,
        status: true, startedAt: true, endedAt: true,
        distanceMeters: true, startAddress: true, endAddress: true,
        createdAt: true, updatedAt: true,
      },
    });
    return reply.send(trips);
  });

  // Get single trip with route
  app.get("/trips/:id", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    await finalizeStaleActiveTrips(userId);
    const { id } = request.params as { id: string };
    const trip = await prisma.trip.findFirst({ where: { id, userId } });
    if (!trip) return reply.status(404).send({ error: "Not found" });
    return reply.send(trip);
  });

  // Start a new trip
  app.post("/trips", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    await finalizeStaleActiveTrips(userId);
    const body = startTripSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { startPoint, startAddress } = body.data;

    const active = await prisma.trip.findFirst({ where: { userId, status: "ACTIVE" } });
    if (active) return reply.status(409).send({ error: "An active trip already exists" });

    const trip = await prisma.trip.create({
      data: {
        userId,
        startedAt: new Date(startPoint.timestamp),
        startAddress: startAddress ?? null,
        route: [startPoint],
      },
    });
    return reply.status(201).send(trip);
  });

  // Append GPS point(s) to active trip
  app.post("/trips/:id/points", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    await finalizeStaleActiveTrips(userId);
    const { id } = request.params as { id: string };
    const body = addPointSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const trip = await prisma.trip.findFirst({ where: { id, userId, status: "ACTIVE" } });
    if (!trip) return reply.status(404).send({ error: "Active trip not found" });

    const route = parseRoute(trip.route);
    route.push(body.data.point);
    const distanceMeters = routeDistance(route);

    const updated = await prisma.trip.update({
      where: { id },
      data: { route: route as unknown as Prisma.InputJsonValue, distanceMeters },
    });
    return reply.send(updated);
  });

  app.post("/trips/:id/points/batch", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    await finalizeStaleActiveTrips(userId);
    const { id } = request.params as { id: string };
    const body = addPointsBatchSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const trip = await prisma.trip.findFirst({ where: { id, userId, status: "ACTIVE" } });
    if (!trip) return reply.status(404).send({ error: "Active trip not found" });

    const route = appendUniquePoints(parseRoute(trip.route), body.data.points);
    const distanceMeters = routeDistance(route);

    const updated = await prisma.trip.update({
      where: { id },
      data: { route: route as unknown as Prisma.InputJsonValue, distanceMeters },
    });

    return reply.send({
      tripId: updated.id,
      acceptedPoints: route.length - parseRoute(trip.route).length,
      distanceMeters: updated.distanceMeters,
      lastPointTimestamp: route[route.length - 1]?.timestamp ?? null,
    });
  });

  // End a trip
  app.post("/trips/:id/end", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    await finalizeStaleActiveTrips(userId);
    const { id } = request.params as { id: string };
    const body = endTripSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const trip = await prisma.trip.findFirst({ where: { id, userId, status: "ACTIVE" } });
    if (!trip) return reply.status(404).send({ error: "Active trip not found" });

    const route = appendUniquePoints(parseRoute(trip.route), [body.data.endPoint]);
    const distanceMeters = routeDistance(route);

    const updated = await prisma.trip.update({
      where: { id },
      data: {
        route: route as unknown as Prisma.InputJsonValue,
        distanceMeters,
        status: "COMPLETED",
        endedAt: new Date(body.data.endPoint.timestamp),
        endAddress: body.data.endAddress ?? null,
      },
    });
    return reply.send(updated);
  });

  // Delete a trip
  app.delete("/trips/:id", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const { id } = request.params as { id: string };
    const trip = await prisma.trip.findFirst({ where: { id, userId } });
    if (!trip) return reply.status(404).send({ error: "Not found" });

    await prisma.trip.delete({ where: { id } });
    return reply.status(204).send();
  });
}
