import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import { AuthProvider } from "@/lib/auth";
import { Suspense } from "react";
import GoogleAnalytics from "@/lib/GoogleAnalytics";

export const metadata: Metadata = {
  title: "Kjørebok",
  description: "GPS-basert kjørebok for skattefradrag og kjøregodtgjørelse",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_ID ?? "G-0TCDVT4KW9";

  return (
    <html lang="nb">
      <body>
        <AuthProvider>{children}</AuthProvider>
        <Suspense fallback={null}>
          <GoogleAnalytics measurementId={gaMeasurementId} />
        </Suspense>
      </body>
    </html>
  );
}
