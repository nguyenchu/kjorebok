import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { ensureTrackingConfigured, getTrackerState, syncActiveTrip } from "@/lib/tripTracker";

export default function TrackingScreen() {
  const [tracking, setTracking] = useState(false);
  const [state, setState] = useState("IDLE");
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [pendingPoints, setPendingPoints] = useState(0);

  const refresh = async () => {
    const tracker = await getTrackerState();
    setTracking(tracker.trackingEnabled);
    setState(tracker.state);
    setActiveTripId(tracker.activeTripId);
    setPendingPoints(tracker.pendingPoints);
  };

  useEffect(() => {
    refresh().catch(() => {});
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
    <View style={styles.container}>
      <View style={styles.stateCard}>
        <Text style={styles.stateLabel}>{stateLabel[state] ?? state}</Text>
        <Text style={styles.statusMeta}>
          {tracking ? "Bakgrunnssporing er aktiv på denne telefonen" : "Bakgrunnssporing er ikke aktiv ennå"}
        </Text>
        {activeTripId && <Text style={styles.tripId}>Tur: {activeTripId.slice(0, 8)}...</Text>}
        <Text style={styles.tripId}>Ventende punkter: {pendingPoints}</Text>
        <View style={[styles.dot, tracking && { backgroundColor: state === "RECORDING" ? "#22c55e" : "#f59e0b" }]} />
      </View>

      <Text style={styles.helperText}>
        Tracking er nå knyttet til telefonen, ikke til et kjøretøy. Så lenge bakgrunnslokasjon er tillatt, prøver appen å registrere turer automatisk.
      </Text>

      <TouchableOpacity style={styles.button} onPress={handleEnable}>
        <Text style={styles.buttonText}>{tracking ? "Sjekk status" : "Aktiver alltid-på tracking"}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={handleSync}>
        <Text style={[styles.buttonText, styles.secondaryButtonText]}>Synk nå</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#f8fafc" },
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
});
