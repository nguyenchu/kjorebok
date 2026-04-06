import { useEffect, useState, useCallback } from "react";
import { View, Text, FlatList, StyleSheet, RefreshControl } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { api } from "@/lib/api";
import type { TripSummary } from "@kjorebok/shared";
import { addDays, differenceInCalendarDays, format, isToday, isYesterday, parseISO, startOfDay } from "date-fns";
import { nb } from "date-fns/locale";

type DayGroup = {
  day: Date;
  trips: TripSummary[];
  lastKnownAddress: string | null;
};

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDayHeader(date: Date): string {
  if (isToday(date)) return "I dag";
  if (isYesterday(date)) return "I går";
  return format(date, "EEEE d. MMMM", { locale: nb });
}

function getTripAddress(trip: TripSummary): string | null {
  return trip.endAddress ?? trip.startAddress ?? null;
}

function groupTripsByDay(trips: TripSummary[]): DayGroup[] {
  if (trips.length === 0) return [];

  const today = startOfDay(new Date());
  const earliestTripDay = startOfDay(
    trips.reduce((earliest, trip) => {
      const tripDate = parseISO(trip.startedAt);
      return tripDate < earliest ? tripDate : earliest;
    }, parseISO(trips[0].startedAt)),
  );
  const maxDays = Math.min(differenceInCalendarDays(today, earliestTripDay), 13);
  const groups: Map<string, TripSummary[]> = new Map();

  for (const trip of trips) {
    const key = format(parseISO(trip.startedAt), "yyyy-MM-dd");
    const existing = groups.get(key);
    if (existing) {
      existing.push(trip);
    } else {
      groups.set(key, [trip]);
    }
  }

  return Array.from({ length: maxDays + 1 }, (_, offset) => {
    const day = addDays(today, -offset);
    const key = format(day, "yyyy-MM-dd");
    const dayTrips = groups.get(key) ?? [];
    const dayStart = day.getTime();
    const previousTrip = trips.find((trip) => parseISO(trip.startedAt).getTime() < dayStart && getTripAddress(trip));

    return {
      day,
      trips: dayTrips,
      lastKnownAddress: previousTrip ? getTripAddress(previousTrip) : null,
    };
  });
}

function TripTimelineItem({ trip, isLast }: { trip: TripSummary; isLast: boolean }) {
  const isActive = trip.status === "ACTIVE";
  const time = format(parseISO(trip.startedAt), "HH:mm", { locale: nb });

  return (
    <View style={styles.timelineItem}>
      <View style={styles.timelineLeft}>
        <Text style={styles.timelineTime}>{time}</Text>
      </View>
      <View style={styles.timelineCenter}>
        <View style={[styles.timelineDot, isActive && styles.timelineDotActive]} />
        {!isLast && <View style={styles.timelineLine} />}
      </View>
      <View style={styles.timelineCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.distance}>{formatDistance(trip.distanceMeters)}</Text>
          {isActive && (
            <View style={styles.activeBadge}>
              <View style={styles.activeBadgeDot} />
              <Text style={styles.activeBadgeText}>Aktiv</Text>
            </View>
          )}
        </View>
        <Text style={styles.route} numberOfLines={2}>
          {trip.startAddress ?? "Ukjent start"}
        </Text>
        {trip.endAddress && (
          <View style={styles.destinationRow}>
            <Text style={styles.arrow}>→</Text>
            <Text style={styles.route} numberOfLines={2}>{trip.endAddress}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function EmptyDayItem({ lastKnownAddress }: { lastKnownAddress: string | null }) {
  return (
    <View style={styles.emptyDayCard}>
      <Text style={styles.emptyDayTitle}>Ingen turer registrert</Text>
      {lastKnownAddress && (
        <Text style={styles.emptyDayText}>Siste registrerte stopp før dagen: {lastKnownAddress}</Text>
      )}
    </View>
  );
}

export default function TripsScreen() {
  const tabBarHeight = useBottomTabBarHeight();
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

  const grouped = groupTripsByDay(trips);

  return (
    <FlatList
      data={grouped}
      keyExtractor={(group) => group.day.toISOString()}
      style={styles.container}
      contentContainerStyle={[styles.list, { paddingBottom: tabBarHeight + 24 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🚗</Text>
          <Text style={styles.emptyTitle}>Ingen turer ennå</Text>
          <Text style={styles.emptySubtitle}>
            {error ?? "Turene dine vises her når mobilen registrerer bevegelse"}
          </Text>
        </View>
      }
      renderItem={({ item: group }) => (
        <View style={styles.dayGroup}>
          <Text style={styles.dayHeader}>{formatDayHeader(group.day)}</Text>
          {group.trips.length === 0 ? (
            <EmptyDayItem lastKnownAddress={group.lastKnownAddress} />
          ) : (
            group.trips.map((trip, i) => (
              <TripTimelineItem
                key={trip.id}
                trip={trip}
                isLast={i === group.trips.length - 1}
              />
            ))
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  list: { padding: 16, paddingBottom: 32 },
  dayGroup: { marginBottom: 24 },
  dayHeader: {
    fontSize: 15,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "capitalize",
    marginBottom: 12,
    marginLeft: 4,
  },
  timelineItem: {
    flexDirection: "row",
    minHeight: 80,
  },
  timelineLeft: {
    width: 48,
    paddingTop: 2,
  },
  timelineTime: {
    fontSize: 13,
    fontWeight: "600",
    color: "#94a3b8",
  },
  timelineCenter: {
    width: 24,
    alignItems: "center",
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#cbd5e1",
    borderWidth: 2,
    borderColor: "#f8fafc",
    zIndex: 1,
  },
  timelineDotActive: {
    backgroundColor: "#2563eb",
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: "#e2e8f0",
    marginTop: -1,
    marginBottom: -1,
  },
  timelineCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginLeft: 10,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  emptyDayCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "dashed",
  },
  emptyDayTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a", marginBottom: 4 },
  emptyDayText: { fontSize: 14, color: "#64748b", lineHeight: 20 },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  distance: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#eff6ff",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  activeBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#2563eb",
  },
  activeBadgeText: { fontSize: 12, fontWeight: "600", color: "#2563eb" },
  route: { fontSize: 14, color: "#475569", lineHeight: 20 },
  destinationRow: { flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 2 },
  arrow: { fontSize: 14, color: "#94a3b8", marginTop: 1 },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 100,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: "#0f172a", marginBottom: 8 },
  emptySubtitle: { fontSize: 15, color: "#94a3b8", textAlign: "center", maxWidth: 260 },
});
