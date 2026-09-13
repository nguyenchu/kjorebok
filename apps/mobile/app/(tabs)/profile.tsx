import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { getTrackerState } from "@/lib/tripTracker";
import { assessTrackerHealth, type TrackerHealth } from "@/lib/trackerHealth";
import { format } from "date-fns";
import { nb } from "date-fns/locale";

export default function ProfileScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const { user, logout, deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [health, setHealth] = useState<TrackerHealth | null>(null);

  // Refreshed on focus so returning from the tracking screen shows the new state.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getTrackerState()
        .then((tracker) => {
          if (active) setHealth(assessTrackerHealth(tracker));
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [])
  );

  const confirmDeleteAccount = () => {
    if (deleting) return;

    Alert.alert(
      "Slett konto",
      "Kontoen din og alle registrerte turer blir slettet permanent. Dette kan ikke angres.",
      [
        { text: "Avbryt", style: "cancel" },
        {
          text: "Slett konto",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setDeleting(true);
              try {
                await deleteAccount();
              } catch (error) {
                const message = error instanceof Error ? error.message : "Kunne ikke slette konto akkurat nå.";
                Alert.alert("Sletting feilet", message);
              } finally {
                setDeleting(false);
              }
            })();
          },
        },
      ]
    );
  };

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
      </View>

      <Text style={styles.sectionHeading}>Innstillinger</Text>

      <TouchableOpacity
        style={styles.navButton}
        onPress={() => router.push("/tracking")}
        activeOpacity={0.8}
      >
        <View style={styles.navButtonTextGroup}>
          <Text style={styles.navButtonText}>Sporing</Text>
          {health && (
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  health.needsAttention ? styles.statusDotWarning : styles.statusDotOk,
                ]}
              />
              <Text style={styles.navButtonMeta}>{health.shortStatus}</Text>
            </View>
          )}
        </View>
        <Text style={styles.navButtonChevron}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.navButton}
        onPress={() => router.push("/vehicles")}
        activeOpacity={0.8}
      >
        <Text style={styles.navButtonText}>Mine kjøretøy</Text>
        <Text style={styles.navButtonChevron}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutButton} onPress={logout} activeOpacity={0.8}>
        <Text style={styles.logoutText}>Logg ut</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.deleteButton, deleting && styles.buttonDisabled]}
        onPress={confirmDeleteAccount}
        activeOpacity={0.8}
        disabled={deleting}
      >
        {deleting ? (
          <ActivityIndicator color="#b91c1c" />
        ) : (
          <Text style={styles.deleteText}>Slett konto</Text>
        )}
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
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: "#e2e8f0" },
  navButton: {
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  navButtonTextGroup: { flex: 1 },
  navButtonText: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  navButtonMeta: { fontSize: 13, color: "#64748b" },
  navButtonChevron: { fontSize: 22, color: "#94a3b8", lineHeight: 22 },
  sectionHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
    marginLeft: 4,
  },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusDotOk: { backgroundColor: "#22c55e" },
  statusDotWarning: { backgroundColor: "#ef4444" },
  logoutButton: {
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  logoutText: { fontSize: 16, fontWeight: "600", color: "#dc2626" },
  deleteButton: {
    backgroundColor: "#fff7f7",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#fca5a5",
    marginTop: 12,
  },
  deleteText: { fontSize: 16, fontWeight: "700", color: "#b91c1c" },
  buttonDisabled: { opacity: 0.7 },
});
