"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getAndroidDownloadUrl } from "@/lib/config";

type Mode = "login" | "register";

export default function LoginPage() {
  const { login, register } = useAuth();
  const router = useRouter();
  const androidDownloadUrl = getAndroidDownloadUrl();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await login({ email: email.trim(), password });
      } else {
        if (!name.trim()) { setError("Navn er påkrevd"); setLoading(false); return; }
        await register({ email: email.trim(), password, name: name.trim() });
      }
      router.push("/");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", padding: "1rem",
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, textAlign: "center", marginBottom: "0.5rem" }}>
          Kjørebok
        </h1>
        <p style={{ textAlign: "center", color: "var(--text-muted)", marginBottom: "2rem" }}>
          {mode === "login" ? "Logg inn for å fortsette" : "Opprett ny konto"}
        </p>

        <form onSubmit={submit} style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", padding: "1.5rem",
          display: "flex", flexDirection: "column", gap: "0.75rem",
        }}>
          {mode === "register" && (
            <input
              style={inputStyle}
              placeholder="Navn"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          )}
          <input
            style={inputStyle}
            type="email"
            placeholder="E-post"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            style={inputStyle}
            type="password"
            placeholder="Passord"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            required
          />

          {error && <p style={{ color: "var(--danger)", fontSize: "0.875rem" }}>{error}</p>}

          <button type="submit" disabled={loading} style={buttonStyle}>
            {loading ? "…" : mode === "login" ? "Logg inn" : "Registrer"}
          </button>
        </form>

        <button
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
          style={{
            display: "block", width: "100%", marginTop: "1rem", background: "none",
            border: "none", cursor: "pointer", color: "var(--primary)",
            fontSize: "0.9rem", textAlign: "center",
          }}
        >
          {mode === "login" ? "Har du ikke konto? Registrer deg" : "Har du allerede konto? Logg inn"}
        </button>

        <div
          style={{
            marginTop: "1.25rem",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "16px",
            padding: "1rem",
          }}
        >
          <p style={{ fontWeight: 700, marginBottom: "0.35rem" }}>Trenger du Android-appen?</p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.92rem", marginBottom: androidDownloadUrl ? "0.8rem" : 0 }}>
            Turene registreres på mobilen og blir synlige her i weboversikten.
          </p>
          {androidDownloadUrl && (
            <a
              href={androidDownloadUrl}
              style={{
                display: "inline-block",
                background: "var(--primary)",
                color: "#fff",
                padding: "0.75rem 0.95rem",
                borderRadius: "999px",
                fontWeight: 700,
              }}
            >
              Last ned Android-app
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.75rem", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", fontSize: "1rem", width: "100%",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.75rem", background: "var(--primary)", color: "#fff",
  border: "none", borderRadius: "var(--radius)", fontSize: "1rem",
  fontWeight: 600, cursor: "pointer", marginTop: "0.25rem",
};
