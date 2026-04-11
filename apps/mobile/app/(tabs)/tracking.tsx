import { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, Linking } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { router } from "expo-router";
import {
  ensureTrackingConfigured,
  getTrackerState,
  syncActiveTrip,
} from "@/lib/tripTracker";
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

function isOlderThan(timestamp: string | null, ms: number): boolean {
  if (!timestamp) return true;

  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return true;
  return Date.now() - time > ms;
}

export default function TrackingScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const [tracking, setTracking] = useState(false);
  const [state, setState] = useState("IDLE");
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [pendingPoints, setPendingPoints] = useState(0);
  const [hasToken, setHasToken] = useState(false);
  const [locationServicesEnabled, setLocationServicesEnabled] = useState(false);
  const [foregroundPermission, setForegroundPermission] = useState("undetermined");
  const [backgroundPermission, setBackgroundPermission] = useState("undetermined");
  const [lastPointTimestamp, setLastPointTimestamp] = useState<string | null>(null);
  const [lastTaskAt, setLastTaskAt] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSpeedKmh, setLastSpeedKmh] = useState<number | null>(null);
  const [lastAccuracyMeters, setLastAccuracyMeters] = useState<number | null>(null);
  const [startCandidateCount, setStartCandidateCount] = useState(0);
  const [startReason, setStartReason] = useState("Telefonen venter på tydelig bevegelse.");
  const [recentEvents, setRecentEvents] = useState<
    Array<{ timestamp: string; level: "info" | "warn" | "error"; message: string }>
  >([]);
  const [showDetails, setShowDetails] = useState(false);

  const refresh = async () => {
    const tracker = await getTrackerState();
    setTracking(tracker.trackingEnabled);
    setState(tracker.state);
    setActiveTripId(tracker.activeTripId);
    setPendingPoints(tracker.pendingPoints);
    setHasToken(tracker.hasToken);
    setLocationServicesEnabled(tracker.locationServicesEnabled);
    setForegroundPermission(tracker.foregroundPermission);
    setBackgroundPermission(tracker.backgroundPermission);
    setLastPointTimestamp(tracker.lastPointTimestamp);
    setLastTaskAt(tracker.lastTaskAt);
    setLastSyncAt(tracker.lastSyncAt);
    setLastSpeedKmh(tracker.lastSpeedKmh);
    setLastAccuracyMeters(tracker.lastAccuracyMeters);
    setStartCandidateCount(tracker.startCandidateCount);
    setStartReason(tracker.startReason);
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

  const needsPermission = foregroundPermission !== "granted" || backgroundPermission !== "granted";
  const taskSeemsStale = tracking && isOlderThan(lastTaskAt, 20 * 60 * 1000);
  const needsAttention = !hasToken || !locationServicesEnabled || needsPermission || !tracking || taskSeemsStale;
  const headline = useMemo(() => {
    if (!hasToken) return "Du er ikke innlogget";
    if (!locationServicesEnabled) return "Skru på posisjonstjenester";
    if (needsPermission) return "Gi appen bakgrunnslokasjon";
    if (!tracking) return "Aktiver bakgrunnssporing";
    if (taskSeemsStale) return "Venter på ny bakgrunnsoppdatering";
    if (state === "RECORDING") return "Tur registreres nå";
    if (pendingPoints > 0) return "Turdata venter på synk";
    if (activeTripId) return "Aktiv tur venter på flere punkter";
    return "Tracking er klar";
  }, [activeTripId, hasToken, locationServicesEnabled, needsPermission, pendingPoints, state, taskSeemsStale, tracking]);

  const summary = useMemo(() => {
    if (!hasToken) return "Logg inn igjen hvis sesjonen har utløpt. Appen kan ikke sende turdata uten gyldig sesjon.";
    if (!locationServicesEnabled) return "Telefonens posisjonstjenester er av, så Android kan ikke levere bakgrunnsposisjon til appen.";
    if (needsPermission) return "Appen trenger både forgrunns- og bakgrunnslokasjon for å oppdage turstart og turstopp.";
    if (!tracking) return "Bakgrunnsoppgaven kjører ikke ennå. Start den én gang, så holder appen seg klar i bakgrunnen.";
    if (taskSeemsStale) return "Appen er satt opp for bakgrunnssporing, men Android har ikke levert noen fersk bakgrunnsoppgave nylig. Sjekk at batterisparing ikke holder appen igjen.";
    if (pendingPoints > 0) return "Det ligger ventende punkter lokalt. De blir sendt automatisk når nett og sesjon er klare.";
    if (!activeTripId) return startReason;
    return "Appen følger med i bakgrunnen og skal starte tur automatisk når den ser stabil bevegelse.";
  }, [activeTripId, hasToken, locationServicesEnabled, needsPermission, pendingPoints, startReason, taskSeemsStale, tracking]);

  const detailHint = useMemo(() => {
    if (pendingPoints > 0) return `${pendingPoints} punkt venter på synkronisering.`;
    if (activeTripId) return "En tur er aktiv akkurat nå.";
    if (startCandidateCount > 0) return `Telefonen har sett ${startCandidateCount} av ${2} nødvendige starttegn.`;
    if (needsAttention) return "Trykk under for flere detaljer hvis noe ikke virker.";
    return "Alt ser klart ut akkurat nå.";
  }, [activeTripId, needsAttention, pendingPoints, startCandidateCount]);

  const primaryAction = useMemo(() => {
    if (!hasToken) {
      return {
        label: "Gå til innlogging",
        onPress: () => {
          router.replace("/login");
        },
      };
    }

    if (!locationServicesEnabled || needsPermission) {
      return {
        label: "Åpne innstillinger",
        onPress: async () => {
          await Linking.openSettings();
        },
      };
    }

    if (!tracking) {
      return {
        label: "Aktiver sporing",
        onPress: handleEnable,
      };
    }

    if (pendingPoints > 0 || activeTripId) {
      return {
        label: "Send ventende data",
        onPress: handleSync,
      };
    }

    return {
      label: "Oppdater status",
      onPress: refresh,
    };
  }, [activeTripId, hasToken, locationServicesEnabled, needsPermission, pendingPoints, tracking]);

  const stateLabel: Record<string, string> = {
    IDLE: "Telefonen venter på bevegelse",
    DETECTING_START: "Telefonen oppdager mulig tur",
    RECORDING: "Telefonen registrerer tur",
    DETECTING_STOP: "Telefonen vurderer om turen er ferdig",
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 24 }]}
    >
      <View style={styles.stateCard}>
        <Text style={styles.stateLabel}>{headline}</Text>
        <Text style={styles.statusMeta}>{summary}</Text>
        <Text style={styles.stateSubLabel}>{stateLabel[state] ?? state}</Text>
        <View
          style={[
            styles.dot,
            needsAttention
              ? { backgroundColor: "#ef4444" }
              : tracking
                ? { backgroundColor: state === "RECORDING" ? "#22c55e" : "#f59e0b" }
                : undefined,
          ]}
        />
      </View>

      <View style={styles.helperCard}>
        <Text style={styles.helperText}>{detailHint}</Text>
      </View>

      <View style={styles.reasonCard}>
        <Text style={styles.sectionTitle}>Hvorfor startet ingen tur?</Text>
        <Text style={styles.reasonText}>{startReason}</Text>
        <Text style={styles.reasonMeta}>
          {lastSpeedKmh !== null ? `Siste fart ${lastSpeedKmh.toFixed(1)} km/t` : "Ingen fersk fart ennå"}
          {" · "}
          {lastAccuracyMeters !== null ? `GPS ±${Math.round(lastAccuracyMeters)} m` : "Ingen fersk GPS-nøyaktighet ennå"}
        </Text>
      </View>

      <TouchableOpacity style={[styles.button, needsAttention && styles.warningButton]} onPress={primaryAction.onPress} activeOpacity={0.85}>
        <Text style={styles.buttonText}>{primaryAction.label}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowDetails((value) => !value)} activeOpacity={0.85}>
        <Text style={styles.secondaryButtonText}>{showDetails ? "Skjul detaljer" : "Vis detaljer"}</Text>
      </TouchableOpacity>

      {showDetails && (
        <>
          <View style={styles.metaCard}>
            <Text style={styles.sectionTitle}>Detaljer</Text>
            {activeTripId && <Text style={styles.metaRow}>Aktiv tur: {activeTripId.slice(0, 8)}...</Text>}
            <Text style={styles.metaRow}>Ventende punkter: {pendingPoints}</Text>
            <Text style={styles.metaRow}>Innlogget sesjon: {hasToken ? "Ja" : "Nei"}</Text>
            <Text style={styles.metaRow}>Posisjonstjenester: {locationServicesEnabled ? "På" : "Av"}</Text>
            <Text style={styles.metaRow}>Forgrunnslokasjon: {foregroundPermission}</Text>
            <Text style={styles.metaRow}>Bakgrunnslokasjon: {backgroundPermission}</Text>
            <Text style={styles.metaRow}>Siste fart: {lastSpeedKmh !== null ? `${lastSpeedKmh.toFixed(1)} km/t` : "Ikke registrert"}</Text>
            <Text style={styles.metaRow}>Siste GPS-nøyaktighet: {lastAccuracyMeters !== null ? `${Math.round(lastAccuracyMeters)} m` : "Ikke registrert"}</Text>
            <Text style={styles.metaRow}>Startkandidater sett: {startCandidateCount}</Text>
            <Text style={styles.metaRow}>Automatisk startstatus: {startReason}</Text>
            <Text style={styles.metaRow}>Sist bakgrunnsoppgave kjørte: {formatRelativeTime(lastTaskAt)}</Text>
            <Text style={styles.metaRow}>Siste GPS-punkt: {formatRelativeTime(lastPointTimestamp)}</Text>
            <Text style={styles.metaRow}>Siste vellykkede sync: {formatRelativeTime(lastSyncAt)}</Text>
          </View>

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
        </>
      )}
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
  statusMeta: { fontSize: 13, color: "#64748b", marginBottom: 8, textAlign: "center", lineHeight: 19 },
  stateSubLabel: { fontSize: 13, color: "#334155", marginBottom: 8, textAlign: "center", fontWeight: "600" },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#cbd5e1",
  },
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
  helperCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  reasonCard: {
    backgroundColor: "#eff6ff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 10,
  },
  helperText: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  reasonText: {
    color: "#1e3a8a",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  reasonMeta: {
    color: "#475569",
    fontSize: 13,
    marginTop: 10,
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
  manualButton: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 18,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  warningButton: { backgroundColor: "#0f172a" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  manualButtonText: { color: "#0f172a", fontSize: 16, fontWeight: "700" },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: 10,
    marginBottom: 16,
  },
  secondaryButtonText: {
    color: "#2563eb",
    fontSize: 15,
    fontWeight: "600",
  },
  logCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
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
