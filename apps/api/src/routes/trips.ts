import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client/index.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import type { GpsPoint, Place } from "@kjorebok/shared";
import { calculateAllowance } from "../lib/rates.js";
import {
  renderKjorebokCsv,
  renderKjorebokPdf,
  summarizeRows,
  type KjorebokReport,
  type KjorebokRow,
} from "../lib/kjorebokReport.js";
import { periodLabel, periodRange, periodSlug, periodYearOf } from "../lib/period.js";
import { findMatchingPlace } from "../lib/placeMatcher.js";
import {
  haversine,
  insertPoints,
  loadRoute,
  routeDistance,
  summarizeRoute,
  toPointRow,
  withActiveTrip,
  type IncomingPoint,
} from "../lib/tripPoints.js";

// speed/heading accept null so the app can say "unknown" instead of sending 0.
const gpsPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speed: z.number().nullable(),
  heading: z.number().nullable(),
  accuracy: z.number(),
  altitude: z.number().nullable().optional(),
  altitudeAccuracy: z.number().nullable().optional(),
  timestamp: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Ugyldig tidsstempel"),
});

const startTripSchema = z.object({
  startPoint: gpsPointSchema,
  startAddress: z.string().trim().min(1).nullable().optional(),
  vehicleId: z.string().cuid().optional(),
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

const updateTripSchema = z.object({
  purpose: z.enum(["PRIVATE", "WORK"]).optional(),
  purposeNote: z.string().trim().max(200).nullable().optional(),
  client: z.string().trim().max(120).nullable().optional(),
  mode: z.enum(["WALK", "CYCLE", "EBIKE", "CAR", "OTHER"]).optional(),
  vehicleId: z.string().cuid().nullable().optional(),
  odometerStart: z.number().int().nonnegative().max(3_000_000).nullable().optional(),
  odometerEnd: z.number().int().nonnegative().max(3_000_000).nullable().optional(),
});

const reportQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    vehicleId: z.string().cuid().optional(),
    purpose: z.enum(["PRIVATE", "WORK"]).optional(),
  })
  .refine((value) => value.month === undefined || value.year !== undefined, {
    message: "month krever at year er satt",
    path: ["month"],
  });

const tripVehicleSelect = {
  select: { id: true, label: true, registration: true, type: true, isDefault: true },
} as const;

const tripDocumentationSelect = {
  purposeNote: true,
  client: true,
  odometerStart: true,
  odometerEnd: true,
  vehicle: tripVehicleSelect,
} as const;

const MIN_TRIP_DISTANCE_METERS = 50;
const MAX_MODE_ACCURACY_METERS = 80;
const MAX_SEGMENT_GAP_MS = 2 * 60 * 1000;
const MAX_REASONABLE_SEGMENT_SPEED_KMH = 160;

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * q)));
  return values[index];
}

function toKmh(speedMs: number): number {
  return speedMs * 3.6;
}

/**
 * Detect trip mode from route shape.
 *
 * We combine device-reported speed with speed derived from GPS segments and then
 * classify using a few robust statistics instead of a single speed threshold.
 */
function detectTripMode(points: GpsPoint[]): "WALK" | "CYCLE" | "EBIKE" | "CAR" | "OTHER" {
  if (points.length < 2) return "WALK";

  const usablePoints = points.filter((point) => point.accuracy > 0 && point.accuracy <= MAX_MODE_ACCURACY_METERS);
  const route = usablePoints.length >= 2 ? usablePoints : points;

  const reportedSpeeds = route
    .map((point) => toKmh(Math.max(0, point.speed)))
    .filter((speed) => Number.isFinite(speed) && speed <= MAX_REASONABLE_SEGMENT_SPEED_KMH);

  const segmentSpeeds: number[] = [];
  let movingSegments = 0;
  let totalSegments = 0;

  for (let i = 1; i < route.length; i++) {
    const previous = route[i - 1];
    const current = route[i];
    const timeMs = new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime();
    if (!Number.isFinite(timeMs) || timeMs <= 0 || timeMs > MAX_SEGMENT_GAP_MS) continue;

    const distanceMeters = haversine(previous, current);
    const speedKmh = (distanceMeters / (timeMs / 1000)) * 3.6;
    if (!Number.isFinite(speedKmh) || speedKmh > MAX_REASONABLE_SEGMENT_SPEED_KMH) continue;

    totalSegments += 1;
    if (speedKmh >= 2.5) movingSegments += 1;
    segmentSpeeds.push(speedKmh);
  }

  const speeds = [...reportedSpeeds, ...segmentSpeeds].sort((a, b) => a - b);
  if (speeds.length === 0) return "OTHER";

  const median = percentile(speeds, 0.5);
  const p75 = percentile(speeds, 0.75);
  const p90 = percentile(speeds, 0.9);
  const max = speeds[speeds.length - 1];
  const distanceKm = routeDistance(route) / 1000;
  const movingRatio = totalSegments > 0 ? movingSegments / totalSegments : 0;

  if (
    p90 >= 36 ||
    max >= 55 ||
    (median >= 18 && p75 >= 28) ||
    (distanceKm >= 3 && median >= 16 && movingRatio >= 0.45)
  ) {
    return "CAR";
  }

  if (
    p90 >= 22 ||
    max >= 32 ||
    (median >= 13 && p75 >= 18) ||
    (distanceKm >= 2 && median >= 12 && movingRatio >= 0.55)
  ) {
    return "EBIKE";
  }

  if (
    p90 >= 9 ||
    max >= 18 ||
    (median >= 5.5 && p75 >= 8) ||
    (distanceKm >= 0.8 && median >= 4.5 && movingRatio >= 0.6)
  ) {
    return "CYCLE";
  }

  return "WALK";
}

