import { useEffect, useState, useCallback } from "react";
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from "react-native";
import { api } from "@/lib/api";
import type { TripSummary } from "@kjorebok/shared";
import { format } from "date-fns";
import { nb } from "date-fns/locale";

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export default function TripsScreen() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<TripSummary[]>("/trips");
      setTrips(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <FlatList
      data={trips}
      keyExtractor={(t) => t.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <Text style={styles.empty}>
          {error ?? "Ingen turer ennå. Aktiver sporing for å registrere turer."}
        </Text>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.distance}>{formatDistance(item.distanceMeters)}</Text>
            <View style={[styles.badge, item.status === "ACTIVE" && styles.badgeActive]}>
              <Text style={styles.badgeText}>{item.status === "ACTIVE" ? "Aktiv" : "Fullført"}</Text>
            </View>
          </View>
          <Text style={styles.route}>
            {item.startAddress ?? "Ukjent"} → {item.endAddress ?? "Ukjent"}
          </Text>
          <Text style={styles.date}>
            {format(new Date(item.startedAt), "d. MMM yyyy HH:mm", { locale: nb })}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  empty: { textAlign: "center", color: "#64748b", marginTop: 60 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  distance: { fontSize: 20, fontWeight: "700" },
  badge: { backgroundColor: "#e2e8f0", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeActive: { backgroundColor: "#dbeafe" },
  badgeText: { fontSize: 12, fontWeight: "600", color: "#1e293b" },
  route: { color: "#334155", marginBottom: 4 },
  date: { color: "#94a3b8", fontSize: 12 },
});
