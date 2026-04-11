import { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, FlatList, StyleSheet, RefreshControl, ScrollView, TouchableOpacity, Alert } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { router } from "expo-router";
import { api } from "@/lib/api";
import type { TripPurpose, TripSummary } from "@kjorebok/shared";
import { addDays, addWeeks, differenceInCalendarWeeks, format, isSameDay, isToday, isYesterday, parseISO, startOfDay, startOfMonth, startOfWeek, subMonths } from "date-fns";
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

function formatDayTabLabel(date: Date): string {
  if (isToday(date)) return "I dag";
  if (isYesterday(date)) return "I går";
  return format(date, "EEEE", { locale: nb });
}

function formatDayTabMeta(date: Date): string {
  return format(date, "d. MMM", { locale: nb });
}

function getTripAddress(trip: TripSummary): string | null {
  return trip.endAddress ?? trip.startAddress ?? null;
}

function getWeekStart(weekOffset: number): Date {
  return startOfWeek(addWeeks(new Date(), -weekOffset), { weekStartsOn: 1 });
}

function buildWeekGroups(trips: TripSummary[], weekOffset: number): DayGroup[] {
  const weekStart = getWeekStart(weekOffset);
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

  return Array.from({ length: 7 }, (_, offset) => {
    const day = addDays(weekStart, offset);
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

function getMaxWeekOffset(trips: TripSummary[]): number {
  if (trips.length === 0) return 0;

  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const earliestTripDay = startOfDay(
    trips.reduce((earliest, trip) => {
      const tripDate = parseISO(trip.startedAt);
      return tripDate < earliest ? tripDate : earliest;
    }, parseISO(trips[0].startedAt)),
  );

  return Math.max(
    0,
    differenceInCalendarWeeks(currentWeekStart, startOfWeek(earliestTripDay, { weekStartsOn: 1 }), { weekStartsOn: 1 }),
  );
}

function formatWindowRange(groups: DayGroup[]): string {
  if (groups.length === 0) return "";

  const firstDay = groups[0].day;
  const lastDay = groups[groups.length - 1].day;
  const sameMonth = format(firstDay, "yyyy-MM", { locale: nb }) === format(lastDay, "yyyy-MM", { locale: nb });

  if (sameMonth) {
    return `${format(firstDay, "d.", { locale: nb })}–${format(lastDay, "d. MMMM yyyy", { locale: nb })}`;
  }

  return `${format(firstDay, "d. MMM", { locale: nb })}–${format(lastDay, "d. MMM yyyy", { locale: nb })}`;
}

function TripTimelineItem({ trip, isLast, onDelete, onSetPurpose, onPress }: { trip: TripSummary; isLast: boolean; onDelete: (id: string) => void; onSetPurpose: (id: string, purpose: TripPurpose) => void; onPress: (id: string) => void }) {
  const isActive = trip.status === "ACTIVE";
  const time = format(parseISO(trip.startedAt), "HH:mm", { locale: nb });

  const handleLongPress = () => {
    const nextPurpose: TripPurpose = trip.purpose === "PRIVATE" ? "WORK" : "PRIVATE";
    const nextLabel = nextPurpose === "WORK" ? "Jobb" : "Privat";
    Alert.alert(trip.purpose === "PRIVATE" ? "Privat tur" : "Jobbreise", undefined, [
      { text: `Merk som ${nextLabel}`, onPress: () => onSetPurpose(trip.id, nextPurpose) },
      { text: "Slett tur", style: "destructive", onPress: () => onDelete(trip.id) },
      { text: "Avbryt", style: "cancel" },
    ]);
  };

  return (
    <View style={styles.timelineItem}>
      <View style={styles.timelineLeft}>
        <Text style={styles.timelineTime}>{time}</Text>
      </View>
      <View style={styles.timelineCenter}>
        <View style={[styles.timelineDot, isActive && styles.timelineDotActive]} />
        {!isLast && <View style={styles.timelineLine} />}
      </View>
      <TouchableOpacity style={styles.timelineCard} onPress={() => onPress(trip.id)} onLongPress={handleLongPress} activeOpacity={0.85}>
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
      </TouchableOpacity>
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
  const dayTabsRef = useRef<ScrollView>(null);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0);
  const [selectedDayKey, setSelectedDayKey] = useState(format(new Date(), "yyyy-MM-dd"));

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.delete(`/trips/${id}`);
      setTrips((prev) => prev.filter((t) => t.id !== id));
    } catch (e: any) {
      Alert.alert("Feil", e.message ?? "Kunne ikke slette turen.");
    }
  }, []);

  const handlePurpose = useCallback(async (id: string, purpose: TripPurpose) => {
    try {
      await api.patch(`/trips/${id}`, { purpose });
      setTrips((prev) => prev.map((t) => t.id === id ? { ...t, purpose } : t));
    } catch (e: any) {
      Alert.alert("Feil", e.message ?? "Kunne ikke oppdatere formål.");
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.get<TripSummary[]>("/trips");
      setTrips(data.filter((t) => t.status === "ACTIVE" || t.distanceMeters > 0));
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

  const grouped = buildWeekGroups(trips, selectedWeekOffset);
  const maxWeekOffset = getMaxWeekOffset(trips);
  const selectedGroup = grouped.find((group) => format(group.day, "yyyy-MM-dd") === selectedDayKey) ?? grouped[0] ?? null;
  const selectedTrips = selectedGroup?.trips ?? [];
  const windowLabel = formatWindowRange(grouped);
  const currentWeekStart = getWeekStart(0);
  const displayedWeekStart = getWeekStart(selectedWeekOffset);
  const previousMonthWeekOffset = Math.min(
    maxWeekOffset,
    Math.max(
      0,
      differenceInCalendarWeeks(
        currentWeekStart,
        startOfWeek(startOfMonth(subMonths(displayedWeekStart, 1)), { weekStartsOn: 1 }),
        { weekStartsOn: 1 },
      ),
    ),
  );

  useEffect(() => {
    if (selectedWeekOffset > maxWeekOffset) {
      setSelectedWeekOffset(maxWeekOffset);
    }
  }, [maxWeekOffset, selectedWeekOffset]);

  useEffect(() => {
    requestAnimationFrame(() => {
      dayTabsRef.current?.scrollToEnd({ animated: false });
    });
  }, [selectedWeekOffset]);

  useEffect(() => {
    if (grouped.length === 0) return;

    const hasSelectedDay = grouped.some((group) => format(group.day, "yyyy-MM-dd") === selectedDayKey);
    if (hasSelectedDay) return;

    setSelectedDayKey(
      selectedWeekOffset === 0
        ? format(new Date(), "yyyy-MM-dd")
        : format(grouped[0].day, "yyyy-MM-dd"),
    );
  }, [grouped, selectedDayKey, selectedWeekOffset]);

  return (
    <FlatList
      data={selectedTrips}
      keyExtractor={(trip) => trip.id}
      style={styles.container}
      contentContainerStyle={[styles.list, { paddingBottom: tabBarHeight + 24 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        grouped.length > 0 ? (
          <View style={styles.header}>
            <View style={styles.paginationRow}>
              <View>
                <Text style={styles.sectionLabel}>Historikk</Text>
                <Text style={styles.windowLabel}>{windowLabel}</Text>
                <TouchableOpacity
                  onPress={() => setSelectedWeekOffset(previousMonthWeekOffset)}
                  disabled={previousMonthWeekOffset === selectedWeekOffset}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.jumpLink, previousMonthWeekOffset === selectedWeekOffset && styles.jumpLinkDisabled]}>
                    Hopp til forrige måned
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.paginationButtons}>
                <TouchableOpacity
                  style={[styles.navButton, selectedWeekOffset >= maxWeekOffset && styles.navButtonDisabled]}
                  onPress={() => setSelectedWeekOffset((current) => Math.min(current + 1, maxWeekOffset))}
                  disabled={selectedWeekOffset >= maxWeekOffset}
                  activeOpacity={0.85}
                >
                  <Text style={styles.navButtonText}>Eldre</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.navButtonPrimary, selectedWeekOffset === 0 && styles.navButtonDisabled]}
                  onPress={() => setSelectedWeekOffset((current) => Math.max(current - 1, 0))}
                  disabled={selectedWeekOffset === 0}
                  activeOpacity={0.85}
                >
                  <Text style={styles.navButtonPrimaryText}>
                    {selectedWeekOffset <= 1 ? "Denne uken" : "Nyere"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView
              ref={dayTabsRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dayTabs}
            >
              {grouped.map((group) => {
                const isSelected = selectedGroup ? isSameDay(group.day, selectedGroup.day) : false;

                return (
                  <TouchableOpacity
                    key={group.day.toISOString()}
                    style={[styles.dayTab, isSelected && styles.dayTabSelected]}
                    onPress={() => setSelectedDayKey(format(group.day, "yyyy-MM-dd"))}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.dayTabLabel, isSelected && styles.dayTabLabelSelected]}>
                      {formatDayTabLabel(group.day)}
                    </Text>
                    <Text style={[styles.dayTabMeta, isSelected && styles.dayTabMetaSelected]}>
                      {formatDayTabMeta(group.day)}
                    </Text>
                    {group.trips.length > 0 && (
                      <View style={[styles.dayTabBadge, isSelected && styles.dayTabBadgeSelected]}>
                        <Text style={[styles.dayTabBadgeText, isSelected && styles.dayTabBadgeTextSelected]}>
                          {group.trips.length}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {selectedGroup && <Text style={styles.dayHeader}>{formatDayHeader(selectedGroup.day)}</Text>}
          </View>
        ) : null
      }
      ListEmptyComponent={
        grouped.length > 0 && selectedGroup ? (
          <EmptyDayItem lastKnownAddress={selectedGroup.lastKnownAddress} />
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🚗</Text>
            <Text style={styles.emptyTitle}>Ingen turer ennå</Text>
            <Text style={styles.emptySubtitle}>
              {error ?? "Turene dine vises her når mobilen registrerer bevegelse"}
            </Text>
          </View>
        )
      }
      renderItem={({ item: trip, index }) => (
        <TripTimelineItem
          trip={trip}
          isLast={index === selectedTrips.length - 1}
          onDelete={handleDelete}
          onSetPurpose={handlePurpose}
          onPress={(id) => router.push(`/trip/${id}`)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  list: { padding: 16, paddingBottom: 32 },
  header: { marginBottom: 16 },
  paginationRow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 12,
    marginBottom: 12,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#64748b",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  windowLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0f172a",
  },
  jumpLink: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: "700",
    color: "#2563eb",
  },
  jumpLinkDisabled: {
    color: "#94a3b8",
  },
  paginationButtons: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  navButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: "100%",
  },
  navButtonDisabled: {
    opacity: 0.45,
  },
  navButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  navButtonPrimary: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#0f172a",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: "100%",
  },
  navButtonPrimaryText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
    flexShrink: 1,
  },
  dayTabs: { gap: 10, paddingRight: 16, paddingBottom: 16 },
  dayTab: {
    minWidth: 94,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    position: "relative",
  },
  dayTabSelected: {
    backgroundColor: "#0f172a",
    borderColor: "#0f172a",
  },
  dayTabLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0f172a",
    textTransform: "capitalize",
    marginBottom: 2,
  },
  dayTabLabelSelected: { color: "#fff" },
  dayTabMeta: { fontSize: 12, fontWeight: "600", color: "#94a3b8" },
  dayTabMetaSelected: { color: "#cbd5e1" },
  dayTabBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#e0f2fe",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  dayTabBadgeSelected: { backgroundColor: "#38bdf8" },
  dayTabBadgeText: { fontSize: 11, fontWeight: "800", color: "#0369a1" },
  dayTabBadgeTextSelected: { color: "#082f49" },
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
