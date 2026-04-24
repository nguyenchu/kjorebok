import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Personvern | Kjørebok",
  description: "Personvernerklæring for Kjørebok.",
};

const updatedAt = "24. april 2026";
const supportEmail = "nguyen.chu@hotmail.com";

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "20px",
  padding: "1.4rem",
  display: "grid",
  gap: "0.65rem",
};

export default function PrivacyPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "clamp(1.25rem, 2vw, 2rem)",
        display: "grid",
        placeItems: "start center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 920, display: "grid", gap: "1rem" }}>
        <Link
          href="/login"
          style={{ color: "var(--primary)", fontWeight: 700, width: "fit-content" }}
        >
          Tilbake til Kjørebok
        </Link>

        <section
          style={{
            ...cardStyle,
            padding: "clamp(1.4rem, 2vw, 2rem)",
            background:
              "linear-gradient(135deg, rgba(29,78,216,0.08), rgba(250,204,21,0.12)), var(--surface)",
          }}
        >
          <p style={{ color: "var(--text-soft)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: "0.8rem" }}>
            Personvernerklæring
          </p>
          <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.05 }}>
            Hvordan Kjørebok behandler personopplysninger
          </h1>
          <p style={{ color: "var(--text-muted)", maxWidth: 720 }}>
            Kjørebok bruker posisjon og kontoinformasjon for å registrere turer automatisk,
            vise dem i appen og gi deg oversikt over kjøringer. Vi selger ikke
            personopplysninger og deler dem ikke med andre for markedsføring.
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
            Sist oppdatert: {updatedAt}
          </p>
        </section>

        <section style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <article style={cardStyle}>
            <h2 style={{ fontSize: "1.15rem" }}>Opplysninger vi lagrer</h2>
            <p>Navn, e-postadresse, kontoens opprettelsesdato og turdata knyttet til kontoen din.</p>
            <p>Turdata kan inkludere GPS-punkter, tidspunkt, beregnet distanse, start- og sluttadresse og valgt turtype/formål.</p>
          </article>
          <article style={cardStyle}>
            <h2 style={{ fontSize: "1.15rem" }}>Hvorfor vi bruker dataene</h2>
            <p>For å opprette konto, autentisere deg, oppdage start og stopp på turer og vise historikk i mobil- og webappen.</p>
            <p>Lokasjon brukes bare for kjørebok-funksjonen og ikke for annonsering eller tredjepartsprofilering.</p>
          </article>
          <article style={cardStyle}>
            <h2 style={{ fontSize: "1.15rem" }}>Bakgrunnslokasjon</h2>
            <p>Kjørebok kan be om tilgang til lokasjon i bakgrunnen for å oppdage turer selv når appen ikke er åpen.</p>
            <p>Du kan fortsatt bruke appen uten automatisk bakgrunnssporing, men da må turer startes og stoppes mer manuelt.</p>
          </article>
        </section>

        <section style={cardStyle}>
          <h2 style={{ fontSize: "1.2rem" }}>Deling og lagring</h2>
          <p>Dataene dine brukes for å levere tjenesten og lagres på servere knyttet til Kjørebok. Vi deler ikke personopplysninger med andre selskaper for reklameformål.</p>
          <p>Vi kan bruke tekniske tjenesteleverandører for drift og hosting, men bare i den grad det er nødvendig for å levere appen.</p>
          <p>Lokale appdata som innloggingsstatus og midlertidig turbuffer kan lagres på enheten din for at appen skal fungere stabilt også ved dårlig nett.</p>
        </section>

        <section style={cardStyle}>
          <h2 style={{ fontSize: "1.2rem" }}>Dine valg</h2>
          <p>Du kan når som helst slå av lokasjonstillatelser eller stoppe bakgrunnssporing i appen eller i telefonens innstillinger.</p>
          <p>Du kan slette enkelturer i webappen og slette hele kontoen din fra profilsiden i mobilappen. Når kontoen slettes, slettes også turene som hører til kontoen.</p>
        </section>

        <section style={cardStyle}>
          <h2 style={{ fontSize: "1.2rem" }}>Kontakt</h2>
          <p>Har du spørsmål om personvern eller ønsker hjelp, kan du kontakte oss på <a href={`mailto:${supportEmail}`} style={{ color: "var(--primary)", fontWeight: 700 }}>{supportEmail}</a>.</p>
        </section>
      </div>
    </main>
  );
}
