import PDFDocument from "pdfkit";
import type { MileageAllowance, MileageRate, VehicleType } from "@kjorebok/shared";

/**
 * One trip as it appears in a report. Built once in the route and then rendered
 * to both CSV and PDF, so the two formats can never disagree about a number.
 */
export interface KjorebokRow {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  from: string;
  to: string;
  purpose: "PRIVATE" | "WORK";
  purposeNote: string | null;
  client: string | null;
  registration: string | null;
  vehicleLabel: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  distanceMeters: number;
  allowance: MileageAllowance;
}

export interface KjorebokTotals {
  tripCount: number;
  workTripCount: number;
  workKm: number;
  privateKm: number;
  gross: number;
  taxFree: number;
  taxable: number;
  /** True if any rate the report leans on is not confirmed against Skatteetaten. */
  unverifiedRate: boolean;
  ratesUsed: MileageRate[];
  /** Trips where the odometer delta disagrees with the tracked distance. */
  odometerMismatches: number;
  /** Work trips with no stated formål — incomplete as godtgjørelse documentation. */
  missingPurpose: number;
}

export interface KjorebokReport {
  rows: KjorebokRow[];
  totals: KjorebokTotals;
  periodLabel: string;
  owner: { name: string; email: string };
  vehicle: { label: string; registration: string; type: VehicleType } | null;
  generatedAt: Date;
}

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  PRIVATE: "Privatbil",
  COMPANY: "Firmabil",
  WORK: "Yrkesbil",
};

/** Odometer and GPS never match exactly; flag only a real disagreement. */
function hasOdometerMismatch(row: KjorebokRow): boolean {
  if (row.odometerStart === null || row.odometerEnd === null) return false;
  const logged = row.odometerEnd - row.odometerStart;
  const tracked = row.distanceMeters / 1000;
  return Math.abs(logged - tracked) > Math.max(2, tracked * 0.1);
}

