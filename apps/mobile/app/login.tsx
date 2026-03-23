import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth";

type Mode = "login" | "register";

export default function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await login({ email: email.trim(), password });
      } else {
        if (!name.trim()) { setError("Navn er påkrevd"); setLoading(false); return; }
        await register({ email: email.trim(), password, name: name.trim() });
      }
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Kjørebok</Text>
        <Text style={styles.subtitle}>
          {mode === "login" ? "Logg inn for å fortsette" : "Opprett ny konto"}
        </Text>

        <View style={styles.card}>
          {mode === "register" && (
            <TextInput
              style={styles.input}
              placeholder="Navn"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoComplete="name"
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="E-post"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <TextInput
            style={styles.input}
            placeholder="Passord"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity style={styles.button} onPress={submit} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {mode === "login" ? "Logg inn" : "Registrer"}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
        >
          <Text style={styles.toggle}>
            {mode === "login"
              ? "Har du ikke konto? Registrer deg"
              : "Har du allerede konto? Logg inn"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f8fafc",
  },
  title: { fontSize: 32, fontWeight: "800", textAlign: "center", marginBottom: 8 },
  subtitle: { color: "#64748b", textAlign: "center", marginBottom: 32 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
  },
  error: { color: "#dc2626", fontSize: 13, textAlign: "center" },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    marginTop: 4,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  toggle: { color: "#2563eb", textAlign: "center", fontWeight: "500" },
});
