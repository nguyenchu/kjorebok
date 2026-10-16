"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { GpsPoint, TripPurpose } from "@kjorebok/shared";
import styles from "./demo.module.css";

const TripMap = dynamic(() => import("../TripMap"), { ssr: false, loading: () => <p>Laster kart…</p> });

type DemoTrip = {
  id: string;
  from: string;
  to: string;
  time: string;
  minutes: number;
  km: number;
  purpose: TripPurpose;
  note: string;
  coordinates: [number, number][];
};

// Invented trips between public landmarks, never copied from a user's track.
const EXAMPLE_TRIPS: DemoTrip[] = [
  { id: "demo-1", from: "Oslo S", to: "Vigelandsparken", time: "08:15", minutes: 24, km: 5.8, purpose: "WORK", note: "Befaring med eksempelkunde", coordinates: [[59.9109,10.7528],[59.9135,10.7461],[59.9168,10.7355],[59.9205,10.7261],[59.9247,10.7156],[59.927,10.7009]] },
  { id: "demo-2", from: "Vigelandsparken", to: "Operahuset", time: "11:30", minutes: 22, km: 6.2, purpose: "WORK", note: "Prosjektmøte med eksempelkunde", coordinates: [[59.927,10.7009],[59.9247,10.7156],[59.9205,10.7261],[59.9168,10.7355],[59.9135,10.7461],[59.9109,10.7528],[59.9075,10.7531]] },
  { id: "demo-3", from: "Operahuset", to: "Ekebergparken", time: "16:10", minutes: 16, km: 4.1, purpose: "PRIVATE", note: "Ettermiddagstur", coordinates: [[59.9075,10.7531],[59.9057,10.7617],[59.9022,10.7691],[59.898,10.7745],[59.8914,10.7728]] },
];

function makeRoute(trip: DemoTrip): GpsPoint[] {
  return trip.coordinates.map(([lat, lng], index) => ({
    lat, lng, speed: 0, heading: 0, accuracy: 10,
    timestamp: new Date(Date.UTC(2026, 9, 12, 6, 15 + index * 3)).toISOString(),
  }));
}

const formatKm = (km: number) => km.toLocaleString("nb-NO", { maximumFractionDigits: 1 });

