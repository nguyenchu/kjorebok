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
        <View style={styles.header}>
          <Text style={styles.logo}>🚗</Text>
          <Text style={styles.title}>Kjørebok</Text>
          <Text style={styles.subtitle}>
            {mode === "login" ? "Logg inn for å fortsette" : "Opprett ny konto"}
          </Text>
        </View>

        <View style={styles.card}>
          {mode === "register" && (
            <TextInput
              style={styles.input}
              placeholder="Navn"
              placeholderTextColor="#94a3b8"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoComplete="name"
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="E-post"
            placeholderTextColor="#94a3b8"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <TextInput
            style={styles.input}
            placeholder="Passord"
            placeholderTextColor="#94a3b8"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={styles.button}
            onPress={submit}
            disabled={loading}
            activeOpacity={0.8}
          >
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
  header: {
    alignItems: "center",
    marginBottom: 32,
  },
  logo: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 32, fontWeight: "800", color: "#0f172a", marginBottom: 8 },
  subtitle: { color: "#64748b", fontSize: 16 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    gap: 14,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
  },
  error: { color: "#dc2626", fontSize: 14, textAlign: "center" },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    marginTop: 4,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 17 },
  toggle: { color: "#2563eb", textAlign: "center", fontWeight: "600", fontSize: 15 },
});
