import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from "react-native";
import { ensureTrackingConfigured, getTrackerState } from "@/lib/tripTracker";

type TrackerState = "IDLE" | "DETECTING_START" | "RECORDING" | "DETECTING_STOP";

const stateConfig: Record<TrackerState, { label: string; subtitle: string; color: string; pulse: boolean }> = {
  IDLE: {
    label: "Venter",
    subtitle: "Kjør for å starte en tur automatisk",
    color: "#94a3b8",
    pulse: false,
  },
  DETECTING_START: {
    label: "Oppdager bevegelse",
    subtitle: "Verifiserer at du er i fart...",
    color: "#f59e0b",
    pulse: true,
  },
  RECORDING: {
    label: "Registrerer tur",
    subtitle: "GPS-posisjoner blir lagret",
    color: "#22c55e",
    pulse: true,
  },
  DETECTING_STOP: {
    label: "Bremser ned",
    subtitle: "Sjekker om turen er over...",
    color: "#f59e0b",
    pulse: true,
  },
};

export default function TrackingScreen() {
  const [tracking, setTracking] = useState(false);
  const [state, setState] = useState<TrackerState>("IDLE");
  const [pendingPoints, setPendingPoints] = useState(0);
  const [foregroundPermission, setForegroundPermission] = useState("undetermined");
  const [backgroundPermission, setBackgroundPermission] = useState("undetermined");

  const refresh = async () => {
    const tracker = await getTrackerState();
    setTracking(tracker.trackingEnabled);
    setState(tracker.state);
    setPendingPoints(tracker.pendingPoints);
    setForegroundPermission(tracker.foregroundPermission);
    setBackgroundPermission(tracker.backgroundPermission);
  };

  useEffect(() => {
    refresh().catch(() => {});
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleEnable = async () => {
    try {
      const enabled = await ensureTrackingConfigured();
      await refresh();
      if (!enabled) {
        Alert.alert(
          "Tillatelser mangler",
          "Gi appen tilgang til bakgrunnslokasjon for at telefonen skal kunne registrere turer automatisk."
        );
      }
    } catch (error: any) {
      Alert.alert("Feil", error?.message ?? "Kunne ikke aktivere sporing.");
    }
  };

  const needsSetup = !tracking || foregroundPermission !== "granted" || backgroundPermission !== "granted";
  const config = stateConfig[state] ?? stateConfig.IDLE;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={[styles.statusRing, { borderColor: config.color }]}>
          <View style={[styles.statusDot, { backgroundColor: config.color }]} />
        </View>
        <Text style={styles.stateLabel}>{config.label}</Text>
        <Text style={styles.stateSubtitle}>{config.subtitle}</Text>
      </View>

      {pendingPoints > 0 && (
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{pendingPoints} punkt venter på synkronisering</Text>
        </View>
      )}

      {needsSetup && (
        <TouchableOpacity style={styles.button} onPress={handleEnable} activeOpacity={0.8}>
          <Text style={styles.buttonText}>Aktiver sporing</Text>
        </TouchableOpacity>
      )}

      {!needsSetup && (
        <View style={styles.statusBanner}>
          <View style={styles.bannerDot} />
          <Text style={styles.bannerText}>Automatisk sporing er aktiv</Text>
        </View>
      )}

      <Text style={styles.helperText}>
        Appen registrerer turer automatisk i bakgrunnen når du kjører. Du trenger ikke gjøre noe.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  content: { flexGrow: 1, padding: 24, justifyContent: "center", alignItems: "center" },
  hero: { alignItems: "center", marginBottom: 40 },
  statusRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  statusDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  stateLabel: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 6,
  },
  stateSubtitle: {
    fontSize: 15,
    color: "#64748b",
    textAlign: "center",
    lineHeight: 22,
  },
  infoRow: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  infoLabel: {
    fontSize: 14,
    color: "#64748b",
  },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginBottom: 20,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f0fdf4",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  bannerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22c55e",
  },
  bannerText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#166534",
  },
  helperText: {
    color: "#94a3b8",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
});
