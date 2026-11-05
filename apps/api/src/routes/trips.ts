import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client/index.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import type { Place } from "@kjorebok/shared";
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
import { POI_BACKFILL_BATCH, queuePoiLookup } from "../lib/tripPoi.js";
import {
  insertPoints,
  loadRoute,
  processTripPoints,
  toPointRow,
  trackColumns,
  trackToRoute,
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

const tripMetricsSelect = {
  rawDistanceMeters: true,
  maxSpeedKmh: true,
  avgMovingSpeedKmh: true,
  movingSeconds: true,
  stoppedSeconds: true,
  pointCount: true,
} as const;

const MIN_TRIP_DISTANCE_METERS = 50;
const STALE_ACTIVE_TRIP_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Never sent as stored: the legacy JSON route is obsolete, and the map line is
 * sent as `route` only by the single-trip endpoint.
 */
const omitStoredGeometry = { route: true, track: true } as const;

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
  const track = await processTripPoints(tx, tripId);

  // Measured on the processed track, so a phone that only wandered around a
  // parking space does not leave a trip behind.
  if (track.distanceMeters < MIN_TRIP_DISTANCE_METERS) {
    await tx.trip.delete({ where: { id: tripId } });
    return null;
  }

  const last = track.line[track.line.length - 1];
  return tx.trip.update({
    where: { id: tripId },
    data: {
      endedAt: last ? new Date(last.timestamp) : fallbackEndedAt,
      ...data,
      ...trackColumns(track, true),
      status: "COMPLETED",
    },
    omit: omitStoredGeometry,
  });
}

/** Stores fixes on the user's active trip and refreshes its live figures. */
async function appendToActiveTrip(userId: string, tripId: string, points: IncomingPoint[]) {
  return withActiveTrip(userId, tripId, async (tx) => {
    const acceptedPoints = await insertPoints(tx, tripId, points);
    const track = await processTripPoints(tx, tripId);
    const trip = await tx.trip.update({
      where: { id: tripId },
      data: trackColumns(track, false),
      omit: omitStoredGeometry,
    });
    return {
      trip,
      acceptedPoints,
      lastPointTimestamp: track.line[track.line.length - 1]?.timestamp ?? null,
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

/** Queues POI lookups for the user's newest completed trips that have none yet. */
async function backfillTripPois(userId: string): Promise<void> {
  const pending = await prisma.trip.findMany({
    where: { userId, status: "COMPLETED", poiResolvedAt: null },
    orderBy: { startedAt: "desc" },
    take: POI_BACKFILL_BATCH,
    select: { id: true },
  });
  queuePoiLookup(pending.map((trip) => trip.id));
}

/** "Kiwi Storo (Vitaminveien 1, 0485 Oslo)": the name reads well, the address documents. */
function reportEndpoint(place: Place | null, poi: string | null, address: string | null): string {
  if (place) return place.label;
  if (poi && address) return `${poi} (${address})`;
  return poi ?? address ?? "—";
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
        startPoi: true, endPoi: true,
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
      from: reportEndpoint(enriched.startPlace, enriched.startPoi, enriched.startAddress),
      to: reportEndpoint(enriched.endPlace, enriched.endPoi, enriched.endAddress),
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
          startPoi: true, endPoi: true,
          purpose: true, mode: true, createdAt: true, updatedAt: true,
          ...tripDocumentationSelect,
          ...tripEndpointsSelect,
          ...tripMetricsSelect,
        },
      }),
      loadUserPlaces(userId),
    ]);
    void backfillTripPois(userId).catch((error) => request.log.warn({ err: error }, "POI-backfill feilet"));
    return reply.send(trips.map((t) => attachPlaces(t, places)));
  });

  // Get single trip with route
  app.get("/trips/:id", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    await finalizeStaleActiveTrips(userId);
    const { id } = request.params as { id: string };
    const [stored, places] = await Promise.all([
      prisma.trip.findFirst({
        where: { id, userId },
        include: { vehicle: tripVehicleSelect },
        omit: { route: true },
      }),
      loadUserPlaces(userId),
    ]);
    if (!stored) return reply.status(404).send({ error: "Not found" });
    if (stored.status === "COMPLETED" && !stored.poiResolvedAt) queuePoiLookup([stored.id]);

    // A processed trip draws its smoothed line; one still running, its raw fixes.
    const { track, ...trip } = stored;
    const route = trackToRoute(track) ?? (await loadRoute(prisma, id));
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
      omit: omitStoredGeometry,
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
    queuePoiLookup([ended.result.id]);
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
        startPoi: true, endPoi: true,
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
