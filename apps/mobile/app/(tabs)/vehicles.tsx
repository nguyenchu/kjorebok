import { useEffect, useState } from "react";
import {
  View, Text, FlatList, StyleSheet, TextInput,
  TouchableOpacity, Alert, ActivityIndicator,
} from "react-native";
import { api } from "@/lib/api";
import type { Vehicle } from "@kjorebok/shared";

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setVehicles(await api.get<Vehicle[]>("/vehicles"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim() || !plate.trim()) return;
    setSaving(true);
    try {
      await api.post<Vehicle>("/vehicles", { name: name.trim(), licensePlate: plate.trim().toUpperCase() });
      setName("");
      setPlate("");
      await load();
    } catch (e: any) {
      Alert.alert("Feil", e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = (id: string, label: string) => {
    Alert.alert("Slett kjøretøy", `Slett ${label}?`, [
      { text: "Avbryt", style: "cancel" },
      {
        text: "Slett", style: "destructive",
        onPress: async () => {
          await api.delete(`/vehicles/${id}`);
          await load();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.form}>
        <Text style={styles.formTitle}>Legg til kjøretøy</Text>
        <TextInput style={styles.input} placeholder="Navn (f.eks. Firmabilen)" value={name} onChangeText={setName} />
        <TextInput style={styles.input} placeholder="Registreringsnummer" value={plate} onChangeText={setPlate} autoCapitalize="characters" />
        <TouchableOpacity style={styles.button} onPress={add} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Legg til</Text>}
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={vehicles}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ gap: 8 }}
          ListEmptyComponent={<Text style={styles.empty}>Ingen kjøretøy ennå.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.plate}>{item.licensePlate}</Text>
              </View>
              <TouchableOpacity onPress={() => remove(item.id, item.name)}>
                <Text style={styles.delete}>Slett</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#f8fafc" },
  form: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 20, gap: 10 },
  formTitle: { fontWeight: "700", fontSize: 16, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8,
    padding: 12, fontSize: 15,
  },
  button: { backgroundColor: "#2563eb", borderRadius: 8, padding: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "700" },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 20 },
  row: {
    backgroundColor: "#fff", borderRadius: 10, padding: 14,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  name: { fontWeight: "600" },
  plate: { color: "#64748b", fontSize: 13 },
  delete: { color: "#dc2626", fontWeight: "600" },
});
