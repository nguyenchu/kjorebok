import type { Metadata } from "next";
import Demo from "./Demo";

export const metadata: Metadata = {
  title: "Prøv Kjørebok – interaktiv demo",
  description: "Utforsk turer, kart og kategorisering med fiktive eksempeldata. Ingen konto nødvendig.",
};

export default function DemoPage() {
  return <Demo />;
}
