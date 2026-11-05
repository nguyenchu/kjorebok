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
import type { Place, Trip, TripPurpose, TripStop } from "@kjorebok/shared";

type Endpoint = "start" | "end";

/** What the trip knows about one end: a saved place, a business nearby, the street address. */
function endpointOf(trip: Trip, which: Endpoint) {
  return which === "start"
    ? { place: trip.startPlace, poi: trip.startPoi, address: trip.startAddress, lat: trip.startLat, lng: trip.startLng }
    : { place: trip.endPlace, poi: trip.endPoi, address: trip.endAddress, lat: trip.endLat, lng: trip.endLng };
}

function endpointTitle(trip: Trip, which: Endpoint): string {
  const { place, poi, address } = endpointOf(trip, which);
  return place?.label ?? poi ?? address ?? (which === "start" ? "Ukjent start" : "Ukjent slutt");
}

/** "Snitt 42 km/t · maks 78 km/t · 18 min i bevegelse · 4 min stopp", or "" before the trip is processed. */
function formatMotion(
  trip: Pick<Trip, "avgMovingSpeedKmh" | "maxSpeedKmh" | "movingSeconds" | "stoppedSeconds">,
): string {
  const parts: string[] = [];
  if (trip.avgMovingSpeedKmh) parts.push(`Snitt ${Math.round(trip.avgMovingSpeedKmh)} km/t`);
  if (trip.maxSpeedKmh) parts.push(`maks ${Math.round(trip.maxSpeedKmh)} km/t`);
  if (trip.movingSeconds) parts.push(`${Math.round(trip.movingSeconds / 60)} min i bevegelse`);
  // Under a minute rounds to "0 min", which reads as no stops at all.
  if (trip.stoppedSeconds && trip.stoppedSeconds >= 60) {
    parts.push(`${Math.round(trip.stoppedSeconds / 60)} min stopp`);
  }
  return parts.join(" · ");
}

/** "Stopp 4 min · 12:03" */
function stopLabel(stop: TripStop): string {
  const minutes = Math.max(1, Math.round(stop.seconds / 60));
  const time = new Date(stop.start).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
  return `Stopp ${minutes} min · ${time}`;
}

