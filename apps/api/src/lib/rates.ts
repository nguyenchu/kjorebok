import type { MileageAllowance, MileageRate } from "@kjorebok/shared";

/**
 * Satser for kjøregodtgjørelse, per inntektsår.
 *
 * Satsene fastsettes årlig. Legg inn nytt år her ved årsskiftet, og sett
 * `verified: true` først når tallet er kontrollert mot kilden. Rapporter merkes
 * som uverifiserte så lenge satsen de bygger på har `verified: false`.
 *
 * `stateRate` kommer fra særavtalen om reise innenlands (Statens
 * personalhåndbok), `taxFreeRate` og `passengerRate` fra Skattedirektoratets
 * satsforskrift § 4. Begge må sjekkes — de endres uavhengig av hverandre, og
 * differansen mellom dem er nettopp den skattepliktige delen.
 *
 * Kilder per år (kontrollert 2026-09-14):
 *   2023  særavtale fra 1.1.2023 · forskrift 2022-11-22-2002 § 4
 *   2024  PM-2023-16 · forskrift 2023-11-24-1905 § 4
 *   2025  PM-2024-22 · forskrift 2024-11-27-2889 § 4
 *   2026  særavtale 1.1.2026–31.12.2027 § 6 · forskrift 2025-11-07-2216 § 4
 *
 * 2027 er bevisst ikke lagt inn: særavtalen dekker året med kr 5,30, men
 * satsforskriften for 2027 kommer først høsten 2026, så den skattefrie delen
 * er ukjent. `getMileageRate` faller da tilbake til 2026 og merker året
 * uverifisert, som er riktigere enn å gjette.
 */
export const MILEAGE_RATES: readonly MileageRate[] = [
  { year: 2023, stateRate: 4.48, taxFreeRate: 3.5, passengerRate: 1.0, verified: true },
  { year: 2024, stateRate: 4.9, taxFreeRate: 3.5, passengerRate: 1.0, verified: true },
  { year: 2025, stateRate: 5.0, taxFreeRate: 3.5, passengerRate: 1.0, verified: true },
  { year: 2026, stateRate: 5.3, taxFreeRate: 3.5, passengerRate: 1.0, verified: true },
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
