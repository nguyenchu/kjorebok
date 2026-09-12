/**
 * Renders a sample kjørebok PDF with synthetic trips, for eyeballing layout.
 * Usage:
 *   pnpm --filter @kjorebok/api exec tsx scripts/render-report-sample.ts <out.pdf>
 *   pnpm --filter @kjorebok/api exec tsx scripts/render-report-sample.ts --all <out.pdf>
 */
import { writeFileSync } from "node:fs";
import { calculateAllowance } from "../src/lib/rates.js";
import { renderKjorebokPdf, summarizeRows, type KjorebokRow } from "../src/lib/kjorebokReport.js";
import { periodLabel } from "../src/lib/period.js";

const PLACES = ["Hjem", "Kontoret", "Byggeplass Løren", "Kunde: Bjørnsen AS", "Lager Alnabru", "Åsvegen 12"];
const PURPOSES = ["Kundemøte", "Befaring", "Levering av materiell", "Serviceoppdrag", null];
const CLIENTS = ["Bjørnsen AS", "Oslo Kommune", "Nordvik Bygg", null];
const allVehicles = process.argv.includes("--all");

const rows: KjorebokRow[] = [];
let odometer = 84_120;

for (let i = 0; i < 34; i++) {
  const day = 1 + Math.floor(i / 2);
  const startedAt = new Date(Date.UTC(2026, 2, day, 8 + (i % 2) * 3, (i * 7) % 60));
  const distanceMeters = 4_000 + ((i * 3_137) % 62_000);
  const endedAt = new Date(startedAt.getTime() + (distanceMeters / 1000 / 60) * 3_600_000);
  const isWork = i % 5 !== 0;

  const odometerStart = odometer;
  // Every seventh trip gets a deliberately wrong odometer, to exercise the mismatch note.
  const logged = Math.round(distanceMeters / 1000) + (i % 7 === 0 ? 45 : 0);
  odometer += logged;

  rows.push({
    startedAt,
    endedAt,
    from: PLACES[i % PLACES.length],
    to: PLACES[(i + 2) % PLACES.length],
    purpose: isWork ? "WORK" : "PRIVATE",
    purposeNote: isWork ? PURPOSES[i % PURPOSES.length] : null,
    client: isWork ? CLIENTS[i % CLIENTS.length] : null,
    registration: allVehicles && i % 3 === 0 ? "VH 39127" : "EL 48291",
    vehicleLabel: allVehicles && i % 3 === 0 ? "Kundebilen" : "Varebilen",
    // A couple of trips have no odometer at all.
    odometerStart: i % 11 === 3 ? null : odometerStart,
    odometerEnd: i % 11 === 3 ? null : odometer,
    distanceMeters,
    allowance: calculateAllowance(distanceMeters, 2026),
  });
}

rows.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

const out = process.argv.find((arg) => arg.endsWith(".pdf")) ?? "sample.pdf";
const pdf = await renderKjorebokPdf({
  rows,
  totals: summarizeRows(rows),
  periodLabel: periodLabel(2026, 3),
  owner: { name: "Nguyen Chu", email: "post@example.no" },
  vehicle: allVehicles ? null : { label: "Varebilen", registration: "EL 48291", type: "WORK" },
  generatedAt: new Date(),
});

writeFileSync(out, pdf);
console.log(`Wrote ${out} (${(pdf.length / 1024).toFixed(1)} kB, ${rows.length} trips)`);
