"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { CreateVehicleDto, UpdateVehicleDto, Vehicle, VehicleType } from "@kjorebok/shared";

const TYPE_LABELS: Record<VehicleType, string> = {
  PRIVATE: "Privatbil",
  COMPANY: "Firmabil",
  WORK: "Yrkesbil",
};

const TYPE_ORDER: VehicleType[] = ["PRIVATE", "COMPANY", "WORK"];

const REGISTRATION_PATTERN = /^[A-ZÆØÅ]{2}\s?\d{5}$/;

function normalizeRegistration(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, " ");
}

interface VehicleFormState {
  id: string | null;
  label: string;
  registration: string;
  type: VehicleType;
  isDefault: boolean;
}

const EMPTY_FORM: VehicleFormState = {
  id: null,
  label: "",
  registration: "",
  type: "PRIVATE",
  isDefault: false,
};

const inputStyle = {
  padding: "0.65rem 0.85rem",
  border: "1px solid var(--border)",
  borderRadius: "10px",
  fontSize: "0.95rem",
} as const;

export default function VehiclesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    api
      .get<Vehicle[]>("/vehicles")
      .then(setVehicles)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, authLoading, router]);

  const reload = async () => {
    const result = await api.get<Vehicle[]>("/vehicles");
    setVehicles(result);
  };

  const openNew = () => setForm({ ...EMPTY_FORM });
  const openEdit = (vehicle: Vehicle) =>
    setForm({
      id: vehicle.id,
      label: vehicle.label,
      registration: vehicle.registration,
      type: vehicle.type,
      isDefault: vehicle.isDefault,
    });
  const closeForm = () => setForm(null);

  const handleSave = async () => {
    if (!form) return;

    const label = form.label.trim();
    const registration = normalizeRegistration(form.registration);

    if (!label) {
      alert("Kjøretøyet må ha et navn.");
      return;
    }
    if (!REGISTRATION_PATTERN.test(registration)) {
      alert("Registreringsnummeret må være to bokstaver og fem siffer, for eksempel AB 12345.");
      return;
    }

    setSaving(true);
    try {
      if (form.id) {
        const body: UpdateVehicleDto = {
          label,
          registration,
          type: form.type,
          isDefault: form.isDefault,
        };
        await api.patch<Vehicle>(`/vehicles/${form.id}`, body);
      } else {
        const body: CreateVehicleDto = {
          label,
          registration,
          type: form.type,
          isDefault: form.isDefault,
        };
        await api.post<Vehicle>("/vehicles", body);
      }
      await reload();
      closeForm();
    } catch (e: any) {
      alert(e.message ?? "Kunne ikke lagre kjøretøyet.");
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (vehicle: Vehicle) => {
    if (vehicle.isDefault) return;
    setBusyId(vehicle.id);
    try {
      await api.patch<Vehicle>(`/vehicles/${vehicle.id}`, { isDefault: true });
      await reload();
    } catch (e: any) {
      alert(e.message ?? "Kunne ikke oppdatere kjøretøyet.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (vehicle: Vehicle) => {
    if (
      !confirm(
        `Slett ${vehicle.label}? Turer som er registrert på kjøretøyet beholdes, men mister koblingen.`
      )
    ) {
      return;
    }
    setBusyId(vehicle.id);
    try {
      await api.delete(`/vehicles/${vehicle.id}`);
      await reload();
    } catch (e: any) {
      alert(e.message ?? "Kunne ikke slette kjøretøyet.");
    } finally {
      setBusyId(null);
    }
  };

  if (authLoading || !user) return null;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem 3.5rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
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
          <h1 style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.03em" }}>Kjøretøy</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginTop: "0.3rem" }}>
            Nye turer registreres på standardkjøretøyet. Registreringsnummeret følger med i kjøreboken og
            rapportene, som Skatteetaten krever.
          </p>
        </div>
        <button
          onClick={openNew}
          style={{
            padding: "0.7rem 1.1rem",
            background: "var(--text)",
            color: "#fff",
            border: "none",
            borderRadius: "999px",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: "0.9rem",
          }}
        >
          + Nytt kjøretøy
        </button>
      </div>

      {loading && <p style={{ color: "var(--text-muted)" }}>Laster kjøretøy…</p>}
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      {!loading && vehicles.length === 0 && !error && (
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
          <p style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>Ingen kjøretøy registrert ennå.</p>
          <p>Legg inn bilen du kjører, så knyttes nye turer automatisk til den.</p>
        </div>
      )}

      {vehicles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {vehicles.map((vehicle) => (
            <div
              key={vehicle.id}
              style={{
                background: "rgba(255,255,255,0.96)",
                border: "1px solid var(--border)",
                borderRadius: "16px",
                padding: "1rem 1.2rem",
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "0.8rem",
                alignItems: "center",
                opacity: busyId === vehicle.id ? 0.5 : 1,
              }}
            >
              <div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "1.05rem",
                    marginBottom: "0.2rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  {vehicle.label}
                  {vehicle.isDefault && (
                    <span
                      style={{
                        background: "rgba(37,99,235,0.12)",
                        color: "#1d4ed8",
                        borderRadius: "999px",
                        padding: "0.15rem 0.6rem",
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        letterSpacing: "0.02em",
                      }}
                    >
                      STANDARD
                    </span>
                  )}
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  {vehicle.registration} · {TYPE_LABELS[vehicle.type]}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {!vehicle.isDefault && (
                  <button
                    onClick={() => handleSetDefault(vehicle)}
                    disabled={busyId === vehicle.id}
                    style={{
                      padding: "0.4rem 0.8rem",
                      background: "rgba(255,255,255,0.92)",
                      border: "1px solid var(--border)",
                      borderRadius: "999px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      color: "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    Sett som standard
                  </button>
                )}
                <button
                  onClick={() => openEdit(vehicle)}
                  style={{
                    padding: "0.4rem 0.8rem",
                    background: "rgba(255,255,255,0.92)",
                    border: "1px solid var(--border)",
                    borderRadius: "999px",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "var(--text)",
                    cursor: "pointer",
                  }}
                >
                  Rediger
                </button>
                <button
                  onClick={() => handleDelete(vehicle)}
                  disabled={busyId === vehicle.id}
                  style={{
                    padding: "0.4rem 0.8rem",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: "999px",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  Slett
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div
          onClick={closeForm}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(15,23,42,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: "20px",
              width: "100%",
              maxWidth: "520px",
              maxHeight: "90vh",
              overflow: "auto",
              boxShadow: "0 40px 80px rgba(15,23,42,0.24)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "1.25rem 1.5rem",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h2 style={{ fontWeight: 800, fontSize: "1.2rem" }}>
                {form.id ? "Rediger kjøretøy" : "Nytt kjøretøy"}
              </h2>
              <button
                onClick={closeForm}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "1.4rem",
                  color: "var(--text-muted)",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-soft)" }}>Navn</span>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="f.eks. Familiebilen"
                  maxLength={80}
                  style={inputStyle}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-soft)" }}>
                  Registreringsnummer
                </span>
                <input
                  type="text"
                  value={form.registration}
                  onChange={(e) => setForm({ ...form, registration: e.target.value })}
                  placeholder="AB 12345"
                  maxLength={9}
                  style={{ ...inputStyle, textTransform: "uppercase" }}
                />
              </label>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-soft)" }}>Type</span>
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                  {TYPE_ORDER.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setForm({ ...form, type: option })}
                      style={{
                        padding: "0.5rem 0.9rem",
                        borderRadius: "999px",
                        border: "1px solid var(--border)",
                        background: form.type === option ? "var(--text)" : "rgba(255,255,255,0.92)",
                        color: form.type === option ? "#fff" : "var(--text)",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {TYPE_LABELS[option]}
                    </button>
                  ))}
                </div>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                />
                <span style={{ fontSize: "0.9rem", color: "var(--text)" }}>
                  Bruk som standard for nye turer
                </span>
              </label>
            </div>

            <div
              style={{
                padding: "1rem 1.5rem",
                borderTop: "1px solid var(--border)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.6rem",
              }}
            >
              <button
                onClick={closeForm}
                disabled={saving}
                style={{
                  padding: "0.6rem 1.1rem",
                  background: "rgba(255,255,255,0.92)",
                  border: "1px solid var(--border)",
                  borderRadius: "999px",
                  fontWeight: 600,
                  cursor: saving ? "default" : "pointer",
                  color: "var(--text)",
                  fontSize: "0.9rem",
                }}
              >
                Avbryt
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "0.6rem 1.1rem",
                  background: "var(--text)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "999px",
                  fontWeight: 700,
                  cursor: saving ? "default" : "pointer",
                  fontSize: "0.9rem",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Lagrer…" : "Lagre"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
