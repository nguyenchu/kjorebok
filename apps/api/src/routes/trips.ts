import type { FastifyInstance } from "fastify";
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
  vehicleId: z.string(),
  startPoint: gpsPointSchema,
});

const addPointSchema = z.object({
  point: gpsPointSchema,
});

const endTripSchema = z.object({
  endPoint: gpsPointSchema,
});

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

export async function tripRoutes(app: FastifyInstance) {
  const auth = { onRequest: [(app as any).authenticate] };

  // List trips (summary, no route)
  app.get("/trips", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const trips = await prisma.trip.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      select: {
        id: true, vehicleId: true, userId: true,
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
    const { id } = request.params as { id: string };
    const trip = await prisma.trip.findFirst({ where: { id, userId } });
    if (!trip) return reply.status(404).send({ error: "Not found" });
    return reply.send(trip);
  });

  // Start a new trip
  app.post("/trips", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const body = startTripSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { vehicleId, startPoint } = body.data;

    // Verify vehicle belongs to user
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
    if (!vehicle) return reply.status(404).send({ error: "Vehicle not found" });

    // Only one active trip per vehicle at a time
    const active = await prisma.trip.findFirst({ where: { vehicleId, status: "ACTIVE" } });
    if (active) return reply.status(409).send({ error: "A trip is already active for this vehicle" });

    const trip = await prisma.trip.create({
      data: {
        userId,
        vehicleId,
        startedAt: new Date(startPoint.timestamp),
        route: [startPoint],
      },
    });
    return reply.status(201).send(trip);
  });

  // Append GPS point(s) to active trip
  app.post("/trips/:id/points", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const { id } = request.params as { id: string };
    const body = addPointSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const trip = await prisma.trip.findFirst({ where: { id, userId, status: "ACTIVE" } });
    if (!trip) return reply.status(404).send({ error: "Active trip not found" });

    const route = trip.route as GpsPoint[];
    route.push(body.data.point);
    const distanceMeters = routeDistance(route);

    const updated = await prisma.trip.update({
      where: { id },
      data: { route, distanceMeters },
    });
    return reply.send(updated);
  });

  // End a trip
  app.post("/trips/:id/end", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const { id } = request.params as { id: string };
    const body = endTripSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const trip = await prisma.trip.findFirst({ where: { id, userId, status: "ACTIVE" } });
    if (!trip) return reply.status(404).send({ error: "Active trip not found" });

    const route = trip.route as GpsPoint[];
    route.push(body.data.endPoint);
    const distanceMeters = routeDistance(route);

    const updated = await prisma.trip.update({
      where: { id },
      data: {
        route,
        distanceMeters,
        status: "COMPLETED",
        endedAt: new Date(body.data.endPoint.timestamp),
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
