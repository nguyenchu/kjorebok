"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { KjorebokReportResponse, TripPurpose, Vehicle } from "@kjorebok/shared";
import { format, parseISO } from "date-fns";
import { nb } from "date-fns/locale";

const MONTHS = [
  "Januar", "Februar", "Mars", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Desember",
];

type PurposeFilter = TripPurpose | "ALL";

interface Filters {
  year: number;
  month: number | null;
  vehicleId: string | null;
  purpose: PurposeFilter;
}

function buildQuery(filters: Filters): string {
  const params = new URLSearchParams();
  params.set("year", String(filters.year));
  if (filters.month !== null) params.set("month", String(filters.month));
  if (filters.vehicleId) params.set("vehicleId", filters.vehicleId);
  if (filters.purpose !== "ALL") params.set("purpose", filters.purpose);
  return params.toString();
}

function formatKr(value: number): string {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(value);
}

function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

const selectStyle = {
  padding: "0.55rem 0.75rem",
  border: "1px solid var(--border)",
  borderRadius: "10px",
  fontSize: "0.9rem",
  background: "#fff",
  color: "var(--text)",
} as const;

const cellStyle = {
  padding: "0.6rem 0.7rem",
  borderBottom: "1px solid var(--border)",
  fontSize: "0.85rem",
  whiteSpace: "nowrap",
} as const;

