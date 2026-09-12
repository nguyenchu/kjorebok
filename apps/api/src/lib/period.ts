const ZONE = "Europe/Oslo";

/**
 * Report periods are Norwegian calendar periods, not UTC ones. A trip starting
 * 31. desember at 23:30 belongs to that year's kjørebok, so the boundaries have
 * to be built in Oslo time even when the server runs on UTC.
 */
function zoneOffsetMinutes(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - at.getTime()) / 60_000;
}

/** Midnight in Oslo, as the UTC instant it actually happened. */
function zoneMidnight(year: number, monthIndex: number, day: number): Date {
  const guess = Date.UTC(year, monthIndex, day);
  return new Date(guess - zoneOffsetMinutes(new Date(guess)) * 60_000);
}

/** Half-open range for a calendar year, or a single month when given. `month` is 1-12. */
export function periodRange(year?: number, month?: number): { gte: Date; lt: Date } | undefined {
  if (year === undefined) return undefined;
  if (month === undefined) {
    return { gte: zoneMidnight(year, 0, 1), lt: zoneMidnight(year + 1, 0, 1) };
  }
  return { gte: zoneMidnight(year, month - 1, 1), lt: zoneMidnight(year, month, 1) };
}

export function periodLabel(year?: number, month?: number): string {
  if (year === undefined) return "Alle turer";
  if (month === undefined) return String(year);

  const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("nb-NO", {
    month: "long",
    timeZone: "UTC",
  });
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

/** Filename-safe period suffix: "2026-03", "2026", or "". */
export function periodSlug(year?: number, month?: number): string {
  if (year === undefined) return "";
  if (month === undefined) return `-${year}`;
  return `-${year}-${String(month).padStart(2, "0")}`;
}

/** The calendar year a trip belongs to in Oslo time — decides which rate applies. */
export function periodYearOf(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric" }).format(at),
  );
}