export function summarizeRows(rows: KjorebokRow[]): KjorebokTotals {
  const totals: KjorebokTotals = {
    tripCount: rows.length,
    workTripCount: 0,
    workKm: 0,
    privateKm: 0,
    gross: 0,
    taxFree: 0,
    taxable: 0,
    unverifiedRate: false,
    ratesUsed: [],
    odometerMismatches: 0,
    missingPurpose: 0,
  };

  const seenYears = new Set<number>();

  for (const row of rows) {
    if (hasOdometerMismatch(row)) totals.odometerMismatches += 1;

    if (row.purpose !== "WORK") {
      totals.privateKm += row.allowance.km;
      continue;
    }

    // Kjøregodtgjørelse gjelder bare yrkeskjøring.
    totals.workTripCount += 1;
    if (!row.purposeNote) totals.missingPurpose += 1;
    totals.workKm += row.allowance.km;
    totals.gross += row.allowance.gross;
    totals.taxFree += row.allowance.taxFree;

    if (!seenYears.has(row.allowance.rate.year)) {
      seenYears.add(row.allowance.rate.year);
      totals.ratesUsed.push(row.allowance.rate);
    }
    if (!row.allowance.rate.verified) totals.unverifiedRate = true;
  }

  totals.workKm = round2(totals.workKm);
  totals.privateKm = round2(totals.privateKm);
  totals.gross = round2(totals.gross);
  totals.taxFree = round2(totals.taxFree);
  totals.taxable = round2(totals.gross - totals.taxFree);
  totals.ratesUsed.sort((a, b) => a.year - b.year);

  return totals;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const UNVERIFIED_RATE_NOTICE =
  "Satsene i denne rapporten er ikke bekreftet mot Skatteetatens gjeldende satser.";

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export function renderKjorebokCsv(report: KjorebokReport): string {
  const { rows, totals } = report;

  const body = rows.map((row) => [
    formatDate(row.startedAt),
    formatTime(row.startedAt),
    row.endedAt ? formatTime(row.endedAt) : "",
    row.registration ?? "",
    row.vehicleLabel ?? "",
    row.from,
    row.to,
    row.purpose === "WORK" ? "Jobb" : "Privat",
    row.purposeNote ?? (row.purpose === "WORK" ? "MANGLER FORMÅL" : ""),
    row.client ?? "",
    row.odometerStart ?? "",
    row.odometerEnd ?? "",
    row.allowance.km.toFixed(2),
    row.purpose === "WORK" ? row.allowance.rate.stateRate.toFixed(2) : "",
    row.purpose === "WORK" ? row.allowance.gross.toFixed(2) : "",
  ]);

  const blank = () => [] as (string | number)[];
  const total = (label: string, value: string) => [
    label, "", "", "", "", "", "", "", "", "", "", "", "", "", value,
  ];

  const table: (string | number)[][] = [
    [
      "Dato", "Starttid", "Sluttid", "Regnr", "Bil", "Fra", "Til", "Type",
      "Formål", "Oppdragsgiver", "Km-stand start", "Km-stand slutt",
      "Distanse (km)", "Sats (kr/km)", "Godtgjørelse (kr)",
    ],
    ...body,
    blank(),
    ["Sum yrkeskjøring", "", "", "", "", "", "", "", "", "", "", "",
      totals.workKm.toFixed(2), "", totals.gross.toFixed(2)],
    total("Herav skattefritt", totals.taxFree.toFixed(2)),
    total("Herav skattepliktig", totals.taxable.toFixed(2)),
  ];

  if (totals.unverifiedRate) table.push(blank(), [`Merk: ${UNVERIFIED_RATE_NOTICE}`]);

  const csv = table
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  return "﻿" + csv; // BOM so Excel reads it as UTF-8
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const PAGE_MARGIN = 36;
const INK = "#111111";
const MUTED = "#6b7280";
const RULE = "#d4d4d8";
const BAND = "#f4f4f5";
const AMBER = "#b45309";

interface Column {
  key: keyof KjorebokRow | "time" | "km";
  label: string;
  width: number;
  align?: "left" | "right";
}

function columnsFor(showVehicle: boolean): Column[] {
  const base: Column[] = [
    { key: "startedAt", label: "Dato", width: 58 },
    { key: "time", label: "Tid", width: 76 },
    { key: "from", label: "Fra", width: 100 },
    { key: "to", label: "Til", width: 100 },
    { key: "purposeNote", label: "Formål", width: showVehicle ? 108 : 140 },
    { key: "client", label: "Oppdragsgiver", width: showVehicle ? 92 : 112 },
    { key: "odometerStart", label: "Km start", width: 62, align: "right" },
    { key: "odometerEnd", label: "Km slutt", width: 62, align: "right" },
    { key: "km", label: "Km", width: 48, align: "right" },
  ];
  if (showVehicle) base.splice(2, 0, { key: "registration", label: "Regnr", width: 62 });
  return base;
}

export function renderKjorebokPdf(report: KjorebokReport): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: PAGE_MARGIN,
    bufferPages: true, // so "Side x av y" can be stamped once the count is known
    info: {
      Title: `Kjørebok ${report.periodLabel}`,
      Author: report.owner.name,
      Subject: "Kjørebok for kjøregodtgjørelse og skattedokumentasjon",
    },
  });

  const done = collect(doc);
  const columns = columnsFor(report.vehicle === null);
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

  drawHeader(doc, report);
  let y = doc.y + 12;
  y = drawTableHeader(doc, columns, y);

  const bottom = doc.page.height - PAGE_MARGIN - 28;
  for (const [index, row] of report.rows.entries()) {
    if (y + 18 > bottom) {
      doc.addPage();
      y = drawTableHeader(doc, columns, PAGE_MARGIN);
    }
    y = drawRow(doc, columns, row, y, index % 2 === 1);
  }

  if (report.rows.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(MUTED)
      .text("Ingen turer i perioden.", PAGE_MARGIN, y + 8);
    y += 24;
  }

  drawTotals(doc, report, y, tableWidth, bottom);
  stampFooters(doc, report);

  doc.end();
  return done;
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function drawHeader(doc: PDFKit.PDFDocument, report: KjorebokReport) {
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK)
    .text("Kjørebok", PAGE_MARGIN, PAGE_MARGIN);
  doc.font("Helvetica").fontSize(11).fillColor(MUTED)
    .text(report.periodLabel, PAGE_MARGIN, doc.y + 2);

  const right = doc.page.width - PAGE_MARGIN - 240;
  let top = PAGE_MARGIN;

  const line = (label: string, value: string) => {
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED)
      .text(label, right, top, { width: 70 });
    doc.font("Helvetica").fontSize(9).fillColor(INK)
      .text(value, right + 74, top, { width: 166, lineBreak: false, ellipsis: true });
    top += 13;
  };

  line("Fører", report.owner.name);
  line("E-post", report.owner.email);
  if (report.vehicle) {
    line("Kjøretøy", `${report.vehicle.label} · ${report.vehicle.registration}`);
    line("Type", VEHICLE_TYPE_LABELS[report.vehicle.type]);
  } else {
    line("Kjøretøy", "Alle");
  }

  doc.y = Math.max(doc.y, top);
}

