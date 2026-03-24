import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Kjørebok",
  description: "GPS-basert kjørebok for skattefradrag og kjøregodtgjørelse",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
