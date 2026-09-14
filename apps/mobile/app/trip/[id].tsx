import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { WebView } from "react-native-webview";
import { api } from "@/lib/api";
import type { Trip, TripPurpose } from "@kjorebok/shared";

function buildMapHtml(coordinates: { lat: number; lng: number }[]): string {
  const latlngs = JSON.stringify(coordinates.map((p) => [p.lat, p.lng]));
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var latlngs = ${latlngs};
    var map = L.map('map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);
    var line = L.polyline(latlngs, { color: '#2563eb', weight: 4, opacity: 0.85 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [24, 24] });
    if (latlngs.length > 0) {
      L.circleMarker(latlngs[0], { radius: 7, color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1 }).addTo(map);
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, color: '#dc2626', fillColor: '#dc2626', fillOpacity: 1 }).addTo(map);
    }
  </script>
</body>
</html>`;
}

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<TripPurpose>("PRIVATE");
  const [purposeNote, setPurposeNote] = useState("");
  const [client, setClient] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<Trip>(`/trips/${id}`)
      .then((result) => {
        setTrip(result);
        setPurpose(result.purpose);
        setPurposeNote(result.purposeNote ?? "");
        setClient(result.client ?? "");
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const hasRoute = (trip?.route.length ?? 0) > 0;

  const dirty =
    trip !== null &&
    (purpose !== trip.purpose ||
      purposeNote.trim() !== (trip.purposeNote ?? "") ||
      client.trim() !== (trip.client ?? ""));

  const handleSave = async () => {
    if (!trip) return;
    setSaving(true);
    try {
      const updated = await api.patch<Trip>(`/trips/${trip.id}`, {
        purpose,
        // Empty means "not stated", which the report counts as missing
        // documentation — null says that more clearly than "".
        purposeNote: purposeNote.trim() || null,
        client: client.trim() || null,
      });
      setTrip({ ...trip, ...updated });
    } catch (e: any) {
      Alert.alert("Kunne ikke lagre", e?.message ?? "Prøv igjen senere.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          // The root stack hides headers, so this screen has to ask for one —
          // without it there is no back button out of the map.
          headerShown: true,
          title: trip
            ? `${trip.startPlace?.label ?? trip.startAddress ?? "Ukjent start"} → ${trip.endPlace?.label ?? trip.endAddress ?? "Ukjent slutt"}`
            : "Tur",
          headerBackTitle: "Tilbake",
          headerStyle: { backgroundColor: "#eef6ff" },
          headerShadowVisible: false,
          headerTintColor: "#0f172a",
          headerTitleStyle: { fontWeight: "700", fontSize: 18, color: "#0f172a" },
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

      {trip && (
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={100}
        >
          {hasRoute && (
            <WebView
              style={styles.map}
              source={{ html: buildMapHtml(trip.route) }}
              originWhitelist={["*"]}
              scrollEnabled={false}
            />
          )}

          <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent}>
            <Text style={styles.infoDistance}>{(trip.distanceMeters / 1000).toFixed(1)} km</Text>
            <Text style={styles.infoMeta}>
              {hasRoute ? `${trip.route.length} GPS-punkter` : "Ingen GPS-punkter"}
              {trip.vehicle ? ` · ${trip.vehicle.label} (${trip.vehicle.registration})` : ""}
            </Text>

            <Text style={styles.fieldLabel}>Formål med turen</Text>
            <View style={styles.purposeRow}>
              {(["PRIVATE", "WORK"] as TripPurpose[]).map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.purposeChip, purpose === option && styles.purposeChipActive]}
                  onPress={() => setPurpose(option)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[styles.purposeChipText, purpose === option && styles.purposeChipTextActive]}
                  >
                    {option === "WORK" ? "Jobb" : "Privat"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {purpose === "WORK" && (
              <>
                <Text style={styles.fieldLabel}>Hva var ærendet?</Text>
                <TextInput
                  style={styles.input}
                  value={purposeNote}
                  onChangeText={setPurposeNote}
                  placeholder="f.eks. Kundemøte, befaring, levering"
                  placeholderTextColor="#94a3b8"
                  maxLength={200}
                  multiline
                />

                <Text style={styles.fieldLabel}>Oppdragsgiver eller besøkt</Text>
                <TextInput
                  style={styles.input}
                  value={client}
                  onChangeText={setClient}
                  placeholder="f.eks. Byggmester Hansen AS"
                  placeholderTextColor="#94a3b8"
                  maxLength={120}
                />

                <Text style={styles.hint}>
                  Skatteetaten krever at yrkesturer har oppgitt formål. Uten det teller ikke turen som
                  dokumentasjon for kjøregodtgjørelse.
                </Text>
              </>
            )}

            {dirty && (
              <TouchableOpacity
                style={[styles.saveButton, saving && styles.buttonDisabled]}
                onPress={() => void handleSave()}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Lagre</Text>
                )}
              </TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  map: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 15, color: "#64748b", textAlign: "center" },
  sheet: {
    flexGrow: 0,
    maxHeight: "58%",
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  sheetContent: { paddingVertical: 16, paddingHorizontal: 20, paddingBottom: 32 },
  infoDistance: { fontSize: 22, fontWeight: "800", color: "#0f172a", marginBottom: 4 },
  infoMeta: { fontSize: 14, color: "#64748b" },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
    marginTop: 20,
    marginBottom: 8,
  },
  purposeRow: { flexDirection: "row" },
  purposeChip: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
    marginRight: 8,
  },
  purposeChipActive: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  purposeChipText: { fontSize: 14, fontWeight: "600", color: "#475569" },
  purposeChipTextActive: { color: "#fff" },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0f172a",
    backgroundColor: "#fff",
    minHeight: 46,
  },
  hint: { fontSize: 12, color: "#64748b", lineHeight: 18, marginTop: 14 },
  saveButton: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 22,
  },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  buttonDisabled: { opacity: 0.7 },
});
