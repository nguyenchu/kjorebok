import type { TrackerDiagnostics } from "./tripTracker";

/** A background task that has not reported in this long has likely been killed. */
const STALE_TASK_MS = 20 * 60 * 1000;

export interface TrackerHealth {
  /** Something is stopping trips from being recorded — surface it where the user is. */
  needsAttention: boolean;
  needsPermission: boolean;
  /** The background task has gone quiet, usually battery optimisation killing it. */
  taskSeemsStale: boolean;
  headline: string;
  summary: string;
  /** Short enough for a status row or a banner. */
  shortStatus: string;
}

type HealthMessage = Pick<TrackerHealth, "headline" | "summary" | "shortStatus">;

function isOlderThan(timestamp: string | null, ms: number): boolean {
  if (!timestamp) return true;

  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return true;
  return Date.now() - time > ms;
}

/**
 * Single source of truth for "is tracking actually working", shared by the
 * tracking screen, the profile row and the trip-list banner so they can never
 * disagree about whether something is wrong.
 */
export function assessTrackerHealth(tracker: TrackerDiagnostics): TrackerHealth {
  const {
    hasToken,
    locationServicesEnabled,
    foregroundPermission,
    backgroundPermission,
    trackingEnabled,
    lastTaskAt,
    state,
    pendingPoints,
    activeTripId,
  } = tracker;

  const needsPermission = foregroundPermission !== "granted" || backgroundPermission !== "granted";
  const taskSeemsStale = trackingEnabled && isOlderThan(lastTaskAt, STALE_TASK_MS);
  const needsAttention =
    !hasToken || !locationServicesEnabled || needsPermission || !trackingEnabled || taskSeemsStale;

  function describe(): HealthMessage {
    if (!hasToken) {
      return {
        headline: "Du må logge inn",
        summary:
          "Logg inn igjen hvis sesjonen har utløpt. Uten innlogging kan ikke appen lagre eller sende turer.",
        shortStatus: "Ikke innlogget",
      };
    }

    if (!locationServicesEnabled) {
      return {
        headline: "Skru på posisjonstjenester",
        summary:
          "Telefonens posisjonstjenester er av. Skru dem på for at automatisk turstart skal virke.",
        shortStatus: "Posisjonstjenester er av",
      };
    }

    if (needsPermission) {
      return {
        headline: "Gi tilgang til lokasjon",
        summary: "Appen trenger lokasjonstilgang i bakgrunnen for å kunne oppdage turer automatisk.",
        shortStatus: "Mangler lokasjonstilgang",
      };
    }

    if (!trackingEnabled) {
      return {
        headline: "Aktiver automatisk sporing",
        summary:
          "Automatisk sporing er ikke slått på ennå. Aktiver den én gang, så holder appen seg klar i bakgrunnen.",
        shortStatus: "Ikke aktivert",
      };
    }

    if (taskSeemsStale) {
      return {
        headline: "Sporingen trenger oppmerksomhet",
        summary:
          "Telefonen har ikke sendt noen fersk bakgrunnsoppdatering på en stund. Sjekk batterisparing hvis dette skjer ofte.",
        shortStatus: "Ingen fersk oppdatering",
      };
    }

    if (state === "RECORDING") {
      return {
        headline: "Tur registreres nå",
        summary: "En tur er aktiv nå. Appen følger med til turen stopper eller blir sendt.",
        shortStatus: "Registrerer tur",
      };
    }

    if (pendingPoints > 0) {
      return {
        headline: "Turdata venter på sending",
        summary:
          "Det finnes turdata som ikke er sendt ennå. De blir sendt automatisk når forbindelsen er klar.",
        shortStatus: `${pendingPoints} punkt venter`,
      };
    }

    if (activeTripId) {
      return {
        headline: "Tur pågår",
        summary: "En tur er aktiv nå. Appen følger med til turen stopper eller blir sendt.",
        shortStatus: "Tur pågår",
      };
    }

    return {
      headline: "Klar til automatisk turstart",
      summary:
        "Appen følger med i bakgrunnen og starter tur automatisk når den ser tydelig bevegelse.",
      shortStatus: "Aktiv",
    };
  }

  return { needsAttention, needsPermission, taskSeemsStale, ...describe() };
}
