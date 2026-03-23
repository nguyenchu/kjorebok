"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { TripSummary } from "@kjorebok/shared";
import { format } from "date-fns";
import { nb } from "date-fns/locale";

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

export default function DashboardPage() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<TripSummary[]>("/trips")
      .then(setTrips)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "1.5rem" }}>
        Kjørebok
      </h1>

      {loading && <p style={{ color: "var(--text-muted)" }}>Laster turer...</p>}
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      {!loading && trips.length === 0 && (
        <p style={{ color: "var(--text-muted)" }}>
          Ingen turer ennå. Start kjørebok-appen på mobilen for å registrere turer.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {trips.map((trip) => (
          <div
            key={trip.id}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "1rem 1.25rem",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "0.5rem",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                {trip.startAddress ?? "Ukjent start"} → {trip.endAddress ?? "Ukjent slutt"}
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                {format(new Date(trip.startedAt), "d. MMMM yyyy HH:mm", { locale: nb })} ·{" "}
                {formatDuration(trip.startedAt, trip.endedAt)}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700, fontSize: "1.125rem" }}>
                {formatDistance(trip.distanceMeters)}
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: trip.status === "active" ? "var(--primary)" : "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {trip.status === "active" ? "Aktiv" : "Fullført"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
