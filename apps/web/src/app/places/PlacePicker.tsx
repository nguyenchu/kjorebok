"use client";
import { useEffect, useRef } from "react";

interface Props {
  lat: number;
  lng: number;
  radiusMeters: number;
  onChange: (lat: number, lng: number) => void;
}

const DEFAULT_CENTER: [number, number] = [59.9139, 10.7522]; // Oslo

export default function PlacePicker({ lat, lng, radiusMeters, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const initial: [number, number] = lat !== 0 || lng !== 0 ? [lat, lng] : DEFAULT_CENTER;
      const map = L.map(containerRef.current).setView(initial, 14);
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
      }).addTo(map);

      if (lat !== 0 || lng !== 0) {
        markerRef.current = L.marker([lat, lng]).addTo(map);
        circleRef.current = L.circle([lat, lng], {
          radius: radiusMeters,
          color: "#2563eb",
          fillColor: "#2563eb",
          fillOpacity: 0.15,
        }).addTo(map);
      }

      map.on("click", (e: any) => {
        onChangeRef.current(e.latlng.lat, e.latlng.lng);
      });
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || (lat === 0 && lng === 0)) return;
    import("leaflet").then((L) => {
      if (!mapRef.current) return;
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng]).addTo(map);
      }
      if (circleRef.current) {
        circleRef.current.setLatLng([lat, lng]);
        circleRef.current.setRadius(radiusMeters);
      } else {
        circleRef.current = L.circle([lat, lng], {
          radius: radiusMeters,
          color: "#2563eb",
          fillColor: "#2563eb",
          fillOpacity: 0.15,
        }).addTo(map);
      }
    });
  }, [lat, lng, radiusMeters]);

  return <div ref={containerRef} style={{ height: "100%", width: "100%", borderRadius: "inherit" }} />;
}
