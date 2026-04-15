import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { WebView } from "react-native-webview";
import { api } from "@/lib/api";
import type { Trip } from "@kjorebok/shared";

function buildMapHtml(coordinates: { lat: number; lng: number }[]): string {
  const latlngs = JSON.stringify(coordinates.map((p) => [p.lat, p.lng]));
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var latlngs = ${latlngs};
    var map = L.map('map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);
    var line = L.polyline(latlngs, { color: '#2563eb', weight: 4, opacity: 0.85 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [24, 24] });
    if (latlngs.length > 0) {
      L.circleMarker(latlngs[0], { radius: 7, color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1 }).addTo(map);
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, color: '#dc2626', fillColor: '#dc2626', fillOpacity: 1 }).addTo(map);
    }
  </script>
</body>
</html>`;
}

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Trip>(`/trips/${id}`)
      .then(setTrip)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const hasRoute = (trip?.route.length ?? 0) > 0;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: trip
            ? `${trip.startAddress ?? "Ukjent start"} → ${trip.endAddress ?? "Ukjent slutt"}`
            : "Tur",
          headerBackTitle: "Tilbake",
          headerStyle: { backgroundColor: "#eef6ff" },
          headerShadowVisible: false,
          headerTintColor: "#0f172a",
          headerTitleStyle: { fontWeight: "700", fontSize: 18, color: "#0f172a" },
        }}
      />

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      )}

      {error && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {trip && hasRoute && (
        <>
          <WebView
            style={styles.map}
            source={{ html: buildMapHtml(trip.route) }}
            originWhitelist={["*"]}
            scrollEnabled={false}
          />
          <View style={styles.info}>
            <Text style={styles.infoDistance}>{(trip.distanceMeters / 1000).toFixed(1)} km</Text>
            <Text style={styles.infoMeta}>{trip.route.length} GPS-punkter · {trip.purpose === "WORK" ? "Jobb" : "Privat"}</Text>
          </View>
        </>
      )}

      {trip && !hasRoute && (
        <View style={styles.center}>
          <Text style={styles.errorText}>Ingen GPS-punkter registrert for denne turen.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  map: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 15, color: "#64748b", textAlign: "center" },
  info: {
    backgroundColor: "#fff",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  infoDistance: { fontSize: 22, fontWeight: "800", color: "#0f172a", marginBottom: 4 },
  infoMeta: { fontSize: 14, color: "#64748b" },
});
