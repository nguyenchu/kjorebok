"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getAndroidDownloadUrl, getAndroidMetadataUrl } from "@/lib/config";
import type { TripMode, TripPurpose, TripSummary, Trip } from "@kjorebok/shared";

const MODE_ICONS: Record<TripMode, string> = {
  WALK: "🚶",
  CYCLE: "🚴",
  EBIKE: "⚡",
  CAR: "🚗",
  OTHER: "📍",
};

const MODE_LABELS: Record<TripMode, string> = {
  WALK: "Gåtur",
  CYCLE: "Sykkeltur",
  EBIKE: "Elsykkel",
  CAR: "Kjøretur",
  OTHER: "Annet",
};

const TripMap = dynamic(() => import("./TripMap"), { ssr: false });
import { addDays, addWeeks, differenceInCalendarWeeks, format, isSameDay, isToday, isYesterday, parseISO, startOfDay, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { nb } from "date-fns/locale";

type DayLog = {
  day: Date;
  trips: TripSummary[];
  lastKnownAddress: string | null;
};

type AndroidReleaseMetadata = {
  version: string;
  versionCode: number;
  publishedAt: string;
};

function formatDistance(meters: number) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

function formatDuration(start: string, end: string | null) {
  if (!end) return "Pågår...";
  const s = new Date(start);
  const e = new Date(end);
  const mins = Math.round((e.getTime() - s.getTime()) / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}t ${mins % 60}min`;
}

function formatDayHeader(date: Date): string {
  if (isToday(date)) return "I dag";
  if (isYesterday(date)) return "I går";
  return format(date, "EEEE d. MMMM", { locale: nb });
}

function formatDayTabLabel(date: Date): string {
  if (isToday(date)) return "I dag";
  if (isYesterday(date)) return "I går";
  return format(date, "EEEE", { locale: nb });
}

function formatDayTabMeta(date: Date): string {
  return format(date, "d. MMM", { locale: nb });
}

function getTripAddress(trip: TripSummary): string | null {
  return trip.endAddress ?? trip.startAddress ?? null;
}

function getWeekStart(weekOffset: number): Date {
  return startOfWeek(addWeeks(new Date(), -weekOffset), { weekStartsOn: 1 });
}

function buildWeekLog(trips: TripSummary[], weekOffset: number): DayLog[] {
  const weekStart = getWeekStart(weekOffset);
  const tripsByDay = new Map<string, TripSummary[]>();

  for (const trip of trips) {
    const key = format(parseISO(trip.startedAt), "yyyy-MM-dd");
    const existing = tripsByDay.get(key);
    if (existing) {
      existing.push(trip);
    } else {
      tripsByDay.set(key, [trip]);
    }
  }

  const today = startOfDay(new Date());

  return Array.from({ length: 7 }, (_, offset) => {
    const day = addDays(weekStart, offset);
    if (weekOffset === 0 && day > today) return null;
    const key = format(day, "yyyy-MM-dd");
    const dayTrips = tripsByDay.get(key) ?? [];
    const dayStart = day.getTime();
    const lastKnownAddress =
      dayTrips.length > 0
        ? null
        : (trips.find((trip) => parseISO(trip.startedAt).getTime() < dayStart && getTripAddress(trip))?.endAddress ??
          trips.find((trip) => parseISO(trip.startedAt).getTime() < dayStart && getTripAddress(trip))?.startAddress ??
          null);

    return { day, trips: dayTrips, lastKnownAddress };
  }).filter((d): d is DayLog => d !== null);
}

function getMaxWeekOffset(trips: TripSummary[]): number {
  if (trips.length === 0) return 0;

  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const earliestTripDay = startOfDay(
    trips.reduce((earliest, trip) => {
      const tripDate = parseISO(trip.startedAt);
      return tripDate < earliest ? tripDate : earliest;
    }, parseISO(trips[0].startedAt)),
  );

  return Math.max(
    0,
    differenceInCalendarWeeks(currentWeekStart, startOfWeek(earliestTripDay, { weekStartsOn: 1 }), { weekStartsOn: 1 }),
  );
}

function formatWeekRange(days: DayLog[]): string {
  if (days.length === 0) return "";

  const firstDay = days[0].day;
  const lastDay = days[days.length - 1].day;
  const sameMonth = format(firstDay, "yyyy-MM", { locale: nb }) === format(lastDay, "yyyy-MM", { locale: nb });

  if (sameMonth) {
    return `${format(firstDay, "d.", { locale: nb })}–${format(lastDay, "d. MMMM yyyy", { locale: nb })}`;
  }

  return `${format(firstDay, "d. MMM", { locale: nb })}–${format(lastDay, "d. MMM yyyy", { locale: nb })}`;
}

export default function DashboardPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const androidDownloadUrl = getAndroidDownloadUrl();
  const androidMetadataUrl = getAndroidMetadataUrl();
  const dayTabsRef = useRef<HTMLDivElement>(null);
  const selectLastDayRef = useRef(false);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [androidVersion, setAndroidVersion] = useState<AndroidReleaseMetadata | null>(null);
  const [androidVersionLoaded, setAndroidVersionLoaded] = useState(false);
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0);
  const [selectedDayKey, setSelectedDayKey] = useState(format(new Date(), "yyyy-MM-dd"));
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [mapTrip, setMapTrip] = useState<Trip | null>(null);
  const [mapLoading, setMapLoading] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    api
      .get<TripSummary[]>("/trips")
      .then(setTrips)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!androidMetadataUrl) return;

    let cancelled = false;

    fetch(androidMetadataUrl, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as AndroidReleaseMetadata;
      })
      .then((data) => {
        if (!cancelled) {
          setAndroidVersion(data);
          setAndroidVersionLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAndroidVersion(null);
          setAndroidVersionLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [androidMetadataUrl]);

  const handleDelete = async (id: string) => {
    if (!confirm("Slett turen?")) return;
    setDeletingId(id);
    try {
      await api.delete(`/trips/${id}`);
      setTrips((prev) => prev.filter((t) => t.id !== id));
    } catch (e: any) {
      alert(e.message ?? "Kunne ikke slette turen.");
    } finally {
      setDeletingId(null);
    }
  };

  const handlePurpose = async (id: string, purpose: TripPurpose) => {
    try {
      await api.patch(`/trips/${id}`, { purpose });
      setTrips((prev) => prev.map((t) => t.id === id ? { ...t, purpose } : t));
    } catch (e: any) {
      alert(e.message ?? "Kunne ikke oppdatere formål.");
    }
  };

  const handleMode = async (id: string, mode: TripMode) => {
    try {
      await api.patch(`/trips/${id}`, { mode });
      setTrips((prev) => prev.map((t) => t.id === id ? { ...t, mode } : t));
    } catch (e: any) {
      alert(e.message ?? "Kunne ikke oppdatere turtype.");
    }
  };

  const handleOpenMap = async (id: string) => {
    setMapLoading(true);
    setMapTrip(null);
    try {
      const trip = await api.get<Trip>(`/trips/${id}`);
      setMapTrip(trip);
    } catch (e: any) {
      alert(e.message ?? "Kunne ikke laste tur.");
    } finally {
      setMapLoading(false);
    }
  };

  const visibleTrips = trips.filter((trip) => trip.status === "ACTIVE" || trip.distanceMeters > 0);
  const dayLog = buildWeekLog(visibleTrips, selectedWeekOffset);
  const maxWeekOffset = getMaxWeekOffset(visibleTrips);

  useEffect(() => {
    if (selectedWeekOffset > maxWeekOffset) {
      setSelectedWeekOffset(maxWeekOffset);
    }
  }, [maxWeekOffset, selectedWeekOffset]);

  useEffect(() => {
    const dayTabs = dayTabsRef.current;
    if (dayTabs) {
      dayTabs.scrollTo({ left: 0, behavior: "instant" });
    }
  }, [selectedWeekOffset]);

  useEffect(() => {
    if (dayLog.length === 0) return;

    const hasSelectedDay = dayLog.some((day) => format(day.day, "yyyy-MM-dd") === selectedDayKey);

    if (selectLastDayRef.current) {
      selectLastDayRef.current = false;
      setSelectedDayKey(format(dayLog[dayLog.length - 1].day, "yyyy-MM-dd"));
      return;
    }

    if (hasSelectedDay) return;

    setSelectedDayKey(
      selectedWeekOffset === 0
        ? format(new Date(), "yyyy-MM-dd")
        : format(dayLog[0].day, "yyyy-MM-dd"),
    );
  }, [dayLog, selectedDayKey, selectedWeekOffset]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (dayLog.length === 0) return;
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;

      e.preventDefault();

      const currentIndex = dayLog.findIndex((d) => format(d.day, "yyyy-MM-dd") === selectedDayKey);

      if (e.key === "ArrowLeft") {
        if (currentIndex > 0) {
          setSelectedDayKey(format(dayLog[currentIndex - 1].day, "yyyy-MM-dd"));
        } else if (selectedWeekOffset < maxWeekOffset) {
          selectLastDayRef.current = true;
          setSelectedWeekOffset((w) => w + 1);
        }
      } else {
        if (currentIndex < dayLog.length - 1) {
          setSelectedDayKey(format(dayLog[currentIndex + 1].day, "yyyy-MM-dd"));
        } else if (selectedWeekOffset > 0) {
          setSelectedWeekOffset((w) => w - 1);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dayLog, selectedDayKey, selectedWeekOffset, maxWeekOffset]);

  if (authLoading) return null;

  if (!user) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", minHeight: "100vh", padding: "3rem 1rem", display: "flex", alignItems: "center" }}>
        <div
          style={{
            width: "100%",
            background: "linear-gradient(145deg, rgba(254,249,195,0.82) 0%, rgba(255,255,255,0.92) 45%, rgba(224,242,254,0.95) 100%)",
            border: "1px solid rgba(148, 163, 184, 0.18)",
            borderRadius: "28px",
            padding: "1.5rem",
            boxShadow: "0 30px 70px rgba(15, 23, 42, 0.08)",
          }}
        >
          <p style={{ color: "var(--text-soft)", fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.75rem" }}>
            Kjørebok
          </p>
          <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.05, fontWeight: 800, letterSpacing: "-0.04em", marginBottom: "0.75rem" }}>
            Logg inn for å åpne turloggen.
          </h1>
          <p style={{ color: "var(--text-soft)", fontSize: "1rem", maxWidth: 560, marginBottom: "1.25rem" }}>
            Weboversikten viser turene dine fra mobilen. Hvis du ikke kommer videre, åpne innlogging direkte her.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => router.push("/login")}
              style={{
                padding: "0.8rem 1rem",
                background: "var(--text)",
                color: "#fff",
                border: "none",
                borderRadius: "999px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Gå til innlogging
            </button>
            {androidDownloadUrl && (
              <a
                href={androidDownloadUrl}
                style={{
                  padding: "0.8rem 1rem",
                  background: "rgba(255,255,255,0.86)",
                  border: "1px solid rgba(148, 163, 184, 0.28)",
                  borderRadius: "999px",
                  fontWeight: 700,
                  color: "var(--text)",
                  textDecoration: "none",
                }}
              >
                Last ned for Android (APK)
              </a>
            )}
          </div>
          {error && (
            <p style={{ color: "var(--danger)", marginTop: "1rem" }}>
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  const activeTrip = trips.find((trip) => trip.status === "ACTIVE") ?? null;
  const totalDistance = trips.reduce((sum, trip) => sum + trip.distanceMeters, 0);
  const latestTrip = visibleTrips[0] ?? null;
  const selectedDay = dayLog.find((day) => format(day.day, "yyyy-MM-dd") === selectedDayKey) ?? dayLog[0] ?? null;
  const weekLabel = formatWeekRange(dayLog);
  const currentWeekStart = getWeekStart(0);
  const displayedWeekStart = getWeekStart(selectedWeekOffset);
  const previousMonthWeekOffset = Math.min(
    maxWeekOffset,
    Math.max(
      0,
      differenceInCalendarWeeks(
        currentWeekStart,
        startOfWeek(startOfMonth(subMonths(displayedWeekStart, 1)), { weekStartsOn: 1 }),
        { weekStartsOn: 1 },
      ),
    ),
  );

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "2rem 1rem 3.5rem" }}>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          background:
            "linear-gradient(145deg, rgba(254,249,195,0.82) 0%, rgba(255,255,255,0.92) 45%, rgba(224,242,254,0.95) 100%)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: "28px",
          padding: "1.5rem",
          boxShadow: "0 30px 70px rgba(15, 23, 42, 0.08)",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "auto -80px -120px auto",
            width: "240px",
            height: "240px",
            borderRadius: "999px",
            background: "rgba(37, 99, 235, 0.08)",
            filter: "blur(6px)",
          }}
        />

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap", position: "relative" }}>
          <div style={{ maxWidth: 640 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.45rem",
                padding: "0.35rem 0.7rem",
                borderRadius: "999px",
                background: "rgba(255,255,255,0.7)",
                border: "1px solid rgba(148, 163, 184, 0.24)",
                color: "var(--text-soft)",
                fontSize: "0.78rem",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                marginBottom: "0.9rem",
              }}
            >
              Weboversikt
            </div>
            <h1 style={{ fontSize: "clamp(2rem, 4vw, 3.2rem)", lineHeight: 1, fontWeight: 800, letterSpacing: "-0.04em", marginBottom: "0.6rem" }}>
              Kjørebok som er lett å skanne.
            </h1>
            <p style={{ color: "var(--text-soft)", fontSize: "1.02rem", maxWidth: 560 }}>
              Her ser du den ferskeste aktiviteten fra mobilen og hele turloggen på ett sted, uten ekstra dashboard-støy.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", flexWrap: "wrap", justifyContent: "flex-end", position: "relative" }}>
            <span style={{ color: "var(--text-soft)", fontSize: "0.92rem" }}>{user?.name}</span>
            <button
              onClick={() => { logout(); router.push("/login"); }}
              style={{
                padding: "0.6rem 0.95rem",
                background: "rgba(255,255,255,0.72)",
                border: "1px solid rgba(148, 163, 184, 0.28)",
                borderRadius: "999px",
                cursor: "pointer",
                fontSize: "0.9rem",
                fontWeight: 600,
                color: "var(--text)",
              }}
            >
              Logg ut
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "0.9rem",
            position: "relative",
          }}
        >
          <div
            style={{
              background: "rgba(255,255,255,0.78)",
              border: "1px solid rgba(148, 163, 184, 0.2)",
              borderRadius: "22px",
              padding: "1.1rem 1.15rem",
              backdropFilter: "blur(10px)",
            }}
          >
            <div style={{ color: "var(--text-soft)", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.45rem" }}>
              Aktivitet nå
            </div>
            <div style={{ fontWeight: 700, fontSize: "1.08rem", marginBottom: "0.2rem" }}>
              {activeTrip ? "En tur er i gang" : latestTrip ? "Siste registrerte tur" : "Klar for første tur"}
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.94rem" }}>
              {activeTrip
                ? `${activeTrip.startAddress ?? "Ukjent start"} → ${activeTrip.endAddress ?? "Pågår"}`
                : latestTrip
                  ? `${latestTrip.startAddress ?? "Ukjent start"} → ${latestTrip.endAddress ?? "Ukjent slutt"}`
                  : "Når mobilen begynner å registrere turer dukker de opp her."}
            </div>
          </div>

          <div
            style={{
              background: "rgba(15,23,42,0.92)",
              color: "#f8fafc",
              borderRadius: "22px",
              padding: "1.1rem 1.15rem",
            }}
          >
            <div style={{ color: "rgba(226,232,240,0.78)", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.45rem" }}>
              Registrert distanse
            </div>
            <div style={{ fontWeight: 800, fontSize: "clamp(1.6rem, 3vw, 2.4rem)", lineHeight: 1.05, marginBottom: "0.3rem" }}>
              {formatDistance(totalDistance)}
            </div>
            <div style={{ color: "rgba(226,232,240,0.78)", fontSize: "0.92rem" }}>
              {trips.length === 0
                ? "Ingen turer registrert ennå."
                : `${trips.length} ${trips.length === 1 ? "tur ligger" : "turer ligger"} i loggen.`}
            </div>
          </div>
        </div>
      </div>

      {loading && <p style={{ color: "var(--text-muted)" }}>Laster turer...</p>}
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      {!loading && trips.length === 0 && !error && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px dashed var(--border)",
            borderRadius: "16px",
            padding: "2rem",
            textAlign: "center",
            color: "var(--text-muted)",
          }}
        >
          <p style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>Ingen turer ennå.</p>
          <p>Start kjørebok-appen på mobilen for å registrere de første turene.</p>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: "1rem", margin: "1.8rem 0 1rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ color: "var(--text-soft)", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.35rem" }}>
            Historikk
          </p>
          <h2 style={{ fontSize: "1.45rem", fontWeight: 800, letterSpacing: "-0.03em" }}>Turlogg</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
            {trips.length} {trips.length === 1 ? "tur" : "turer"} vist
          </p>
          <button
            onClick={async () => {
              const blob = await api.getBlob("/trips/export.csv");
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "kjorebok.csv";
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{
              padding: "0.45rem 0.9rem",
              background: "rgba(255,255,255,0.86)",
              border: "1px solid var(--border)",
              borderRadius: "999px",
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            Eksporter CSV
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "0.6rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ color: "var(--text-soft)", fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.2rem" }}>
            Tidsrom
          </p>
          <div style={{ fontSize: "1rem", fontWeight: 800, color: "var(--text)" }}>
            {weekLabel}
          </div>
          <button
            type="button"
            onClick={() => setSelectedWeekOffset(previousMonthWeekOffset)}
            disabled={previousMonthWeekOffset === selectedWeekOffset}
            style={{
              marginTop: "0.45rem",
              padding: 0,
              background: "none",
              border: "none",
              fontSize: "0.84rem",
              fontWeight: 700,
              color: previousMonthWeekOffset === selectedWeekOffset ? "var(--text-muted)" : "var(--primary)",
              cursor: previousMonthWeekOffset === selectedWeekOffset ? "default" : "pointer",
              opacity: previousMonthWeekOffset === selectedWeekOffset ? 0.45 : 1,
            }}
          >
            Hopp til forrige måned
          </button>
        </div>
      </div>

      {dayLog.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
          <button
            type="button"
            onClick={() => setSelectedWeekOffset((current) => Math.min(current + 1, maxWeekOffset))}
            disabled={selectedWeekOffset >= maxWeekOffset}
            style={{
              flexShrink: 0,
              width: "2.2rem",
              height: "2.2rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.92)",
              border: "1px solid var(--border)",
              borderRadius: "999px",
              fontSize: "1rem",
              fontWeight: 700,
              color: "var(--text)",
              cursor: selectedWeekOffset >= maxWeekOffset ? "default" : "pointer",
              opacity: selectedWeekOffset >= maxWeekOffset ? 0.3 : 1,
            }}
            aria-label="Eldre uke"
          >
            ←
          </button>
          <div ref={dayTabsRef} style={{ display: "flex", gap: "0.75rem", overflowX: "auto", padding: "0.1rem 0 0.6rem", flex: 1 }}>
            {dayLog.map((day) => {
              const selected = selectedDay ? isSameDay(day.day, selectedDay.day) : false;

              return (
                <button
                  key={day.day.toISOString()}
                  type="button"
                  onClick={() => setSelectedDayKey(format(day.day, "yyyy-MM-dd"))}
                  style={{
                    position: "relative",
                    flex: "0 0 auto",
                    minWidth: "116px",
                    textAlign: "left",
                    border: selected ? "1px solid rgba(15, 23, 42, 0.96)" : "1px solid var(--border)",
                    borderRadius: "18px",
                    padding: "0.85rem 0.95rem",
                    background: selected ? "var(--text)" : "rgba(255,255,255,0.86)",
                    color: selected ? "#f8fafc" : "var(--text)",
                    cursor: "pointer",
                    boxShadow: selected ? "0 18px 36px rgba(15, 23, 42, 0.18)" : "0 12px 26px rgba(15, 23, 42, 0.05)",
                  }}
                >
                  <div style={{ fontSize: "0.98rem", fontWeight: 850, textTransform: "capitalize", marginBottom: "0.15rem" }}>
                    {formatDayTabLabel(day.day)}
                  </div>
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, color: selected ? "#cbd5e1" : "var(--text-muted)" }}>
                    {formatDayTabMeta(day.day)}
                  </div>
                  {day.trips.length > 0 && (
                    <span
                      style={{
                        position: "absolute",
                        top: "0.55rem",
                        right: "0.55rem",
                        minWidth: "1.35rem",
                        height: "1.35rem",
                        padding: "0 0.4rem",
                        borderRadius: "999px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: selected ? "#38bdf8" : "#e0f2fe",
                        color: selected ? "#082f49" : "#0369a1",
                        fontSize: "0.72rem",
                        fontWeight: 850,
                      }}
                    >
                      {day.trips.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setSelectedWeekOffset((current) => Math.max(current - 1, 0))}
            disabled={selectedWeekOffset === 0}
            style={{
              flexShrink: 0,
              width: "2.2rem",
              height: "2.2rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: selectedWeekOffset === 0 ? "rgba(15,23,42,0.08)" : "var(--text)",
              border: "1px solid rgba(15, 23, 42, 0.12)",
              borderRadius: "999px",
              fontSize: "1rem",
              fontWeight: 700,
              color: selectedWeekOffset === 0 ? "var(--text-soft)" : "#fff",
              cursor: selectedWeekOffset === 0 ? "default" : "pointer",
              opacity: selectedWeekOffset === 0 ? 0.3 : 1,
            }}
            aria-label="Nyere uke"
          >
            →
          </button>
        </div>
      )}

      {selectedDay && (
        <section>
          <h3 style={{ color: "var(--text-soft)", fontSize: "0.92rem", fontWeight: 800, marginBottom: "0.65rem", textTransform: "capitalize" }}>
            {formatDayHeader(selectedDay.day)}
          </h3>
          {selectedDay.trips.length === 0 ? (
            <div
              style={{
                background: "rgba(255,255,255,0.78)",
                border: "1px dashed var(--border)",
                borderRadius: "18px",
                padding: "1rem 1.1rem",
                color: "var(--text-muted)",
              }}
            >
              <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: "0.25rem" }}>
                Ingen turer registrert
              </div>
              {selectedDay.lastKnownAddress && (
                <div style={{ fontSize: "0.9rem" }}>
                  Siste registrerte stopp før dagen: {selectedDay.lastKnownAddress}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              {selectedDay.trips.map((trip) => (
                  <div
                    key={trip.id}
                    style={{
                      background:
                        trip.status === "ACTIVE"
                          ? "linear-gradient(135deg, rgba(219,234,254,0.72) 0%, rgba(255,255,255,0.98) 100%)"
                          : "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.95) 100%)",
                      border: trip.status === "ACTIVE" ? "1px solid rgba(96, 165, 250, 0.55)" : "1px solid var(--border)",
                      borderRadius: "22px",
                      padding: "1.05rem 1.2rem",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: "0.8rem",
                      alignItems: "center",
                      boxShadow: "0 18px 38px rgba(15, 23, 42, 0.06)",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.3rem" }}>
                        <span style={{ fontSize: "1.1rem" }}>{MODE_ICONS[trip.mode ?? "CAR"]}</span>
                        <span style={{ fontWeight: 700, fontSize: "1rem" }}>
                          {trip.startAddress ?? "Ukjent start"} → {trip.endAddress ?? "Ukjent slutt"}
                        </span>
                      </div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
                        {format(new Date(trip.startedAt), "HH:mm", { locale: nb })}
                        {trip.endedAt && (
                          <> → {format(new Date(trip.endedAt), "HH:mm", { locale: nb })}</>
                        )}
                        {" · "}{formatDuration(trip.startedAt, trip.endedAt)}
                      </div>
                      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                        {(["PRIVATE", "WORK"] as TripPurpose[]).map((p) => (
                          <button
                            key={p}
                            onClick={() => handlePurpose(trip.id, p)}
                            style={{
                              padding: "0.2rem 0.55rem",
                              borderRadius: "999px",
                              border: "1px solid",
                              cursor: "pointer",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              background: trip.purpose === p ? "var(--text)" : "transparent",
                              color: trip.purpose === p ? "#f8fafc" : "var(--text-soft)",
                              borderColor: trip.purpose === p ? "var(--text)" : "var(--border)",
                            }}
                          >
                            {p === "PRIVATE" ? "Privat" : "Jobb"}
                          </button>
                        ))}
                        {(["CAR", "WALK", "CYCLE", "EBIKE", "OTHER"] as TripMode[]).map((m) => (
                          <button
                            key={m}
                            onClick={() => handleMode(trip.id, m)}
                            style={{
                              padding: "0.2rem 0.55rem",
                              borderRadius: "999px",
                              border: "1px solid",
                              cursor: "pointer",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              background: (trip.mode ?? "CAR") === m ? "var(--text)" : "transparent",
                              color: (trip.mode ?? "CAR") === m ? "#f8fafc" : "var(--text-soft)",
                              borderColor: (trip.mode ?? "CAR") === m ? "var(--text)" : "var(--border)",
                            }}
                          >
                            {MODE_ICONS[m]} {MODE_LABELS[m]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.4rem" }}>
                      <div style={{ fontWeight: 800, fontSize: "1.25rem", letterSpacing: "-0.03em" }}>
                        {formatDistance(trip.distanceMeters)}
                      </div>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0.28rem 0.6rem",
                          borderRadius: "999px",
                          background: trip.status === "ACTIVE" ? "rgba(37,99,235,0.12)" : "rgba(148,163,184,0.14)",
                          fontSize: "0.74rem",
                          fontWeight: 700,
                          color: trip.status === "ACTIVE" ? "var(--primary-strong)" : "var(--text-soft)",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {trip.status === "ACTIVE" ? "Aktiv" : "Fullført"}
                      </div>
                      <button
                        onClick={() => handleOpenMap(trip.id)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--text-muted)",
                          fontSize: "0.8rem",
                          padding: "0.2rem 0.4rem",
                          borderRadius: "6px",
                        }}
                      >
                        Kart
                      </button>
                      <button
                        onClick={() => handleDelete(trip.id)}
                        disabled={deletingId === trip.id}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: deletingId === trip.id ? "default" : "pointer",
                          color: "var(--text-muted)",
                          fontSize: "0.8rem",
                          padding: "0.2rem 0.4rem",
                          borderRadius: "6px",
                          opacity: deletingId === trip.id ? 0.4 : 1,
                        }}
                      >
                        Slett
                      </button>
                    </div>
                  </div>
              ))}
            </div>
          )}
        </section>
      )}
      {(mapTrip || mapLoading) && (
        <div
          onClick={() => setMapTrip(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(15,23,42,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: "24px",
              width: "100%",
              maxWidth: "800px",
              height: "520px",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 40px 80px rgba(15,23,42,0.24)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1rem" }}>
                  {mapTrip ? `${mapTrip.startAddress ?? "Ukjent start"} → ${mapTrip.endAddress ?? "Ukjent slutt"}` : "Laster kart…"}
                </div>
                {mapTrip && (
                  <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    {(mapTrip.distanceMeters / 1000).toFixed(1)} km · {mapTrip.route.length} GPS-punkter
                  </div>
                )}
              </div>
              <button
                onClick={() => setMapTrip(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.4rem", color: "var(--text-muted)", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            <div style={{ flex: 1 }}>
              {mapLoading && (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
                  Laster…
                </div>
              )}
              {mapTrip && <TripMap route={mapTrip.route} />}
            </div>
          </div>
        </div>
      )}

      {androidDownloadUrl && (
        <div
          style={{
            marginTop: "2rem",
            padding: "1.1rem 1.25rem",
            background: "rgba(255,255,255,0.82)",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            boxShadow: "0 12px 26px rgba(15, 23, 42, 0.05)",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.2rem" }}>
              Last ned Kjørebok for Android
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
              {androidVersion
                ? `Appversjon ${androidVersion.version}`
                : androidVersionLoaded
                  ? "Appversjon utilgjengelig akkurat nå"
                  : "Henter appversjon..."}
            </div>
          </div>
          <a
            href={androidDownloadUrl}
            style={{
              padding: "0.6rem 1.1rem",
              background: "var(--text)",
              color: "#fff",
              borderRadius: "999px",
              fontWeight: 700,
              fontSize: "0.88rem",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Last ned APK{androidVersion ? ` v${androidVersion.version}` : ""}
          </a>
        </div>
      )}

      <footer
        style={{
          marginTop: "1.5rem",
          paddingTop: "1rem",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "center",
        }}
      />
    </div>
  );
}