const STALE_ACTIVE_TRIP_TIMEOUT_MS = 30 * 60 * 1000;

/** The legacy JSON route is never sent to clients; `route` comes from TripPoint. */
const omitLegacyRoute = { route: true } as const;

async function loadUserPlaces(userId: string): Promise<Place[]> {
  return prisma.place.findMany({
    where: { userId },
    select: { id: true, label: true, lat: true, lng: true, radiusMeters: true },
  });
}

const tripEndpointsSelect = { startLat: true, startLng: true, endLat: true, endLng: true } as const;

type TripEndpoints = {
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
};

function attachPlaces<T extends TripEndpoints>(
  trip: T,
  places: Place[],
): T & { startPlace: Place | null; endPlace: Place | null } {
  return {
    ...trip,
    startPlace: findMatchingPlace(places, trip.startLat, trip.startLng),
    endPlace: findMatchingPlace(places, trip.endLat, trip.endLng),
  };
}

/**
 * Completes a locked active trip from its stored points, or deletes it when it
 * is too short to be a trip. `endedAt` defaults to the last fix.
 */
async function completeTrip(
  tx: Prisma.TransactionClient,
  tripId: string,
  data: Prisma.TripUpdateInput,
  fallbackEndedAt: Date,
) {
  const route = await loadRoute(tx, tripId);
  const geometry = summarizeRoute(route);

  if (geometry.distanceMeters < MIN_TRIP_DISTANCE_METERS) {
    await tx.trip.delete({ where: { id: tripId } });
    return null;
  }

  const last = route[route.length - 1];
  return tx.trip.update({
    where: { id: tripId },
    data: {
      endedAt: last ? new Date(last.timestamp) : fallbackEndedAt,
      ...data,
      ...geometry,
      status: "COMPLETED",
      mode: detectTripMode(route),
    },
    omit: omitLegacyRoute,
  });
}

/** Stores fixes on the user's active trip and refreshes its distance and endpoints. */
async function appendToActiveTrip(userId: string, tripId: string, points: IncomingPoint[]) {
  return withActiveTrip(userId, tripId, async (tx) => {
    const acceptedPoints = await insertPoints(tx, tripId, points);
    const route = await loadRoute(tx, tripId);
    const trip = await tx.trip.update({
      where: { id: tripId },
      data: summarizeRoute(route),
      omit: omitLegacyRoute,
    });
    return {
      trip,
      acceptedPoints,
      lastPointTimestamp: route[route.length - 1]?.timestamp ?? null,
    };
  });
}

async function finalizeStaleActiveTrips(userId: string): Promise<void> {
  const activeTrips = await prisma.trip.findMany({
    where: { userId, status: "ACTIVE" },
    select: {
      id: true,
      updatedAt: true,
      points: { select: { recordedAt: true }, orderBy: { recordedAt: "desc" }, take: 1 },
    },
  });

  const now = Date.now();

  for (const trip of activeTrips) {
    const lastActivityTime = Math.max(
      trip.points[0]?.recordedAt.getTime() ?? 0,
      trip.updatedAt.getTime(),
    );

    if (now - lastActivityTime < STALE_ACTIVE_TRIP_TIMEOUT_MS) {
      continue;
    }

    await withActiveTrip(userId, trip.id, (tx) => completeTrip(tx, trip.id, {}, trip.updatedAt));
  }
}

type ReportFilters = z.infer<typeof reportQuerySchema>;

