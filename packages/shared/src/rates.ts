/**
 * Typer for kjøregodtgjørelse. Selve satstabellen ligger i API-et
 * (`apps/api/src/lib/rates.ts`) og eksponeres på `GET /rates`, slik at nye
 * satser kan rulles ut uten å bygge web- og mobilappen på nytt.
 *
 * Denne pakken holdes bevisst type-only: API-et kompileres til `dist` og kjører
 * med `node`, som ikke kan laste TypeScript-kilden herfra.
 */
export interface MileageRate {
  year: number;
  /** Statens sats etter reiseregulativet — det arbeidsgiver kan utbetale. */
  stateRate: number;
  /** Skatteetatens skattefrie sats. Differansen mot stateRate er skattepliktig. */
  taxFreeRate: number;
  /** Tillegg per passasjer per km. */
  passengerRate: number;
  /** False inntil satsen er kontrollert mot Skatteetaten for det året. */
  verified: boolean;
}

export interface MileageAllowance {
  km: number;
  rate: MileageRate;
  /** Det arbeidsgiver kan utbetale totalt. */
  gross: number;
  /** Den skattefrie delen. */
  taxFree: number;
  /** Den skattepliktige delen (gross - taxFree). */
  taxable: number;
}
