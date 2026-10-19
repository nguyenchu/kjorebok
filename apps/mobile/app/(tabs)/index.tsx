import { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Alert } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
// The Animated-based Swipeable, not the Reanimated one. ReanimatedSwipeable
// renders without complaint here but never responds to a drag, even with
// react-native-worklets installed — so the cause is something else in this
// gesture-handler 2.28 / Reanimated 4 combination, not just the missing
// worklet runtime. This variant is deprecated but works; revisit when the
// libraries move on.
import Swipeable from "react-native-gesture-handler/Swipeable";
import { router, useFocusEffect } from "expo-router";
import { api } from "@/lib/api";
import { getTrackerState } from "@/lib/tripTracker";
import { assessTrackerHealth, type TrackerHealth } from "@/lib/trackerHealth";
import { useOnAppActive } from "@/lib/useOnAppActive";
import type { TripMode, TripPurpose, TripSummary } from "@kjorebok/shared";
import { addDays, addWeeks, differenceInCalendarWeeks, format, isSameDay, isToday, isYesterday, parseISO, startOfDay, startOfWeek, subDays } from "date-fns";
import { nb } from "date-fns/locale";

type DayGroup = {
  day: Date;
  trips: TripSummary[];
  lastKnownAddress: string | null;
};

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function isDayBeforeYesterday(date: Date): boolean {
  return isSameDay(date, subDays(new Date(), 2));
}

function formatDayHeader(date: Date): string {
  if (isToday(date)) return "I dag";
  if (isYesterday(date)) return "I går";
  if (isDayBeforeYesterday(date)) return "Forgårs";
  const label = format(date, "EEEE d. MMMM", { locale: nb });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getTripAddress(trip: TripSummary): string | null {
  return trip.endPlace?.label ?? trip.endAddress ?? trip.startPlace?.label ?? trip.startAddress ?? null;
}

function getTripStartLabel(trip: TripSummary): string {
  return trip.startPlace?.label ?? trip.startAddress ?? "Ukjent start";
}

function getTripEndLabel(trip: TripSummary): string | null {
  return trip.endPlace?.label ?? trip.endAddress ?? null;
}

function getWeekStart(weekOffset: number): Date {
  return startOfWeek(addWeeks(new Date(), -weekOffset), { weekStartsOn: 1 });
}

function buildWeekGroups(trips: TripSummary[], weekOffset: number): DayGroup[] {
  const weekStart = getWeekStart(weekOffset);
  const today = startOfDay(new Date());
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
    if (weekOffset === 0 && day > today) return null;
    const key = format(day, "yyyy-MM-dd");
    const dayTrips = [...(groups.get(key) ?? [])].sort(
      (a, b) => parseISO(a.startedAt).getTime() - parseISO(b.startedAt).getTime(),
    );
    const dayStart = day.getTime();
    const previousTrip = trips.find((trip) => parseISO(trip.startedAt).getTime() < dayStart && getTripAddress(trip));

    return {
      day,
      trips: dayTrips,
      lastKnownAddress: previousTrip ? getTripAddress(previousTrip) : null,
    };
  }).filter((g): g is DayGroup => g !== null);
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

function formatWeekRange(weekStart: Date): string {
  const firstDay = weekStart;
  const lastDay = addDays(weekStart, 6);
  const sameMonth = format(firstDay, "yyyy-MM", { locale: nb }) === format(lastDay, "yyyy-MM", { locale: nb });

  if (sameMonth) {
    return `${format(firstDay, "d.", { locale: nb })}–${format(lastDay, "d. MMMM yyyy", { locale: nb })}`;
  }

  return `${format(firstDay, "d. MMM", { locale: nb })}–${format(lastDay, "d. MMM yyyy", { locale: nb })}`;
}

const MODE_ICONS: Record<TripMode, string> = {
  WALK: "🚶",
  CYCLE: "🚴",
  EBIKE: "⚡",
  CAR: "🚗",
  OTHER: "📍",
};

const MODE_LABELS: Record<TripMode, string> = {
  WALK: "Gåtur",
  CYCLE: "Sykkeltur",
  EBIKE: "Elsykkel",
  CAR: "Kjøretur",
  OTHER: "Annet",
};

const ALL_MODES: TripMode[] = ["CAR", "WALK", "CYCLE", "EBIKE", "OTHER"];