export default function Demo() {
  const [trips, setTrips] = useState<DemoTrip[]>(() => structuredClone(EXAMPLE_TRIPS));
  const [filter, setFilter] = useState<"ALL" | TripPurpose>("ALL");
  const [selectedId, setSelectedId] = useState(EXAMPLE_TRIPS[0].id);
  const [notice, setNotice] = useState("");
  const selected = trips.find((trip) => trip.id === selectedId)!;
  const visible = trips.filter((trip) => filter === "ALL" || trip.purpose === filter);
  const totalKm = trips.reduce((sum, trip) => sum + trip.km, 0);
  const workKm = trips.filter((trip) => trip.purpose === "WORK").reduce((sum, trip) => sum + trip.km, 0);

  function changePurpose(purpose: TripPurpose) {
    setTrips((current) => current.map((trip) => trip.id === selectedId ? { ...trip, purpose } : trip));
    setNotice("Formålet er endret i demoen. Endringen gjelder bare denne visningen.");
  }

  function exportCsv() {
    const rows = visible.map((trip) => ["2026-10-12", trip.time, trip.from, trip.to, trip.km.toString().replace(".", ","), trip.purpose === "WORK" ? "Jobb" : "Privat", trip.note]);
    const content = "\uFEFF" + [["DEMO – fiktive eksempeldata"], ["Dato", "Tid", "Fra", "Til", "Km", "Formål", "Notat"], ...rows]
      .map((row) => row.map((cell) => '"' + cell.replaceAll('"', '""') + '"').join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "kjorebok-demo.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("CSV med fiktive turer er lastet ned.");
  }

  function reset() {
    setTrips(structuredClone(EXAMPLE_TRIPS));
    setFilter("ALL");
    setSelectedId(EXAMPLE_TRIPS[0].id);
    setNotice("Demoen er nullstilt.");
  }

  return (
    <main className={styles.demo}>
      <nav className={styles.nav} aria-label="Hovedmeny">
        <Link href="/demo" className={styles.brand}>Kjørebok<span>DEMO</span></Link>
        <div><a href="https://nguyenchu.com/">Portefølje ↗</a><Link href="/login">Logg inn</Link></div>
      </nav>
      <header className={styles.header}>
        <p className={styles.eyebrow}>PRØV UTEN KONTO</p>
        <h1>En kjørebok du kan utforske.</h1>
        <p>Velg en tur, se eksempelruten og bytt mellom jobb og privat. Eksporter utvalget som CSV.</p>
      </header>
      <aside className={styles.banner}>
        <div><strong>Fiktive eksempeldata</strong><p>Turene og rutene er laget for demonstrasjon. Endringer blir bare i denne visningen. GPS-opptak og innlogging inngår ikke i demoen.</p></div>
        <button onClick={reset}>Nullstill demo</button>
      </aside>
      <section className={styles.stats} aria-label="Oppsummering av alle demoturer">
        <div><span>Registrerte turer</span><strong>{trips.length}</strong></div>
        <div><span>Totalt</span><strong>{formatKm(totalKm)} <small>km</small></strong></div>
        <div><span>Jobb</span><strong>{formatKm(workKm)} <small>km</small></strong></div>
        <div><span>Privat</span><strong>{formatKm(totalKm - workKm)} <small>km</small></strong></div>
      </section>
      <div className={styles.toolbar}>
        <div><h2>Turlogg</h2><p>Mandag 12. oktober 2026 · {visible.length} av {trips.length} turer</p></div>
        <button onClick={exportCsv}>Eksporter CSV ↓</button>
      </div>
      <div className={styles.filters} aria-label="Filtrer turer">
        {([['ALL', 'Alle'], ['WORK', 'Jobb'], ['PRIVATE', 'Privat']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      <div className={styles.workspace}>
        <section aria-label="Turer" className={styles.trips}>
          {visible.length === 0 && <p>Ingen turer i dette utvalget. Velg et annet filter eller nullstill demoen.</p>}
          {visible.map((trip) => <button key={trip.id} aria-pressed={selectedId === trip.id} className={styles.trip} onClick={() => { setSelectedId(trip.id); setNotice(""); }}>
            <span className={styles.tripTop}><span>{trip.time} · {trip.minutes} min</span><span className={styles.badge}>{trip.purpose === "WORK" ? "Jobb" : "Privat"}</span></span>
            <strong>{trip.from}<span className={styles.arrow}>↓</span>{trip.to}</strong>
            <span className={styles.tripBottom}><span>{trip.note}</span><b>{formatKm(trip.km)} km</b></span>
          </button>)}
        </section>
        <section className={styles.detail} aria-label="Valgt tur">
          <div className={styles.detailHeader}><p className={styles.eyebrow}>VALGT TUR</p><h2>{selected.from} → {selected.to}</h2><p>{selected.time} · {selected.minutes} min · {formatKm(selected.km)} km</p></div>
          <div className={styles.map}><TripMap key={selected.id} route={makeRoute(selected)} /></div>
          <div className={styles.detailBody}>
            <p className={styles.caption}>Illustrert eksempelrute mellom offentlige steder. Linjen er ikke et GPS-opptak.</p>
            <fieldset><legend>Formål</legend><div className={styles.filters}>
              <button aria-pressed={selected.purpose === "WORK"} onClick={() => changePurpose("WORK")}>Jobb</button>
              <button aria-pressed={selected.purpose === "PRIVATE"} onClick={() => changePurpose("PRIVATE")}>Privat</button>
            </div></fieldset>
            <p>{selected.note}</p>
          </div>
        </section>
      </div>
      <p className={styles.notice} role="status">{notice}</p>
      <footer className={styles.footer}><div><h2>Fra mobil til kart og rapport.</h2><p>Hele prosjektet består av en Expo-app, en Next.js-webapp og et Fastify-API med PostgreSQL.</p></div><div><a href="https://nguyenchu.com/prosjekter/kjorebok.html">Les prosjektgjennomgangen ↗</a><a href="https://github.com/nguyenchu/kjorebok">Se kildekoden ↗</a></div></footer>
    </main>
  );
}
