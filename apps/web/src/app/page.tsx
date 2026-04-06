"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { TripSummary } from "@kjorebok/shared";
import { addDays, differenceInCalendarDays, format, isToday, isYesterday, parseISO, startOfDay } from "date-fns";
import { nb } from "date-fns/locale";

type DayLog = {
  day: Date;
  trips: TripSummary[];
  lastKnownAddress: string | null;
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

function buildDayLog(trips: TripSummary[]): DayLog[] {
  if (trips.length === 0) return [];

  const today = startOfDay(new Date());
  const earliestTripDay = startOfDay(
    trips.reduce((earliest, trip) => {
      const tripDate = parseISO(trip.startedAt);
      return tripDate < earliest ? tripDate : earliest;
    }, parseISO(trips[0].startedAt)),
  );
  const maxDays = Math.min(differenceInCalendarDays(today, earliestTripDay), 13);
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

  return Array.from({ length: maxDays + 1 }, (_, offset) => {
    const day = addDays(today, -offset);
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
  });
}

export default function DashboardPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    api
      .get<TripSummary[]>("/trips")
      .then(setTrips)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, authLoading, router]);

  const dayLog = buildDayLog(trips);

  useEffect(() => {
    if (selectedDayIndex >= dayLog.length && selectedDayIndex !== 0) {
      setSelectedDayIndex(0);
    }
  }, [dayLog.length, selectedDayIndex]);

  if (authLoading || (!user && !error)) return null;

  const activeTrip = trips.find((trip) => trip.status === "ACTIVE") ?? null;
  const totalDistance = trips.reduce((sum, trip) => sum + trip.distanceMeters, 0);
  const latestTrip = trips[0] ?? null;
  const selectedDay = dayLog[selectedDayIndex] ?? null;
  const dayTabs = dayLog.map((day, index) => ({ day, index })).reverse();

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
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
          {trips.length} {trips.length === 1 ? "tur" : "turer"} vist
        </p>
      </div>

      {dayLog.length > 0 && (
        <div style={{ display: "flex", gap: "0.75rem", overflowX: "auto", padding: "0.1rem 0 1rem", marginBottom: "1rem" }}>
          {dayTabs.map(({ day, index }) => {
            const selected = index === selectedDayIndex;

            return (
              <button
                key={day.day.toISOString()}
                type="button"
                onClick={() => setSelectedDayIndex(index)}
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
                      <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.3rem" }}>
                        {trip.startAddress ?? "Ukjent start"} → {trip.endAddress ?? "Ukjent slutt"}
                      </div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                        {format(new Date(trip.startedAt), "HH:mm", { locale: nb })} ·{" "}
                        {formatDuration(trip.startedAt, trip.endedAt)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 800, fontSize: "1.25rem", letterSpacing: "-0.03em" }}>
                        {formatDistance(trip.distanceMeters)}
                      </div>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          marginTop: "0.4rem",
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
                    </div>
                  </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