function drawTableHeader(doc: PDFKit.PDFDocument, columns: Column[], y: number): number {
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
  let x = PAGE_MARGIN;
  for (const column of columns) {
    doc.text(column.label.toUpperCase(), x, y, {
      width: column.width - 6,
      align: column.align ?? "left",
      lineBreak: false,
      ellipsis: true,
    });
    x += column.width;
  }
  const bottom = y + 13;
  doc.moveTo(PAGE_MARGIN, bottom).lineTo(x, bottom).strokeColor(RULE).lineWidth(0.8).stroke();
  return bottom + 5;
}

function drawRow(
  doc: PDFKit.PDFDocument,
  columns: Column[],
  row: KjorebokRow,
  y: number,
  shaded: boolean,
): number {
  const height = 16;
  const width = columns.reduce((sum, column) => sum + column.width, 0);

  if (shaded) {
    doc.rect(PAGE_MARGIN, y - 3, width, height).fillColor(BAND).fill();
  }

  let x = PAGE_MARGIN;
  for (const column of columns) {
    const flagged = column.key === "purposeNote" && row.purpose === "WORK" && !row.purposeNote;
    doc.font("Helvetica").fontSize(8.5).fillColor(flagged ? AMBER : INK);
    doc.text(cellText(row, column), x, y, {
      width: column.width - 6,
      align: column.align ?? "left",
      lineBreak: false,
      ellipsis: true,
    });
    x += column.width;
  }

  return y + height;
}

function cellText(row: KjorebokRow, column: Column): string {
  switch (column.key) {
    case "startedAt":
      return formatDate(row.startedAt);
    case "time":
      return row.endedAt
        ? `${formatTime(row.startedAt)}–${formatTime(row.endedAt)}`
        : formatTime(row.startedAt);
    case "km":
      return formatNumber(row.allowance.km);
    case "purposeNote":
      // A private trip needs no stated purpose; a work trip does, so a hole
      // there is flagged rather than shown as an unremarkable "—".
      return row.purposeNote ?? (row.purpose === "WORK" ? "Mangler formål" : "Privat");
    case "odometerStart":
      return row.odometerStart?.toLocaleString("nb-NO") ?? "—";
    case "odometerEnd":
      return row.odometerEnd?.toLocaleString("nb-NO") ?? "—";
    default: {
      const value = row[column.key as keyof KjorebokRow];
      return value === null || value === undefined ? "—" : String(value);
    }
  }
}

