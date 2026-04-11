import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useAuth } from "@/lib/auth";
import { getApiBaseUrl } from "@/lib/api";
import { format } from "date-fns";
import { nb } from "date-fns/locale";

export default function ProfileScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const { user, logout } = useAuth();
  const apiBaseUrl = getApiBaseUrl();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 24 }]}
    >
      <View style={styles.avatarContainer}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
          </Text>
        </View>
        <Text style={styles.name}>{user?.name ?? "Ukjent"}</Text>
        <Text style={styles.email}>{user?.email ?? ""}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Navn</Text>
          <Text style={styles.rowValue}>{user?.name}</Text>
        </View>
        <View style={styles.separator} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>E-post</Text>
          <Text style={styles.rowValue}>{user?.email}</Text>
        </View>
        <View style={styles.separator} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Medlem siden</Text>
          <Text style={styles.rowValue}>
            {user?.createdAt
              ? format(new Date(user.createdAt), "d. MMMM yyyy", { locale: nb })
              : "Ukjent"}
          </Text>
        </View>
        <View style={styles.separator} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>API</Text>
          <Text style={styles.apiValue}>{apiBaseUrl}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={logout} activeOpacity={0.8}>
        <Text style={styles.logoutText}>Logg ut</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 24, paddingBottom: 40 },
  avatarContainer: { alignItems: "center", marginTop: 20, marginBottom: 32 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  avatarText: { fontSize: 32, fontWeight: "700", color: "#fff" },
  name: { fontSize: 22, fontWeight: "700", color: "#0f172a", marginBottom: 4 },
  email: { fontSize: 15, color: "#64748b" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
    marginBottom: 32,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
  },
  rowLabel: { fontSize: 15, color: "#64748b" },
  rowValue: { fontSize: 15, fontWeight: "600", color: "#0f172a" },
  apiValue: { fontSize: 13, fontWeight: "600", color: "#0f172a", flex: 1, textAlign: "right" },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: "#e2e8f0" },
  logoutButton: {
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  logoutText: { fontSize: 16, fontWeight: "600", color: "#dc2626" },
});
