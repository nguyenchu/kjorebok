import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import MapView, { Polyline, Marker } from "react-native-maps";
import { api } from "@/lib/api";
import type { Trip } from "@kjorebok/shared";

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

  const coordinates = trip?.route.map((p) => ({ latitude: p.lat, longitude: p.lng })) ?? [];
  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];

  const region = coordinates.length > 0
    ? {
        latitude: coordinates.reduce((s, c) => s + c.latitude, 0) / coordinates.length,
        longitude: coordinates.reduce((s, c) => s + c.longitude, 0) / coordinates.length,
        latitudeDelta: Math.max(...coordinates.map((c) => c.latitude)) - Math.min(...coordinates.map((c) => c.latitude)) + 0.01,
        longitudeDelta: Math.max(...coordinates.map((c) => c.longitude)) - Math.min(...coordinates.map((c) => c.longitude)) + 0.01,
      }
    : undefined;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: trip
            ? `${trip.startAddress ?? "Ukjent start"} → ${trip.endAddress ?? "Ukjent slutt"}`
            : "Tur",
          headerBackTitle: "Tilbake",
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

      {trip && region && (
        <>
          <MapView style={styles.map} initialRegion={region}>
            <Polyline coordinates={coordinates} strokeColor="#2563eb" strokeWidth={4} />
            {start && <Marker coordinate={start} pinColor="green" />}
            {end && coordinates.length > 1 && <Marker coordinate={end} pinColor="red" />}
          </MapView>
          <View style={styles.info}>
            <Text style={styles.infoDistance}>{(trip.distanceMeters / 1000).toFixed(1)} km</Text>
            <Text style={styles.infoMeta}>{trip.route.length} GPS-punkter · {trip.purpose === "WORK" ? "Jobb" : "Privat"}</Text>
          </View>
        </>
      )}

      {trip && !region && (
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
