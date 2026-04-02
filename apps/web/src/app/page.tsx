"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getAndroidDownloadUrl } from "@/lib/config";
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

function formatHours(start: string, end: string | null) {
  if (!end) return "Pågår";
  const s = new Date(start);
  const e = new Date(end);
  const hours = (e.getTime() - s.getTime()) / 3_600_000;
  return `${hours.toFixed(1)} t`;
}

export default function DashboardPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    api
      .get<TripSummary[]>("/trips")
      .then(setTrips)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, authLoading, router]);

  if (authLoading || (!user && !error)) return null;

  const completedTrips = trips.filter((trip) => trip.status === "COMPLETED");
  const activeTrips = trips.filter((trip) => trip.status === "ACTIVE");
  const totalDistance = completedTrips.reduce((sum, trip) => sum + trip.distanceMeters, 0);
  const latestTrip = trips[0] ?? null;
  const androidDownloadUrl = getAndroidDownloadUrl();

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem 3rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.9rem", fontWeight: 800, marginBottom: "0.25rem" }}>Kjørebok</h1>
          <p style={{ color: "var(--text-muted)" }}>
            Oversikt over registrerte turer og aktivitet fra mobilen.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>{user?.name}</span>
          <button
            onClick={() => { logout(); router.push("/login"); }}
            style={{
              padding: "0.375rem 0.875rem", background: "none",
              border: "1px solid var(--border)", borderRadius: "var(--radius)",
              cursor: "pointer", fontSize: "0.875rem",
            }}
          >
            Logg ut
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <SummaryCard label="Fullførte turer" value={String(completedTrips.length)} />
        <SummaryCard label="Aktive turer" value={String(activeTrips.length)} tone={activeTrips.length > 0 ? "primary" : "default"} />
        <SummaryCard label="Kjørt distanse" value={formatDistance(totalDistance)} />
        <SummaryCard
          label="Siste tur"
          value={
            latestTrip
              ? format(new Date(latestTrip.startedAt), "d. MMM", { locale: nb })
              : "Ingen ennå"
          }
        />
      </div>

      {latestTrip && (
        <div
          style={{
            background: "linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)",
            border: "1px solid #bfdbfe",
            borderRadius: "16px",
            padding: "1rem 1.25rem",
            marginBottom: "1.25rem",
          }}
        >
          <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.35rem" }}>
            Siste aktivitet
          </div>
          <div style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.2rem" }}>
            {latestTrip.startAddress ?? "Ukjent start"} → {latestTrip.endAddress ?? "Ukjent slutt"}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.92rem" }}>
            {format(new Date(latestTrip.startedAt), "d. MMMM yyyy HH:mm", { locale: nb })} ·{" "}
            {formatHours(latestTrip.startedAt, latestTrip.endedAt)}
          </div>
        </div>
      )}

      <div
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)",
          color: "#fff",
          borderRadius: "20px",
          padding: "1.2rem 1.25rem",
          marginBottom: "1.25rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ maxWidth: 560 }}>
          <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.75, marginBottom: "0.35rem" }}>
            Android-app
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "0.2rem" }}>
            Registrer turene på mobilen
          </div>
          <div style={{ color: "rgba(255,255,255,0.82)", fontSize: "0.95rem" }}>
            Weben viser oversikt og historikk. Selve turene registreres i Android-appen.
          </div>
        </div>

        {androidDownloadUrl ? (
          <a
            href={androidDownloadUrl}
            style={{
              background: "#fff",
              color: "#0f172a",
              padding: "0.8rem 1rem",
              borderRadius: "999px",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            Last ned APK
          </a>
        ) : (
          <div style={{ color: "rgba(255,255,255,0.78)", fontSize: "0.9rem", maxWidth: 280 }}>
            Legg inn <code style={{ color: "#fff" }}>NEXT_PUBLIC_ANDROID_DOWNLOAD_URL</code> for å vise nedlastingslenke her.
          </div>
        )}
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", margin: "1.5rem 0 0.85rem", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Turlogg</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
          {trips.length} {trips.length === 1 ? "tur" : "turer"} vist
        </p>
      </div>

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
              boxShadow: "0 10px 30px rgba(15, 23, 42, 0.04)",
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
                  color: trip.status === "ACTIVE" ? "var(--primary)" : "var(--text-muted)",
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
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "primary";
}) {
  return (
    <div
      style={{
        background: tone === "primary" ? "linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%)" : "var(--surface)",
        border: tone === "primary" ? "1px solid #93c5fd" : "1px solid var(--border)",
        borderRadius: "16px",
        padding: "1rem 1.1rem",
      }}
    >
      <div style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: "0.35rem" }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{value}</div>
    </div>
  );
}