function TripTimelineItem({ trip, isLast, onDelete, onSetPurpose, onSetMode, onPress }: { trip: TripSummary; isLast: boolean; onDelete: (id: string) => void; onSetPurpose: (id: string, purpose: TripPurpose) => void; onSetMode: (id: string, mode: TripMode) => void; onPress: (id: string) => void }) {
  const isActive = trip.status === "ACTIVE";
  const startTime = format(parseISO(trip.startedAt), "HH:mm", { locale: nb });
  const endTime = trip.endedAt ? format(parseISO(trip.endedAt), "HH:mm", { locale: nb }) : null;
  const mode: TripMode = trip.mode ?? "CAR";
  const swipeRef = useRef<Swipeable>(null);

  const handleLongPress = () => {
    const nextPurpose: TripPurpose = trip.purpose === "PRIVATE" ? "WORK" : "PRIVATE";
    const nextPurposeLabel = nextPurpose === "WORK" ? "Jobb" : "Privat";
    const modeOptions = ALL_MODES.filter((m) => m !== mode).map((m) => ({
      text: `${MODE_ICONS[m]} ${MODE_LABELS[m]}`,
      onPress: () => onSetMode(trip.id, m),
    }));
    Alert.alert(
      `${MODE_ICONS[mode]} ${MODE_LABELS[mode]} · ${trip.purpose === "PRIVATE" ? "Privat" : "Jobb"}`,
      undefined,
      [
        { text: `Merk som ${nextPurposeLabel}`, onPress: () => onSetPurpose(trip.id, nextPurpose) },
        ...modeOptions,
        { text: "Slett tur", style: "destructive", onPress: () => onDelete(trip.id) },
        { text: "Avbryt", style: "cancel" },
      ],
    );
  };

  return (
    <View style={styles.timelineItem}>
      <View style={styles.timelineLeft}>
        <Text style={styles.timelineTime}>{startTime}</Text>
        {endTime && <Text style={styles.timelineTimeEnd}>{endTime}</Text>}
      </View>
      <View style={styles.timelineCenter}>
        <View style={[styles.timelineDot, isActive && styles.timelineDotActive]} />
        {!isLast && <View style={styles.timelineLine} />}
      </View>
      <Swipeable
        ref={swipeRef}
        // The card carries flex: 1 to fill the row next to the timeline rail;
        // without this the wrapper collapses to content width and the card
        // overflows the screen edge.
        containerStyle={styles.swipeContainer}
        friction={2}
        leftThreshold={72}
        rightThreshold={72}
        overshootLeft={false}
        overshootRight={false}
        renderLeftActions={() => <SwipeAction purpose="WORK" />}
        renderRightActions={() => <SwipeAction purpose="PRIVATE" />}
        onSwipeableOpen={(direction) => {
          // Dragging right reveals the left pane, and vice versa.
          const next: TripPurpose = direction === "left" ? "WORK" : "PRIVATE";
          swipeRef.current?.close();
          if (next !== trip.purpose) onSetPurpose(trip.id, next);
        }}
      >
        <TouchableOpacity style={styles.timelineCard} onPress={() => onPress(trip.id)} onLongPress={handleLongPress} activeOpacity={0.85}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Text style={styles.modeIcon}>{MODE_ICONS[mode]}</Text>
              <Text style={styles.distance}>{formatDistance(trip.distanceMeters)}</Text>
            </View>
            <View style={styles.cardHeaderRight}>
              <View style={[styles.purposeTag, trip.purpose === "WORK" && styles.purposeTagWork]}>
                <Text
                  style={[styles.purposeTagText, trip.purpose === "WORK" && styles.purposeTagTextWork]}
                >
                  {trip.purpose === "WORK" ? "Jobb" : "Privat"}
                </Text>
              </View>
              {isActive && (
                <View style={styles.activeBadge}>
                  <View style={styles.activeBadgeDot} />
                  <Text style={styles.activeBadgeText}>Aktiv</Text>
                </View>
              )}
            </View>
          </View>
          <Text style={styles.route} numberOfLines={2}>
            {getTripStartLabel(trip)}
          </Text>
          {getTripEndLabel(trip) && (
            <View style={styles.destinationRow}>
              <Text style={styles.arrow}>→</Text>
              <Text style={styles.route} numberOfLines={2}>{getTripEndLabel(trip)}</Text>
            </View>
          )}
        </TouchableOpacity>
      </Swipeable>
    </View>
  );
}

