import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import {
  startTracking,
  stopTracking,
  requestPermissions,
  getTrackerState,
  BACKGROUND_LOCATION_TASK,
} from "@/lib/tripTracker";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/lib/api";
import type { Vehicle } from "@kjorebok/shared";

export default function TrackingScreen() {
  const [tracking, setTracking] = useState(false);
  const [state, setState] = useState("IDLE");
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);

  useEffect(() => {
    // Load vehicles and tracker state
    api.get<Vehicle[]>("/vehicles").then(setVehicles).catch(() => {});
    Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
      .then(setTracking)
      .catch(() => {});
    getTrackerState().then(({ state: s, activeTripId: id }) => {
      setState(s);
      setActiveTripId(id);
    });
    AsyncStorage.getItem("tracker_vehicle_id").then((v) => {
      if (v) setSelectedVehicle(v);
    });
  }, []);

  const handleToggle = async () => {
    if (tracking) {
      await stopTracking();
      setTracking(false);
      setState("IDLE");
    } else {
      if (!selectedVehicle) {
        Alert.alert("Velg kjøretøy", "Du må velge et kjøretøy for å starte sporing.");
        return;
      }
      const granted = await requestPermissions();
      if (!granted) {
        Alert.alert("Tillatelse nektet", "Kjørebok trenger GPS-tilgang i bakgrunnen.");
        return;
      }
      await startTracking(selectedVehicle);
      setTracking(true);
      setState("IDLE");
    }
  };

  const stateLabel: Record<string, string> = {
    IDLE: "Venter på kjøring...",
    DETECTING_START: "Oppdager tur...",
    RECORDING: "Registrerer tur",
    DETECTING_STOP: "Stopper snart...",
  };

  return (
    <View style={styles.container}>
      <View style={styles.stateCard}>
        <Text style={styles.stateLabel}>{stateLabel[state] ?? state}</Text>
        {activeTripId && (
          <Text style={styles.tripId}>Tur: {activeTripId.slice(0, 8)}...</Text>
        )}
        <View style={[styles.dot, tracking && { backgroundColor: state === "RECORDING" ? "#22c55e" : "#f59e0b" }]} />
      </View>

      {vehicles.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Kjøretøy</Text>
          {vehicles.map((v) => (
            <TouchableOpacity
              key={v.id}
              style={[styles.vehicleRow, selectedVehicle === v.id && styles.vehicleSelected]}
              onPress={() => !tracking && setSelectedVehicle(v.id)}
            >
              <Text style={styles.vehicleName}>{v.name}</Text>
              <Text style={styles.vehiclePlate}>{v.licensePlate}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, tracking && styles.buttonStop]}
        onPress={handleToggle}
      >
        <Text style={styles.buttonText}>{tracking ? "Stopp sporing" : "Start sporing"}</Text>
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
  stateLabel: { fontSize: 18, fontWeight: "600", marginBottom: 8 },
  tripId: { fontSize: 12, color: "#64748b", marginBottom: 12 },
  dot: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: "#cbd5e1",
  },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#64748b", marginBottom: 8 },
  vehicleRow: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    borderWidth: 2,
    borderColor: "transparent",
  },
  vehicleSelected: { borderColor: "#2563eb" },
  vehicleName: { fontWeight: "600" },
  vehiclePlate: { color: "#64748b" },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    padding: 18,
    alignItems: "center",
  },
  buttonStop: { backgroundColor: "#dc2626" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
