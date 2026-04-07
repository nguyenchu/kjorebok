"use client";
import { useEffect, useRef } from "react";
import type { GpsPoint } from "@kjorebok/shared";

interface Props {
  route: GpsPoint[];
}

export default function TripMap({ route }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || route.length === 0) return;

    let map: any;

    import("leaflet").then((L) => {
      if (!containerRef.current) return;

      // Fix default marker icons
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const latlngs = route.map((p) => [p.lat, p.lng] as [number, number]);
      map = L.map(containerRef.current).fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
      }).addTo(map);

      L.polyline(latlngs, { color: "#2563eb", weight: 4, opacity: 0.85 }).addTo(map);

      if (latlngs.length > 0) {
        L.circleMarker(latlngs[0], { radius: 7, color: "#16a34a", fillColor: "#16a34a", fillOpacity: 1 }).addTo(map);
        L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, color: "#dc2626", fillColor: "#dc2626", fillOpacity: 1 }).addTo(map);
      }
    });

    return () => {
      map?.remove();
    };
  }, [route]);

  if (route.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>
        Ingen GPS-punkter registrert
      </div>
    );
  }

  return <div ref={containerRef} style={{ height: "100%", borderRadius: "inherit" }} />;
}
