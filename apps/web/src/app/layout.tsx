import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kjørebok",
  description: "GPS-basert kjørebok for skattefradrag og kjøregodtgjørelse",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb">
      <body>{children}</body>
    </html>
  );
}
