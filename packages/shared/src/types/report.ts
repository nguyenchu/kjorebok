import type { MileageAllowance, MileageRate } from "../rates";
import type { TripPurpose } from "./trip";
import type { VehicleType } from "./vehicle";

/**
 * Wire shape of `GET /trips/report` — the same report the CSV and PDF are
 * rendered from. Dates are ISO strings here; the API builds it with `Date`
 * internally and JSON serialization converts them.
 */
export interface KjorebokReportRow {
  /** The trip this row came from, so the report can edit it in place. */
  id: string;
  startedAt: string;
  endedAt: string | null;
  from: string;
  to: string;
  purpose: TripPurpose;
  purposeNote: string | null;
  client: string | null;
  registration: string | null;
  vehicleLabel: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  distanceMeters: number;
  allowance: MileageAllowance;
}

export interface KjorebokReportTotals {
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

export interface KjorebokReportResponse {
  rows: KjorebokReportRow[];
  totals: KjorebokReportTotals;
  periodLabel: string;
  owner: { name: string; email: string };
  vehicle: { label: string; registration: string; type: VehicleType } | null;
  generatedAt: string;
}
