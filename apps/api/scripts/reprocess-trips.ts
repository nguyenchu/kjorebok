/**
 * Recomputes distance, mode and the other derived columns of completed trips
 * from their stored points, for trips processed with an older version of
 * processTrack (or never processed). Overwrites distanceMeters and mode, which
 * changes reports for periods already exported.
 *
 * Usage:
 *   pnpm --filter @kjorebok/api track:reprocess [--apply] [--all] [--user <email>]
 *
 * Without --apply nothing is written; the script only shows what would change.
 * --all also redoes trips already at the current version.
 */
import { prisma } from "../src/lib/prisma.js";
import { TRACK_PROCESSING_VERSION } from "../src/lib/track/index.js";
import { processTripPoints, trackColumns } from "../src/lib/tripPoints.js";

/** With fewer points there is nothing to measure, so the stored values are kept. */
const MIN_POINTS = 2;

const apply = process.argv.includes("--apply");
const all = process.argv.includes("--all");
const userIndex = process.argv.indexOf("--user");
const email = userIndex === -1 ? undefined : process.argv[userIndex + 1];

const km = (meters: number) => (meters / 1000).toFixed(2);

async function main() {
  const trips = await prisma.trip.findMany({
    where: {
      status: "COMPLETED",
      ...(all
        ? {}
        : { OR: [{ processingVersion: null }, { processingVersion: { lt: TRACK_PROCESSING_VERSION } }] }),
      ...(email ? { user: { email } } : {}),
    },
    orderBy: { startedAt: "asc" },
    select: { id: true, startedAt: true, distanceMeters: true, mode: true },
  });

  console.log(`${apply ? "Oppdaterer" : "Tørrkjøring:"} ${trips.length} turer (versjon ${TRACK_PROCESSING_VERSION}).\n`);

  let before = 0;
  let after = 0;
  let skipped = 0;
  let modeChanges = 0;
  let belowMinimum = 0;

  for (const trip of trips) {
    const track = await processTripPoints(prisma, trip.id);
    const date = trip.startedAt.toISOString().slice(0, 16).replace("T", " ");

    if (track.inputPointCount < MIN_POINTS) {
      skipped++;
      console.log(`${date}  ${km(trip.distanceMeters)} km  hoppet over: ${track.inputPointCount} punkter`);
      continue;
    }

    before += trip.distanceMeters;
    after += track.distanceMeters;
    if (track.mode !== trip.mode) modeChanges++;
    if (track.distanceMeters < 50) belowMinimum++;

    const mode = track.mode === trip.mode ? track.mode : `${trip.mode} → ${track.mode}`;
    console.log(`${date}  ${km(trip.distanceMeters)} → ${km(track.distanceMeters)} km  ${mode}`);

    if (apply) {
      await prisma.trip.update({ where: { id: trip.id }, data: trackColumns(track, true) });
    }
  }

  console.log(`\nTotalt ${km(before)} → ${km(after)} km. Modus endres på ${modeChanges} turer.`);
  if (skipped > 0) console.log(`${skipped} turer uten nok punkter ble ikke rørt.`);
  if (belowMinimum > 0) {
    console.log(`${belowMinimum} turer blir under 50 m. De beholdes, men ville ikke blitt lagret som nye turer.`);
  }
  if (!apply) console.log("Ingenting er endret. Kjør med --apply for å lagre.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