export default function ReportPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const currentYear = new Date().getFullYear();
  const [filters, setFilters] = useState<Filters>({
    year: currentYear,
    month: null,
    vehicleId: null,
    purpose: "WORK",
  });
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [report, setReport] = useState<KjorebokReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    api.get<Vehicle[]>("/vehicles").then(setVehicles).catch(() => setVehicles([]));
  }, [user, authLoading, router]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<KjorebokReportResponse>(`/trips/report?${buildQuery(filters)}`);
      setReport(result);
    } catch (e: any) {
      setError(e.message ?? "Kunne ikke hente rapporten.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (authLoading || !user) return;
    void loadReport();
  }, [authLoading, user, loadReport]);

  const handleDownload = async (kind: "csv" | "pdf") => {
    setExporting(kind);
    try {
      const path = kind === "pdf" ? "/trips/report.pdf" : "/trips/export.csv";
      const blob = await api.getBlob(`${path}?${buildQuery(filters)}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kjorebok-${filters.year}${filters.month ? `-${String(filters.month).padStart(2, "0")}` : ""}.${kind}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message ?? "Kunne ikke laste ned rapporten.");
    } finally {
      setExporting(null);
    }
  };

  const yearOptions = useMemo(
    () => Array.from({ length: 5 }, (_, index) => currentYear - index),
    [currentYear]
  );

  if (authLoading || !user) return null;

  const totals = report?.totals;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1rem 3.5rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <button
          onClick={() => router.push("/")}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "0.85rem",
            padding: 0,
            marginBottom: "0.4rem",
          }}
        >
          ← Tilbake til turlogg
        </button>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.03em" }}>Kjøregodtgjørelse</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginTop: "0.3rem" }}>
          Oppsummering av registrerte turer med satsene for kilometergodtgjørelse. Last ned som PDF eller CSV
          når tallene ser riktige ut.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginBottom: "1.5rem",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-soft)" }}>År</span>
          <select
            value={filters.year}
            onChange={(e) => setFilters({ ...filters, year: Number(e.target.value) })}
            style={selectStyle}
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-soft)" }}>Måned</span>
          <select
            value={filters.month ?? ""}
            onChange={(e) =>
              setFilters({ ...filters, month: e.target.value === "" ? null : Number(e.target.value) })
            }
            style={selectStyle}
          >
            <option value="">Hele året</option>
            {MONTHS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-soft)" }}>Kjøretøy</span>
          <select
            value={filters.vehicleId ?? ""}
            onChange={(e) =>
              setFilters({ ...filters, vehicleId: e.target.value === "" ? null : e.target.value })
            }
            style={selectStyle}
          >
            <option value="">Alle kjøretøy</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.label} ({vehicle.registration})
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-soft)" }}>Formål</span>
          <select
            value={filters.purpose}
            onChange={(e) => setFilters({ ...filters, purpose: e.target.value as PurposeFilter })}
            style={selectStyle}
          >
            <option value="WORK">Yrkeskjøring</option>
            <option value="PRIVATE">Privat</option>
            <option value="ALL">Alle turer</option>
          </select>
        </label>

        <div style={{ display: "flex", gap: "0.4rem", marginLeft: "auto" }}>
          <button
            onClick={() => handleDownload("csv")}
            disabled={exporting !== null || !report}
            style={{
              padding: "0.6rem 1rem",
              background: "rgba(255,255,255,0.92)",
              border: "1px solid var(--border)",
              borderRadius: "999px",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: exporting ? "default" : "pointer",
              color: "var(--text)",
            }}
          >
            {exporting === "csv" ? "Laster…" : "Last ned CSV"}
          </button>
          <button
            onClick={() => handleDownload("pdf")}
            disabled={exporting !== null || !report}
            style={{
              padding: "0.6rem 1rem",
              background: "var(--text)",
              color: "#fff",
              border: "none",
              borderRadius: "999px",
              fontWeight: 700,
              fontSize: "0.85rem",
              cursor: exporting ? "default" : "pointer",
            }}
          >
            {exporting === "pdf" ? "Laster…" : "Last ned PDF"}
          </button>
        </div>
      </div>

      {loading && <p style={{ color: "var(--text-muted)" }}>Henter rapport…</p>}
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      {report && totals && !loading && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "0.75rem",
              marginBottom: "1.25rem",
            }}
          >
            {[
              { label: "Turer", value: String(totals.tripCount) },
              { label: "Yrkeskjøring", value: `${totals.workKm.toFixed(1)} km` },
              { label: "Privat", value: `${totals.privateKm.toFixed(1)} km` },
              { label: "Å utbetale", value: formatKr(totals.gross) },
              { label: "Skattefritt", value: formatKr(totals.taxFree) },
              { label: "Skattepliktig", value: formatKr(totals.taxable) },
            ].map((tile) => (
              <div
                key={tile.label}
                style={{
                  background: "rgba(255,255,255,0.96)",
                  border: "1px solid var(--border)",
                  borderRadius: "14px",
                  padding: "0.9rem 1rem",
                }}
              >
                <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", fontWeight: 600 }}>
                  {tile.label}
                </div>
                <div style={{ fontSize: "1.25rem", fontWeight: 800, marginTop: "0.25rem" }}>
                  {tile.value}
                </div>
              </div>
            ))}
          </div>

          {(totals.unverifiedRate || totals.missingPurpose > 0 || totals.odometerMismatches > 0) && (
            <div
              style={{
                background: "rgba(251, 191, 36, 0.12)",
                border: "1px solid rgba(217, 119, 6, 0.3)",
                borderRadius: "14px",
                padding: "0.9rem 1.1rem",
                marginBottom: "1.25rem",
                fontSize: "0.87rem",
                color: "#92400e",
                lineHeight: 1.6,
              }}
            >
              {totals.unverifiedRate && (
                <div>
                  Satsen for minst ett av årene er ikke kontrollert mot Skatteetaten ennå — sjekk beløpene før
                  du leverer.
                </div>
              )}
              {totals.missingPurpose > 0 && (
                <div>
                  {totals.missingPurpose} yrkestur mangler oppgitt formål. Skatteetaten krever formål for at
                  turen skal telle som dokumentasjon.
                </div>
              )}
              {totals.odometerMismatches > 0 && (
                <div>
                  {totals.odometerMismatches} tur har kilometerstand som ikke stemmer med den sporede
                  distansen.
                </div>
              )}
            </div>
          )}

          <div
            style={{
              background: "rgba(255,255,255,0.96)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "0.9rem 1.1rem",
                borderBottom: "1px solid var(--border)",
                fontWeight: 700,
                fontSize: "0.95rem",
              }}
            >
              {report.periodLabel}
              {report.vehicle && (
                <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                  {" · "}
                  {report.vehicle.label} ({report.vehicle.registration})
                </span>
              )}
            </div>

            {report.rows.length === 0 ? (
              <p style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
                Ingen turer i denne perioden.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "rgba(148,163,184,0.08)" }}>
                      {["Dato", "Fra", "Til", "Formål", "Kjøretøy", "Distanse", "Godtgjørelse"].map(
                        (heading) => (
                          <th
                            key={heading}
                            style={{
                              ...cellStyle,
                              textAlign: "left",
                              fontWeight: 700,
                              color: "var(--text-soft)",
                              fontSize: "0.78rem",
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                            }}
                          >
                            {heading}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, index) => (
                      <tr key={`${row.startedAt}-${index}`}>
                        <td style={cellStyle}>
                          {format(parseISO(row.startedAt), "d. MMM", { locale: nb })}
                        </td>
                        <td style={{ ...cellStyle, whiteSpace: "normal", maxWidth: 200 }}>{row.from}</td>
                        <td style={{ ...cellStyle, whiteSpace: "normal", maxWidth: 200 }}>{row.to}</td>
                        <td style={{ ...cellStyle, whiteSpace: "normal", maxWidth: 220 }}>
                          {row.purpose === "WORK" ? row.purposeNote ?? "—" : "Privat"}
                          {row.client && (
                            <span style={{ color: "var(--text-muted)" }}> · {row.client}</span>
                          )}
                        </td>
                        <td style={cellStyle}>{row.registration ?? "—"}</td>
                        <td style={cellStyle}>{formatKm(row.distanceMeters)}</td>
                        {/* Kjøregodtgjørelse gjelder bare yrkeskjøring — et beløp
                            på en privattur motsier totalen, som holder dem utenfor. */}
                        <td style={cellStyle}>
                          {row.purpose === "WORK" ? formatKr(row.allowance.gross) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
