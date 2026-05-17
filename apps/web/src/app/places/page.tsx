"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Place, CreatePlaceDto, UpdatePlaceDto } from "@kjorebok/shared";

const PlacePicker = dynamic(() => import("./PlacePicker"), { ssr: false });

interface PlaceFormState {
  id: string | null;
  label: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

const EMPTY_FORM: PlaceFormState = { id: null, label: "", lat: 0, lng: 0, radiusMeters: 100 };

export default function PlacesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<PlaceFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    api
      .get<Place[]>("/places")
      .then(setPlaces)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, authLoading, router]);

  const openNew = () => setForm({ ...EMPTY_FORM });
  const openEdit = (place: Place) =>
    setForm({
      id: place.id,
      label: place.label,
      lat: place.lat,
      lng: place.lng,
      radiusMeters: place.radiusMeters,
    });
  const closeForm = () => setForm(null);

  const handleSave = async () => {
    if (!form) return;
    if (!form.label.trim()) {
      alert("Sted må ha et navn.");
      return;
    }
    if (form.lat === 0 && form.lng === 0) {
      alert("Klikk på kartet for å velge sted.");
      return;
    }
    setSaving(true);
    try {
      if (form.id) {
        const body: UpdatePlaceDto = {
          label: form.label.trim(),
          lat: form.lat,
          lng: form.lng,
          radiusMeters: form.radiusMeters,
        };
        const updated = await api.patch<Place>(`/places/${form.id}`, body);
        setPlaces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } else {
        const body: CreatePlaceDto = {
          label: form.label.trim(),
          lat: form.lat,
          lng: form.lng,
          radiusMeters: form.radiusMeters,
        };
        const created = await api.post<Place>("/places", body);
        setPlaces((prev) => [...prev, created]);
      }
      closeForm();
    } catch (e: any) {
      alert(e.message ?? "Kunne ikke lagre sted.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Slett dette stedet? Det vil ikke endre eksisterende turer.")) return;
    setDeletingId(id);
    try {
      await api.delete(`/places/${id}`);
      setPlaces((prev) => prev.filter((p) => p.id !== id));
    } catch (e: any) {
      alert(e.message ?? "Kunne ikke slette stedet.");
    } finally {
      setDeletingId(null);
    }
  };

  if (authLoading || !user) return null;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem 3.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <button
            onClick={() => router.push("/")}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.85rem", padding: 0, marginBottom: "0.4rem" }}
          >
            ← Tilbake til turlogg
          </button>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.03em" }}>Steder</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginTop: "0.3rem" }}>
            Gi navn til steder du ofte besøker. Turer som starter eller slutter innenfor radius vises med navnet i stedet for adressen.
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
          + Nytt sted
        </button>
      </div>

      {loading && <p style={{ color: "var(--text-muted)" }}>Laster steder…</p>}
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      {!loading && places.length === 0 && !error && (
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
          <p style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>Ingen steder lagt til ennå.</p>
          <p>Trykk "+ Nytt sted" for å registrere f.eks. "Hjem" eller "Jobb".</p>
        </div>
      )}

      {places.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {places.map((place) => (
            <div
              key={place.id}
              style={{
                background: "rgba(255,255,255,0.96)",
                border: "1px solid var(--border)",
                borderRadius: "16px",
                padding: "1rem 1.2rem",
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "0.8rem",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: "0.2rem" }}>{place.label}</div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  {place.lat.toFixed(5)}, {place.lng.toFixed(5)} · radius {place.radiusMeters} m
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button
                  onClick={() => openEdit(place)}
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
                  onClick={() => handleDelete(place.id)}
                  disabled={deletingId === place.id}
                  style={{
                    padding: "0.4rem 0.8rem",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: "999px",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    cursor: deletingId === place.id ? "default" : "pointer",
                    opacity: deletingId === place.id ? 0.4 : 1,
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
              borderRadius: "20px",
              width: "100%",
              maxWidth: "640px",
              maxHeight: "90vh",
              overflow: "auto",
              boxShadow: "0 40px 80px rgba(15,23,42,0.24)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ fontWeight: 800, fontSize: "1.2rem" }}>{form.id ? "Rediger sted" : "Nytt sted"}</h2>
              <button
                onClick={closeForm}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.4rem", color: "var(--text-muted)", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-soft)" }}>Navn</span>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="f.eks. Hjem, Jobb, Mors hus"
                  style={{
                    padding: "0.65rem 0.85rem",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    fontSize: "0.95rem",
                  }}
                />
              </label>

              <div>
                <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-soft)", marginBottom: "0.35rem" }}>
                  Sted (klikk på kartet)
                </div>
                <div style={{ height: "320px", borderRadius: "12px", overflow: "hidden", border: "1px solid var(--border)" }}>
                  <PlacePicker
                    lat={form.lat}
                    lng={form.lng}
                    radiusMeters={form.radiusMeters}
                    onChange={(lat, lng) => setForm({ ...form, lat, lng })}
                  />
                </div>
                {form.lat !== 0 || form.lng !== 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.4rem" }}>
                    Valgt: {form.lat.toFixed(5)}, {form.lng.toFixed(5)}
                  </div>
                ) : (
                  <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.4rem" }}>
                    Ingen posisjon valgt ennå.
                  </div>
                )}
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-soft)" }}>
                  Radius: {form.radiusMeters} m
                </span>
                <input
                  type="range"
                  min={30}
                  max={500}
                  step={10}
                  value={form.radiusMeters}
                  onChange={(e) => setForm({ ...form, radiusMeters: Number(e.target.value) })}
                />
              </label>
            </div>
            <div style={{ padding: "1rem 1.5rem", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
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
