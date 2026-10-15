/**
 * Recomputes distance and the other derived columns of completed trips from
 * their stored points, for trips processed with an older version of
 * processTrack (or never processed). Overwrites distanceMeters, which changes
 * reports for periods already exported.
 *
 * Mode is left alone: users set it by hand, and nothing records which trips
 * they changed, so a recomputed mode could undo their correction.
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

/**
 * With fewer usable points there is nothing to measure, so the stored values
 * are kept. Counted after processTrack has dropped invalid fixes: a trip whose
 * every fix was rejected would otherwise be overwritten with 0 km.
 */
const MIN_USED_POINTS = 2;

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
    select: { id: true, startedAt: true, distanceMeters: true },
  });

  console.log(`${apply ? "Oppdaterer" : "Tørrkjøring:"} ${trips.length} turer (versjon ${TRACK_PROCESSING_VERSION}).\n`);

  let before = 0;
  let after = 0;
  let skipped = 0;
  let belowMinimum = 0;

  for (const trip of trips) {
    const track = await processTripPoints(prisma, trip.id);
    const date = trip.startedAt.toISOString().slice(0, 16).replace("T", " ");

    if (track.usedPointCount < MIN_USED_POINTS) {
      skipped++;
      console.log(
        `${date}  ${km(trip.distanceMeters)} km  hoppet over: ${track.usedPointCount} av ${track.inputPointCount} punkter brukbare`,
      );
      continue;
    }

    before += trip.distanceMeters;
    after += track.distanceMeters;
    if (track.distanceMeters < 50) belowMinimum++;

    console.log(`${date}  ${km(trip.distanceMeters)} → ${km(track.distanceMeters)} km`);

    if (apply) {
      const { mode: _mode, ...columns } = trackColumns(track, true);
      await prisma.trip.update({ where: { id: trip.id }, data: columns });
    }
  }

  console.log(`\nTotalt ${km(before)} → ${km(after)} km. Turtype endres ikke.`);
  if (skipped > 0) console.log(`${skipped} turer uten nok brukbare punkter ble ikke rørt.`);
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