function buildMapHtml(coordinates: { lat: number; lng: number }[], stops: TripStop[]): string {
  const latlngs = JSON.stringify(coordinates.map((p) => [p.lat, p.lng]));
  // Labels are built here rather than in the page, so they use the app's
  // locale instead of whatever the WebView defaults to.
  const stopMarkers = JSON.stringify(stops.map((s) => ({ lat: s.lat, lng: s.lng, label: stopLabel(s) })));
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
    ${stopMarkers}.forEach(function (stop) {
      L.circleMarker([stop.lat, stop.lng], { radius: 6, color: '#b45309', fillColor: '#f59e0b', fillOpacity: 1, weight: 2 })
        .bindPopup(stop.label)
        .addTo(map);
    });
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
  const [odometerStart, setOdometerStart] = useState("");
  const [odometerEnd, setOdometerEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [naming, setNaming] = useState<Endpoint | null>(null);
  const [placeLabel, setPlaceLabel] = useState("");
  const [savingPlace, setSavingPlace] = useState(false);

  useEffect(() => {
    api
      .get<Trip>(`/trips/${id}`)
      .then((result) => {
        setTrip(result);
        setPurpose(result.purpose);
        setPurposeNote(result.purposeNote ?? "");
        setClient(result.client ?? "");
        setOdometerStart(result.odometerStart?.toString() ?? "");
        setOdometerEnd(result.odometerEnd?.toString() ?? "");
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const hasRoute = (trip?.route.length ?? 0) > 0;

  const parseOdometer = (value: string): number | null => {
    const digits = value.replace(/\s/g, "");
    if (!digits) return null;
    const parsed = Number(digits);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  };

  const startKm = parseOdometer(odometerStart);
  const endKm = parseOdometer(odometerEnd);

  const dirty =
    trip !== null &&
    (purpose !== trip.purpose ||
      purposeNote.trim() !== (trip.purposeNote ?? "") ||
      client.trim() !== (trip.client ?? "") ||
      startKm !== trip.odometerStart ||
      endKm !== trip.odometerEnd);

  const odometerOutOfOrder = startKm !== null && endKm !== null && endKm < startKm;

  // Same tolerance the report uses to flag a mismatch, shown here while there
  // is still a chance to correct the reading.
  const trackedKm = trip ? trip.distanceMeters / 1000 : 0;
  const loggedKm = startKm !== null && endKm !== null ? endKm - startKm : null;
  const odometerMismatch =
    loggedKm !== null &&
    !odometerOutOfOrder &&
    Math.abs(loggedKm - trackedKm) > Math.max(2, trackedKm * 0.1);

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
        odometerStart: startKm,
        odometerEnd: endKm,
      });
      setTrip({ ...trip, ...updated });
    } catch (e: any) {
      Alert.alert("Kunne ikke lagre", e?.message ?? "Prøv igjen senere.");
    } finally {
      setSaving(false);
    }
  };

  const startNaming = (which: Endpoint) => {
    if (!trip) return;
    const { place, poi } = endpointOf(trip, which);
    setPlaceLabel(place?.label ?? poi ?? "");
    setNaming(which);
  };

  const handleSavePlace = async () => {
    if (!trip || !naming) return;
    const label = placeLabel.trim();
    const { place, lat, lng } = endpointOf(trip, naming);
    if (!label || lat == null || lng == null) return;

    setSavingPlace(true);
    try {
      if (place) {
        await api.patch<Place>(`/places/${place.id}`, { label });
      } else {
        await api.post<Place>("/places", { label, lat, lng });
      }
      // A new place can match both ends of a round trip, and other trips too,
      // so let the server do the matching again.
      // Unsaved trip edits live in their own state, so they survive this.
      setTrip(await api.get<Trip>(`/trips/${trip.id}`));
      setNaming(null);
    } catch (e: any) {
      Alert.alert("Kunne ikke lagre stedet", e?.message ?? "Prøv igjen senere.");
    } finally {
      setSavingPlace(false);
    }
  };

  const renderEndpoint = (current: Trip, which: Endpoint) => {
    const { place, poi, address, lat, lng } = endpointOf(current, which);
    const title = endpointTitle(current, which);
    // The address is the record the report relies on; keep it visible under a name.
    const subtitle = (place || poi) && address ? address : null;
    const canName = lat != null && lng != null;

    return (
      <View style={styles.endpoint} key={which}>
        <Text style={styles.endpointCaption}>{which === "start" ? "Fra" : "Til"}</Text>
        {naming === which ? (
          <>
            <TextInput
              style={styles.input}
              value={placeLabel}
              onChangeText={setPlaceLabel}
              placeholder="f.eks. Hjem, Kontoret, Hytta"
              placeholderTextColor="#94a3b8"
              maxLength={80}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void handleSavePlace()}
            />
            <Text style={styles.hint}>
              {place
                ? "Nytt navn gjelder alle turer som starter eller slutter her."
                : "Turer som starter eller slutter innen 100 meter herfra, får dette navnet."}
            </Text>
            <View style={styles.endpointActions}>
              <TouchableOpacity onPress={() => setNaming(null)} disabled={savingPlace}>
                <Text style={styles.linkMuted}>Avbryt</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void handleSavePlace()}
                disabled={savingPlace || !placeLabel.trim()}
              >
                {savingPlace ? (
                  <ActivityIndicator color="#2563eb" />
                ) : (
                  <Text style={[styles.link, !placeLabel.trim() && styles.linkDisabled]}>Lagre sted</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.endpointRow}>
            <View style={styles.endpointText}>
              <Text style={styles.endpointTitle}>{title}</Text>
              {subtitle && <Text style={styles.endpointSubtitle}>{subtitle}</Text>}
            </View>
            {canName && (
              <TouchableOpacity onPress={() => startNaming(which)} hitSlop={8}>
                <Text style={styles.link}>{place ? "Endre navn" : "Gi navn"}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          // The header itself is configured in the root layout.
          title: trip ? `${endpointTitle(trip, "start")} → ${endpointTitle(trip, "end")}` : "Tur",
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
              source={{ html: buildMapHtml(trip.route, trip.stops ?? []) }}
              originWhitelist={["*"]}
              scrollEnabled={false}
            />
          )}

          <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent}>
            <Text style={styles.infoDistance}>{(trip.distanceMeters / 1000).toFixed(1)} km</Text>
            <Text style={styles.infoMeta}>
              {hasRoute ? `${trip.pointCount ?? trip.route.length} GPS-punkter` : "Ingen GPS-punkter"}
              {trip.vehicle ? ` · ${trip.vehicle.label} (${trip.vehicle.registration})` : ""}
            </Text>
            {formatMotion(trip) !== "" && <Text style={styles.infoMeta}>{formatMotion(trip)}</Text>}

            {renderEndpoint(trip, "start")}
            {renderEndpoint(trip, "end")}

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

            <Text style={styles.fieldLabel}>Kilometerstand</Text>
            <View style={styles.odometerRow}>
              <View style={styles.odometerField}>
                <Text style={styles.odometerCaption}>Ved start</Text>
                <TextInput
                  style={styles.input}
                  value={odometerStart}
                  onChangeText={setOdometerStart}
                  placeholder="—"
                  placeholderTextColor="#94a3b8"
                  keyboardType="number-pad"
                  maxLength={7}
                />
              </View>
              <View style={styles.odometerField}>
                <Text style={styles.odometerCaption}>Ved slutt</Text>
                <TextInput
                  style={styles.input}
                  value={odometerEnd}
                  onChangeText={setOdometerEnd}
                  placeholder="—"
                  placeholderTextColor="#94a3b8"
                  keyboardType="number-pad"
                  maxLength={7}
                />
              </View>
            </View>

            {odometerOutOfOrder && (
              <Text style={styles.warning}>
                Kilometerstand ved slutt kan ikke være lavere enn ved start.
              </Text>
            )}
            {odometerMismatch && loggedKm !== null && (
              <Text style={styles.warning}>
                Kilometerstanden viser {loggedKm.toFixed(0)} km, men turen er målt til{" "}
                {trackedKm.toFixed(1)} km. Sjekk avlesningen — rapporten flagger avviket.
              </Text>
            )}

            {dirty && (
              <TouchableOpacity
                style={[styles.saveButton, (saving || odometerOutOfOrder) && styles.buttonDisabled]}
                onPress={() => void handleSave()}
                disabled={saving || odometerOutOfOrder}
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
  endpoint: { marginTop: 16 },
  endpointCaption: { fontSize: 12, fontWeight: "700", color: "#64748b", marginBottom: 4 },
  endpointRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  endpointText: { flex: 1 },
  endpointTitle: { fontSize: 15, fontWeight: "600", color: "#0f172a" },
  endpointSubtitle: { fontSize: 13, color: "#64748b", marginTop: 2 },
  endpointActions: { flexDirection: "row", justifyContent: "flex-end", gap: 24, marginTop: 12 },
  link: { fontSize: 14, fontWeight: "700", color: "#2563eb" },
  linkMuted: { fontSize: 14, fontWeight: "600", color: "#64748b" },
  linkDisabled: { opacity: 0.4 },
  odometerRow: { flexDirection: "row", gap: 12 },
  odometerField: { flex: 1 },
  odometerCaption: { fontSize: 12, color: "#64748b", marginBottom: 6 },
  warning: { fontSize: 12, color: "#b45309", lineHeight: 18, marginTop: 10 },
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
