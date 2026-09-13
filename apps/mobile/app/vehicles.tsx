import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { api } from "@/lib/api";
import { setSelectedVehicleId } from "@/lib/tripTracker";
import type { Vehicle, VehicleType } from "@kjorebok/shared";

const TYPE_LABELS: Record<VehicleType, string> = {
  PRIVATE: "Privatbil",
  COMPANY: "Firmabil",
  WORK: "Yrkesbil",
};

const TYPE_ORDER: VehicleType[] = ["PRIVATE", "COMPANY", "WORK"];

const REGISTRATION_PATTERN = /^[A-ZÆØÅ]{2}\s?\d{5}$/;

function normalizeRegistration(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, " ");
}

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [registration, setRegistration] = useState("");
  const [type, setType] = useState<VehicleType>("PRIVATE");

  const load = useCallback(async () => {
    try {
      const result = await api.get<Vehicle[]>("/vehicles");
      setVehicles(result);
      const fallback = result.find((vehicle) => vehicle.isDefault) ?? result[0] ?? null;
      await setSelectedVehicleId(fallback?.id ?? null);
    } catch (error) {
      Alert.alert("Kunne ikke hente kjøretøy", error instanceof Error ? error.message : "Prøv igjen senere.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setLabel("");
    setRegistration("");
    setType("PRIVATE");
    setShowForm(false);
  };

  const handleCreate = async () => {
    const trimmedLabel = label.trim();
    const normalized = normalizeRegistration(registration);

    if (!trimmedLabel) {
      Alert.alert("Mangler navn", "Gi kjøretøyet et navn, for eksempel «Familiebilen».");
      return;
    }
    if (!REGISTRATION_PATTERN.test(normalized)) {
      Alert.alert("Ugyldig registreringsnummer", "Skriv to bokstaver og fem siffer, for eksempel AB 12345.");
      return;
    }

    setSaving(true);
    try {
      await api.post<Vehicle>("/vehicles", {
        label: trimmedLabel,
        registration: normalized,
        type,
      });
      resetForm();
      await load();
    } catch (error) {
      Alert.alert("Kunne ikke lagre", error instanceof Error ? error.message : "Prøv igjen senere.");
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (vehicle: Vehicle) => {
    if (vehicle.isDefault) return;

    try {
      await api.patch<Vehicle>(`/vehicles/${vehicle.id}`, { isDefault: true });
      await load();
    } catch (error) {
      Alert.alert("Kunne ikke oppdatere", error instanceof Error ? error.message : "Prøv igjen senere.");
    }
  };

  const handleDelete = (vehicle: Vehicle) => {
    Alert.alert(
      "Slett kjøretøy",
      `${vehicle.label} blir fjernet. Turer som allerede er registrert på kjøretøyet beholdes, men mister koblingen.`,
      [
        { text: "Avbryt", style: "cancel" },
        {
          text: "Slett",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await api.delete(`/vehicles/${vehicle.id}`);
                await load();
              } catch (error) {
                Alert.alert("Kunne ikke slette", error instanceof Error ? error.message : "Prøv igjen senere.");
              }
            })();
          },
        },
      ]
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Mine kjøretøy",
          headerStyle: { backgroundColor: "#eef6ff" },
          headerTintColor: "#0f172a",
          headerTitleStyle: { fontWeight: "700" },
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <Text style={styles.intro}>
            Nye turer registreres automatisk på standardkjøretøyet. Du kan endre kjøretøy på en enkelt tur
            i etterkant.
          </Text>

          {loading ? (
            <ActivityIndicator color="#2563eb" style={styles.loader} />
          ) : vehicles.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Ingen kjøretøy ennå</Text>
              <Text style={styles.emptyText}>
                Legg inn bilen du kjører, så kommer registreringsnummeret med i kjøreboken og rapportene.
              </Text>
            </View>
          ) : (
            vehicles.map((vehicle) => (
              <View key={vehicle.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitleGroup}>
                    <Text style={styles.cardTitle}>{vehicle.label}</Text>
                    <Text style={styles.cardMeta}>
                      {vehicle.registration} · {TYPE_LABELS[vehicle.type]}
                    </Text>
                  </View>
                  {vehicle.isDefault && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>Standard</Text>
                    </View>
                  )}
                </View>

                <View style={styles.cardActions}>
                  {!vehicle.isDefault && (
                    <TouchableOpacity
                      style={styles.cardAction}
                      onPress={() => void handleSetDefault(vehicle)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.cardActionText}>Sett som standard</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.cardAction}
                    onPress={() => handleDelete(vehicle)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.cardActionText, styles.cardActionDanger]}>Slett</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          {showForm ? (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>Nytt kjøretøy</Text>

              <Text style={styles.fieldLabel}>Navn</Text>
              <TextInput
                style={styles.input}
                value={label}
                onChangeText={setLabel}
                placeholder="Familiebilen"
                placeholderTextColor="#94a3b8"
                maxLength={80}
              />

              <Text style={styles.fieldLabel}>Registreringsnummer</Text>
              <TextInput
                style={styles.input}
                value={registration}
                onChangeText={setRegistration}
                placeholder="AB 12345"
                placeholderTextColor="#94a3b8"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={9}
              />

              <Text style={styles.fieldLabel}>Type</Text>
              <View style={styles.typeRow}>
                {TYPE_ORDER.map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[styles.typeChip, type === option && styles.typeChipActive]}
                    onPress={() => setType(option)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.typeChipText, type === option && styles.typeChipTextActive]}>
                      {TYPE_LABELS[option]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, saving && styles.buttonDisabled]}
                onPress={() => void handleCreate()}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Lagre kjøretøy</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.linkButton} onPress={resetForm} activeOpacity={0.7}>
                <Text style={styles.linkButtonText}>Avbryt</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setShowForm(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryButtonText}>Legg til kjøretøy</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 20, paddingBottom: 40 },
  intro: { fontSize: 14, color: "#475569", lineHeight: 20, marginBottom: 20 },
  loader: { marginVertical: 32 },
  emptyCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a", marginBottom: 6 },
  emptyText: { fontSize: 14, color: "#64748b", lineHeight: 20 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  cardTitleGroup: { flex: 1, paddingRight: 12 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a", marginBottom: 4 },
  cardMeta: { fontSize: 13, color: "#64748b" },
  badge: {
    backgroundColor: "#dbeafe",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: "700", color: "#1d4ed8" },
  cardActions: {
    flexDirection: "row",
    marginTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e2e8f0",
    paddingTop: 12,
  },
  cardAction: { marginRight: 20 },
  cardActionText: { fontSize: 14, fontWeight: "600", color: "#2563eb" },
  cardActionDanger: { color: "#dc2626" },
  formCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginTop: 4,
  },
  formTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a", marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#475569", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0f172a",
    marginBottom: 16,
    backgroundColor: "#fff",
  },
  typeRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 20 },
  typeChip: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  typeChipActive: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  typeChipText: { fontSize: 13, fontWeight: "600", color: "#475569" },
  typeChipTextActive: { color: "#fff" },
  primaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  buttonDisabled: { opacity: 0.7 },
  linkButton: { alignItems: "center", paddingVertical: 12 },
  linkButtonText: { color: "#64748b", fontSize: 15, fontWeight: "600" },
});
