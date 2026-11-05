/**
 * Ukeberegninger som deles av web- og mobilappen.
 *
 * Dette er kjørbar kode, ikke bare typer, og eksponeres derfor på en egen
 * inngang (`@kjorebok/shared/week`) i stedet for fra `index.ts`. Da forblir
 * hovedinngangen type-only, slik API-et (som kjører kompilert med `node`)
 * forventer.
 *
 * Uker starter på mandag og regnes i lokal tidssone.
 */
import { addDays, addWeeks, differenceInCalendarWeeks, format, parseISO, startOfDay, startOfWeek } from "date-fns";
import { nb } from "date-fns/locale";

const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

/** Mandag kl. 00:00 (lokal tid) i uka `weekOffset` uker før `now`. 0 = denne uka. */
export function getWeekStart(weekOffset: number, now: Date = new Date()): Date {
  return startOfWeek(addWeeks(now, -weekOffset), WEEK_OPTIONS);
}

/** Hvor mange uker tilbake den eldste turen ligger, sett fra uka til `now`. Aldri negativ. */
export function getMaxWeekOffset(trips: ReadonlyArray<{ startedAt: string }>, now: Date = new Date()): number {
  if (trips.length === 0) return 0;

  const currentWeekStart = startOfWeek(now, WEEK_OPTIONS);
  const earliestTripDay = startOfDay(
    trips.reduce((earliest, trip) => {
      const tripDate = parseISO(trip.startedAt);
      return tripDate < earliest ? tripDate : earliest;
    }, parseISO(trips[0].startedAt)),
  );

  return Math.max(
    0,
    differenceInCalendarWeeks(currentWeekStart, startOfWeek(earliestTripDay, WEEK_OPTIONS), WEEK_OPTIONS),
  );
}

/** «3.–9. mars 2025» innen samme måned, ellers «29. des.–4. jan. 2026». */
export function formatWeekRange(weekStart: Date): string {
  const firstDay = weekStart;
  const lastDay = addDays(weekStart, 6);
  const sameMonth = format(firstDay, "yyyy-MM", { locale: nb }) === format(lastDay, "yyyy-MM", { locale: nb });

  if (sameMonth) {
    return `${format(firstDay, "d.", { locale: nb })}–${format(lastDay, "d. MMMM yyyy", { locale: nb })}`;
  }

  return `${format(firstDay, "d. MMM", { locale: nb })}–${format(lastDay, "d. MMM yyyy", { locale: nb })}`;
}