function drawTotals(
  doc: PDFKit.PDFDocument,
  report: KjorebokReport,
  y: number,
  tableWidth: number,
  bottom: number,
) {
  const { totals } = report;
  const boxHeight = 92;

  if (y + boxHeight > bottom) {
    doc.addPage();
    y = PAGE_MARGIN;
  }

  const top = y + 8;
  doc.moveTo(PAGE_MARGIN, top).lineTo(PAGE_MARGIN + tableWidth, top)
    .strokeColor(INK).lineWidth(1).stroke();

  const labelX = PAGE_MARGIN;
  const valueX = PAGE_MARGIN + 210;
  let line = top + 10;

  const entry = (label: string, value: string, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(bold ? INK : MUTED)
      .text(label, labelX, line, { width: 200 });
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(INK)
      .text(value, valueX, line, { width: 130, align: "right" });
    line += 14;
  };

  entry("Turer i perioden", `${totals.tripCount}`);
  entry("Herav yrkeskjøring", `${totals.workTripCount}`);
  entry("Sum yrkeskjøring", `${formatNumber(totals.workKm)} km`, true);
  entry("Kjøregodtgjørelse", `${formatNumber(totals.gross)} kr`, true);
  entry("Herav skattefritt", `${formatNumber(totals.taxFree)} kr`);
  entry("Herav skattepliktig", `${formatNumber(totals.taxable)} kr`);

  // Notes column, to the right of the totals.
  const noteX = PAGE_MARGIN + 380;
  let noteY = top + 10;
  const note = (text: string, color = MUTED) => {
    doc.font("Helvetica").fontSize(8.5).fillColor(color)
      .text(text, noteX, noteY, { width: tableWidth - 390 });
    noteY = doc.y + 4;
  };

  if (totals.ratesUsed.length > 0) {
    const rates = totals.ratesUsed
      .map((rate) => `${rate.year}: ${formatNumber(rate.stateRate)} kr/km (skattefritt ${formatNumber(rate.taxFreeRate)})`)
      .join(" · ");
    note(`Satser lagt til grunn — ${rates}`);
  }
  if (totals.privateKm > 0) {
    note(`Privatkjøring i perioden: ${formatNumber(totals.privateKm)} km. Gir ikke godtgjørelse.`);
  }
  if (totals.missingPurpose > 0) {
    note(
      `${totals.missingPurpose} ${totals.missingPurpose === 1 ? "yrkestur mangler" : "yrkesturer mangler"} ` +
        "formål — ufullstendig som dokumentasjon for godtgjørelse.",
      AMBER,
    );
  }
  if (totals.odometerMismatches > 0) {
    note(
      `${totals.odometerMismatches} ${totals.odometerMismatches === 1 ? "tur har" : "turer har"} ` +
        "avvik mellom oppgitt kilometerstand og målt distanse.",
      AMBER,
    );
  }
  if (totals.unverifiedRate) {
    note(`Merk: ${UNVERIFIED_RATE_NOTICE}`, AMBER);
  }
}

function stampFooters(doc: PDFKit.PDFDocument, report: KjorebokReport) {
  const range = doc.bufferedPageRange();
  const generated = `${formatDate(report.generatedAt)} ${formatTime(report.generatedAt)}`;

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - PAGE_MARGIN - 10;
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    doc.text(`Generert ${generated}`, PAGE_MARGIN, y, { width: 300, lineBreak: false });
    doc.text(
      `Side ${i - range.start + 1} av ${range.count}`,
      doc.page.width - PAGE_MARGIN - 120,
      y,
      { width: 120, align: "right", lineBreak: false },
    );
  }
}

// ---------------------------------------------------------------------------

const ZONE = "Europe/Oslo";

function formatDate(date: Date): string {
  return date.toLocaleDateString("nb-NO", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: ZONE,
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit", timeZone: ZONE });
}

function formatNumber(value: number): string {
  return value.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
