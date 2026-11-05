import { prisma } from "./prisma.js";
import { lookupPoi } from "./poi.js";

/**
 * Fills in startPoi/endPoi on completed trips, in the background so ending a
 * trip never waits on OpenStreetMap. One lookup at a time keeps us well inside
 * what the public Overpass server tolerates.
 *
 * Trips that fail stay unresolved (poiResolvedAt null) and are queued again
 * the next time someone lists them; after a failure the queue rests a while
 * instead of hammering a server that is already struggling.
 */

const PAUSE_BETWEEN_LOOKUPS_MS = 1_000;
const BACKOFF_AFTER_FAILURE_MS = 5 * 60 * 1000;
/** Old trips are backfilled a few at a time, newest first. */
export const POI_BACKFILL_BATCH = 10;

const queue: string[] = [];
const queued = new Set<string>();
let running = false;
let pausedUntil = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function queuePoiLookup(tripIds: string[]): void {
  if (process.env.POI_LOOKUP === "off" || Date.now() < pausedUntil) return;

  for (const id of tripIds) {
    if (queued.has(id)) continue;
    queued.add(id);
    queue.push(id);
  }
  if (!running) void drain();
}

async function drain(): Promise<void> {
  running = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      try {
        await resolveTripPoi(id);
      } catch (error) {
        console.warn(`POI-oppslag feilet for tur ${id}:`, error instanceof Error ? error.message : error);
        // Everything still waiting is retried later, by the next listing.
        for (const rest of queue.splice(0)) queued.delete(rest);
        pausedUntil = Date.now() + BACKOFF_AFTER_FAILURE_MS;
      } finally {
        queued.delete(id);
      }
      if (queue.length > 0) await sleep(PAUSE_BETWEEN_LOOKUPS_MS);
    }
  } finally {
    running = false;
  }
}

async function resolveTripPoi(id: string): Promise<void> {
  const trip = await prisma.trip.findUnique({
    where: { id },
    select: { status: true, poiResolvedAt: true, startLat: true, startLng: true, endLat: true, endLng: true },
  });
  if (!trip || trip.status !== "COMPLETED" || trip.poiResolvedAt) return;

  const startPoi = trip.startLat != null && trip.startLng != null ? await lookupPoi(trip.startLat, trip.startLng) : null;
  if (trip.endLat != null && trip.endLng != null) await sleep(PAUSE_BETWEEN_LOOKUPS_MS);
  const endPoi = trip.endLat != null && trip.endLng != null ? await lookupPoi(trip.endLat, trip.endLng) : null;

  // updateMany: the trip may have been deleted while we were looking.
  await prisma.trip.updateMany({
    where: { id, poiResolvedAt: null },
    data: { startPoi, endPoi, poiResolvedAt: new Date() },
  });
}
