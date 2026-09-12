import type { MileageAllowance, MileageRate } from "@kjorebok/shared";

/**
 * Satser for kjøregodtgjørelse, per inntektsår.
 *
 * Satsene fastsettes årlig. Legg inn nytt år her ved årsskiftet, og sett
 * `verified: true` først når tallet er kontrollert mot kilden. Rapporter merkes
 * som uverifiserte så lenge satsen de bygger på har `verified: false`.
 *
 * Kilder som må sjekkes:
 *   https://www.skatteetaten.no/satser/kilometergodtgjorelse-bil/
 *   Statens reiseregulativ (regjeringen.no)
 */
export const MILEAGE_RATES: readonly MileageRate[] = [
  { year: 2023, stateRate: 4.48, taxFreeRate: 3.5, passengerRate: 1.0, verified: false },
  { year: 2024, stateRate: 4.9, taxFreeRate: 3.5, passengerRate: 1.0, verified: false },
  { year: 2025, stateRate: 5.0, taxFreeRate: 3.5, passengerRate: 1.0, verified: false },
  { year: 2026, stateRate: 5.0, taxFreeRate: 3.5, passengerRate: 1.0, verified: false },
];

/** Nearest rate at or before `year`, so an unregistered year never breaks a report. */
export function getMileageRate(year: number): MileageRate {
  const candidates = MILEAGE_RATES.filter((rate) => rate.year <= year);
  const match = candidates.length > 0 ? candidates[candidates.length - 1] : MILEAGE_RATES[0];
  return match.year === year ? match : { ...match, year, verified: false };
}

export function calculateAllowance(distanceMeters: number, year: number): MileageAllowance {
  const rate = getMileageRate(year);
  const km = distanceMeters / 1000;
  const gross = round2(km * rate.stateRate);
  const taxFree = round2(km * rate.taxFreeRate);
  return { km: round2(km), rate, gross, taxFree, taxable: round2(gross - taxFree) };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
