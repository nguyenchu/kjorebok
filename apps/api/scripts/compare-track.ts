/**
 * Compares the stored distance of completed trips with what processTrack makes
 * of the same points, and both with the odometer where a trip has readings at
 * start and end. Read-only: nothing in the database is changed.
 *
 * Usage:
 *   pnpm --filter @kjorebok/api track:compare [--user <email>] [--limit <n>] [--csv <file>]
 *
 * Odometer readings are whole kilometers, so a single trip can be off by up to
 * a kilometer for that reason alone. Trust the totals and the longer trips.
 */
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.js";
import { loadTrackPoints } from "../src/lib/tripPoints.js";
import { processTrack } from "../src/lib/track/index.js";

/** Below this many odometer kilometers the rounding swamps any difference. */
const MIN_ODOMETER_KM_FOR_PERCENT = 5;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

interface Row {
  id: string;
  date: string;
  user: string;
  points: number;
  rejected: number;
  storedKm: number;
  rawKm: number;
  newKm: number;
  odometerKm: number | null;
  oldMode: string;
  newMode: string;
}

const km = (meters: number) => meters / 1000;
const fmt = (value: number | null, digits = 1) => (value === null ? "—" : value.toFixed(digits));
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]) => (values.length === 0 ? 0 : sum(values) / values.length);
const pct = (value: number, of: number) => (of === 0 ? "—" : `${(((value - of) / of) * 100).toFixed(1)} %`);

async function main() {
  const email = argument("user");
  const limit = argument("limit");
  const csvPath = argument("csv");

  const trips = await prisma.trip.findMany({
    where: { status: "COMPLETED", ...(email ? { user: { email } } : {}) },
    orderBy: { startedAt: "desc" },
    take: limit ? Number(limit) : undefined,
    select: {
      id: true,
      startedAt: true,
      distanceMeters: true,
      odometerStart: true,
      odometerEnd: true,
      mode: true,
      user: { select: { email: true } },
    },
  });

  const rows: Row[] = [];
  for (const trip of trips) {
    const result = processTrack(await loadTrackPoints(prisma, trip.id));
    const odometerKm =
      trip.odometerStart !== null && trip.odometerEnd !== null && trip.odometerEnd >= trip.odometerStart
        ? trip.odometerEnd - trip.odometerStart
        : null;
    rows.push({
      id: trip.id,
      date: trip.startedAt.toISOString().slice(0, 16).replace("T", " "),
      user: trip.user.email,
      points: result.inputPointCount,
      rejected: result.rejectedPointCount,
      storedKm: km(trip.distanceMeters),
      rawKm: km(result.rawDistanceMeters),
      newKm: km(result.distanceMeters),
      odometerKm,
      oldMode: trip.mode,
      newMode: result.mode,
    });
  }

  console.log(
    ["Dato".padEnd(16), "Punkter".padStart(8), "Avvist".padStart(7), "Lagret".padStart(8), "Rå".padStart(8),
      "Ny".padStart(8), "Km-stand".padStart(9), "Modus"].join("  "),
  );
  for (const row of rows) {
    console.log(
      [row.date.padEnd(16), String(row.points).padStart(8), String(row.rejected).padStart(7),
        fmt(row.storedKm).padStart(8), fmt(row.rawKm).padStart(8), fmt(row.newKm).padStart(8),
        fmt(row.odometerKm, 0).padStart(9),
        row.oldMode === row.newMode ? row.newMode : `${row.oldMode} → ${row.newMode}`].join("  "),
    );
  }

  const totalStored = sum(rows.map((r) => r.storedKm));
  const totalNew = sum(rows.map((r) => r.newKm));
  console.log(`\n${rows.length} turer. Lagret ${fmt(totalStored)} km, ny metode ${fmt(totalNew)} km (${pct(totalNew, totalStored)}).`);
  console.log(`Modus endres på ${rows.filter((r) => r.oldMode !== r.newMode).length} turer.`);

  const withOdometer = rows.filter((r): r is Row & { odometerKm: number } => r.odometerKm !== null);
  if (withOdometer.length === 0) {
    console.log("Ingen turer har kilometerstand både ved start og slutt, så det er ingen fasit å sammenligne med.");
  } else {
    const odometer = sum(withOdometer.map((r) => r.odometerKm));
    const stored = sum(withOdometer.map((r) => r.storedKm));
    const fresh = sum(withOdometer.map((r) => r.newKm));
    console.log(`\nMot kilometerstand (${withOdometer.length} turer, ${odometer} km):`);
    console.log(`  Lagret:     ${fmt(stored)} km (${pct(stored, odometer)})`);
    console.log(`  Ny metode:  ${fmt(fresh)} km (${pct(fresh, odometer)})`);

    const long = withOdometer.filter((r) => r.odometerKm >= MIN_ODOMETER_KM_FOR_PERCENT);
    if (long.length > 0) {
      const error = (value: number, truth: number) => Math.abs(value - truth) / truth;
      console.log(`  Snittavvik per tur på ${long.length} turer ≥ ${MIN_ODOMETER_KM_FOR_PERCENT} km:`);
      console.log(`    lagret ${(mean(long.map((r) => error(r.storedKm, r.odometerKm))) * 100).toFixed(1)} %,` +
        ` ny metode ${(mean(long.map((r) => error(r.newKm, r.odometerKm))) * 100).toFixed(1)} %`);
    }
  }

  if (csvPath) {
    const header = "id,dato,bruker,punkter,avvist,lagret_km,raa_km,ny_km,kmstand_km,modus_lagret,modus_ny";
    const lines = rows.map((r) =>
      [r.id, r.date, r.user, r.points, r.rejected, r.storedKm.toFixed(3), r.rawKm.toFixed(3), r.newKm.toFixed(3),
        r.odometerKm ?? "", r.oldMode, r.newMode].join(","),
    );
    writeFileSync(csvPath, [header, ...lines].join("\n") + "\n");
    console.log(`\nSkrev ${rows.length} rader til ${csvPath}.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