/** The coloured pane revealed behind the card while swiping. */
function SwipeAction({ purpose }: { purpose: TripPurpose }) {
  const isWork = purpose === "WORK";
  return (
    <View
      style={[
        styles.swipeAction,
        isWork ? styles.swipeActionWork : styles.swipeActionPrivate,
        isWork ? styles.swipeActionLeft : styles.swipeActionRight,
      ]}
    >
      <Text style={styles.swipeActionText}>{isWork ? "Jobb" : "Privat"}</Text>
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
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0);
  const [selectedDayKey, setSelectedDayKey] = useState(format(new Date(), "yyyy-MM-dd"));
  const [health, setHealth] = useState<TrackerHealth | null>(null);

  // Tracking lives under Profil now, so a problem there has to surface here —
  // otherwise a silently stopped tracker is only noticed by the missing trips.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getTrackerState()
        .then((tracker) => {
          if (active) setHealth(assessTrackerHealth(tracker));
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [])
  );

  // Returning from the system settings is not a focus change.
  useOnAppActive(() => {
    getTrackerState()
      .then((tracker) => setHealth(assessTrackerHealth(tracker)))
      .catch(() => {});
  });

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

  const handleMode = useCallback(async (id: string, mode: TripMode) => {
    try {
      await api.patch(`/trips/${id}`, { mode });
      setTrips((prev) => prev.map((t) => t.id === id ? { ...t, mode } : t));
    } catch (e: any) {
      Alert.alert("Feil", e.message ?? "Kunne ikke oppdatere turtype.");
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
  const weekStart = getWeekStart(selectedWeekOffset);
  const weekLabel = formatWeekRange(weekStart);
  const weekDays = Array.from({ length: 7 }, (_, offset) => addDays(weekStart, offset));

  useEffect(() => {
    if (selectedWeekOffset > maxWeekOffset) {
      setSelectedWeekOffset(maxWeekOffset);
    }
  }, [maxWeekOffset, selectedWeekOffset]);

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
        <>
          {health?.needsAttention && (
            <TouchableOpacity
              style={styles.warningBanner}
              onPress={() => router.push("/tracking")}
              activeOpacity={0.85}
            >
              <Text style={styles.warningBannerTitle}>{health.headline}</Text>
              <Text style={styles.warningBannerText}>{health.summary}</Text>
            </TouchableOpacity>
          )}
          {grouped.length > 0 ? (
          <View style={styles.header}>
            <View style={styles.paginationRow}>
              <TouchableOpacity
                onPress={() => setSelectedWeekOffset((current) => Math.min(current + 1, maxWeekOffset))}
                disabled={selectedWeekOffset >= maxWeekOffset}
                activeOpacity={0.7}
                accessibilityLabel="Eldre uke"
                style={[styles.arrowButton, selectedWeekOffset >= maxWeekOffset && styles.arrowButtonDisabled]}
              >
                <Text style={styles.arrowText}>←</Text>
              </TouchableOpacity>
              <Text style={styles.weekLabel}>{weekLabel}</Text>
              <TouchableOpacity
                onPress={() => setSelectedWeekOffset((current) => Math.max(current - 1, 0))}
                disabled={selectedWeekOffset === 0}
                activeOpacity={0.7}
                accessibilityLabel="Nyere uke"
                style={[styles.arrowButton, selectedWeekOffset === 0 && styles.arrowButtonDisabled]}
              >
                <Text style={styles.arrowText}>→</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.dayTabs}>
              {weekDays.map((day) => {
                const group = grouped.find((entry) => isSameDay(entry.day, day));
                const isSelected = selectedGroup ? isSameDay(day, selectedGroup.day) : false;
                const isCurrentDay = isToday(day);
                const tripCount = group?.trips.length ?? 0;

                return (
                  <TouchableOpacity
                    key={day.toISOString()}
                    style={[
                      styles.dayTab,
                      isCurrentDay && styles.dayTabToday,
                      isSelected && styles.dayTabSelected,
                      !group && styles.dayTabDisabled,
                    ]}
                    onPress={() => setSelectedDayKey(format(day, "yyyy-MM-dd"))}
                    disabled={!group}
                    activeOpacity={0.85}
                    accessibilityLabel={`${formatDayHeader(day)}, ${tripCount === 1 ? "1 tur" : `${tripCount} turer`}`}
                    accessibilityState={{ selected: isSelected, disabled: !group }}
                  >
                    <Text
                      style={[
                        styles.dayTabWeekday,
                        isCurrentDay && styles.dayTabWeekdayToday,
                        isSelected && styles.dayTabWeekdaySelected,
                      ]}
                    >
                      {format(day, "EEE", { locale: nb })}
                    </Text>
                    <Text style={[styles.dayTabDate, isSelected && styles.dayTabDateSelected]}>
                      {format(day, "d")}
                    </Text>
                    <View
                      style={[
                        styles.dayTabBadge,
                        tripCount === 0 && styles.dayTabBadgeEmpty,
                        isSelected && tripCount > 0 && styles.dayTabBadgeSelected,
                      ]}
                    >
                      <Text style={[styles.dayTabBadgeText, isSelected && styles.dayTabBadgeTextSelected]}>
                        {tripCount > 0 ? tripCount : ""}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedGroup && <Text style={styles.dayHeader}>{formatDayHeader(selectedGroup.day)}</Text>}
          </View>
          ) : null}
        </>
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
          onSetMode={handleMode}
          onPress={(id) => router.push(`/trip/${id}`)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  list: { padding: 16, paddingBottom: 32 },
  warningBanner: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  swipeContainer: { flex: 1 },
  cardHeaderRight: { flexDirection: "row", alignItems: "center" },
  purposeTag: {
    backgroundColor: "#f1f5f9",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginLeft: 6,
  },
  purposeTagWork: { backgroundColor: "#dbeafe" },
  purposeTagText: { fontSize: 11, fontWeight: "700", color: "#64748b" },
  purposeTagTextWork: { color: "#1d4ed8" },
  swipeAction: {
    justifyContent: "center",
    borderRadius: 12,
    marginVertical: 2,
    paddingHorizontal: 22,
    // Explicit width, not flex: Swipeable measures the rendered pane to decide
    // how far it can open, and a flexed pane measures as zero — the gesture
    // then has nowhere to go and does nothing at all.
    width: 120,
  },
  swipeActionWork: { backgroundColor: "#2563eb" },
  swipeActionPrivate: { backgroundColor: "#64748b" },
  swipeActionLeft: { alignItems: "flex-start" },
  swipeActionRight: { alignItems: "flex-end" },
  swipeActionText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  warningBannerTitle: { fontSize: 15, fontWeight: "700", color: "#b91c1c", marginBottom: 4 },
  warningBannerText: { fontSize: 13, color: "#7f1d1d", lineHeight: 18 },
  header: { marginBottom: 16 },
  paginationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 8,
  },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "800",
    color: "#0f172a",
  },
  arrowButton: {
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
  },
  arrowButtonDisabled: {
    opacity: 0.35,
  },
  arrowText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  dayTabs: { flexDirection: "row", gap: 6, marginBottom: 16 },
  dayTab: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingTop: 8,
    paddingBottom: 7,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  dayTabToday: { borderColor: "#1d4ed8" },
  dayTabSelected: {
    backgroundColor: "#0f172a",
    borderColor: "#0f172a",
  },
  dayTabDisabled: { opacity: 0.4 },
  dayTabWeekday: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  dayTabWeekdayToday: { color: "#1d4ed8" },
  dayTabWeekdaySelected: { color: "#cbd5e1" },
  dayTabDate: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  dayTabDateSelected: { color: "#fff" },
  dayTabBadge: {
    minWidth: 20,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#e0f2fe",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  dayTabBadgeEmpty: { backgroundColor: "transparent" },
  dayTabBadgeSelected: { backgroundColor: "#38bdf8" },
  dayTabBadgeText: { fontSize: 11, fontWeight: "800", color: "#0369a1" },
  dayTabBadgeTextSelected: { color: "#082f49" },
  dayHeader: {
    fontSize: 15,
    fontWeight: "700",
    color: "#64748b",
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
  timelineTimeEnd: {
    fontSize: 12,
    fontWeight: "500",
    color: "#cbd5e1",
    marginTop: 2,
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
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modeIcon: {
    fontSize: 16,
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
