import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from "react-native";
import { ensureTrackingConfigured, getTrackerState, syncActiveTrip } from "@/lib/tripTracker";
import { formatDistanceToNowStrict } from "date-fns";
import { nb } from "date-fns/locale";

function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return "Ikke registrert ennå";

  try {
    return `${formatDistanceToNowStrict(new Date(timestamp), {
      addSuffix: true,
      locale: nb,
    })}`;
  } catch {
    return timestamp;
  }
}

export default function TrackingScreen() {
  const [tracking, setTracking] = useState(false);
  const [state, setState] = useState("IDLE");
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [pendingPoints, setPendingPoints] = useState(0);
  const [hasToken, setHasToken] = useState(false);
  const [foregroundPermission, setForegroundPermission] = useState("undetermined");
  const [backgroundPermission, setBackgroundPermission] = useState("undetermined");
  const [lastPointTimestamp, setLastPointTimestamp] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [recentEvents, setRecentEvents] = useState<
    Array<{ timestamp: string; level: "info" | "warn" | "error"; message: string }>
  >([]);

  const refresh = async () => {
    const tracker = await getTrackerState();
    setTracking(tracker.trackingEnabled);
    setState(tracker.state);
    setActiveTripId(tracker.activeTripId);
    setPendingPoints(tracker.pendingPoints);
    setHasToken(tracker.hasToken);
    setForegroundPermission(tracker.foregroundPermission);
    setBackgroundPermission(tracker.backgroundPermission);
    setLastPointTimestamp(tracker.lastPointTimestamp);
    setLastSyncAt(tracker.lastSyncAt);
    setRecentEvents(tracker.recentEvents);
  };

  useEffect(() => {
    refresh().catch(() => {});
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const handleEnable = async () => {
    try {
      const enabled = await ensureTrackingConfigured();
      await refresh();
      if (!enabled) {
        Alert.alert("Tillatelser mangler", "Gi appen tilgang til bakgrunnslokasjon for at telefonen skal kunne registrere turer automatisk.");
      }
    } catch (error: any) {
      Alert.alert("Feil", error?.message ?? "Kunne ikke aktivere sporing.");
    }
  };

  const handleSync = async () => {
    try {
      await syncActiveTrip();
      await refresh();
    } catch (error: any) {
      Alert.alert("Sync feilet", error?.message ?? "Kunne ikke synkronisere turen.");
    }
  };

  const stateLabel: Record<string, string> = {
    IDLE: "Telefonen venter på bevegelse",
    DETECTING_START: "Telefonen oppdager mulig tur",
    RECORDING: "Telefonen registrerer tur",
    DETECTING_STOP: "Telefonen vurderer om turen er ferdig",
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.stateCard}>
        <Text style={styles.stateLabel}>{stateLabel[state] ?? state}</Text>
        <Text style={styles.statusMeta}>
          {tracking ? "Bakgrunnssporing er aktiv på denne telefonen" : "Bakgrunnssporing er ikke aktiv ennå"}
        </Text>
        {activeTripId && <Text style={styles.tripId}>Tur: {activeTripId.slice(0, 8)}...</Text>}
        <Text style={styles.tripId}>Ventende punkter: {pendingPoints}</Text>
        <View style={[styles.dot, tracking && { backgroundColor: state === "RECORDING" ? "#22c55e" : "#f59e0b" }]} />
      </View>

      <View style={styles.metaCard}>
        <Text style={styles.sectionTitle}>Diagnostikk</Text>
        <Text style={styles.metaRow}>Innlogget sesjon: {hasToken ? "Ja" : "Nei"}</Text>
        <Text style={styles.metaRow}>Forgrunnslokasjon: {foregroundPermission}</Text>
        <Text style={styles.metaRow}>Bakgrunnslokasjon: {backgroundPermission}</Text>
        <Text style={styles.metaRow}>Siste GPS-punkt: {formatRelativeTime(lastPointTimestamp)}</Text>
        <Text style={styles.metaRow}>Siste vellykkede sync: {formatRelativeTime(lastSyncAt)}</Text>
      </View>

      <Text style={styles.helperText}>
        Så lenge bakgrunnslokasjon er tillatt, prøver appen å registrere turer automatisk mens du er i bevegelse.
      </Text>

      <TouchableOpacity style={styles.button} onPress={handleEnable}>
        <Text style={styles.buttonText}>
          {tracking ? "Oppdater trackingstatus" : "Aktiver automatisk tracking"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={handleSync}>
        <Text style={[styles.buttonText, styles.secondaryButtonText]}>Send ventende punkter</Text>
      </TouchableOpacity>

      <View style={styles.logCard}>
        <Text style={styles.sectionTitle}>Siste hendelser</Text>
        {recentEvents.length === 0 ? (
          <Text style={styles.logEmpty}>Ingen hendelser registrert ennå.</Text>
        ) : (
          recentEvents.map((event, index) => (
            <View key={`${event.timestamp}-${index}`} style={styles.logEntry}>
              <Text
                style={[
                  styles.logLevel,
                  event.level === "error" && styles.logLevelError,
                  event.level === "warn" && styles.logLevelWarn,
                ]}
              >
                {event.level.toUpperCase()}
              </Text>
              <Text style={styles.logMessage}>{event.message}</Text>
              <Text style={styles.logTime}>{formatRelativeTime(event.timestamp)}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 20, paddingBottom: 32 },
  stateCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    marginBottom: 24,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  stateLabel: { fontSize: 18, fontWeight: "600", marginBottom: 8, textAlign: "center" },
  statusMeta: { fontSize: 13, color: "#64748b", marginBottom: 6, textAlign: "center" },
  tripId: { fontSize: 12, color: "#64748b", marginBottom: 12 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#cbd5e1",
  },
  helperText: { color: "#475569", marginBottom: 16, lineHeight: 20 },
  metaCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 10,
  },
  metaRow: {
    color: "#334155",
    fontSize: 14,
    marginBottom: 8,
  },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    padding: 18,
    alignItems: "center",
    marginBottom: 12,
  },
  secondaryButton: {
    backgroundColor: "#e2e8f0",
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryButtonText: { color: "#0f172a" },
  logCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  logEmpty: { color: "#64748b", fontSize: 14 },
  logEntry: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e2e8f0",
  },
  logLevel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#2563eb",
    marginBottom: 4,
  },
  logLevelWarn: {
    color: "#b45309",
  },
  logLevelError: {
    color: "#dc2626",
  },
  logMessage: {
    fontSize: 14,
    color: "#0f172a",
    marginBottom: 4,
  },
  logTime: {
    fontSize: 12,
    color: "#64748b",
  },
});