async function buildKjorebokReport(
  userId: string,
  filters: ReportFilters,
): Promise<KjorebokReport | null> {
  await finalizeStaleActiveTrips(userId);

  const where: Prisma.TripWhereInput = { userId, status: "COMPLETED" };
  if (filters.vehicleId) where.vehicleId = filters.vehicleId;
  if (filters.purpose) where.purpose = filters.purpose;

  const range = periodRange(filters.year, filters.month);
  if (range) where.startedAt = range;

  const [trips, places, user, vehicle] = await Promise.all([
    prisma.trip.findMany({
      where,
      orderBy: { startedAt: "asc" },
      select: {
        // The web report edits documentation in place, which needs the row to
        // say which trip it came from.
        id: true,
        startedAt: true, endedAt: true,
        distanceMeters: true, startAddress: true, endAddress: true, purpose: true,
        ...tripDocumentationSelect,
        ...tripEndpointsSelect,
      },
    }),
    loadUserPlaces(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    filters.vehicleId
      ? prisma.vehicle.findFirst({
          where: { id: filters.vehicleId, userId },
          select: { label: true, registration: true, type: true },
        })
      : Promise.resolve(null),
  ]);

  if (!user) return null;
  if (filters.vehicleId && !vehicle) return null;

  const rows: KjorebokRow[] = trips.map((trip) => {
    const enriched = attachPlaces(trip, places);
    return {
      id: enriched.id,
      startedAt: enriched.startedAt,
      endedAt: enriched.endedAt,
      from: enriched.startPlace?.label ?? enriched.startAddress ?? "—",
      to: enriched.endPlace?.label ?? enriched.endAddress ?? "—",
      purpose: enriched.purpose,
      purposeNote: enriched.purposeNote,
      client: enriched.client,
      registration: enriched.vehicle?.registration ?? null,
      vehicleLabel: enriched.vehicle?.label ?? null,
      odometerStart: enriched.odometerStart,
      odometerEnd: enriched.odometerEnd,
      distanceMeters: enriched.distanceMeters,
      allowance: calculateAllowance(enriched.distanceMeters, periodYearOf(enriched.startedAt)),
    };
  });

  return {
    rows,
    totals: summarizeRows(rows),
    periodLabel: periodLabel(filters.year, filters.month),
    owner: user,
    vehicle,
    generatedAt: new Date(),
  };
}

export async function tripRoutes(app: FastifyInstance) {
  const auth = { onRequest: [(app as any).authenticate] };

  // Kjørebok reports. Both formats render the same rows, so the numbers in the
  // CSV and the PDF cannot drift apart.
  // Filters: ?year=2026&month=3&vehicleId=...&purpose=WORK
  app.get("/trips/export.csv", auth, async (request, reply) => {
    const query = reportQuerySchema.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() });

    const userId = (request.user as any).sub;
    const report = await buildKjorebokReport(userId, query.data);
    if (!report) return reply.status(404).send({ error: "Not found" });

    const { year, month } = query.data;
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header(
      "Content-Disposition",
      `attachment; filename="kjorebok${periodSlug(year, month)}.csv"`,
    );
    return reply.send(renderKjorebokCsv(report));
  });

  // Same report the CSV and PDF are rendered from, so the web UI can show the
  // numbers before anyone downloads a file.
  app.get("/trips/report", auth, async (request, reply) => {
    const query = reportQuerySchema.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() });

    const userId = (request.user as any).sub;
    const report = await buildKjorebokReport(userId, query.data);
    if (!report) return reply.status(404).send({ error: "Not found" });

    return reply.send(report);
  });

  app.get("/trips/report.pdf", auth, async (request, reply) => {
    const query = reportQuerySchema.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() });

    const userId = (request.user as any).sub;
    const report = await buildKjorebokReport(userId, query.data);
    if (!report) return reply.status(404).send({ error: "Not found" });

    const pdf = await renderKjorebokPdf(report);
    const { year, month } = query.data;
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `attachment; filename="kjorebok${periodSlug(year, month)}.pdf"`,
    );
    return reply.send(pdf);
  });

  // List trips (summary, no route)
  app.get("/trips", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    await finalizeStaleActiveTrips(userId);
    const [trips, places] = await Promise.all([
      prisma.trip.findMany({
        where: { userId },
        orderBy: { startedAt: "desc" },
        select: {
          id: true, userId: true,
          status: true, startedAt: true, endedAt: true,
          distanceMeters: true, startAddress: true, endAddress: true,
          purpose: true, mode: true, createdAt: true, updatedAt: true,
          ...tripDocumentationSelect,
          ...tripEndpointsSelect,
        },
      }),
      loadUserPlaces(userId),
    ]);
    return reply.send(trips.map((t) => attachPlaces(t, places)));
  });

  // Get single trip with route
  app.get("/trips/:id", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    await finalizeStaleActiveTrips(userId);
    const { id } = request.params as { id: string };
    const [trip, places, route] = await Promise.all([
      prisma.trip.findFirst({
        where: { id, userId },
        include: { vehicle: tripVehicleSelect },
        omit: omitLegacyRoute,
      }),
      loadUserPlaces(userId),
      loadRoute(prisma, id),
    ]);
    if (!trip) return reply.status(404).send({ error: "Not found" });
    return reply.send({ ...attachPlaces(trip, places), route });
  });

  // Start a new trip
  app.post("/trips", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    await finalizeStaleActiveTrips(userId);
    const body = startTripSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { startPoint, startAddress, vehicleId } = body.data;

    const active = await prisma.trip.findFirst({ where: { userId, status: "ACTIVE" } });
    if (active) return reply.status(409).send({ error: "An active trip already exists" });

    // Falls back to the default vehicle so a trip is attributable from the
    // moment it starts, rather than only after the user edits it afterwards.
    const vehicle = await prisma.vehicle.findFirst({
      where: vehicleId ? { id: vehicleId, userId } : { userId, isDefault: true },
      select: { id: true },
    });
    if (vehicleId && !vehicle) return reply.status(400).send({ error: "Ukjent kjøretøy" });

    const trip = await prisma.trip.create({
      data: {
        userId,
        startedAt: new Date(startPoint.timestamp),
        startAddress: startAddress ?? null,
        startLat: startPoint.lat,
        startLng: startPoint.lng,
        endLat: startPoint.lat,
        endLng: startPoint.lng,
        vehicleId: vehicle?.id ?? null,
        points: { create: [toPointRow(startPoint)] },
      },
      omit: omitLegacyRoute,
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

    const appended = await appendToActiveTrip(userId, id, [body.data.point]);
    if (!appended) return reply.status(404).send({ error: "Active trip not found" });
    return reply.send(appended.result.trip);
  });

  app.post("/trips/:id/points/batch", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    await finalizeStaleActiveTrips(userId);
    const { id } = request.params as { id: string };
    const body = addPointsBatchSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const appended = await appendToActiveTrip(userId, id, body.data.points);
    if (!appended) return reply.status(404).send({ error: "Active trip not found" });

    const { trip, acceptedPoints, lastPointTimestamp } = appended.result;
    return reply.send({
      tripId: trip.id,
      acceptedPoints,
      distanceMeters: trip.distanceMeters,
      lastPointTimestamp,
    });
  });

  // End a trip
  app.post("/trips/:id/end", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    await finalizeStaleActiveTrips(userId);
    const { id } = request.params as { id: string };
    const body = endTripSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { endPoint, endAddress } = body.data;
    const ended = await withActiveTrip(userId, id, async (tx) => {
      await insertPoints(tx, id, [endPoint]);
      const endedAt = new Date(endPoint.timestamp);
      return completeTrip(tx, id, { endedAt, endAddress: endAddress ?? null }, endedAt);
    });

    if (!ended) return reply.status(404).send({ error: "Active trip not found" });
    // Too short to count as a trip: it was deleted.
    if (!ended.result) return reply.status(204).send();
    return reply.send(ended.result);
  });

  // Update trip metadata (purpose)
  app.patch("/trips/:id", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const { id } = request.params as { id: string };
    const body = updateTripSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const trip = await prisma.trip.findFirst({ where: { id, userId } });
    if (!trip) return reply.status(404).send({ error: "Not found" });

    if (body.data.vehicleId) {
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: body.data.vehicleId, userId },
        select: { id: true },
      });
      if (!vehicle) return reply.status(400).send({ error: "Ukjent kjøretøy" });
    }

    // Compare against the values the update leaves behind, not just the ones sent.
    const odometerStart = body.data.odometerStart !== undefined ? body.data.odometerStart : trip.odometerStart;
    const odometerEnd = body.data.odometerEnd !== undefined ? body.data.odometerEnd : trip.odometerEnd;
    if (odometerStart !== null && odometerEnd !== null && odometerEnd < odometerStart) {
      return reply.status(400).send({ error: "Kilometerstand ved slutt kan ikke være lavere enn ved start" });
    }

    const updated = await prisma.trip.update({
      where: { id },
      data: body.data,
      select: {
        id: true, userId: true,
        status: true, startedAt: true, endedAt: true,
        distanceMeters: true, startAddress: true, endAddress: true,
        purpose: true, mode: true, createdAt: true, updatedAt: true,
        ...tripDocumentationSelect,
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
